# Purchasing, recipes, stock and reports — detail

The open entries are listed in [the backlog](../backlog.md), under "Purchasing, recipes, stock and reports". This file holds
their full text.

## A supplier credit note cannot be entered through the dashboard

**OPEN, unqueued.** A negative gross total on the purchase-invoice routes is a supplier credit
note and is accepted and stored by design (see the supplier credit note decision below). The
dashboard form's
`inRange(this.total, 0, Infinity)`
(`apps/dashboard/src/widgets/purchase-form.ts`) refuses one, so the form refuses the very document
the ruling calls legitimate. Nobody has decided whether the form should be relaxed or the credit
note should become its own document type.

## Bundle: One design for supplier invoices and credit notes

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1326. Design what supplier invoices should be — OPEN, needs a design (owner, 2026-11-04).** A
  basic version is built: the dashboard's Purchases screen adds, edits and deletes them, and they feed
  the deductible VAT in the modelo 303. The owner treats this as future work. Until the design, a
  deleted or changed invoice leaves no trace, though it may have fed a VAT return. A1308 leaves the
  tables as they are and logs nothing.
- **A supplier credit note cannot be entered through the dashboard** — OPEN, unqueued.
  [Detail](back-office.md#a-supplier-credit-note-cannot-be-entered-through-the-dashboard)

## Decisions and deliberate limits

- **Recipes are dropped, not parked (owner, 2026-11-04).** Recipe depth (nested sub-recipes, plate
  costing, stock depletion) ended with this decision: it assumed an authoring surface that no longer
  exists. If recipes are ever wanted again, they start from a new design. A product's allergens and
  diet are what a person declares on it, and a variant inherits them.

- **Supplier invoice numbers are unique within their issue year (owner, 2026-10-21, A981).**
  The same supplier may reuse a number in another calendar year; the purchase form names the
  other recorded year before saving. Reporting continues to use the receipt date for its period.
  Adviser confirmation remains open in [Q18(b)](../compliance/asesor-questions.md).

- **A negative purchase-invoice total is a supplier credit note (owner 2026-09-21, task N1).**
  The purchase-invoice routes accept and store a negative gross total by design.

**Sales: the category report names each category by its full path (W73, #1212).** Because
every row carries its whole path, a very deep tree prints far more lines than before, and its
print preview is cut short; the owner
chose to leave it as it is rather than shorten deep paths on paper (2026-10-05).
