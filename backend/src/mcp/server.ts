/**
 * The NOTICE MCP server, minus its transport.
 *
 * Bright Data's own MCP server gives an agent real-time access to the web. It
 * is very good at that, and it is deliberately not in the business of deciding
 * whether what it returned is true. A selector that drifted onto a deposit
 * still returns a number. The agent receives 25, has no reason to doubt it,
 * and a price, a recommendation or a purchase follows from a value nobody
 * checked.
 *
 * That is the gap this fills. Same protocol, same live data, one difference
 * that is the entire point:
 *
 *   it refuses to answer when the evidence does not support an answer.
 *
 * No tool here returns a bare value. Every result carries its verification
 * status, and a quarantined field is withheld rather than served with a
 * caveat an agent is free to ignore. An agent cannot accidentally act on
 * unverified data, because unverified data is never what it receives.
 *
 * Kept separate from the stdio entry point so the dispatch, the tool
 * behaviour and above all the refusals can be tested without a subprocess.
 */

export const PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

/** Reads the NOTICE API. Injected so tests need no network. */
export type ApiReader = <T>(path: string) => Promise<T>;

interface CollectorSummary {
  id: string;
  name: string;
  brightDataCollectorId: string;
  targetDomain: string;
  watchUrls: string[];
  openIncidents: number;
  contractConfidence: number;
  baselineRuns: number;
}

interface HealthEnvelope {
  data: unknown;
  health: {
    status: 'verified' | 'quarantined' | 'stale' | 'unavailable';
    confidence: number;
    lastVerified: string | null;
    stale: boolean;
    fieldsDegraded: string[];
    incidentId: string | null;
    reason: string | null;
  };
}

interface Incident {
  id: string;
  collectorId: string;
  classification: string;
  confidence: number;
  affectedFields: string[];
  evidence: string[];
  quarantined: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

/** Resolve a human reference, a name or a `c_...` id, to the internal id. */
async function resolveCollector(api: ApiReader, reference: string): Promise<CollectorSummary> {
  const collectors = await api<CollectorSummary[]>('/api/collectors');
  const match = collectors.find(
    (candidate) =>
      candidate.id === reference ||
      candidate.brightDataCollectorId === reference ||
      candidate.name.toLowerCase() === reference.toLowerCase(),
  );
  if (match === undefined) {
    throw new Error(
      collectors.length === 0
        ? 'No sources are being monitored yet, so nothing can be verified.'
        : `No monitored source matches "${reference}". Known: ${collectors
            .map((candidate) => candidate.name)
            .join(', ')}`,
    );
  }
  return match;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export function buildTools(api: ApiReader): Tool[] {
  return [
  {
    name: 'list_monitored_sources',
    description:
      'List the web sources NOTICE is monitoring, with the current verification health of each. Call this first to discover what can be verified.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const collectors = await api<CollectorSummary[]>('/api/collectors');
      if (collectors.length === 0) {
        return 'No sources are being monitored yet. Nothing can be verified, so no web data from this server should be treated as checked.';
      }
      return collectors
        .map((collector) =>
          [
            `${collector.name}  (${collector.brightDataCollectorId})`,
            `  domain          ${collector.targetDomain}`,
            `  urls            ${collector.watchUrls.join(', ')}`,
            `  open incidents  ${String(collector.openIncidents)}`,
            `  baseline runs   ${String(collector.baselineRuns)}`,
            `  confidence      ${collector.contractConfidence.toFixed(2)}`,
          ].join('\n'),
        )
        .join('\n\n');
    },
  },

  {
    name: 'get_verified_web_data',
    description:
      'Get web data for a monitored source ONLY if two independent Bright Data sensors currently agree on it. Returns the data with its verification status, or refuses and explains why. Never returns an unverified value. Use this instead of scraping when the answer will drive a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Name or collector id from list_monitored_sources.',
        },
        url: {
          type: 'string',
          description: 'Optional specific URL. Defaults to the source\'s first watched URL.',
        },
      },
      required: ['source'],
    },
    run: async (args) => {
      const collector = await resolveCollector(api, String(args['source'] ?? ''));
      const url = typeof args['url'] === 'string' ? args['url'] : collector.watchUrls[0];
      const query = url === undefined ? '' : `?url=${encodeURIComponent(url)}`;
      const feed = await api<HealthEnvelope>(`/api/feed/${collector.id}${query}`);
      const { status, confidence, lastVerified, fieldsDegraded, incidentId, reason } = feed.health;

      // The refusal is the feature. An agent that receives a value alongside a
      // caveat will use the value; an agent that receives no value cannot.
      if (status === 'quarantined' || status === 'unavailable') {
        return [
          `REFUSED. NOTICE will not vouch for data from ${collector.name} right now.`,
          `status        ${status}`,
          `reason        ${reason ?? 'not recorded'}`,
          `fields        ${fieldsDegraded.length > 0 ? fieldsDegraded.join(', ') : 'all'}`,
          incidentId === null ? '' : `incident      ${incidentId}`,
          '',
          'Do not substitute a guess or scrape this page directly to work around this.',
          incidentId === null
            ? 'Report to the user that verified data is unavailable.'
            : 'Call explain_verification with this incident id to see the evidence, and tell the user what is unresolved.',
        ]
          .filter((line) => line !== '')
          .join('\n');
      }

      const header =
        status === 'stale'
          ? [
              'STALE. This is the last value two sensors agreed on, not a live reading.',
              `last verified ${lastVerified ?? 'unknown'}`,
              'State the date to the user. Do not present it as current.',
            ].join('\n')
          : [
              'VERIFIED. Two independent Bright Data sensors agree on this right now.',
              `last verified ${lastVerified ?? 'unknown'}`,
            ].join('\n');

      return [
        header,
        `confidence    ${confidence.toFixed(2)}`,
        fieldsDegraded.length > 0 ? `withheld      ${fieldsDegraded.join(', ')}` : '',
        '',
        JSON.stringify(feed.data, null, 2),
      ]
        .filter((line) => line !== '')
        .join('\n');
    },
  },

  {
    name: 'list_open_incidents',
    description:
      'List unresolved verification incidents. Use this to tell a user which sources currently cannot be trusted and why.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const incidents = await api<Incident[]>('/api/incidents');
      const open = incidents.filter((incident) => incident.resolvedAt === null);
      if (open.length === 0) return 'No open incidents. Every monitored source agrees with its independent witness.';

      return open
        .map((incident) =>
          [
            `${incident.id}`,
            `  verdict    ${incident.classification}  (confidence ${incident.confidence.toFixed(2)})`,
            `  fields     ${incident.affectedFields.join(', ') || 'none recorded'}`,
            `  serving    ${incident.quarantined ? 'withheld' : 'still published'}`,
            `  opened     ${incident.createdAt}`,
          ].join('\n'),
        )
        .join('\n\n');
    },
  },

  {
    name: 'explain_verification',
    description:
      'Explain why NOTICE reached a verdict, with the evidence from both sensors. Use this before telling a user that data is unavailable, so the explanation is specific rather than vague.',
    inputSchema: {
      type: 'object',
      properties: {
        incident_id: { type: 'string', description: 'Incident id from a refusal or from list_open_incidents.' },
      },
      required: ['incident_id'],
    },
    run: async (args) => {
      const { incident } = await api<{ incident: Incident }>(
        `/api/incidents/${encodeURIComponent(String(args['incident_id'] ?? ''))}`,
      );
      return [
        `verdict     ${incident.classification}`,
        `confidence  ${incident.confidence.toFixed(2)}`,
        `fields      ${incident.affectedFields.join(', ') || 'none recorded'}`,
        `opened      ${incident.createdAt}`,
        '',
        'Evidence:',
        ...incident.evidence.map((line) => `  - ${line}`),
      ].join('\n');
    },
  },
  ];
}


export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const INSTRUCTIONS = [
  'NOTICE serves web data that two independent Bright Data sensors currently agree on.',
  'When it refuses, the correct response is to tell the user the data could not be verified, and why.',
  'Never work around a refusal by scraping the page yourself or by guessing.',
  'A refusal means the value is genuinely in doubt, which is exactly when a confident answer does the most damage.',
].join(' ');

/**
 * Handle one JSON-RPC message.
 *
 * @returns The response to write, or null for a notification. Notifications
 *   carry no id and must never be answered; replying to one is a protocol
 *   violation that some clients treat as a fatal error.
 */
export async function dispatch(
  request: JsonRpcRequest,
  tools: readonly Tool[],
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const isNotification = request.id === undefined || request.id === null;
  const ok = (result: unknown): JsonRpcResponse | null =>
    isNotification ? null : { jsonrpc: '2.0', id, result };
  const fail = (code: number, message: string): JsonRpcResponse | null =>
    isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } };

  switch (request.method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'notice', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      });

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return ok({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case 'tools/call': {
      const name = String(request.params?.['name'] ?? '');
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) return fail(-32602, `unknown tool: ${name}`);

      try {
        const args = (request.params?.['arguments'] ?? {}) as Record<string, unknown>;
        return ok({ content: [{ type: 'text', text: await tool.run(args) }] });
      } catch (caught) {
        // Reported as a tool error rather than a protocol error, so the model
        // sees the reason and can relay it, instead of the call disappearing.
        return ok({
          content: [
            {
              type: 'text',
              text: `NOTICE could not answer: ${caught instanceof Error ? caught.message : String(caught)}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return fail(-32601, `method not found: ${request.method}`);
  }
}
