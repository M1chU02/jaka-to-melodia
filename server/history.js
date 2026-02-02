import admin from "firebase-admin";
import crypto from "crypto";

// Helper to create a stable ID for a user-playlist combination
function getPlaylistDocId(uid, url) {
  const hash = crypto.createHash("md5").update(url).digest("hex");
  return `${uid}_${hash}`;
}

export async function savePlaylistToHistory(uid, { url, name, source }) {
  if (!admin.apps.length) return;

  console.log(`Saving playlist to history: ${name} for user ${uid}`);
  const db = admin.firestore();
  const docId = getPlaylistDocId(uid, url);
  const playRef = db.collection("user_playlists").doc(docId);

  try {
    await playRef.set(
      {
        uid,
        url,
        name,
        source,
        lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`Successfully saved playlist document: ${docId}`);
  } catch (e) {
    console.error("Failed to save playlist to history:", e);
  }
}

export async function getPlaylistHistory(uid) {
  if (!admin.apps.length) return [];
  const db = admin.firestore();
  try {
    const snapshot = await db
      .collection("user_playlists")
      .where("uid", "==", uid)
      .limit(50)
      .get();

    const history = snapshot.docs.map((doc) => ({
      ...doc.data(),
    }));

    // Sort in memory to avoid index requirement
    history.sort((a, b) => {
      const tsA = a.lastUsed?.toMillis?.() || a.lastUsed || 0;
      const tsB = b.lastUsed?.toMillis?.() || b.lastUsed || 0;
      return tsB - tsA;
    });

    const limitedHistory = history.slice(0, 10);
    console.log(
      `Fetched ${limitedHistory.length} playlist items for user ${uid}`,
    );
    return limitedHistory;
  } catch (e) {
    console.error("Failed to fetch playlist history:", e);
    return [];
  }
}
