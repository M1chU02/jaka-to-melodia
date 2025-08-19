import React, { useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import YouTube from "react-youtube";
import { dictionaries, getInitialLang } from "./i18n.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

const socket = io(SERVER_URL, { transports: ["websocket"] });

function useSocketEvent(event, handler) {
  useEffect(() => {
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [event, handler]);
}

function Section({ title, children }) {
  return (
    <div style={{ padding: 16, marginBottom: 16, border: "1px solid #eee", borderRadius: 12 }}>
      <h2 style={{ margin: 0, marginBottom: 8 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState(getInitialLang());
  const dict = dictionaries[lang];
  useEffect(() => localStorage.setItem("lang", lang), [lang]);

  const [stage, setStage] = useState("welcome"); // welcome, lobby, playing
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [chatLog, setChatLog] = useState([]);

  // Playlist management (host)
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [parsed, setParsed] = useState(null); // response from /api/parse-playlist
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);

  // Round state
  const [round, setRound] = useState(null); // { mode, startedAt, hint, playback }
  const [guess, setGuess] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const audioRef = useRef(null);
  const ytRef = useRef(null);

  useSocketEvent("roomState", (payload) => setRoomState(payload));
  useSocketEvent("gameStarted", () => setStage("playing"));
  useSocketEvent("roundStart", (payload) => {
    setLastResult(null);
    setRound(payload);
    setGuess("");
    // Auto play when data arrives
    setTimeout(() => {
      if (payload.playback?.type === "audio" && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    }, 50);
  });
  useSocketEvent("roundEnd", (payload) => {
    setLastResult(payload);
    // Stop playback
    if (audioRef.current) audioRef.current.pause();
    if (ytRef.current) ytRef.current.internalPlayer?.stopVideo?.();
  });
  useSocketEvent("chat", (msg) => setChatLog((prev) => [...prev, msg]));

  function createRoom() {
    socket.emit("createRoom", ({ code }) => {
      setRoomCode(code);
      setIsHost(true);
      setStage("lobby");
      setName((n) => n || "Host");
      socket.emit("joinRoom", { code, name: name || "Host" }, () => {});
    });
  }

  function joinRoom() {
    if (!roomCode) return;
    socket.emit("joinRoom", { code: roomCode.toUpperCase(), name: name || "Gracz" }, (resp) => {
      if (resp?.error) return alert(resp.error);
      setRoomCode(roomCode.toUpperCase());
      setIsHost(resp.hostId === socket.id);
      setStage("lobby");
    });
  }

  async function parsePlaylist() {
    try {
      setLoadingPlaylist(true);
      const r = await fetch(`${SERVER_URL}/api/parse-playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Błąd pobierania playlisty.");
      setParsed(data);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }

  function startGame() {
    if (!parsed) return;
    socket.emit("startGame", { code: roomCode, mode: parsed.source, tracks: parsed.tracks }, (resp) => {
      if (resp?.error) return alert(resp.error);
    });
  }

  function nextRound() {
    socket.emit("nextRound", { code: roomCode }, (resp) => {
      if (resp?.error) return alert(resp.error);
    });
  }

  function sendGuess(e) {
    e.preventDefault();
    const txt = guess.trim();
    if (!txt) return;
    socket.emit("guess", { code: roomCode, guessText: txt }, (resp) => {
      if (resp?.error) return alert(resp.error);
      if (!resp.correct) {
        // optionally show feedback
      }
    });
    setGuess("");
  }

  function sendChat(e) {
    e.preventDefault();
    const input = e.target.elements.msg;
    const txt = input.value.trim();
    if (!txt) return;
    socket.emit("chat", { code: roomCode, name: name || "Gracz", text: txt });
    input.value = "";
  }

  const isSpotify = parsed?.source === "spotify";
  const isYouTube = parsed?.source === "youtube";

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", fontFamily: "ui-sans-serif, system-ui, Arial" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ marginBottom: 4 }}>{dict.title}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#555", fontSize: 14 }}>{dict.language}:</span>
          <select value={lang} onChange={e=>setLang(e.target.value)}>
            <option value="pl">{dict.polish}</option>
            <option value="en">{dict.english}</option>
          </select>
        </div>
      </div>
      <p style={{ marginTop: 0, color: "#555" }}>${dict.subtitle}</p>

      {stage === "welcome" && (
        <Section title="${dict.enterGame}">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="${dict.yourName}" value={name} onChange={e => setName(e.target.value)} />
            <input placeholder="${dict.roomCodePlaceholder}" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} />
            <button onClick={joinRoom}>${dict.join}</button>
            <span style={{ color: "#888" }}>${dict.or}</span>
            <button onClick={createRoom}>${dict.createRoom}</button>
          </div>
        </Section>
      )}

      {stage !== "welcome" && (
        <Section title={`${dict.room}: ${roomCode}`}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3>${dict.players}</h3>
              <ul>
                {roomState?.players?.map(p => (
                  <li key={p.name}>{p.name} — <b>{p.score}</b> pkt</li>
                ))}
              </ul>
            </div>
            <div style={{ flex: 2, minWidth: 320 }}>
              <h3>${dict.chat}</h3>
              <div style={{ border: "1px solid #eee", height: 160, overflow: "auto", borderRadius: 8, padding: 8, background: "#fafafa" }}>
                {chatLog.map((m, i) => (
                  <div key={i}><b>{m.name}:</b> {m.text}</div>
                ))}
              </div>
              <form onSubmit={sendChat} style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <input name="msg" placeholder="Napisz wiadomość..." style={{ flex: 1 }}/>
                <button type="submit">${dict.send}</button>
              </form>
            </div>
          </div>
        </Section>
      )}

      {stage === "lobby" && isHost && (
        <Section title="${dict.gameSettings}">
          <div style={{ display: "grid", gap: 8 }}>
            <input
              placeholder="Wklej link do playlisty Spotify ${dict.or} YouTube"
              value={playlistUrl}
              onChange={e => setPlaylistUrl(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={parsePlaylist} disabled={loadingPlaylist || !playlistUrl}>
                {loadingPlaylist ? "${dict.loading}" : "${dict.loadPlaylist}"}
              </button>
              {parsed && (
                <span style={{ color: "#333" }}>
                  ${dict.loaded}: <b>{parsed.total}</b> pozycji {parsed.source === "spotify" ? `(${dict.playable}: ${parsed.playable})` : ""}
                </span>
              )}
            </div>

            {parsed && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={startGame}>${dict.startGame}</button>
                <button onClick={nextRound}>${dict.nextRound}</button>
              </div>
            )}
            {!parsed && (
              <p style={{ color: "#666" }}>
                Uwaga: dla Spotify używamy 30‑sekundowych podglądów (preview). Dla YouTube wymagany jest klucz API po stronie serwera.
              </p>
            )}
          </div>
        </Section>
      )}

      {stage === "playing" && (
        <Section title="${dict.round}">
          {!round && isHost && (
            <button onClick={nextRound}>${dict.startRound}</button>
          )}
          {round && (
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  {dict.hint(round.hint?.titleLen, round.hint?.artistLen)}
                </div>
                {round.playback?.type === "audio" && (
                  <audio ref={audioRef} controls src={round.playback.previewUrl} style={{ marginTop: 8 }} />
                )}
                {round.playback?.type === "youtube" && (
                  <div style={{ marginTop: 8 }}>
                    <YouTube
                      videoId={round.playback.videoId}
                      opts={{ width: "0", height: "0", playerVars: { autoplay: 1 } }}
                      onReady={(e) => {
                        ytRef.current = e.target;
                        e.target.playVideo();
                      }}
                    />
                    <div style={{ fontSize: 12, color: "#888" }}>${dict.hiddenYT}</div>
                  </div>
                )}
              </div>

              <form onSubmit={sendGuess} style={{ display: "flex", gap: 8 }}>
                <input value={guess} onChange={e => setGuess(e.target.value)} placeholder="Twoja odpowiedź: tytuł ${dict.or} wykonawca..." style={{ flex: 1 }} />
                <button type="submit">${dict.guess}</button>
              </form>

              {lastResult && (
                <div style={{ padding: 12, background: "#f0fff4", border: "1px solid #baf2c1", borderRadius: 8 }}>
                  <b>{dict.winner(lastResult.winner, Math.round(lastResult.elapsedMs/100)/10)}</b><br/>
                  {dict.itWas(lastResult.answer.title, lastResult.answer.artist)}
                </div>
              )}

              {isHost && (
                <button onClick={nextRound}>${dict.nextRound}</button>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="${dict.instructions}">
        <ol>
          {dict.steps.map((s,i)=>(<li key={i}>{s}</li>))}
        </ol>
      </Section>
    </div>
  );
}
