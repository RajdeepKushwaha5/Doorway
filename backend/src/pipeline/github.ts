import type { IncidentRecord } from '../store/index.js';

/**
 * File an incident where the team already works.
 *
 * A webhook message scrolls past. An issue has an owner, a thread, a label and
 * a close date, and it survives the afternoon. Broken extraction is not an
 * alert to acknowledge, it is a defect someone has to decide about, so it
 * belongs in the tracker rather than only in a chat channel.
 *
 * The body carries what a reviewer needs to rule on it without opening
 * anything else: both readings, the line the witness read, and the rendered
 * capture of the page as it was when the incident opened.
 */

export interface GitHubConfig {
  /** `owner/repo`. Absent means this is simply off. */
  repository?: string | undefined;
  /** A token with `issues: write`. */
  token?: string | undefined;
  /** API base, overridable for GitHub Enterprise. */
  apiBase?: string;
  /** Dashboard origin, so the issue can link to the incident. */
  dashboardUrl?: string | undefined;
  /** NOTICE API origin, so the issue can embed the screenshot. */
  apiUrl?: string | undefined;
  timeoutMs?: number;
}

/** Verdicts that represent a defect somebody must decide about. */
const REPORTABLE = new Set(['extractor_drift', 'explicit_failure', 'inconclusive']);

function title(incident: IncidentRecord, collectorName: string): string {
  const fields = incident.affectedFields.join(', ') || 'output';
  return `[NOTICE] ${collectorName}: ${fields} is not trustworthy`;
}

function body(
  incident: IncidentRecord,
  collectorName: string,
  config: GitHubConfig,
): string {
  const lines: string[] = [
    `**${collectorName}** produced data that two independent Bright Data sensors disagree about.`,
    '',
    `- Verdict: \`${incident.classification}\``,
    `- Confidence: ${incident.confidence.toFixed(2)}`,
    `- Affected: ${incident.affectedFields.join(', ') || 'unknown'}`,
    `- Serving: ${incident.quarantined ? '**withheld from the feed**' : 'still published'}`,
    `- Opened: ${incident.createdAt}`,
    '',
    '### Evidence',
    '',
    ...incident.evidence.map((line) => `- ${line}`),
  ];

  const witnessLine = incident.witness?.values[0]?.evidence;
  if (witnessLine !== undefined) {
    lines.push(
      '',
      '### What the page actually said',
      '',
      '```',
      witnessLine.line,
      '```',
      `Read by the selectorless witness at line ${String(witnessLine.lineNumber)}, strategy \`${witnessLine.strategy}\`.`,
    );
  }

  // An image beats a paragraph for "was the page really like that". GitHub
  // renders this inline as long as the endpoint is publicly reachable, which
  // it is: it serves a page the collector already fetches publicly.
  if (incident.screenshotId !== null && config.apiUrl !== undefined) {
    const src = `${config.apiUrl.replace(/\/+$/, '')}/api/incidents/${incident.id}/screenshot`;
    lines.push('', '### The page when this fired', '', `![Rendered capture of the page](${src})`);
  }

  if (config.dashboardUrl !== undefined && config.dashboardUrl.trim() !== '') {
    const link = `${config.dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id}`;
    lines.push('', `[Full evidence and controls](${link})`);
  }

  lines.push(
    '',
    '---',
    '',
    'Opened automatically by NOTICE. The value is held back until a repair is proven against the page that failed and the pages that were working.',
  );

  return lines.join('\n');
}

async function request(
  config: GitHubConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${config.apiBase ?? 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token ?? ''}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Open an issue for an incident, unless one is already open for it.
 *
 * Never throws. Filing is a courtesy on top of a decision already recorded, and
 * losing a quarantine because GitHub rate-limited would be an absurd trade.
 *
 * @returns The issue URL, or null when nothing was filed.
 */
export async function reportIncidentToGitHub(
  config: GitHubConfig,
  incident: IncidentRecord,
  collectorName: string,
): Promise<string | null> {
  const repository = config.repository?.trim();
  const token = config.token?.trim();
  if (repository === undefined || repository === '') return null;
  if (token === undefined || token === '') return null;
  if (!REPORTABLE.has(incident.classification)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000);

  try {
    // One issue per collector and field, not per run. A collector observed
    // every six hours would otherwise file four issues a day about a single
    // unresolved fault, and a tracker full of duplicates is a tracker people
    // stop reading.
    const wanted = title(incident, collectorName);
    const open = await request(
      config,
      `/repos/${repository}/issues?state=open&labels=notice&per_page=100`,
      { method: 'GET', signal: controller.signal },
    );

    if (open.ok) {
      const issues = (await open.json()) as { title: string; html_url: string }[];
      const duplicate = issues.find((issue) => issue.title === wanted);
      if (duplicate !== undefined) return duplicate.html_url;
    }

    const created = await request(config, `/repos/${repository}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: wanted,
        body: body(incident, collectorName, config),
        labels: ['notice', `notice:${incident.classification}`],
      }),
      signal: controller.signal,
    });

    if (!created.ok) return null;
    const issue = (await created.json()) as { html_url?: string };
    return issue.html_url ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
