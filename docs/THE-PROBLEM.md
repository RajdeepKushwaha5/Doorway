# The problem, in full

The long version of why a scraper that succeeds is more dangerous than one
that fails. Summarised in the README.

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

