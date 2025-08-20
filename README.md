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
- Klucze API:
  - **Spotify**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (Client Credentials)
  - **YouTube Data API v3**: `YT_API_KEY` (dla playlist YouTube)

Have fun! 🎉
