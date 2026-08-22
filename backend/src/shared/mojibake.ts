/**
 * Undo text that was decoded once with the wrong alphabet.
 *
 * A source page publishes UTF-8. Something between it and us read those bytes
 * as Windows-1252, so one apostrophe became three characters, and the result
 * is stored, indexed and served: "CPRG and AI4Indiaâ€™s
 * Transforming Society through AI Fellowship" is what a student was shown.
 *
 * It cannot be fixed upstream from here, and it should not be papered over in
 * the template either, because the damaged text is what gets searched and
 * matched, not only what gets displayed.
 *
 * The repair is the inverse of the mistake: map each character back to the
 * byte a Windows-1252 encoder would have produced, then decode those bytes as
 * the UTF-8 they always were. Refused unless the result is clean, so text that
 * merely contains an accented letter is returned untouched.
 */

/** The characters cp1252 puts in 0x80 to 0x9F, which latin-1 leaves empty. */
const CP1252_HIGH = new Map<number, number>([
  [0x0152, 0x8C],
  [0x0153, 0x9C],
  [0x0160, 0x8A],
  [0x0161, 0x9A],
  [0x0178, 0x9F],
  [0x017D, 0x8E],
  [0x017E, 0x9E],
  [0x0192, 0x83],
  [0x02C6, 0x88],
  [0x02DC, 0x98],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201A, 0x82],
  [0x201C, 0x93],
  [0x201D, 0x94],
  [0x201E, 0x84],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x2022, 0x95],
  [0x2026, 0x85],
  [0x2030, 0x89],
  [0x2039, 0x8B],
  [0x203A, 0x9B],
  [0x20AC, 0x80],
  [0x2122, 0x99],
]);

/** Sequences that only appear when UTF-8 has been read as a single-byte set. */
const SUSPICIOUS = /[ÂÃâ](?=[-¿–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŽžŸƒˆ˜])/;

export function repairMojibake(value: string): string {
  if (!SUSPICIOUS.test(value)) return value;

  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x100) {
      bytes.push(code);
      continue;
    }
    const mapped = CP1252_HIGH.get(code);
    // A character no single-byte encoder could have produced means this text
    // was never mis-decoded in the way we are assuming. Leave it alone.
    if (mapped === undefined) return value;
    bytes.push(mapped);
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
    // Only accept a repair that actually removed the damage.
    return SUSPICIOUS.test(decoded) ? value : decoded;
  } catch {
    // Not valid UTF-8, so the premise was wrong and the original stands.
    return value;
  }
}
