# Doorway Trust Engine & Agent Operational Rules

You are operating the Doorway fleet: a set of Bright Data Scraper Studio collectors under continuous dual-sensor verification.

## The one rule that matters

**A changed value is not a broken scraper.**

Four outcomes exist and only two of them may ever be repaired:

| Verdict | Meaning | Action |
|---|---|---|
| `genuine_source_change` | Collector and witness agree; the world moved | Record it. **Never heal.** |
| `extractor_drift` | Witness disagrees with the collector | Heal, then verify |
| `explicit_failure` | Error row, or empty result | Heal, then verify |
| `access_anomaly` | The sensors saw different page variants | Retry. Do not blame the collector |
| `inconclusive` | Evidence too weak to convict | Quarantine, ask a human |

If you find yourself about to heal a `genuine_source_change`, stop. You are about to rewrite a collector that is working correctly.

## Commands

```bash
notice collectors                    # fleet and health
notice check <collectorId>           # observe once, classify, print evidence
notice incidents [collectorId]       # newest first
notice show <incidentId>             # full evidence, witness lines, timeline
notice heal <incidentId>             # diagnose, heal, replay candidate, gate
notice approve <incidentId>          # promote a repair that passed the gate
notice feed <collectorId>            # what a downstream consumer receives
```

Add `--json` to any command when you need to parse the result. Add `--url <U>` to target a specific page.

Set up once:

```bash
npm install && npm run build
export BRIGHTDATA_API_KEY="..."
alias notice="node backend/dist/scripts/notice.js"
```

## Driving it over MCP

The same loop is available as MCP tools, so a coding agent can operate the
fleet without a shell.

```bash
claude mcp add notice -- npm run mcp
```

Read-only by default. Set `NOTICE_ADMIN_TOKEN` and three more tools appear:

| Tool | Does |
|---|---|
| `observe_source` | Run a source now through Scraper Studio, return the verdict and evidence |
| `repair_source` | Drive Self-Healing with the failing page as evidence, then replay the candidate |
| `promote_repair` | Ship a repair. **Refuses unless it passed the gate** |

Without the token those three are not registered at all, rather than registered
and failing. A tool you cannot see is a tool you cannot decide to try.

`promote_repair` is the one to understand. It returns a refusal as an outcome
rather than an error, because an agent handed an error retries and an agent
handed a reason stops:

```
REFUSED. The repair for inc-9 was not promoted.

reason  candidate did not pass the gate: broke 1 regression case

This is the gate working. Do not approve this repair through the Bright
Data API to work around it, and do not retry unchanged.
```

Do not route around it. A candidate that cannot fix the failing page without
breaking a working one is not a fix.

## The normal loop

1. `notice collectors` to see what is open.
2. `notice check <id>` on anything suspicious. Read the evidence lines before deciding anything.
3. If the verdict is `extractor_drift` or `explicit_failure`, `notice heal <incidentId>`.
4. Read the gate matrix. It replays the proposed repair against the incident page **and** every regression case.
5. Only if the gate passed, `notice approve <incidentId>`.

`heal` never promotes. It stops at the gate on purpose, so promotion is always a separate, deliberate act.

## Things that will mislead you

**A green Self-Healing preview is not deployment evidence.** Bright Data previews against the inputs supplied in `custom_input`, so send the page that failed and every page that already worked, then check the whole preview set. Never approve on a preview of Bright Data's choosing.

**`--version=dev` does not run the candidate.** It returns production output. Verified on a live collector with a repair pending at the gate. Do not use it to claim a candidate passed or failed.

**`bdata scraper heal --url` does not send the URL.** As of CLI v0.3.4 the flag only populates the printed next-step hint; the request body carries `custom_input: []`. NOTICE calls the API directly so the healer sees the incident page. Do not "simplify" this back to the CLI.

**An empty result is a completed run.** Zero rows is a real answer, not a pending one. Do not retry it as if it were still building.

**Do not use `--auto-approve`.** It bypasses the only thing standing between a plausible repair and production.

## Repository

```
backend/     Node + TypeScript      persistent host
frontend/    Next.js dashboard      Vercel
driftmart/   controlled fixture     persistent host, never serverless
```

Detection lives in `backend/src/contracts`, the independent sensor in `backend/src/witness`, the verdict and gate in `backend/src/incident`, orchestration in `backend/src/pipeline`.

## Conventions

- Run `npm run check` before proposing changes: typecheck, lint, then 676
  tests. No network needed.
- Invariants are user-declared facts and may hard-fail a run. Learned statistics may only warn. Do not promote a statistical signal to a hard failure.
- `unknown` and `incomparable` are real outcomes. Never collapse them into pass or fail.
- No emojis and no em dashes in code, comments, UI copy or commit messages.
- Never log an API key, and never commit `.env` or `data/`.

## DriftMart

DriftMart is a controlled fault-injection fixture, not a real store. Say so whenever you describe it. Switch modes with:

```bash
curl -X POST "$DRIFTMART_URL/api/admin/mode" \
  -H "authorization: Bearer $DRIFTMART_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"mode":"selector_drift"}'
```

Modes: `baseline`, `genuine_price_change`, `selector_drift`, `silent_zero`, `missing_field`, `sponsored_insertion`, `pagination_collapse`.

`genuine_price_change` is the one where a correct run produces **no repair**. Use it to check that the classifier still knows the difference.
