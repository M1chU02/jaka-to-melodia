import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { fetchSpotifyPlaylistTracks, parseSpotifyPlaylistId } from "./spotify.js";
import { fetchYouTubePlaylist, parseYouTubePlaylistId } from "./youtube.js";
import { isGuessCorrect, normalize } from "./utils.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: process.env.CLIENT_ORIGIN?.split(",") || "*"
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN?.split(",") || "*" }
});

const PORT = process.env.PORT || 4000;

// ===== In-memory game state (for demo) =====
const rooms = new Map();
// room = {
//   code, hostId, users: Map(socketId => {name, score}), mode: 'spotify'|'youtube',
//   tracks: [ ... ], answersKnown: boolean,
//   currentRound: { startedAt, answer: {title, artist}, track: {...}, solved: false },
// }

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
    players: [...room.users.values()].map(u => ({ name: u.name, score: u.score })),
    hostId: room.hostId,
    hasTracks: !!(room.tracks && room.tracks.length),
    currentRound: room.currentRound ? {
      startedAt: room.currentRound.startedAt,
      solved: room.currentRound.solved,
    } : null
  };
  io.to(code).emit("roomState", payload);
}

// ===== REST: Parse + fetch playlists =====
app.post("/api/parse-playlist", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing playlist URL." });

    if (parseSpotifyPlaylistId(url)) {
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        return res.status(400).json({ error: "Spotify API is not configured on the server." });
      }
      const data = await fetchSpotifyPlaylistTracks({
        url,
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });
      return res.json(data);
    }

    if (parseYouTubePlaylistId(url)) {
      if (!process.env.YT_API_KEY) {
        return res.status(400).json({ error: "Missing YT_API_KEY for YouTube Data API." });
      }
      const data = await fetchYouTubePlaylist({
        url,
        apiKey: process.env.YT_API_KEY
      });
      return res.json(data);
    }

    return res.status(400).json({ error: "Unrecognized playlist type. Paste a Spotify or YouTube playlist link." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Server error while parsing playlist." });
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
      currentRound: null
    });
    socket.join(code);
    cb && cb({ code });
    broadcastRoom(code);
  });

  // Join room
  socket.on("joinRoom", ({ code, name }, cb) => {
    const room = getRoom(code);
    if (!room) {
      return cb && cb({ error: "Room does not exist." });
    }
    socket.join(code);
    room.users.set(socket.id, { name: name?.trim() || "Gracz", score: 0 });
    cb && cb({ ok: true, code, hostId: room.hostId });
    broadcastRoom(code);
  });

  // Leave room / disconnect
  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        if (room.hostId === socket.id) {
          // Transfer host if possible
          const first = [...room.users.keys()][0];
          room.hostId = first || null;
        }
        broadcastRoom(room.code);
      }
    }
  });

  // Load playlist (host only)
  socket.on("loadPlaylist", async ({ code, url }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id) return cb && cb({ error: "Only the host can load the playlist." });

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      // This fetch won't work here (server-side socket handler). We'll proxy via REST client call on frontend instead.
      // Safeguard: never used.
    } catch (e) {
      // noop
    }
    cb && cb({ error: "Use the REST endpoint /api/parse-playlist from the frontend." });
  });

  // Start game (host only)
  socket.on("startGame", ({ code, mode, tracks }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id) return cb && cb({ error: "Only the host can start the game." });
    if (!tracks || !tracks.length) return cb && cb({ error: "No tracks loaded." });

    room.mode = mode;
    room.tracks = tracks;
    room.answersKnown = true; // we fetched titles
    room.currentRound = null;
    io.to(code).emit("gameStarted", { mode });
    broadcastRoom(code);
    cb && cb({ ok: true });
  });

  // Next round (host only)
  socket.on("nextRound", ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ error: "Room does not exist." });
    if (room.hostId !== socket.id) return cb && cb({ error: "Only the host can start a round." });
    if (!room.tracks || !room.tracks.length) return cb && cb({ error: "No tracks available." });

    // pick a random track
    const pool = room.mode === "spotify"
      ? room.tracks.filter(t => t.previewUrl) // playable only
      : room.tracks;
    if (!pool.length) return cb && cb({ error: "No playable tracks (Spotify previews)." });

    const track = pool[Math.floor(Math.random() * pool.length)];
    room.currentRound = {
      startedAt: Date.now(),
      answer: { title: track.title, artist: track.artist || "" },
      track,
      solved: false
    };

    // Prepare client payload
    const payload = {
      mode: room.mode,
      startedAt: room.currentRound.startedAt,
      // Hints
      hint: {
        titleLen: track.title ? track.title.length : 0,
        artistLen: track.artist ? track.artist.length : 0
      },
      // Playback data
      playback: room.mode === "spotify"
        ? { type: "audio", previewUrl: track.previewUrl, cover: track.cover }
        : { type: "youtube", videoId: track.id },
    };

    io.to(code).emit("roundStart", payload);
    cb && cb({ ok: true });
  });

  // Guessing
  socket.on("guess", ({ code, guessText }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentRound) return cb && cb({ error: "Round is not active." });
    if (room.currentRound.solved) return cb && cb({ error: "Round is already finished." });

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
      scores: [...room.users.values()].map(u => ({ name: u.name, score: u.score }))
    });
    broadcastRoom(code);
    cb && cb({ ok: true, correct: true });
  });

  // Chat (optional)
  socket.on("chat", ({ code, name, text }) => {
    if (!getRoom(code)) return;
    io.to(code).emit("chat", { name, text, at: Date.now() });
  });
});

server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
