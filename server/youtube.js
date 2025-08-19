import axios from "axios";

export function parseYouTubePlaylistId(url) {
  // Accept: https://www.youtube.com/playlist?list=PLxxxx OR
  // https://youtube.com/playlist?list=... OR watch?v=...&list=...
  const u = new URL(url);
  const list = u.searchParams.get("list");
  if (list) return list;

  // youtu.be doesn't carry playlists typically, but guard anyway:
  const m = url.match(/list=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

export async function fetchYouTubePlaylist({ url, apiKey }) {
  const id = parseYouTubePlaylistId(url);
  if (!id) throw new Error("Nieprawidłowy link do playlisty YouTube.");

  // Page through playlistItems to get videoIds
  let videoIds = [];
  let pageToken = null;
  do {
    const resp = await axios.get("https://www.googleapis.com/youtube/v3/playlistItems", {
      params: {
        part: "contentDetails",
        maxResults: 50,
        playlistId: id,
        key: apiKey,
        pageToken: pageToken || undefined
      }
    });
    const items = resp.data.items || [];
    videoIds.push(...items.map(i => i.contentDetails.videoId).filter(Boolean));
    pageToken = resp.data.nextPageToken;
  } while (pageToken);

  // Fetch snippets in batches of 50 for titles/artists
  let tracks = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const resp = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "snippet",
        id: batch.join(","),
        key: apiKey
      }
    });
    const items = resp.data.items || [];
    tracks.push(...items.map(v => ({
      id: v.id,
      title: v.snippet.title,
      artist: v.snippet.channelTitle || "",
      cover: (v.snippet.thumbnails && (v.snippet.thumbnails.maxres?.url || v.snippet.thumbnails.high?.url || v.snippet.thumbnails.default?.url)) || null,
      source: "youtube"
    })));
  }

  return {
    source: "youtube",
    playlistId: id,
    total: tracks.length,
    tracks
  };
}
