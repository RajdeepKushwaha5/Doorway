# What we found building against Bright Data

Recorded while building Doorway, with the evidence for each. Referenced from
the README, kept here because it is long and every claim needs its receipt.

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

**5. `resume_automation_job` needs `auto_save: true`, or approval succeeds without promoting anything.** The endpoint accepts `{"message": true}`, returns HTTP 200, advances the job to `done` and reports `success: true`, and leaves production running the previous template. `auto_save` defaults to false, and it is the parameter that actually persists the approved candidate.

Reproduced twice before the cause was known. On collector `c_mstkc1rkr8mit6wut`, job `ia_msvikpe02i5a3id7b2` reached `step: user_approval` with a `preview_result` showing the repair working: `{"price": {"value": 249, "currency": "USD"}}`. Approval returned HTTP 200 and the job completed `done`. A fresh trigger 90 seconds later (`j_msvj08aq2ac0smaxj2`) returned `price: 0` again. A second run on 2026-08-17 (job `ia_mswmuyq11k2h1grrzj`) was sharper still, because the shapes disagreed: the approved candidate carried `title`, `availability`, `upc` and `rating`, while production returned a row carrying `symbol` and none of those four. Production was running a different template from the one that had just been approved.

**This was our bug, not a platform defect, and the correction belongs here rather than in a footnote.** Raised with Bright Data support on 2026-08-17. Their AI agent first suggested the IDE's separate *Save to Production* step, which does exist but belongs to a flow this project never uses. A human engineer answered on 2026-08-18 and identified the real cause:

> "Your payload was `{"message": true}` with `auto_save` omitted (it defaults to false). Per the schema, `auto_save: true` is what 'saves the approved template automatically once the job completes successfully.' Since you didn't set it, the approved candidate may not have been saved as production — which is consistent with the collector still returning the old fields."

Fixed in `backend/src/brightdata/client.ts`: acceptance now sends `{"message": true, "auto_save": true}`, and it is sent only on acceptance because the parameter takes effect only when the job succeeds.

**Reproduced a third time on 2026-08-19, through the CLI.** On
`c_mszt6dg019q6p244j6`, `bdata scraper heal` produced a candidate whose
`preview_result` read `product_page_url: /search?q=Nova`. `bdata scraper approve`
returned `status: done` and finished on `completed_steps: [..., step_advance,
user_approval]`. Production still returned `/product/headphones`, the old
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
webinar, Bright Data's product marketer diagnosed a participant with exactly
it: *"It might have been in a dev version. It might have not saved it to
production. That could be the reason."*

What survives all of it, and it is the part that matters: **a call reported complete success for an operation that changed nothing in production.** Every signal a caller has access to, HTTP 200 and `success: true` and `status: done`, was green while the collector kept serving the wrong value. The engineer's own closing advice is to distrust exactly that: *"Check the job's final status — confirm it went to done, not just that the approve call returned `success: true`,"* and then *"trigger the collector and verify the fields now match the approved preview."*

That second sentence is post-promotion verification, described by Bright Data, and it is what NOTICE already does. It is also what caught this: the gate re-checked production, found the old value, and refused to mark the incident resolved. The system was right and the operator was wrong, which is the outcome a safety layer exists to produce.

Done often doesn't mean successful, and here the reason was a defaulted parameter rather than anything broken. A pipeline that trusted `success: true` would have marked this collector repaired and resumed publishing zero for a fortnight.

**6. A screenshot response is labelled `Content-Type: application/json`.** `POST /request` with `data_format: screenshot` returns PNG bytes, verified by the magic number `89 50 4e 47`, under a JSON content type. A client that branches on the header will try to parse an image, and one that trusts it cannot tell a successful capture from an error payload. NOTICE checks the magic number instead.

**7. The trigger response names a field differently from every reader.** `POST /dca/trigger` returns `collection_id`; every other endpoint reads the same value as `snapshot_id`. Normalized at the client boundary.

**9. Some sites are blocked pending KYC, and the refusal names the reason.** Attempting a regional retailer through Web Unlocker returned:

```
policy_20140 Residential Failed (bad_endpoint): Requested site is not available
for immediate residential (no KYC) access mode in accordance with robots.txt.
```

Recorded because it is worth knowing before you plan a target list, and because it is the platform behaving well rather than badly: the refusal is explicit, it cites `robots.txt`, and it points at the form that lifts it. Bright Data's own product marketer described the same policy in the launch webinar: *"we purposefully block by default... we want to understand what is the purpose and then enable it to your account."* We did not pursue it, so the fleet stays on long-tail funding pages that permit it and a fixture we own.

**8. An empty result is a completed run, not a pending one.** Bright Data's own Python boilerplate treats a non-empty array as the completion signal, so a legitimate zero-row result reads as "still building" and times out.

---


## Don't take our word for it

Every claim on this page can be re-run, and the raw output of each run is
committed in [`docs/evidence/`](docs/evidence/) rather than retyped here.

### 1. Every safeguard you already have passes a wrong row

`npm run blindspot -- c_mt36mo6tj37dmjgqh` triggers the real Scraper Studio
collector, reads the row back from `/dca/dataset`, and runs nine genuine checks
against it: a real Zod schema, a range check with a lower bound, type, null,
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
It encodes it in the words next to it, which is exactly what the second sensor
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

