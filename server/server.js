import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  fetchSpotifyPlaylistTracks,
  parseSpotifyPlaylistId,
} from "./spotify.js";
import { fetchYouTubePlaylist, parseYouTubePlaylistId } from "./youtube.js";
import { isGuessCorrect, getDetailedMatch } from "./utils.js";
import { updateLeaderboardScore, getLeaderboard } from "./leaderboard.js";
import {
  saveRoom,
  getRoomFromFirestore,
  deleteRoomFromFirestore,
} from "./room-manager.js";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const serviceAccountPath = path.join(
  __dirname,
  "firebase-service-account.json",
);

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8"),
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin initialized successfully via JSON file.");
} else if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  console.log(
    "Firebase Admin initialized successfully via environment variables.",
  );
} else {
  console.warn(
    `Firebase Service Account not found (no JSON at ${serviceAccountPath} and no FIREBASE_PROJECT_ID env). Authentication and Firestore will be disabled.`,
  );
}

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(",") || "*",
  }),
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(",") || "*" },
});

const PORT = process.env.PORT || 4000;

// ===== In-memory game state =====
// { [code]: { code, hostId, users: Map, ... } }
const rooms = new Map();
// room = {
//   code, hostId, users: Map(socketId => {name, score}), mode: 'spotify'|'youtube',
//   tracks: [ ... ], answersKnown: boolean,
//   gameType: 'text'|'buzzer', roundCount: 0,
//   currentRound: {
//     startedAt, answer: {title, artist}, track: {...}, solved: false,
//     buzzer: null | { tsFirst, currentId, currentName, queue: [{id,name,ts}] }
//   },
// }

async function buildPlaybackForTrack(track, mode) {
  if (mode === "spotify" && track.previewUrl) {
    return { type: "audio", previewUrl: track.previewUrl, cover: track.cover };
  }

  if (track.title) {
    if (!process.env.YT_API_KEY) {
      console.warn(
        "YouTube API Key is missing. Cannot fall back for track:",
        track.title,
      );
      return null;
    }

    const q = [track.title, track.artist].filter(Boolean).join(" ");
    try {
      const r = await axios.get(
        "https://www.googleapis.com/youtube/v3/search",
        {
          params: {
            key: process.env.YT_API_KEY,
            q,
            type: "video",
            maxResults: 1,
            videoEmbeddable: "true",
            part: "snippet",
          },
        },
      );
      const item = r.data.items?.[0];
      if (item?.id?.videoId) {
        return { type: "youtube", videoId: item.id.videoId };
      } else {
        console.warn("No YouTube results found for:", q);
      }
    } catch (e) {
      const errorData = e?.response?.data;
      if (errorData?.error?.errors?.[0]?.reason === "quotaExceeded") {
        console.error("CRITICAL: YouTube API Quota Exceeded!");
      } else {
        console.warn("YouTube API error:", errorData || e.message);
      }
    }
  }
  return null;
}

function newRoomCode() {
  return nanoid(6).toUpperCase();
}

async function getRoom(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (rooms.has(upper)) return rooms.get(upper);

  const fireRoom = await getRoomFromFirestore(upper);
  if (fireRoom) {
    // Reconstruct Map and Room object
    const room = {
      ...fireRoom,
      users: new Map(),
    };
    if (fireRoom.players) {
      for (const [uid, pData] of Object.entries(fireRoom.players)) {
        // We don't have socket IDs for everyone yet, they will "re-attach" on join
        // But for display, we need them in room.users
        // Use uid as temporary key if no socket
        room.users.set(`pending-${uid}`, { ...pData, uid });
      }
    }
    rooms.set(upper, room);
    return room;
  }
  return null;
}

function broadcastRoom(code) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return;

  const payload = {
    code: room.code,
    hostId: room.hostId,
    players: [...room.users.values()].map((u) => ({
      name: u.name,
      score: u.score,
    })),
    hasTracks: !!(room.tracks && room.tracks.length),
    gameStarted: room.answersKnown,
    gameType: room.gameType,
    roundCount: room.roundCount || 0,
    currentRound: room.currentRound
      ? {
          startedAt: room.currentRound.startedAt,
          hint: room.currentRound.hint,
          playback: room.currentRound.playback,
          solved: room.currentRound.solved,
          buzzer: room.currentRound.buzzer
            ? {
                currentId: room.currentRound.buzzer.currentId,
                currentName: room.currentRound.buzzer.currentName,
                queue: (room.currentRound.buzzer.queue || []).map(
                  (q) => q.name,
                ),
              }
            : null,
        }
      : null,
  };
  io.to(room.code).emit("roomState", payload);
}

// ===== REST: Parse + fetch playlists =====
app.post("/api/parse-playlist", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing playlist URL." });

    if (parseSpotifyPlaylistId(url)) {
      if (
        !process.env.SPOTIFY_CLIENT_ID ||
        !process.env.SPOTIFY_CLIENT_SECRET
      ) {
        return res
          .status(400)
          .json({ error: "Spotify API is not configured on the server." });
      }
      const data = await fetchSpotifyPlaylistTracks({
        url,
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      });
      return res.json(data);
    }

    if (parseYouTubePlaylistId(url)) {
      if (!process.env.YT_API_KEY) {
        return res
          .status(400)
          .json({ error: "Missing YT_API_KEY for YouTube Data API." });
      }
      const data = await fetchYouTubePlaylist({
        url,
        apiKey: process.env.YT_API_KEY,
      });
      return res.json(data);
    }

    return res.status(400).json({
      error:
        "Unrecognized playlist type. Paste a Spotify or YouTube playlist link.",
    });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: e.message || "Server error while parsing playlist." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const list = await getLeaderboard();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// ===== SOCKETS =====
io.on("connection", (socket) => {
  // Create room
  socket.on("createRoom", async (cb) => {
    const code = newRoomCode();
    const room = {
      code,
      hostId: socket.id,
      hostUid: "", // will be set on join
      users: new Map(),
      mode: null,
      tracks: [],
      answersKnown: false,
      gameType: "text",
      currentRound: null,
    };
    rooms.set(code, room);
    await saveRoom(code, room);
    socket.join(code);
    cb && cb({ code });
    broadcastRoom(code);
  });

  // Join room
  socket.on("joinRoom", async ({ code, name, token }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });

    let uid = null;
    let photoURL = null;
    if (token) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        uid = decodedToken.uid;
        photoURL = decodedToken.picture || null;
      } catch (err) {
        console.error("Firebase auth error:", err);
      }
    }

    if (uid) {
      if (room.hostUid === uid) {
        room.hostId = socket.id;
      } else if (!room.hostUid && room.hostId === socket.id) {
        room.hostUid = uid;
      }

      const existingEntry = [...room.users.entries()].find(
        ([, u]) => u.uid === uid,
      );

      if (existingEntry) {
        const [oldSocketId, userData] = existingEntry;
        room.users.delete(oldSocketId);
        room.users.set(socket.id, { ...userData, photoURL });

        socket.join(code);
        await saveRoom(code, room);
        broadcastRoom(code);
        return cb && cb({ ok: true, hostId: room.hostId, recovered: true });
      }
    } else {
      // Fallback for non-logged in users (e.g. Host name logic)
      if (room.hostId === socket.id && !room.hostUid) {
        // Keep track of host if they aren't logged in (legacy/dev support)
      }
    }

    const newUser = {
      name: name?.trim() || "Gracz",
      score: 0,
      uid,
      photoURL,
    };

    // Check if user was already in Firestore (but maybe not in Map yet)
    if (uid && room.players?.[uid]) {
      newUser.score = room.players[uid].score;
    }

    room.users.set(socket.id, newUser);
    socket.join(code);
    await saveRoom(code, room);

    io.to(code).emit("chat", {
      system: true,
      text: `${newUser.name} joined the room`,
    });

    broadcastRoom(code);
    cb && cb({ ok: true, hostId: room.hostId });
  });

  // Leave room / disconnect
  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (!room.users.has(socket.id)) continue;
      const user = room.users.get(socket.id);
      room.users.delete(socket.id);

      if (user) {
        io.to(code).emit("chat", {
          system: true,
          text: `${user.name} left the room`,
        });
      }

      // Tidy up buzzer on disconnect
      const r = room.currentRound;
      if (r?.buzzer) {
        let changed = false;

        // If current holder left -> pass automatically
        if (r.buzzer.currentId === socket.id) {
          if (r.buzzer.queue.length > 0) {
            const next = r.buzzer.queue.shift();
            r.buzzer.currentId = next.id;
            r.buzzer.currentName = next.name;
            io.to(code).emit("buzzed", {
              id: r.buzzer.currentId,
              name: r.buzzer.currentName,
              at: r.buzzer.tsFirst,
            });
            changed = true;
          } else {
            r.buzzer = null;
            io.to(code).emit("buzzCleared", {});
            changed = true;
          }
        }

        // Remove from queue if present
        const before = r.buzzer?.queue.length || 0;
        r.buzzer.queue = r.buzzer.queue.filter((p) => p.id !== socket.id);
        const after = r.buzzer?.queue.length || 0;
        if (before !== after) {
          io.to(code).emit("queueUpdated", { queue: r.buzzer.queue });
          changed = true;
        }

        if (changed) broadcastRoom(code);
      }

      // Transfer host if needed
      if (room.hostId === socket.id) {
        const next = [...room.users.keys()][0];
        room.hostId = next || null;
      }

      if (room.users.size === 0) {
        rooms.delete(code);
      } else {
        broadcastRoom(code);
      }
    }
  });

  // Load playlist (host only) – keep as is
  socket.on("loadPlaylist", async ({ code, url }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can load the playlist." });
    cb &&
      cb({
        error: "Use the REST endpoint /api/parse-playlist from the frontend.",
      });
  });

  socket.on("setName", ({ code, name }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    const user = room.users.get(socket.id);
    if (!user) return cb && cb({ error: "Player not in room." });

    const newName = (name || "").trim().slice(0, 32);
    if (!newName) return cb && cb({ error: "Name required." });

    const taken = [...room.users.values()].some(
      (u) => u !== user && u.name === newName,
    );
    user.name = taken
      ? `${newName}#${Math.floor(Math.random() * 99) + 1}`
      : newName;

    broadcastRoom(code);
    cb && cb({ ok: true, name: user.name });
  });

  // Start game (host only)
  socket.on("startGame", async ({ code, mode, tracks, gameType }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (!tracks || tracks.length < 20)
      return cb && cb({ error: "Playlist must have at least 20 tracks." });

    room.mode = mode; // spotify | youtube
    room.gameType = gameType || "text"; // text | buzzer

    // Shuffle and pick 20
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    room.tracks = shuffled.slice(0, 20);

    room.answersKnown = true;
    room.currentRound = null;
    room.roundCount = 0;

    await saveRoom(code, room);
    io.to(code).emit("gameStarted", {
      mode: room.mode,
      gameType: room.gameType,
    });
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Next round (host only)
  socket.on("nextRound", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can start a round." });

    if (room.roundCount >= 20) {
      // Game over
      io.to(code).emit("gameOver", {
        scores: [...room.users.values()].map((u) => ({
          name: u.name,
          score: u.score,
        })),
      });
      return cb && cb({ ok: true, gameOver: true });
    }

    let playback = null;
    let currentTrackIndex = room.roundCount;
    let track = null;

    while (currentTrackIndex < room.tracks.length && !playback) {
      track = room.tracks[currentTrackIndex];
      playback = await buildPlaybackForTrack(track, room.mode);
      if (!playback) {
        console.warn(
          `Skipping unplayable track: ${track.title} at index ${currentTrackIndex}`,
        );
        currentTrackIndex++;
      }
    }

    if (!playback) {
      return (
        cb && cb({ error: "Could not load playback for any remaining tracks." })
      );
    }

    room.roundCount = currentTrackIndex + 1;

    room.currentRound = {
      startedAt: Date.now(),
      track,
      playback,
      answer: { title: track.title, artist: track.artist || "" },
      solved: false,
      buzzer: null, // set on first buzz
      hint: {
        titleLen: track.title?.length || 0,
        artistLen: track.artist?.length || 0,
      },
    };

    await saveRoom(code, room);
    const payload = {
      mode: room.mode,
      gameType: room.gameType,
      startedAt: room.currentRound.startedAt,
      hint: room.currentRound.hint,
      playback,
    };

    io.to(code).emit("roundStart", payload);
    cb && cb({ ok: true });
  });

  // TEXT mode guessing
  socket.on("guess", async ({ code, guessText }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.currentRound.solved)
      return cb && cb({ error: "Round is already finished." });
    if (room.gameType === "buzzer") {
      return cb && cb({ error: "Use buzzer mode flow." });
    }

    const { title, artist } = room.currentRound.answer;
    const { artistCorrect, titleCorrect } = getDetailedMatch(
      "", // we don't separate artist/title in text input
      guessText,
      artist,
      title,
    );

    let points = 0;
    if (artistCorrect && titleCorrect) {
      points = 10;
    } else if (titleCorrect) {
      points = 5;
    }

    if (points === 0) {
      return cb && cb({ ok: true, correct: false });
    }

    room.currentRound.solved = true;
    const player = room.users.get(socket.id);
    if (player) {
      player.score += points;
      if (player.uid) {
        updateLeaderboardScore(player.uid, player.name, points);
      }
    }

    await saveRoom(code, room);
    const elapsedMs = Date.now() - room.currentRound.startedAt;
    io.to(code).emit("roundEnd", {
      winner: player?.name || "Ktoś",
      answer: { title, artist },
      elapsedMs,
      scores: [...room.users.values()].map((u) => ({
        name: u.name,
        score: u.score,
      })),
    });
    broadcastRoom(code);
    cb && cb({ ok: true, correct: true });
  });

  // Chat
  socket.on("chat", ({ code, name, text }) => {
    if (!getRoom(code)) return;
    io.to(code).emit("chat", { name, text, at: Date.now() });
  });

  // ===== BUZZER MODE =====

  // Player buzzes in — first buzz pauses playback
  socket.on("buzz", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const r = room.currentRound;
    const player = room.users.get(socket.id);
    if (!player) return cb && cb({ error: "Player not in room." });

    if (!r.buzzer) {
      r.buzzer = {
        tsFirst: Date.now(),
        currentId: socket.id,
        currentName: player.name,
        queue: [],
      };

      io.to(code).emit("pausePlayback"); // <-- pauza przy pierwszym buzz
      io.to(code).emit("buzzed", {
        id: r.buzzer.currentId,
        name: r.buzzer.currentName,
        at: r.buzzer.tsFirst,
      });
      io.to(code).emit("queueUpdated", { queue: r.buzzer.queue });
      await saveRoom(code, room);
      return cb && cb({ ok: true, first: true });
    }

    // Kolejne zgłoszenia -> do kolejki
    const isCurrent = r.buzzer.currentId === socket.id;
    const inQueue = r.buzzer.queue.some((p) => p.id === socket.id);
    if (!isCurrent && !inQueue) {
      r.buzzer.queue.push({ id: socket.id, name: player.name, ts: Date.now() });
      io.to(code).emit("queueUpdated", { queue: r.buzzer.queue });
      await saveRoom(code, room);
      return cb && cb({ ok: true, queued: true });
    }

    cb && cb({ ok: false, reason: "Already current or queued" });
  });

  // Host passes the buzzer to the next person in queue
  socket.on("passBuzzer", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can pass the buzzer." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const r = room.currentRound;
    if (!r?.buzzer) return cb && cb({ error: "No active buzzer." });

    if (r.buzzer.queue.length > 0) {
      const next = r.buzzer.queue.shift();
      r.buzzer.currentId = next.id;
      r.buzzer.currentName = next.name;

      io.to(code).emit("buzzed", {
        id: r.buzzer.currentId,
        name: r.buzzer.currentName,
        at: r.buzzer.tsFirst,
      });
      io.to(code).emit("queueUpdated", { queue: r.buzzer.queue });

      // ✅ WYMAGANIE: przy przejściu na kolejną osobę wznowić muzykę
      io.to(code).emit("resumePlayback");

      await saveRoom(code, room);
      return cb && cb({ ok: true, passed: true });
    } else {
      r.buzzer = null;
      io.to(code).emit("buzzCleared", {});
      io.to(code).emit("resumePlayback");
      await saveRoom(code, room);
      return cb && cb({ ok: true, cleared: true });
    }
  });

  // Host awards points (buzzer)
  socket.on("awardPoints", async ({ code, playerName, points }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can award points." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const entry = [...room.users.entries()].find(
      ([, u]) => u.name === playerName,
    );
    if (!entry) return cb && cb({ error: "Player not found." });
    const p = entry[1];
    const pts = Number(points) || 10;
    p.score += pts;
    if (p.uid) {
      updateLeaderboardScore(p.uid, p.name, pts);
    }

    await saveRoom(code, room);
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Host deducts points (buzzer)
  socket.on("deductPoints", async ({ code, playerName, points }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can deduct points." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const entry = [...room.users.entries()].find(
      ([, u]) => u.name === playerName,
    );
    if (!entry) return cb && cb({ error: "Player not found." });

    const p = entry[1];
    const pts = Number(points) || 10;
    p.score -= pts;
    if (p.score < 0) p.score = 0;

    if (p.uid) {
      updateLeaderboardScore(p.uid, p.name, -pts);
    }

    await saveRoom(code, room);
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Host ends round manually (buzzer)
  socket.on("endRoundManual", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can end the round." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const { title, artist } = room.currentRound.answer;

    // Timer: do pierwszego buzz (pauza po buzz)
    const tsFirst = room.currentRound.buzzer?.tsFirst;
    const elapsedMs = tsFirst
      ? tsFirst - room.currentRound.startedAt
      : Date.now() - room.currentRound.startedAt;

    const winner = room.currentRound.buzzer?.currentName || null;

    room.currentRound.solved = true;
    await saveRoom(code, room);
    io.to(code).emit("roundEnd", {
      winner,
      answer: { title, artist },
      elapsedMs,
      scores: [...room.users.values()].map((u) => ({
        name: u.name,
        score: u.score,
      })),
    });
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Host manual verification (buzzer mode)
  socket.on("hostVerifyGuess", async ({ code, artist, title }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can verify guesses." });

    const target = room.currentRound?.answer;
    if (!target) return cb && cb({ error: "Round is not active." });

    const match = getDetailedMatch(artist, title, target.artist, target.title);
    cb({
      artistCorrect: match.artistCorrect,
      titleCorrect: match.titleCorrect,
    });
  });

  socket.on("setName", async ({ code, name }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });

    const player = room.users.get(socket.id);
    if (player) {
      player.name = name?.trim().slice(0, 32) || "Player";
      await saveRoom(code, room);
      broadcastRoom(code);
      cb && cb({ ok: true });
    }
  });

  socket.on("disconnect", async () => {
    for (const [code, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        broadcastRoom(code);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
