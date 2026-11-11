# R4-merge: merging bills never silently loses a full invoice's details

**Authority.** Owner, 2026-11-11 ~18:30, answering "When a merge would lose a full invoice's
details, should they move across or should the merge be refused?": **"alert the waiter and ask"**
(`~/waitron-campaign-shared/desk/done/20261111-1825-M-r4-proposals.md`). Queue: lane L, R4-merge.
Source: lane M's review R4, Important 1 (`~/waitron-campaign-m/reports/r4.md` §2). FISCAL: the
details decide which invoice is filed, so this takes the full review wave with two Codex angles.
Revised 2026-11-12 after a fresh-context plan review (one Critical, two Important).

**Outcome.** When the bill being merged away is set for a full invoice (an invoice in a named
customer's name, `invoice_type` F1, as opposed to the simplified ticket, F2) for a customer the
receiving bill does not already name, the till asks before merging, and the server refuses any
merge that does not answer that question for both bills as they stand when it arrives.

**Bug confirmed.** `mergeCheckedBills` (`apps/server/src/bill-actions.ts:242-275`) moves the lines,
unsent dishes and kitchen links, then marks the other bill abandoned; it never reads the invoice
columns (`packages/db/src/schema/orders.ts:98-109`). On main at `4261c97fd4` I applied lane M's
patch `r4/1-2.patch` plus a scratch probe, ran `pnpm exec vitest run src/move-dishes.test.ts -t
"R4-1|PROBE"` in `apps/server`, then reverted both (nothing committed). R4-1 failed: the surviving
bill read `F2`, tax number `null`. The probe set `receipt_locale = 'en-GB'` and `invoice_delivery =
{"medium":"receipt"}` on the merged-away bill; the survivor read `null`/`null`. Control: the same
probe with the values on the surviving bill passed. So **all four are lost**: the invoice type, the
six recipient columns, the receipt language and the delivery choice. Email or A4 delivery can only
be staged on an F1 bill (`apps/server/src/invoice-choice-delivery.ts:41-42`); receipt language can
be set on any bill.

**Cannot happen, so no code for it.** Both bills must be open to merge (`requireUntouchedPair` on
main; on #2866 `refuseClosedBill` plus `requireBillOfParty`, `apps/server/src/parties.ts:274-276` on
main, `:298-300` on #2866), and an issued invoice belongs to a placed or settled bill, so a bill
with an issued invoice is never merged. Read, not run: `readChoiceChangeableOrder`
(`apps/server/src/working-order.ts:4592`) looks for a sale only on a placed bill. A payment in
progress on either bill is already refused in the same transaction by `bumpRevision`
(`bill-actions.ts:268` → `refusePaymentInFlight`, `working-order.ts:5812`), so no extra check.
**Known gap, outside the owner's question, not built:** Move dishes of every dish off a
full-invoice bill, then Finish table, abandons the emptied bill with its recipient
(`parties.ts:798-811`).

**Relation to #2866** (`feat/r4-bill-rules`, open). It lets a part-paid open bill receive a merge.
This work does not depend on it and is built on main now; whoever lands second rebases. Overlap:
`mergeBills`'s checks (adjacent lines), `#onMergeBills`'s catch block in `apps/till/src/till-app.ts`,
the `mergeBills` comment in `apps/till/src/api/client.ts`, and the merge paragraph of both
`table-service.md` guides. With #2866 the receiving bill may hold a payment; carrying a full invoice
onto it is what changing the invoice by hand already allows (only F1 to F2 is locked,
`working-order.ts:4653-4660`), and the request below never turns an F1 bill into F2.

**Server: the request.** `POST /api/bills/:id/merge` (`apps/server/src/till-api.ts:4279`) gains an
optional `invoiceChoice: { keep: "into" | "from", into: Identity | null, from: Identity }`, where
`Identity` is `{ taxId, identifierType?, identifierCountryCode? }`: which bill's invoice the merged
bill keeps, and the full-invoice customer the till saw on each bill when it asked (`null` = the
receiving bill was simplified). A customer's identity is those three fields only; legal name and
address are not compared. The question **applies** when the merged-away bill is F1 and its identity
differs from the receiving bill's (or the receiving bill is F2).

**Server: the rules** (checks in `mergeBills`, before `mergeCheckedBills`):

- Question applies and `invoiceChoice` absent → refused **`bill.merge_invoice_choice_required`**
  (409, params `{ workingOrderId, intoWorkingOrderId }`; no names, so the personal-data log rule is
  not touched).
- `invoiceChoice` present and either bill's current identity differs from the one it names (another
  device changed either bill after the till asked, including removing the merged-away bill's full
  invoice) → the same code. This closes the gap the review's probe showed: a hand change of the
  invoice bumps neither the party revision nor the bill-edit state (`working-order.ts:4630-4694`,
  `bill-editing.ts:278-290`), so neither existing check sees it.
- Malformed `invoiceChoice` (`from` null or missing, bad `keep`) → `management.request_invalid`
  (`field: "invoiceChoice"`).
- `keep: "from"`: one `update` of the receiving bill sets the merged-away bill's type, six recipient
  columns and delivery (the delivery belongs to that customer: an email address or A4 printer chosen
  for them; `null` if none). It runs inside `mergeCheckedBills` after `requireBillEditors` and
  **before** `moveOrderLines`, which checks the simplified-invoice limit against the receiving bill's
  type (`working-order.ts:4282`).
- **Fill rules, every merge:** receipt language: the receiving bill keeps its own; if it has none it
  takes the merged-away bill's. Delivery, when nothing was copied: filled the same way, only when
  both bills name the same customer identity.
- Register the code in `apps/server/src/errors.ts`, `STATUS` in `till-api.ts`, and wording in
  `apps/till/src/i18n/codes.ts`. Staff-notice text (`staffNoticeText`) is for server-pushed notices,
  not refusals, so it is not touched.

**Till.** `#onMergeBills` (`apps/till/src/till-app.ts:17344`, fired by the picker's `#pickBill`,
`apps/till/src/screens/till-table-order-screen.ts:6629`) reads both bills from `partyBills` (each
carries `invoiceType` and `recipient`: `apps/till/src/api/client.ts:2147`). When the question
applies it opens a `wt-dialog` shaped like `#renderDifferentPeopleConfirmation` (`till-app.ts:15828`)
instead of sending, and an answer sends `invoiceChoice` built from that same read:

- Receiving bill simplified. EN heading **Bill 2 has a full invoice**; text **Bill 2 is set for a
  full invoice to Acme Travel SL. Merging puts every dish on Bill 1, invoiced to Acme Travel SL.**;
  buttons **Do not merge** / **Merge and invoice Acme Travel SL**. ES **La cuenta 2 tiene factura
  completa** / **La cuenta 2 está a nombre de Acme Travel SL para factura completa. Al juntarlas,
  todos los platos pasan a la cuenta 1, facturada a Acme Travel SL.** / **No juntar** / **Juntar y
  facturar a Acme Travel SL**.
- Both set, different customers. EN **Each bill has a full invoice** / **Bill 1 is invoiced to Bar
  Sol SL and Bill 2 to Acme Travel SL. The merged bill can have only one.** / **Invoice Bar Sol SL**,
  **Invoice Acme Travel SL**, **Do not merge**. ES **Cada cuenta tiene factura completa** / **La
  cuenta 1 se factura a Bar Sol SL y la cuenta 2 a Acme Travel SL. La cuenta juntada solo puede tener
  una.** / **Facturar a Bar Sol SL**, **Facturar a Acme Travel SL**, **No juntar**.

On `bill.merge_invoice_choice_required` the till re-reads the party's bills; if the question applies
to the fresh read it opens it at once, otherwise it shows the code's wording (EN **The bills' invoice
details changed while you were choosing. Check them and merge again.** / ES **Los datos de factura
de las cuentas han cambiado mientras elegías. Revísalos y vuelve a juntarlas.**). Look at both
dialogs in both themes and at phone width.

**Guide.** No new section. One sentence after **Merge bills** in the merge paragraph
(`apps/server/src/guide/en/table-service.md:345-346`; ES `guide/es/table-service.md:367`): "If the
bill you add is set for a full invoice, the till asks which customer the merged bill is invoiced to,
or lets you stop." And one in `{#full-invoice}` (EN `:37`, ES twin): "Merging bills asks before a
full invoice's customer would change."

**RED tests first.** Server (`party-bill-actions.test.ts`, "merge bills"): **"refuses when the
receiving bill got a full invoice after the till asked"** (first); "refuses merging away a
full-invoice bill without a choice, changing nothing"; "refuses when the merged-away bill lost its
full invoice after the till asked"; "carries the customer and delivery, fills the language, when told
to keep the merged-away bill's"; "keeps the receiving bill's own customer when told to"; "asks
nothing when both bills name the same customer identity"; "asks nothing when the bill merged away is
simplified"; "refuses a malformed choice". `simplified-limit.test.ts`: "merges a full-invoice bill
over the simplified limit into a simplified bill once its invoice is kept". Route
(`till-api.bill-actions.test.ts`): code and 409. Filing (`move-merge.filing.test.ts`): "a merged bill
keeping Acme files one F1 naming Acme". Till (`till-app-parties.test.ts`): each dialog's text and
buttons, Do not merge sends nothing, each answer sends its `invoiceChoice`, the refusal re-reads and
reopens the question. Commands: `pnpm exec vitest run <files>` in `apps/server` and `apps/till`,
including `src/guide-content.test.ts` in `apps/server`; `pnpm exec vitest run
scripts/guide-links.test.ts` at the root.

**Fiscal gate.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (golden) and
`inmutabilidad.test.ts` stay unedited and pass. Nothing changes in `computeHuella`, the chain,
numbering, `registros_facturacion` or the record builders: only `working_orders` columns are written,
the same columns a hand-set full invoice writes.

**Size.** Production +140–200 (server 55–75, till 80–110, wording and guide 15); tests +280–380.
**One PR**: the server refusal without the till's question would refuse every such merge.

**Open questions.** None. The receipt-language default the first draft asked about is now the fill
rule above.
