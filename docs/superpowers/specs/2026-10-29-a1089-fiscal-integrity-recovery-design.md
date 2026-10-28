# A1089: inspect fiscal integrity evidence before choosing recovery

**PROPOSAL, 2026-10-29. Awaiting owner scope decision. No implementation authority.**
You need to distinguish a saved predecessor-check failure from a local validation warning before
choosing what to do. Recommend planning evidence-only inspection first; persistent repair stays OPEN.
Scope: [fiscal-integrity audit](../../backlog/self-service-refusals.md#fiscal-integrity) and
[backlog](../../backlog.md), specifically `chain.verification_failed` and `fiscal.record_flagged`.
This milestone fixes no wording and authorises no implementation. Neither alert proves a product bug
is the only cause. This proposal makes no external or legal claims.

## What the source and existing fixtures establish

References are repository-relative at HEAD `1cd34678b438bb8a2a0b5462b95fed614ec99ff3`.

- `packages/fiscal-verifactu/src/backend.ts:678` delegates `checkIntegrity` to `verifyChain`.
  `packages/fiscal-verifactu/src/verify.ts:50` reads the node's last two rows by descending sequence.
  `:64` recomputes only the most recent predecessor's hash; `:92` compares its stored predecessor
  pointer with the next predecessor's stored hash when applicable. This checks neither the whole
  chain nor every column. `:60`, `:79`, `:89`, `:105` return `checked` as 0, 1 or 2.
- `verify.ts:66` reports `predecessor-hash-mismatch`, with expected hash recomputed from stored inputs
  and found stored hash; `:93` reports `predecessor-link-mismatch`, comparing two stored hash facts.
  `:88` reports `predecessor-missing` with no expected/found pair. Expected is not an authoritative
  replacement value. `verify.test.ts:146`, `:163`, `:178` assert these facts and sequence ordering;
  `:245` asserts another append after deliberate fixture corruption, not permission to repair history.
- Core maps issues to `issueCode`, `recordId`, `issueParams`, omitting `checked`:
  `packages/core/src/record-sale.ts:203`, `record-correction.ts:236`, `record-void.ts:49`,
  `record-substitution.ts:147`; shape: `packages/core/src/errors.ts:132`.
  Incidents attach to the new sale/corrective sale/substitution, or the voided sale for a new void
  (`record-sale.ts:330`, `record-correction.ts:283`, `record-substitution.ts:196`, `record-void.ts:75`).
  Saved issue IDs identify predecessors, not the new event's fiscal record. These failed reports do
  not refuse those operations; ordinary database errors and other guards can still refuse them.
  Continuation fixtures: `record-sale.test.ts:554`, `record-correction.test.ts:1176`,
  `record-void.test.ts:445`, `record-substitution.test.ts:679` in `packages/core/src`.
- `packages/fiscal-verifactu/src/chain.ts:179` builds and validates the new record at its generation
  instant (`:186`). `HUELLA_MISMATCH` throws `IssuanceRefusal` (`:188`); severity errors and malformed
  hash warnings refuse (`:193`, warning set `:42`). After insertion, totals warnings are separate
  (`:231`); other warnings raise `fiscal.record_flagged` in the same transaction (`:242`, `:257`).
  `:248` saves field/code arrays paired by position, without field values or `registroId`;
  `packages/fiscal-verifactu/src/errors.ts:105` declares that shape.
- `chain.validation-warnings.test.ts:16` adds injected validator results to real validation for most
  cases. Its IPSI fixture at `:125` genuinely omits `ClaveRegimen` and asserts a non-total warning
  incident. It proves no live AEAT acceptance. `chain.record-validation.test.ts:49`, `:57`, `:192`
  assert local refusal/rollback and generation-time checking. Later validation with a newer date or
  library would be a new observation, not a replay of the original warning or an agency response.
- `packages/core/src/incidents.ts:95` suppresses conflicting inserts; the open key includes source,
  device, code and sale (`packages/db/src/schema/incidents.ts:69`). A retained incident need not be
  the latest observation or complete history. `incidents.ts:307` writes acknowledgement fields only.
- `packages/db/src/alerts.ts:4` owns core chain claims with `fiscal.view`; the fiscal module claims
  `fiscal.` with that permission (`packages/fiscal-verifactu/src/alerts.ts:10`). Neither supplies an
  inspection target. `apps/server/src/alerts.ts:115`, `:189` filter incident visibility by permission;
  `apps/server/src/alerts-api.ts:129` separately authorises Mark handled.
- `apps/dashboard/src/widgets/alert-format.ts:38` needs a permitted supplied screen for navigation;
  `apps/dashboard/src/screens/alerts-screen.ts:180` offers acknowledgement and any supplied target.
  EN/ES support referrals remain at `apps/dashboard/src/i18n/alert-messages.ts:136`, `:233`.
  The latter's acceptance wording is not evidence that an agency accepted this record.

Parent-run unchanged fixtures; logs read under `/Users/clintongormley/waitron-campaign-e/receipts/a1089-fiscal-integrity-20261029/`:
`fiscal-baseline.log` records 57 passes across verify, validation-warning, record-validation,
write-path and immutability suites; `core-baseline.log` records 5 passes and 214 unrelated skips
for the four record suites filtered by `chain verification fails`; `alerts-baseline.log` records
56 server alert/API passes. These are local synthetic/mocked fixtures, not live AEAT, a complete
chain audit, persistent repair or rendered UI qualification. No original tests change in this milestone.

## Proposed inspection: saved evidence first, fresh reads separately

From the relevant incident, choose **Inspect evidence / Examinar evidencia**. Show incident identity,
detection time and **Saved at detection / Guardado al detectar**. Explain the historical check's
limited scope. Its checked count and detection-time software/validator context are unknown unless
actually retained; never manufacture them from today's rows, installed library or the issue count.

For chain issues, show recognised issue kind, validated associated record IDs and bounded, validated
expected/found hash facts only where safe. Explain what each comparison measured, including that
expected came from then-stored data. A missing predecessor has no hash pair. For warnings, show
recognised field/code labels paired in their saved order, without raw field values. Say **Local
validation warning / Aviso de validación local** and **Agency outcome unverified / Resultado ante
la AEAT sin verificar**. Do not choose a sale's latest fiscal record to fill a missing record ID.

Any authorised fresh read is separately labelled with `observedAt`; it describes current stored facts,
not what was observed at detection or proof of present acceptance. Missing metadata is **Unavailable /
No disponible**; multiple candidate associations are **Ambiguous / Asociación ambigua**. Preserve safe
original field/code facts even when record association fails. A prior incident never stands for all history.
Render bounded, allowlisted structures as plain text with safe unknown labels and validated array lengths.
Keep field/code positions paired without independent sorting. Exclude raw parameter dumps, invoice/customer/staff
data, credentials, logs and raw-record exports; offer no unrestricted export.

Offer **Read again / Volver a leer** and **Stop / Cerrar inspección**, including after a refused or timed-out
read. Stop closes inspection without stopping sales or filing and remains available while reading.
No diagnostic polling or automatic acknowledgement. Existing **Mark handled / Marcar como atendida**
stays separate, explicitly described as acknowledgement, never repair or proof the condition has cleared.

## Proposed module, server and authentication boundary

Conceptually reuse the optional evidence seat, a module-owned read-only callback, from the
[fiscal-reply proposal](2026-10-28-a1089-fiscal-reply-recovery-design.md). That unapproved proposal is
not an existing API. A generic endpoint could accept only a stored incident ID; core/server import
no fiscal tables. An enabled module must be authoritative for that incident's source/regime, including
core-owned chain incidents. Prefix matching alone cannot select a fiscal reader. An absent binding
answers unavailable; follow `docs/developers/conventions-data.md:173` without widening import exceptions.

Authorise both incident and evidence read with `fiscal.view`. Validate stored incident association,
source binding and payload types/bounds before any fiscal-row read. Parsed record IDs grant no access.
The module must establish the same node and a predecessor relationship to the correct event record;
do not require a predecessor to share the event's sale ID. If linkage is missing or ambiguous, return
unavailable/ambiguous details and safe retained facts. Warnings lack an exact record ID: never guess.
Plan each event's association before enabling fresh reads. Viewing grants no repair authority.

When rights are needed, offer local administrator/owner sign-in with explicit continuation and Stop.
Design that continuation; do not assume it exists. Reuse credential protections and require a gesture
for modal passkeys. Keep inspection passive; resolve sessions without activity writes (`management-session.ts:87` in
`packages/identity/src`); check expiry, revocation, suspension and permissions before reading and freshly
before release. Clear prior-account evidence on account change or expiry; require an explicit new read.

Bound the complete read to five seconds, including access waits and final authorisation. Plan cancellation
with no queued late work, a select-only host read, no write transaction, session
stamp or change-log drain. Call no `checkIntegrity`/`verifyChain`, validator, fiscal writer, client or drain.
Use `no-store` and memory only. Identifiers for each opening/read/account invalidate old
results and busy-state releases on Stop, close/reopen, newer read, account change, expiry and timeout.

## Persistent repair remains OPEN; checks required before a later build

Inspection promises no sales stop, record/hash rewrite, whole-chain recheck, AEAT request, refiling,
numbering/series reset, restore/reset, corrective invoice or configuration change. Future repair needs
actual evidence and an approved decision route. Inspection planning need not wait for W41s-8/W41s-9.

Prospective checks must reject tampered/unknown/missing evidence, swapped field/code pairing, ambiguous
same-sale candidates and predecessor/new-event confusion. Assert no whole-chain or agency-acceptance
inference. Cover permission revocation/account switch and stale answers after close/reopen or expiry.
Compare fiscal, incident and session facts before/after success, refusal, timeout and Stop; assert zero
AEAT, acknowledgement, writer, client and drain calls, including after deadlines. Keep original protected
tests unchanged. Exercise EN/ES, light/dark, 390/1280 widths, keyboard and axe, plus guide twins with
shared section IDs. No mockups or rendered UI qualification are claimed for this proposal.

**A, recommended:** authorise a PLAN for read-only evidence inspection first; persistent repair stays OPEN.
**B:** design the complete recovery/decision path before any build. This is substantial module/server/UI/auth
integration, not a small wording repair. Both choices authorise planning only; building needs separate approval.
