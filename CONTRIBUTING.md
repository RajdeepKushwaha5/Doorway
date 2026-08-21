# Contributing

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). One rule decides
everything in this codebase, and a change that does not respect it will look
correct and be wrong.

## Running it

```bash
npm install
cp .env.example .env      # only BRIGHTDATA_API_KEY is required
npm run build
npm test                  # 331 tests, no network and no credentials needed
```

The whole detection-to-blocked-repair loop runs offline against a scripted
Bright Data client, so you can work on classification, gating and the feed
without an account or spending a single page load.

```bash
npm run start  --workspace backend      # API on :4000
npm run worker --workspace backend      # the scheduler
npm run dev    --workspace frontend     # dashboard on :3000
npm run dev    --workspace driftmart    # the controlled target on :3002
```

## The rules that actually matter here

This project's whole claim is that it does not publish what it cannot defend.
The code has to hold itself to that too.

**Never invent a value to fill a gap.** If a sensor could not read something,
the answer is `unknown` or `incomparable`, never a plausible default. A wrong
value that looks right is the exact failure this system exists to catch, and
shipping one from our own code would be the worst possible bug.

**`unknown` is not `fail`.** A check that could not be evaluated must not
contribute to a failure score. Keep the two apart in any new validator.

**Refusing is a feature.** When you add a path, decide what it does with
insufficient evidence before you decide what it does with good evidence.

**No absolute claims in code, comments, docs or UI.** No "100%", no "zero", no
"never breaks", no "automatically" where a human still triggers it. If a number
appears in the README or the interface, a command must reproduce it.

**Comments explain why, not what.** The code already says what it does. A
comment earns its place by recording the decision behind it, especially when the
obvious alternative is wrong. Several comments here exist because the obvious
version was tried first and failed; keep that history rather than tidying it
away.

## Tests

Tests live beside the code they cover, as `*.test.ts`, and run with Vitest.

Two rules:

1. **A bug fix arrives with a test that fails without it.** Most of the suite
   exists because something was genuinely broken once.
2. **A test states the consequence, not the mechanism.** `closes an open
   incident once the source itself recovers` tells a reader why it matters;
   `calls saveIncident twice` does not.

Anything touching promotion belongs in `backend/src/pipeline/safety.test.ts`.
Those guards are the reason it is safe to let a repair reach production
unattended, and they are the last place to be clever.

## Style

TypeScript strict, ESM everywhere, no `any`. Prefer a named type over an inline
shape once it is used twice. Keep functions short enough that the early returns
read as a list of the cases you considered.

The frontend uses Tailwind with a small token set in `tailwind.config.ts`.
Colour carries meaning here: green is verified, amber is stale or suspect, red is
withheld. Do not spend those three on decoration.

## Before you open a pull request

```bash
npm run build        # typechecks every workspace
npm test
```

CI runs both, plus a check that no environment file or key-shaped string is
committed. If you added a claim to the README, say which command reproduces it.

## Scope

Bright Data builds and repairs the collector. This project decides whether a
repair is needed and proves it worked. A change that moves us toward
re-implementing extraction, proxying or unblocking is out of scope — that is the
platform's job and it does it better.

## On linting

There is no ESLint configuration in this repository, and the `lint` script has
been removed rather than left pointing at `next lint`, which had no config to
read and launched an interactive setup wizard instead of checking anything. A
script that claims to lint and does not is worse than no script, because CI and
contributors both believe it.

The quality gates that do run are TypeScript in strict mode across all three
workspaces, and the test suite:

```bash
npm run typecheck
npm test
```
