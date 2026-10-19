# A803 Bills and Tables Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline execution, task by task. Do not automatically dispatch per-task agents. Read the approved spec and this amendment-aware plan together. Steps use checkboxes. This document authorizes no implementation during its plan-only firing.

**Goal:** Give every dish a permanent portion identity, every bill a clear identity, and table moves one consistent picker, without changing issued invoices.

**Architecture:** Store atomic working portions and their extras, then group them for display and the existing fiscal pricing boundary. Keep a permanent mapping from portions to
grouped sale rows. Land six independent slices; station modes and pass work form a separate dependency tail after A773-2, and pre-bills wait for the asesor.

**Tech Stack:** TypeScript, Lit, SQLite through Drizzle, Vitest, real Chromium, shared `wt-*` primitives and ESC/POS rendering. No new dependency is planned.

**Spec:** [Approved design](../specs/2026-10-18-a803-bills-and-tables-design.md), sections 1–7. Owner amendments of 2026-10-18 approximately 21:40–22:05 override §3.5 and the older
mockups. The spec remains a historical approved document; do not silently rewrite it.

## Global constraints and release gates

- H2: do not change `computeHuella`, the hash chain, invoice allocation, `registros_facturacion`, alta builders, `registerSif` or `restoreFiscal`. Park before any necessary change
  there, with the failing comparison and a separate decision request.
- Preserve one invoice per fully paid bill, existing issuance timing, issued amounts and numbers, append-only records and existing fiscal assertions. A803 makes no legal
  determination about advances or pre-bills.
- A773-1 is landed at `c9ad7a634fcf8e8ca6d4a74488b073d457d20eda`; this planning checkout's HEAD is that commit (`git log -1`). A821f measured-unit handling is present in the
  inspected code. A773-2 is **pending**, not a landed prerequisite you can assume.
- Six landable slices: 1 portions/current grouping; 2 named and numbered bills; 3 switcher/menu/main-bill retirement; 4 shared picker/course copies; 5 Refund wording, independently
  landable any time; 6 pre-bill after S2. Slice 1 ends **needs-owner-review at land**, even with passing CI, because it touches sale composition and receipts.
- Coordinate before touching reserved functions: A738 counter cleanup (lane F), later A739 payment redesign (lane F), A796-B payments (lane B), A758 reason rules (lane C), A682
  translations and A679 first-live fiscal setup. Mapping a collision here is not permission to edit it.
- Before each slice, recheck all lane queues, open PRs and committed plus uncommitted worktree changes. Compare the functions and entries that slice will change; wait for a
  conflicting reservation to release. Campaign receipts remain outside the repository.
- No data backfill or compatibility layer before live. State the required preproduction venue reset in each incompatible slice's PR; do not execute a reset without its own
  authorization. Never hand-edit generated SQL, snapshots or journals, or edit a shipped migration.
- Keep existing behavioral assertions unless this spec explicitly changes the behavior. Every changed assertion needs a **Changed test checks** receipt: old expectation,
  spec/amendment, new expectation, red result and green result. Renaming a test is not that evidence.
- Use exact `Decimal` amounts above the row, cents for money, thousandths for quantities, basis points for rates. No floating-point money arithmetic. Measured portions stay
  indivisible, including an integer quantity in a measured unit.
- New Spanish words require owner approval. Reuse approved strings where they fit. Record concrete proposals only during implementation and gate the affected wording until
  approved; this plan proposes no Spanish translation.
- Each implementation slice updates its EN/ES guides, relevant design-system contract and backlog residuals. Guide headings share `{#id}` across twins. Update only behavior that
  slice actually ships.

## Review focus

1. Two identical burgers with different extra counts must never share or lose extras; slice 1 tests parent/child conservation through moves and filing.
2. Cheap items and uneven discounts can change VAT when split into rows; slice 1 compares grouped baseline pricing before accepting any monetary representation.
3. A payment or takeover can win while the picker is open; slice 4 rechecks identity, revisions, ownership and the received-money floor inside the write transaction.
4. Removing or moving the bill on screen must not send the next order to an invisible fallback bill; slices 2–3 test stored numbering and explicit selection after stale reads.
5. A course shared by moved and staying dishes must keep independent release state; slice 4 checks that firing one copy never fires the other and notices name only moved dishes.

## Current code map (inspection, not runtime verification)

These are source locations at the planning HEAD. Re-resolve them after each lane lands. **New** below means proposed, not already callable.

| Boundary            | Current files and signatures                                                                                                                                                                                                                                      | Required consumer checks                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order storage       | `packages/db/src/schema/orders.ts`: `workingOrders`, `workingOrderLines`; `schema/order-drafts.ts`, `order-draft-recalled-lines.ts`, `ticket-items.ts`, `bill-payments.ts`, `order-groups.ts`                                                                     | Quantity, `priceQuantity`, `servedQuantity`, parent ids, recalled-source reservations, cancellation and adjustment quantities                                                           |
| Drafts and writes   | `apps/server/src/order-drafts.ts`: `DraftLine`, `BillEditState`, `BillEditExpected`, `saveDraft`, `submitDraft`, `splitDraft`; `working-order.ts`: `createOpenOrder`, `insertTabRound`, `applyLineEdits`, `splitUnitsWithinOrder`, `markServed`, `moveOrderLines` | Direct sends, saved/recalled drafts, held-order edits, payment-triggered sends and counter writers must agree                                                                           |
| Pricing             | `working-order.ts:1237`: `OrderLineIdentity`; `GrossOrder { gross: GrossLines; identities: OrderLineIdentity[] }`; `readStoredOrder`, `priceStoredOrderForIssuance(tx, workingOrderId, options?)`                                                                 | `identities[i]` aligns with gross row `i`; `toStoredLines` reconstructs child parent numbers by array position                                                                          |
| Fiscal boundary     | `issue-moment.ts`: `issueMoment(clock: TrustedClock, gross: GrossLines): IssueMoment`; `bill-payments.ts:644` `issueWhenFullyPaid`, public `issueIfFullyPaid`; `till-sale.ts` issuance/recovery paths                                                             | `packages/catalogue/src/pricing.ts:143,177` rounds gross and VAT base per row; `packages/core/src/record-sale.ts` validates and files. Leave both arithmetic and fiscal gates unchanged |
| Same-party moves    | `bill-actions.ts`: `splitBill(tx,cfg,billId,transfers,command): Promise<{billId:string}>`, `transferItems(tx,cfg,fromBillId,toBillId,transfers,command): Promise<void>`, `mergeBills(...)`                                                                        | Current transfers are `{lineNo:number;quantity?:string}[]`; `requireUntouchedPair` currently bars transfer from part-paid bills; retain strict merge checks                             |
| Cross-table moves   | `move-bill.ts`: `moveBill(tx,cfg,billId,to:MoveTarget,options:MoveBillOptions,attendance?): Promise<MoveBillResult>`                                                                                                                                              | `MoveBillOptions` carries target-party read, expected edits and `bills: "merge"                                                                                                         | "separate"`; remove implicit merging in slice 3                                                                                                                      |
| Party/table actions | `table-actions.ts`: `joinTables`, `moveGuests`, `combineParties`; `splitTable(tx,cfg,partyId,tableId,billId:string                                                                                                                                                | null,options,attendance?): Promise<{partyId:string;mainBillId:string                                                                                                                    | null}>`                                                                                                                                                              | Current split accepts one non-main bill; routes append room revisions. `parties.ts` owns party reads, revision guards and main-bill selection |
| Bills on screen     | Server `parties.ts` and till `api/client.ts`: `PartyBill`, `TableParty`; `order-drafts.ts:1247` computes `billNumber: index + 1`                                                                                                                                  | `state/bill-state.ts`: `billName(partyName:string,index:number):string`; `till-table-order-screen.ts` and `till-app.ts` own action flow and active bill                                 |
| Paper/display       | `kitchen-ticket.ts`: `arrangeTicketItems(items, grouping:"combined"                                                                                                                                                                                               | "separate")`; `kitchen-print.ts`; `receipt-lines.ts`: `ticketLinesFrom`, `groupByParent`; `receipt-document.ts`; till `screens/till-ticket-view.ts` has its own parent grouping         | Preserve A821f `printedAsSold` behavior; trace kitchen display, rest-of-order, notices, receipt preview/reprint, full-invoice document and payment receipt consumers |
| HTTP/client         | `apps/server/src/till-api.ts`: `/api/bills/:id/split`, `/transfer`, `/merge`, `/move`, `/api/parties/:id/split-table`, `/join`; till `api/client.ts` mirrors these                                                                                                | `BillEditExpected` is `{billId,editorVersion,draftId,draftRevision}`; preserve auth, profile action/zone, attendance and revision checks                                                |

Read `CLAUDE.md`, developer `writing-claims.md`, `conventions-data.md`, `conventions-ui.md`, `testing-guide.md`, `workflow-guide.md`, `design-system.md` (Forms and fixed device
screens), `products.md`, and `ci-and-gates.md` before executing in their areas. The planning inspection included the relevant conventions, A739/A802 details and A803 mockup README.
A803 boards 08/12/13 and A797 narrow/light and phone/dark boards were visually inspected; they are design references, not evidence of working UI.

## Builder decisions and proposed contracts

**Portions and selection.** Allocate a UUID when a fresh saved portion is first created; retain it through draft recall, move, split, merge, cancellation and sale. Keep its
immutable registry row even if a mutable working line is deleted. A quantity increase creates more unit portions; it never changes an existing portion into several. A measured add
creates exactly one portion. Classify at add-time using `hardwareUnit === null && precision === 0 && measure !== true`, then freeze that portionability fact in the registry. Do not
infer it later from precision or today's catalogue. A821f's existing `workingLineContexts.soldInEach` and `VENUE_SERVICE.readLinesSoldInEach(tx,lineIds)` identify Each for
presentation; they do not by themselves classify every custom whole-unit portion. Correct the till's `soldByTheUnit` predicate accordingly. Extras are children with their own
per-portion counts; `+ Lime × 2` belongs to each applicable drink.

**Deterministic count picker.** Filter ineligible paid/reserved portions first. Among eligible identical portions choose unsent, waiting, queued, preparing, ready, served, then
creation ordinal, then UUID. Group only equal product/variant snapshots, extras/counts, note, course instance, kitchen/service state, price and adjustment facts. Send the selected
ids, not a count whose meaning the server might recompute differently. A stale selected id causes a refresh/refusal, never silent substitution.

**Sale storage and rounding.** Default to grouped `sale_lines` with explicit per-portion association rows, rather than one independently rounded fiscal row per portion. Preserve
the current frozen pricing cohort, meaning the set priced together before expansion. Do not merge separately priced cohorts merely because their printed names match. Price a bill's
surviving cohort through existing `grossLockedLines`/`rateLines`; map every resulting sale row to the portions it represents, including extras. Receipt grouping is presentation
only and sums filed amounts. This is a proposal until slice 1's comparison runs, not a claim of monetary equivalence.

**Monetary stop condition.** For allocating an already computed cohort gross or discount to selectable portions, propose integer-cent quotient/remainder in immutable portion order,
with the earliest portion receiving the first remainder cent. Never independently round each portion's percentage. Compare resulting stored totals, item-payment amounts, VAT
bases/tax, list prices and receipts to current grouped operations before committing the choice. If the existing price readers recompute different totals, or a supported split
cannot conserve the intended amounts with unchanged fiscal gates, park slice 1 with the exact fixture. Do not bypass `recordSale` checks or invent a tax allocation rule.
Per-portion fiscal sale rows remain an unresolved alternative requiring a separate decision if the grouped adapter fails.

**Bill identity.** Store optional trimmed name separately from `working_orders.label`, which already carries receipt/table context. Default maximum 80 characters; blank saves null.
Store stable table-local numbers, never list positions. The staying party retains its immutable numbering-scope id and existing bill numbers even when its first physical table
leaves. Existing destination bills keep their numbers; arrivals get fresh destination numbers in source bill-number/id order. A merged-away or abandoned allocation is never
reused within that scope. A numbering scope must not be derived anew from whichever physical table happens to be first in a read.

**Slice-2 decision gate:** the spec does not explicitly say whether numbers restart for the next seating at an emptied table. Ask once before implementing slice 2: recommend a
fresh scope for each seated party, starting at Bill 1; alternatively retain a physical table's sequence across later seatings. The owner chooses the lifetime of the allocator,
not whether surviving bills may change number: they may not. Keep this gate open until the answer is recorded; slice 1 is independent of it.

**Full invoice and menu.** Offer Full invoice at the payment step using current invoice-choice support, respecting A741 availability, and retain a menu shortcut for an **unpaid,
unissued** bill opening the same editor. Do not implement A739's whole redesign. An issued/paid bill never opens that editor: route to the existing paid-receipt correction entry if
A802 has landed and its contract is known; otherwise keep correction explicitly unavailable pending A802/owner decision. No A803 correction or F3 behavior.

**Receipt identity.** Do not add bill names to fiscal receipts in slices 1–2. A pre-bill, once permitted, includes the name frozen at print time. Current tickets may gain the name
with slice 2 only after the A773-2 reservation is released; pass naming and mixed named/unnamed cross-bill labels belong to the dependency tail.

## Shared execution and verification contract

- Before implementation or test code, read `superpowers:test-driven-development`. Reproduce bugs before fixing. Use real `useVenueDb` fixtures and compare full row sets after
  rejected writes, outside the transaction being rejected.
- For every red/green command below, require a nonzero **Tests** count. Red must fail the named assertion for the intended behavior, not import/setup errors. Run each numbered
  command separately; check each exit status. Full owning files run after focused cases; CI owns package coverage and the normal hook owns local push checks.
- Before touching a field/sentinel/gate, run `rg -n 'FIELD_OR_SYMBOL' apps packages scripts docs` and trace every consumer. For main-bill retirement also search prose for
  `main bill`, `main_bill`, `New orders` and `Send to`; retain dated history with a pointer, update current guides/runbooks.
- Keep a changed-checks receipt per slice outside product source, attached to the PR. Keep original paid-line, money, rollback, replay, admission, fiscal and availability
  assertions. Never remove an assertion merely to make a new representation green.
- Each schema slice declares foreign keys, unique indexes and CHECKs in TS. Add exports, classification, descriptors, manifest and `requires` together. Registry/history/sale links
  are append-only ledger; mutable bindings/counters/names are state, never local. No FK to identity's persons is implied by an operator id.
- Shared schema map: `packages/db/src/schema/index.ts`, `src/index.ts`, `src/classification.ts`, `src/migrations.ts`, `drizzle/`; venue-owned additions use the equivalent
  `packages/venue-service` files, `packages/composition/src/modules.ts` and `packages/migrations/migrations.manifest.json`. A core table needs a commit explanation: permanent
  order/sale identity is shared by counter and table service; bill names/numbers remain venue-service owned.
- Generate core changes with `pnpm --filter @waitron/db db:generate` and venue-service changes with `pnpm --filter @waitron/venue-service db:generate`. Read generated SQL and
  inbound FKs before any rebuild; regenerate on number collision. Never patch generated artifacts by hand.
- **Schema checks S:**
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`.
  Expect all cases PASS and inspect totals, not just exit zero.
- Also run `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` after schema changes. An append-only declaration for an existing table must be called out
  in the PR.
- **Required H2 controls, unedited:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Run both whenever a slice
  reaches sale composition, receipt facts or schema near the protected invariants, including slice 1. Require nonzero Tests and PASS; never change golden data or either suite.
- **Fiscal controls F, unedited (also run Required H2 controls above):**
  `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
  Expect PASS with original contiguous-number, partition, payment replay and invoice timing assertions. These cover fixtures, not AEAT acceptance.
- **Guide checks G:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
  Current guide folders contain only products/modifiers/content-and-images. Proposed `en/table-service.md` and `es/table-service.md` need `GUIDE_PAGES` registration in
  `apps/server/src/guide-catalogue.ts` and EN/ES page names in `guide-pages.ts`; inspect the served `/help/en/table-service` and `/help/es/table-service`. Till help-link
  integration waits for its owning help-mode work rather than inventing a navigation surface here.
- **LOOK:** use `wa-wt demo <registered-worktree-name>`. Inspect actual browser pages in EN/ES, light/dark, 390 and 1280 px, with screenshots of closed/open menus, long names,
  paid/part-paid/foreign-editor bills, refusal, error recovery and picker totals. Check keyboard, focus return, touch targets and native enabled state; browser tests do not replace
  LOOK. No bare `pnpm dev` or unqualified compose.
- Finish every production slice with the installed `finish-branch` skill: one installed Claude run-it whole-branch review in its throwaway checkout, triage completed findings,
  normal pre-push hook, and green required CI on current SHA. No full-workspace run solely to finish; do not repeat an approved review just for rebase. Use `land-branch` only with
  owner authorization; slice 1 additionally requires explicit owner sign-off at land. Stop only recorded PIDs you started.

## Slice 1: permanent portions and current ticket/receipt grouping

**Files:** Modify `packages/db/src/schema/orders.ts`, shared schema map above; new `packages/db/src/schema/order-portions.ts` for `order_portions` registry, mutable
`working_line_portions` bindings, append-only `sale_line_portions` and portion move/cancel events. Modify `apps/server/src/working-order.ts`, `order-drafts.ts`, `draft-source.ts`,
`order-groups.ts`, `line-service-state.ts`, `receipt-lines.ts`, `receipt-document.ts`, `kitchen-ticket.ts`, `kitchen-print.ts`; till `state/working-order.ts`,
`widgets/product-name.ts`, `screens/till-table-order-screen.ts`, `screens/till-ticket-view.ts`. Proposed server modules `order-portions.ts` (expansion/identity),
`portion-sale-projection.ts` (pricing cohorts); proposed till `state/portion-groups.ts` (display grouping). Trace `packages/adjustments/src` quantity readers and coordinate A758
before edits. Coordinate reserved counter/payment issuance call sites rather than editing them without release.

**Interfaces:** New `PortionRef { portionId:string; lineId:string; ordinal:number; pricingCohortId:string; measured:boolean }`. New
`expandPortions(tx:Transaction, orderId:string, lines:readonly StoredOrderLine[], soldByUnitLineIds:ReadonlySet<string>):Promise<PortionRef[]>`, called while persisting fresh lines
with classification from the resolved add-time units, idempotent for existing bindings. Give each registry row its frozen portionability and cohort id; unique binding is by working
line id, unique sale link by sale row/portion id. All associations use declared keys to their registry and sale rows. New
`projectPortionSale(stored:readonly StoredOrderLine[], portions:readonly PortionRef[]):{ order:GrossOrder; portionIdsByLine:readonly (readonly string[])[] }`. Return grouped
identities aligned with gross rows and a mapping for **every** parent/extra sale row. New
`linkSalePortions(tx:Transaction,saleId:string,portionIdsByLine:readonly (readonly string[])[]):Promise<void>` inserts links in the same issuance transaction after reading filed
row positions. Existing fiscal function signatures stay unchanged.

- [ ] Add proposed `apps/server/src/order-portions.test.ts` cases prefixed `A803 portions`: unit quantity 12 creates 12 distinct parents; a dozen product creates one; two measured
      100 g adds stay two portions, one 200 g add stays one; measured integer 200 ml and `measure:true` with precision 0 never expand. Assert quantities, permanent ids, ticket ids and
      separate staff/customer/kitchen names.
- [ ] Add proposed `apps/server/src/portion-sale-projection.test.ts` cases prefixed `A803 monetary comparison`: compare current grouped inputs and candidate projection for 2 ×
      €0.05 at 10%, €3.33, mixed 10/21% VAT, zero-price extras, double extras, non-unit `priceQuantity`, fixed/percentage discounts and remainder cents. Assert exact gross, base, tax,
      list gross, child parent positions and payment allocations. First record the unchanged baseline; expect the naive per-portion VAT candidate to differ in the cheap-item control.
      Then require the grouped candidate to equal the baseline. A fixture mismatch is a stop, not an expected-value update.
- [ ] Extend `A803 monetary comparison` through moving one portion to another bill, cancelling one portion, adjusting only one portion, and recombining portions before final
      issuance. For each operation assert exact item-payment allocations, gross/base/tax, list gross and unit prices, parent-extra positions and the exact portion-id set linked to
      every filed sale row. Include two visually identical cohorts priced separately, uneven discount/remainder cents and extras; preserve cohort identity when they recombine.
      Run the same comparison file RED before the adapter, then GREEN after it. Compare whole-operation totals across both resulting bills as well as each bill's existing pricing
      result. If conservation and the unchanged pricing boundary disagree, retain the failing fixture and park slice 1 rather than update a monetary expectation.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/order-portions.test.ts src/portion-sale-projection.test.ts -t 'A803'`. Expect failing quantity/identity/projection
      assertions once test harnesses are connected to current behavior; retain the red output before implementation.
- [ ] Implement expansion and frozen cohort projection without changing fiscal/pricing functions. Keep independent extras counts, stable ids and per-portion serving/cancellation
      state. Make repeated draft saves and lost-send replies reuse ids; split a recalled source without duplicating its reservation. Update all issuance/recovery and receipt readers
      only after their reservations are released; otherwise park the slice.
- [ ] Add `A803 portion lifecycle` in `apps/server/src/bill-editing.split-transfer.test.ts`: move one of two sent burgers with extras, preserving original portion/ticket/extra ids,
      one item payment, kitchen state and remaining totals; rollback on stale owner/revision leaves every registry/link/event row unchanged. Add replay and two concurrent sends,
      asserting exactly one binding and ticket per portion. RED then GREEN:
      `pnpm --filter @waitron/server exec vitest run src/bill-editing.split-transfer.test.ts -t 'A803 portion lifecycle'`.
- [ ] Add `A803 portion grouping` in `apps/server/src/kitchen-ticket.test.ts`, `receipt-lines.test.ts`, `receipt-document.test.ts` and till `screens/till-ticket-view.test.ts`:
      identical portions group; differences in extras, note, course, state or price do not; measured items retain A821f behavior; summed printed totals equal filed totals. Current
      `combined`/`separate` modes remain, with no station setting or cross-bill batching yet.
- [ ] Add proposed `packages/db/src/schema/order-portions.test.ts` constraint cases: duplicate live binding refuses, dangling sale/portion key refuses, registry/event/link
      update/delete/replace refuses, valid cancellation deletes only mutable binding. First run `pnpm --filter @waitron/db exec vitest run src/schema/order-portions.test.ts` RED on the
      intended constraint assertions; generate the minimal declared schema, then run GREEN plus `src/schema/schema-conformance.test.ts` with the same command. Do not weaken existing
      quantity assertions to make expansion pass.
- [ ] GREEN: rerun the two new server files unfiltered, then
      `pnpm --filter @waitron/server exec vitest run src/bill-editing.split-transfer.test.ts src/kitchen-ticket.test.ts src/receipt-lines.test.ts src/receipt-document.test.ts src/receipt-ticket.test.ts`;
      `pnpm --filter @waitron/till exec vitest run src/state/working-order.test.ts src/screens/till-ticket-view.test.ts src/screens/till-table-order-screen.split-units.test.ts`. Expect
      all behavioral counts PASS. Run S, F and G; keep F byte-unedited.
- [ ] Update/create the EN/ES table-service guides for portions and extras, and current receipt/ticket explanations. LOOK includes 58/80 mm rendered paper previews; physical output
      and a physical-till serving/drag trial remain explicitly unmeasured until performed. Do not assert browser rendering proves physical printing.
- [ ] Stage only slice paths; `git diff --cached --check`; `git commit -s -m "feat: preserve dish portions through orders and grouped sales"`. Explain the core-table placement and
      reset requirement in the commit/PR. Finish review and CI, then stop **needs-owner-review at land**. No slice-1 automatic landing.

## Slice 2: named bills and stable table-local numbers

**Gate:** Record the owner's numbering-scope lifetime answer above before implementing this slice.

**Files:** New `packages/venue-service/src/schema/bill-identities.ts` for mutable bill names, numbering-scope association, scope counters and append-only allocation history; shared venue
schema map. New `apps/server/src/bill-identities.ts`; modify server `parties.ts`, `order-drafts.ts`, `move-bill.ts`, `table-actions.ts`, `till-api.ts`, `errors.ts`; till
`api/client.ts`, `state/bill-state.ts`, `screens/till-table-order-screen.ts`, `till-app.ts`. New till `widgets/bill-name-dialog.ts` with `.test.ts`, `.unsaved.test.ts`,
`.a11y.test.ts`. Current-ticket naming touches `kitchen-print.ts`/`kitchen-ticket.ts` only with reservation release; pass paths stay deferred.

**Interfaces:** New `BillIdentity { billId:string; number:number; name:string|null; numberingScopeId:string }`;
`allocateBillIdentity(tx:Transaction,billId:string,numberingScopeId:string):Promise<BillIdentity>` and
`renameBill(tx:Transaction,billId:string,name:string|null,command:BillCommand & {expectedEdit:BillEditExpected}):Promise<BillIdentity>`. Extend both `PartyBill` definitions with
`billNumber:number`, `billName:string|null`; extend unsent summaries with those stored values. Replace till `billName(partyName,index)` with
`billName(bill:Pick<PartyBill,"billNumber"|"billName">):string`. New POST `/api/bills/:id/name` takes `{name,partyId,expectedPartyRevision,expectedEdit}`; client `renameBill`
mirrors it. Store name separately from existing `label`.

- [ ] Add `A803 bill identity` to proposed `apps/server/src/bill-identities.test.ts`: create 1/2/3, merge 2 away, new is 4;
      arrivals at a destination already using 1–4 take 5/6, preserving names. Split off the first seated table and assert staying bills retain every number and scope id while leaving
      bills receive destination numbers. Pin the recorded owner answer for close/reseat: restart at 1 for a fresh-seating scope, or continue at 5 for a physical-table lifetime scope.
      Only the approved expectation becomes the test. Assert source gaps, destination uniqueness, replay/stale revision rollback and
      simultaneous creation under a barrier without a fixed sleep.
- [ ] Add `A803 rename authority` in `apps/server/src/till-api.bill-actions.test.ts`: empty becomes null, trim, 80 accepted/81 refused with field error, malformed/null/absent
      distinguished, foreign editor requires takeover, wrong zone/action refuses with no row change. Add HTML-like and long names as literal text, not markup.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/bill-identities.test.ts src/till-api.bill-actions.test.ts -t 'A803'`. Expect failed stored-number/name and
      authorization assertions before adding the API.
- [ ] Implement allocation inside the caller's transaction and append immutable allocation history. Update every arrival path: whole bill, split, joining parties, Move guests to a
      new table and counter-to-table. A failed transaction consumes no number; a successfully allocated and later abandoned number is never reused. Names follow the bill, numbers
      belong to the destination.
- [ ] Add `A803 bill name draft` in the new dialog tests: unchanged Save quiet/disabled, changed Save enabled, Cancel/Escape/navigation/reconnect retain or discard through
      `draftScopeFor`, server refusal preserves input, late save cannot close another bill's dialog. Register through `trackDialog()`.
- [ ] RED then GREEN:
      `pnpm --filter @waitron/till exec vitest run src/widgets/bill-name-dialog.test.ts src/widgets/bill-name-dialog.unsaved.test.ts src/widgets/bill-name-dialog.a11y.test.ts`. Expect
      the exact draft/label assertions to fail before wiring, then all counts PASS, including axe in both themes.
- [ ] After release, add `A803 named current ticket` to `apps/server/src/kitchen-ticket.test.ts`: named bill prints once, unnamed adds nothing, rename after print leaves job bytes
      unchanged. Do not claim pass naming shipped. GREEN: rerun slice-2 server files unfiltered plus `party-move-bill.test.ts`, `party-table-actions.test.ts`, S and G. Record
      per-portion sale links unchanged on rename.
- [ ] Update EN/ES table-service guides, LOOK with paid/missing/long names and real arrival numbering, then `git commit -s -m "feat: name bills and keep stable table bill numbers"`
      after staging only the reviewed files. Finish and land through the shared contract; retain the pass/ticket dependency tail.

## Slice 3: always-on switcher, one kebab, explicit bill selection

**Files:** Modify till `screens/till-table-order-screen.ts`, `state/bill-state.ts`, `till-app.ts`, `api/client.ts`, `widgets/bill-pay-dialog.ts`, `i18n/strings.ts`; server
`parties.ts`, `bill-actions.ts`, `move-bill.ts`, `table-actions.ts`, `working-order.ts`, `till-api.ts`; retire `parties.mainBillId` in `packages/db/src/schema/parties.ts` by
generated migration. Modify existing tests `party-main-bill.test.ts` and `party-bill-actions.test.ts` only for explicitly retired behavior. Coordinate A738/A739/A796-B before
touching payment/counter mounts.

**Interfaces:** `TableParty` no longer carries `mainBillId`; table order creation requires explicit `billId`. Add POST `/api/parties/:id/bills` with `{expectedPartyRevision}` and
client `createPartyBill(partyId:string,expectedPartyRevision:number):Promise<{billId:string}>`; session supplies the operator. New explicit
`createPartyBill(tx:Transaction,cfg:OriginConfig,partyId:string,command:PartyCommand):Promise<{billId:string}>` replaces implicit `partyMainBill` creation. Existing join/move APIs
drop `bills:"merge"|"separate"`; all incoming bills stay separate. The existing split API still accepts one `billId` until slice 4, now allowing any eligible bill; rename its
result `mainBillId` to `billId` in server/client/app, creating an explicit empty bill when needed. `MoveBillResult` becomes `{partyId:string|null;billId:string}` with no `merged`
choice. UI switch events carry the bill id, never a visible index.

Replace both server and client `TableActionResult` with `{partyId:string;billIds:string[]}`; HTTP floor-changing wrappers preserve their existing optional
`zoneRevisions:Record<string,number>`. Replace internal `CombineResult` with `{billIds:string[]}` and remove its implicit-bill-merge mapping consumers, while preserving the
separate explicit Merge command and its own slip links. Result ids are the destination party's visible bills, ordered by stored number then id. Join and Move guests keep the
previously shown bill selected if its id is in that result; otherwise show the lowest numbered surviving bill before accepting new dishes. If the resulting party has no bill,
create one empty bill in that same server transaction and include it in the result. The interim single-bill split result is
`{partyId:string;billId:string;zoneRevisions?:Record<string,number>}` until slice 4 replaces the selector; it remains usable without `mainBillId`. Whole-bill moves select the
returned `billId` at the destination. No new result or request retains `mainBillId` or a bill-merge `merged` flag.

- [ ] Add proposed `screens/till-table-order-screen.bill-switcher.test.ts` cases `A803 switcher`: visible with one bill and `+ New bill` in that same dropdown; Bill 1 of 3 shows
      name/outstanding/Paid/editor; removing Bill 2 leaves Bill 1 and Bill 3. `of 2` is a count, not a maximum number. New orders go to the shown id. If it disappears, choose lowest
      surviving stored number with a visible refresh, or explicitly create an empty bill when none survive; never submit to a hidden fallback.
- [ ] Add `A803 single menu` in that file: exactly one kebab; current bill heading/items precede Whole table heading/items. Include rename, Move dishes, Merge into, Move to another
      table/counter, unpaid Full invoice shortcut and Refund where allowed; table heading has Guests, Bill requested, Split a table, Join a table, Move guests, Finish table. Pending
      slice-4 Move dishes can temporarily open the existing split/transfer flow, labelled accurately, without claiming the shared picker exists.
- [ ] Add `A803 pay scope`: footer contains current bill total, table remaining total and Pay only, with no table Hold or Tab panel. This bill's unsent dishes leave the **native
      Pay button enabled and secondary/quiet**; tapping explains exactly “Send or remove the unsent dishes before paying.” and initiates no charge. Other bills' unsent dishes do not
      quiet it. Preserve all unrelated payment eligibility checks and A739 counter Hold.
- [ ] Add `A803 invoice entry` in `widgets/bill-pay-dialog.test.ts` and `till-app-bill-payments.test.ts`: payment step offers Full invoice when enabled, hidden when A741 disables
      it; menu and payment editor share the same bill choice. Paid/issued bills route only to known A802 correction entry, or explicitly gated unavailable; assert no
      issuance/correction API request from that action. Reuse current recipient validation and draft protection.
- [ ] RED:
      `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.test.ts src/widgets/bill-pay-dialog.test.ts src/till-app-bill-payments.test.ts -t 'A803'`.
      Expect one-bill visibility/menu/native-Pay or payment-step invoice assertion failures.
- [ ] Add `A803 no main bill` to server `party-bill-actions.test.ts`, `party-table-actions.test.ts`, `party-move-bill.test.ts`: joining keeps every bill and payment separate;
      moving to occupied table creates no merge prompt; explicit new bill is addressable; stale active bill refuses with no mutation. RED:
      `pnpm --filter @waitron/server exec vitest run src/party-bill-actions.test.ts src/party-table-actions.test.ts src/party-move-bill.test.ts -t 'A803 no main bill'`.
- [ ] Add `A803 action results` to `apps/server/src/till-api.table-actions.test.ts`, till `api/client.test.ts` and `till-app-table-service.test.ts`: exact join/Move guests and
      interim split replies contain explicit bill ids and the existing room revisions, with no `mainBillId` or implicit-merge flag. An empty-party arrival returns one created bill,
      not a second client-created bill. After each operation, assert the visible selected id and the next order/draft request target are identical. Keep the old single-bill split
      usable until slice 4. RED then GREEN:
      `pnpm --filter @waitron/server exec vitest run src/till-api.table-actions.test.ts -t 'A803 action results'` and
      `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/till-app-table-service.test.ts -t 'A803 action results'`; then run these owning files unfiltered.
- [ ] Implement the UI and explicit commands, then remove all main-bill consumers found by the shared trace, including error registry/mappings and prose. Keep explicit Merge strict
      about any payment history; keep one payment tied to one bill. Do not turn issue-unpaid-invoice behavior into new table default issuance.
- [ ] GREEN: run both commands unfiltered, plus
      `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/widgets/bill-pay-dialog.unsent.test.ts`;
      run S, F and G. Add new `bill-switcher.a11y.test.ts` for open/closed/one/many/foreign editor in both themes; run it with
      `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.a11y.test.ts`.
- [ ] Update EN/ES guides and design-system fixed-table control contract, LOOK all amendment states, then
      `git commit -s -m "feat: give tables one bill switcher and one action menu"` with staged paths reviewed. Finish/land through the shared contract; retain A739 redesign and A802
      correction as separate work.

## Slice 4: one portion picker and independent waiting-course copies

**Files:** New till `widgets/portion-picker.ts`, `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`, and `state/portion-selection.ts`/`.test.ts`; modify
`screens/till-table-order-screen.ts`, `till-app.ts`, `api/client.ts`, `widgets/split-guests-dialog.ts` where retired. New server `portion-moves.ts`/`.test.ts` and
`waiting-course-copy.ts`/`.test.ts`; modify `bill-actions.ts`, `table-actions.ts`, `move-bill.ts`, `order-drafts.ts`, `order-groups.ts`, `kitchen-print.ts`, `till-api.ts`,
`parties.ts`. Allergy integration stays through `VENUE_SERVICE.splitPartyAllergies`/`moveBillAllergies`, not a server import of module internals.

**Interfaces:** New `PortionSelection = {wholeBillIds:string[]; portions:{billId:string;portionIds:string[]}[]}`; whole-bill and loose selectors are disjoint and duplicate ids
refuse. New
`movePortions(tx:Transaction,cfg:TillConfig,fromBillId:string,to:{billId:string}|{newBill:true},portionIds:readonly string[],command:BillCommand & {expectedEdits:BillEditExpected[]}):Promise<{billId:string}>`.
Proposed POST `/api/bills/:id/move-dishes` mirrors it. Replace split-table body with
`{tableId,selection,guests:{staying:number|null;leaving:number|null},allSelected:"move-guests"|"split-anyway",expectedPartyRevision,expectedEdits}` and result
`{partyId:string;billIds:string[];zoneRevisions?:Record<string,number>}`. Preserve the current optional `movingRooms` map, present when rooms moved; client/app/floor must share one
declared type.

**Course contract:** `copyWaitingCourses(tx:Transaction,fromPartyId:string,toPartyId:string,portionIds:readonly string[]):Promise<Map<string,string>>` maps each source waiting
instance to a new destination instance, retaining course identity/name, waiting state and ordering, never a fired timestamp. Rebind only moved portions and their draft
reservations. Use it for whole-bill moves too. Do not implement A773-2 Requested/pass release states here.

- [ ] Add `A803 selection` in the new state tests: deterministic `2 of 4`, toggle whole bill then deselect one child becomes loose selection, measured item has checkbox only, paid
      items disabled with reason, €40 received floor prevents a selection leaving €39.99 but allows €40.00. Contributions/shares never mark arbitrary dishes paid. A whole part-paid
      bill remains selectable with its payments; no part-paid merge.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/state/portion-selection.test.ts src/widgets/portion-picker.test.ts -t 'A803 selection'`. Expect selected-id/floor
      assertions to fail on current behavior before implementing the shared model.
- [ ] Add `A803 moves` to `apps/server/src/portion-moves.test.ts`: unpaid portions of a part-paid bill move to existing or new bill; paid ids and below-received remainder refuse
      exact `bill.line_paid`/`bill.received_exceeds_total`; wrong party, duplicate, cancelled, recalled/reserved or stale id never substitutes another portion. Include same-party
      destination restrictions, pending payment/refund and presented/settled bill checks. Assert whole transaction rollback including identities, history, extras, tickets, revisions
      and notices.
- [ ] Add `A803 split` to `party-table-actions.test.ts`: two of three whole bills plus loose dishes from staying bill leave together; each whole bill stays intact, loose picks form
      **one new bill** at leaving table; any bill may stay; no selection makes an empty bill; all selected offers Move guests, while Split anyway leaves an empty staying bill. Set
      guest counts atomically and copy both known allergy answer and unknown/not-asked state per A669. Test A666 seats before a floor join and A757 highest joined-table state remain
      intact.
- [ ] Add `A803 waiting copy` in `waiting-course-copy.test.ts`: partial and whole-bill move, multiple bills sharing one waiting instance, two same-labelled distinct instances,
      source/destination fire independently; notice rows and decoded MOVED jobs include only moved dishes, never every dish of the course. Existing printed bytes remain unchanged on
      rename or subsequent move; new notices use current destination/name.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/portion-moves.test.ts src/waiting-course-copy.test.ts src/party-table-actions.test.ts -t 'A803'`. Expect current
      single-bill/held/part-paid-transfer assertions to fail, with complete before/after snapshots retained.
- [ ] Implement picker plus atomic server commands, not a series of split/transfer requests. Reuse current paid-quantity checks and `assertBillInvariant`; relax transfer's
      untouched rule only for unpaid portions and keep merge's rule. Recheck every affected `BillEditExpected` inside the transaction; ask takeover before acting on foreign saved
      drafts and retain a losing editor's local unsaved work.
- [ ] Add `A803 race replay` to `bill-editing.table-actions.test.ts` and `till-api.table-actions.test.ts`: promise barriers queue payment versus move, takeover versus split and two
      splits against one revision. Exactly one valid operation commits; loser gets current domain refusal and no events/notices. A lost successful reply followed by stale resubmission
      cannot create another party/bill or duplicate notices. Do not promise success replay without an existing durable command contract; assert safe stale refusal and refresh.
- [ ] GREEN: rerun new files unfiltered, then
      `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/party-move-bill.test.ts src/bill-editing.table-actions.test.ts src/till-api.table-actions.test.ts src/bill-editing.bill-moves.test.ts src/adjustments-bill-payments.test.ts`.
      Run F unedited and G, plus S for any schema additions. Run
      `pnpm --filter @waitron/till exec vitest run src/widgets/portion-picker.test.ts src/widgets/portion-picker.unsaved.test.ts src/widgets/portion-picker.a11y.test.ts src/till-app-table-service.test.ts`.
- [ ] Check Cancel/Escape/navigation/switch-bill/reconnect and late refreshes retain the correct draft; disabled rows expose the reason without color alone. LOOK all board 08–10
      cases, EN/ES, both themes and widths. Browser output cannot qualify a physical handheld's dragging or a printer's paper routing.
- [ ] Apply the defect ledger below using red/green receipts; only delete an entry after its own check passes. Update EN/ES guides, then
      `git commit -s -m "feat: move dish portions and split tables with one picker"` after reviewing staged paths. Finish and land through the shared contract.

## Slice 5: Refund wording (may land independently)

**Files:** `apps/till/src/i18n/strings.ts` (`bill_refund.*`, `bill.refund_excess` and other visible Give back matches), consumers `widgets/bill-refund-dialog.ts`,
`screens/till-table-order-screen.ts`, `till-app.ts` only if copy is inline; associated dialog/screen tests and EN/ES table-service guides. Coordinate A758/A796-B; no payment/refund
implementation changes.

**Interfaces:** Keep translation keys, request bodies, submission ids and refund state machine unchanged. English action/title uses “Refund”; amount prompts say “Amount to refund”.
Reuse existing Spanish refund strings such as the current approved `Devolver…` where appropriate; do not replace them with unapproved new vocabulary.

- [ ] Add `A803 refund wording` in `widgets/bill-refund-dialog.test.ts` and table screen tests: visible title/action/excess action read Refund in English; placeholders survive,
      existing approved Spanish text remains, no Give back label in touched flows. Keep unchanged cash/card/manual-terminal/PIN and retry body assertions.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/widgets/bill-refund-dialog.test.ts src/screens/till-table-order-screen.test.ts -t 'A803 refund wording'`. Expect old
      visible-label assertions to fail.
- [ ] Change wording only; inspect all English Give back/“Given back” variants for context, and keep explanatory operational instructions accurate. Record any genuinely needed
      Spanish proposal at this point and wait for approval before using it.
- [ ] GREEN:
      `pnpm --filter @waitron/till exec vitest run src/widgets/bill-refund-dialog.test.ts src/widgets/bill-refund-dialog.unsaved.test.ts src/widgets/bill-refund-dialog.a11y.test.ts`;
      rerun the focused screen cases, G and LOOK. Expect passing labels with original behavior assertions retained.
- [ ] `git commit -s -m "docs: call bill payment returns refunds"` after staging copy/tests/guides only. Finish/land as a low-risk wording change, skipping external production-code
      review if the installed finishing skill agrees with the owner rule.

## Slice 6: stored pre-bills, only after asesor S2

**Gate:** Do not begin implementation until the driver records the asesor's answer and owner approval against A446/S2. The question file separately labels advance-payment timing
**S3** (`docs/compliance/asesor-questions.md:301–309`), while the A803 spec bundles that uncertainty under S2. Check both answers when deciding whether the current payment model
remains valid. If advances require separate invoices, park and open separate fiscal design; do not change A803's protected gates.

**Files, proposed after gate:** `packages/venue-service/src/schema/pre-bills.ts`, schema export/classification/migration map; `apps/server/src/pre-bills.ts`, `pre-bills-api.ts`,
`pre-bill-ticket.ts`; till `widgets/pre-bill-dialog.ts` and its behavioral/unsaved/a11y siblings, `api/client.ts`, `screens/till-table-order-screen.ts`;
`apps/server/src/guide/{en,es}/table-service.md`. Reuse slice-1 portion registry/sale links; do not alter fiscal receipt issuance or pretend the pre-bill is a new invoice type.

**Interfaces:** Proposed `PreBillSnapshot {id:string;billId:string;printedAt:string;billName:string|null;portionIds:readonly string[];bytes:Uint8Array;fingerprint:string}`;
`storePreBill(tx:Transaction,snapshot:PreBillSnapshot):Promise<void>` persists exact rendered bytes, language/layout and frozen textual/monetary snapshot. Proposed
`readPreBillTrail(tx:Transaction,portionIds:readonly string[]):Promise<{preBillIds:string[];saleIds:string[]}>`. Link through immutable memberships, never through current bill
membership. Final label/disclaimer is gated on the answer and approved Spanish.

- [ ] After the gate, add `A803 pre-bill` in proposed `apps/server/src/pre-bills.test.ts`: frozen bytes have no invoice number or tax QR; reprint sends identical bytes, even after
      rename/move/split; portion membership joins one pre-bill to several final invoices and an invoice to several pre-bills. A cancelled portion stays in the original snapshot/trail
      without fabricating a sale.
- [ ] Add print failure and submission replay: storage and durable print enqueue are atomic, retry creates no duplicate snapshot/job; distinguish queued from printer-confirmed
      output. Add old-to-new change indicator test using a content fingerprint, not current time; “Pre-bill printed 21:40 · changed since” and Reprint never block Pay. Nothing printed
      remains possible.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/pre-bills.test.ts -t 'A803 pre-bill'`; expect absent snapshot/membership or changed-reprint assertions to fail once
      wired to the existing path.
- [ ] Implement only the answer-approved non-fiscal document flow, immutable storage and bidirectional trail. No edits to original snapshots, sale amounts or fiscal records after
      moves. Keep bill-requested state distinct from whether a printer finished a job.
- [ ] GREEN: rerun the server file unfiltered and new API tests (`pnpm --filter @waitron/server exec vitest run src/pre-bills.test.ts src/pre-bills-api.test.ts`), new till dialog
      tests (`pnpm --filter @waitron/till exec vitest run src/widgets/pre-bill-dialog.test.ts src/widgets/pre-bill-dialog.unsaved.test.ts src/widgets/pre-bill-dialog.a11y.test.ts`), S,
      F unedited and G. Run LOOK, including exact reprint after portions reach different bills; report physical print status separately.
- [ ] Update EN/ES guide and A446 residuals with actual adviser decision receipts. Stage reviewed paths;
      `git commit -s -m "feat: retain printed pre-bills and their portion trail"`. Finish and land through the shared contract; retain any changed advance-payment requirement as
      separate work.

## Dependency tail: A773-2 station modes, pass and shared fire tickets

This tail is independent of asesor S2. It waits for **A773-2 to land** and its reservations to release; it does not become build authority just because slices 1–4 land. Refresh the
exact paths/signatures against the new Requested/pass design before writing code.

- Carry slice-1 portion ids and slice-2 names into the A773-2 station/pass contracts. Current settings live in `packages/venue-service/src/schema/settings.ts`, station management
  screens under `packages/venue-service/src/dashboard/`, ticket links in `apps/server/src/kitchen-print.ts`; A773-2 may replace them.
- Add station choices grouped / one line per portion / one ticket per portion. New tests in current `apps/server/src/kitchen-ticket.test.ts` plus a proposed
  `kitchen-cross-bill-fire.test.ts` must assert one action firing a multi-bill course makes one grouped ticket **per station**, names named bills, omits unnamed labels, and
  preserves each portion's job links. Do not batch separate sends.
- Pass/kitchen grouping must match paper; after a rename/move, pass reads the current name while printed job bytes stay frozen. Include mixed named/unnamed rows and duplicate
  names, retaining bill ids behind labels. No seat tracking is implied.
- Run `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-cross-bill-fire.test.ts`, first RED then GREEN; add exact A773-2 owning station/pass
  browser commands to this tail once those files exist. Retain ticket replay, printer routing and station-profile authorization assertions.
- This is an explicitly deferred integration checklist, not a seventh implementation slice or a claim that station/pass tests already exist. Update both guides and inspect phone
  pass in both themes before closing §3.2/§3.3/§6's multi-bill-fire requirements.

## Recorded move/join/split defects: closure requires an experiment

Read each detailed entry in `docs/backlog/till.md` at implementation time; none is deleted by this plan. Slice 4 owns A590's integration fix. Other entries remain unless separately
authorized and reproduced; the redesign does not by itself repair floor-reset policy.

| Entry                     | Check needed to close, or explicit retention                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A563                      | Retain: collapsed joined table and constituent currently share `table.in_joined_table`. Closing needs two real route cases with distinct appropriate localized wording in `till-api.table-actions.test.ts`; new Spanish requires approval.                                                                                                                                                    |
| A590                      | Slice 4, new `A803 applies split room revision before reload` in `till-app-table-service.test.ts`: hold next floor read, return split `zoneRevisions`, send a floor edit before releasing the read; assert new revision is sent and no out-of-date bounce. RED/GREEN: `pnpm --filter @waitron/till exec vitest run src/till-app-table-service.test.ts -t 'A803 applies split room revision'`. |
| A591 / A598               | Retain together: reproduce documented Long table/held Counter 3/reset/split-down-to-one in `floor-today-reset-table.test.ts`; closing requires Counter 3 remains reachable after its guests leave and complete split-off membership permits later rejoin without a surprise Seats refusal. A picker change alone proves neither.                                                              |
| A592                      | Retain: add ids deliberately reversed against table numbers to `party-table-order.test.ts`, invoke actual `seatMergeMembers` and `joinMergeMembers`, assert number order and decoded MOVED label. Stable bill numbers do not fix table membership order.                                                                                                                                      |
| A593                      | Retain: `floor-catch-up.test.ts` scenario “the reset leaves in one”; closing needs an owner-approved outline rule and exact final bounds after reset/split, not a new guessed width.                                                                                                                                                                                                          |
| A594                      | Retain the whole-group policy question. In slice 4 characterize free-table-in-group bill arrival in `party-move-bill.test.ts`, snapshot group membership/name and decoded MOVED jobs. Closing needs approved whole-group seating plus the named-group Move guests case, with final name in the notice after group changes.                                                                    |
| A603                      | Retain: two `floor-today-reset-table.test.ts` repros, food for another group member and module refusal to remove; closing requires reset leaves the proper whole group waiting and no rows/layout change.                                                                                                                                                                                     |
| A604                      | Retain as unestablished reachability: construct or disprove the out-of-service split-off table through public operations in `floor-today-reset-table.test.ts` and till `screens/till-floor-screen.reset-table.test.ts`; compare submitted ids to the server's expected set. Negative reading is not closure.                                                                                  |
| A565 / A566               | Retain: reset ordinary table with incoming food; reset split group with saved unsent order. Need explicit busy-policy decision and row/layout assertions in `floor-today-reset-table.test.ts`; no A803 automatic policy expansion.                                                                                                                                                            |
| A567 / A568               | Retain: change recorded layout while group waits, and place a free part during that wait. Need approved slot/visibility decisions and exact positions in `floor-catch-up.test.ts`, plus actual till map visibility; bill splitting is a different operation.                                                                                                                                  |
| A570 / A571 / A572 / A575 | Retain adjacent defects: module-refused removal, off-map Reset access, held-part seats and Spanish reset-window wrapping. Close only with their detailed repro in `floor-today-reset-table.test.ts`/`screens/till-floor-screen.reset-table.test.ts` and EN/ES 390 px LOOK for A575. A561/A562/A569 are separate floor/editor layout work and also remain.                                     |

For any retained entry later authorized here, first add its named failing case and run the exact owning file via
`pnpm --filter @waitron/server exec vitest run src/FILE.test.ts -t 'CASE'` or the till equivalent, then rerun the whole file after the fix. Replace FILE/CASE in the execution
receipt with actual names. Do not report those proposed experiments as performed.

## Self-review against the spec and amendments

| Requirement                             | Coverage / deliberate gate                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| §1–2 motivation and current behavior    | Current map; single-payment/split ambiguity removed by slices 3–4, no runtime claim from inspection                                   |
| §3.1 portions/extras/measures/display   | Slice 1 identity, expansion, comparison, receipt grouping; slice 4 deterministic selection                                            |
| §3.2 station modes and across-bill fire | Dependency tail after pending A773-2, independent of S2; slice 1 keeps current modes only                                             |
| §3.3 names                              | Slice 2 storage/UI/current tickets after release; pass delayed in tail                                                                |
| §3.4 no main bill/join keeps separate   | Slice 3 explicit selection and retirement trace; stable numbers slice 2                                                               |
| §3.5 controls, amended                  | Slice 3 one dropdown even for one bill, one kebab with two headings, totals/Pay only                                                  |
| §3.6 same-party Move dishes             | Slice 4 new/existing destination, exact selected portions; no direct cross-party dish transfer                                        |
| §3.7 table split and four awkward cases | Slice 4 whole/loose/all/none/part-paid/takeover, guest counts, own waiting copies and A669 allergies                                  |
| §3.8 payment/merge                      | Slices 1/3/4 preserve one payment one bill, strict no part-paid merge and received-money floor                                        |
| §3.9 pre-bill and paid correction       | Slice 6 gated S2/S3; portion trail ready in slice 1; correction is A802, explicitly unavailable until known                           |
| §3.10 Refund                            | Independent slice 5; no invented Spanish                                                                                              |
| §4 goals/non-goals/anti-goals           | Six slices and H2; no seat model, guest phone, tips or new fiscal correction                                                          |
| §5 sequencing/legal/related designs     | A773-1 landed, A773-2 pending; A757/A669/A504/A666 checks; S2/S3 separate decisions                                                   |
| §6 builder calls                        | Whole-bill course copies slice 4, no implicit merge slice 3, name snapshots/live pass in tail, defect ledger, stored numbers/floor    |
| §7 open builder choices                 | Deterministic selection, grouped fiscal storage plus portion map, gated remainder comparison and receipt/pre-bill name choices stated |
| Amendment 1                             | Full invoice on payment plus unpaid menu shortcut; A741/A739 coordination; paid A802 gate, no fiscal invention                        |
| Amendments 2–4                          | Always dropdown/+ New bill; single ordered kebab; table has no Hold, counter A739 Hold stays separate                                 |
| Amendment 5                             | Native Pay tappable/quiet only for this bill's unsent dishes, exact existing A773 refusal and no charge                               |
| Amendment 6                             | Approved strings reused, new Spanish proposals only at implementation and approved before shipping                                    |

Before execution, recheck current reservations and run the monetary comparison. Resolve the numbering-scope lifetime before slice 2. These gates require their own evidence;
source inspection and plan review do not establish runtime behavior.
