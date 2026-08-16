/**
 * Field-path resolution.
 *
 * Collector output is nested (`price.value`, `seller.name`) and every contract,
 * check result and repair prompt refers to fields by dotted path. Doing this
 * with `eval` or by splitting on `.` and indexing blindly is how a malformed
 * row becomes a crash in the validator, so resolution is total and returns a
 * miss rather than throwing.
 */

/** Distinguishes "the field is absent" from "the field is present and null". */
export type PathLookup =
  | { found: true; value: unknown }
  | { found: false };

/**
 * Read a dotted path out of a record.
 *
 * Supports numeric segments for array access, so `images.0.url` works.
 */
export function getPath(source: unknown, path: string): PathLookup {
  if (path === '') return { found: false };

  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return { found: false };

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false };
      }
      current = current[index];
      continue;
    }

    if (typeof current !== 'object') return { found: false };

    const record = current as Record<string, unknown>;
    if (!Object.hasOwn(record, segment)) return { found: false };
    current = record[segment];
  }

  return { found: true, value: current };
}

/**
 * Enumerate every leaf path in a record.
 *
 * Used when learning a baseline from runs whose schema was never declared.
 * Arrays collapse to a single `[]` segment rather than expanding per index,
 * because `images.0.url` and `images.7.url` are the same field and profiling
 * them separately would produce hundreds of one-sample distributions.
 */
export function leafPaths(source: unknown, prefix = '', maxDepth = 8): string[] {
  if (maxDepth < 0) return [];
  if (source === null || source === undefined) return prefix === '' ? [] : [prefix];

  if (Array.isArray(source)) {
    const collapsed = prefix === '' ? '[]' : `${prefix}.[]`;
    const nested = new Set<string>();
    for (const item of source.slice(0, 20)) {
      for (const path of leafPaths(item, collapsed, maxDepth - 1)) nested.add(path);
    }
    return nested.size > 0 ? [...nested] : [collapsed];
  }

  if (typeof source === 'object') {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(source)) {
      const next = prefix === '' ? key : `${prefix}.${key}`;
      paths.push(...leafPaths(value, next, maxDepth - 1));
    }
    return paths;
  }

  return prefix === '' ? [] : [prefix];
}

/** Read a path across many rows, keeping only the rows where it was present. */
export function collectPathValues(rows: readonly unknown[], path: string): unknown[] {
  const values: unknown[] = [];
  for (const row of rows) {
    const lookup = getPath(row, path);
    if (lookup.found) values.push(lookup.value);
  }
  return values;
}
