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
import { isGuessCorrect, normalize } from "./utils.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(",") || "*",
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(",") || "*" },
});

const PORT = process.env.PORT || 4000;

// ===== In-memory game state (for demo) =====
const rooms = new Map();
// room = {
//   code, hostId, users: Map(socketId => {name, score}), mode: 'spotify'|'youtube',
//   tracks: [ ... ], answersKnown: boolean,
//   currentRound: { startedAt, answer: {title, artist}, track: {...}, solved: false },
// }
async function buildPlaybackForTrack(track, mode) {
  // 1) Spotify preview dostępne — korzystamy
  if (mode === "spotify" && track.previewUrl) {
    return { type: "audio", previewUrl: track.previewUrl, cover: track.cover };
  }

  // 2) Fallback do YouTube (wymaga YT_API_KEY)
  if (process.env.YT_API_KEY && track.title) {
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
        }
      );
      const item = r.data.items?.[0];
      if (item?.id?.videoId) {
        return { type: "youtube", videoId: item.id.videoId };
      }
    } catch (e) {
      console.warn("YT fallback error:", e?.response?.data || e.message);
    }
  }

  // 3) Nic nie znaleziono
  return null;
}

function newRoomCode() {
  // 6-letter friendly code
  return nanoid(6).toUpperCase();
}

function getRoom(code) {
  return rooms.get(code);
}

function broadcastRoom(code) {
  const room = getRoom(code);
  if (!room) return;
  const payload = {
    code: room.code,
    mode: room.mode || null,
    players: [...room.users.values()].map((u) => ({
      name: u.name,
      score: u.score,
    })),
    hostId: room.hostId,
    hasTracks: !!(room.tracks && room.tracks.length),
    currentRound: room.currentRound
      ? {
          startedAt: room.currentRound.startedAt,
          solved: room.currentRound.solved,
        }
      : null,
  };
  io.to(code).emit("roomState", payload);
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

// ===== SOCKETS =====
io.on("connection", (socket) => {
  // Create room
  socket.on("createRoom", (cb) => {
    const code = newRoomCode();
    rooms.set(code, {
      code,
      hostId: socket.id,
      users: new Map(),
      mode: null,
      tracks: [],
      answersKnown: false,
      currentRound: null,
    });
    socket.join(code);
    cb && cb({ code });
    broadcastRoom(code);
  });

  // Join room
  socket.on("joinRoom", ({ code, name }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });

    const cleanName = (name || "").trim().slice(0, 32) || "Player";
    let finalName = cleanName;
    let i = 1;
    while ([...room.users.values()].some((u) => u.name === finalName)) {
      finalName = `${cleanName}#${i++}`;
    }

    room.users.set(socket.id, { name: finalName, score: 0 });

    socket.join(code);

    io.to(code).emit("chat", {
      system: true,
      text: `${finalName} joined the room`,
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

  // Load playlist (host only)
  socket.on("loadPlaylist", async ({ code, url }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can load the playlist." });

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      // This fetch won't work here (server-side socket handler). We'll proxy via REST client call on frontend instead.
      // Safeguard: never used.
    } catch (e) {
      // noop
    }
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

    // Unikalność (prosta) — dopisz sufiks, jeśli zajęte
    const taken = [...room.users.values()].some(
      (u) => u !== user && u.name === newName
    );
    user.name = taken
      ? `${newName}#${Math.floor(Math.random() * 99) + 1}`
      : newName;

    broadcastRoom(code);
    cb && cb({ ok: true, name: user.name });
  });

  // Start game (host only)
  socket.on("startGame", ({ code, mode, tracks, gameType }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can start the game." });
    if (!tracks || !tracks.length)
      return cb && cb({ error: "No tracks loaded." });

    room.mode = mode; // spotify | youtube
    room.gameType = gameType || "text"; // text | buzzer
    room.tracks = tracks;
    room.answersKnown = true;
    room.currentRound = null;
    io.to(code).emit("gameStarted", {
      mode: room.mode,
      gameType: room.gameType,
    });
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Next round (host only)
  socket.on("nextRound", async ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can start a round." });
    if (!room.tracks || !room.tracks.length)
      return cb && cb({ error: "No tracks available." });

    // Nie filtrujemy po preview — dajemy szansę fallbackowi do YT
    const pool = room.tracks.slice();
    let track = null,
      playback = null;

    // Kilka prób wylosowania czegoś, co da się odtworzyć
    for (let i = 0; i < Math.min(20, pool.length); i++) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      const pb = await buildPlaybackForTrack(candidate, room.mode);
      if (pb) {
        track = candidate;
        playback = pb;
        break;
      }
    }

    if (!track || !playback) {
      return cb && cb({ error: "No playable tracks (Spotify previews)." });
    }

    room.currentRound = {
      startedAt: Date.now(),
      answer: { title: track.title, artist: track.artist || "" },
      track,
      solved: false,
      buzzer: { winnerId: null, winnerName: null, ts: null },
    };

    const payload = {
      mode: room.mode,
      gameType: room.gameType,
      startedAt: room.currentRound.startedAt,
      hint: {
        titleLen: track.title?.length || 0,
        artistLen: track.artist?.length || 0,
      },
      playback,
    };

    io.to(code).emit("roundStart", payload);
    cb && cb({ ok: true });
  });

  // Guessing
  socket.on("guess", ({ code, guessText }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.currentRound.solved)
      return cb && cb({ error: "Round is already finished." });

    const { title, artist } = room.currentRound.answer;
    const correct = isGuessCorrect(guessText || "", title, artist);
    if (!correct) {
      // (Optional) echo wrong guess to all for fun (without text to avoid spoilers)
      return cb && cb({ ok: true, correct: false });
    }

    // Winner!
    room.currentRound.solved = true;
    const player = room.users.get(socket.id);
    if (player) player.score += 10;

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

  // Chat (optional)
  socket.on("chat", ({ code, name, text }) => {
    if (!getRoom(code)) return;
    io.to(code).emit("chat", { name, text, at: Date.now() });
  });

  socket.on("buzz", ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const r = room.currentRound;
    if (r.buzzer?.winnerId) {
      return cb && cb({ ok: false, reason: "Already buzzed" });
    }
    const player = room.users.get(socket.id);
    if (!player) return cb && cb({ error: "Player not in room." });

    r.buzzer = { winnerId: socket.id, winnerName: player.name, ts: Date.now() };
    io.to(code).emit("buzzed", { name: player.name, at: r.buzzer.ts });

    // NEW: zatrzymaj odtwarzanie u wszystkich
    io.to(code).emit("pausePlayback");

    cb && cb({ ok: true });
  });

  // Host awards points manually (buzzer mode)
  socket.on("awardPoints", ({ code, playerName, points }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can award points." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const entry = [...room.users.entries()].find(
      ([id, u]) => u.name === playerName
    );
    if (!entry) return cb && cb({ error: "Player not found." });
    entry[1].score += Number(points) || 0;
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  socket.on("deductPoints", ({ code, playerName, points }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can deduct points." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const entry = [...room.users.entries()].find(
      ([id, u]) => u.name === playerName
    );
    if (!entry) return cb && cb({ error: "Player not found." });

    entry[1].score -= Number(points) || 0;
    if (entry[1].score < 0) entry[1].score = 0; // nie schodzimy poniżej zera

    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Host ends round manually (buzzer mode)
  socket.on("endRoundManual", ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentRound)
      return cb && cb({ error: "Round is not active." });
    if (room.hostId !== socket.id)
      return cb && cb({ error: "Only the host can end the round." });
    if (room.gameType !== "buzzer")
      return cb && cb({ error: "Not in buzzer mode." });

    const { title, artist } = room.currentRound.answer;
    const elapsedMs = Date.now() - room.currentRound.startedAt;
    const winner = room.currentRound.buzzer?.winnerName || null;

    room.currentRound.solved = true;
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
});

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
