# A949: recover SumUp payments by Waitron’s reference

**First outcome:** provision Waitron’s partner block on every reader checkout, enabling existing lost-reply recovery. Completed payout evidence is not a prerequisite. Report audit, durable orphan self-heal and backup-machine support remain A949 scope.

**Authority, relayed from Lane F `questions.md`:** watcher2026-11-09 15:22: 'Decision: every SumUp reader checkout carries Waitron’s affiliate block (app_id + key) with our own reference in affiliate.foreign_transaction_id.'
Watcher17:52: 'Next: write these into the A949 write-up and runbook, then plan the reconciler against them (plan first, as usual).'
This closes A1251 and assigns A949 next. Watcher15:52 withheld the audit-only proposal, including its deferrals. No build is approved.

**Evidence:** [runbook §11](../../research/2026-09-10-sumup-solo-experiments.md#11-a949-cross-account-session-2026-11-09) records Waitron account A (`io.waitron.pos`) working with restaurant B (`MY2NPHDW`) and B’s authorization credential. Reference reads gave 404, then PENDING before tap, then SUCCESSFUL with matching identity, EUR and amount.
No visibility deadline is established.
Repeating a reference created another checkout (§10.1): never blindly resend. Unpaid cancellation gave transaction FAILED; only the checkout explained CANCELLED.
Refund `amount:100` returned 201, with REFUNDED in both event arrays while the original stayed SUCCESSFUL. The script omission was repaired with 11 tests; product `refundOutcomeOf` already accepts REFUNDED.

## Slice 1: provision Waitron’s block, independently useful, ≤3 hours

Excludes report audit, automated refunds, schema/dependency changes and OAuth.
**Proposed watcher choice:** installers supply one shared Waitron partner key through each venue’s existing dashboard connect form, alongside its own API credential.
Fix app ID `io.waitron.pos`; remove merchant-created affiliate identities. OAuth is preferred, not approved additional scope.
`apps/server/src/payments-api.ts:740` seals four fields and evicts the provider. `deploy/Dockerfile:204` ships no credentials CLI. Use that dashboard route, without new deployment configuration.
Consumer trace: `card-provider.ts` routes live/deferred clients, reader operations and backup verification through `optionsFromSealed`; validation/rotation requires four fields.
Preserve the vault shape and `-` absence for reads/backups. Change connect/checkout eligibility only.
Set the app ID server-side; reject conflicting supplied IDs and blank/`-` keys on connect.
Before checkout HTTP, return the existing definite-refusal outcome for absent/incomplete/foreign affiliate configuration. Checkout POSTs carry the fixed ID, provisioned key and saved `paymentRef`; older credentials retain reads/unpair.

**Exact files; changed-line budget: 173 code +335 tests +45 docs =553 total.**

- Code: `packages/payments-sumup/src/card-provider.ts` 30; `packages/payments-sumup/src/sumup-client.ts` 20; `packages/payments-sumup/src/client.ts` 10, including a browser-safe app-ID constant.
- Code: `packages/payments-sumup/src/dashboard/sumup-connect-form.ts` 80; `packages/payments-sumup/src/dashboard/client.ts` 8; `packages/payments-sumup/src/dashboard/strings.ts` 20; `packages/credentials/src/purposes.ts` 5, comments only. Remove editable app ID; require the Waitron key with English/Spanish errors.
- Tests: `packages/payments-sumup/src/card-provider.test.ts` 75; `packages/payments-sumup/src/sumup-client.test.ts` 55; `packages/payments-sumup/src/sumup-client.redirects.test.ts` 5; `packages/payments-sumup/src/backup-verification.test.ts` 10; `packages/payments-sumup/src/resolve-pending.test.ts` 70.
- Tests: `packages/payments-sumup/src/dashboard/sumup-connect-form.test.ts` 60; `packages/payments-sumup/src/dashboard/sumup-connect-form.unsaved.test.ts` 35; `packages/payments-sumup/src/dashboard/sumup-connect-form.a11y.test.ts` 10; `apps/server/src/payments-api.test.ts` 10; `packages/payments-sumup/src/collect.sandbox.test.ts` 5, prerequisites only, never run live.
- Docs: `deploy/README.md` 10; `apps/server/src/guide/en/table-service.md` 8; `apps/server/src/guide/es/table-service.md` 8; `docs/backlog.md` 3; `docs/backlog/payments.md` 8; `docs/research/2026-09-10-sumup-solo-experiments.md` 8, dated pointer.

**Changed checks for approval:** `card-provider.test.ts:79–120` changes optional/operator app IDs and dash-on-connect to a fixed server app ID plus required key; dashboard `sumup-connect-form.test.ts:183–198` changes optional editable app ID to required key. Preserve the remaining backup/read/draft/merchant/refusal assertions; extend fixtures with the provisioned block.
**RED/GREEN:** run the named Node/browser/server files; see missing/foreign affiliate refusal assertions fail, implement, rerun. Assert sealed/outgoing fields, no secret response, unchanged backup/reader reads. Retain draft/picker/refusal/redirect assertions; inspect both themes at phone width.
Join the real client to the existing real-database recovery test: lose the create reply, rebuild the provider over the same database, replay404/PENDING/SUCCESSFUL, and assert one checkout POST, the saved reference and one EUR1.00 capture with SumUp’s refundable id. FAILED resolves failed without claiming cancellation cause. Replay of the two real refunds already passes with wrong-amount/excluded-id controls; retain its receipt, no duplicate test-only slice.
**Finish:** a provisioned venue recovers the lost creation reply by its saved reference without a second charge; missing configuration sends no charge.
Reconnect existing installations. Manual provisioning cannot authenticate a pasted key’s issuer; watcher must accept that boundary or choose another distribution plan.

## Remaining A949 scope: later qualified plans, not approved deferrals

**Report audit:** saved history lacks foreign references; details contain them (§10.7). Qualify matching/paging. SUCCESSFUL is payment; settlement is later clearing. EUR 0.98 SCHEDULED/PENDING cannot populate `reconcile.ts:SettlementRecord`.
Separately authorize a completed-payout sample before choosing settlement mapping. Never substitute captures/net payouts; this does not hold slice1.
**Durable reversal before automated refunds (W44):** `packages/payments/src/reverse.ts:37` sends before recording; `packages/payments/src/schema/payment-refunds.ts` has terminal states only. Trace `apps/server/src/bill-refunds.ts` before choosing persistence.
Record before send; recover uncertain outcomes by event identity without blind SumUp resends. Preserve held-payment, amount-difference, clock and concurrent-claim protections. No new ledger/schema is approved here.
Then plan mounted report audit/orphan self-heal, including missing-local/ambiguous findings and scheduler/health consumers, as usable ≤3-hour builds with exact files. The withheld audit-only cut is no substitute.
**Backup machine:** retain automatic amount/time matching for a second Solo on the same account, with unmatched items listed for a manager; other-provider payments identified as paid outside Waitron with operation number/machine through till, day report and accountant exports; and cash-only service without a backup machine. Qualify the second Solo and trace consumers before sizing builds; phone-app POS samples do not qualify it. Ambiguity stays visible.
Declines, signatures, completed payout/fees and remaining connection/termination probes remain unqualified; callback was not requalified. No unattended paid requests. A760/A1308’s table hold is lifted; any justified schema work rebuilds the current baseline. Protected fiscal invariants must not change.

**Approval:** one Claude `review-branch` read, then watcher approval of slice1, key distribution and named assertion changes. Later scope needs qualified plans. No product build or provider request is authorized here. A949 remains open.
