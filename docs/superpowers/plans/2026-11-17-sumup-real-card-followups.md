# SumUp real-card followups implementation plan

**Finish line:** Truthful payment wording across dashboard/customer documents, no stale SumUp battery percentage or alert, and an explicit device-reader step in the check script.
**Authority:** SUMUP-REAL-CARD-FOLLOWUPS in `~/waitron-campaign-f/queue.md`; owner findings in `~/waitron-campaign-f/questions.md:575–644`. No owner design approval recorded. Driver commits, obtains Claude plan review, then watcher clearance before building.
**Reuse:** `buildCardProvider` (`boot.ts:614–616`), saved payment/sale links, receipt presentation/renderers, the existing reader-status contract, battery cache/alert source; existing TypeScript/SQLite/Lit/Vitest dependencies.
**Excluded:** Global `practiceMode` changes, fiscal data/builders/numbering/hashes, email capture/demo printers, settlement matching, browser-device battery (#3676), new tables/jobs/protocols, key-prefix assumptions or merchant-authenticity claims. No A949 completion claim.
**Execution:** Inline; read the TDD skill before code. Each task starts with an observed failing behavioural test, then minimal implementation and a green rerun. Commands below are future checks.

## 1. Payment wording follows the relevant facts

- [ ] Trace every simulation/practice-label consumer before editing, including prose. Configuration describes the current simulator; saved documents describe the recorded payment.
- [ ] Expose `simulatedCardPayments: boolean` from `cardProvider?.provider === "simulator"` through authenticated `/management-api/me`; show no simulator banner until known.
- [ ] Modify `apps/server/src/{boot,me-api}.ts` and `apps/dashboard/src/{api/client,dashboard-app,screens/payments-screen}.ts`. Replace mode-only banner gating; preserve mode identity chrome.
- [ ] Add `readReceiptSimulation(tx: Transaction, saleId: string, practiceMode: boolean): Promise<boolean>` in `apps/server/src/receipt-presentation.ts`, using all saved payment links, including splits.
- [ ] Any recorded non-simulator card charge suppresses no-real-charge wording; simulator-only charges retain it across configuration changes. Cash-only Demo/default Prepare stays practice. Ignore failed attempts; refunds do not erase a charge; outside-card records must not claim no charge.
- [ ] Carry explicit `simulated` through fresh/replay/history responses: `apps/server/src/{receipt-presentation,till-sale,bill-payments,transaction-receipt}.ts`; extend both `TillSaleResult` declarations (`till-sale.ts`, `apps/till/src/api/client.ts`) with `simulated?: boolean`, always set by product responses.
- [ ] Both bindings in `apps/till/src/till-app.ts` consume that flag. `apps/server/src/{receipt-print,invoice-document}.ts` use the same decision for original/copy, paper, A4 and email; retain country wording/renderers.
- [ ] Audit `apps/server/src/{receipt-preview-api,sample-receipt,print-api,email-delivery,demo-printer}.ts`; sample previews and print/email routing retain their separate practice policies.
- [ ] Server TDD: `receipt-presentation.test.ts` owns the above classification cases with `useVenueDb`, including changed configuration and cash+real split. `till-api.receipt.test.ts`/`transaction-receipt-api.test.ts` prove replay/history wiring; `receipt-print.test.ts`/`invoice-document.test.ts` prove header output and unchanged invoice facts. All under `apps/server/src/`.
- [ ] Configuration TDD: `apps/server/src/me-api.test.ts` proves flag delivery; preserve `boot-card-provider.test.ts` selection controls. `apps/dashboard/src/screens/payments-screen.test.ts` covers Demo/default Prepare, provider-enabled Prepare, Live and unknown configuration.
- [ ] Till TDD: `apps/till/src/till-app-settlement-documents.test.ts` proves both bindings use saved flags, including split/history results under a different current provider/mode.

## 2. Interpret the SumUp snapshot once, at use time

| Provenance | Source words / evidence | Consequence |
| --- | --- | --- |
| Driver's 17 Nov [SumUp API reading](https://developer.sumup.com/api/readers/get-status/) | “Provides the last known status for a Reader.”; “Battery level percentage”, float 0–100; last_activity: “Timestamp of the last activity from the device” | Scale known; freshness not guaranteed. |
| Owner session, questions.md:630–639 | 1.67/activity 15:22Z persisted through 17:31Z; 17:41Z returned 100.0/activity 17:36:33Z | Suppress old snapshots; do not rescale. |

- [ ] **Watcher choice proposed:** SumUp battery is usable only at activity age `0 <= age <= 10 minutes`; missing/invalid/future timestamps suppress it. This admits the observed five-minute reading; ten minutes is Waitron policy, not a provider guarantee.
- [ ] Keep provider names out of shared code: add optional `batteryReportedAt?: string | null` to the existing reader-status contracts (`packages/payments/src/card-provider.ts`, SumUp dashboard client, dashboard API client). Absent preserves providers with no freshness contract; null means unknown and suppresses battery. SumUp sets it from `last_activity` or null. A browser-safe `packages/shared/src/reader-battery.ts`, exported by `src/index.ts`, owns `readerBatteryPercent(status, now): number | undefined` with the above age rule and finite whole 0–100 validation; it receives no provider id.
- [ ] In `packages/payments-sumup/src/sumup-client.ts`, reject nonnumeric/nonfinite/out-of-range battery before rounding rather than clamping. Preserve zero, 99.6→100, absent battery and timestamps through `card-provider.ts`; trace every status consumer before adding the freshness field.
- [ ] Use the helper in `apps/dashboard/src/screens/payments-screen.ts` and `apps/server/src/alert-sources.ts`, evaluating age at consumption even on cache hits. Preserve connectivity/pairing/unavailable alerts; reuse existing dashboard refreshes, without new timers or calls.
- [ ] TDD: new `packages/shared/src/reader-battery.test.ts` owns freshness boundaries, missing/invalid/future timestamps and percent validation, plus absent-versus-null timestamp behavior. `packages/payments-sumup/src/sumup-client.test.ts` owns HTTP conversion; preserve `card-provider.test.ts`'s rounding/zero/absent/pass-through assertions without treating its old timestamp as fresh.
- [ ] Consumer TDD: dashboard `payments-screen.test.ts` proves stale blank/fresh zero with connectivity retained; server `alert-sources.test.ts` proves cached expiry removes the alert without refetch and fresh low readings retain severity. Do not repeat the helper matrix.

## 3. Instructions, qualification and branch gate

- [ ] In `docs/research/2026-11-15-a949-sandbox-and-settlement-check.md`, add **Hardware → Devices → <device> → Edit → card reader → Save** before Pay, plus dated battery provenance; preserve history.
- [ ] Update existing sections/IDs in `apps/server/src/guide/{en,es}/{printers,table-service}.md` for truthful wording, reader selection and checking charge on the reader when percentage is absent. Update `docs/backlog.md` and `docs/backlog/payments.md` with remaining qualification in the eventual code change.
- [ ] **Hold:** no fresh provider GET/settings/reader interaction before **2026-11-18 00:00 UTC** (watcher 18:39). Afterwards driver qualifies read-only on the retained venue/reader: redacted battery, activity/read times, expected helper output, and authorised reader comparison. No checkout/payment/re-pairing. Unavailable evidence stays pending.
- [ ] Run the corresponding commands for red/green cycles; expect the named regression failure then passing Tests counts. Check browser headroom and run browser packages sequentially.

```sh
pnpm --filter @waitron/shared exec vitest run src/reader-battery.test.ts
pnpm --filter @waitron/payments-sumup exec vitest run src/sumup-client.test.ts src/card-provider.test.ts
pnpm --filter @waitron/server exec vitest run src/receipt-presentation.test.ts src/till-api.receipt.test.ts src/transaction-receipt-api.test.ts src/receipt-print.test.ts src/invoice-document.test.ts src/me-api.test.ts src/boot-card-provider.test.ts src/alert-sources.test.ts src/receipt-preview-api.test.ts src/guide-content.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.test.ts
pnpm --filter @waitron/till exec vitest run src/till-app-settlement-documents.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

- [ ] Inspect both themes/phone width; screenshots stay outside git. Rebase overlaps as needed, without waiting merely for overlap. Normal hook/current-head CI supply remaining checks; no extra whole-workspace run.
- [ ] **Expected added/removed lines:** production **+170/−40**, tests **+280/−25**, support/docs **+45/−15**, excluding this plan: about **575** changed lines. No migration; material growth beyond 1.5× returns to watcher.
- [ ] **Review focus:** split/replay/history facts, all document paths, unchanged practice side effects, cached expiry. Finish-branch needs **two independent Claude run-it reviews**, then one fresh read of fixes. Author stops at this file; driver owns all subsequent steps.
