import axios from "axios";

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getSpotifyToken(clientId, clientSecret) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({ grant_type: "client_credentials" }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(clientId + ":" + clientSecret).toString("base64"),
      },
    },
  );
  cachedToken = resp.data.access_token;
  tokenExpiresAt = now + resp.data.expires_in * 1000;
  return cachedToken;
}

export function parseSpotifyPlaylistId(url) {
  // Accepts formats like:
  // https://open.spotify.com/playlist/{id}
  // spotify:playlist:{id}
  const m1 = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)(\?|$)/);
  if (m1) return m1[1];
  const m2 = url.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (m2) return m2[1];
  return null;
}

export async function fetchSpotifyPlaylistTracks({
  url,
  clientId,
  clientSecret,
}) {
  const id = parseSpotifyPlaylistId(url);
  if (!id) throw new Error("Nieprawidłowy link do playlisty Spotify.");

  const token = await getSpotifyToken(clientId, clientSecret);

  // Fetch playlist info (for name)
  const playlistResp = await axios.get(
    `https://api.spotify.com/v1/playlists/${id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: "name" },
    },
  );
  const playlistName = playlistResp.data.name;

  // Fetch in pages
  let items = [];
  let next = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`;
  while (next) {
    const resp = await axios.get(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    items = items.concat(resp.data.items || []);
    next = resp.data.next;
  }

  // Normalize results; use preview_url when available
  const tracks = items
    .map((it) => it.track)
    .filter(Boolean)
    .map((t) => ({
      id: t.id,
      title: t.name,
      artist: (t.artists && t.artists.map((a) => a.name).join(", ")) || "",
      previewUrl: t.preview_url || null,
      cover:
        (t.album &&
          t.album.images &&
          t.album.images[0] &&
          t.album.images[0].url) ||
        null,
      source: "spotify",
    }));

  return {
    source: "spotify",
    playlistId: id,
    playlistName,
    total: tracks.length,
    playable: tracks.filter((t) => !!t.previewUrl).length,
    tracks,
  };
}
