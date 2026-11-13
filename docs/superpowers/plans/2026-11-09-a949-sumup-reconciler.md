# A949: recover SumUp payments and record refunds truthfully

_13 November: the [manager-release slice](2026-11-13-a949-partial-refund-release.md) supersedes this first slice’s unreleased-hold limit after SumUp confirms a full refund. Retained-money allocation remains unavailable._

**Outcome:** recover lost replies, fall back after an explicit partner-key refusal, and record refunds while protecting any retained charge. **Three-hour target; 896 estimated changed lines including deletions: code 385, tests 474, docs 37, generated 0; 34 files.** Build awaits approval below.

**Authority:** WATCHER 2026-11-09 18:46: “Uncertain refunds stay pending and are checked again”; “completed or partial refunds get a truthful local money state and a refund-specific incident reason, never status SUCCESSFUL.” 18:48: “OWNER said YES, it may be public”; “a sale is never blocked by it.” 18:49: “ONE named value in ONE file.” OAuth remains a preference. Both Claude reads are complete; no third read.

**Key:** create `packages/payments-sumup/src/affiliate.ts`, exporting `WAITRON_SUMUP_AFFILIATE` with app ID `io.waitron.pos` and key. Copy no key during planning or into fixtures/docs. Boxes receive changes with their next update. No image/publish/secret/runtime channel or override. Remove affiliate fields/help/drafts from form/client/strings/purpose; seal/read only merchant-owned API key and merchant code. Keep merchant selection. No stored-value migration. Configuration preflight belongs only in collect before `insertAttempting`; no build/options/client refusal or duplicate checkout guard.

**Fallback provenance — official pages saved 2026-11-09 in private `affiliate-fallback-provenance.json`:**

| Source’s words | Meaning |
| --- | --- |
| [Checkout API](https://developer.sumup.com/api/readers/create-checkout/): “Optionally include an `affiliate` object”; [Cloud guide](https://developer.sumup.com/terminal-payments/cloud-api/): “requires this key in checkout requests” | Wire schema permits omission; integration guide requires partner setup. |

**Inference, not live qualification:** only HTTP400 plus `errors.type=INVALID_AFFILIATE_KEY` or problem `type=https://developer.sumup.com/problem/invalid-affiliate-key` returns `affiliateRejected:true`; collect raises `payment.affiliate_rejected` through the existing sink and retries once with `omitAffiliate`. Never retry timeout, 5xx, general4xx, malformed refusal or fallback. Accepted fallback supplies `client_transaction_id` for polling; lost reply lacks our foreign reference: existing 15-minute failure/incident policy, no third request. Live acceptance is unproven; no checkout is authorized.

**Refunds:** §11’s SUCCESSFUL-plus-REFUNDED observation drives shared poll/sweep classification. Read both event arrays; deduplicate ids. Pending/unknown/malformed/conflicting evidence or excessive totals retain attempting/rechecking; failed refunds alone leave capture. Atomically run `captureAttempting` then `recordRefund`, preserving completed-event `providerRefundRef` identities. Gross €1 less €0.40 remains net €0.60, partially_refunded; €1 returned becomes refunded. Recheck state for replay/concurrency. Keep `lookupRefund` mapping; use refund-specific incident status and remove unconditional “marked … failed” copy. No ledger/refund sends.

**Directly caused correction, approval required:** add unfiled partially_refunded to `ordersWithUnfiledPayment` (`till-sale.ts:1598`): retain marks and open/placed protection. Replace partial’s false decline with `sale.charged_not_recorded`, reason `partial_refund`; existing copy says not to charge again. `bill-payments-loop.ts:73,125` excludes refund states: retain the hold/incident, without net allocation, settlement or queued issuance. `packages/payments/src/store.ts:234–272` represents gross/refunds; automatic allocation remains unsupported.

**File estimates:** roots below; each figure counts additions plus deletions.

| Kind/root | Files: lines |
| --- | --- |
| Code, `packages/payments-sumup/src/` | `affiliate.ts`:6; `card-provider.ts`:53; `provider.ts`:135; `client.ts`:15; `sumup-client.ts`:50; `errors.ts`:5; `dashboard/sumup-connect-form.ts`:75; `dashboard/client.ts`:2; `dashboard/strings.ts`:12 |
| Code | `packages/credentials/src/purposes.ts`:7; `apps/server/src/till-sale.ts`:13; `apps/server/src/errors.ts`:2; `apps/dashboard/src/i18n/alert-messages.ts`:10 |
| Tests, `packages/payments-sumup/src/` | `card-provider.test.ts`:62; `provider.test.ts`:50; `resolve-pending.test.ts`:110; `sumup-client.test.ts`:60; `backup-verification.test.ts`:22; `dashboard/sumup-connect-form.test.ts`:60; `dashboard/sumup-connect-form.unsaved.test.ts`:2; `dashboard/sumup-connect-form.a11y.test.ts`:5; `collect.sandbox.test.ts`:8 (never run) |
| Tests | `packages/credentials/src/purposes.test.ts`:28; `packages/credentials/src/store.test.ts`:2; `packages/payments/src/backup-verification.test.ts`:4; `apps/server/src/adopt.test.ts`:2; `apps/server/src/start-again-ring-copy.test.ts`:2; `apps/server/src/alerts-api.test.ts`:2; `apps/server/src/till-sale-integrated.db.test.ts`:45; `apps/dashboard/src/i18n/alerts.test.ts`:10 |
| Docs | `docs/research/2026-09-10-sumup-solo-experiments.md`:15; `docs/backlog/payments.md`:14; `apps/server/src/guide/en/table-service.md`:4; `apps/server/src/guide/es/table-service.md`:4 |

**Checks:** focused failing→passing cases: both recognized fallback forms and nonretry controls; one parameterized `useVenueDb` mocked-HTTP replay regression asserting gross/requested/net, state, event ids/counts, refund incident and no extra checkout/refund; full/partial, pending→failed, mixed/malformed evidence. Server cases prove open/placed partial holds, cleanup retention, truthful refusal and no issuance. Changed assertions: removed affiliate controls/purpose members only; evidence-free REFUNDED now retries, retaining incident/rollback checks. Preserve API-key/merchant drafts, backup, permission, money and fiscal assertions. Run selected cases/files only, never full packages or live sandbox; root alert guard and EN/ES/theme/phone checks. Guides update existing `#bill-switcher` payment/recovery instructions, no invented SumUp section.

Backlog names the constant; runbook gets a dated pointer and provenance. Report audit, orphan recovery, durable reversal and all three backup-machine cases stay open, without approved deferral. No completed-payout prerequisite; SCHEDULED is not settlement. No schema, fiscal chain/hash, invoice allocation, alta/registerSif/restoreFiscal/golden changes.

**Watcher question:** approve the evidence-limited fallback and the 60-line consumer correction (15 code, 45 tests), within this 896-line slice? No build before that answer.

**Implementation authority, 9 November 19:04:** the watcher approved plan `6c496e3f77`,
including the evidence-limited fallback and partial-charge hold, with one whole-branch
Claude run-it review and one push. This resolves the question above; no third plan read.

**Review disposition, 9 November 20:08:** the watcher approved the shared incident slot with
candid MORE wording, the explicitly unreleased partial-refund hold as a first-slice limit,
and the same partial/full refund correction in `bill-payments.ts` and `bill-payments-loop.ts`
with focused cases. The manager release stays within remaining A949 work. Remove the stale
fake comment. Stop for another scope opinion past about 1,500 changed lines.
