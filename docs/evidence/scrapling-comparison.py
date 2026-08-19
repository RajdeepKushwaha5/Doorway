"""
Adaptive relocation versus two-sensor verification, on the same two pages.

Scrapling (75k stars) relocates an element after a page changes, using
structural similarity. That is a genuinely good answer to the most common
breakage — someone renamed a class — and this script confirms it works.

It is also a different question from the one NOTICE asks. Scrapling answers
"where did my element go?". NOTICE answers "is this value correct?". The gap
between those two shows up in one specific case, and it is the case this
project was built around:

    the selector still matches perfectly, and now wraps a different fact.

Nothing structural has broken there, so there is nothing to relocate. The
element Scrapling finds is the right element by structure and the wrong one by
meaning, and it returns it with the same confidence as a correct answer.

Run:  python docs/evidence/scrapling-comparison.py
Needs: pip install scrapling
"""

from scrapling import Selector

# The real DriftMart fixtures, copied from driftmart/lib/modes.ts so this is not
# a contrived example. Same markup the live site serves.

BASELINE = """
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="selling-price" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>
"""

# Case A: a plain rename. selling-price becomes price-value, same element, same
# value, same place. This is what adaptive matching exists for.
RENAMED = """
<div class="product">
  <h1 class="product-title">Nova Headphones</h1>
  <p class="row"><span class="label">Price:</span> <span class="price-value" data-testid="price">$249</span></p>
  <p class="row"><span class="label">Refundable deposit:</span> <span class="security-deposit">$25</span></p>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</div>
"""

# Case B: DriftMart's selector_drift, verbatim. The class name survives. It now
# wraps the refundable deposit, and the purchase price has moved to a <strong>.
SEMANTIC_DRIFT = """
<section data-product="Nova Headphones">
  <h1 class="product-title">Nova Headphones</h1>
  <div class="payment-summary">
    <p class="row"><span class="label">Refundable deposit:</span> <span class="selling-price" data-type="refundable">$25</span></p>
    <p class="row"><span class="label">Purchase price:</span> <strong data-type="purchase-price">$249</strong></p>
  </div>
  <p class="row"><span class="label">Availability:</span> <span class="stock">In stock</span></p>
</section>
"""

TRUTH = 249  # the purchase price, on every one of these pages


def read(html: str, url: str, *, save: bool = False, adaptive: bool = False):
    """Ask Scrapling for the price the way its README shows."""
    page = Selector(content=html, url=url, adaptive=True)
    found = page.css(".selling-price", auto_save=save, adaptive=adaptive)
    if not found:
        return None
    return found[0].text.strip()


def main() -> None:
    line = "=" * 74

    print()
    print("Scrapling adaptive matching, against the DriftMart fixtures")
    print(line)

    # --- Case A -------------------------------------------------------------
    print("\nCASE A  a class is renamed, the value stays put")
    print("        .selling-price  ->  .price-value,  still $249")

    read(BASELINE, "https://driftmart.test/a", save=True)
    a = read(RENAMED, "https://driftmart.test/a", adaptive=True)
    a_ok = a is not None and "249" in a

    print(f"        Scrapling returned: {a!r}")
    print(f"        {'CORRECT, relocation worked exactly as advertised' if a_ok else 'did not relocate'}")

    # --- Case B -------------------------------------------------------------
    print("\nCASE B  the class survives and now wraps a different fact")
    print("        .selling-price still matches, but it is the $25 deposit")
    print("        the real price moved to <strong>, still $249")

    read(BASELINE, "https://driftmart.test/b", save=True)
    b = read(SEMANTIC_DRIFT, "https://driftmart.test/b", adaptive=True)
    b_value = None
    if b is not None:
        digits = "".join(c for c in b if c.isdigit() or c == ".")
        b_value = float(digits) if digits else None

    print(f"        Scrapling returned: {b!r}")

    if b_value is not None and b_value != TRUTH:
        print(f"        WRONG, returned {b_value:g} when the page's price is {TRUTH}")
        print("        No error, no warning. Structurally there was nothing to fix.")
    elif b_value == TRUTH:
        print("        CORRECT")
    else:
        print("        returned nothing")

    # --- The point ----------------------------------------------------------
    print()
    print(line)
    print("Case A is what adaptive matching is for, and it works.")
    print()
    print("Case B is not a relocation problem. The selector never broke; the")
    print("meaning underneath it moved. There is no structural signal to follow,")
    print("so a valid element is returned with a valid number in it.")
    print()
    print("NOTICE reads the same page a second time through Web Unlocker, with no")
    print("selectors at all, finds 249 on the line 'Purchase price: $249', and")
    print("withholds the field because the two sensors disagree.")
    print(line)
    print()


if __name__ == "__main__":
    main()
