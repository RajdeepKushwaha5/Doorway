# Architecture

One rule decides everything in this system:

> Two Bright Data sensors read the same page. If they **disagree**, the
> extractor broke. If they **agree** and the value moved, the world changed.

Every module below exists to make that judgement, to prove it, or to act on it.

---

## The shape of one observation

```
                Scraper Studio collector          (sensor 1, selector-bound)
                          |
                          |  structured rows
                          v
                  contract validation             contracts/
                          |
              clean ------+------ suspicious
                |                      |
                v                      v
      verified snapshot        Web Unlocker markdown   (sensor 2, no selectors)
                |                      |               brightdata/unlocker.ts
                |                      v
                |              field extraction        witness/extract.ts
                |                      |
                |                      v
                |                 reconcile            witness/compare.ts
                |                      |
                |                      v
                |                 classify             incident/classify.ts
                |                      |
                |    +-----------------+------------------+---------------+
                |    |                 |                  |               |
                |  agree,          disagree          different       witness
                |  value moved                        region        unreadable
                |    |                 |                  |               |
                |    v                 v                  v               v
                | genuine          extractor          access         inconclusive
                | source            drift             anomaly        quarantine
                | change              |
                |  (do not heal)      v
                |             refactor_template        pipeline/repair.ts
                |                     |
                |                     v
                |              gate: replay against the incident
                |              and every pinned regression case
                |                     |               incident/gate.ts
                |            fails ---+--- passes
                |              |             |
                |           reject       promote, then re-verify production
                |                             |
                v                             v
        consumer feed  <----------------------+          pipeline/feed.ts
```

The two branches that make this more than a monitor are `genuine_source_change`
and `access_anomaly`. Both look like failures to a naive check, and repairing
either one damages a collector that was working.

---

## Modules

Each directory owns one decision. Nothing reaches across a boundary to
second-guess another module's verdict.

| Directory | Owns |
|---|---|
| `brightdata/` | Every call to Bright Data. Collector triggers, dataset reads, Self-Healing, and the Web Unlocker witness fetch. Typed errors distinguish retryable from fatal. |
| `contracts/` | What "normal" means for a collector, learned from its own history. Median and MAD rather than mean and stdev, so one corrupt run cannot poison the baseline it is judged against. |
| `witness/` | The second sensor. Extracts a field from markdown with a confidence attached to how it was found, and reconciles it against the collector. |
| `incident/` | Classification, the repair prompt, the promotion gate, and the incident state machine. |
| `pipeline/` | Orchestration: observe, repair, feed, notify, GitHub issues, and the downstream consumer. |
| `store/` | Persistence behind an interface. File-backed so a fresh clone runs with no database. |
| `worker/` | The scheduler and the page-load budget that stops it overspending the free tier. |
| `mcp/` | The agent-facing surface. Returns a verified value or an honest refusal. |
| `incident/certificate.ts` | Exports a verdict as a hash-sealed document a reader can re-check offline, so a claim does not rest on trusting this server. |
| `shared/` | Normalisation, comparison, redaction, and the types every layer agrees on. |

---

## Four decisions worth knowing

**`unknown` is not `fail`.** A check that could not be evaluated must never
contribute to a failure score. Conflating the two is how a monitoring tool
starts rewriting collectors that were never broken.
See `shared/types.ts`.

**The witness runs only when something trips.** Every observation that reaches
it costs a second page load from the same monthly allowance, so a permanent dual
probe would double the cost of the healthy path for no new information.
See `pipeline/observe.ts`.

**Confidence is a property of how a value was found.** JSON-LD scores 0.95; a
bare currency figure with nothing naming it scores 0.35 and is never allowed to
condemn a collector on its own.
See `witness/extract.ts`.

**Production is re-verified after promotion, not trusted.** An approval can
return HTTP 200, report `success: true` and advance the job to `done` while
production still serves the old template — in our case because
`resume_automation_job` needs `auto_save: true`, which defaults to false and
which we were not sending. The gate caught it by re-checking production rather
than believing the flag, which is the whole reason that step exists.
See `pipeline/repair.ts` and finding 5 in the README.

---

## Workspaces

| Workspace | Role |
|---|---|
| `backend/` | The engine. Everything above, plus the API, the worker and the MCP server. |
| `frontend/` | Next.js dashboard. Reads the API; every mutation runs in a server action so no token reaches the browser. |
| `driftmart/` | A controlled store serving the same product in seven layouts, so a redesign can be produced deliberately rather than waited for. Modes switch **server-side**, which is what makes them visible to every sensor rather than only to a JavaScript-rendering one. |

`actions/verify/` is a reusable GitHub composite action so any pipeline can
refuse to ship on data nobody has checked.

---

## Reproducing the claims

```bash
npm test                              # 256 tests, no network, no credentials
npm run benchmark                     # Drift Discrimination Score, live
npm run blindspot -- <collector-id>   # every conventional check passes a wrong row
npm run live -- observe-all           # one real observation per collector
curl .../api/incidents/<id>/certificate  # a verdict you can re-check at /verify
```
