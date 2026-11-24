# Counter custom item — design

Status: approved by the owner, 2026-11-21. Second of three linked pieces of work (keyboard input,
then this, then reading scale-label barcodes); see
`docs/handoffs/2026-11-21-keyboard-custom-item-scales.md`. Replaces the open questions in
`docs/backlog/till.md`, "Custom item on the Counter (A738 residual)".

2026-11-24: where the build differs from this design; the
[plan](../plans/2026-11-21-counter-custom-item.md) has the rest. The watcher, not the owner, cleared
the pull request that makes one more hidden product, with no takeaway rate, for an item whose rate
nobody chose; and that the rate staff chose is the one a taken-away item files even if the law changes
before it is paid (Decision 10), which is an exception to "the owner's VAT model holds unchanged"
below. The hidden products are created on first use, not as starting data. "A manager cannot edit,
place or delete them" is met by never listing their ids: the server does not refuse a request that
names one.

## Why

Now and then a customer at the counter wants something that is not on the menu — a bottle the
venue does not list, something made to order. Today staff cannot ring it up at all: every order
line comes from a product on a published menu, and a weighed product does not give a free price.
The owner wants an escape hatch for that **rare one-off**, not a routine way to sell (owner,
2026-11-21).

## Approaches considered

- **A product behind each VAT rate.** Chosen by the owner, 2026-11-21. Waitron keeps one hidden
  product per takeaway VAT rate; the custom item's line points at the one whose rate staff chose.
  The rate stays on the product, so the owner's VAT model holds unchanged: the invoice reads the
  product's rate on the day the meal ends, like any other dish (memory
  `vat-class-frozen-rate-at-payment`, owner 2026-11-16 and 2026-11-21). It works with today's code,
  where products carry a VAT category, and with the planned per-product rates.
- **One product, with the rate chosen on each line.** Rejected: a single product holds one takeaway
  rate, so each custom line would have to store its own, bringing back a VAT value on order lines
  that the VAT redesign removes, and making it the one line invoices and reports treat differently.
- **No product at all.** Rejected: the line would have no VAT rate to read, no report category and
  nothing for the invoice to name it by. (The database would allow it — the set menu's heading line
  has no product — but nothing downstream could price it.)

## What gets built

1. **A dashed "+ Custom item" tile in the Counter's menu grid** (A738 board 1). Counter only,
   as the board drew it.
2. **The window** asks for:
   - **Name** — required, typed by staff; it is what the receipt, invoice, kitchen ticket and
     reports show, as typed, in every language.
   - **Price** — required, VAT included like every till price, above zero (zero is a comp, which
     the adjustments already handle). Entered on the till's number pad, which a physical keyboard
     also drives (keyboard design, item 1).
   - **Takeaway VAT rate** — asked **only on a takeaway order**; eaten in, the standard dine-in rate
     applies and the window does not ask. Shown as bare percentages (`4%  10%  21%` …), **never with
     a label** such as "Food" or "Drink" (owner, 2026-11-21). One choice per hidden product, showing
     that product's current rate.
   - **Send to** — Nowhere (the default) or one of the venue's kitchen stations.
3. **Hidden products, one per takeaway rate, created and kept by Waitron**, not set up by a
   manager. They never appear on a menu, a manager cannot edit, place or delete them, and their
   report category is "Custom items", so reports show plainly what went through this route.
   Allergens are left unreviewed (the till already marks a product whose allergens nobody has
   recorded), never shown as "contains none".
4. **Switching an order to takeaway** when it holds a custom item added while eaten in asks for that
   item's takeaway rate at the switch. (A set menu already makes this switch refuse; this asks
   instead, because the answer is one tap away.)
5. **A new permission that can be assigned to anyone** (owner, 2026-11-21), held by supervisors and
   managers by default. Someone without it who taps the tile is told why and offered, right there,
   a PIN from a person who holds it — never sent to find someone. Each custom item is recorded in
   the activity log with who added it and, where one was needed, who approved it.
6. **Everything else is an ordinary line**: quantity − n +, a note, sending to the kitchen, paying,
   cancelling and discounts work as for any dish.

## Non-goals

- The table-order screen. The board placed the tile on the Counter only; adding it to tables later
  reuses the same window.
- A price limit per person, as discounts have. The permission is the control.
- Allergens or diets on a custom item.
- A description line under the name (owner, 2026-11-21: "probably ok for now"); a kitchen note
  works as on any dish.
- Saving a custom item as a real menu product for next time.

## Constraints

- No VAT value on the order line beyond what today's code already stores for every line; whatever
  the VAT redesign removes from lines, it removes from these too.
- English and Spanish for every new word on the till and the dashboard (the permission's name), and
  the till guide's Counter section in both.
- Pre-live: the hidden products are created like any other starting data, with no migration of
  existing venues (`CLAUDE.md`, "No backwards-compatibility … until Waitron is in production").

## Left to the builder

- How the hidden products are marked as Waitron's own and kept off menus and out of managers'
  hands, and which rates exist: today, one per VAT category the code knows; under the VAT redesign,
  one per rate Waitron ships.
- The permission's identifier and its wording.
- The window's layout, within the Forms contract (`docs/developers/design-system.md` → Forms).
