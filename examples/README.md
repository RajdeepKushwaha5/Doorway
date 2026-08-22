# Example structured output

Real output from the two custom Scraper Studio collectors built for this
project. Nothing here is hand-written or edited; each file is the response body
from `GET /dca/dataset` after triggering the collector.

| File | Collector | What it shows |
|---|---|---|
| `driftmart-baseline.json` | `c_msvllpds1n1dcoz8qx` | The page reading correctly |
| `driftmart-after-redesign.json` | `c_msvllpds1n1dcoz8qx` | The same collector, same URL, after the layout moved |
| `books-toscrape.json` | `c_msvk2zahnc2mizts6` | A real third-party site, not one we control |

## The pair worth reading together

Before the redesign:

```json
{ "product_name": "Nova Headphones", "price": 249, "availability": "In stock" }
```

After it:

```json
{ "product_name": "Nova Headphones", "price": 25, "availability": "In stock" }
```

Same collector, same URL, minutes apart. The second one is wrong: `25` is the
refundable deposit, and the price is still `249`. The redesign moved the
element the extractor was bound to.

Note what the failure does **not** look like. No error, no null, no missing
field, no empty array, and the currency and product name are both still
correct. The row is schema-valid and completely plausible, which is why an
ordinary pipeline ships it and nobody finds out until a customer is quoted a
price that was never real.

That gap between "the request succeeded" and "the fact is true" is the entire
reason this project exists.

## Reproducing these

```bash
# The page as it should be
npm run live -- mode baseline

# Move the layout the way a redesign would
npm run live -- mode selector_drift
```

Then trigger either collector from the CLI:

```bash
npx -p @brightdata/cli bdata scraper run c_msvllpds1n1dcoz8qx \
  https://doorway-lab.onrender.com/product/headphones --pretty
```

## What NOTICE does with them

The first is published. The second is withheld, because the independent
witness reads `Price: $249` off the same page and the two sensors disagree.
See the root README for the full loop.
