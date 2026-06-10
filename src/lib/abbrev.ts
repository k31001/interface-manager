/**
 * Smart abbreviation for register/field names rendered in tight bit-map cells.
 *
 * Strategy, applied progressively until the name fits:
 *  1. full name
 *  2. de-vowel the longest tokens (keep first char of each token): TX_FIFO_THRESHOLD -> TX_FF_THRSH
 *  3. truncate tokens to short prefixes
 *  4. token initials: TFT
 */
const VOWELS = /[aeiouAEIOU]/g;

function devowel(token: string): string {
  if (token.length <= 3) return token;
  const head = token[0];
  const rest = token.slice(1).replace(VOWELS, "");
  return head + rest;
}

export function abbreviate(name: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (name.length <= maxChars) return name;

  const tokens = name.split("_");

  // pass 1: de-vowel longest tokens first
  let guard = 16;
  while (tokens.join("_").length > maxChars && guard-- > 0) {
    let idx = -1;
    let best = 0;
    tokens.forEach((t, i) => {
      const shrunk = devowel(t);
      if (shrunk.length < t.length && t.length > best) {
        best = t.length;
        idx = i;
      }
    });
    if (idx < 0) break;
    tokens[idx] = devowel(tokens[idx]);
  }
  if (tokens.join("_").length <= maxChars) return tokens.join("_");

  // pass 2: trim longest token by one char repeatedly (min 2 chars per token)
  guard = 64;
  while (tokens.join("_").length > maxChars && guard-- > 0) {
    let idx = -1;
    let best = 2;
    tokens.forEach((t, i) => {
      if (t.length > best) {
        best = t.length;
        idx = i;
      }
    });
    if (idx < 0) break;
    tokens[idx] = tokens[idx].slice(0, -1);
  }
  if (tokens.join("_").length <= maxChars) return tokens.join("_");

  // pass 3: drop separators
  const joined = tokens.join("");
  if (joined.length <= maxChars) return joined;

  // pass 4: initials
  const initials = name
    .split("_")
    .map((t) => t[0] ?? "")
    .join("");
  if (initials.length <= maxChars) return initials;

  return joined.slice(0, maxChars);
}
