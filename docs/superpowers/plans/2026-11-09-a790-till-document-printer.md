# A790: choose the recorded document, then its printer

**Approved by the watcher, 9 November 2026 at 23:14**, in Lane F `questions.md`, “WATCHER 2026-11-09 23:14 — A790 plan: APPROVED with these changes (no new Claude read)”. Owner20:34: “Drop it, small slices”, recorded there under “OWNER 2026-11-09 20:34 — lane F walk”. Claude’s completed read and the watcher’s corrections are incorporated below.

**Finish:** live sales and history with a working-order id have one **Print/Reprint** entry. F1 chooses recorded **Receipt/Invoice**, then that role’s printer; F2 opens directly at Receipt’s printer row. Explicit confirmation names the destination and original/copy. F1 Receipt retains its customer. Selection, saving, Refresh and Back print nothing.

**Estimate:** production +300/−110, tests +330/−80, support +0/−0, docs +75/−15: **910 changed lines**, zero generated. Three hours to open PR; stop for outside opinion at 1,400 changed lines (watcher23:14). Orderless F1 Invoice delivery remains a separately approved ≤3h slice (production +180/−25, tests +250/−20, docs/support +40/−5).

## Build on existing paths

Source inspection at `1252e2b6b3`, **runtime-unverified**: `till-api.ts:2545–2707`, `transaction-receipt-api.ts:42–90`, `receipt-print.ts:313–350`, `invoice-delivery.ts:128–147`, and `till-app.ts:9412–9965`. Existing routes suffice; no server changes.

1. Extend #2640’s folded Invoice chooser; add Receipt using Equipment GET/PUT and its serialized queue. Show **Use default** first, then profile order, with printer/paper names. Keep saved resolution; unavailable explicit choices never silently fall back. Without a resolved destination require a choice, even with one printer. Empty/read-failed lists offer Refresh/Back.
2. Export/reuse `equipment-dialog.ts`’s takeover prompt in the Receipt row, showing its holder and sending `takeOver` only after confirmation. Invoice has no holder. Extend `#chooseInvoicePrinter` and Equipment-overlay synchronization for Receipt. Wait for confirmed save; Receipt uses the PUT snapshot and existing enqueue-time Equipment resolution, Invoice refreshes its delivery offer. Preserve permissions and session checks.
3. Use existing Receipt original/reprint and Invoice delivery handlers. History copies keep transaction-reprint/audit. After an F1 Receipt copy, refresh receipt and delivery status; show its domain refusal in the section. Keep retry/replacement controls in their existing positions, preserving their fixed destinations. The existing language dialog still follows Copy; cancelling it prints nothing. Email/handover stay separate.

| Receipt state | Confirmation |
| --- | --- |
| F2 original available / otherwise | Original / Copy |
| F1 not queued, no active/completed original | Original |
| F1 completed Receipt, A4 or email original | Copy |
| F1 active, failed/retryable or unresolved | No fresh Print; existing status/retry controls remain |

Copy after completed A4/email is an approved UI change using existing server capability. The Receipt printer name is a label only: an Equipment change before the press can send the job elsewhere, or make no job while the request reports success (`transaction-receipt-api.ts:66`). Device-free sessions retain their existing controls. The settled-table Receipt shortcut and handheld paid view stay with A739.

## Files and proof owners

Modify under `apps/till/src/`: `till-app.ts`, `screens/till-ticket-view.ts`, `widgets/equipment-dialog.ts`, `i18n/strings.ts`. Tests: `till-app.test.ts`, `till-app-boot-and-counter.test.ts`, `till-app.invoice-printer-choice.test.ts`, new `till-app.document-printer-choice.test.ts`, `widgets/equipment-dialog.test.ts`, and `screens/till-ticket-view{,.presentation,.a11y,.look}.test.ts`. Reuse existing `apps/till/test/{bill-pay-app,pay-equipment-fixtures}.ts` unchanged.

View tests own the state table, role/default order, names and unavailable lists. Widget tests own the shared takeover prompt. App tests own confirmed-save sequencing, takeover forwarding, live/history dispatch and F1-copy refresh/refusal. Receipt app tests cover only its different save answer and takeover; do not repeat Invoice save-failure cases. Existing Equipment/server tests retain dependency failure permutations; do not repeat them. TDD each changed behavior; retain behavioral assertions when entry selectors change.

Run `pnpm --filter @waitron/till exec vitest run` naming the listed test files explicitly. Run server `src/guide-content.test.ts` only; no unchanged delivery suites. LOOK EN/ES, light/dark, 390/1280. Update `apps/server/src/guide/{en,es}/table-service.md` and A790’s two backlog entries. Normal hook/current-head CI; no whole-package run.

## Release boundary

A739’s prerequisite for sales with an order is released after this slice lands (watcher23:14); A739 must replan its old document-command rows. Dated corrections in its old plan and `docs/backlog/till.md` are approved (watcher23:10). Orderless Invoice, dashboard and payment-time choices remain open. Drop G4, origin file, browser journal, prepare/accept and all-writer revisions entirely; no A947 wait or duplicate-print protection. Landed foundations grant no cleanup authority. No fiscal issuance, F2→F1 or payment change.
