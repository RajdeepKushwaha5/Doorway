# How Scraper Studio is used

The collectors, how they were built from a coding agent, and what each one
watches. Referenced from the README.

## How Bright Data Scraper Studio is used

Scraper Studio is the sensor this entire project is built around. Everything
else exists to decide whether to trust what it returns.

### The scrapers were built from a sentence, through the CLI

Every collector was created from a coding agent's terminal, not by hand:

```bash
npx -p @brightdata/cli bdata scraper create   "https://doorway-lab.onrender.com/opportunity/ai-fellowship"   "Extract the opportunity title, the provider, the funding level, and the date
   applications close. Take the closing date from the label 'Application
   deadline'. Never take it from 'Early interest deadline'. Also extract the URL
   of the apply link."
```

The refusal is the half that matters. A brief naming only the field to extract
produces a scraper that takes the first plausible date in the DOM, which on a
funding page is routinely the wrong one by seventeen days.

Bright Data's AI pipeline runs through `user_intent_analyzer`,
`output_schema_generator`, `code_generator`, `preview_runner` and
`collector_mainatiner`, then returns a collector id. Measured elapsed time on
this page: **97 and 116 seconds** across two runs. Bright Data's own
documentation allows up to twenty five minutes for a complex site, so anything
built on this has to be a job with a stream rather than a request that waits.

Doorway does this itself, at runtime, from the Foundry on `/engine`. It reads
the page through Web Unlocker first and composes the brief from what is
actually there, because a scraper built from a guess about a URL is a scraper
nobody can defend.

| Collector | Target | Fields |
|---|---|---|
| `c_mt36mo6tj37dmjgqh` | Doorway Lab, the controlled fixture | `title`, `deadline_raw`, `funding_level`, `application_url` |
| `c_mt3uuz5c3gmgatqsn` | `cprgindia.org`, a site we do not control | `title`, `deadline_raw`, `funding_level` |
| `c_mt3s9p6m112ldkx8mh` | `research.adobe.com`, a site we do not control | `title`, `deadline_raw`, `funding_coverage` |
| `c_mt44fc4f2loq3t8phs` | `latrobe.edu.au`, a site we do not control | `title`, `deadline_raw` |
| `c_mt44l71t10f3gdtrs7` | `wemakedevs.org`, a site we do not control | `title`, `deadline_raw` |
| `c_mt44nnhx3cd5t6wy1` | `devpost.com`, a site we do not control | `title`, `deadline_raw` |

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
submits, `q` to `query`, and leaves the input's id alone: the ordinary shape of
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
schema-valid, and it is **the wrong product**. The server never received the
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
fires: the same rule that catches a moved price selector, applied one layer
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
guard, so the guard says, in words, not to.

Also deliberate: `observe_source` tells an agent **not** to repair a
`genuine_source_change`. The most expensive thing an autonomous repair loop can
do is rewrite a collector that was working, and the tool that would start that
repair is the right place to stop it.

---

