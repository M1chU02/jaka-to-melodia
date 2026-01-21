import admin from "firebase-admin";

export async function updateLeaderboardScore(uid, name, scoreIncrement) {
  if (!admin.apps.length) return;
  const db = admin.firestore();
  const userRef = db.collection("leaderboard").doc(uid);

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) {
        t.set(userRef, {
          name,
          score: scoreIncrement,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        const newScore = (doc.data().score || 0) + scoreIncrement;
        t.update(userRef, {
          name,
          score: newScore,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (e) {
    console.error("Leaderboard update failed:", e);
  }
}

export async function getLeaderboard(limit = 10) {
  if (!admin.apps.length) return [];
  const db = admin.firestore();
  try {
    const snapshot = await db
      .collection("leaderboard")
      .orderBy("score", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));
  } catch (e) {
    console.error("Fetching leaderboard failed:", e);
    return [];
  }
}
