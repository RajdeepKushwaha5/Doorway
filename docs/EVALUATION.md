# Evaluation

How well the Trust Engine tells a broken extractor from a changed page, and
why that question is different from the one a health monitor asks.

## Evaluation: the Drift Discrimination Score

Detection is the axis everyone measures, and measuring it alone is what makes a
change monitor look finished. It is not. A monitor that alerts on any
difference catches every corruption **and** fires on every legitimate price
change, and treating the second like the first rewrites a collector that was
working. So this scores two axes over the same six cases:

- **Detection.** Of the cases that *are* faults, how many did the method catch?
- **Restraint.** Of the cases that are *not* faults, how many did it leave alone?

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
checks are deliberately generous. A real range check catches `silent_zero`,
and a real required-field check catches `missing_field`, because a strawman here
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
**both** sensors are blind. NOTICE does not guess in either direction. It
withholds and says why. `pagination_collapse` is deliberately excluded: its
fault is a repeated row rather than a wrong field value, and scoring it here
would measure something this benchmark does not test.

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
npm run blindspot -- c_mt36mo6tj37dmjgqh
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

