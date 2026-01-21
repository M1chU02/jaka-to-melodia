export const dictionaries = {
  pl: {
    title: "Jaka to melodia",
    subtitle: "Gra muzyczna dla znajomych online",
    language: "Język",
    polish: "Polski",
    english: "Angielski",

    enterGame: "Wejdź do gry",
    yourName: "Twoje imię",
    roomCodePlaceholder: "Kod pokoju",
    join: "Dołącz",
    or: "lub",
    createRoom: "Stwórz pokój",

    room: "Pokój",
    players: "Gracze",
    chat: "Czat",
    send: "Wyślij",

    gameSettings: "Ustawienia gry",
    pastePlaylist: "Wklej link do playlisty (Spotify/YouTube)",
    loadPlaylist: "Wczytaj playlistę",
    loading: "Ładowanie...",
    loaded: "Wczytano",
    playable: "Odtwarzalne",
    note: "Najpierw wczytaj playlistę.",

    gameMode: "Tryb gry",
    textMode: "Tekstowy (zgaduj na czacie gry)",
    voiceMode: "Buzzer (odpowiedzi na komunikatorze głosowym)",

    startGame: "Rozpocznij grę",
    startRound: "Rozpocznij rundę",
    nextRound: "Następna runda",
    round: "Runda",

    hint: (t, a) => `Tytuł: ${t} znaków, Wykonawca: ${a} znaków`,
    yourAnswer: "Twoja odpowiedź...",
    guess: "Zgadnij",
    hiddenYT: "Ukryty odtwarzacz YouTube",

    winner: (name, sec) => `${name} odgadł w ${sec}s`,
    itWas: (title, artist) =>
      `To był utwór: "${title}" ${artist ? "— " + artist : ""}`,

    // Buzzer
    buzz: "Zgłaszam się!",
    firstBuzz: (name) => `Pierwszy zgłosił się: ${name}`,
    noBuzzYet: "Jeszcze nikt się nie zgłosił",
    awardPoints: "Przyznaj punkty",
    endRound: "Zakończ rundę",
    passToNext: "Dalej",
    queue: "Kolejka",
    choosePlayer: "Wybierz gracza",
    change: "Zmień",
    verifyTitle: "Weryfikacja odpowiedzi (Host)",
    artistLabel: "Wykonawca",
    titleLabel: "Tytuł",
    check: "Sprawdź",
    artistOk: "✅ Wykonawca OK",
    artistError: "❌ Wykonawca BŁĄD",
    titleOk: "✅ Tytuł OK",
    titleError: "❌ Tytuł BŁĄD",
    allCorrect: "Wszystko poprawne! Przyznaj punkty.",
    loginWithGoogle: "Zaloguj przez Google",
    logout: "Wyloguj",
    errorLogin: "Błąd podczas logowania przez Google",
    leaderboard: "Ranking graczy",
  },

  en: {
    title: "Name That Tune",
    subtitle: "Online music game for friends",
    language: "Language",
    polish: "Polish",
    english: "English",

    enterGame: "Enter the game",
    yourName: "Your name",
    roomCodePlaceholder: "Room code",
    join: "Join",
    or: "or",
    createRoom: "Create room",

    room: "Room",
    players: "Players",
    chat: "Chat",
    send: "Send",

    gameSettings: "Game settings",
    pastePlaylist: "Paste playlist link (Spotify/YouTube)",
    loadPlaylist: "Load playlist",
    loading: "Loading...",
    loaded: "Loaded",
    playable: "Playable",
    note: "Please load a playlist first.",

    gameMode: "Game mode",
    textMode: "Text (type your guess)",
    voiceMode: "Buzzer (answer on voice chat)",

    startGame: "Start game",
    startRound: "Start round",
    nextRound: "Next round",
    round: "Round",

    hint: (t, a) => `Title: ${t} letters, Artist: ${a} letters`,
    yourAnswer: "Your answer...",
    guess: "Guess",
    hiddenYT: "Hidden YouTube player",

    winner: (name, sec) => `${name} guessed in ${sec}s`,
    itWas: (title, artist) =>
      `It was: "${title}" ${artist ? "— " + artist : ""}`,

    // Buzzer
    buzz: "Buzz!",
    firstBuzz: (name) => `First buzz: ${name}`,
    noBuzzYet: "No buzz yet",
    awardPoints: "Award points",
    endRound: "End round",
    passToNext: "Pass to next",
    queue: "Queue",
    choosePlayer: "Choose player",
    change: "Change",
    verifyTitle: "Answer Verification (Host)",
    artistLabel: "Artist",
    titleLabel: "Title",
    check: "Check",
    artistOk: "✅ Artist OK",
    artistError: "❌ Artist ERROR",
    titleOk: "✅ Title OK",
    titleError: "❌ Title ERROR",
    allCorrect: "Everything correct! Award points.",
    loginWithGoogle: "Sign in with Google",
    logout: "Sign out",
    errorLogin: "Error during Google sign-in",
    leaderboard: "Leaderboard",
  },
};

export function getInitialLang() {
  return (
    localStorage.getItem("lang") ||
    (navigator.language.startsWith("pl") ? "pl" : "en")
  );
}
