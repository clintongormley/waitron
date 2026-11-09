# A949: recover SumUp payments by Waitron's reference

**First usable slice:** an image update supplies Waitron's reference on reader checkouts without reconnecting venues; existing recovery can find a lost creation reply. Report audit, durable orphan refunds and backup-machine support remain unfinished. Build budget: three hours.

**Authority:** Lane F watcher, 9 November 15:22: “Decision: every SumUp reader checkout carries Waitron’s affiliate block (app_id + key) with our own reference in affiliate.foreign_transaction_id.” At 17:52: “Next: write these into the A949 write-up and runbook, then plan the reconciler against them (plan first, as usual).” Planning is approved; this build is not.

**Evidence:** [session §11](../../research/2026-09-10-sumup-solo-experiments.md#11-a949-cross-account-session-2026-11-09) qualifies the cross-account key, 404/PENDING/paid reference reads and REFUNDED events with original SUCCESSFUL. Both saved refunded payments currently classify as captured: two diagnostic failures reproduced the review finding.

## Proposed build

Deliver `SUMUP_WAITRON_AFFILIATE_KEY` through the existing app-image ARG/ENV and publish-secret checks; fix app ID `io.waitron.pos` in the server adapter. Read it in `sumupClientForTenant`, overriding stored affiliate values but retaining the venue's authorization credential. Remove affiliate fields/help from the dashboard form; connect ignores supplied affiliate values and seals `-`. Preserve the four-field vault, `optionsFromSealed` and backup/read/unpair acceptance. Image restart replaces cached clients; no reconnect, OAuth, new secret store or schema.

Missing/blank/whitespace/`-` key fails publication. Contribution `build` also refuses it with existing `payment.provider_credential_rejected` before collection; no attempting row or false card decline. `createCheckout` rejects missing/incomplete/foreign affiliate configuration before HTTP. Source builds need the build argument for real SumUp; demo cash/simulators remain available.

**Watcher choice:** the key is image-readable and rotates through image updates; the package gains a server-side environment read. SumUp says “Affiliate keys are not an authorization mechanism.” ([source](https://developer.sumup.com/tools/authorization/affiliate-keys/), read 9 November.) The owner must arrange the repository secret; this proposal copies none.

For unresolved successful payments, completed or uncertain REFUND events use the existing deferred/incident path rather than a new gross capture. FAILED refund events alone do not prove returned money. Keep `lookupRefund`'s correct REFUNDED/amount/id checks; no refund is sent. Test the local state and incident, not only classification.

**Changed-line estimate:** 200 code, 200 tests, 40 docs; 440 total, counting deletions. No generated/dependency changes.

**Files:**

- Runtime: `packages/payments-sumup/src/{card-provider,sumup-client,provider}.ts`, `src/dashboard/{sumup-connect-form,client,strings}.ts`; retired-field comments in `packages/credentials/src/purposes.ts`.
- Delivery: `deploy/Dockerfile`, `.github/workflows/ci.yml`.
- Tests: SumUp `src/{card-provider,sumup-client,sumup-client.redirects,resolve-pending}.test.ts`, `src/dashboard/sumup-connect-form{,.unsaved,.a11y}.test.ts`; server `src/payments-api.test.ts`; root `scripts/{deploy-image-env.test.ts,ci-workflow.test.mjs}`. SumUp `src/collect.sandbox.test.ts`: prerequisites only, never run live.
- Docs: `deploy/README.md`, `docs/developers/ci-and-gates.md`, `docs/backlog{.md,/payments.md}`, `apps/server/src/guide/{en,es}/table-service.md` (one connection instruction each).

**Verification:** fail missing-key/no-HTTP and refunded-capture cases before implementation. One joined real-client/database test loses the create reply, rebuilds the provider and recovers by the same reference: one checkout, one capture with SumUp's refundable id. Check outgoing block/query URL; reuse existing pending/failed/grace/backup/ownership cases. Prove critical guards by removal in a disposable candidate. Focused files, normal hook, one Claude branch review and current-head selected CI; EN/ES, both themes, phone/desktop. No whole-package local run or provider request.

**Changed assertions for approval:** replace optional affiliate-field checks with API-key-only form/fixed image block checks; extend checkout/redirect fixtures without weakening refusal/timeout assertions. Root guards gain delivery/publish-refusal cases; preserve existing checks. Retire only deliberately removed fields/help. Preserve merchant selection, backup acceptance, money, permissions and fiscal assertions.

**Finish and limit:** updated venues recover a lost reply without another charge; already-refunded unresolved payments raise the existing incident. Existing missing-reference policy still fails/alerts after 15 minutes without rechecking; that is no vendor visibility guarantee. Completed payout evidence does not gate this slice.

## Remaining A949 scope

Retain [the complete backlog contract](../../backlog/payments.md#the-sumup-reconciler), including all three backup-machine cases. Later plans qualify history/detail matching, completed payout (SCHEDULED/PENDING is insufficient), mounted audit and visible ambiguity. Before automatic refunds, trace callers and first reuse `bill-refunds.ts`'s committed-before-send recovery pattern; no new ledger is assumed. Second-Solo, signature/decline, fees and connection probes remain unqualified. No paid probes or protected fiscal changes. A760/A1308's table hold is lifted.

**Gate:** one permitted Claude reread, then watcher approval of image distribution, refund-recovery repair and named assertion changes. The first read's “Should this exist?” simplification finding stays with the watcher; no product build or landing before its answer. Later scope is not an approved deferral.
