# A1089: inspect reconciliation evidence before choosing recovery

**PROPOSAL, 2026-10-29. Awaiting owner scope choice. No implementation authority.**
You need to distinguish a recorded discrepancy from today's local facts before choosing recovery.
Recommend planning read-only inspection of already-recorded incidents first; fiscal reconciliation
activation, its production caller and persistent decision/repair remain OPEN. Scope: [fiscal-reconcile audit](../../backlog/self-service-refusals.md#fiscal-reconcile) and
[backlog entry](../../backlog.md), covering `fiscal.reconcile_no_trace` and `fiscal.reconcile_drift_anulada`.
This proposal fixes no product wording or journey and makes no external or legal claims.

## Current source and limits of the evidence

Repository-relative references below were rechecked at HEAD `9f57a8af1dfe85118e9887747c905efaa8119094`,
reported by `git rev-parse HEAD`. Scoped `rg -n` searches of TS/JS import paths and calls under
`apps/`, `packages/`, `scripts/`, `bench/` and `deploy/` found direct fiscal reconciliation imports only
in `packages/fiscal-verifactu/src/reconcile.test.ts:13`, `reconcile.period.test.ts:12` and `acks.test.ts:9`.
No production caller was found in that search; this is not proof of unreachability.

- `apps/server/src/boot.ts:92` imports `reconcile` from `@waitron/module`, called at `:1048` for module
  selection. `:1716` constructs `StripeReconciler`; `:2875` schedules its payment duty through `runDue`.
  `apps/server/src/reconcile-duty.ts:10` adapts a `PaymentReconciler`, not the fiscal library function.
  Fiscal submission uses `enabledFiscal.drain` (`boot.ts:2846`). `FISCAL_SLOT` exposes that pass in
  `packages/fiscal-verifactu/src/slot.ts:77`; `packages/fiscal/src/contribution.ts:128` has no fiscal
  reconciliation seat. `packages/fiscal/src/backend.ts:155` declares a result type, not a runtime caller.
  `packages/fiscal-verifactu/src/index.ts:1` does not re-export reconciliation; its package's
  `package.json:71` permits direct `./src/*` imports, so absence from the index is no invocation barrier.
- The existing function is not read-only. `packages/fiscal-verifactu/src/reconcile.ts:124` pads year/month strings without date validation.
  The first transaction, T1 (`:140`), reads period `envios` joined to `registros_facturacion`; SQL (`:235`) selects by invoice
  expedition month, without a node/environment filter. Only nonempty periods resolve a client (`:143`).
  Paged `consultar` runs outside transactions (`:149`, `:292`); a later transaction, T2 (`:153`), writes using T1's snapshot.
  `:298` keys answers only by `RefExterna`, skips missing references and checks no invoice triple.
  More pages without a continuation key throw (`:307`). These reads qualify neither production
  node/environment safety nor concurrent callers; a future active caller must specify and test both.
- Pending/being-sent rows absent from the lookup are not `noTrace` (`reconcile.ts:158`); found rows
  become `lostAck`. `Correcto`/`AceptadoConErrores` map to local corrections (`:91`, `:334`), which write
  `envios` and call `writeAck`. `packages/fiscal-verifactu/src/acks.ts:60` derives the acknowledgement
  from that row and upserts it. The accepted-with-errors correction also opens a case; the lost-ack
  path raises its warning (`reconcile.ts:348`). `Anulado` has no correction-map entry.
- A missing accepted row first resets to pending, clears response metadata, deletes its acknowledgement
  and stamps `reconciled_resubmit_at` (`reconcile.ts:167`, `:376`). That timestamp records the reset,
  **not an actual repeat submission**. An accepted T1 row already carrying it raises an idempotent
  `fiscal.reconcile_no_trace` incident without resetting again. A found reference clears it (`:183`).
  **2026-10-29 precision:** “after one resubmission” in the historical inventory/source commentary
  exceeds this evidence. `reconcile.test.ts:284` synthesises the marker on an accepted row and checks
  the incident/no-second-reset/deduplication. It does not run reset, drain and second lookup as one journey.
  `reconcile.period.test.ts:172` likewise synthesises accepted-plus-marker to check the incident date.
- `AceptadoConErrores` drift corrects state/acknowledgement and opens a case (`reconcile.ts:204`).
  `Anulado` without a same-sale local cancellation raises an incident only (`:190`); it fabricates no
  cancellation. A sibling cancellation suppresses that drift (`:425`), and `reportedThroughAnulacion`
  (`:262`) can use its reference. `reconcile.test.ts:434` checks the fake's submitted-cancellation path;
  `:483` instead sets the original reference's state while the local cancellation remains pending.
  Suppression therefore does not prove current agency acceptance of the cancellation.
- `reconcile.ts:400` and `:436` save `registroId` and issuer/number/expedition-date identity, declared in
  `packages/fiscal-verifactu/src/errors.ts:207`, `:230`, with incident source/sale/detection time.
  Those payloads retain no full lookup response, lookup period, local/reported-state snapshot or
  response history. The code identifies a historical classification, not present agency truth or a
  Waitron-only bug. `packages/core/src/incidents.ts:103`, `:124` and the index in
  `packages/db/src/schema/incidents.ts:69` retain the first open incident for source/device/code/sale.
  Mark handled writes acknowledgement fields only (`incidents.ts:315`), freeing that key for later detection.
- `packages/fiscal-verifactu/src/alerts.ts:12` claims fiscal incidents with `fiscal.view`, without a target.
  `apps/server/src/alerts.ts:115`, `:189` filter recorded incidents by permission; `alerts-api.ts:126`
  exposes lists and `:129` separately authorises acknowledgement. These routes do not run fiscal audits.
  `apps/dashboard/src/widgets/alert-format.ts:38` requires a supplied, permitted screen; the actions in
  `apps/dashboard/src/screens/alerts-screen.ts:180` offer acknowledgement and any such target, not inspection.
  Support referrals remain in EN/ES at `apps/dashboard/src/i18n/alert-messages.ts:253`, `:261`.

Parent-run unchanged fixtures, with retained logs read for this proposal:

| Suites reported by parent                                                                                  | Log result                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fiscal `reconcile.test`, `reconcile.period.test`, `acks.test`, `write-path.e2e.test`, `inmutabilidad.test` | 61 passed, including the parent's 20 protected cases; `fiscal-baseline.log`. |
| Server `alerts.test`, `alerts-api.test`, `reconcile-duty.test`                                             | 64 passed; `alerts-baseline.log`.                                            |

Logs: `/Users/clintongormley/waitron-campaign-e/receipts/a1089-fiscal-reconcile-20261029/`.
These are local fake-authority fixtures and isolated visibility/payment-duty checks, not an end-to-end
running fiscal audit or live AEAT qualification. No new tests were run for this document.

## Proposed scope A: inspect saved findings, with fresh local facts separately

From an open relevant incident choose **Inspect evidence / Examinar evidencia**. Show incident identity,
detection time and **Recorded finding / Hallazgo registrado**. Label the finding **Missing reference detected /
Referencia ausente detectada** or **Cancellation discrepancy detected / Discrepancia de anulación detectada**.
Show only validated, bounded record/invoice-number/date facts and an issuer-match indicator; omit the raw issuer tax id. Missing lookup period, response, historical states or send evidence is
**Unavailable / No disponible**. Do not reconstruct detection-time context from today's rows.

Only after the module validates the exact incident/record association may it show **Current local facts /
Datos locales actuales**, separately timestamped with `observedAt`: stored send state, acknowledgement
state, reset marker/time and associated local cancellation existence/state. Label the marker as a reset;
keep local cancellation existence, its stored acknowledgement and agency acceptance distinct. A local
read makes no present AEAT-outcome assertion. Missing/ambiguous association gives unavailable details,
never a guessed same-sale record or a raw parameter dump. Incident handling and local state can change.

Offer **Read again / Volver a leer** and **Stop / Cerrar inspección**, also after refusal or timeout.
Explain that Stop closes inspection only, without stopping sales or filing; keep it available during reads.
No automatic acknowledgement or diagnostic polling. Keep **Mark handled / Marcar como atendida** separate:
it acknowledges the alert, never repairs a discrepancy or proves the condition cleared.

Conceptually share the optional module-owned evidence seat, meaning a read-only callback, proposed by
the [reply](2026-10-28-a1089-fiscal-reply-recovery-design.md) and
[integrity](2026-10-29-a1089-fiscal-integrity-recovery-design.md) designs. **UNAPPROVED: no such API exists today.**
Plan a generic incident-id-only read; core/server import no fiscal tables or regime implementation.
Bind it to an authoritative enabled module for the stored source/regime; an absent binding answers unavailable.
Follow `docs/developers/conventions-data.md:181` without widening import exceptions. A parsed UUID or code
prefix grants no access. Authorise incident and evidence with `fiscal.view` for inspection only; the module
must validate stored source/code, parameter types/bounds, exact sale/node/regime association and invoice
identity against trusted host scope before releasing associated facts. Unknown/missing rows stay unavailable.

Offer any required administrator/owner sign-in there, with explicit continuation to this incident and Stop;
plan and test that continuation, without referrals or account-enrolment disclosure. Modal passkeys need a gesture.
Keep inspection passive and resolve sessions without touching activity (`packages/identity/src/management-session.ts:87`).
Check expiry, revocation, suspension and permission before the read and freshly before release. Use `no-store`,
memory only, and clear evidence on account change/expiry; require an explicit fresh read after sign-in.
Allowlist plain-text results; exclude customer/staff details, free-form client results, logs, keys,
certificates, secrets and unrestricted exports. Never expose raw fiscal params as the inspection result.

Bound the whole read to five seconds, including queue waits and final authorisation. Plan cancellable,
select-only access with no queued late work, write transaction, session stamp or change-log drain.
Call no `reconcile`, `consultar`, client resolver, drain, submit, acknowledgement mutation or record editor.
Opening/read/account identifiers must invalidate old results and busy-state releases on Stop, close/reopen,
newer read, account change, expiry or timeout. Do not infer an atomic historical/current snapshot.

## Alternative B, protected boundaries and prospective qualification

B designs the complete authenticated, operator-invoked fiscal audit plus evidence/decision route first.
Activation changes behaviour: approve the caller and write authority separately from `fiscal.view`, period
validation/bounds, taxpayer/node/environment identity, reference plus invoice matching, paging/deadline/
cancellation limits, concurrency and drainer coordination, and evidence of an actual repeat submission.
Background activation is not the default; propose no cadence here. W41s-8/W41s-9 own filing-case decisions
when released. Neither option authorises changes to H2 protected writers, immutable records, huella,
chain, invoice numbers, SIF, reset or restore. Persistent repair needs its own approved decision route.

All following checks are FUTURE, not executed: minimal saved evidence; malicious/unknown/missing params
and associated rows; historical versus current facts; reset marker versus actual send; separate cancellation
facts; no false present agency claim; source binding and incident association/authorisation. Compare fiscal,
incident and session facts before/after success, refusal, timeout and Stop; assert zero writer, acknowledgement, client, reconcile or drain calls,
including queued work after deadlines. Hold reads across account change, expiry, revocation, newer reads
and close/reopen to reject stale results/releases. Keep protected tests unchanged. Exercise EN/ES, both
themes, 390/1280 widths, keyboard/axe and guide twins with shared heading IDs. No UI mockup or look qualification.

**One owner scope choice: A, recommended, authorise a PLAN for read-only inspection first, leaving persistent repair and the production caller OPEN; or B, design the complete active caller/recovery route first.**
Both choices authorise planning only. A build requires separate approval.

## Owner decisions and implementation plan, 2026-10-29

The owner selected evidence-first scope A at 01:58. The newer 08:07 instruction authorizes
read-only evidence screens to be built after their fresh plan review, with sign-in, Read again
and Stop only. It supersedes the planning-only and separate-build-approval statements above for
this scope. The historical proposal and its source audit remain intact.

Follow the [implementation plan](../plans/2026-10-29-a1089-fiscal-reconcile-evidence.md) after its
fresh review and coordination of actual shared files. The screen remains to be built and
qualified. Production reconciliation activation, caller authority and cadence, and persistent
repair remain open; the read-only approval authorizes none of them.
