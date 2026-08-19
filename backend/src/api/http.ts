import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A very small router.
 *
 * Deliberately dependency-free. The submission is partly judged on a stranger
 * being able to clone and run it, and every dependency is another way that
 * fails on someone else's machine. The routing needs here are a dozen paths
 * and two verbs.
 */

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Exposed so handlers can authorize. See assertAdmin below. */
  request: IncomingMessage;
}

/**
 * Constant-time bearer check for mutating routes.
 *
 * CORS is not authorization. Without this, anyone who can reach the deployed
 * backend can register collectors, trigger chargeable Bright Data runs, start
 * Self-Healing, and promote a repair into production.
 *
 * If `NOTICE_ADMIN_TOKEN` is unset the server refuses every mutating request
 * rather than defaulting to open. An unconfigured deployment should be inert,
 * not permissive.
 */
export function assertAdmin(request: IncomingMessage): void {
  const expected = process.env['NOTICE_ADMIN_TOKEN'];
  if (expected === undefined || expected.trim() === '') {
    throw new HttpError(
      503,
      'NOTICE_ADMIN_TOKEN is not configured, so mutating routes are disabled',
    );
  }

  const header = request.headers.authorization ?? '';
  const supplied = header.replace(/^Bearer\s+/i, '');
  if (supplied.length !== expected.length) throw new HttpError(401, 'unauthorized');

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) throw new HttpError(401, 'unauthorized');
}

export type Handler = (context: RouteContext) => Promise<unknown>;

interface Route {
  method: 'GET' | 'POST' | 'PUT';
  segments: string[];
  handler: Handler;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class Router {
  readonly #routes: Route[] = [];

  add(method: Route['method'], pattern: string, handler: Handler): this {
    this.#routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  #match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.#routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, segment] of route.segments.entries()) {
        const part = parts[index];
        if (part === undefined) {
          matched = false;
          break;
        }
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
        else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  /** Node request handler. Serializes results and maps errors to statuses. */
  handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // Blank is not the same as unset. A hosting dashboard stores an empty
    // field as an empty string, and `??` does not fall back on one, so a
    // half-filled variable would emit `access-control-allow-origin:` with no
    // value. Every browser request then fails while curl keeps working, which
    // is the worst way to discover a misconfiguration.
    const configured = process.env['NOTICE_CORS_ORIGIN']?.trim();
    const origin = configured === undefined || configured === '' ? '*' : configured;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
    // Responses differ by origin once one is configured, so shared caches must
    // not serve one origin's response to another.
    if (origin !== '*') response.setHeader('vary', 'Origin');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const match = this.#match(request.method ?? 'GET', url.pathname);

    if (match === null) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found', path: url.pathname }));
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await match.route.handler({
        params: match.params,
        query: url.searchParams,
        body,
        request,
      });
      if (isStreamResponse(result)) {
        result.run(response, request);
        return;
      }

      if (isBinaryResponse(result)) {
        response.writeHead(200, {
          'content-type': result.contentType,
          'content-length': String(result.body.byteLength),
          ...(result.cacheControl === undefined ? {} : { 'cache-control': result.cacheControl }),
        });
        response.end(Buffer.from(result.body));
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result ?? null));
    } catch (caught) {
      const status = caught instanceof HttpError ? caught.status : 500;
      const message = caught instanceof Error ? caught.message : 'internal error';
      // Never echo a stack trace: these bodies carry Bright Data responses and
      // land in a browser the user may be screen-sharing.
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: message }));
    }
  };
}

/**
 * A handler result that is bytes rather than JSON.
 *
 * Screenshots are the only current use. Returning a tagged object keeps every
 * handler a plain function of request to value, rather than handing some of
 * them the raw ServerResponse and hoping each one remembers to set a status,
 * a content type and a length.
 */
export interface BinaryResponse {
  readonly kind: 'binary';
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly cacheControl?: string;
}

/**
 * A handler that takes the response over and writes to it itself.
 *
 * Needed for server-sent events, where the point is that the response never
 * ends until the work does. Everything else in this router answers in one
 * write, which is why this is an explicit escape hatch rather than the norm.
 */
export interface StreamResponse {
  kind: 'stream';
  run: (response: ServerResponse, request: IncomingMessage) => void;
}

export function stream(run: StreamResponse['run']): StreamResponse {
  return { kind: 'stream', run };
}

function isStreamResponse(value: unknown): value is StreamResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'stream'
  );
}

export function binary(
  contentType: string,
  body: Uint8Array,
  cacheControl?: string,
): BinaryResponse {
  return {
    kind: 'binary',
    contentType,
    body,
    ...(cacheControl === undefined ? {} : { cacheControl }),
  };
}

function isBinaryResponse(value: unknown): value is BinaryResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'binary' &&
    (value as { body?: unknown }).body instanceof Uint8Array
  );
}

const MAX_BODY_BYTES = 1_000_000;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST' && request.method !== 'PUT') return null;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be valid JSON');
  }
}
