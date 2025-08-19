# 🎵 Name That Tune — multiplayer (Spotify/YouTube)

Full (frontend + backend) "Name That Tune" game na podstawie playlist ze Spotify lub YouTube, z rozgrywką online w czasie rzeczywistym.

## Features
- Wklej link do playlisty **Spotify** lub **YouTube**
- Losowy utwór w każdej rundzie
- Odtwarzanie:
  - Spotify: 30‑sekundowe **preview_url** (bez konta premium)
  - YouTube: odtwarzanie przez ukryty **YouTube IFrame**
- Multiplayer online (Socket.IO): pokoje, zgadywanie na czas, tabela wyników
- Fuzzy‑matching odpowiedzi (wybacza literówki)

## Requirements
- Node.js 18+
- Klucze API (ustaw w `server/.env`):
  - **Spotify**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (Client Credentials)
  - **YouTube Data API v3**: `YT_API_KEY` (dla playlist YouTube)

> Uwaga: Spotify API zwraca `preview_url` tylko dla części utworów. Aplikacja filtruje tylko te, które mają podgląd.

## Quick start (dev)
W dwóch terminalach:

### 1) Serwer
```bash
cd server
cp .env.example .env
# Uzupełnij .env
npm install
npm run start
```
Serwer nasłuchuje na `http://localhost:4000`.

### 2) Klient
```bash
cd client
cp .env.example .env
# ew. zmień VITE_SERVER_URL jeśli nie jest localhost:4000
npm install
npm run dev
```
Wejdź na `http://localhost:5173`.

## How to play
1. Host tworzy pokój i kopiuje kod.
2. Host wkleja link do playlisty i klika **Wczytaj playlistę**.
3. **Start gry** -> **Następna runda** — odtwarzanie zaczyna się u wszystkich.
4. Gracze wpisują odpowiedzi (tytuł lub wykonawca). Pierwsza poprawna odpowiedź wygrywa rundę (+10 pkt).

## Deploy (opcjonalnie)
- Zbuduj frontend: `npm run build` w katalogu `client` i serwuj statycznie (np. Netlify).
- Backend hostuj np. na Railway/Render/Heroku; ustaw `CLIENT_ORIGIN` na domenę frontendu.

## Security & limitations
- Stan gry trzymany w pamięci serwera (demo). Do produkcji użyj bazy danych/Redis.
- YouTube wymaga `YT_API_KEY` do pobrania listy i tytułów. Odtwarzanie odbywa się po stronie klienta przez IFrame.
- Reguły kompatybilności API mogą się zmieniać; sprawdzaj limity i warunki użycia YouTube/Spotify.

Have fun! 🎉
