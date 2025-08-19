import React, { useEffect, useRef, useState } from "react";
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
  // ===== i18n =====
  const [lang, setLang] = useState(getInitialLang());
  const dict = dictionaries[lang];
  useEffect(() => localStorage.setItem("lang", lang), [lang]);

  // ===== Lobby / game state =====
  const [stage, setStage] = useState("welcome"); // welcome, lobby, playing
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [chatLog, setChatLog] = useState([]);

  // ===== Playlist (host) =====
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [parsed, setParsed] = useState(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);

  // ===== Round =====
  const [round, setRound] = useState(null);
  const [guess, setGuess] = useState("");
  const [lastResult, setLastResult] = useState(null);

  // ===== Game mode =====
  const [gameType, setGameType] = useState("text"); // "text" | "buzzer"
  const [firstBuzz, setFirstBuzz] = useState(null);

  // ===== Players (media refs) =====
  const audioRef = useRef(null);
  const ytRef = useRef(null);

  // ===== Volume / mute =====
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("volume"));
    return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 80;
  });
  const [muted, setMuted] = useState(false);
  useEffect(() => localStorage.setItem("volume", String(volume)), [volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume / 100;
  }, [volume, muted]);

  useEffect(() => {
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (!player?.setVolume) return;
    player.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  // ===== Sockets =====
  useSocketEvent("roomState", (payload) => setRoomState(payload));

  useSocketEvent("gameStarted", (payload) => {
    if (payload?.gameType) setGameType(payload.gameType);
    setStage("playing");
  });

  useSocketEvent("roundStart", (payload) => {
    setLastResult(null);
    setRound(payload);
    setGuess("");
    setFirstBuzz(null);
    if (payload.playback?.type === "audio" && audioRef.current) {
      setTimeout(() => {
        audioRef.current.currentTime = 0;
        audioRef.current.volume = muted ? 0 : volume / 100;
        audioRef.current.play().catch(() => {});
      }, 40);
    }
  });

  useSocketEvent("roundEnd", (payload) => {
    setLastResult(payload);
    setFirstBuzz(null);
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.stopVideo) player.stopVideo();
  });

  // pauza dla wszystkich po pierwszym „buzz”
  useSocketEvent("pausePlayback", () => {
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.pauseVideo) player.pauseVideo();
  });

  useSocketEvent("chat", (msg) => setChatLog((prev) => [...prev, msg]));
  useSocketEvent("buzzed", (payload) => setFirstBuzz(payload));

  // ===== Actions =====
  function goHome() {
    // prosty reset do ekranu powitalnego
    setStage("welcome");
    setRoomCode("");
    setParsed(null);
    setRound(null);
    setLastResult(null);
    setFirstBuzz(null);
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.stopVideo) player.stopVideo();
  }

  function createRoom() {
    socket.emit("createRoom", ({ code }) => {
      setRoomCode(code);
      setIsHost(true);
      setStage("lobby");
      // Ustal nazwę hosta jeśli puste pole
      const finalName = name?.trim() || "Host";
      setName(finalName);
      socket.emit("joinRoom", { code, name: finalName }, () => {});
    });
  }

  function joinRoom() {
    if (!roomCode) return;
    const finalName = name?.trim() || "Gracz";
    socket.emit(
      "joinRoom",
      { code: roomCode.toUpperCase(), name: finalName },
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
      {
        code: roomCode,
        mode: parsed.source,
        tracks: parsed.tracks,
        gameType,
      },
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

  function buzz() {
    socket.emit("buzz", { code: roomCode }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }

  function awardPoints(playerName) {
    socket.emit(
      "awardPoints",
      { code: roomCode, playerName, points: 10 },
      (resp) => {
        if (resp?.error) alert(resp.error);
      }
    );
  }

  function deductPoints(playerName) {
    socket.emit(
      "deductPoints",
      { code: roomCode, playerName, points: 10 },
      (resp) => {
        if (resp?.error) alert(resp.error);
      }
    );
  }

  function endRoundManual() {
    socket.emit("endRoundManual", { code: roomCode }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }

  function applyNewName() {
    const newName = name?.trim();
    if (!newName) return;
    if (!roomCode) return; // poza pokojem nie wysyłamy
    socket.emit("setName", { code: roomCode, name: newName }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <button className="logoBtn" onClick={goHome} title="Home">
          <span style={{ fontSize: 28 }}>🎵</span>
          <h1 className="h1">{dict.title}</h1>
        </button>
        <div className="row">
          <span className="kbd">{dict.language}:</span>
          <select
            className="select"
            value={lang}
            onChange={(e) => setLang(e.target.value)}>
            <option value="pl">{dict.polish}</option>
            <option value="en">{dict.english}</option>
          </select>
        </div>
      </div>
      <p className="subtitle">{dict.subtitle}</p>

      {/* Welcome */}
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

      {/* Lobby */}
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

              {/* Edycja własnej nazwy */}
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  className="input"
                  style={{ minWidth: 180 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={dict.yourName}
                />
                <button className="btn ghost" onClick={applyNewName}>
                  Zmień
                </button>
              </div>
            </div>

            <div style={{ flex: 2, minWidth: 320 }}>
              <h3>{dict.chat}</h3>
              <div className="chatbox">
                {chatLog.map((m, i) => (
                  <div key={i}>
                    {m.system ? (
                      <i style={{ color: "#9aa5b1" }}>{m.text}</i>
                    ) : (
                      <>
                        <b>{m.name}:</b> {m.text}
                      </>
                    )}
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
                  placeholder="..."
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

      {/* Host controls */}
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

            <div className="row">
              <span className="kbd">{dict.gameMode}:</span>
              <select
                className="select"
                value={gameType}
                onChange={(e) => setGameType(e.target.value)}>
                <option value="text">{dict.textMode}</option>
                <option value="buzzer">{dict.voiceMode}</option>
              </select>
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
              <p className="kbd">{dict.note}</p>
            )}
          </div>
        </Section>
      )}

      {/* Round */}
      {stage === "playing" && (
        <Section
          title={dict.round}
          toolbar={
            <div className="row">
              <button className="muteBtn" onClick={() => setMuted((m) => !m)}>
                {muted ? "🔇" : "🔊"}
              </button>
              <input
                className="range"
                type="range"
                min="0"
                max="100"
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(Number(e.target.value));
                }}
              />
              <span className="kbd">{muted ? 0 : volume}%</span>
            </div>
          }>
          {!round && isHost && (
            <button className="btn" onClick={nextRound}>
              {dict.startRound}
            </button>
          )}

          {round && (
            <div className="grid">
              <div>
                <div className="kbd">
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
                        e.target.setVolume(muted ? 0 : volume);
                        e.target.playVideo();
                      }}
                    />
                    <div className="kbd">{dict.hiddenYT}</div>
                  </div>
                )}
              </div>

              {gameType === "text" ? (
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
              ) : (
                <div className="grid">
                  <div className="card">
                    {firstBuzz?.name ? (
                      <b>{dict.firstBuzz(firstBuzz.name)}</b>
                    ) : (
                      <span className="kbd">{dict.noBuzzYet}</span>
                    )}
                  </div>
                  <div className="row">
                    <button className="btn" onClick={buzz}>
                      {dict.buzz}
                    </button>
                  </div>
                  {isHost && (
                    <div className="row" style={{ alignItems: "center" }}>
                      <span className="kbd">{dict.awardPoints}:</span>
                      <select id="award-select" className="select">
                        {(roomState?.players || []).map((p) => (
                          <option
                            key={p.name}
                            value={p.name}
                            selected={firstBuzz?.name === p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn"
                        onClick={() => {
                          const sel = document.getElementById("award-select");
                          if (sel?.value) awardPoints(sel.value);
                        }}>
                        +10
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          const sel = document.getElementById("award-select");
                          if (sel?.value) deductPoints(sel.value);
                        }}>
                        -10
                      </button>
                      <button className="btn ghost" onClick={endRoundManual}>
                        {dict.endRound}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {lastResult && (
                <div className="card">
                  <b>
                    {lastResult.winner
                      ? dict.winner(
                          lastResult.winner,
                          Math.round(lastResult.elapsedMs / 100) / 10
                        )
                      : ""}
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
    </div>
  );
}
