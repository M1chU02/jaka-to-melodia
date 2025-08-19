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

function Section({ title, children, toolbar }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {toolbar}
      </div>
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
  const [parsed, setParsed] = useState(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);

  // Round state
  const [round, setRound] = useState(null);
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
    setTimeout(() => {
      if (payload.playback?.type === "audio" && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    }, 50);
  });
  useSocketEvent("roundEnd", (payload) => {
    setLastResult(payload);
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
    socket.emit(
      "joinRoom",
      { code: roomCode.toUpperCase(), name: name || "Gracz" },
      (resp) => {
        if (resp?.error) return alert(resp.error);
        setRoomCode(roomCode.toUpperCase());
        setIsHost(resp.hostId === socket.id);
        setStage("lobby");
      }
    );
  }

  async function parsePlaylist() {
    try {
      setLoadingPlaylist(true);
      const r = await fetch(`${SERVER_URL}/api/parse-playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error loading playlist.");
      setParsed(data);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }

  function startGame() {
    if (!parsed) return;
    socket.emit(
      "startGame",
      { code: roomCode, mode: parsed.source, tracks: parsed.tracks },
      (resp) => {
        if (resp?.error) return alert(resp.error);
      }
    );
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

  return (
    <div className="container">
      <div className="header">
        <h1 className="h1">🎵 {dict.title}</h1>
        <div className="row">
          <span className="kbd">{dict.language}:</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="pl">{dict.polish}</option>
            <option value="en">{dict.english}</option>
          </select>
        </div>
      </div>
      <p className="subtitle">{dict.subtitle}</p>

      {stage === "welcome" && (
        <Section title={dict.enterGame}>
          <div className="row">
            <input
              className="input"
              placeholder={dict.yourName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input"
              placeholder={dict.roomCodePlaceholder}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            />
            <button className="btn" onClick={joinRoom}>
              {dict.join}
            </button>
            <span className="badge">{dict.or}</span>
            <button className="btn secondary" onClick={createRoom}>
              {dict.createRoom}
            </button>
          </div>
        </Section>
      )}

      {stage !== "welcome" && (
        <Section title={`${dict.room}: ${roomCode}`}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3>{dict.players}</h3>
              <ul className="list">
                {roomState?.players?.map((p) => (
                  <li key={p.name}>
                    {p.name} — <b>{p.score}</b> pkt
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ flex: 2, minWidth: 320 }}>
              <h3>{dict.chat}</h3>
              <div className="chatbox">
                {chatLog.map((m, i) => (
                  <div key={i}>
                    <b>{m.name}:</b> {m.text}
                  </div>
                ))}
              </div>
              <form
                onSubmit={sendChat}
                className="row"
                style={{ marginTop: 8 }}>
                <input
                  className="input"
                  name="msg"
                  placeholder="Napisz wiadomość..."
                  style={{ flex: 1 }}
                />
                <button className="btn" type="submit">
                  {dict.send}
                </button>
              </form>
            </div>
          </div>
        </Section>
      )}

      {stage === "lobby" && isHost && (
        <Section title={dict.gameSettings}>
          <div className="grid">
            <input
              className="input"
              placeholder={dict.pastePlaylist}
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
            />
            <div className="row">
              <button
                className="btn"
                onClick={parsePlaylist}
                disabled={loadingPlaylist || !playlistUrl}>
                {loadingPlaylist ? dict.loading : dict.loadPlaylist}
              </button>
              {parsed && (
                <span className="badge">
                  {dict.loaded}: <b>{parsed.total}</b>{" "}
                  {parsed.source === "spotify"
                    ? `(${dict.playable}: ${parsed.playable})`
                    : ""}
                </span>
              )}
            </div>
            {parsed ? (
              <div className="row">
                <button className="btn" onClick={startGame}>
                  {dict.startGame}
                </button>
                <button className="btn ghost" onClick={nextRound}>
                  {dict.nextRound}
                </button>
              </div>
            ) : (
              <p className="badge">{dict.note}</p>
            )}
          </div>
        </Section>
      )}

      {stage === "playing" && (
        <Section title={dict.round}>
          {!round && isHost && (
            <button className="btn" onClick={nextRound}>
              {dict.startRound}
            </button>
          )}
          {round && (
            <div className="grid">
              <div>
                <div className="badge">
                  {dict.hint(round.hint?.titleLen, round.hint?.artistLen)}
                </div>
                {round.playback?.type === "audio" && (
                  <audio
                    className="audio"
                    ref={audioRef}
                    controls
                    src={round.playback.previewUrl}
                  />
                )}
                {round.playback?.type === "youtube" && (
                  <div>
                    <YouTube
                      videoId={round.playback.videoId}
                      opts={{
                        width: "0",
                        height: "0",
                        playerVars: { autoplay: 1 },
                      }}
                      onReady={(e) => {
                        ytRef.current = e.target;
                        e.target.playVideo();
                      }}
                    />
                    <div className="badge">{dict.hiddenYT}</div>
                  </div>
                )}
              </div>

              <form onSubmit={sendGuess} className="row">
                <input
                  className="input"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  placeholder={dict.yourAnswer}
                  style={{ flex: 1 }}
                />
                <button className="btn" type="submit">
                  {dict.guess}
                </button>
              </form>

              {lastResult && (
                <div
                  className="card"
                  style={{
                    borderColor: "rgba(16,185,129,.35)",
                    background:
                      "linear-gradient(180deg, rgba(16,185,129,.12), rgba(16,185,129,.06))",
                  }}>
                  <b>
                    {dict.winner(
                      lastResult.winner,
                      Math.round(lastResult.elapsedMs / 100) / 10
                    )}
                  </b>
                  <br />
                  {dict.itWas(
                    lastResult.answer.title,
                    lastResult.answer.artist
                  )}
                </div>
              )}

              {isHost && (
                <button className="btn ghost" onClick={nextRound}>
                  {dict.nextRound}
                </button>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title={dict.instructions}>
        <ol>
          {dict.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
