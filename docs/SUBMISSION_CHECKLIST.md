# Submission checklist

Into the Scrape-Verse, Web-Slinger track. Judged on six equally weighted
criteria: potential impact, creativity, technical excellence, use of Scraper
Studio, reliability and self-healing, presentation.

Tick a box only when the thing is done and verified, not when it is planned.

## Blocking — the submission is incomplete without these

- [ ] **Demo video recorded and uploaded.** Script at `notice-demo-script.md`,
      timed to 3:30. Presentation is one of six criteria and the only one that
      cannot be inferred from the repository.
- [ ] **`notice-api` redeployed on Render.** `autoDeploy` is `false` in
      `render.yaml`, so pushing does nothing to the live API. Manual Deploy →
      Deploy latest commit. Without it the currency, recovery and seeding fixes
      are not live.
- [ ] **All three services warm and answering** immediately before submitting:
      dashboard, API `/api/health`, DriftMart. Free tier sleeps after 15 minutes.
- [ ] **Devpost form filled** with the repo link, the live dashboard link and the
      video link.

## Evidence a judge can check without trusting us

- [ ] `npm run blindspot -- c_msvllpds1n1dcoz8qx` runs clean end to end
- [ ] `npm run benchmark` reproduces the DDS table and rewrites `evals/dds.json`
- [ ] `npm test` passes offline, no network needed
- [ ] `examples/` contains real collector output from both collectors
- [ ] Bright Data console screenshots committed under `docs/screenshots/`
- [ ] README shows the platform findings with job ids that can be quoted back

## Presentation

- [ ] At least three animated GIFs in the README: the control room breaking the
      page, an incident with its evidence, the verified feed recovering
- [ ] "Don't take our word for it" section with console screenshots
- [ ] Architecture diagram that is readable on a phone
- [ ] README opens with something moving, not a paragraph

## Reliability of the demo itself

- [ ] `npm run live -- mode baseline` run last, so the fixture is not left broken
- [ ] Store reseeds from `seed-collectors.json` on a cold boot
- [ ] Dashboard renders correctly with the API asleep — every fallback labelled
      as an example rather than presented as live
- [ ] No API key visible in any recording or screenshot

## Honesty pass

Every one of these was found and fixed during the build. Re-check before
submitting, because they came back more than once.

- [ ] No invented domains, collector ids, or site names anywhere in the UI
- [ ] No speed or cost claims — verification is slower and costs two page loads
- [ ] No "automatic" where a human still triggers it
- [ ] No absolute claims: no "100%", no "zero", no "never breaks"
- [ ] Every number in the README matches what the code actually produces
- [ ] Test count in README and hero matches `npm test`
- [ ] Every nav link resolves to a section that exists

## Final sixty seconds

- [ ] `git status` clean, everything pushed
- [ ] `.env`, `data/`, and the demo script still untracked
- [ ] Open the deployed dashboard in a private window and click through it once
      as a stranger would
