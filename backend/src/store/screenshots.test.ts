import { mkdtemp, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScreenshotStore } from './screenshots.js';

/**
 * Screenshots are stored beside the JSON document, not inside it.
 *
 * A capture is around 200KB and the FileStore rewrites its whole document on
 * every save, so base64 images in the store would make each incident write
 * proportional to every screenshot ever taken.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let store: ScreenshotStore;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notice-shots-'));
  store = new ScreenshotStore(join(directory, 'notice.json'));
});

describe('screenshot storage', () => {
  it('round-trips the exact bytes', async () => {
    const id = await store.save(PNG);
    expect(await store.read(id)).toEqual(PNG);
  });

  it('keeps images out of the store document, in a sibling directory', async () => {
    await store.save(PNG);
    expect(await readdir(join(directory, 'screenshots'))).toHaveLength(1);
  });

  it('returns null for an unknown id rather than throwing', async () => {
    expect(await store.read('11111111-2222-3333-4444-555555555555')).toBeNull();
  });

  it('refuses an id that is not a uuid, since ids arrive over the network', async () => {
    // Without this a request for `../../.env` becomes a file read. The check is
    // on the shape of the id, before it is ever joined to a path.
    expect(await store.read('../../../.env')).toBeNull();
    expect(await store.read('..%2F..%2F.env')).toBeNull();
    expect(await store.read('')).toBeNull();
  });

  it('prunes captures older than the given age and keeps the rest', async () => {
    const old = await store.save(PNG);
    const fresh = await store.save(PNG);

    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await utimes(join(directory, 'screenshots', `${old}.png`), longAgo, longAgo);

    expect(await store.prune(7 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(await store.read(old)).toBeNull();
    expect(await store.read(fresh)).toEqual(PNG);
  });

  it('prunes nothing when no directory exists yet', async () => {
    expect(await store.prune(1000)).toBe(0);
  });
});
