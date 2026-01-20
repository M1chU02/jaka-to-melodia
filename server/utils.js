import stringSimilarity from "string-similarity";

export function normalize(str) {
  if (!str) return "";

  let s = str
    // Remove content inside parens/brackets first
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, " ")
    // Remove typical "junk" phrases
    .replace(/official\s*video|lyrics?|audio|remaster(ed)?|hd|hq|mv/gi, " ")
    .replace(/feat\.?|ft\.?|prod\.?|produced\s*by/gi, " ")
    // Convert to lowercase
    .toLowerCase();

  // Keep only letters (unicode), numbers and spaces, convert everything else to space
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

export function isGuessCorrect(guess, title, artist) {
  const g = normalize(guess);
  const t = normalize(title);
  const a = normalize(artist || "");

  if (!g) return false;

  // Simple includes checks
  if (t && (g.includes(t) || t.includes(g))) return true;
  if (a && (g.includes(a) || a.includes(g))) return true;

  // Let's also check if guess contains major tokens of title or artist
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

  // Fuzzy fallback
  const fuzzy = Math.max(
    t ? stringSimilarity.compareTwoStrings(g, t) : 0,
    a ? stringSimilarity.compareTwoStrings(g, a) : 0,
  );

  return fuzzy >= 0.65;
}

export function getDetailedMatch(
  guessArtist,
  guessTitle,
  targetArtist,
  targetTitle,
) {
  const normGA = normalize(guessArtist);
  const normGT = normalize(guessTitle);
  let normA = normalize(targetArtist || "");
  let normT = normalize(targetTitle || "");

  // Special logic for YouTube where Title often includes Artist: "Artist - Title"
  // If TargetTitle already contains TargetArtist, try to strip it for a cleaner comparison
  if (normT.startsWith(normA)) {
    let stripped = normT.slice(normA.length).trim();
    // If we have something left, it's likely the "real" title
    if (stripped.length > 2) {
      // We'll keep it as a backup or use it directly
    }
  }

  function check(guess, target, otherTarget) {
    if (!guess) return false;
    if (!target) return false;

    // Direct matches / substring
    if (guess === target) return true;
    if (guess.includes(target) || target.includes(guess)) return true;

    // Token overlap
    const gTokens = new Set(guess.split(" ").filter((x) => x.length > 2));
    const tTokens = new Set(target.split(" ").filter((x) => x.length > 2));

    if (gTokens.size > 0 && tTokens.size > 0) {
      const overlap = [...gTokens].filter((x) => tTokens.has(x)).length;
      if (overlap / gTokens.size >= 0.7 || overlap / tTokens.size >= 0.7)
        return true;
    }

    // Fuzzy fallback
    const fuzzy = stringSimilarity.compareTwoStrings(guess, target);
    if (fuzzy >= 0.7) return true;

    // Cross-check: If they accidentally put the artist in the title field or vice versa
    if (otherTarget) {
      const fuzzyOther = stringSimilarity.compareTwoStrings(
        guess,
        normalize(otherTarget),
      );
      if (fuzzyOther >= 0.8) return true;
    }

    return false;
  }

  const artistCorrect = check(normGA, normA, targetTitle);
  const titleCorrect = check(normGT, normT, targetArtist);

  return { artistCorrect, titleCorrect };
}
