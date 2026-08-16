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
 *   npm run mcp --workspace backend
 *
 * Claude Code:
 *   claude mcp add notice -- npm run mcp --workspace backend
 *
 * Environment:
 *   NOTICE_API_BASE   defaults to the deployed API
 */
import { buildTools, dispatch, type JsonRpcRequest } from '../src/mcp/server.js';

const API = (process.env['NOTICE_API_BASE'] ?? 'https://notice-api-0vfo.onrender.com').replace(
  /\/+$/,
  '',
);

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`NOTICE API returned ${String(response.status)} for ${path}`);
  return (await response.json()) as T;
}

function main(): void {
  const tools = buildTools(read);

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
