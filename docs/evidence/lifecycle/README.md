# The lifecycle, with receipts

Every file here is raw output from one real run against the deployed services.
Nothing is reformatted, staged or generated for presentation. The commands are
listed so you can produce your own.

## The short version

While the source page was serving **1 September 2026** as the closing date, a
consumer of this feed was still receiving **18 September 2026**.

The wrong value was never published. That is the entire argument of this
project, and files 05, 06 and 08 are enough to check it without trusting a word
of this README.

| | Value |
|---|---|
| What the page said before the break | `18 September 2026` |
| What Bright Data returned after it | `1 September 2026` |
| Verdict the two sensors reached | `extractor_drift`, on `deadline_raw` |
| Withheld from the feed | yes |
| **What a consumer actually received** | **`18 September 2026`** |

## The chain

| # | Step | Command | Artifact |
|---|---|---|---|
| 1 | The registered fleet, including how each collector was created. | `GET /api/collectors` | [`01_collector.json`](01_collector.json) |
| 2 | The source page, correct. | `curl <page>` | [`02_page_baseline.html`](02_page_baseline.html) |
| 3 | Both sensors read the page and agree. Verdict: healthy. | `npm run live -- run <collector>` | [`03_run_baseline.txt`](03_run_baseline.txt) |
| 4 | The source page is switched to serve a wrong value, not a missing one. | `npm run live -- mode deadline_drift` | [`04_break.json`](04_break.json) |
| 5 | The same page now shows an early-interest date above the real deadline. | `curl <page>` | [`05_page_broken.html`](05_page_broken.html) |
| 6 | A successful run. Valid JSON, every field present, and the deadline is wrong. | `bdata scraper run <collector> <page>` | [`06_collector_output_broken.json`](06_collector_output_broken.json) |
| 7 | The sensors disagree on one field. Verdict: extractor_drift. | `npm run live -- run <collector>` | [`07_verdict.txt`](07_verdict.txt) |
| 8 | The wrong value was never published. The last agreed reading still stands. | `npm run live -- feed <collector>` | [`08_feed_withheld.json`](08_feed_withheld.json) |
| 9 | Bright Data Self-Healing writes a candidate repair. | `npm run live -- heal <incident>` | [`09_heal.txt`](09_heal.txt) |
| 10 | The candidate is replayed before it can ship. The gate decides, not the flag. | `npm run live -- show <incident>` | [`10_gate.txt`](10_gate.txt) |


## What happened to the repair

`npm run live -- heal` asked Bright Data Self-Healing for a candidate. The job
finished as **`failed`**.

```
Bright Data returned HTTP 500: Invalid ide automation
```

The platform declined to produce a candidate for this collector, so there was
nothing for the gate to replay and it did not run. That is recorded here rather
than retried until it looked better: a chain that only shows the runs that went
well is not evidence.

Gate cases replayed: **0**. The record stays
quarantined either way, which is the behaviour that matters: a repair that does
not exist cannot promote, and neither can one that fails.

## Reproduce it

```bash
npm run evidence -- --with-heal
```

Roughly six Bright Data page loads, more with `--with-heal`. It resets the
fixture to `baseline` afterwards, so running it twice is safe.

## If you only open one thing

[`06_collector_output_broken.json`](06_collector_output_broken.json), find
`deadline_raw`. Then [`08_feed_withheld.json`](08_feed_withheld.json), same
field.

They disagree. The collector really did return the wrong date from a page that
really was serving it. The consumer never saw it.
