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
    songCount: "Liczba piosenek",

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
    gameOver: "Koniec gry!",
    finalScores: "Wyniki końcowe:",
    returnHome: "Powrót do menu",
    endGame: "Zakończ grę i zobacz wyniki",
    skip: "Pomiń",
    skipStatus: (current, total) => `Pomiń (${current}/${total})`,
    kick: "Wyrzuć",
    kickedMessage: "Zostałeś wyrzucony z pokoju",
    pause: "Pause",
    resume: "Resume",
    recentPlaylists: "Ostatnio używane playlisty",
    noRecentPlaylists: "Brak ostatnio używanych playlist",
    selectRecentPlaylist: "Wybierz z ostatnio używanych...",
    about: "O grze",
    aboutTitle: "Jak to działa?",
    aboutDesc:
      "Stwórz pokój, zaproś znajomych i wczytaj dowolną playlistę ze Spotify lub YouTube. Gra automatycznie wyszuka utwory i pozwoli Wam rywalizować w zgadywaniu tytułów i wykonawców.",
    aboutRules:
      "Możesz grać w trybie tekstowym (pisanie odpowiedzi na czacie) lub 'Buzzer' (kto pierwszy się zgłosi, odpowiada głosem).",
    legalNotice: "Nota prawna",
    legalDesc:
      "To jest projekt fanowski i niekomercyjny. Wszystkie utwory muzyczne oraz materiały wideo należą do ich odpowiednich właścicieli i są odtwarzane za pośrednictwem oficjalnego API YouTube. Aplikacja nie przechowuje ani nie udostępnia plików muzycznych.",
    close: "Zamknij",
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
    songCount: "Number of songs",

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
    gameOver: "Game Over!",
    finalScores: "Final Scores:",
    returnHome: "Return Home",
    endGame: "End game and show results",
    skip: "Skip",
    skipStatus: (current, total) => `Skip (${current}/${total})`,
    kick: "Kick",
    kickedMessage: "You have been kicked from the room",
    pause: "Pause",
    resume: "Resume",
    recentPlaylists: "Recently used playlists",
    noRecentPlaylists: "No recently used playlists",
    selectRecentPlaylist: "Select from recently used...",
    about: "About",
    aboutTitle: "How it works?",
    aboutDesc:
      "Create a room, invite friends, and load any Spotify or YouTube playlist. The game will automatically search for tracks and let you compete in guessing titles and artists.",
    aboutRules:
      "You can play in Text mode (typing answers in chat) or 'Buzzer' mode (the first one to buzz in answers via voice).",
    legalNotice: "Legal Notice",
    legalDesc:
      "This is a fan-made, non-commercial project. All music tracks and video materials belong to their respective owners and are played via the official YouTube API. The application does not store or share music files.",
    close: "Close",
  },
};

export function getInitialLang() {
  try {
    return (
      localStorage.getItem("lang") ||
      (navigator.language.startsWith("pl") ? "pl" : "en")
    );
  } catch (e) {
    return navigator.language.startsWith("pl") ? "pl" : "en";
  }
}
