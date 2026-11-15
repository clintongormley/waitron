# A1350: truthful payment reasons in the shared picker

Claude reviewed the approach (135 seconds) and corrections (106 seconds, approve). This condensed plan incorporates its last test-command correction and drops its optional Split-guide clause. Watcher clearance and the A803 new-Spanish decision are pending. No owner design approval is claimed. Lane F implements inline, test first, one PR.

## Ask and finish line

Verbatim from `~/waitron-campaign-f/queue.md`, A1350:
> docs/backlog/till.md:3715 (index docs/backlog.md:797): in Split a table and Move dishes, a row must not read Paid while a card payment is still in progress; the rule that keeps that money with its bill stays (paidQuantitiesOf in apps/server/src/bill-payments.ts, apps/till/src/widgets/portion-picker.ts). Lane E's A1308 payment slices will rewrite these tables: whoever lands second rebases. Plan first; one PR.

Both panels use neutral reasons for pending **and received** payments: received rows also lose their accurate Paid label. Reuse `PickRow.blocked`, existing selection rules, translations and fixtures. Change no money calculation, blocking rule, API, schema, dependency, provider call or fiscal code.

## Files and proposed words

- `apps/till/src/widgets/portion-picker.ts`: point its paid reason to new `table.pick_payment_stays`; retain rendering, counts, events and accessibility links. Leave shared `bill_pay.paid` unchanged.
- `apps/till/src/i18n/strings.ts`: add that key and reword picker-only `table.move_dishes_floor`, retaining `{amount}` formatting.
- EN: **Has a payment**; **Payments keep {amount} on this bill: move fewer dishes**.
- ES: **Tiene un pago**; **Los pagos retienen {amount} en esta cuenta: mueve menos platos**.
- Ask the watcher to settle these words, including the existing A803 new-Spanish approval. Retain the owner's “move fewer dishes” suffix (`docs/backlog/till.md:3827`).

## Test-first task

- [ ] Read TDD/browser conventions. In `apps/till/src/widgets/portion-picker.test.ts`, extend existing `balance()` with a defaulted reserved parameter. Test pending-item `paidLines` with zero received: literal cleared EN/ES reason, disabled tick, visible `aria-describedby`, no emitted picks on forced click. Test pending-contribution and mixed floors: literal reason and received-plus-reserved amount. Existing state tests own count limits.
- [ ] In `apps/till/src/widgets/split-picker.test.ts`, reuse `source({reserved, paid})`: prove the child picker renders pending-item and pending-floor reasons, preserving header and whole-bill assertions.
- [ ] Update only old wording/title checks: portion-picker base lines 248, 261, 281, 288, 299, 306, 326, 625 (keep aria-description equality at 329); split-picker 235/260; `apps/till/src/screens/till-table-order-screen.split-table.test.ts` 1329/1351. Use literal cleared copy, not dictionary-only comparisons. Preserve all behavioural assertions; list changes in the PR's **Changed test checks**.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/widgets/portion-picker.test.ts src/widgets/split-picker.test.ts src/screens/till-table-order-screen.split-table.test.ts`; record expected red (old Paid/already-paid words). Then make the two production changes and rerun to green.

## Verification and documentation

- [ ] Run focused till files `src/state/portion-selection.test.ts`, `src/widgets/portion-picker.a11y.test.ts`, `src/widgets/split-picker.a11y.test.ts`, `src/screens/till-table-order-screen.move-dishes.test.ts` with Vitest; read counts. No backend tests: backend unchanged.
- [ ] Inspect both panels, EN/ES, light/dark, desktop/phone; include A1290's 1280×900 and 390×844 layouts. Keep captures local; leave the existing panel-layout item alone.
- [ ] Replace old quoted reasons/refund-only advice in `apps/server/src/guide/{en,es}/table-service.md`, `#move-dishes`; update `docs/developers/design-system.md:6337–6340`. No new Split-guide clause. Run server `src/guide-content.test.ts` and root `scripts/guide-links.test.ts` with Vitest.
- [ ] Remove only completed A1350 entries and A803-summary membership from `docs/backlog.md` and `docs/backlog/till.md`. Locate by ID; the quoted index line is stale.
- [ ] Finish through `finish-branch`, normal pre-push hook and current-head scoped CI; then authorised landing. Rebase overlapping Lane E changes when required. No whole-workspace local run solely to finish.

The main table dish-list Paid/part-paid badges (`till-table-order-screen.ts:5416`) remain outside the ask. Recommend one PR-thread line under RUNNER's loose-ends rule; watcher settles whether an existing backlog bundle instead needs a durable line.

Expected diff: production +5–15/−2–5 (2 files); tests +35–65/−5–15 (3 files); guides/backlog/design-system +10–20/−20–35 (5 files). No generated files, new helper framework or unrelated cleanup.
