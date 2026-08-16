# NOTICE

**When a collector and an independent Bright Data witness disagree, the collector broke. When they agree but differ from history, the world changed. When the evidence conflicts, NOTICE refuses to heal.**

NOTICE is the incident-to-verified-repair layer for Bright Data Scraper Studio. It detects silent collector corruption, works out whether the page changed or the extractor drifted, sends the real incident to Self-Healing, and blocks a proposed repair from reaching production until it has been proven on the page that actually failed.

---

## Live

| | |
|---|---|
| Dashboard | https://notice-frontend-bay.vercel.app |
| API | https://notice-api-0vfo.onrender.com/api/health |
| DriftMart fixture | https://driftmart-3ut8.onrender.com |

The two Render services are on the free plan and spin down after 15 minutes
idle, so the first request after a quiet period takes around 30 seconds. Open
the DriftMart link first and let it wake up.

DriftMart is the page Bright Data actually scrapes. It serves the same product
at seven different markups on demand, so a redesign, a genuine price change and
a silent corruption can each be produced deliberately rather than waited for.
Every mode is permanently reachable at `/fixtures/<mode>`, which is what makes
a regression corpus possible.

---

## The problem

A scraper that returns nothing is easy. You see the empty output, you run `heal`, you move on.

The failure that damages a business is the one that returns HTTP 200 and schema-valid JSON that is quietly wrong:

- the sale-price selector now captures the struck-through list price
- a price becomes `0 USD` on a page whose real price is in GBP
- pagination breaks and page one repeats, so 300 plausible rows are really 100
- a deposit sits next to a price after a redesign, and the collector reads the deposit

No exception. No null. No alert. The data flows into a dashboard, a model or an agent and poisons it for weeks.

Bright Data's own documentation is explicit that detection is not their job:

> "Is Self-Healing automatic, or do I trigger it? **You trigger Self-Healing; it does not fire automatically when a target site's DOM changes.**"

> "The CLI never decides on its own that a scraper is broken, you inspect the run output and decide."

Asked directly in a June 2025 Scraper Studio webinar whether healing can fire
by itself, Bright Data's technical product manager for Scraper Studio answered:

> "How is the self-healing triggered? Do you have to ask it to fix it or can it be triggered automatically? **For now, it is you going to trigger it.**"

> "**We don't have the fully automated solution yet**, but we're looking into it."

And on how to close that gap in the meantime:

> "When a scraper breaks, you can trigger a self-healing. In our documentation we also have an API for the Scraper Studio. You can basically run self-healing when something is broken so that you can continuously fix that, **so that you don't have to intervene manually**."

That is the seam this project sits in. Bright Data builds and repairs the
collector and exposes the API to drive the repair. What nobody supplies is the
judgement in between: noticing that a run is wrong when it looks right,
deciding whether the page changed or the extractor drifted, and proving a
proposed repair before it reaches production.

NOTICE is the part that decides.

---

## How it works

```
Scraper Studio collector
        |  structured rows
        v
Contract validation  ---- clean ----> publish to verified feed
        |  suspicious
        v
Independent Bright Data witness   (Web Unlocker, markdown, no selectors)
        |
        v
Reconciliation
        |
        +-- sensors agree, value moved ---> genuine source change, DO NOT heal
        +-- different page variants     ---> access anomaly, retry
        +-- evidence too weak           ---> inconclusive, quarantine
        +-- sensors disagree            ---> extractor drift
                                              |
                                              v
                                     evidence-backed heal prompt
                                              |
                                              v
                                     candidate replayed against the
                                     incident + regression corpus
                                              |
                                    pass ----+---- fail
                                     |              |
                                  promote      reject, production unchanged
```

The two sensors are both Bright Data, used against each other. The collector is selector-bound and can drift. The markdown path has no selectors and cannot drift the same way. Their disagreement is the signal.

---

## Use it from an AI agent

```bash
claude mcp add notice -- npm run mcp --workspace backend
```

NOTICE speaks MCP, so an agent can ask it for web data directly. Bright Data's
own MCP server gives an agent real-time access to the web and is deliberately
not in the business of deciding whether what it returned is true. A selector
that drifted onto a deposit still returns a number. The agent receives `25`,
has no reason to doubt it, and a price, a recommendation or a purchase follows
from a value nobody checked.

Same protocol, same live data, one difference that is the entire point: **it
refuses to answer when the evidence does not support an answer.**

| Tool | Behaviour |
|---|---|
| `list_monitored_sources` | what can be verified at all |
| `get_verified_web_data` | the value, or a refusal naming the incident |
| `list_open_incidents` | what currently cannot be trusted |
| `explain_verification` | the evidence behind a verdict |

No tool returns a bare value. A quarantined field is withheld rather than
served with a caveat a model is free to read past, and the corrupt number
never enters the context window at all. An agent cannot accidentally act on
unverified data, because unverified data is never what it receives.

---

## Why it is not a health monitor

A monitor checks whether output arrived. NOTICE checks whether output is still **true**, and it distinguishes four things a monitor collapses into one alarm:

| Situation | Monitor says | NOTICE says |
|---|---|---|
| Price 249 to 229, extraction fine | "value changed" | `genuine_source_change`, collector untouched |
| Price reads the deposit | "value changed" | `extractor_drift`, heal with evidence |
| Sensors saw different regions | "value changed" | `access_anomaly`, do not blame the collector |
| Witness could not read the page | "value changed" | `inconclusive`, quarantine and ask a human |

Sending a genuine source change to Self-Healing rewrites a collector that was working. That is the failure mode NOTICE exists to avoid as much as the corruption itself.

---

## What we found building against the platform

Documented because it shaped the architecture, not as criticism.

**1. The CLI does not forward incident inputs to Self-Healing.** `bdata scraper heal --url <page>` places the URL only in the printed next-step hint. The request body it sends is `{"prompt": "...", "custom_input": []}`, so the healer never sees the page that failed. NOTICE calls `POST /dca/collectors/{id}/refactor_template` directly and puts the incident URL in `custom_input`.

**2. `bdata scraper run --version=dev` returns production output, not the candidate.** Verified on a live collector with a repair pending at the approval gate. The candidate used a scoped selector that provably fixed the incident, the preview showed it fixed, and running with `--version=dev` reproduced production's exact failure. On a page where both templates agree, the two runs are byte-identical. Anyone who believes they are testing a proposed repair before approving it is testing the code they already have.

**3. `resume_automation_job` expects `{"message": boolean}`.** Not an action string. The API rejects `{"action":"approve"}` with `"action" is not allowed`, and `{"message": 12345}` with `"message" must be a boolean`. True accepts the repair, false rejects it. The gate stays open until answered, so an unanswered candidate blocks later heals on that collector.

**4. Self-Healing progress signals the gate through `step`, not `status`.** The live payload is `{id, step, completed_steps, status, diff, success, preview_result}`. At the gate it reads `step: "user_approval"` with `status: "pending_answer"`. Matching on `status` alone reports a waiting job as pending and polls it to timeout.

**5. An approved, completed heal left production still failing.** On collector `c_mstkc1rkr8mit6wut`, approval returned HTTP 200, the job moved to `done` with `success: true`, and the incident page still returned its original parse error. The cause is undetermined: either approval does not promote the code, or the promoted code does not fix it. No public endpoint distinguishes them, so we state the observation and not a cause. This is why post-promotion verification exists.

**6. A screenshot response is labelled `Content-Type: application/json`.** `POST /request` with `data_format: screenshot` returns PNG bytes, verified by the magic number `89 50 4e 47`, under a JSON content type. A client that branches on the header will try to parse an image, and one that trusts it cannot tell a successful capture from an error payload. NOTICE checks the magic number instead.

**7. The trigger response names a field differently from every reader.** `POST /dca/trigger` returns `collection_id`; every other endpoint reads the same value as `snapshot_id`. Normalized at the client boundary.

**8. An empty result is a completed run, not a pending one.** Bright Data's own Python boilerplate treats a non-empty array as the completion signal, so a legitimate zero-row result reads as "still building" and times out.

---

## Layout

```
backend/     Node + TypeScript      persistent host (Render, Railway, Fly)
frontend/    Next.js 15             Vercel
driftmart/   Next.js 15             persistent host, NOT serverless
```

```
backend/src/
  shared/      normalization, redaction, acquisition context
  brightdata/  typed client + CLI wrapper
  contracts/   structural, learned and invariant validation
  witness/     markdown extraction with evidence spans
  incident/    classifier, prompt synthesis, approval gate, state machine
  pipeline/    observe, repair, feed
  store/       persistence boundary
  api/         HTTP surface
backend/scripts/phase0-matrix.ts    candidate-execution feasibility harness
```

---

## Deploying

| Target | Host | Root Directory | Build |
|---|---|---|---|
| API and worker | Render | repo root | `npm run build --workspace backend` |
| DriftMart fixture | Render | repo root | `npm run build --workspace driftmart` |
| Dashboard | Vercel | `frontend` | Vercel defaults, no config file |

Render is configured by [render.yaml](render.yaml). Vercel needs no config file
at all: set Root Directory to `frontend` and change nothing else.

This is an npm workspace, so `tailwindcss`, `postcss` and `autoprefixer` hoist
to the root `node_modules` and `frontend/node_modules` is never created. Vercel
already understands that and installs from the workspace root on its own. The
way to break it is to add a `vercel.json` overriding `installCommand`, because
the override runs inside `frontend/`, scopes the install to that one workspace,
and the build then dies unable to resolve `tailwindcss`. Security headers are
set in [frontend/next.config.mjs](frontend/next.config.mjs) for the same reason:
they belong to the app, not to the host.

The API hosts the monitoring worker in its own process via
`NOTICE_RUN_WORKER_IN_PROCESS`, because persistent disks require a paid Render
plan and two free services would each get their own filesystem, and therefore
their own divergent copy of every incident. Split them once there is a shared
database or disk.

DriftMart must run as a persistent instance rather than serverless functions.
Its current mode is stored on disk, and on an ephemeral per-request filesystem
a mode switch would apply to some requests and not others, which is
indistinguishable from a flaky scraper.

---

## Running it

```bash
npm install
cp .env.example .env          # add BRIGHTDATA_API_KEY

npm run build
npm test                      # 172 tests, no network required

npm run start  --workspace backend     # API on :4000
npm run worker --workspace backend     # monitoring loop
npm run dev    --workspace frontend    # dashboard on :3000
npm run dev    --workspace driftmart   # controlled target on :3002
```

The test suite runs the entire loop offline against a scripted Bright Data, including the case where a green preview hides a broken candidate.

---

## DriftMart is a test fixture

DriftMart is a controlled fault-injection target built for this project. It is **not** a real store, nothing on it is for sale, and its failures are deliberately injected rather than spontaneous. Every page says so.

It serves seven modes at one stable URL. The live page and the permanent fixture for a mode render from the same definition, so the regression corpus can never test markup the live page did not actually serve.

One mode, `genuine_price_change`, is flagged `semanticChange: true`. A correct NOTICE run must record a source change there and leave the collector alone. It is the negative case the whole design is graded against.

---

## Design decisions worth knowing

**Median and MAD, not mean and standard deviation.** One corrupted run, which is what this exists to catch, drags a mean far enough to widen the acceptable band and hide the next corruption.

**Invariants hard-fail, statistics only warn.** A user-declared fact can fail a run alone. A distribution can only say "unusual", which is not "wrong", so it triggers a witness fetch rather than a repair.

**`unknown` and `incomparable` are first-class.** A check that could not run is excluded from the score rather than counted as a pass. A field the witness could not read is never counted as disagreement. Both would otherwise manufacture confidence the system has not earned.

**`$` never resolves to a currency.** Over twenty currencies use it, and defaulting to USD is exactly the silent wrong answer being hunted.

**Approval is checked against stored state, not against the shape of a call.** Promotion requires three things, each verified against what is actually persisted: the incident's current state, derived from its own transition history, is `awaiting_approval`; a gate decision exists and every case in it passed; and the incident has not already been approved.

This is stated carefully because an earlier version got it wrong. It passed a hardcoded `from` state to the transition function and relied on that to reject illegal moves. A transition validator can only check the pair it is handed, so any caller could promote an incident that had never reached the gate, and the resulting history looked correct afterwards. A safety property asserted by the shape of a function call is not a safety property. `backend/src/pipeline/safety.test.ts` now covers each condition.

---

## Limitations

- Prose parsing resolves a lone separator with three trailing digits as thousands, so the three-decimal currencies (KWD, BHD, OMR, TND) are read wrongly from text and must be supplied structured.
- The witness reads rendered markdown. A value that exists only in an image or a PDF is invisible to it, and the comparison correctly reports `incomparable` rather than guessing.
- Whether a pending candidate can be executed before approval is platform behaviour, not something NOTICE controls. `backend/scripts/phase0-matrix.ts` establishes which of four approval strategies applies.
- The store is file-backed so a fresh clone runs with no database. The `Store` interface exists so Postgres can be added without touching orchestration.

---

## AI assistance

Built with the assistance of AI coding tools. Architecture decisions, the platform findings above, and every design tradeoff documented here were reviewed and are explainable by the author. The test suite is the check on all of it: 172 tests, including an offline end-to-end run of the full detection-to-blocked-repair loop and a dedicated safety suite covering the promotion guards.

## License

MIT
