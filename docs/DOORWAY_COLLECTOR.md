# Doorway Scraper Studio collector

Doorway never fills an empty world with invented opportunities. At least one custom Scraper Studio
collector must produce the schema below and complete a verified run before a building appears.

## Controlled source

After deploying the fixture, the repeatable demonstration source is:

```text
https://<doorway-lab-host>/opportunity/ai-fellowship
```

It is a controlled source, not a real fellowship. Use real official opportunity sources alongside
it in the submission.

## Coding-agent command

```bash
npx @brightdata/cli scraper create \
  https://<doorway-lab-host>/opportunity/ai-fellowship \
  "Extract one opportunity record: title, provider, opportunity_type, summary, eligibility array, interests array, funding_level, funding_amount, funding_currency, funding_coverage array, deadline as ISO date, deadline_raw, locations array, remote boolean, required_documents array, application_url as an absolute URL, and source_url. Application deadline must not be an early-interest date." \
  --name doorway-ai-fellowship \
  --pretty \
  -o doorway-collector-create.json
```

The creation envelope returns the `collector_id`. Register it with the Doorway Trust Engine using
the source URL and witness specifications for these high-consequence fields:

- `deadline`: final application deadline, excluding early-interest and nomination dates
- `funding_level`: whether the programme is fully or partially funded
- `eligibility`: who may submit an application
- `application_url`: the official destination that accepts the application

Run the collector on the baseline page, inspect the row, and explicitly accept that run as the
baseline. Do not learn from an unreviewed first run.

## What becomes a building

Doorway projects only verified snapshots containing all of:

- title
- provider
- recognizable opportunity type
- valid application URL or source URL

Raw runs never feed the public world. If the Trust Engine opens a quarantine, the last verified
record remains visible with its affected fields and incident state attached.
