# A1350: truthful payment reasons in the shared picker

Claude reviewed the approach (135 seconds) and corrections (106 seconds, approve). This condensed plan incorporates its last test-command correction and drops its optional Split-guide clause. The watcher cleared the plan and exact EN/ES words at 23:09 on 15 November (Lane F questions.md), with the main-list addition and test reductions below. No owner design approval is claimed. Lane F implements inline, test first, one PR.

## Ask and finish line

Verbatim from `~/waitron-campaign-f/queue.md`, A1350:
> docs/backlog/till.md:3715 (index docs/backlog.md:797): in Split a table and Move dishes, a row must not read Paid while a card payment is still in progress; the rule that keeps that money with its bill stays (paidQuantitiesOf in apps/server/src/bill-payments.ts, apps/till/src/widgets/portion-picker.ts). Lane E's A1308 payment slices will rewrite these tables: whoever lands second rebases. Plan first; one PR.

Both panels use neutral reasons for pending **and received** payments: received rows also lose their accurate Paid label. Reuse `PickRow.blocked`, existing selection rules, translations and fixtures. Change no money calculation, blocking rule, API, schema, dependency, provider call or fiscal code.

## Files and proposed words

- `apps/till/src/widgets/portion-picker.ts`: point its paid reason to new `table.pick_payment_stays`; retain rendering, counts, events and accessibility links. Leave shared `bill_pay.paid` unchanged.
- `apps/till/src/i18n/strings.ts`: add that key and reword picker-only `table.move_dishes_floor`, retaining `{amount}` formatting.
- EN: **Has a payment**; **Payments keep {amount} on this bill: move fewer dishes**.
- ES: **Tiene un pago**; **Los pagos retienen {amount} en esta cuenta: mueve menos platos**.
- `apps/till/src/screens/till-table-order-screen.ts`: point `#paidText` at new neutral whole/partial keys; whole reuses `table.pick_payment_stays`, partial uses “{paid} of {quantity} have a payment” / «{paid} de {quantity} tienen un pago». Leave `bill_pay.paid` and `bill_pay.paid_part` unchanged. Retain the owner’s “move fewer dishes” suffix.

## Test-first task

- [x] First add one failing EN/ES pending-money badge case in `apps/till/src/screens/till-table-order-screen.bill-payments.test.ts`, with literal whole/partial words and zero received. Read TDD/browser conventions. In `apps/till/src/widgets/portion-picker.test.ts`, extend existing `balance()` with a defaulted reserved parameter. Test pending-item `paidLines` with zero received: literal cleared EN/ES reason, disabled tick, visible `aria-describedby`, no emitted picks on forced click. Test pending-contribution and mixed floors: literal reason and received-plus-reserved amount. Existing state tests own count limits.
- [x] Update only old wording/title checks: portion-picker base lines 248, 261, 281, 288, 299, 306, 326, 625 (keep aria-description equality at 329); split-picker 235/260; `apps/till/src/screens/till-table-order-screen.split-table.test.ts` 1329/1351. Update main-list badge-key checks in the existing bill-payments, current-list-retirement, sent-portions, sent-change and sent-fallback suites too; retain every quantity/grouping/accessibility assertion. Use literal cleared copy in the new cases. Preserve all behavioural assertions; list changes in the PR's **Changed test checks**.
- [x] Run `pnpm --filter @waitron/till exec vitest run src/widgets/portion-picker.test.ts src/widgets/split-picker.test.ts src/screens/till-table-order-screen.split-table.test.ts`; record expected red (old Paid/already-paid words). Then make the production wording changes and rerun to green.

## Verification and documentation

- [x] Run focused till files `src/state/portion-selection.test.ts`, `src/widgets/portion-picker.a11y.test.ts`, `src/widgets/split-picker.a11y.test.ts`, `src/screens/till-table-order-screen.move-dishes.test.ts` with Vitest; read counts. No backend tests: backend unchanged.
- [x] Inspect both panels, EN/ES, light/dark, desktop/phone; include A1290's 1280×900 and 390×844 layouts. Keep captures local; leave the existing panel-layout item alone.
- [x] Replace old quoted reasons/refund-only advice in `apps/server/src/guide/{en,es}/table-service.md`, `#move-dishes`; update `docs/developers/design-system.md` for picker reasons and main-list marks. No new Split-guide clause. Run server `src/guide-content.test.ts` and root `scripts/guide-links.test.ts` with Vitest.
- [x] Remove only completed A1350 entries and A803-summary membership from `docs/backlog.md` and `docs/backlog/till.md`. Locate by ID; the quoted index line is stale.
- [ ] Finish through `finish-branch`, normal pre-push hook and current-head scoped CI; then authorised landing. Rebase overlapping Lane E changes when required. No whole-workspace local run solely to finish.

The watcher’s 23:09 reviewer-read clearance adds the small main-list badge change, drops two duplicate new split-picker cases, and requires the PR to say that dishes whose money has arrived also stop saying Paid. No new payment distinction is introduced.

Expected diff: production +8–20/−4–10 (3 files); tests +50–90/−15–35 (existing suites); guides/backlog/design-system +10–20/−20–35 (5 files). No generated files, new helper framework or unrelated cleanup.
