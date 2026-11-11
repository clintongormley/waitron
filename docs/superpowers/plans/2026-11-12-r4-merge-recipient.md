# R4-merge: merging bills never silently loses a full invoice's details

**Authority.** Owner, 2026-11-11 ~18:30, answering "When a merge would lose a full invoice's
details, should they move across or should the merge be refused?": **"alert the waiter and ask"**
(`~/waitron-campaign-shared/desk/done/20261111-1825-M-r4-proposals.md`). Queue: lane L, R4-merge.
Source: lane M's review R4, Important 1 (`~/waitron-campaign-m/reports/r4.md` §2). FISCAL: the
details decide which invoice is filed, so this takes the full review wave with two Codex angles.

**Outcome.** When the bill being merged away is set for a full invoice (an invoice in a named
customer's name, `invoice_type` F1, as opposed to the simplified ticket, F2), the till asks before
merging, and the server refuses any merge that does not say which bill's invoice details the merged
bill keeps.

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
main; on #2866 `refuseClosedBill` plus `requireBillOfParty`, `apps/server/src/parties.ts:274-276`),
and an issued invoice belongs to a placed or settled bill, so a bill with an issued invoice is never
merged. Read, not run: `readChoiceChangeableOrder` (`apps/server/src/working-order.ts:~4590`) looks
for a sale only on a placed bill. Only a merge abandons a bill whose dishes moved; Discard, cancel
and Finish table abandon a bill whose dishes went nowhere else.

**Relation to #2866** (`feat/r4-bill-rules`, open). It lets a part-paid open bill receive a merge.
This work does not depend on it and is built on main now; whoever lands second rebases. Overlap:
`mergeBills`'s checks (adjacent lines), `#onMergeBills`'s catch block in `apps/till/src/till-app.ts`,
the `mergeBills` comment in `apps/till/src/api/client.ts`, and the merge paragraph of both
`table-service.md` guides. What #2866 adds that matters here: the receiving bill may hold payments,
so the copy below must apply the same locks as changing the invoice by hand.

**Server.** Request `POST /api/bills/:id/merge` (`apps/server/src/till-api.ts:4278`) gains an
optional `invoiceFrom: { billId, revision }`: the bill whose invoice details the merged bill keeps,
at the revision the till read. Rule in `mergeBills`: if the bill merged away is F1 and its recipient
differs from the receiving bill's, `invoiceFrom` is required, else refused
**`bill.merge_invoice_choice_required`** (409, params `{ workingOrderId, intoWorkingOrderId }`; no
names, so the personal-data log rule is not touched). A `billId` that is neither bill is
`management.request_invalid` (`field: "invoiceFrom"`); a stale revision is the existing
`working_order.out_of_date`. Naming the merged-away bill copies its type, six recipient columns,
delivery and language onto the receiving bill **before** `moveOrderLines`, because that function
checks the simplified-invoice limit against the receiving bill's type
(`apps/server/src/working-order.ts:4282`). The copy reuses the refusals `setOrderInvoiceChoice`
applies (`invoice.choice_locked`, payment in flight), extracted into one helper both call. Register
the code in `apps/server/src/errors.ts`, `STATUS` in `till-api.ts`, and wording in
`apps/till/src/i18n/codes.ts` (staff-notice text, `staffNoticeText`, is for server-pushed notices,
not refusals, so it is not touched).

**Till.** `#onMergeBills` (`apps/till/src/till-app.ts:17344`, fired by the picker's `#pickBill`,
`apps/till/src/screens/till-table-order-screen.ts:6629`) reads both bills from `partyBills` (each
already carries `invoiceType`, `recipient`, `revision`: `apps/till/src/api/client.ts:2147`). When the
rule above applies it opens a `wt-dialog` shaped like `#renderDifferentPeopleConfirmation`
(`till-app.ts:15829`) instead of sending:

- Receiving bill simplified. EN heading **Bill 2 has a full invoice**; text **Bill 2 is set for a
  full invoice to Acme Travel SL. Merging puts every dish on Bill 1, invoiced to Acme Travel SL.**;
  buttons **Do not merge** / **Merge and invoice Acme Travel SL**. ES **La cuenta 2 tiene factura
  completa** / **La cuenta 2 está a nombre de Acme Travel SL para factura completa. Al juntarlas,
  todos los platos pasan a la cuenta 1, facturada a Acme Travel SL.** / **No juntar** / **Juntar y
  facturar a Acme Travel SL**.
- Both set, different. EN **Each bill has a full invoice** / **Bill 1 is invoiced to Bar Sol SL and
  Bill 2 to Acme Travel SL. The merged bill can have only one.** / **Invoice Bar Sol SL**, **Invoice
  Acme Travel SL**, **Do not merge**. ES **Cada cuenta tiene factura completa** / **La cuenta 1 se
  factura a Bar Sol SL y la cuenta 2 a Acme Travel SL. La cuenta juntada solo puede tener una.** /
  **Facturar a Bar Sol SL**, **Facturar a Acme Travel SL**, **No juntar**.

On `bill.merge_invoice_choice_required` or `working_order.out_of_date` the till re-reads the bills
and shows the code's wording (EN **The other bill now has a full invoice. Merge again to choose
which invoice to keep.** / ES **La otra cuenta ya tiene factura completa. Vuelve a juntarlas para
elegir con qué factura se queda.**). Look at both dialogs in both themes and at phone width.

**Guide.** New `## Merge a bill set for a full invoice {#merge-full-invoice}` after
`{#bill-switcher}` in `apps/server/src/guide/en/table-service.md` and the Spanish twin, same `{#id}`:
what the question says and what each answer does, three or four sentences.

**RED tests first.** Server (`party-bill-actions.test.ts`, "merge bills"): "refuses merging away a
full-invoice bill without a choice, changing nothing"; "carries the recipient, delivery and language
when told to"; "keeps the receiving bill's own recipient when told to"; "merges a full-invoice bill
over the simplified limit into a simplified bill once the full invoice is chosen" (in
`simplified-limit.test.ts`); "refuses a choice made at a stale revision"; "asks nothing when the bill
merged away is simplified". Route (`till-api.bill-actions.test.ts`): code and 409. Filing
(`move-merge.filing.test.ts`): "a merged bill carrying Acme files one F1 naming Acme". Till
(`till-app-parties.test.ts`): each dialog's text and buttons, Do not merge sends nothing, each answer
sends its `invoiceFrom`, the refusal re-reads. Commands: `pnpm exec vitest run <files>` in
`apps/server` and `apps/till`; then `apps/server/src/guide-content.test.ts` and
`pnpm exec vitest run scripts/guide-links.test.ts` at the root.

**Fiscal gate.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (golden) and
`inmutabilidad.test.ts` stay unedited and pass. Nothing changes in `computeHuella`, the chain,
numbering, `registros_facturacion` or the record builders: only `working_orders` columns are written,
by the same columns a hand-set full invoice writes.

**Size.** Production +130–190 (server 50–70, till 70–100, wording/guide 20); tests +250–350.
**One PR**: the server refusal without the till's question would refuse every such merge.

**Open question** (default applies unless the owner says otherwise). Receipt language with no full
invoice involved: Bill 2 (simplified, English receipt) merged into Bill 1 (no language chosen) today
prints in the venue's language. Default: the receiving bill takes the merged-away bill's language
only when it has none of its own; with two different choices it keeps its own, without asking.
