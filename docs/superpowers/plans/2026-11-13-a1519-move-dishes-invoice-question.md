# A1519: moving every dish off a full-invoice bill asks first

**Authority.** Queued in lane L by the watcher, 2026-11-13 08:31: "Move dishes asks the same
question Merge bills already asks, with the same answers, reusing its code
(docs/superpowers/plans/2026-11-12-r4-merge-recipient.md). Anything beyond that question is a
DEVIATION. Short plan, one Claude read, then build; delete the backlog entry in the PR." The
merge question itself is the owner's answer of 2026-11-11 ~18:30 ("alert the waiter and ask"),
recorded in that plan; carrying it over to Move dishes is the watcher's decision, not a recorded
owner answer. FISCAL: the customer on a bill decides which invoice is filed, so the
branch takes the full review wave with two Codex angles, and the owner lands it.

**Outcome.** When **Move dishes…** would take every dish off a bill set for a full invoice (F1)
for a customer the destination does not already name, the till asks the merge question before
moving, and the server refuses such a move that does not answer it for both bills as they stand.
Today (`docs/backlog.md` A1519) the move goes through silently; at **Finish table** the emptied
bill is abandoned with the customer on it (`closeParty`, `apps/server/src/parties.ts:820-836`) and
the dishes are invoiced as the destination is set.

**Not built (no real event, or outside the question):**

- A move that leaves at least one dish on the bill asks nothing: the bill keeps its customer and
  its remaining dishes are still invoiced to them, exactly as today.
- A move that empties the bill behaves as a merge in every respect, including merge's fill rules
  (`carryMergeInvoice`, called whenever the check ran, as `mergeCheckedBills` does): when the
  destination keeps its own invoice it takes the moved-from bill's receipt language if it has
  none, and its delivery when both name the same customer.

## Server

`moveDishes` (`apps/server/src/bill-actions.ts:232`) gains `invoiceChoice: unknown` in its command;
the route (`apps/server/src/till-api.ts:4152`) passes `body.invoiceChoice` as merge's route does
(`till-api.ts:4228`).

After `resolveMoveLines`, it decides whether the move **empties** the bill: every top-level line
(`parentLineId` null) of `fromBillId` is among the transfers. Only then:

- Existing destination: `checkMergeInvoice(tx, toBillId, fromBillId, command.invoiceChoice)` runs
  before `requireBillEditors`, as in `mergeCheckedBills` (`bill-actions.ts:163`).
- New bill (`toBillId` null): the check runs after `createOpenOrder` makes the new bill, against
  it. The new bill has no customer, so the question applies whenever the moved-from bill names one,
  and the only valid choice is `keep: "from"` with `into: null` (`parseChoice` already refuses
  `keep: "into"` with `into` null as `management.request_invalid`). A refusal rolls the new bill
  back with the transaction.
- Then `carryMergeInvoice(tx, destinationId, invoices)` runs **before** `moveCheckedDishes`, as in
  merge, so the dishes are checked against the simplified-invoice limit as the destination will be
  invoiced (`refuseOrderOverSimplifiedLimit`, `working-order.ts:1309`).

When the move does **not** empty the bill, a malformed `invoiceChoice` is refused by `parseChoice`
as `management.request_invalid`, as on a move that empties it, and a well-formed one with the same
`bill.merge_invoice_choice_required`: the till sends a choice only when its read showed every dish
leaving, so the two disagree only if the bill changed (every writer that adds a dish moves the
party revision `guardPathParty` checks, so this should not happen, but an answer of "invoice Acme"
must never be dropped silently).

No new error code: the refusal is merge's `bill.merge_invoice_choice_required` (409, params
`{ workingOrderId, intoWorkingOrderId }`), with `intoWorkingOrderId` the destination (for a new
bill, the id that was rolled back; the till does not read it). The moved-from bill keeps its own
invoice columns; it is abandoned at **Finish table** as today, and holds no dishes to invoice.

## Till

`apps/till/src/state/merge-invoice.ts`: `MergeInvoiceQuestion.into` becomes `PartyBill | null`
(null: a new bill), and `mergeInvoiceQuestion` gains the new-bill case (`intoBillId` null → asks
whenever `from` names a customer). `mergeInvoiceNames` and `mergeInvoiceChoice` handle `into: null`
as a simplified receiving bill.

`#onMoveDishes` (`apps/till/src/till-app.ts:17293`) gains an optional choice. Before
`#askDifferentPeople`, with no choice yet, it checks whether the picked line ids are every
top-level line of the bill on screen, from the lines the till already holds for that bill; if so
and `mergeInvoiceQuestion` applies to `this.partyBills`, it opens the question instead of moving.
An answer moves again, sending the choice, and skips `#askDifferentPeople`: under either answer
the destination ends up a full invoice (**Invoice {name}** for the receiving bill is offered only
when it already is one), and an emptying move splits nothing. `api.moveDishes` (`apps/till/src/api/client.ts:4884`) gains
the optional `invoiceChoice` and sends it in the body.

`#renderMergeInvoiceQuestion` (`till-app.ts:15630`) takes the move's wording when the ask is a
move (a `kind: "merge" | "move"` on `mergeInvoiceAsk`). Titles are merge's
(`table.merge_invoice_title`, `table.merge_invoice_both_title`) and so is **Invoice {name}**
(`table.merge_invoice_keep`). New strings, EN then ES:

- `table.move_invoice_text`: **{from} is set for a full invoice to {name}. Moving every dish puts
  them on {into}, invoiced to {name}.** / **La {fromInText} está a nombre de {name} para factura
  completa. Si mueves todos los platos, pasan a la {intoInText}, facturada a {name}.**
- `table.move_invoice_new_text`: **{from} is set for a full invoice to {name}. Moving every dish
  puts them on a new bill, invoiced to {name}.** / **La {fromInText} está a nombre de {name} para
  factura completa. Si mueves todos los platos, pasan a una cuenta nueva, facturada a {name}.**
- `table.move_invoice_both_text`: **{into} is invoiced to {intoName} and {from} to {fromName}.
  The dishes can be invoiced to only one.** / **La {intoInText} se factura a {intoName} y la
  {fromInText} a {fromName}. Los platos solo se pueden facturar a uno de los dos.**
- `table.move_invoice_action`: **Move and invoice {name}** / **Mover y facturar a {name}**
- `table.move_invoice_cancel`: **Do not move** / **No mover**, first in the footer as in merge.
- `table.move_invoice_changed` (shown when the server refuses and a fresh read no longer raises
  the question): **The bills' invoice details have changed. Check them and move the dishes
  again.** / **Los datos de factura de las cuentas han cambiado. Revísalos y vuelve a mover los
  platos.**

On `bill.merge_invoice_choice_required` from a move, the till re-reads the bill's dishes and the
party's bills; if the move still takes every dish and the question applies to the fresh read it
opens it at once, otherwise it shows `table.move_invoice_changed`, as `#onMergeBills` does (`till-app.ts:17186-17191`). Look at the
three move forms in both themes and at phone width; screenshots are shown to the owner, never
committed.

## Guide and backlog

- `apps/server/src/guide/en/table-service.md` `{#move-dishes}`, after the **Move to** paragraph:
  "If a bill is set for a full invoice and you move every dish to a bill that does not name the
  same customer, the till asks first: choose the customer the dishes are invoiced to, or **Do not
  move**."
  Spanish twin in `guide/es/table-service.md`.
- `{#full-invoice}` (EN line 61-62, ES twin): "Merging bills asks before a full invoice's
  customer would change." becomes "Merging bills, or moving every dish to another bill, asks
  before a full invoice's customer would change."
- Delete A1519 from `docs/backlog.md`.

## Tests, red first

Server, `apps/server/src/move-dishes.test.ts`, new `describe("A1519 moving every dish off a
full-invoice bill")`, reusing `party-bill-actions.test.ts`'s `fullInvoice` setup shape (move it
to a shared testing file only if both files need it):

1. "refuses moving every dish of a full-invoice bill onto a simplified bill without a choice,
   changing nothing" (first; code and both bills' lines and invoice columns unchanged).
2. "carries the customer, delivery and language onto the bill the dishes join when told to keep
   the moved-from bill's".
3. "moving every dish to a new bill carries the customer when told to, and refuses without a
   choice, leaving no new bill".
4. "keeps the receiving bill's own customer when told to".
5. "refuses when the receiving bill's invoice changed after the till asked".
6. "asks nothing when one dish stays on the full-invoice bill".
7. "asks nothing when the receiving bill names the same customer".
8. "refuses a choice sent with a move that leaves a dish on the bill, changing nothing".
9. "every dish, one with an extra, counts as emptying" (a fixture dish with an extra: comparing
   all lines instead of top-level ones would never ask).
10. "moves every dish of a full-invoice bill over the simplified limit onto a simplified bill once
    its invoice is kept" (a venue with `simplifiedInvoiceLimit` set; every other test venue has it
    null, so only this case fails if the carry runs after the dishes move).

Route, `till-api.bill-actions.test.ts` (or the file holding the move-dishes route cases): the
choice travels, and the refusal answers 409 with the code. Filing,
`apps/server/src/move-merge.filing.test.ts`: "moving every dish off an Acme bill and keeping Acme
files one F1 naming Acme". Till, `apps/till/src/till-app-parties.test.ts`: each form's text and
buttons; **Do not move** sends nothing; each answer sends its `invoiceChoice`; a move leaving a
dish asks nothing; the refusal re-reads and reopens, or shows `table.move_invoice_changed`.
`apps/till/src/state/merge-invoice` tests cover the new-bill case.

Commands: `pnpm exec vitest run <files>` in `apps/server` and `apps/till`, plus
`src/guide-content.test.ts` in `apps/server`; at the root `pnpm exec vitest run
scripts/guide-links.test.ts`.

**Fiscal gate.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (golden) and
`inmutabilidad.test.ts` pass unedited. Nothing changes in `computeHuella`, the chain, numbering,
`registros_facturacion` or the record builders: only `working_orders` columns are written, through
the same `carryMergeInvoice` a merge uses.

**Size.** Production about +90–130 (server 20–30, till 50–80, wording and guide 20); tests about
+200–300. One PR: the server refusal without the till's question would refuse every such move.
