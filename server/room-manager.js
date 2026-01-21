import admin from "firebase-admin";

/**
 * structure of a room in Firestore:
 * {
 *   code: string,
 *   hostId: string (current socket id - transient),
 *   hostUid: string (persistent),
 *   mode: string,
 *   gameType: string,
 *   roundCount: number,
 *   tracks: [ ... ],
 *   answersKnown: boolean,
 *   currentRound: { ... },
 *   players: {
 *     [uid]: { name, score, photoURL }
 *   }
 * }
 */

export async function saveRoom(code, data) {
  if (!admin.apps.length) return;
  const db = admin.firestore();
  try {
    // Clean up data for Firestore (remove socket IDs, maps)
    const players = {};
    if (data.users && data.users instanceof Map) {
      for (let [sid, u] of data.users.entries()) {
        if (u.uid) players[u.uid] = { name: u.name, score: u.score };
      }
    } else if (data.players) {
      Object.assign(players, data.players);
    }

    const payload = {
      code,
      hostUid: data.hostUid || "",
      mode: data.mode || "spotify",
      gameType: data.gameType || "text",
      roundCount: data.roundCount || 0,
      tracks: data.tracks || [],
      answersKnown: !!data.answersKnown,
      currentRound: data.currentRound || null,
      players: players,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("rooms").doc(code).set(payload, { merge: true });
  } catch (e) {
    console.error("Failed to save room to Firestore:", e);
  }
}

export async function getRoomFromFirestore(code) {
  if (!admin.apps.length) return null;
  const db = admin.firestore();
  try {
    const doc = await db.collection("rooms").doc(code).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (e) {
    console.error("Failed to fetch room from Firestore:", e);
    return null;
  }
}

export async function deleteRoomFromFirestore(code) {
  if (!admin.apps.length) return;
  const db = admin.firestore();
  try {
    await db.collection("rooms").doc(code).delete();
  } catch (e) {
    console.error("Failed to delete room:", e);
  }
}
