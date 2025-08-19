import stringSimilarity from "string-similarity";

export function normalize(str) {
  if (!str) return "";
  // Remove text in parentheses/brackets, punctuation, common suffixes like " - Official Video"
  let s = str
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, " ")
    .replace(/official\s*video|lyrics?|audio|remaster(ed)?|hd|hq|mv/gi, " ")
    .replace(/feat\.?|ft\.?/gi, " ")
    .replace(/[\-_:;,.!?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s;
}

export function isGuessCorrect(guess, title, artist) {
  const g = normalize(guess);
  const t = normalize(title);
  const a = normalize(artist || "");

  if (!g) return false;

  // Strong direct hits
  if (t && g.includes(t)) return true;
  if (a && g.includes(a)) return true;

  // Token overlap
  const gTokens = new Set(g.split(" "));
  const tTokens = new Set(t.split(" "));
  const aTokens = new Set(a.split(" "));
  const overlapT = [...gTokens].filter(x => tTokens.has(x)).length;
  const overlapA = [...gTokens].filter(x => aTokens.has(x)).length;

  const scoreTokens = Math.max(
    tTokens.size ? overlapT / tTokens.size : 0,
    aTokens.size ? overlapA / aTokens.size : 0
  );

  // Fuzzy similarity
  const fuzzyTitle = t ? stringSimilarity.compareTwoStrings(g, t) : 0;
  const fuzzyArtist = a ? stringSimilarity.compareTwoStrings(g, a) : 0;
  const fuzzy = Math.max(fuzzyTitle, fuzzyArtist);

  // Decide with blended score
  return (scoreTokens >= 0.6) || (fuzzy >= 0.6);
}
