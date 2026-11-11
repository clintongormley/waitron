# A1342: return originals before resetting the old box

**Proposal: one completed Claude read; watcher 2026-11-10 00:11 requests these page corrections without another read. Size, transaction batching and clash acceptance await the owner; no build.** Source inspected at `6d84f3bc4f83`; reading is not runtime proof. Replace the FK-drop proposal with one usable recovery PR. The stopped box sends missing originals over the existing signed connection; the current main preserves their identities/chains, files them and supports internal record correction. Only signed complete-original-inventory confirmation makes the old page say safe to reset. The owner lands this fiscal PR.

**Authority.** Lane J `questions.md`, WATCHER 2026-11-09 **20:11**, records the owner’s choice: “Owner: copy under the report's rules A–G” and “Inserts only, one transaction, no foreign key dropped. This replaces the 18:59 "records only" and the "no placeholder sales" line.” The note explicitly names all eight tables and the absent-device exception below. At 19:31 the owner approved the separate recovery allowance and internal correction interface; Lane L W41s-9 supplies its screen. The 19:39 storage hold is superseded. Sending/correcting from the new main is settled by OWNER18:59; no legal research remains.

**Transfer.** Add optional return operations to the existing module handover contribution; keep fiscal table knowledge inside fiscal-verifactu. Reuse `signAsThisBox`, `peerKeyOf`, `postToBox` and the already-declared `return-batch`/`return-receipt` envelopes. Bind venue, environment, source, current main and original inventory inside signatures, without requiring a handover operation. A restartable sender runs only on the stopped box. Add its handle to `restricted-start.ts` and `background-duties.ts`, register its stop in the restricted start’s `makeStartedServer.stopWork` and failure cleanup before the next throwing step, and await its shutdown before closing the stores. This is an explicit exception to restricted start running no background duties: only the return sender starts, never filing/selling duties. Sending does not wait on the sale path.

Preflight record position/invoice identity and sale unique clashes before inserting sales: no orphan sale for a skipped original. Within the proposed receiver transaction, await one sequence:

1. **D/G, then F:** require existing source node, SIF and invoice-series metadata; refuse missing metadata. Insert only truly absent devices, using receiver-held location/profile, empty token, inactive and deleted; never update an existing device. Merge sales and payment facts by their recorded time and correction dependencies: insert an original sale, its tenders and settlement before any later corrective sale referring to it. Always clear `working_order_id`, retaining other original facts/ids. For each sale’s payment facts use one savepoint for tenders then settlement; skip already-held facts before triggers and retain `bill_payment_id` only if held locally. On a named payment conflict, roll back both payment facts and flag the original’s filing case; propagate unrelated database failures. Never insert all sales before their settlements: the coverage trigger counts later corrective sales (`core.sql:141–150`).
2. **A/B/C:** insert `registros_facturacion` unchanged in chain order; skip same ids. A different-id position/invoice clash skips the original and its dependent suffix. Insert `envios` only for newly inserted originals, carrying known outcomes, CSV and confirmation time; never overwrite receiver verdicts. Advance only the old node’s `cadenas` head, forward and atomically, across verified contiguous originals.
3. **E:** insert missing `sale_voids` and `sale_substitutions`; conflicting receiver facts win.
4. Open the needed filing cases for the preflight, payment and correction clashes against the receiver-held original; recreate refusal cases from imported outcomes through existing helpers. No case points to a skipped, absent original.

Recompute confirmation from committed original ids and immutable fingerprints, including payload, offset, predecessor and hash. Counts, heads and mutable delivery state are insufficient. Lost answers/restarts resend safely; any missing/conflicting original prevents complete confirmation. Reuse `checkFiscalChains` for validation and normal `drain` for filing, waking it after commit. Never copy mutable orders/payment queues, incidents or acknowledgements as tables. Add no generic ledger, persistent receipt or invented handover history; drop no FK and rebuild no schema/baseline. Reset stays manual.

**Selection and confirmation.** Enumerate all source-node originals, referenced sales/correction parents and associated auxiliary facts, including payments for records already held. A later payment creates no fiscal record. Propose at most 100 originals/facts and 256 KiB per batch; cut in the same recorded-time/dependency order as above, keeping one sale’s tenders and settlement together. Refuse a single indivisible sale/payment unit over the bounds. These bounds and one transaction per batch require the owner’s answer: they differ from the 20:11 “one transaction” instruction. Until the last batch commits, reporting can count an imported sale before a later batch brings its void/substitution; final confirmation is withheld. No persistent batch protocol state. Sign the full immutable inventory digest and reply with digest/status, fitting postToBox's 1 MiB answer cap (boot-peer-check.ts:274,367). Confirm only committed originals plus auxiliary facts; unresolved clashes keep the page at needs attention. Re-enumerate after restart; no receipt table.

**Policy proposed for approval.** Preserve the source-traced pinned-key/endorsement trust path; never trust copied nodes keys. Host supplies the locally pinned former main as correction history only while its trusted chart names this receiver serving primary and has not evicted that source. Keep self first; existing record-remedy.ts:194 passes supplied history to appendToChain, so protected code stays unchanged. Enable correction only for that former-main target, keeping own/other records disabled. Use a typed transfer-clash filing-case cause and existing evidence message for skipped id/hash, no migration; missing metadata or clashes get needs-attention wording. Watcher 2026-11-10 00:20 approved this narrow correction policy; size, batches and clash acceptance still await the owner before build. No protected chain/hash/allocation/alta/registerSif/restoreFiscal edit.

**Exact edit inventory** (policy awaits approval):

- New: `apps/server/src/return-records.ts`, `apps/server/src/return-records-api.ts`, `packages/fiscal-verifactu/src/handover-return.ts`.
- Existing: `apps/server/src/errors.ts`, `apps/dashboard/src/i18n/alert-messages.ts`, `packages/module/src/module.ts`, `packages/fiscal-verifactu/src/errors.ts`, `packages/fiscal-verifactu/src/schema/filing-cases.ts`; `apps/server/src/boot.ts`, `apps/server/src/restricted-start.ts`, `apps/server/src/background-duties.ts`, `apps/server/src/restricted-page.ts`, `apps/server/src/i18n/restricted-page.ts`, `packages/module/src/handover.ts`, `packages/fiscal-verifactu/src/handover-summary.ts`, `packages/fiscal-verifactu/src/record-remedy-http.ts`, `packages/fiscal-verifactu/src/record-remedy-routes.ts`.
- Tests/support: new `packages/fiscal-verifactu/src/handover-return.test.ts`, `apps/server/src/return-records.test.ts`, `apps/server/src/return-records-api.test.ts`, `apps/server/src/return-records.real.test.ts`, `apps/server/src/testing/return-records.ts`; existing `packages/fiscal-verifactu/src/record-remedy-http.test.ts`, `packages/fiscal-verifactu/src/record-remedy-routes.test.ts`, `apps/server/src/restricted-page.test.ts`.
- Docs: `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md`, `docs/backlog.md`, `docs/backlog/replication-cloud.md`, this plan; replace the superseded records-only backlog wording. Add dated pointers beside the old “Do not replay orders, payments, cash” claims in `docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md` §5 and `docs/superpowers/plans/2026-11-02-a1018-handover-build.md` → “Dropped from the draft”, recording that the owner’s 2026-11-09 20:11 choice supersedes those claims only for these eight returned table facts; preserve the historical wording and the prohibition on replaying live business side effects.

**Proof and finish.** Red first, then minimal implementation, then green: fiscal database tests own A–G, atomic rollback, hashes/CSV, conflicts before sale insert, late/already-held payments, correction after settlement, VAT inclusion, unchanged node day-close and settlement visibility; sender tests own selection/bounds, trust, refusal and lost confirmation; routes test binding, admission and answers. The two-box integration owns real signed return, outbox filing, internal correction and complete confirmation; inspect the page in EN/ES, both themes and phone/desktop widths. Use `useVenueDb` and existing seed/placed-copy support. Run each changed file with `pnpm --filter <package> exec vitest run <path>`; run boot.restricted-quiet.test.ts unchanged and applicable error/alert guards; retain every assertion, including unedited `src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` in fiscal-verifactu. Prove critical guards by deletion controls. Normal hook and current-head CI follow. Finish means the full flow works against two simulated boxes; real-box qualification remains pending. Returned-invoices reporting marker remains future work; Box 2 re-billing produces two real invoices until corrected. Sale lines are not copied: reprints and line-level reports remain incomplete. Correction is API-only until Lane L supplies its screen.

**Owner question 3: smallest clash-acceptance sketch, not approved.** Offer one internal authenticated action on the new main, consistent with the owner’s 19:31 API-only boundary: `POST /management-api/fiscal-records/return-clashes/:caseId/accept`, carrying the case id, source-original fingerprint, action key and nonempty reason. Require existing `FISCAL_REMEDY` permission (`record-remedy.ts:27–38`), bind it to the trusted former-main source and exact clash evidence, and record the signed-in person through existing `recordCaseEvent(kind: "resolved", action: ...)`, retaining the accepted evidence fingerprint and reason in that event’s action value; do not rewrite either original or issue a correction as a side effect. Reuse existing event storage/idempotency, with no new table or general remedy enablement (`filing-cases.ts:109–175`). Confirmation may count only that specifically accepted clash as accounted for; an unexplained missing original or unresolved dependent suffix still blocks reset. This changes the owner’s “holds every record” condition and needs explicit approval; acceptance is not proof the missing original was imported. The action is internal API-only, not a new staff screen; a visible action waits for Lane L’s case screen unless the owner asks for a separate UI cut. Proposed additional files: existing `packages/fiscal-verifactu/src/filing-cases.ts`/`.test.ts`; route/admission coverage stays in the already-listed remedy route files. Domain cases own exact-evidence matching, replay and refusal to count unrelated unresolved originals; routes own permission and request validation. Incremental estimate production +80/−0, tests +100/−0, docs +15/−0, generated zero, **195 lines**, subject to qualification. Sender-shutdown wiring and the four page corrections add an estimated production +20/−0, tests +20/−0, docs +15/−0, **55 lines**. If the owner accepts the sketch, total becomes **1,820**: production +750/−30; support +100/−0; tests +770/−0; docs +130/−40. Do not build the sketch or claim a usable clash-resolution screen before that decision.

**Estimate, added/removed:** production +650/−30; test support +100/−0; tests +650/−0; docs +100/−40; generated zero: **1,570 changed lines**. This pre-correction estimate excludes the 55-line wiring/docs increment and optional 195-line sketch above; the revised full proposal is 1,820. Both exceed the approximately 1,250 outside-opinion threshold: await the owner’s allowance and batch/clash decisions or usable cut before build. Keep all eight owner-approved tables; dropping payments reverses the 20:11 choice. Open the usable PR within three active hours, excluding owner waits; otherwise stop with an over-budget report. No scaffolding-only finish.

**Clearance recorded 2026-11-10.** The proposal and its pending wording above are retained as the reviewed historical text at `7ba43105ecc26d8899b982d3820f7e2638860ceb`. Lane J’s watcher note headed 2026-11-10 15:40 records the owner’s words, “Approve all three (Recommended)”, from `desk/done/20261110-0946-J-a1342-record-return.md`: one pull request, batches of at most 100, and the action that lets a person accept a clash. The watcher clears the 1,820-line full proposal, with an outside opinion before exceeding 2,730 lines, and keeps the already-cleared narrow correction policy. This records those three owner decisions and the watcher’s build clearance; it does not claim the owner separately approved every design detail. The owner lands the fiscal PR. The watcher’s later note headed 17:24 orders the current A1241 batch landed before this build; this checkout was prepared while A1241 CI ran, without implementation or tests.


## PR1 cut cleared 2026-11-10 at 19:45

The owner said “Split it into two PRs” (the watcher’s Lane J note at 19:30). Codex proposed the
cut; Claude’s first read rejected the existing-case recovery promise. Two disposable probes
reproduced both directions of the single-case coupling: a settled ordinary case cannot become a
return-clash case, and an accepted return-clash case blocks correction after later AEAT rejection.
The watcher cleared the smaller first cut at 19:45; Claude’s permitted correction read took
229 seconds and judged it buildable with distinct clash wording and no repeated clash transfers.

PR1 returns ordinary originals and late facts in signed bounded batches, keeps normal outbox
filing and the API-only former-main correction, and confirms reset only after a complete signed
receipt. A signed unaccounted batch stops the sender until restart and creates or resolves no
transfer filing case. Generic return failures retain retry behavior. A clash can leave later
originals unfiled; keep both boxes and their data. No clash recovery is claimed. The receiver
compares row shapes; it does not negotiate versions or migrate returned data.

Remove the transfer-case cause, evidence fingerprint and acceptance route from this first cut.
Retain original-byte, payment rollback, dependency and orphan-sale assertions. The real signed
return/outbox/correction test carries the two case-coexistence regressions. Sender tests separate
signed clashes from refused or lost answers and observe that a stopped clash schedules no retry.
The page, EN/ES guides, backlog and dated historical pointers describe this result. Estimate
2,250–2,450 lines; the combined outside-opinion stop remains about 3,100. Both PRs are owner-landed.
PR2’s exact acceptance and remaining refusals wait for the owner’s case-coexistence decision.


## Finish corrections cleared 2026-11-10 at 20:36

The watcher cleared maps for selected batch facts and skipping the full-chain check when a batch
inserts no fiscal original. Keep full signed inventory and late-fact enumeration, with no new
exchange, table or high-water mark. The allowance is about 2,950 lines plus accepted review fixes,
with another outside opinion past 3,150; PR2 gets its own budget after the owner's case decision.
The correction gate remains the trusted pinned former main supplied as history. It covers that
node's originals already inherited in the copy as well as originals received later; no import-only
marker or wider gate is introduced.

The two Claude run-it reads took 464 and 377 seconds. Corrections cover independent settlement,
voids after a blocked prefix, admission and receipt deletion proofs, retained-cancellation cases,
and the plan's reporting and settlement readers. The unused fiscal fingerprint is removed; the
server signs the complete batch inventory, including late payment and delivery facts. The small
text receipts and matching-image before/after measurement live in Lane J's
`receipts/a1342-finish-20261110/`. The owner or watcher lands both fiscal PRs.


## Fable corrections cleared by the watcher on 2026-11-10

The watcher’s Lane J notes headed 22:55 and 23:00 clear correction-clash preflight, independent
signature/correction-gate/clash tests, refusing a future-dated batch before any import, and removing
the receiver’s in-memory completeness map. The source still requires a signed accounted answer
for every batch, with its nonce, inventory and payload digest checked. A clock refusal retries and
leaves the new main’s sale clock unchanged. The existing clock-stop rule is unchanged.

The file list above was prospective: route cases live in `apps/server/src/return-records.test.ts`,
not a separate `return-records-api.test.ts`; fixture setup remains in the existing suites, with no
`apps/server/src/testing/return-records.ts`. The English guard gets one counted exception for the
real two-box fiscal test and its exact inventory gains that same path, as the watcher cleared.
Refund preservation and the archive/reset wording await the owner; no implementation is cleared
for either by these notes. The known receiver-verdict and older-chain payment limits remain in the
backlog under the watcher’s instruction.


## Owner-directed refund and reset correction, 2026-11-11

This supersedes the pending refund/reset wording above. Lane J questions.md WATCHER10:14 records
owner10:14 choosing “Both, as recommended”: “send finished refunds with the payments (a refund
still in progress on the old box holds the hand-back until it finishes), AND the page stops saying
'You can reset this box' and instead says plainly what a reset would delete.” Watcher10:20 clears
these fixes up to3,500 changed lines, retaining the completed whole-branch reviews and requiring
one fresh read of only the new part. The existing payload, per-sale batches, signed inventory and
comparison carry completed tender_refunds unchanged. Pending selected-sale refunds refuse the
read; noncompleted incoming refunds refuse before import. No archive, recovery worker or provider
operation is added. Reset wording names venue data, sale lines and local backups; it gives no
blanket permission to discard them. The owner/watcher still lands this PR.
