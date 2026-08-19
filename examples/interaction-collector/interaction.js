// Scraper Studio — Interaction stage
//
// Paste into the "Interaction code" editor of the collector. This is the stage
// a single navigate never exercises: the value on /search only exists after a
// term is typed and the button is pressed, so the collector has to operate the
// page rather than read it.
//
// Input: { url: "https://driftmart-3ut8.onrender.com/search", term: "Nova" }

navigate(input.url);

// Wait before typing. The box is server-rendered here, but assuming an element
// exists is the most common way an interaction breaks on a slower page, and
// waiting costs nothing when it is already present.
wait('#site-search');

type('#site-search', input.term);
click('#do-search');

// Wait on the results container rather than a fixed delay. A sleep long enough
// to always be safe is long enough to be expensive across thousands of pages.
wait('.results');

collect(parse());
