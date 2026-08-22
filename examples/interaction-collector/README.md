# A collector that drives the page instead of reading it

Every other collector in this project is one `navigate` away from its data.
That is the easy case, and it is where most scrapers stop.

Real catalogues are not like that. The value only appears after you type
something and press a button, so a collector has to **operate** the page.
Scraper Studio exposes browser functions for exactly this — `type`, `click`,
`wait`, `select`, `scroll_to`, `tag_response` — and a single `navigate` never
touches any of them.

This collector uses them against
[`/search`](https://doorway-lab.onrender.com/search) on the DriftMart
fixture.

## Interaction stage

```js
// Drive the search the way a person would.
navigate(input.url);

// Wait before typing. The box is server-rendered here, but a collector that
// assumes an element exists is the most common way an interaction breaks on a
// slower page, and waiting costs nothing when it is already there.
wait('#site-search');
type('#site-search', input.term);
click('#do-search');

// The results container, not a fixed delay. A sleep long enough to be safe is
// long enough to be expensive at scale.
wait('.results');

collect(parse());
```

## Parser stage

```js
const card = $('.result').first();

return {
  product_name: card.find('.result-title').text_sane(),
  price: new Money(card.find('.selling-price').text_sane().replace(/[^0-9.]/g, ''), 'USD'),
  availability: card.find('.stock').text_sane(),
  sku: card.attr('data-sku'),
};
```

## Why this is worth monitoring

A multi-step interaction has more ways to fail **quietly** than a single fetch
does, and the worst of them looks like this.

Switch the fixture to `search_drift`. The search form renames the field it
submits, from `q` to `query`, and leaves the input's id alone — the ordinary
shape of a front-end refactor.

Now every step of the interaction still succeeds:

| Step | Result |
|---|---|
| `wait('#site-search')` | found, the id did not change |
| `type('#site-search', 'Nova')` | typed |
| `click('#do-search')` | submitted |
| `wait('.results')` | results rendered |
| `parse()` | a product, with a price, in stock |

Nothing errored. Nothing was null. The row is schema-valid and the collector
reports success. It returned **Vega Earbuds at $79** for a search for Nova
Headphones, because the server never received the term and fell back to a
featured product.

Measured, on the running fixture:

```
witness   -> /search?q=Nova       -> Nova Headphones    price = 249
collector -> /search?query=Nova   -> Vega Earbuds       price = 79

sensors agree: NO  -> DRIFT DETECTED
```

## The part that matters

NOTICE needed **no new detection logic** for this.

The witness reads the canonical URL for the intended query. The collector
reaches its answer by interacting. When the interaction drifts, the two land on
different page states and the existing rule fires: the sensors disagree, so the
extractor drifted rather than the world changing.

That is the same rule that catches a moved price selector, applied to a failure
that happens one layer earlier — in the automation rather than in the markup.
