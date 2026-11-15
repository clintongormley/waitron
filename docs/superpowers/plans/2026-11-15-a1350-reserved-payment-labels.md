# A1350: reserved-payment labels

Status: source-checked by the Lane F driver; awaiting Claude plan review and watcher clearance before build. No design approval is claimed.
Execution: Lane F driver works inline, test first; one PR. Whoever lands second against Lane E's A1308 payment slices rebases and rechecks the affected picker paths.

## Request and smallest useful result

Queue ask, supplied verbatim from `~/waitron-campaign-f/queue.md` A1350:
> docs/backlog/till.md:3715 (index docs/backlog.md:797): in Split a table and Move dishes, a row must not read Paid while a card payment is still in progress; the rule that keeps that money with its bill stays (paidQuantitiesOf in apps/server/src/bill-payments.ts, apps/till/src/widgets/portion-picker.ts). Lane E's A1308 payment slices will rewrite these tables: whoever lands second rebases. Plan first; one PR.

Use neutral words in the shared picker: explain why a dish or amount stays without claiming payment succeeded. This satisfies the ask without distinguishing pending from received money.
Reuse Lit, the current translation dictionary, `PickRow.blocked` and the existing picker test fixtures. Keep every selection and money rule unchanged.
Source read, not runtime verification: `apps/server/src/bill-payments.ts:386` includes pending and received item payments; `apps/till/src/state/portion-selection.ts` maps those quantities to `paid` and sets the minimum retained amount to received plus reserved.
`apps/till/src/widgets/portion-picker.ts:187` renders both reasons; Split a table embeds this same picker. `bill_pay.paid` also labels payment screens, so its meaning and unrelated consumers stay unchanged.

## Wording and exact production files

- Modify `apps/till/src/widgets/portion-picker.ts`: only change the `paid` reason's translation key to `table.pick_payment_stays`; leave rendering, events, counts and accessibility links intact.
- Modify `apps/till/src/i18n/strings.ts`: add that key in EN/ES and replace the picker-only `table.move_dishes_floor` words, keeping `{amount}` and its existing formatting.
- Proposed English: “This dish has a payment: it stays on this bill” and “Keep {amount} on this bill: move fewer dishes”. These apply to pending, received and mixed balances alike.
- Proposed Spanish: «Este plato tiene un pago: se queda en esta cuenta» and «Deja {amount} en esta cuenta: mueve menos platos». Clearance question for the watcher: settle these exact EN/ES words and obtain the existing new-Spanish approval (`docs/backlog/till.md`, A803). Record whose wording decision it is; do not infer owner approval from plan review or clearance.

No backend, API fields, new money classifications, schema, dependencies, payment mechanisms, provider calls, fiscal changes or unrelated UI cleanup. No new test helpers unless existing support needs a small extension.

## One implementation task, with focused test ownership

- [ ] Before code or tests, read the TDD skill and browser-test conventions. After clearance, add the regression assertions below before changing production words.
- [ ] In `apps/till/src/widgets/portion-picker.test.ts`, reuse `picker`, `rowsOf`, `balance` and real selection functions. Supply pending item `paidLines` with received zero and reserved positive; assert the literal cleared reason, disabled tick, visible `aria-describedby` target and no emitted picks on a forced click.
- [ ] In that file, render a pending contribution (reserved positive, no `paidLines`) that blocks a row at the floor. Assert literal cleared EN/ES words and formatted amount. Retain received-only coverage; add mixed received/reserved coverage proving the displayed minimum is their sum and the same count limit still holds. Restore locale after each case.
- [ ] In `apps/till/src/widgets/split-picker.test.ts`, reuse the reserved-only integration case and `source` options. Cover a pending item row through the real child picker; keep the received-only header, mixed header, whole-bill ticks and blocked-row assertions. Pin neutral row words rather than merely comparing with a dictionary value that could still say Paid.
- [ ] In `apps/till/src/screens/till-table-order-screen.split-table.test.ts`, change only the old reason expectation and test title in the re-read case; preserve its assertion that the newly protected dish drops from picks while the other dish remains.
- [ ] Run the affected picker cases with `pnpm --filter @waitron/till exec vitest run src/widgets/portion-picker.test.ts src/widgets/split-picker.test.ts`; observe expected red because pending rows still say Paid/already paid, not a missing key or fixture failure. Record the failures before implementation.
- [ ] Make the two production-file changes above, then rerun those suites to green, reading the test counts.

Preserve all behavioural assertions. Only wording expectations named above change; list each changed check in the eventual PR's **Changed test checks**. Leave unrelated Paid labels and tests intact.
Protection ownership stays in unchanged `apps/till/src/state/portion-selection.test.ts`, especially “the kept money is what was received plus what is reserved”, item blocking and count limits. No backend tests when backend code is unchanged.

## Verification, guides and completion

- [ ] Run `pnpm --filter @waitron/till exec vitest run src/state/portion-selection.test.ts src/widgets/portion-picker.a11y.test.ts src/widgets/split-picker.a11y.test.ts` and require passing test counts.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.test.ts src/screens/till-table-order-screen.move-dishes.test.ts` for both consumers, plus `pnpm --filter @waitron/till typecheck`.
- [ ] Inspect Move dishes and Split a table in EN/ES, light/dark, phone/desktop, using pending-item, pending-contribution and mixed examples. Check wrapping and readable reasons beside disabled controls. Use the managed worktree stack; keep captures local and uncommitted.
- [ ] Update `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`: replace old Paid/floor explanations and the re-read label in `#move-dishes`; explain the shared rule briefly in `#split-table`, retaining heading ids. Do not instruct refunding a payment still in progress.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`; these check guide structure/links, not backend payments.
- [ ] On completion, remove only A1350 from `docs/backlog/till.md` and `docs/backlog.md`, including its membership in both A803 open-item summaries. Preserve all other open items and decisions.
- [ ] Driver finishes through `finish-branch`: required Claude review, normal pre-push hook and current-head scoped CI. No whole-workspace local test run solely for finishing.

Estimated production diff: 5–15 additions / 2–5 removals across two files.
Estimated test diff: 35–65 additions / 5–15 removals across three files; existing protection/accessibility suites reused unchanged.
Estimated guides/backlog diff: 10–20 additions / 20–35 removals across four files, separate from production/tests. This plan is the only change in the drafting pass.
