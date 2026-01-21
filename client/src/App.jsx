import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import YouTube from "react-youtube";
import { dictionaries, getInitialLang } from "./i18n.js";
import CustomSelect from "./components/CustomSelect.jsx";
import { auth, googleProvider } from "./firebase.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const socket = io(SERVER_URL, { transports: ["websocket"] });

function useSocketEvent(event, handler) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const fn = (...args) => handlerRef.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [event]);
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
  const dict = dictionaries[lang] || dictionaries.pl;
  useEffect(() => {
    try {
      localStorage.setItem("lang", lang);
    } catch (e) {}
  }, [lang]);

  // ===== Lobby / game state =====
  const [stage, setStage] = useState("welcome"); // welcome, lobby, playing
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  const [user, setUser] = useState(null);

  // Monitor auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setName(u.displayName);
      }
    });
    return () => unsub();
  }, []);

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
  const [buzzQueue, setBuzzQueue] = useState([]);

  // ===== Award panel (host) =====
  const [awardPlayer, setAwardPlayer] = useState("");
  const [hostArtist, setHostArtist] = useState("");
  const [hostTitle, setHostTitle] = useState("");
  const [verifyStatus, setVerifyStatus] = useState(null); // { artist: bool, title: bool }
  const [leaderboard, setLeaderboard] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ===== Players (media refs) =====
  const audioRef = useRef(null);
  const ytRef = useRef(null);

  // ===== Volume / mute =====
  const [volume, setVolume] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("volume"));
      return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 80;
    } catch (e) {
      return 80;
    }
  });
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("volume", String(volume));
    } catch (e) {}
  }, [volume]);

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
  useSocketEvent("roomState", (payload) => {
    setRoomState(payload);
    if (payload.hostId) {
      setIsHost(payload.hostId === socket.id);
    }
    if (payload.gameType) setGameType(payload.gameType);

    // Sync stage and round if game is ongoing
    if (payload.gameStarted) {
      if (stage !== "playing") setStage("playing");

      if (payload.currentRound && !payload.currentRound.solved) {
        const cur = payload.currentRound;
        const curPb = cur.playback;
        const oldPb = round?.playback;

        if (
          !round ||
          curPb?.previewUrl !== oldPb?.previewUrl ||
          curPb?.videoId !== oldPb?.videoId
        ) {
          setRound(cur);
        }

        // Also sync buzzer state
        if (cur.buzzer) {
          if (firstBuzz?.id !== cur.buzzer.currentId) {
            setFirstBuzz({
              id: cur.buzzer.currentId,
              name: cur.buzzer.currentName,
            });
          }
          const newQ = cur.buzzer.queue || [];
          if (buzzQueue.length !== newQ.length) {
            setBuzzQueue(newQ);
          }
        }
      } else if (round) {
        setRound(null);
      }
    } else {
      // Game not started (lobby)
      if (stage !== "lobby" && stage !== "welcome") {
        setStage("lobby");
      } else if (stage === "welcome" && payload.players?.length > 0) {
        // Technically joinRoom callback handles this, but sync it here too if needed
        // (Only if we are sure we are in the room - denoted by presence in players or just having roomState)
        setStage("lobby");
      }
    }
  });

  useSocketEvent("gameStarted", (payload) => {
    if (payload?.gameType) setGameType(payload.gameType);
    setStage("playing");
  });

  useSocketEvent("roundStart", (payload) => {
    setLastResult(null);
    setRound(payload);
    setGuess("");
    setFirstBuzz(null);
    setBuzzQueue([]);
    setHostArtist("");
    setHostTitle("");
    setVerifyStatus(null);
    if (payload.playback?.type === "audio" && audioRef.current) {
      setTimeout(() => {
        audioRef.current.currentTime = 0;
        audioRef.current.volume = muted ? 0 : volume / 100;
        audioRef.current.play().catch(() => {});
      }, 40);
    }
  });

  useSocketEvent("gameOver", (payload) => {
    setLastResult(null);
    setRound(null);
    setStage("gameOver");
    setRoomState((prev) => ({ ...prev, players: payload.scores }));
  });

  useSocketEvent("roundEnd", (payload) => {
    setLastResult(payload);
    setFirstBuzz(null);
    setBuzzQueue([]);
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.stopVideo) player.stopVideo();
  });

  // pause everyones player after first „buzz”
  useSocketEvent("pausePlayback", () => {
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.pauseVideo) player.pauseVideo();
  });

  useSocketEvent("resumePlayback", () => {
    if (audioRef.current) audioRef.current.play().catch(() => {});
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.playVideo) player.playVideo();
  });

  useSocketEvent("chat", (msg) => setChatLog((prev) => [...prev, msg]));
  useSocketEvent("buzzed", (payload) => setFirstBuzz(payload));
  useSocketEvent("queueUpdated", (payload) =>
    setBuzzQueue(payload.queue || []),
  );
  useSocketEvent("buzzCleared", () => {
    setFirstBuzz(null);
    setBuzzQueue([]);
    setBuzzQueue([]);
  });

  useEffect(() => {
    const players = roomState?.players || [];
    if (!players.length) {
      setAwardPlayer("");
      return;
    }
    if (firstBuzz?.name) {
      setAwardPlayer(firstBuzz.name);
      return;
    }
    if (!players.some((p) => p.name === awardPlayer)) {
      setAwardPlayer(players[0].name);
    }
  }, [roomState?.players, firstBuzz]);

  // ===== Actions =====
  function goHome() {
    setStage("welcome");
    setRoomCode("");
    setChatLog([]);
    setParsed(null);
    setRound(null);
    setLastResult(null);
    setFirstBuzz(null);
    setBuzzQueue([]);
    if (audioRef.current) audioRef.current.pause();
    const player = ytRef.current?.internalPlayer || ytRef.current;
    if (player?.stopVideo) player.stopVideo();
  }

  function createRoom() {
    socket.emit("createRoom", async ({ code }) => {
      setRoomCode(code);
      setIsHost(true);
      setStage("lobby");
      setChatLog([]);
      const finalName = name?.trim() || user?.displayName || "Host";
      setName(finalName);

      const token = user ? await user.getIdToken() : null;
      socket.emit("joinRoom", { code, name: finalName, token }, () => {});
    });
  }

  async function login() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      setName(result.user.displayName);
    } catch (e) {
      console.error(e);
      alert(dict.errorLogin || "Błąd logowania");
    }
  }

  async function logout() {
    await signOut(auth);
    setUser(null);
  }

  async function joinRoom() {
    if (!roomCode) return;
    const finalName = name?.trim() || user?.displayName || "Gracz";
    const token = user ? await user.getIdToken() : null;
    socket.emit(
      "joinRoom",
      { code: roomCode.toUpperCase(), name: finalName, token },
      (resp) => {
        if (resp?.error) return alert(resp.error);
        setChatLog([]);
        setRoomCode(roomCode.toUpperCase());
        setIsHost(resp.hostId === socket.id);

        setStage((prev) => {
          if (prev === "welcome") return "lobby";
          return prev;
        });
      },
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
      },
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

  function passBuzzer() {
    socket.emit("passBuzzer", { code: roomCode }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }
  function awardPoints(playerName, pts) {
    socket.emit(
      "awardPoints",
      { code: roomCode, playerName, points: pts },
      (resp) => {
        if (resp?.error) alert(resp.error);
      },
    );
  }

  function deductPoints(playerName, pts) {
    socket.emit(
      "deductPoints",
      { code: roomCode, playerName, points: pts },
      (resp) => {
        if (resp?.error) alert(resp.error);
      },
    );
  }

  function endRoundManual() {
    socket.emit("endRoundManual", { code: roomCode }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }

  function verifyHostGuess(e) {
    if (e) e.preventDefault();
    socket.emit(
      "hostVerifyGuess",
      { code: roomCode, artist: hostArtist, title: hostTitle },
      (resp) => {
        if (resp?.error) return alert(resp.error);
        setVerifyStatus({
          artist: resp.artistCorrect,
          title: resp.titleCorrect,
        });

        if (!resp.artistCorrect && !resp.titleCorrect) {
          setHostArtist("");
          setHostTitle("");
          setTimeout(() => setVerifyStatus(null), 3000);
        }
      },
    );
  }

  function applyNewName() {
    const newName = name?.trim();
    if (!newName || !roomCode) return;
    socket.emit("setName", { code: roomCode, name: newName }, (resp) => {
      if (resp?.error) alert(resp.error);
    });
  }

  // ===== Options for CustomSelects =====
  const langOptions = [
    { value: "pl", label: dict.polish },
    { value: "en", label: dict.english },
  ];
  const modeOptions = [
    { value: "text", label: dict.textMode },
    { value: "buzzer", label: dict.voiceMode },
  ];
  const playerOptions = (roomState?.players || []).map((p) => ({
    value: p.name,
    label: p.name,
  }));

  async function fetchLeaderboard() {
    try {
      const r = await fetch(`${SERVER_URL}/api/leaderboard`);
      const data = await r.json();
      setLeaderboard(data);
      setShowLeaderboard(true);
    } catch (e) {
      console.error(e);
    }
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
          <CustomSelect
            options={langOptions}
            value={lang}
            onChange={(val) => setLang(val)}
          />
          <button className="btn ghost" onClick={fetchLeaderboard}>
            🏆 {dict.leaderboard || "Ranking"}
          </button>
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
              autoComplete="off"
            />
            <input
              className="input"
              placeholder={dict.roomCodePlaceholder}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              autoComplete="off"
            />
            <button className="btn" onClick={joinRoom}>
              {dict.join}
            </button>
            <span className="badge">{dict.or}</span>
            <button className="btn secondary" onClick={createRoom}>
              {dict.createRoom}
            </button>
          </div>

          <div
            className="row"
            style={{ marginTop: 24, justifyContent: "center" }}>
            {user ? (
              <div className="row">
                <img
                  src={user.photoURL}
                  style={{ width: 32, height: 32, borderRadius: "50%" }}
                  alt="avatar"
                />
                <span className="kbd">{user.displayName}</span>
                <button className="btn ghost" onClick={logout}>
                  {dict.logout || "Wyloguj"}
                </button>
              </div>
            ) : (
              <button
                className="btn"
                onClick={login}
                style={{ backgroundColor: "#4285f4" }}>
                <span style={{ marginRight: 8 }}>G</span>{" "}
                {dict.loginWithGoogle || "Zaloguj przez Google"}
              </button>
            )}
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
                  autoComplete="off"
                />
                <button className="btn ghost" onClick={applyNewName}>
                  {dict.change}
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
              <CustomSelect
                options={modeOptions}
                value={gameType}
                onChange={setGameType}
              />
            </div>

            {parsed ? (
              <div className="row">
                <button className="btn" onClick={startGame}>
                  {dict.startGame}
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
          title={`${dict.round} ${roomState?.roundCount || 0}/20`}
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
                    autoComplete="off"
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

                    {buzzQueue.length > 0 && (
                      <div className="kbd" style={{ marginTop: 8 }}>
                        {dict.queue}: {buzzQueue.join(", ")}
                      </div>
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
                      <CustomSelect
                        options={playerOptions}
                        value={awardPlayer}
                        onChange={setAwardPlayer}
                      />
                      <button
                        className="btn"
                        onClick={() => awardPoints(awardPlayer, 5)}>
                        +5
                      </button>
                      <button
                        className="btn"
                        onClick={() => awardPoints(awardPlayer, 10)}>
                        +10
                      </button>
                      <button
                        className="btn"
                        onClick={() => deductPoints(awardPlayer, 5)}>
                        -5
                      </button>
                      <button
                        className="btn"
                        onClick={() => deductPoints(awardPlayer, 10)}>
                        -10
                      </button>
                      <button className="btn" onClick={passBuzzer}>
                        {dict.passToNext}
                      </button>
                      <button className="btn ghost" onClick={endRoundManual}>
                        {dict.endRound}
                      </button>
                    </div>
                  )}

                  {isHost && (
                    <form
                      onSubmit={verifyHostGuess}
                      className="card"
                      style={{ marginTop: 12 }}>
                      <h4 style={{ margin: "0 0 8px 0" }}>
                        {dict.verifyTitle}
                      </h4>
                      <div className="row">
                        <input
                          className="input"
                          placeholder={dict.artistLabel}
                          value={hostArtist}
                          onChange={(e) => setHostArtist(e.target.value)}
                          style={{ flex: 1 }}
                          autoComplete="off"
                        />
                        <input
                          className="input"
                          placeholder={dict.titleLabel}
                          value={hostTitle}
                          onChange={(e) => setHostTitle(e.target.value)}
                          style={{ flex: 1 }}
                          autoComplete="off"
                        />
                        <button className="btn" type="submit">
                          {dict.check}
                        </button>
                      </div>
                      {verifyStatus && (
                        <div style={{ marginTop: 8 }}>
                          <span
                            style={{
                              color: verifyStatus.artist
                                ? "#48bb78"
                                : "#f56565",
                              marginRight: 12,
                            }}>
                            {verifyStatus.artist
                              ? dict.artistOk
                              : dict.artistError}
                          </span>
                          <span
                            style={{
                              color: verifyStatus.title ? "#48bb78" : "#f56565",
                            }}>
                            {verifyStatus.title
                              ? dict.titleOk
                              : dict.titleError}
                          </span>
                          {verifyStatus.artist && verifyStatus.title && (
                            <p
                              style={{
                                color: "#48bb78",
                                margin: "4px 0 0 0",
                                fontWeight: "bold",
                              }}>
                              {dict.allCorrect}
                            </p>
                          )}
                        </div>
                      )}
                    </form>
                  )}
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
                      Math.round(lastResult.elapsedMs / 100) / 10,
                    )
                  : ""}
              </b>
              <br />
              {dict.itWas(lastResult.answer.title, lastResult.answer.artist)}
            </div>
          )}

          {isHost && (
            <button className="btn ghost" onClick={nextRound}>
              {roomState?.roundCount === 20
                ? dict.endGame || "Zakończ grę"
                : dict.nextRound}
            </button>
          )}
        </Section>
      )}

      {/* Game Over */}
      {stage === "gameOver" && (
        <Section title={dict.gameOver || "Koniec gry"}>
          <div className="grid">
            <h3>{dict.finalScores || "Wyniki końcowe"}</h3>
            <ul className="list">
              {roomState?.players
                ?.sort((a, b) => b.score - a.score)
                .map((p, idx) => (
                  <li
                    key={p.name}
                    style={{
                      fontSize: idx === 0 ? "1.4em" : "1em",
                      fontWeight: idx === 0 ? "bold" : "normal",
                    }}>
                    {idx === 0 ? "👑 " : ""}
                    {p.name} — {p.score} pkt
                  </li>
                ))}
            </ul>
            <button className="btn" onClick={goHome}>
              {dict.returnHome || "Powrót"}
            </button>
          </div>
        </Section>
      )}

      {/* Leaderboard Section */}
      {showLeaderboard && (
        <Section
          title={dict.leaderboard || "Ranking"}
          toolbar={
            <button
              className="btn ghost"
              onClick={() => setShowLeaderboard(false)}>
              X
            </button>
          }>
          {leaderboard.length === 0 ? (
            <p className="kbd">Ranking jest pusty lub brak połączenia...</p>
          ) : (
            <ul className="list">
              {leaderboard.map((entry, idx) => (
                <li
                  key={entry.uid}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid #323f4b",
                  }}>
                  <span>
                    {idx + 1}. {entry.name}
                  </span>
                  <b>{entry.score} pkt</b>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
