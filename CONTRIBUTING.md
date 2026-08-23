# Contributing

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). One rule decides
everything in this codebase, and a change that does not respect it will look
correct and be wrong.

## Running it

```bash
npm install
cp .env.example .env      # only BRIGHTDATA_API_KEY is required
npm run build
npm test                  # 676 tests, no network and no credentials needed
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

## What the scripts do

`npm run` prints twenty of these and explains none of them. The line that
matters is the last column: anything marked **live** reads real pages through
Bright Data and draws on the same 5,000-a-month allowance both sensors share.

| Command | What it does | Cost |
|---|---|---|
| `npm run check` | Typecheck, lint, then the tests. The gate CI runs | free |
| `npm test` | 676 tests against a scripted Bright Data client | free |
| `npm run seed` | Put a realistic incident in the local store, so a fresh clone shows something other than three empty states | free |
| `npm run doorway:seed` | Same, for the opportunity world: a city rather than an empty field | free |
| `npm run blindspot:proof` | Replay the unwatched-field incident offline. Every value is computed by the functions production uses | free |
| `npm run shots` | Screenshot every page at phone, tablet and desktop into `.visual-qa/`, and report any horizontal overflow | free |
| `npm run legibility` | Print what a scanner actually sees in each section: the label, the heading, the first line, and any section over two screens tall | free |
| `npm run mcp` | Start the MCP server, so an agent can drive the system | free |
| `npm run notice` | The CLI, against the local file store. Useful in development, wrong for a demo: the deployed dashboard has a different store | free |
| `npm run live` | The same operations over HTTP against the deployed API, so the terminal and the dashboard agree | **live** |
| `npm run prove` | Demonstrate the two-sensor rule end to end against the fixture | **live** |
| `npm run blindspot` | Demonstrate why that rule has to exist: a corrupted row passing every conventional check | **live** |
| `npm run benchmark` | Score each method on telling a broken extractor from a changed world. Writes `evals/dds.json` | **live** |
| `npm run phase0` | The candidate-execution matrix. Answers whether an unapproved Self-Healing candidate can be run before promoting it | **live** |
| `npm run demo:reset` | Put the fixture back to baseline and re-observe everything | **live** |

Every one of these files opens with a comment saying why it exists. Read that
before running the live ones.

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
npm run check
```

That is typecheck, then lint, then the tests, in that order, and it is the
same order CI runs them. CI adds a check that no environment file or
key-shaped string is committed. If you added a claim to the README, say which
command reproduces it.

## Scope

Bright Data builds and repairs the collector. This project decides whether a
repair is needed and proves it worked. A change that moves us toward
re-implementing extraction, proxying or unblocking is out of scope. That is
the platform's job and it does it better.

## On linting

`npm run lint` is real. For a long time it was not: the script pointed at
`next lint`, which had no config to read and launched an interactive setup
wizard instead of checking anything, so it was deleted rather than left in
place. A script that claims to lint and does not is worse than no script,
because CI and contributors both believe it.

The configuration in `eslint.config.mjs` is chosen rather than inherited, and
explains itself at each decision. Two things to know before you add a rule:

**Formatting is not in here.** Arguing about semicolons in review costs more
attention than it saves, and TypeScript already refuses the errors that break
things.

**The `unsafe-*` family is off on purpose.** This codebase reads JSON from
Bright Data, from its own store and from the browser, and narrows every one of
those from `unknown` at the boundary. That is the careful version, and it is
exactly what those rules fire on. Leaving them on produced a thousand warnings
against the pattern we want, which teaches a reader to ignore the linter.

What is left is the set that catches a reader out: a promise nobody waited
for, a condition that can never be true, an `any` that quietly turns off the
type system a few files away from where it was written.

A `no-unnecessary-condition` warning usually means one of two things, and they
want opposite fixes. Either the guard really is dead, in which case delete it
and let the missing branch become a compile error; or the type is claiming
more than the data can keep, in which case fix the type. Only when the
compiler is genuinely wrong about the runtime, as it is about `JSON.stringify`
returning `undefined`, does a disable directive belong there, and it names the
reason on the line above.

## Looking at the pages

Every UI change in this repository was, for a long time, reasoned about rather
than seen. That is a bad way to build an interface and an impossible way to
check one: the architecture diagram shipped a box that stretched to fill its
grid column for two rewrites, because it looked correct in the source and
nobody could see the screen.

```bash
npm run shots        # every route at 390, 768 and 1440, into .visual-qa/
npm run legibility   # the three-second test, per section
```

`shots` also reports horizontal overflow per page, which is the single most
common way a layout that looks finished on a laptop is broken on a phone, and
which never appears in a screenshot because the screenshot is as wide as the
content.

`legibility` prints only what a reader takes in when they land on a section and
give it three seconds: the label above the heading, the heading, and roughly the
first line. Reading the output is the test. A heading that needs its own
paragraph to make sense has failed, and that is far easier to see in a list of
headings than on the page, where the surrounding prose quietly explains it for
you. It flags any section over two screens tall for the same reason.

Both write to `.visual-qa/`, which is gitignored. Screenshots are for looking
at, not for committing.
