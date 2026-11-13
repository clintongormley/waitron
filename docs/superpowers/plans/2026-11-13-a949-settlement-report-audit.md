# A949: SumUp gross-charge report audit

**PROPOSED: awaiting Claude read and watcher clearance. No owner design approval claimed.** One build slice, at most three working hours. Full-refund manager release landed in #3081; every other A949 remainder stays open.

**Request**, recorded in `~/waitron-campaign-f/queue.md`: “Next: write the smallest settlement-report audit slice as a one-page plan, get the Claude read, then watcher clearance. No implementation branch remains. Retained-money allocation needs a separate decision.”

**Smallest usable result.** You can see disagreements between Waitron’s captured payments and SumUp’s original gross EUR charges in existing alerts and persisted `scheduled_runs.summary`. This audits charge existence, identity and gross amount, including unmatched report charges. An unmatched charge may have been taken outside Waitron; never infer an order or missing sale. It establishes neither retained money after refunds nor bank settlement. Only identified completed refunds establish returned money; `SUCCESSFUL` alone cannot establish retained net ([November research](../../research/2026-09-10-sumup-solo-experiments.md#11-a949-cross-account-session-2026-11-09), §§10.7/11.2). Orphan self-heal, W44 durable reversals, backup-machine amount/time matching, signature qualification, retained-net allocation and positive payout/fee qualification remain open. No new table or record type, controller, UI surface, scheduler, timer or health mechanism.

**Evidence and narrow inference.** Public excerpts read by the driver on 13 November are retained in `receipts/a949-settlement-audit-20261113/public-docs.json` outside the repository; these are documentation evidence, not live qualification.

| Source | Short exact quote | Design inference |
| --- | --- | --- |
| [History](https://developer.sumup.com/api/transactions/list/index.md) | “pagination query strings”; “at or after”; “before” | Follow returned links on the same merchant history endpoint; creation bounds implement `[from,to)`. |
| [Detail](https://developer.sumup.com/api/transactions/get/index.md) | “Total amount of the transaction in major units”; “when the transaction was created” | Compare original gross amounts; provider creation time is not bank arrival. |

**Reuse and constraints.** Keep `classify`, `listReconcilable`, whole-table `existingReferences`, incident writers, `reconcilerAsDuty` and `runDue`. `reconcile.ts:308–378` currently claims orphans and writes holds before reversing: a throwing dummy reversal is unsafe. Stripe’s `report-client.ts:1–7` already specifies gross/created semantics. Preserve its default remediation and assertions. Keep network reads outside transactions and existing write functions; read the write-path rules in `docs/developers/conventions-data.md:985` before building.

**Build test-first.** Read the TDD skill before code. Observe each behavioral assertion fail, implement minimally, then pass. Paths below are relative to the named `src/` root; braces enumerate exact files.

1. **Payments owns audit behavior.** Modify `packages/payments/src/{reconcile.ts,errors.ts,card-provider.ts}`; test `reconcile.test.ts`. Add explicit `mode: "audit-only"` requiring no reversal function, preserving the omitted-mode Stripe path. Audit raises findings but never stamps remediation, writes holds, changes payment/refund/sale facts or invokes reversal; report orphan reason `auditOnly`. Assert exact orphan/drift findings, unchanged rows/holds, zero reversals and zero remediated after a completed sweep, including a drifting abandoned capture. Preserve Stripe remediation tests. In audit mode, alert on unhinted unmatched charges too, using nullable `paymentRef`, without invented order hints. Extend `SettlementReportSource.fetch(window:ReconcilePeriod,localReferences?:readonly string[]):Promise<SettlementRecord[]>`; supply captured external references for supplemental reads. Trace Stripe source, fake source/reconciler, exports and duty summary consumers; preserve their behavior.
2. **SumUp owns reporting.** Create `packages/payments-sumup/src/{report-client.ts,report-source.ts,reconciler.ts}`; modify `{card-provider.ts,index.ts}`; create tests `{report-client.test.ts,report-source.test.ts,reconciler.test.ts}`. Transport owns pagination, duplicate-page termination, body deadline, HTTP refusal and malformed/incomplete-response failure once; never return a truncated success. Source includes original PAYMENT charges with SUCCESSFUL/REFUNDED status, excludes REFUND rows and pending/failed/cancelled attempts, deduplicates transaction IDs, uses `id`/`transaction_id` rather than transaction codes, and validates EUR, positive exact amount and timestamp. Detail-read captured IDs missing from history, verifying identity; recovery dates capture at local check time (`provider.ts:327`). Assert that cross-day recovery still matches and a refunded original remains gross, never retained-net evidence. Resolve sealed credentials once per sweep, picking up rotation; inject existing incident/held-alert sinks.
3. **Server owns wiring only.** Add optional `createReconciler(deps:CardProviderBuildDeps & {heldAlerts:HeldAlertSink}):PaymentReconciler` to the card-provider contribution; implement for SumUp. Retain Stripe construction; collect contributed reconcilers through `CARD_PROVIDERS`, without another provider-name branch. Modify `apps/server/src/{boot.ts,reconcile-duty.ts}`; test `reconcile-duty.test.ts` and new `boot.payment-audit.test.ts`. Select credential-provisioned duties independently each pass, allowing SumUp without Stripe. Preserve payments-module, primary/mirror, abort and stepdown gates. Keep aggregate health label/budget and persisted Stripe duty key. Assert SumUp findings persist and raise alerts with no refund/filing request; prove disabled/mirror/stepped-down execution queues no audit. Run deletion controls for forbidden writes in a disposable checkout.

**Finish.** Modify `apps/dashboard/src/i18n/alert-messages.ts`, test `alerts.test.ts`: EN/ES wording says provider-report/gross discrepancy, never paid out or promised automatic refund. Update `apps/server/README.md` and `docs/backlog/payments.md`, preserving all remainder. Focused commands:

```sh
pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts
pnpm --filter @waitron/payments-sumup exec vitest run --project node src/{report-client,report-source,reconciler}.test.ts
pnpm --filter @waitron/payments-stripe exec vitest run src/reconciler.test.ts
pnpm --filter @waitron/server exec vitest run src/{reconcile-duty,boot.payment-audit,pass.signal,health,handover-stepdown.real}.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts
```

Require actual test counts, normal hook and current-head CI. No whole-suite local or live/authenticated provider calls.

**Estimate:** production +410/−35, tests +440/−10, test support +0/−0, prose +30/−10: **935 changed lines**, generated 0. Driver obtains the Claude read, addresses findings, then requests watcher clearance before any implementation.
