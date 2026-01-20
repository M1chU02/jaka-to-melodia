import stringSimilarity from "string-similarity";

export function normalize(str) {
  if (!str) return "";

  let s = str
    // 1. Remove content inside parens/brackets first (e.g. "(prod. Rumak)")
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, " ")
    // 2. Remove typical "junk" phrases
    .replace(/official\s*video|lyrics?|audio|remaster(ed)?|hd|hq|mv/gi, " ")
    .replace(/feat\.?|ft\.?|prod\.?|produced\s*by/gi, " ")
    // 3. Convert to lowercase
    .toLowerCase();

  // 4. Keep only letters (unicode), numbers and spaces, convert everything else (punctuation) to space
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

  // 5. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Main function for automated guessing (text mode)
 */
export function isGuessCorrect(guess, title, artist) {
  const g = normalize(guess);
  const t = normalize(title);
  const a = normalize(artist || "");

  if (!g) return false;

  // Check if guess matches either normalized full title or artist
  if (t && (g.includes(t) || t.includes(g))) return true;
  if (a && (g.includes(a) || a.includes(g))) return true;

  // Token based check
  const gTokens = new Set(g.split(" ").filter((x) => x.length > 2));
  const tTokens = new Set(t.split(" ").filter((x) => x.length > 2));
  const aTokens = new Set(a.split(" ").filter((x) => x.length > 2));

  function hasHighOverlap(set1, set2) {
    if (set1.size === 0 || set2.size === 0) return false;
    const overlap = [...set1].filter((x) => set2.has(x)).length;
    return overlap / set1.size >= 0.7 || overlap / set2.size >= 0.7;
  }

  if (hasHighOverlap(gTokens, tTokens)) return true;
  if (hasHighOverlap(gTokens, aTokens)) return true;

  const fuzzy = Math.max(
    t ? stringSimilarity.compareTwoStrings(g, t) : 0,
    a ? stringSimilarity.compareTwoStrings(g, a) : 0,
  );

  return fuzzy >= 0.65;
}

/**
 * Detailed verification used by the Host in Buzzer Mode
 */
export function getDetailedMatch(
  guessArtist,
  guessTitle,
  targetArtist,
  targetTitle,
) {
  const normGA = normalize(guessArtist);
  const normGT = normalize(guessTitle);
  const normA = normalize(targetArtist || "");
  const normT = normalize(targetTitle || "");

  // Special logic: if the target title contains the artist's name (common on YouTube)
  // create a "clean" version of the title by removing the artist's name.
  // Example: targetTitle="Taco Hemingway - Deszcz na betonie", targetArtist="Taco Hemingway"
  // -> cleanT="Deszcz na betonie"
  let cleanT = normT;
  if (normA && normT.includes(normA)) {
    // Replace artist name only if it's a separate "word" or separated by junk
    // We'll just try stripping it globally and trimming
    cleanT = normT.replace(normA, "").trim();
  }

  function check(guess, primaryTarget, secondaryTarget, backupTarget) {
    if (!guess) return false;

    // Normalize targets again just in case (though they should be already)
    const t1 = normalize(primaryTarget);
    const t2 = normalize(secondaryTarget);
    const t3 = normalize(backupTarget);

    function isMatch(g, target) {
      if (!target) return false;
      if (g === target) return true;
      if (g.includes(target) || target.includes(g)) return true;

      // Token match
      const gTokens = g.split(" ").filter((x) => x.length > 2);
      const tTokens = target.split(" ").filter((x) => x.length > 2);
      if (gTokens.length > 0 && tTokens.length > 0) {
        const overlap = gTokens.filter((val) => tTokens.includes(val)).length;
        if (overlap / gTokens.length >= 0.7 || overlap / tTokens.length >= 0.7)
          return true;
      }

      // Fuzzy
      if (stringSimilarity.compareTwoStrings(g, target) >= 0.7) return true;
      return false;
    }

    if (isMatch(guess, t1)) return true;
    if (isMatch(guess, t2)) return true;
    if (isMatch(guess, t3)) return true;

    return false;
  }

  // Verify Artist: Check against Target Artist and Target Title (in case they swapped or it's mixed)
  const artistCorrect = check(normGA, normA, normT, targetTitle);

  // Verify Title: Check against normalized Title, "Cleaned" Title, and Target Artist (swap check)
  const titleCorrect = check(normGT, normT, cleanT, targetArtist);

  return { artistCorrect, titleCorrect };
}
