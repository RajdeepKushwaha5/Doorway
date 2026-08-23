/**
 * Turn an unknown value into something a person can read.
 *
 * `String(value)` is the obvious way and it is wrong for exactly one case,
 * which is the case that reaches a screen: an object stringifies to
 * "[object Object]". That is not an error anybody notices in review, it is a
 * line of output that looks like a rendering bug and hides whatever the value
 * actually was.
 *
 * Deliberately duplicated from the backend rather than shared through a
 * package. The two are separate deployables with separate builds, and a
 * workspace package for eight lines would cost more to understand than the
 * duplication does. If this ever grows a rule, it moves.
 *
 * Every call site here reads a value out of JSON that arrived from Bright
 * Data, from an incident record or from an event stream, where the type says
 * `unknown` because that is genuinely what it is.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    // Objects and arrays print as their JSON, which is the thing the reader
    // was actually looking for when the value turned out not to be a scalar.
    // JSON.stringify is typed as returning string, and returns undefined for
    // undefined, a function or a symbol. The type is wrong; the guard is not.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return JSON.stringify(value) ?? '';
  } catch {
    // Circular, or a BigInt inside. Naming the type beats "[object Object]".
    return `[${typeof value}]`;
  }
}
