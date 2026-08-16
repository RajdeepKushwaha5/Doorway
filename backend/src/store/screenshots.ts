import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Screenshot storage, on disk beside the data file.
 *
 * Not in the JSON store. A capture is around 200KB, and the FileStore rewrites
 * its entire document on every save, so base64 images inside it would turn
 * each incident write into a multi-megabyte rewrite and make the store slower
 * with every incident it records.
 *
 * Durability matches the incident it belongs to. On a host with no persistent
 * disk both vanish together on redeploy, which is the correct relationship:
 * there is no state where an incident references a screenshot that outlived it
 * or vice versa.
 *
 * Identifiers are random rather than derived from the URL, because a filename
 * built from caller input is a path traversal waiting to happen and these ids
 * are served straight back over HTTP.
 */
export class ScreenshotStore {
  readonly #directory: string;

  /**
   * @param dataFile Path of the JSON store. Screenshots live in a
   *   `screenshots` directory next to it, so one location holds all state.
   */
  constructor(dataFile?: string) {
    const base = dataFile ?? join(process.cwd(), 'data', 'notice.json');
    this.#directory = join(dirname(resolve(base)), 'screenshots');
  }

  /** @returns An opaque id, safe to place in a URL. */
  async save(png: Uint8Array): Promise<string> {
    await mkdir(this.#directory, { recursive: true });
    const id = randomUUID();
    await writeFile(this.#path(id), png);
    return id;
  }

  /** @returns PNG bytes, or null when the id is unknown or the file is gone. */
  async read(id: string): Promise<Uint8Array | null> {
    // Reject anything that is not a plain uuid before it reaches the
    // filesystem. These ids arrive from the network.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    try {
      return new Uint8Array(await readFile(this.#path(id)));
    } catch {
      return null;
    }
  }

  /**
   * Delete captures older than the given age.
   *
   * Screenshots accumulate with no natural bound, and the evidence value of an
   * image decays quickly: once a repair is approved or rejected, nobody
   * revisits what the page looked like a fortnight ago.
   *
   * @returns How many files were removed.
   */
  async prune(maxAgeMs: number, now: number = Date.now()): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(this.#directory);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.png')) continue;
      const path = join(this.#directory, entry);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > maxAgeMs) {
          await unlink(path);
          removed += 1;
        }
      } catch {
        // A file that vanished under us needs no further attention.
      }
    }
    return removed;
  }

  #path(id: string): string {
    return join(this.#directory, `${id}.png`);
  }
}
