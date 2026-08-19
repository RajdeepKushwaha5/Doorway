// Scraper Studio — Parser stage
//
// Reads the first result card. `text_sane()` normalises whitespace, and Money
// carries the currency alongside the number so a downstream comparison is not
// left guessing what "79" means.

const card = $('.result').first();

return {
  product_name: card.find('.result-title').text_sane(),
  price: new Money(card.find('.selling-price').text_sane().replace(/[^0-9.]/g, ''), 'USD'),
  availability: card.find('.stock').text_sane(),
  sku: card.attr('data-sku'),
};
