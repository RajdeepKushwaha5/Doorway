# Doorway

**Describe the future you want. Doorway turns official scholarships, fellowships, internships,
grants and research programmes into a living opportunity world, then keeps every important field
accurate as the web changes.**

Doorway is one product with three internal systems:

1. The Collector Foundry uses a coding agent and Bright Data Scraper Studio to turn long-tail
   official pages into durable structured sources.
2. The Opportunity Engine normalizes those records and creates transparent student matches.
3. The Trust Engine, developed under the internal name NOTICE, verifies high-consequence fields,
   separates genuine source changes from extractor failures, and proves repairs before restoring a
   quarantined opportunity.

The public APIs are `GET /api/doorway/opportunities` and `POST /api/doorway/world`. The existing
collector, witness, incident and repair APIs remain the internal Trust Engine.

---

## Trust Engine: NOTICE

**When a collector and an independent Bright Data witness disagree, the collector broke. When they agree but differ from history, the world changed. When the evidence conflicts, NOTICE refuses to heal.**

NOTICE is the incident-to-verified-repair layer for Bright Data Scraper Studio. It detects silent collector corruption, works out whether the page changed or the extractor drifted, sends the real incident to Self-Healing, and blocks a proposed repair from reaching production until it has been proven on the page that actually failed.

---

## For judges

The shortest product walkthrough takes about two minutes.

1. Describe a student profile on the home page. Doorway turns verified Scraper Studio rows into
   an isometric world and ranks every visible opportunity with an explainable score.
2. Open an opportunity. Its source, deadline, funding, eligibility and verification method remain
   visible beside the application link.
3. Open the Trust Engine at `/engine`. The controlled fixture demonstrates the failure that
   ordinary schema checks miss: a plausible field can be structurally valid and semantically wrong.
4. Run the collector. Scraper Studio supplies the structured row, Web Unlocker supplies an
   independent selector-free reading, and NOTICE either records a genuine source change or
   quarantines the broken field.
5. Trigger Self-Healing. The proposed template is replayed against the incident and the regression
   corpus before Doorway allows the opportunity back into the public world.

Mutating routes require `NOTICE_ADMIN_TOKEN`. The controlled source identifies itself as a fixture
on the page and in every seeded opportunity; it is never presented as a real institution.

From a clone, with no Bright Data account and no credentials:

```bash
npm install && npm test          # 342 tests, no network
```

With an API key, to reproduce the claims in this README:

```bash
npm run blindspot -- c_msvllpds1n1dcoz8qx   # every conventional check passes a wrong row
npm run benchmark                            # the Drift Discrimination Score table
npm run demo:reset                           # put the fixture and the fleet back
```

---

## Check the verdict yourself

A dashboard is the weakest possible place to prove something: it renders
whatever it is told. So every incident exports as a **certificate** — the
verdict, what the witness read, the line it read it from, and a SHA-256 of the
page body it read — sealed with a digest over all of it.

```bash
curl https://doorway-api-4ftn.onrender.com/api/incidents/<id>/certificate
```

Paste it into [`/verify`](https://doorway-frontend-snowy.vercel.app/verify). The
digest is re-derived **in your browser with no network calls**, because a
verifier that asked our server whether our own document is valid would prove
nothing. Change one character in any value and it fails.

Honest limit, stated on the page too: this detects editing, not forgery. It is
a digest, not a signature, so it proves the document is unaltered rather than
proving NOTICE issued it. The claim worth checking is the one about the
evidence.

---

## Don't take our word for it

Every claim on this page can be re-run, and the raw output of each run is
committed in [`docs/evidence/`](docs/evidence/) rather than retyped here.

### 1. Every safeguard you already have passes a wrong row

`npm run blindspot -- c_msvllpds1n1dcoz8qx` triggers the real Scraper Studio
collector, reads the row back from `/dca/dataset`, and runs nine genuine checks
against it — a real Zod schema, a range check with a lower bound, type, null,
presence, retry. Verbatim from
[`docs/evidence/blindspot.txt`](docs/evidence/blindspot.txt):

```text
  [PASS]  Request succeeded           HTTP 200 from /dca/trigger
  [PASS]  Response is valid JSON      parsed into an object without error
  [PASS]  Row is not empty            4 fields returned
  [PASS]  Required field present      'price' exists on the row
  [PASS]  Field is not null           price = 25
  [PASS]  Type check                  typeof price resolves to a number (25)
  [PASS]  Range check                 price > 0
  [PASS]  Schema validation (Zod)     every field matched its declared type
  [PASS]  Retry logic                 never fired, because nothing failed

All 9 checks passed. Nothing downstream has any reason to hesitate.

collector said     25
witness said       249
agreement          disagree
```

The checks are deliberately generous. A strawman here would make the result
worthless, and these still miss a price wrong by a factor of ten.

### 2. The score, computed rather than asserted

`npm run benchmark` runs six live cases and computes what three methods
conclude about each. Full output in
[`docs/evidence/benchmark.txt`](docs/evidence/benchmark.txt), machine-readable
in [`evals/dds.json`](evals/dds.json):

```text
Method                              Detection /4   Restraint /2    DDS
Status, schema, null, type, range   2              2               67%
Change monitor, alert on any diff   4              1               83%
NOTICE, two independent sensors     4              2               100%
```

### 3. The leading adaptive scraper returns the wrong number here, and says nothing

[Scrapling](https://github.com/d4vinci/Scrapling) has 75k stars and does the
thing everyone reaches for when a scraper breaks: *"Smart Element Tracking —
relocate elements after website changes using intelligent similarity
algorithms."* Record an element once, and when the page changes it finds it
again by structural similarity.

It is good, and it works. Run it yourself:

```bash
pip install scrapling
python docs/evidence/scrapling-comparison.py
```

Both cases use the DriftMart markup verbatim, and the output is committed in
[`docs/evidence/scrapling-comparison.txt`](docs/evidence/scrapling-comparison.txt):

```text
CASE A  a class is renamed, the value stays put
        .selling-price  ->  .price-value,  still $249
        Scrapling returned: '$249'
        CORRECT, relocation worked exactly as advertised

CASE B  the class survives and now wraps a different fact
        .selling-price still matches, but it is the $25 deposit
        the real price moved to <strong>, still $249
        Scrapling returned: '$25'
        WRONG, returned 25 when the page's price is 249
        No error, no warning. Structurally there was nothing to fix.
```

**Case A is the point in its favour, and it is not a small one.** A renamed
class is the most common way a scraper dies, and relocation solves it without a
human touching a selector.

**Case B is not a relocation problem at all.** The selector never broke. It
still matches, still resolves to one element, still returns a valid number. What
moved was the *meaning* underneath it. There is no structural signal to follow,
so a correct-looking answer comes back with the same confidence as a real one.

That is the distinction this whole project turns on:

| | Question asked | Signal used | When it is wrong |
|---|---|---|---|
| Adaptive relocation | where did my element go? | structural similarity | returns the wrong element, confidently |
| NOTICE | is this value correct? | two sensors that cannot fail alike | withholds, and says why |

They are not competitors. Relocation is the better answer to a rename, and
nothing here relocates anything. But no amount of structural cleverness can tell
you that `$25` is a deposit, because the page does not encode that structurally
— it encodes it in the words next to it. Which is exactly what the second sensor
reads.

Three things in their source say the same thing more precisely than we can.
Read at v0.4.14, commit `5d213a2`:

- **`percentage: int = 40`** ([`parser.py:520`](https://github.com/D4Vinci/Scrapling/blob/main/scrapling/parser.py)
  and four other signatures). Relocation accepts the best-scoring element on
  the page provided it is at least 40% structurally similar to the one that
  used to be there. When nothing clears the bar, the library's own warning
  suggests moving the bar: *"Lower `percentage` if this is the right element."*
- **The relocation benchmark measures milliseconds, not correctness.** Their
  README's "Element Similarity" table reports 2.3ms against AutoScraper's
  12.58ms under the heading that adaptive element finding "significantly
  outperforms alternatives." There is no accuracy figure anywhere. That missing
  number is what the [Drift Discrimination Score](#evaluation-the-drift-discrimination-score)
  measures.
- **A relocation becomes the new reference.** `save(elements[0], identifier)`
  runs after a successful relocate when `auto_save` is on, and storage is
  `INSERT OR REPLACE`. Relocate onto the wrong element once and the wrong
  element becomes the definition of what you asked for.

That last one is not a criticism so much as the reason one of our rules exists:
NOTICE will not learn a baseline, or a page shape, from a run no human accepted
and no second sensor confirmed.

And the technique is worth borrowing, pointed at a different question. Their
similarity scoring answers *where did my element go*, which is a guess. The
same measurement answers *is this even the same document*, which is checkable,
and NOTICE now uses it to make the witness prove it read the right page before
it is allowed to accuse the collector. A consent wall scores 31%; a page whose
price changed scores 100%. See [`backend/src/witness/shape.ts`](backend/src/witness/shape.ts).

### 4. Bright Data, on why nothing in the platform reports this

Not our characterisation. Their support engineer, asked directly on 2026-08-18:

> "Self-Healing and schema validation are both built around missing/null/undefined
> fields, not semantically wrong ones. [...] **There is no built-in
> correctness/semantic check comparing the meaning of an extracted value against
> what it should represent. That validation is expected to be caught outside the
> platform.**"

> "**There is no automatic diff/comparison of a candidate against prior
> known-good results as a gating step.** The docs don't describe any such
> regression check — so you're not missing a hidden feature here."

### 5. A verdict you can re-check without us

Every incident exports as a hash-sealed certificate, and
[`/verify`](https://doorway-frontend-snowy.vercel.app/verify) re-derives the digest
in your own browser with no network calls. Change one character and it fails.

```bash
curl https://doorway-api-4ftn.onrender.com/api/incidents/<id>/certificate
```

### 6. In the Bright Data console

The account's own view of the run that returned the wrong value: every request
delivered, nothing errored, nothing spent.

<!-- docs/screenshots/web-access-dashboard.png -->
<!-- docs/screenshots/refactor-progress.png -->

*Screenshots pending.* Until they are committed this section stands on the five
above, all of which a reader can reproduce themselves.

---

## Proved three ways

Every claim here is demonstrable in under a minute, and each one has a command.

| | Claim | How it is shown |
|---|---|---|
| **1** | **It broke, and nothing noticed** | Nine real checks — status, schema, null, type, range — all pass a price that is wrong by a factor of ten. `npm run blindspot` |
| **2** | **We caught it, and we can say why** | Two Bright Data sensors read the same page; the disagreement names the field, the line it was read from, and carries a screenshot of the page at that moment. `npm run live -- run` |
| **3** | **The fix is proved, not trusted** | A repair is replayed against the page that failed *and* every pinned regression case before promotion, then production is re-verified afterwards. `npm run live -- heal` |

And the fourth thing, which is the one most systems get wrong: when the source
recovers on its own, the incident closes itself and the value returns to the
feed. Detecting that something is fixed is the same problem as detecting that
it broke, and it takes the same evidence.

---

## Live

| | |
|---|---|
| Dashboard | https://doorway-frontend-snowy.vercel.app |
| API | https://doorway-api-4ftn.onrender.com/api/health |
| DriftMart fixture | https://doorway-lab.onrender.com |

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

The CLI documentation describes the same shape, as a sequence a person walks
through:

> "The flow is run, inspect, heal, approve, re-run."

Asked directly in a Scraper Studio webinar whether healing can fire by itself,
Bright Data's technical product manager for Scraper Studio answered. These are
spoken quotes, transcribed from the recording with repeated words removed and
nothing else changed:

> "How is the self-healing triggered? Do you have to ask it to fix it or can it be triggered automatically? **For now, it is you going to trigger it.**"

> "**We don't have the fully automated solution yet**, but we're looking into it."

And on how to close that gap in the meantime:

> "When a scraper breaks, you can trigger a self-healing. In our documentation we also have an API for the Scraper Studio. You can basically run self-healing when something is broken so that you can continuously fix that, **so that you don't have to intervene manually**."

Asked directly whether the platform surfaces a value that is wrong rather than
missing, and whether a repaired template is checked against previous output
before promotion, Bright Data answered both. Their AI support agent replied
first, on 2026-08-17, that *"the docs do not describe automatic detection of a
semantically wrong but non-empty value after a layout change, and they do not
describe validation against previous known-good output before promotion."*

A human engineer answered on 2026-08-18 and put it more plainly than the
documentation does. On detection:

> "You've identified this correctly: Self-Healing and schema validation are both
> built around missing/null/undefined fields, not semantically wrong ones. [...]
> **There is no built-in correctness/semantic check comparing the meaning of an
> extracted value against what it should represent. That validation is expected
> to be caught outside the platform.**"

And on validating a repair before it ships:

> "**There is no automatic diff/comparison of a candidate against prior
> known-good results as a gating step.** The docs don't describe any such
> regression check — so you're not missing a hidden feature here. [...]
> validation-before-promotion is real but it's your manual preview review, not
> an automated comparison against historical output."

Those two paragraphs describe exactly what NOTICE is: the correctness check the
platform expects to happen outside it, and the automated regression gate that
does not exist inside it. This is a Bright Data engineer describing the gap,
not a claim made on their behalf.

That is the seam this project sits in. Bright Data builds and repairs the
collector and exposes the API to drive the repair. What nobody supplies is the
judgement in between: noticing that a run is wrong when it looks right,
deciding whether the page changed or the extractor drifted, and proving a
proposed repair before it reaches production.

NOTICE is the part that decides.

Worth being precise about what that means, because Bright Data is consistent on
it. The repair is automated: Self-Healing rewrites extraction from a
plain-language description, and it works. What is not automated is the step
before it, deciding that a repair is needed at all. Their documentation, their
CLI flow and their product manager all say the same thing, and none of them
claim otherwise. The gap is acknowledged rather than hidden, and this is the
part that fills it.

Put another way: getting a collector working is an afternoon. Keeping it right
for a year is the actual job, and today that needs a person who happens to
notice. This automates that person.

---

## How Bright Data Scraper Studio is used

Scraper Studio is the sensor this entire project is built around. Everything
else exists to decide whether to trust what it returns.

### The scrapers were built from a sentence, through the CLI

Both collectors were created from a coding agent's terminal, not by hand:

```bash
npx -p @brightdata/cli bdata scraper create   "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html"   "Extract the book title, the price excluding tax as a number, and the availability text"
```

Bright Data's AI pipeline runs eight stages and returns a collector id. Elapsed
time was about three minutes.

| Collector | Target | Fields |
|---|---|---|
| `c_msvllpds1n1dcoz8qx` | DriftMart, the controlled fixture | `product_name`, `price`, `availability` |
| `c_msvk2zahnc2mizts6` | `books.toscrape.com`, a site we do not control | `book_title`, `price_excl_tax`, `availability` |

Neither is from the Scrapers Library. Real output from both is in
[examples/](examples/).

### A collector that drives the page, and the failure nothing else caught

Every other collector here is one `navigate` away from its data. That is the
easy case, and it never touches the browser functions Scraper Studio exposes
for the harder one.

`c_mszt6dg019q6p244j6` operates
[`/search`](https://doorway-lab.onrender.com/search), where no price exists
until a term is typed and a button pressed. It was built with
`bdata scraper create`, then corrected with `bdata scraper heal` when the first
version tried to shortcut to the product page instead of using the form. The
stages are in
[`examples/interaction-collector/`](examples/interaction-collector/):

```js
navigate(input.url);
wait('#site-search');
type('#site-search', input.term);
click('#do-search');
wait('.results');
collect(parse());
```

**Then switch the fixture to `search_drift`.** The form renames the field it
submits, `q` to `query`, and leaves the input's id alone — the ordinary shape of
a front-end refactor.

Every step still succeeds. Real run, real collector:

```json
{
  "product_name": "Vega Earbuds",
  "price": 79,
  "availability": "In stock",
  "product_page_url": "https://doorway-lab.onrender.com/search?query=Nova"
}
```

The box was found. The text was typed. The button was clicked. Results
rendered. A product parsed, with a real price, in stock. The row is complete and
schema-valid, and it is **the wrong product** — the server never received the
term and fell back to a featured item.

#### Why nothing in the platform reports this

Not a criticism, and not a guess. Bright Data's own support engineer, asked
directly:

> "Self-Healing and schema validation are both built around missing/null/undefined
> fields, not semantically wrong ones. [...] There is no built-in
> correctness/semantic check comparing the meaning of an extracted value against
> what it should represent. That validation is expected to be caught outside the
> platform."

There is nothing here for Self-Healing to trigger on. No field is null, nothing
errored, the request succeeded and the dataset row is valid. The Web Access
dashboard counts one more successful request. **The only symptom is that the
answer is wrong.**

#### What NOTICE did

```
verdict     : extractor_drift
quarantined : true
publishable : false
evidence    : "price": collector reported 79, witness read 249 from "Price: $249"
```

And it needed **no new detection logic**. The witness reads the canonical URL
for the intended query; the collector reaches its answer by interacting. When
the interaction drifts they land on different page states and the existing rule
fires — the same rule that catches a moved price selector, applied one layer
earlier, in the automation rather than in the markup.

### The plain-language field description is the contract

Scraper Studio repairs extraction against the sentence describing a field, not
against a selector. That makes the sentence the durable artefact, so NOTICE
stores the same description twice over:

- as the collector's field description in Scraper Studio
- as the witness's `meaning`, which is what the second sensor matches on

One sentence therefore drives detection **and** repair. When a repair is
requested, that description travels with the incident URL in `custom_input`,
which is the part the CLI drops.

### Every part of the collector lifecycle is driven over the API

| Scraper Studio surface | Used for |
|---|---|
| `POST /dca/trigger` | every observation and every candidate replay |
| `GET /dca/dataset` | reading structured rows back |
| `POST /dca/collectors/{id}/refactor_template` | requesting a repair, with the failing page as evidence |
| `GET .../refactor_template/progress` | following the eight-stage repair and its approval gate |
| `POST .../resume_automation_job` | answering that gate, `{"message": true}` |
| `version: dev` | running the proposed template before it is production |

### What the structured output powers

The rows a collector returns are the input to a verdict, and that verdict is
what everything downstream consumes: a verified feed, an MCP server that
refuses rather than guessing, a CI step that fails a build, a webhook, and a
GitHub issue.

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

## Run it as an automation, not a dashboard

Set a collector's policy to `on_gate_pass` and the loop closes with no human in
it:

```
observe → detect → repair → replay → promote → re-verify production
```

Bright Data's technical product manager, asked whether repair can fire by
itself: *"For now, it is you going to trigger it. We don't have the fully
automated solution yet."* This is that, with the part that makes it safe.

Automation here is earned rather than assumed. A candidate is promoted only
after it has been replayed against the page that failed **and** the pages that
were already working, and production is re-verified afterwards against the full
contract. A promotion that does not actually fix production escalates instead
of reporting success, which is precisely the case Bright Data's own
`success: true` missed on a real collector this month.

Automation also requires the evidence to be strong enough. The gate checks a
candidate against values the witness read, so it is only as trustworthy as that
reading. The extractor grades its own work: 0.95 for structured data the page
published about itself, 0.85 for a value sitting beside its label, 0.35 for a
bare amount with nothing naming it. A repair promotes itself only when the
weakest field clears 0.7, judged by the weakest rather than the average,
because the weak field is the one a wrong repair goes unnoticed on. Below that
it still gets an incident, a repair and a gated candidate, and then asks a
person.

The default is `never`. A collector earns automation by being understood, not
by being registered.

---

## Stop a deploy that depends on data nobody checked

```yaml
- uses: RajdeepKushwaha5/Doorway/actions/verify@main
  with:
    api-base: https://doorway-api-4ftn.onrender.com
    collector: c_msvk2zahnc2mizts6
```

A pipeline already refuses to ship on a failing test or a type error. It will
happily ship a price, a dashboard or a model trained on a number a broken
scraper invented last Tuesday, because nothing in it distinguishes data from
correct data.

This step fails the build when two independent Bright Data sensors do not
currently agree on the data the repository consumes, and prints which source
and why. `allow-stale` decides whether a value nobody has re-checked is good
enough for your case, because that depends on what the build does with it.

Incidents can also be filed where the team already works. Set
`NOTICE_GITHUB_REPO` and `NOTICE_GITHUB_TOKEN` and a break opens an issue
carrying both readings, the line the witness read, and the rendered capture of
the page. One issue per collector and field, not per run: a collector observed
every six hours would otherwise file four a day about one unresolved fault.

---

## Driven from a coding agent, end to end

The Grand Prize criterion asks how the scraper was **driven from a coding
agent**, so this is the whole loop, agent-operated, with the safety property
intact.

```bash
claude mcp add notice -- npm run mcp
```

Read-only by default. Set `NOTICE_ADMIN_TOKEN` and three operational tools
appear:

| Tool | Drives |
|---|---|
| `observe_source` | `POST /dca/trigger`, then classify the row against the witness |
| `repair_source` | `refactor_template`, with the page that actually failed as evidence |
| `promote_repair` | `resume_automation_job`, **only if the candidate passed the gate** |

Without the token those three are never registered, rather than registered and
failing. A tool an agent cannot see is a tool it cannot decide to try.

`promote_repair` is the point. An agent can diagnose a break and drive
Self-Healing, and it cannot ship a repair nobody proved:

```
REFUSED. The repair for inc-9 was not promoted.

reason  candidate did not pass the gate: broke 1 regression case

This is the gate working. Do not approve this repair through the Bright
Data API to work around it, and do not retry unchanged: a candidate that
cannot fix the failing page without breaking a working one is not a fix.
```

That refusal is returned as an **outcome, not an error**, on purpose. An agent
handed an error retries; an agent handed a reason stops. And the last line
exists because the failure mode of a capable agent is to route around the
guard — so the guard says, in words, not to.

Also deliberate: `observe_source` tells an agent **not** to repair a
`genuine_source_change`. The most expensive thing an autonomous repair loop can
do is rewrite a collector that was working, and the tool that would start that
repair is the right place to stop it.

---

## Use it from an AI agent

```bash
claude mcp add notice -- npm run mcp
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
| Witness read a consent wall instead | "value changed" | `inconclusive`, and it says which labelled fields went missing |

Sending a genuine source change to Self-Healing rewrites a collector that was working. That is the failure mode NOTICE exists to avoid as much as the corruption itself.

### Why this only matters at scale, which is the same reason Bright Data does

Bright Data's own framing is that you do not need them for ten pages. You need
them when you are pulling thousands, because that is when blocking, rendering
and retries stop being someone's afternoon.

Verification has exactly the same shape. Scrape one page and you check it by
eye. Scrape a thousand across fifty collectors and nobody checks anything, so a
selector that quietly moved onto the wrong element is invisible by construction
and stays invisible until a customer finds it.

That is why the parts of this that look like over-engineering are the parts that
matter: contracts learned per collector rather than hand-written, a page-load
budget that pauses monitoring instead of quietly spending the month's
allowance, and a scheduler that fans out across every watched URL. None of it
earns its keep on two pages. All of it is required on two thousand.

### Why the Bright Data console does not already show this

Reasonable first objection, since the platform surfaces a lot. All of it is about delivery. A console can report that a request succeeded because it watched the request; it cannot report that a value is wrong, because nothing in it ever learns what the value was supposed to be.

| Surface | What it answers | What it is silent on |
|---|---|---|
| Web Access dashboard | Requests delivered, bytes moved, credits spent | Which response carried the wrong field |
| Event log | A request that errored or was blocked | A request that succeeded through a drifted selector |
| Scrapers Library | Domains Bright Data maintains for you | The custom collector you built, which is not on that list |
| Self-Healing | Repairs a template, once you trigger it | That it needed repairing in the first place |
| Discover API | Which URLs exist for a query | Whether what you extracted from one is true |

During the run recorded in [`examples/`](examples/), the account dashboard showed every request delivered and nothing spent, while the collector returned a refundable deposit in the price field. No figure on that screen could have moved.

You do not have to take that on trust. One command reproduces it end to end:

```bash
npm run blindspot -- c_msvllpds1n1dcoz8qx
```

It switches the fixture to a drifted layout, triggers the real Scraper Studio collector, reads the row back, and runs every check a careful team would already have written against it:

```text
  [PASS]  Request succeeded           HTTP 200 from /dca/trigger
  [PASS]  Response is valid JSON      parsed into an object without error
  [PASS]  Row is not empty            4 fields returned
  [PASS]  Required field present      'price' exists on the row
  [PASS]  Field is not null           price = 25
  [PASS]  Type check                  typeof price resolves to a number (25)
  [PASS]  Range check                 price > 0
  [PASS]  Schema validation (Zod)     every field matched its declared type
  [PASS]  Retry logic                 never fired, because nothing failed

All 9 checks passed. Nothing downstream has any reason to hesitate.

witness value      249
confidence         0.85  (labelled-line)
read from line 15   "Purchase price: **$249**"
```

The checks are deliberately not strawmen: the schema is a real Zod schema, the range check has a lower bound, and the row must be non-empty. Every one of them passes a row whose price is wrong by an order of magnitude. Run it with `--mode genuine_price_change` and the same nine checks pass a row that is correct, which is the point: passing tells you nothing either way.

---

## Evaluation: the Drift Discrimination Score

Detection is the axis everyone measures, and measuring it alone is what makes a
change monitor look finished. It is not. A monitor that alerts on any
difference catches every corruption **and** fires on every legitimate price
change, and treating the second like the first rewrites a collector that was
working. So this scores two axes over the same six cases:

- **Detection** — of the cases that *are* faults, how many did the method catch?
- **Restraint** — of the cases that are *not* faults, how many did it leave alone?

**DDS** is how often the method reached the correct decision. Full marks on
either axis alone caps a method at 67%.

| Method | Detection /4 | Restraint /2 | DDS |
|---|---|---|---|
| Status, schema, null, type, range | 2 | 2 | **67%** |
| Change monitor, alert on any diff | 4 | 1 | **83%** |
| NOTICE, two independent sensors | 4 | 2 | **100%** |

*Reproduce with `npm run benchmark`. Runs live against the deployed fixture and
writes [`evals/dds.json`](evals/dds.json) with every reading and verdict.*

Nothing in that table is asserted. Each method is executed against the fixture
and its verdict computed, so a row you doubt can be re-run. The conventional
checks are deliberately generous — a real range check catches `silent_zero`,
a real required-field check catches `missing_field` — because a strawman here
would make the result worthless. They still miss the two cases that matter
most: a price reading the refundable deposit, and a price reading a sponsored
card, both of which are positive numbers that pass every check.

The row that decides it is `genuine_price_change`. The price really did move to
229. The change monitor raises an alarm and, wired to a repair tool, would
rewrite an extractor that was working perfectly.

| Case | Collector saw | Witness saw | NOTICE concluded |
|---|---|---|---|
| `baseline` | $249 | 249 | sensors agree, leave alone |
| `genuine_price_change` | $229 | 229 | sensors agree, leave alone |
| `selector_drift` | $25 | 249 | `extractor_drift` |
| `silent_zero` | 0 | 249 | `extractor_drift` |
| `sponsored_insertion` | $99 | 249 | `extractor_drift` |
| `missing_field` | absent | absent | `inconclusive`, withheld |

The last row is worth reading twice. Availability vanished from the page, so
**both** sensors are blind. NOTICE does not guess in either direction — it
withholds and says why. `pagination_collapse` is deliberately excluded: its
fault is a repeated row rather than a wrong field value, and scoring it here
would measure something this benchmark does not test.

---

## What we found building against the platform

Documented because it shaped the architecture, not as criticism.

**1. The CLI does not forward incident inputs to Self-Healing.** `bdata scraper heal --url <page>` places the URL only in the printed next-step hint. The request body it sends is `{"prompt": "...", "custom_input": []}`, so the healer never sees the page that failed. NOTICE calls `POST /dca/collectors/{id}/refactor_template` directly and puts the incident URL in `custom_input`.

Still true on CLI v0.3.5, where the tool now documents it itself. Run `bdata scraper heal --help`:

```text
--url <url>   Verify target woven into the next-step hint. Not sent to
              the heal call; heal only mutates the scraper.
```

That is the vendor stating the limitation in their own words, which is better evidence than our observation of the request body.

**2. `bdata scraper run --version=dev` returns production output, not the candidate.** Verified on a live collector with a repair pending at the approval gate. The candidate used a scoped selector that provably fixed the incident, the preview showed it fixed, and running with `--version=dev` reproduced production's exact failure. On a page where both templates agree, the two runs are byte-identical. Anyone who believes they are testing a proposed repair before approving it is testing the code they already have.

**3. `resume_automation_job` expects `{"message": boolean}`.** Not an action string. The API rejects `{"action":"approve"}` with `"action" is not allowed`, and `{"message": 12345}` with `"message" must be a boolean`. True accepts the repair, false rejects it. The gate stays open until answered, so an unanswered candidate blocks later heals on that collector.

**4. Self-Healing progress signals the gate through `step`, not `status`.** The live payload is `{id, step, completed_steps, status, diff, success, preview_result}`. At the gate it reads `step: "user_approval"` with `status: "pending_answer"`. Matching on `status` alone reports a waiting job as pending and polls it to timeout.

**5. `resume_automation_job` needs `auto_save: true`, or approval succeeds without promoting anything.** The endpoint accepts `{"message": true}`, returns HTTP 200, advances the job to `done` and reports `success: true` — and leaves production running the previous template. `auto_save` defaults to false, and it is the parameter that actually persists the approved candidate.

Reproduced twice before the cause was known. On collector `c_mstkc1rkr8mit6wut`, job `ia_msvikpe02i5a3id7b2` reached `step: user_approval` with a `preview_result` showing the repair working: `{"price": {"value": 249, "currency": "USD"}}`. Approval returned HTTP 200 and the job completed `done`. A fresh trigger 90 seconds later (`j_msvj08aq2ac0smaxj2`) returned `price: 0` again. A second run on 2026-08-17 (job `ia_mswmuyq11k2h1grrzj`) was sharper still, because the shapes disagreed: the approved candidate carried `title`, `availability`, `upc` and `rating`, while production returned a row carrying `symbol` and none of those four. Production was running a different template from the one that had just been approved.

**This was our bug, not a platform defect, and the correction belongs here rather than in a footnote.** Raised with Bright Data support on 2026-08-17. Their AI agent first suggested the IDE's separate *Save to Production* step, which does exist but belongs to a flow this project never uses. A human engineer answered on 2026-08-18 and identified the real cause:

> "Your payload was `{"message": true}` with `auto_save` omitted (it defaults to false). Per the schema, `auto_save: true` is what 'saves the approved template automatically once the job completes successfully.' Since you didn't set it, the approved candidate may not have been saved as production — which is consistent with the collector still returning the old fields."

Fixed in `backend/src/brightdata/client.ts`: acceptance now sends `{"message": true, "auto_save": true}`, and it is sent only on acceptance because the parameter takes effect only when the job succeeds.

**Reproduced a third time on 2026-08-19, through the CLI.** On
`c_mszt6dg019q6p244j6`, `bdata scraper heal` produced a candidate whose
`preview_result` read `product_page_url: /search?q=Nova`. `bdata scraper approve`
returned `status: done` and finished on `completed_steps: [..., step_advance,
user_approval]`. Production still returned `/product/headphones` — the old
template. Approving the next candidate with `auto_save: true` finished on
`[..., user_approval, save_new_template]`, and production changed on the next run.

`save_new_template` is the step that promotes, and it appears only when
`auto_save` is set.

**To be exact about whose mistake this is: ours again, twice over.** The API
takes `auto_save` and the CLI takes `--auto-save`, documented in its own
`--help`. Neither is the default, and we passed neither. There is no platform
defect here.

What is worth reporting is the shape of the default. Approving without it
returns HTTP 200, reports `success: true`, advances the job to `done`, and
promotes nothing. Every signal available to the caller is identical whether or
not the template shipped; the only way to tell is to read `completed_steps` for
`save_new_template`, or to go and look at production. That is a footgun rather
than a bug, and it is one people fall into: in the organisers' own launch
webinar, Bright Data's product marketer diagnosed a participant with exactly it
— *"It might have been in a dev version. It might have not saved it to
production. That could be the reason."*

What survives all of it, and it is the part that matters: **a call reported complete success for an operation that changed nothing in production.** Every signal a caller has access to — HTTP 200, `success: true`, `status: done` — was green while the collector kept serving the wrong value. The engineer's own closing advice is to distrust exactly that: *"Check the job's final status — confirm it went to done, not just that the approve call returned `success: true`,"* and then *"trigger the collector and verify the fields now match the approved preview."*

That second sentence is post-promotion verification, described by Bright Data, and it is what NOTICE already does. It is also what caught this: the gate re-checked production, found the old value, and refused to mark the incident resolved. The system was right and the operator was wrong, which is the outcome a safety layer exists to produce.

Done often doesn't mean successful — and here the reason was a defaulted parameter rather than anything broken. A pipeline that trusted `success: true` would have marked this collector repaired and resumed publishing zero for a fortnight.

**6. A screenshot response is labelled `Content-Type: application/json`.** `POST /request` with `data_format: screenshot` returns PNG bytes, verified by the magic number `89 50 4e 47`, under a JSON content type. A client that branches on the header will try to parse an image, and one that trusts it cannot tell a successful capture from an error payload. NOTICE checks the magic number instead.

**7. The trigger response names a field differently from every reader.** `POST /dca/trigger` returns `collection_id`; every other endpoint reads the same value as `snapshot_id`. Normalized at the client boundary.

**9. Some sites are blocked pending KYC, and the refusal names the reason.** Attempting a regional retailer through Web Unlocker returned:

```
policy_20140 Residential Failed (bad_endpoint): Requested site is not available
for immediate residential (no KYC) access mode in accordance with robots.txt.
```

Recorded because it is worth knowing before you plan a target list, and because it is the platform behaving well rather than badly: the refusal is explicit, it cites `robots.txt`, and it points at the form that lifts it. Bright Data's own product marketer described the same policy in the launch webinar — *"we purposefully block by default... we want to understand what is the purpose and then enable it to your account."* We did not pursue it, so the fleet stays on `books.toscrape.com` and a fixture we own.

**8. An empty result is a completed run, not a pending one.** Bright Data's own Python boilerplate treats a non-empty array as the completion signal, so a legitimate zero-row result reads as "still building" and times out.

---

## Known issues

Recorded rather than hidden, because a project arguing for honest reporting of
data quality should report its own.

**Three high-severity advisories reach us through Next.js.** `npm audit
--omit=dev` reports `postcss` and `sharp` (libvips CVEs) as transitive
dependencies of `next@15`. `sharp` is Next's image optimiser and this dashboard
never invokes it: `next/image` appears nowhere in the source, and the one image
served, a PNG from the API, is rendered through a plain `<img>` precisely
because the optimiser has nothing to optimise on an arbitrary remote capture.
The fix is a Next major bump, which is not something to do the day before a
demo, so it is named here instead of being quietly carried.

**The free-tier store does not survive a restart.** Render's free plan has no
persistent disk, so a redeploy or a spin-down after fifteen minutes idle clears
runs, incidents, accepted baselines and verified snapshots. Seeding restores
collector definitions only. Everything reappears after one `npm run live --
observe-all`, and the fix is a paid disk or Postgres behind the existing `Store`
interface.

**The worker's own orchestration has no dedicated tests.** Ticking, job
claiming, scheduling and automatic promotion are exercised incidentally by the
pipeline suites rather than directly. The 331 tests cover detection,
classification, gating and the API well; they cover worker restart mid-repair
and duplicate job claims not at all.

**Per-collector schedules are not parsed.** Any non-null `schedule` string
enables the global interval rather than the cadence it names, and registration
sets it to null with no way to change it from the interface.

---

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers how to run it, the conventions this
codebase holds itself to, and what is deliberately out of scope.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the map: the data flow, what
each module owns, and four decisions that are not obvious from the code.

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
  witness/     markdown extraction with evidence spans, and the page-identity check
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
at all: set Root Directory to `frontend` and add nothing but environment
variables.

Those variables are not optional, and leaving them out fails in a way that
looks like working software. The dashboard renders, the data loads, and every
control appears live until somebody presses one:

| Variable | Without it |
|---|---|
| `NEXT_PUBLIC_NOTICE_API_BASE` | The browser talks to `localhost:4000` and the live decision stream never connects |
| `NOTICE_API_BASE` | Server-rendered pages fall back to the public value, which is usually fine |
| `NOTICE_ADMIN_TOKEN` | Every run, heal, approve and reject is refused. Reads still work |
| `DRIFTMART_ADMIN_TOKEN` | The fault console cannot switch the fixture, so the whole break-it-yourself walkthrough is dead |

Both tokens must match the ones the corresponding service is running with, and
neither takes a `NEXT_PUBLIC_` prefix, which would publish it in the browser
bundle. The console now reports which of these it is missing rather than
leaving the buttons looking operable, but the only fix is to set them.

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
npm test                      # 342 tests, no network required
npm run seed                  # repeat-safe local Doorway world and NOTICE incident
npm run dev                   # API :4000, dashboard :3000, controlled source :3002

# Or run each process separately:
npm run start  --workspace backend
npm run worker --workspace backend
npm run dev    --workspace frontend
npm run dev    --workspace driftmart
```

The local seed never calls Bright Data or spends credits. It gives the public Doorway world one
clearly labeled, contract-only controlled opportunity and preserves the NOTICE drift incident so a
fresh clone has a complete walkthrough. It deliberately does not claim live two-sensor confirmation.
Replace it with live Scraper Studio collectors for the submission run.

The test suite runs the entire loop offline against a scripted Bright Data, including the case where a green preview hides a broken candidate.

Three commands prove the claims against live Bright Data rather than a mock:

```bash
npm run blindspot -- <collector-id>   # every conventional check passes a wrong row
npm run prove                          # the two-sensor rule across four scenarios
npm run live -- run <collector-id>     # one real observation, end to end
```

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

Built with the assistance of AI coding tools. Architecture decisions, the platform findings above, and every design tradeoff documented here were reviewed and are explainable by the author. The test suite is the check on all of it: 342 tests, including an offline end-to-end run of the full detection-to-blocked-repair loop and a dedicated safety suite covering the promotion guards.

## License

MIT
