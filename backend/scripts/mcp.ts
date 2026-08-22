/**
 * NOTICE as an MCP server: web data an agent is allowed to act on.
 *
 * This file is only the transport. The protocol, the tools and the refusal
 * semantics live in `src/mcp/server.ts`, where they can be tested without a
 * subprocess. See that file for what this actually offers and why.
 *
 * Newline-delimited JSON-RPC 2.0 over stdin and stdout, which is what MCP
 * specifies for a local server. Implemented directly rather than with an SDK,
 * for the same reason the HTTP router is: this is well-specified message
 * passing, and someone cloning the repository should not need a dependency
 * tree to run it.
 *
 * Usage:
 *   npm run mcp
 *
 * Claude Code:
 *   claude mcp add notice -- npm run mcp
 *
 * Environment:
 *   NOTICE_API_BASE      defaults to the deployed API
 *   NOTICE_ADMIN_TOKEN   optional. Set it to expose observe, repair and promote;
 *                        without it the server is read-only.
 */
import { buildTools, dispatch, type JsonRpcRequest } from '../src/mcp/server.js';

const API = (process.env['NOTICE_API_BASE'] ?? 'https://doorway-api-4ftn.onrender.com').replace(
  /\/+$/,
  '',
);

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`NOTICE API returned ${String(response.status)} for ${path}`);
  return (await response.json()) as T;
}

/**
 * Drive an operation, when the operator has supplied a token.
 *
 * Without one this stays undefined and the operational tools are never
 * registered, so an agent sees a read-only server rather than discovering
 * halfway through a repair that it was never allowed to finish.
 *
 * The error text matters more here than anywhere else in this file: it is what
 * `promote_repair` shows an agent when the gate refuses, and a refusal an agent
 * cannot read is a refusal it will try to route around.
 */
async function operate<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env['NOTICE_ADMIN_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('NOTICE_ADMIN_TOKEN is not set on this server.');
  }
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token.trim()}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `NOTICE API returned ${String(response.status)}`;
    throw new Error(message);
  }
  return payload as T;
}

function main(): void {
  const canOperate =
    (process.env['NOTICE_ADMIN_TOKEN'] ?? '').trim() !== '';
  const tools = buildTools(read, canOperate ? operate : undefined);

  // stdout is the transport. Anything written to it that is not a JSON-RPC
  // message corrupts the stream, so diagnostics go to stderr.
  process.stderr.write(`NOTICE MCP server ready, talking to ${API}\n`);

  // Every tool call reaches the network, so a request is still in flight long
  // after the line carrying it was read. Exiting the moment stdin closes threw
  // those answers away: a client that wrote its requests and closed the pipe
  // received nothing at all.
  const inFlight = new Set<Promise<unknown>>();
  let ended = false;

  const track = (work: Promise<unknown>): void => {
    inFlight.add(work);
    void work.finally(() => {
      inFlight.delete(work);
      if (ended && inFlight.size === 0) process.exit(0);
    });
  };

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== '') {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          process.stdout.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`,
          );
          newline = buffer.indexOf('\n');
          continue;
        }
        track(
          dispatch(request, tools).then((response) => {
            if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
          }),
        );
      }
      newline = buffer.indexOf('\n');
    }
  });

  process.stdin.on('end', () => {
    ended = true;
    if (inFlight.size === 0) process.exit(0);
  });
}

main();
