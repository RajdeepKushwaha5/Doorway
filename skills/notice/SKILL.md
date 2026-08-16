---
name: notice
description: Operate a fleet of Bright Data Scraper Studio collectors under continuous verification. Use when asked to check collectors, investigate scraper output that looks wrong, decide whether a website changed or a scraper broke, run Self-Healing safely, or approve a proposed repair. Also use when asked about silent data corruption, extractor drift, or why a collector's output cannot be trusted.
---

# NOTICE

NOTICE decides whether a website changed or a collector broke, then repairs only the second case and only after proving the repair works.

## Before anything else

Run `npm run build` once, then:

```bash
export BRIGHTDATA_API_KEY="..."
alias notice="node backend/dist/scripts/notice.js"
```

If `BRIGHTDATA_API_KEY` is unset, every command that touches the network will fail immediately rather than half-working.

## Decide before you act

Every incident carries one of six verdicts. Read it before doing anything.

- `genuine_source_change` — the collector and the independent witness **agree**, and the value simply moved. The scraper is fine. **Do not heal.** Report the change.
- `extractor_drift` — the witness **disagrees** with the collector. Extraction moved, the page did not. This is the case that gets repaired.
- `explicit_failure` — an error row or an empty result. Repairable.
- `access_anomaly` — the two sensors observed different regions, devices or variants. Retry with aligned context. Not the collector's fault.
- `inconclusive` — evidence too weak to convict. Quarantine and escalate to a human.
- `healthy` — nothing to do.

The most common mistake is healing a `genuine_source_change`. That rewrites a working collector because a price moved.

## Workflow

```bash
notice collectors                # what is open
notice check <collectorId>       # observe once and classify
notice show <incidentId>         # evidence, witness lines, timeline
notice heal <incidentId>         # diagnose, heal, replay candidate, gate
notice approve <incidentId>      # promote, only after the gate passed
notice feed <collectorId>        # what a downstream consumer receives
```

Use `--json` when you need to parse output. Use `--url <U>` to target one page.

## Reading a check result

`notice check` prints the verdict, a confidence, and the evidence lines that produced it. The evidence is the point. A line like:

> "price": collector reported 25, witness read 249 from "Purchase price: $249"

tells you the collector is reading the wrong element. A line like:

> the independent witness reports the same values as the collector, so extraction is intact and the source itself changed

tells you to leave it alone.

## Reading a gate result

`notice heal` ends with a matrix:

```
  PASS  incident                 
  FAIL  baseline layout          price.value numeric mismatch
```

The incident row must pass, and every regression row must pass. If either fails, the repair is blocked and production is untouched. Report the matrix to the user rather than summarizing it as "it worked" or "it failed".

## Rules

1. **Never approve on a green preview.** Bright Data's Self-Healing preview may test a page other than the one that failed. A preview passing while the candidate is still broken has been observed on a real collector. Only the gate matrix counts.
2. **Never use `--auto-approve`.** It removes the only check between a plausible repair and production.
3. **Never heal a `genuine_source_change` or an `access_anomaly`.**
4. **Never collapse `inconclusive` into a decision.** Missing evidence is not evidence.
5. **Do not replace the API heal call with the CLI.** `bdata scraper heal --url` does not forward the URL; its request body carries `custom_input: []`, so the healer would never see the failing page.

## Adding a collector

A collector needs its Bright Data id, the URLs to watch, and a witness spec per field. The witness spec is what lets NOTICE read the page independently:

```json
{
  "path": "price",
  "meaning": "the current non-refundable purchase price",
  "labels": ["purchase price", "price"],
  "excludeLabels": ["deposit", "refundable", "mrp", "was"],
  "kind": "money"
}
```

`excludeLabels` matters more than it looks. Without it the witness takes the first currency amount on the page, which after a redesign is often the deposit, and then both sensors agree on a wrong value and NOTICE reports health while the data is corrupt.

Declare invariants for facts the user knows to be true, such as `price > deposit` or `price >= 1`. Do not invent them from data; a statistic cannot know that a deposit should be smaller than a price.

## Demonstrating it

DriftMart is a controlled fault-injection fixture, not a real store. Say so whenever you mention it.

```bash
curl -X POST "$DRIFTMART_URL/api/admin/mode" \
  -H "authorization: Bearer $DRIFTMART_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"mode":"selector_drift"}'
```

To show the distinction NOTICE exists to make, run `genuine_price_change` and `selector_drift` back to back. The first must produce no repair. The second must produce one.
