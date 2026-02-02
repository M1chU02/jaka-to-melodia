import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import { YouTube } from "youtube-sr";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  fetchSpotifyPlaylistTracks,
  parseSpotifyPlaylistId,
} from "./spotify.js";
import { fetchYouTubePlaylist, parseYouTubePlaylistId } from "./youtube.js";
import { isGuessCorrect, getDetailedMatch } from "./utils.js";
import { getLeaderboard, updateLeaderboardScore } from "./leaderboard.js";
import { savePlaylistToHistory, getPlaylistHistory } from "./history.js";
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
let ytQuotaExceeded = false;
let ytQuotaResetTime = 0;

function checkYtQuota() {
  if (ytQuotaExceeded && Date.now() > ytQuotaResetTime) {
    ytQuotaExceeded = false;
  }
  return !ytQuotaExceeded;
}

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
  if (mode === "spotify") {
    // 1. Use pre-fetched videoId if available
    if (track.videoId) {
      return { type: "youtube", videoId: track.videoId };
    }

    // 2. Fallback: Spotify preview (Free)
    if (track.previewUrl) {
      return {
        type: "audio",
        previewUrl: track.previewUrl,
        cover: track.cover,
      };
    }

    // 3. Last Layer: Scraper search via youtube-sr (Reliable & No Quota)
    try {
      const q = [track.title, track.artist].filter(Boolean).join(" ");
      const v = await YouTube.searchOne(q);
      if (v?.id) {
        return { type: "youtube", videoId: v.id };
      }
    } catch (e) {
      console.error("youtube-sr error during Spotify playback fallback:", e);
    }

    console.log(
      `Playback failed for Spotify track: ${track.title}. No videoId or previewUrl found.`,
    );
    return null;
  }

  // YouTube Mode
  if (mode === "youtube") {
    // 1. If we already have a videoId (standard for YT tracks), use it!
    // Priority check before quota.
    if (track.id && track.source === "youtube") {
      return { type: "youtube", videoId: track.id };
    }

    if (!track.title) return null;

    if (!process.env.YT_API_KEY) {
      console.warn("YouTube API Key is missing.");
      return null;
    }

    if (!checkYtQuota()) {
      console.warn(
        "YouTube API Quota is still exceeded. Skipping YouTube search.",
      );
      return null;
    }

    // 2. Fallback search (only if ID is missing)
    const q = [track.title, track.artist].filter(Boolean).join(" ");
    try {
      // Prefer scraper (youtube-sr) as it's free and fast
      const v = await YouTube.searchOne(q);
      if (v?.id) {
        return { type: "youtube", videoId: v.id };
      }

      // Final desperate attempt via official API (if quota allowed)
      if (checkYtQuota()) {
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
        }
      }
      console.warn("No YouTube results found for:", q);
    } catch (e) {
      const errorData = e?.response?.data;
      if (errorData?.error?.errors?.[0]?.reason === "quotaExceeded") {
        console.error(
          "CRITICAL: YouTube API Quota Exceeded! Tripping circuit breaker.",
        );
        ytQuotaExceeded = true;
        // set reset time to next midnight (approx 12h-24h)
        ytQuotaResetTime = Date.now() + 1000 * 60 * 60 * 12;
      } else {
        console.warn("YouTube API error:", errorData || e.message);
      }
    }
  }
  return null;
}

// Helper to search a single track on YouTube (used for Spotify workaround)
// Helper to find YouTube ID via youtube-sr (Reliable, No Quota)
async function getYouTubeVideoId(title, artist) {
  const q = [title, artist].filter(Boolean).join(" ");
  try {
    const v = await YouTube.searchOne(q);
    return v?.id || null;
  } catch (e) {
    console.error(`youtube-sr search failed for ${q}:`, e.message);
    return null;
  }
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
      skipVotes: new Set(),
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
    players: [...room.users.entries()].map(([sid, u]) => ({
      sid,
      name: u.name,
      score: u.score,
    })),
    skipVotes: room.skipVotes?.size || 0,
    totalPlayers: room.users.size,
    hasTracks: !!(room.tracks && room.tracks.length),
    gameStarted: room.answersKnown,
    gameType: room.gameType,
    roundCount: room.roundCount || 0,
    currentRound: room.currentRound
      ? {
          startedAt: room.currentRound.startedAt,
          hint: room.currentRound.hint,
          playback: room.currentRound.playback,
          paused: room.currentRound.paused || false,
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
    const { url, songCount = 20, token } = req.body;
    if (!url) return res.status(400).json({ error: "Missing playlist URL." });

    let userId = null;
    if (token) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        userId = decodedToken.uid;
      } catch (e) {
        console.warn("Invalid token in parse-playlist:", e.message);
      }
    }

    if (parseSpotifyPlaylistId(url)) {
      if (
        !process.env.SPOTIFY_CLIENT_ID ||
        !process.env.SPOTIFY_CLIENT_SECRET
      ) {
        return res
          .status(400)
          .json({ error: "Missing Spotify credentials on server." });
      }
      let data = await fetchSpotifyPlaylistTracks({
        url,
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      });

      let updatedHistory = null;
      if (userId) {
        await savePlaylistToHistory(userId, {
          url,
          name: data.playlistName,
          source: "spotify",
        });
        updatedHistory = await getPlaylistHistory(userId);
      }

      // Shuffle tracks
      data.tracks.sort(() => Math.random() - 0.5);

      // Enrich only a first few to save time/YT quota
      const batchToEnrich = data.tracks.slice(0, Math.max(songCount * 2, 40));
      const enrichedBatch = await Promise.all(
        batchToEnrich.map(async (t) => {
          // If already has previewUrl, return it
          // OR if it's Spotify, we still prefer YT if possible for full playback,
          // but we can fallback to Spotify's 30s preview.
          // Let's try to get YT ID anyway if not present
          const playback = await buildPlaybackForTrack(t, "spotify");
          return { ...t, videoId: playback?.videoId };
        }),
      );

      // Filter for playable (has videoId or previewUrl) and take requested count
      const enrichedTracks = enrichedBatch
        .filter((t) => t.videoId || t.previewUrl)
        .slice(0, songCount);

      return res.json({
        ...data,
        total: enrichedTracks.length,
        playable: enrichedTracks.length,
        tracks: enrichedTracks,
        updatedHistory,
      });
    }

    if (parseYouTubePlaylistId(url)) {
      if (!process.env.YT_API_KEY) {
        return res
          .status(400)
          .json({ error: "Missing YT_API_KEY for YouTube Data API." });
      }
      let data = await fetchYouTubePlaylist({
        url,
        apiKey: process.env.YT_API_KEY,
      });

      let updatedHistory = null;
      if (userId) {
        await savePlaylistToHistory(userId, {
          url,
          name: data.playlistName,
          source: "youtube",
        });
        updatedHistory = await getPlaylistHistory(userId);
      }

      // Shuffle and take requested count
      data.tracks.sort(() => Math.random() - 0.5);
      data.tracks = data.tracks.slice(0, songCount);
      data.total = data.tracks.length;

      return res.json({ ...data, updatedHistory });
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

app.get("/api/playlist-history", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decodedToken = await admin.auth().verifyIdToken(token);
    const history = await getPlaylistHistory(decodedToken.uid);
    res.json(history);
  } catch (e) {
    console.error("Fetch history error:", e);
    res.status(500).json({ error: "Failed to fetch playlist history" });
  }
});

async function triggerNextRound(code) {
  const room = await getRoom(code);
  if (!room) return { error: "Room does not exist." };

  if (room.roundCount >= room.tracks.length) {
    // Game over
    io.to(code).emit("gameOver", {
      scores: [...room.users.values()].map((u) => ({
        name: u.name,
        score: u.score,
      })),
    });
    return { ok: true, gameOver: true };
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
    return { error: "Could not load playback for any remaining tracks." };
  }

  room.roundCount = currentTrackIndex + 1;

  room.currentRound = {
    startedAt: Date.now(),
    track,
    playback,
    answer: { title: track.title, artist: track.artist || "" },
    solved: false,
    paused: false,
    buzzer: null, // set on first buzz
    hint: {
      titleLen: track.title?.length || 0,
      artistLen: track.artist?.length || 0,
    },
  };

  room.skipVotes = new Set();

  await saveRoom(code, room);
  const payload = {
    mode: room.mode,
    gameType: room.gameType,
    startedAt: room.currentRound.startedAt,
    hint: room.currentRound.hint,
    playback,
  };

  io.to(code).emit("roundStart", payload);
  return { ok: true };
}

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
      roundCount: 0,
      currentRound: null,
      skipVotes: new Set(),
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
          io.to(code).emit("queueUpdated", {
            queue: r.buzzer.queue.map((p) => p.name),
          });
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
    if (!tracks || tracks.length < 1)
      return cb && cb({ error: "Playlist must have at least 1 track." });

    room.mode = mode; // spotify | youtube
    room.gameType = gameType || "text"; // text | buzzer

    // Shuffle and pick
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    room.tracks = shuffled;

    room.answersKnown = true;
    room.currentRound = null;
    room.roundCount = 0;
    room.skipVotes = new Set();

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

    const result = await triggerNextRound(code);
    cb && cb(result);
  });

  socket.on("kickPlayer", async ({ code, targetSid }, cb) => {
    const room = await getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can kick players." });

    const targetUser = room.users.get(targetSid);
    if (!targetUser) return cb && cb({ error: "Target player not found." });

    if (targetSid === socket.id)
      return cb && cb({ error: "You cannot kick yourself." });

    // Notify the target
    io.to(targetSid).emit("kicked", { message: "You have been kicked." });

    // Force leave room
    const targetSocket = io.sockets.sockets.get(targetSid);
    if (targetSocket) {
      targetSocket.leave(code);
    }

    room.users.delete(targetSid);
    await saveRoom(code, room);

    io.to(code).emit("chat", {
      system: true,
      text: `${targetUser.name} was kicked from the room`,
    });

    broadcastRoom(code);
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

  socket.on("voteSkip", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound || room.currentRound.solved) {
      return cb && cb({ error: "Cannot skip at this moment." });
    }

    if (!room.skipVotes) room.skipVotes = new Set();
    room.skipVotes.add(socket.id);

    const voteCount = room.skipVotes.size;
    const totalPlayers = room.users.size;

    broadcastRoom(code);

    if (voteCount > totalPlayers / 2) {
      io.to(code).emit("chat", {
        system: true,
        text: "Track skipped by majority vote!",
      });
      const { title, artist } = room.currentRound.answer;
      room.currentRound.solved = true;
      await saveRoom(code, room);
      io.to(code).emit("roundEnd", {
        winner: null,
        answer: { title, artist },
        elapsedMs: Date.now() - room.currentRound.startedAt,
        scores: [...room.users.values()].map((u) => ({
          name: u.name,
          score: u.score,
        })),
        skipped: true,
      });
      broadcastRoom(code);
    }

    cb && cb({ ok: true });
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
      r.paused = true;
      io.to(code).emit("buzzed", {
        id: r.buzzer.currentId,
        name: r.buzzer.currentName,
        at: r.buzzer.tsFirst,
      });
      io.to(code).emit("queueUpdated", {
        queue: r.buzzer.queue.map((p) => p.name),
      });
      await saveRoom(code, room);
      return cb && cb({ ok: true, first: true });
    }

    // Kolejne zgłoszenia -> do kolejki
    const isCurrent = r.buzzer.currentId === socket.id;
    const inQueue = r.buzzer.queue.some((p) => p.id === socket.id);
    if (!isCurrent && !inQueue) {
      r.buzzer.queue.push({ id: socket.id, name: player.name, ts: Date.now() });
      io.to(code).emit("queueUpdated", {
        queue: r.buzzer.queue.map((p) => p.name),
      });
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
      io.to(code).emit("queueUpdated", {
        queue: r.buzzer.queue.map((p) => p.name),
      });

      // ✅ WYMAGANIE: przy przejściu na kolejną osobę zatrzymać muzykę (osoba ta "wcisnęła" buzzer)
      io.to(code).emit("pausePlayback");
      r.paused = true;

      await saveRoom(code, room);
      return cb && cb({ ok: true, passed: true });
    } else {
      r.buzzer = null;
      io.to(code).emit("buzzCleared", {});
      io.to(code).emit("resumePlayback");
      r.paused = false;
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

  socket.on("pauseRound", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can pause the round." });

    room.currentRound.paused = true;
    io.to(code).emit("pausePlayback");
    await saveRoom(code, room);
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  socket.on("resumeRound", async ({ code }, cb) => {
    const room = await getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can resume the round." });

    room.currentRound.paused = false;
    io.to(code).emit("resumePlayback");
    await saveRoom(code, room);
    broadcastRoom(code);
    cb && cb({ ok: true });
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
