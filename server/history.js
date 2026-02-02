import admin from "firebase-admin";

export async function savePlaylistToHistory(uid, { url, name, source }) {
  if (!admin.apps.length) return;
  const db = admin.firestore();
  const userRef = db.collection("playlist_history").doc(uid);

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      let history = [];
      if (doc.exists) {
        history = doc.data().history || [];
      }

      // Remove current if exists (to move to top)
      history = history.filter((item) => item.url !== url);

      // Add to beginning
      history.unshift({
        url,
        name,
        source,
        lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Limit to 10 items
      if (history.length > 10) {
        history = history.slice(0, 10);
      }

      t.set(userRef, { history }, { merge: true });
    });
  } catch (e) {
    console.error("Failed to save playlist history:", e);
  }
}

export async function getPlaylistHistory(uid) {
  if (!admin.apps.length) return [];
  const db = admin.firestore();
  try {
    const doc = await db.collection("playlist_history").doc(uid).get();
    if (doc.exists) {
      return doc.data().history || [];
    }
    return [];
  } catch (e) {
    console.error("Failed to fetch playlist history:", e);
    return [];
  }
}
