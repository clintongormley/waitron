# Quiet Pay implementation plan (PR 15)

Staff opening Pay at a table or Counter can see the amount due first, choose Whole bill, Split equally, Items or An amount in that order, and find the large Card and Cash choices above a quieter Other card machine action. A connected card confirmation reads **Charge {amount}**. When a payment includes a tip, show the bill amount and tip separately under the total.

This is [pass 1, PR 15](2026-11-26-till-handheld-redesign-pass-1.md#prs-after-the-bill-picker), from the [owner-approved design](../specs/2026-11-26-till-handheld-redesign-design.md#72-the-waiters-pay-screen), §§7.2 and 7.8 and approved frame `q` 1. The watcher assigned PR 15 to Lane I at 19:25 CET on 26 November. The frame also shows invoice and equipment entry points that ship in PRs 16–17. Cash, reader waiting, Paid and the guest bill and tip are later slices.

## Build

1. In `apps/till/src/widgets/quiet-pay.ts`, share the small amount display and token styles across the existing `bill-pay-dialog.ts` and `presented-pay-dialog.ts` Lit dialogs. Style their current tender radios as large Card/Cash choices and a smaller, link-styled Other card machine choice. Keep native input semantics, tab order, wrapping and touch targets. Use the offered methods and their current handlers. Keep Continue for previews, confirmation, all fields, and equipment, invoice, deferred and retry entry points. The Counter's direct controls for legacy whole-order paths stay in `tender-pay.ts`.
2. Reorder `BILL_PAY_WAYS` in `apps/till/src/state/bill-payment.ts`. In shared Pay, lead with the outstanding balance and keep paid, reserved and overpaid facts available. On card confirmation, use the server preview's charged, applied and tip values for the headline and breakdown. Use the existing validated whole-bill amount and staged card tip if both are known before preview. The amount on a split comes from its preview. Keep cash change and tip handling in its existing confirmation. Presented Pay leads with its existing amount and keeps its whole-payment rules and existing Pay in parts gate.
3. Update `readerButtonLabel` in `apps/till/src/widgets/pay-equipment.ts` and EN/ES strings in `apps/till/src/i18n/strings.ts`. Keep the retry action distinct. Reader choice remains visible in the existing equipment controls and the waiting panel. Keep sent requests and their reader IDs, no-answer recovery, overpaid actions and permission gates. Amend `docs/developers/design-system.md`, `docs/backlog.md` and the EN/ES `apps/server/src/guide/*/table-service.md` guides.

## Verify

- [ ] Write and run the failing assertions in `bill-pay-dialog.test.ts` and `presented-pay-dialog.test.ts` first. Check choice order, the amount and positive-tip breakdown, charge and retry text without a reader name, and the original preview or confirmation payload. Keep reader-switch, unavailable-reader, equipment, Pay in parts and retained-request assertions. Name wording assertion changes in the PR.
- [ ] Build, then run those files, their accessibility and unsaved-input suites, `till-app-counter-payment-window.test.ts`, and the guide guards. Inspect phone and till in portrait and landscape, light/dark and EN/ES. Give the watcher the pictures outside Git. Two Claude run-it reviews, green current-head CI and the owner's recorded picture OK precede landing.

Allow three working hours. Estimate 115–170 changed product lines and 60–100 changed test lines, plus the guide and backlog edits. The slice ends with the existing Pay flows reachable through the new presentation.
