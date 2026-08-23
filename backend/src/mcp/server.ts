import { asText } from '../shared/text.js';
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

/**
 * Performs an operation against the NOTICE API. Injected, and optional.
 *
 * Absent means the operational tools are not registered at all, rather than
 * registered and failing. An agent that cannot see a tool cannot decide to try
 * it, which is a better default than one that discovers it is unauthorised
 * halfway through a repair.
 */
export type ApiWriter = <T>(path: string, body?: unknown) => Promise<T>;

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

export function buildTools(api: ApiReader, operate?: ApiWriter): Tool[] {
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
      const collector = await resolveCollector(api, asText(args['source'] ?? ''));
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
            : 'Call explain_verification with incident_id set to the incident above to see the evidence, and tell the user what is unresolved.',
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
      /*
       * Say which argument is missing, rather than failing on its absence.
       *
       * Without this the tool asked the API for `/api/incidents/`, which
       * answers with something that has no incident on it, and the next line
       * read `.classification` off undefined. The agent was handed "Cannot
       * read properties of undefined", which tells it nothing it can act on
       * and is the kind of error this whole project argues against.
       *
       * It matters more here than in most places: the refusal message tells an
       * agent to call this tool, so this is the path something reaches while
       * already being told a fact could not be verified.
       */
      const incidentId = asText(args['incident_id'] ?? '').trim();
      if (incidentId === '') {
        return 'explain_verification needs an incident_id, the one named in the refusal you are following up.';
      }

      const { incident } = await api<{ incident: Incident }>(
        `/api/incidents/${encodeURIComponent(incidentId)}`,
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

    /**
     * Everything below drives Bright Data rather than reading a verdict, and
     * every one of them is registered only when an operator supplied a token.
     *
     * This is the half that makes an agent an operator instead of a reader: it
     * can observe a source, drive Self-Healing with the real incident as
     * evidence, and ask for a repair to be promoted. What it cannot do is ship
     * a repair nobody proved, because `promote_repair` goes through the same
     * gate a human does and the gate does not care who is asking.
     */
    ...(operate === undefined
      ? []
      : [
          {
            name: 'observe_source',
            description:
              'Run a monitored source now through Bright Data Scraper Studio and return the verdict. Costs page loads from the account allowance, so do not call it in a loop.',
            inputSchema: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Collector id, Scraper Studio id, or name.' },
              },
              required: ['source'],
            },
            run: async (args: Record<string, unknown>): Promise<string> => {
              const collector = await resolveCollector(api, asText(args['source'] ?? ''));
              const result = await operate<{
                publishable: boolean;
                incident: {
                  id: string;
                  classification: string;
                  confidence: number;
                  quarantined: boolean;
                  affectedFields: string[];
                  evidence: string[];
                } | null;
              }>(`/api/collectors/${collector.id}/run`);

              if (result.incident === null) {
                return [
                  `${collector.name}: healthy.`,
                  'Both sensors agree and the value is published to the verified feed.',
                ].join('\n');
              }

              const incident = result.incident;
              return [
                `${collector.name}: ${incident.classification}`,
                `incident      ${incident.id}`,
                `confidence    ${incident.confidence.toFixed(2)}`,
                `fields        ${incident.affectedFields.join(', ') || 'none recorded'}`,
                `serving       ${incident.quarantined ? 'withheld' : 'still published'}`,
                '',
                ...incident.evidence.map((line) => `  - ${line}`),
                '',
                incident.classification === 'genuine_source_change'
                  ? 'The page changed and the collector is reading it correctly. Do NOT repair this.'
                  : 'Call repair_source with this incident id to drive Self-Healing with the failing page as evidence.',
              ].join('\n');
            },
          },
          {
            name: 'repair_source',
            description:
              'Drive Bright Data Self-Healing for an incident, sending the page that actually failed as evidence, then replay the candidate against the incident and every pinned regression case. Never call this for a genuine_source_change.',
            inputSchema: {
              type: 'object',
              properties: {
                incident: { type: 'string', description: 'Incident id from observe_source.' },
              },
              required: ['incident'],
            },
            run: async (args: Record<string, unknown>): Promise<string> => {
              const id = asText(args['incident'] ?? '');
              const queued = await operate<{ job?: { id: string }; jobId?: string }>(
                `/api/incidents/${encodeURIComponent(id)}/heal`,
              );
              const job = queued.job?.id ?? queued.jobId ?? 'unknown';
              return [
                `Repair queued for incident ${id} as job ${job}.`,
                '',
                'Bright Data can take several minutes. Poll explain_verification for this',
                'incident until gate results appear, then call promote_repair.',
                '',
                'A candidate only becomes eligible if it fixes the page that failed AND',
                'breaks none of the pages that were already working.',
              ].join('\n');
            },
          },
          {
            name: 'promote_repair',
            description:
              'Promote a repaired template to production. Refuses unless the candidate passed the gate. Use this instead of approving through the Bright Data API directly.',
            inputSchema: {
              type: 'object',
              properties: {
                incident: { type: 'string', description: 'Incident whose candidate should ship.' },
              },
              required: ['incident'],
            },
            run: async (args: Record<string, unknown>): Promise<string> => {
              const id = asText(args['incident'] ?? '');
              try {
                await operate(`/api/incidents/${encodeURIComponent(id)}/approve`);
              } catch (error) {
                // The refusal is the feature, so it is reported as an outcome
                // rather than thrown. An agent that receives an error tends to
                // retry; an agent that receives a reason tends to stop.
                return [
                  `REFUSED. The repair for ${id} was not promoted.`,
                  '',
                  `reason  ${error instanceof Error ? error.message : String(error)}`,
                  '',
                  'This is the gate working. Do not approve this repair through the Bright',
                  'Data API to work around it, and do not retry unchanged: a candidate that',
                  'cannot fix the failing page without breaking a working one is not a fix.',
                  'Re-run repair_source with a sharper description of what is wrong.',
                ].join('\n');
              }

              return [
                `Promoted the repair for ${id}.`,
                '',
                'Production was re-verified after promotion rather than trusted. A green',
                'approval is not evidence that production changed: the approve call takes',
                'auto_save, it is off by default on both the API and the CLI, and without it',
                'the job reports done while production keeps the old template.',
              ].join('\n');
            },
          },
        ]),

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
      const name = asText(request.params?.['name'] ?? '');
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
