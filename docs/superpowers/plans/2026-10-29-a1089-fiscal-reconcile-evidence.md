# A1089 Fiscal Reconciliation Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement task-by-task, inline. Steps use checkbox (`- [ ]`) syntax. No routine subagents.

**Goal:** Inspect the first retained reconciliation finding beside verified current local observations, with sign-in, Read again and Stop; persistent repair and production fiscal reconciliation activation remain **OPEN**.

**Architecture:** Extend the planned generic incident evidence endpoint, optional fiscal seat and contributed alert action. The fiscal module projects saved facts independently, then proves exact membership against trusted host scope before reading current state. Reuse one shell-owned authentication continuation and generation across panel, requests and live connections.

**Tech Stack:** Existing TypeScript, Hono, Drizzle/node:sqlite, Lit, dashboard-kit, `wt-*`, Vitest, `useVenueDb`, Chromium and axe. No dependency or migration.

**Spec:** [complete reconciliation design](../specs/2026-10-29-a1089-fiscal-reconcile-recovery-design.md), [full audit](../../backlog/self-service-refusals.md#fiscal-reconcile), [backlog](../../backlog.md).
Owner **2026-10-29 01:58** chose read-only evidence-first A for all five areas. Newer **08:07** authorizes the read-only BUILD after fresh plan review, with sign-in, Read again and Stop. Do not renew the scope/build question.
This firing writes and self-reviews **only this plan**. The driver supplies the separate fresh reviewer, historical-spec/backlog pointers and publication. Sibling historical build holds do not override 08:07 for this scope.

## Global Constraints

- Only `fiscal.reconcile_no_trace` and `fiscal.reconcile_drift_anulada`. No new production fiscal caller, audit cadence or decision/repair route; inspection does not complete A1089 or W41s-8/W41s-9.
- Saved classification, source and detection time describe the first open deduplicated incident, never complete history or present agency truth. Missing full response, lookup period, historical local/reported snapshots and send history stay unavailable.
- Safe saved invoice facts survive missing/unreadable/deleted/mismatched current association. Current facts and their `observedAt` require exact incident/source/sale/node/regime/issuer/number/expedition-date association against trusted host binding. No newest/same-sale guess.
- Reset marker/time proves a reset only, never actual repeat sending. Local cancellation existence, stored send state, its local acknowledgement and agency outcome remain separate; a pending or wrong-scope cancellation cannot erase saved discrepancy facts.
- Inspection/Read again/Stop are passive, select-only: no touch, queue, transaction, change-log drain, acknowledgement mutation, client resolution/construction, `reconcile`, `consultar`, submit/drain, record validation, hash computation, number allocation, reset, restore or configuration change. Sign-in is a separate authorized identity operation.
- Require `fiscal.view` before lookup and the registry claim permission before detail lookup/dispatch; freshly recheck both before release, including expiry, revocation, suspension and identical session row/person. Resolve with `touch: false`.
- **5000 ms** covers earliest real boot mirror/promotion/session admission through final fresh authorization and serialization. No late queued work after cancellation/timeout. Preserve origin/security/mode gates; read-only gating precedes mutating middleware.
- Bound raw params before Drizzle JSON hydration: **1,048,576 UTF-8 bytes**, nesting **16**. Bound projected reconciliation wire data to **16,384 UTF-8 bytes**, depth **16**; preserve sibling response limits. These are inspection limits, not agency-format claims.
- Success/refusal use `Cache-Control: no-store`; evidence is memory-only plain text. No polling, export, clipboard, storage/cache, evidence URL, raw params/messages/XML/logs/keys, customer/staff PII or raw issuer tax id.
- Preserve schema, migrations, guards, fiscal writers, chains, numbers, protected/golden tests and existing fixtures/assertions byte-identical. Generic server/core never import fiscal implementation/tables; no import-allowlist growth.
- Before future code, read TDD and relevant developer conventions. Every task observes intended red, minimal implementation, green with actual Tests counts and `git commit -s`; retain hooks and repository local/CI split.
- Coordinate A696/A739/A803 and Lane B evidence work against actual current reservations/diffs before future execution. Include other live reservations encountered there. This plan reserves no shared hunk and changes no campaign/global state.

## Review Focus

1. One sale can deduplicate different record findings: Tasks 1/2 retain the original saved identity and never substitute another record.
2. Reset and lost-ack rows can resemble successful sending: Task 2 shows only stored reset/send/ack facts and keeps actual repeat send and current agency outcome unverified.
3. Cancellation may be pending, accepted locally, wrong-node/wrong-sale or ambiguous: Task 2 proves its own association and never suppresses saved discrepancy evidence.
4. Malicious stored JSON can hydrate before route validation, and mirror middleware can write before a handler: Task 3 qualifies raw bounds and complete boot admission.
5. Stop after submitted sign-in can accept a cookie while old 401/activity/body/live/finally callbacks arrive: Tasks 4/5 reconcile identity and fence effects while global `node.reset` still propagates.

---

## Source orientation and file map

Inspected base **`be84b248b78c7e9e7d4f742c906acd0b84761aa8`**, from `git rev-parse HEAD`. These are source readings, not runtime receipts. All source references below refer to that base; re-read after coordinated rebase.
In the table, module paths expand under `packages/fiscal-verifactu/`, DB under `packages/db/`, core under `packages/core/`, server under `apps/server/`, dashboard under `apps/dashboard/` and kit under `packages/dashboard-kit/`.

| Boundary               | Inspected source and decision                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active library         | `packages/fiscal-verifactu/src/reconcile.ts:140/:149/:153` reads, queries, then writes. `:376/:388` resets state/deletes ack; `:436` saves four invoice parameters via `recordIncidentOnce`. Never call it for inspection.                        |
| Cancellation caveat    | `reconcile.ts:238/:425` selects by sale, and `:190` suppresses drift on existence. `src/reconcile.test.ts:483` keeps the cancellation pending. Inspection must use stronger association and separate facts, without changing that producer.       |
| Local acknowledgements | `src/acks.ts:60/:69` derives/upserts from local envío; `:73` can substitute `now` for missing send time. `src/schema/acks.ts:14` declares states. Do not treat ack existence/time as proof of a send or current agency acceptance.                |
| Membership             | Module `src/schema/registros.ts:29/:36/:44/:49/:60` stores id/node/SIF/sale/type/invoice. `src/schema/sif.ts:18` binds SIF to node; DB `src/schema/sales.ts:80/:93` binds sale node/backend; `src/schema/nodes.ts:28` stores filing module.       |
| Date/text              | Module `src/registro-row.ts:93` reorders dates without validating them; validate calendar dates first. `src/venue-fields.ts:26` uses the invoice charset `[A-Za-z0-9/_.-]`; inspection adopts a bounded subset without calling record validation. |
| Retention              | Core `src/incidents.ts:124/:267/:315`, DB `src/schema/incidents.ts:69` retain first open and handle separately. `columns.ts:47` JSON-maps params, so ordinary `findIncident` is unsuitable before raw bounds.                                     |
| Host scope             | Server `src/boot.ts:1696` distinguishes `dataNodeId` (mirror origin) from physical node; `:1770` resolves `enabledFiscal`. Use authoritative displayed-data scope, never browser/saved node claims or today's SIF.                                |
| Auth/read boundary     | Server `src/alerts-api.ts:84/:104` uses transactions; DB `src/tenancy.ts:35` drains them. Identity `src/management-session.ts:47/:87` supports no-touch and checks person status. Server `src/mirror-session.ts:120` writes before routes.        |
| Visible action         | Module `src/alerts.ts:12` claims fiscal permission without target. Dashboard `src/widgets/alert-format.ts:27`, `src/screens/alerts-screen.ts:180`, module `src/dashboard/index.ts:7` supply existing alert/contribution seams.                    |
| Browser lifecycle      | Dashboard `src/main.ts:33`, `dashboard-app.ts:999/:1171/:1200`, `session-signals.ts:13`, `api/client.ts:2336/:4066`; kit `src/request.ts:21/:133/:149`, `live-connection.ts:67/:119`. Extend callbacks before effects.                            |

Scoped TS/JS import search under `apps/`, `packages/`, `scripts/`, `bench/`, `deploy/` found direct fiscal `./reconcile.js` imports in its `reconcile.test.ts:13`, `reconcile.period.test.ts:12`, `acks.test.ts:9`; this is not proof of runtime unreachability. Server `reconcile-duty.ts:10` adapts payments. No external/agency claim is made.
Read full sibling plans: [reply](2026-10-29-a1089-fiscal-reply-evidence.md), [integrity](2026-10-29-a1089-fiscal-integrity-evidence.md), [environment](2026-10-29-a1089-fiscal-environment-evidence.md), [certificate](2026-10-29-a1089-aeat-certificate-diagnosis.md).
Their generic evidence API, contributed actions and shared authentication owner are **PLANNED and absent at this base**, as the inspected contribution/contract/request/shell interfaces above show. Reuse qualified implementations when available; implement missing dependencies once, inline.

Create module `src/reconcile-evidence-contract.ts` (wire/parser), `src/reconcile-evidence.ts` (saved projection/reader), `src/reconcile-evidence-association.ts` (bounded association/current reads), dashboard `src/dashboard/reconcile-{client,inspection,strings}.ts`.
Extend the **one** module `src/incident-evidence.ts` combined dispatcher and `src/slot.ts` evidence wiring. Tasks 3/4 own shared dependency integration, Task 5 UI, Task 6 guide/copy qualification. No producer/schema edits.

## Proposed contracts and limits

Reuse reply/integrity `FiscalEvidenceJson`, `EvidenceReader = Pick<Transaction, "select">`, `EvidenceReadControl = {signal: AbortSignal; check(): void; yield(): Promise<void>}`, `FiscalIncidentEvidenceSeat.read(reader, incident, control)` and `FiscalContribution.incidentEvidence?`.
Keep `FiscalEvidenceIncident` fields `id, code, source, deviceId, saleId, params` and integrity's required `detectedAt: string`. Add optional host-only `binding?: {fiscalId: string; nodeId: string}`; core does not supply it, HTTP cannot set it. Reconciliation requires it for current facts; other branches remain compatible.
Extend proposed `mountIncidentEvidenceApi` deps `{db, seat?, registry, now}` with optional `binding?: {fiscalId: string; nodeId: string}`; boot supplies `{fiscalId: enabledFiscal.id, nodeId: dataNodeId}` from its trusted data scope. Missing binding preserves safe saved facts but permits no associated lookup.
Keep **GET `/management-api/alerts/incidents/:id/evidence`**, one UUID, no query/body/options. `management.request_invalid` 400; missing/unsupported incident with present seat `alert.not_found` 404; absent/disabled seat yields authorized `seat_absent`.
Keep `IncidentEvidenceEnvelope = {schemaVersion: 1; incident: {id: string; code: string; detectedAt: string}; handling: {observedAt: string; handledAt: string | null}; evidence: FiscalIncidentEvidence; authorizedUntil: string}`.
`FiscalIncidentEvidence` stays `{state: "available"; value: FiscalEvidenceJson}` or `{state: "unavailable"; reason: "seat_absent" | "missing" | "unreadable" | "invalid" | "association_mismatch"}`. Handling re-read is separately timed and carries no note/person.

Browser-safe module shapes in `reconcile-evidence-contract.ts`; all timestamps are validated canonical ISO UTC, invoice day stays validated `DD-MM-YYYY`:

```ts
type Unavailable = {
  state: "unavailable";
  reason: "missing" | "unreadable" | "invalid" | "association_mismatch" | "ambiguous";
};
type SavedFact<T> = { state: "known"; value: T } | { state: "unavailable"; reason: "invalid" };
type StoredFact<T> = { state: "known"; value: T } | Unavailable;
type SendState =
  | "pendiente"
  | "enviando"
  | "aceptado"
  | "aceptado_con_errores"
  | "rechazado"
  | "detenido"
  | "retenido";
type AckObservation =
  | { state: "absent" }
  | { state: "present"; value: "accepted" | "accepted_with_errors" | "rejected" | "halted" }
  | Unavailable;
type CancellationObservation =
  | { state: "absent" }
  | Unavailable
  | {
      state: "present";
      relation: "inspected-record" | "sibling";
      recordId: string;
      send: StoredFact<SendState>;
      acknowledgement: AckObservation;
    };
type ReconcileCurrent =
  | Unavailable
  | {
      state: "available";
      observedAt: string;
      send: StoredFact<SendState>;
      acknowledgement: AckObservation;
      resetAt: StoredFact<string | null>;
      cancellation: CancellationObservation;
    };
type ReconcileEvidence = {
  kind: "reconciliation";
  category: "missing-reference" | "cancellation-discrepancy";
  retained: {
    source: "fiscal_filing" | "other";
    retainedAt: string;
    retention: "first-open-incident";
    recordId: SavedFact<string>;
    invoiceNumber: SavedFact<string>;
    expeditionDate: SavedFact<string>;
    unavailableAtDetection: {
      period: "not_retained";
      response: "not_retained";
      localState: "not_retained";
      reportedState: "not_retained";
      sendHistory: "not_retained";
    };
  };
  current: ReconcileCurrent;
  issuerMatch: "matched" | "unavailable";
  repeatSend: "unverified";
  agencyOutcome: "unverified";
};
```

`observedAt` exists only on fully associated current observations; an unavailable association has no current timestamp. The final handling/session times do not make these an atomic snapshot. Null reset means no marker now, never no prior reset.
Saved params require exactly `registroId, idEmisorFactura, numSerieFactura, fechaExpedicionFactura`; extra keys invalidate all saved parameter facts/current association while retaining safe classification/source/time. Otherwise project valid id/number/day independently; a missing/invalid field does not erase another valid saved field.
UUIDs use existing `isUuid`; invoice number **1..60 ASCII** characters matching `/^[A-Za-z0-9/_.-]+$/`; issuer **1..128 printable ASCII** characters, internal comparison only, never output/log. Dates require an actual calendar day with year **0001..9999**, no timezone normalization. Reject controls/NUL, nulls, arrays and coercions.
`parseReconcileEvidence(value: unknown): ReconcileEvidence` rejects extra/missing keys, unknown wire enums, invalid UUIDs/timestamps/days, impossible arms and oversize/deep input before recursive traversal. The client separately checks category against envelope code. Hostile stored enum values produce fixed unavailable/invalid facts, never raw labels.
The browser client validates the complete envelope, expected incident id/code and module projection. No caller-controlled object spreading. `issuerMatch` is a present association result, outside retained facts: matched exactly when current is available, unavailable otherwise. It follows **all** association checks, never today's taxpayer or a wrong record's issuer comparison.

## Task 0: Coordinate the execution base

**Files:** Read current reservations, complete spec/audit and four sibling plans; driver owns spec/backlog publication.
**Interfaces:** Shared contracts above supplement the reply plan's newer auth/admission decisions; no second API/auth owner.

- [ ] Driver obtains the fresh plan review, then uses the already-authorized read-only BUILD and inline method. Resolve actual A696/A739/A803/Lane B overlaps before edits; record execution-base SHA and concrete protected-path list.
- [ ] Compare qualified shared implementations and callers with these signatures. Task 1 creates or reuses the generic type contracts; Tasks 3/4 implement missing server/auth integration when released. Do not import an absent sibling file or claim a reservation from this plan.

## Task 1: Project retained findings and strictly parse the wire

**Files:** Create module `src/reconcile-evidence-contract.ts`, `src/reconcile-evidence-contract.test.ts`, `src/reconcile-evidence.ts`, `src/reconcile-evidence.test.ts`. Create or reuse fiscal `src/incident-evidence-types.ts`; modify fiscal `src/{contribution,index}.ts` for the shared contracts and exports before module consumers use them.
**Interfaces:** `projectSavedReconcile(incident: FiscalEvidenceIncident): ReconcileEvidence["retained"]`; `parseReconcileEvidence(value: unknown): ReconcileEvidence`. Browser leaf has no DB/Node runtime imports.
Task 1 owns the reply plan's shared JSON/incident/result/envelope types, including required `detectedAt` and optional host-only `binding`, whether reconciliation builds first or extends an existing sibling. Export browser-safe types type-only through fiscal `index.ts`; keep `EvidenceReader`, `EvidenceReadControl` and `FiscalIncidentEvidenceSeat` in `contribution.ts`, with optional `FiscalContribution.incidentEvidence`. Preserve compatible existing consumers.

- [ ] Write red `keeps saved classification and missing context explicit`: both exact codes map to their own category, detection/source stay saved, and all five unavailable-at-detection facts remain `not_retained` despite today's complete rows.
- [ ] Write red `projects only validated saved invoice facts`: invalid/missing id/number/day is independently unavailable; extra keys invalidate parameter facts; hostile issuer/messages/HTML/NUL never appear. Cover exact 60-character number, leap day, year boundaries and printable issuer boundary with legitimate accepting controls.
- [ ] Write red wire cases for nested/oversize objects, extra keys at every arm, invalid dates/UUIDs, unknown enums, impossible arm combinations and a current timestamp on unavailable association. Valid complete objects round-trip exactly.
- [ ] Pin full-object assertions, including these invariants in the named cases:

```ts
expect(value.retained.unavailableAtDetection).toEqual({
  period: "not_retained",
  response: "not_retained",
  localState: "not_retained",
  reportedState: "not_retained",
  sendHistory: "not_retained",
});
expect(value.repeatSend).toBe("unverified");
expect(value.agencyOutcome).toBe("unverified");
expect(JSON.stringify(value)).not.toContain(rawIssuerSentinel);
```

- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reconcile-evidence-contract.test.ts src/reconcile-evidence.test.ts`; require intended missing parser/projector failures, not loader/fixture failures.
- [ ] Create or reuse those shared contracts and exports first, then implement only the bounded projection/parser above. Map unexpected saved source to fixed `other`; it grants no association. Do not derive a lookup month from invoice date, populate historical states from current rows or call a validator.
- [ ] Repeat the command green with Tests counts; stage only Task 1 paths and `git commit -s -m "feat: project retained fiscal reconciliation evidence"`.

## Task 2: Associate exact records and separate local cancellation facts

**Files:** Create module `src/reconcile-evidence-association.ts`, `src/reconcile-evidence-association.test.ts`, `src/slot.reconcile-evidence.test.ts`; extend new `src/reconcile-evidence.test.ts`; create/extend `src/incident-evidence.ts`, `src/incident-evidence.test.ts`; modify `src/slot.ts` evidence wiring only.
**Interfaces:** `readReconcileEvidence(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<FiscalIncidentEvidence>`; `readReconcileCurrent(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<{current: ReconcileCurrent; issuerMatch: "matched" | "unavailable"}>`.
Extend integrity's proposed `createIncidentEvidenceSeat(replyReader?: FiscalIncidentEvidenceSeat["read"])` deliberately to `(replyReader?, reconcileReader?, integrityReader?)`, all typed `FiscalIncidentEvidenceSeat["read"]`. Preserve the first positional callback; make integrity's former internal reader an optional third callback so **any** build order needs no absent import.
Declare exactly `fiscal.respuesta_descuadrada`, `chain.verification_failed`, `fiscal.record_flagged`, `fiscal.reconcile_no_trace`, `fiscal.reconcile_drift_anulada`. Missing branch callback yields `seat_absent`, never disables another branch. Slot passes only readers actually built; when integrity/reply land, supply their callbacks to this same dispatcher.
If integrity is already implemented, trace and migrate every factory caller to pass its reader in the third position in the same change, preserving every integrity/reply branch and assertion. Do not replace a working integrity seat with reconciliation-only wiring.

- [ ] Write red `binds the exact saved invoice against host scope` using `useVenueDb({migrations: TEST_MIGRATIONS})` and unchanged `test/{fixtures,drain-fixtures,write-path-fixtures}.ts`. Use real saved incident rows and real fiscal projections; trap writers/clients only after setup.
- [ ] Cases: wrong code/source, non-null incident device, null/wrong sale, missing host binding, wrong node/backend/node filing module, absent sale/node/SIF, SIF-node/issuer mismatch, each invoice triple component mismatch, invalid stored date and another valid same-sale/newer record. No current facts, no observedAt, safe saved facts unchanged. A revoked historical SIF on the bound node remains valid; do not require today's SIF or taxpayer.
- [ ] Add red `reset is not repeat-send evidence`, `lost ack is a local observation`, `cancellation does not settle saved drift`: marker with no send; marker cleared later; absent ack on pending envío and accepted local ack; cancellation pending, accepted, wrong-sale/node/triple and ambiguous. Both local accepted states still leave agencyOutcome/repeatSend unverified. Existing saved drift stays visible in every case.
- [ ] Add red `retains first open finding after later detection`: use real `recordIncidentOnce` twice on one sale/code with deliberately different record facts, inspect original, then separately handle and inspect again. Saved identity/time unchanged; handling observation changes. No producer invocation during inspection.
- [ ] Assert exact fallback and accepting controls: `expect(unbound.current).toEqual({state: "unavailable", reason: "association_mismatch"})`, `expect(unbound.retained).toEqual(savedBefore)`, and verified current contains the expected own send/ack/cancellation plus observedAt. Every invalid case retains safe facts; legitimate historical/SIF/cancellation reads succeed.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reconcile-evidence-association.test.ts src/incident-evidence.test.ts src/slot.reconcile-evidence.test.ts`; observe intended missing association/dispatch failures.
- [ ] Also run Task 1's `src/reconcile-evidence.test.ts` through package Vitest to observe the new reset/dedup assertion failures before implementing them.
- [ ] Implement association-only explicit scalar selects: require source `fiscal_filing`, device null, valid sale, host binding fiscalId `verifactu`; exact saved record id joins that sale, same bound node, existing matching-node historical SIF and node filingModule/sale fiscalBackend `verifactu`. Require historical SIF.nif equals record issuer, then compare saved issuer/number/validated date against immutable record, converting stored date only after validation. Never select JSON payloads or search a replacement record.
- [ ] After full proof, select only own `envios.estado/reconciledResubmitAt` and own `acks.state`. Missing envío makes send/reset unavailable/missing, not pending; missing ack is absent, malformed state is invalid. Recheck association on the selected scalar row. No ack timestamp/CSV/error message/attempt history is projected.
- [ ] For inspected anulación, cancellation is that verified record (`inspected-record`). For alta, read at most **2** cancellation candidates for the exact sale; none means absent, more than one ambiguous. Verify candidate node, its historical SIF/node/issuer, regime and the full same invoice triple. Wrong-scope candidate means unavailable/association_mismatch, never absent or chosen. A valid cancellation can use another historical SIF on the same node. Then read only its own send/ack; no period filter or newest ordering.
- [ ] Set current `observedAt` after the bounded local observations complete. It describes that observation's completion, not simultaneous reads. If the main association disappears/fails its reread, return current unavailable without observedAt; otherwise individual missing/unreadable send/ack/cancellation facts retain their own unavailable arms.
- [ ] Check `control` before/after every select and `await control.yield()` between association/current phases. Catch row/table read failures as fixed unavailable/unreadable while preserving saved facts; propagate cancellation/deadline to the host. No `execute`, transaction, writer or external client capability.
- [ ] Repeat green including Task 1 suites and unchanged `src/slot.test.ts`; verify all five dispatch branches with absent/combined callbacks and exact zero unrelated-reader calls. Stage Task 2 paths; `git commit -s -m "feat: associate current reconciliation observations without inference"`.

## Task 3: Qualify the shared endpoint through real no-write boot admission

**Files:** Reuse/create reply Task 2 server `src/incident-evidence-{api,read}.ts`, `src/{boot,mirror-session,errors,me-api}.ts`; core `src/{incidents,index}.ts`. Create server `src/incident-evidence.reconcile.test.ts`, `src/boot.reconcile-evidence.test.ts`; extend new shared `incident-evidence-{api,read}.test.ts`, `incident-evidence.transport.test.ts`, core `src/incident-evidence.test.ts`.
**Interfaces:** Keep `mountIncidentEvidenceApi(app, deps, log): void` with optional binding addition above; reuse `readIncidentEvidenceTurn<T>(db, control, read: (reader: EvidenceReader) => Promise<T>): Promise<T>` and `createEvidenceReadControl(signal, startedAt): {control; dispose(): void}`. Full signatures/types are shared with reply Task 2, not another reconciliation route.
Reuse `findBoundedIncident(tx, id, {maxParamsBytes: 1048576, maxJsonDepth: 16})` and metadata-only `readIncidentHandling(tx, id)` with reply's exact `BoundedIncident` result; host attaches detectedAt/binding without exposing raw params.

- [ ] Write red both-code real-route cases: exact envelope/projection, open/handled, absent/disabled seat, invalid id/query/body, unsupported code and current-unavailable/saved-retained. Initial fiscal and claim gates precede payload/associated lookup; missing/expired/revoked/suspended/deleted-person sessions and missing rights return 401/403, zero seat work. Sanitize refusal params too, including suspended person id.
- [ ] Write red `rechecks authorization through final release`: hold seat then final auth separately; revoke rights/session, suspend/delete person, expire or replace session row/person. No partial evidence; final sessionRowId/personId must match initial and `authorizedUntil` comes from final no-touch expiry. Authorized same-session control still succeeds.
- [ ] Write red raw-storage cases: **1,048,577 bytes**, malformed/nonobject JSON, depth **17**; legitimate exact-byte/depth-16/escaped-braces controls. Assert zero hydration/seat calls on invalid inputs, metadata-only handling still reads and no raw text/exception reaches wire/logs.
- [ ] Write red actual-boot cases: overdue-valid, expired, ended and absent mirror viewer; promotion with old cookie; nonempty pending change log; unrelated held writer. Abort/timeout during admission/seat/body/final-auth phases, release later and assert `selectsAfterCancellation === 0`, zero queued work/response, `response.status === 504` at the server deadline and a successful fresh subsequent read.
- [ ] Write real listening transport/socket-disconnect cases using one `freePorts(n)` draw. In-process fixtures own deliberate mid-read DB mutations; never parent-write a running child server's DB. Assert budget starts at first admission, not handler entry.
- [ ] Snapshot tests compare all logical tables before/after success/repeat/unavailable/refusal/Stop/timeout: records/SIF/chains/counters/envíos/acks/cases, incidents/handling/notes, sessions/person rows and pending change log. `expect(after).toEqual(before)` plus mutating-statement/notification traps catches write-then-restore. Trap every fiscal/client/reconcile/consultar/drain/ack/validator/hash/reset/restore/config seat after setup; deliberate race-control writes are separate.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/incident-evidence.reconcile.test.ts src/boot.reconcile-evidence.test.ts src/incident-evidence-read.test.ts src/incident-evidence.transport.test.ts`; require intended route/admission failures before implementation.
- [ ] Run `pnpm --filter @waitron/core exec vitest run src/incident-evidence.test.ts`; observe intended raw-storage failures before implementing the shared bounded reader.
- [ ] Qualify shared raw-storage path **before JSON hydration**: metadata plus `length(cast(params as blob))`, SQL CASE fetch of `cast(params as text)` only under byte cap, repeat bound on any second select. Iterative string/escape-aware depth scan precedes JSON.parse. No JSON-mapped params or stringify-to-measure. Invalid host input returns sanitized unavailable without calling the seat; handling selects no params.
- [ ] Repeat the core command green after its minimal implementation; raw bounds must precede JSON mapping, including at the actual route boundary.
- [ ] Implement/qualify earliest boot admission before mirror/promotion/session waits with request-local monotonic startedAt and shared `isInspectionRead(method,path)` for evidence/session-me GETs, including malformed ids. Set no-store there before validation/security/mode refusals. Preserve read-only/security gates. Shared optional fifth mirrorSession dependency bypasses only diagnostic ambient stamp/revival/injection/promotion cleanup; promoted viewer refuses `management_session.required` without changing row/cookie. Ordinary requests retain existing behavior.
- [ ] Read sequential selects outside write-transaction context and uncancellable queues; never use `withTransaction`, `withWriteLock`, attempt turns or change drain. Race awaited phases through final auth/serialization; check before/after bounded selects. Timeout `diagnostics.read_timed_out` 504 with `{deadlineMs: 5000}`; no partial evidence. Observe abandoned promises/dispose listeners/timers within **1000 ms**, without extending response authority.
- [ ] After metadata permission, fetch bounded params and attach trusted binding; dispatch only through enabled seat-declared codes. Re-read handling without params, then freshly authorize immediately before serializing/releasing the allowlisted envelope. Check elapsed deadline/signal and final session expiry after serialization too; never release partial/stale facts or raw exception params. Per-module reconciliation limits must not reduce sibling wire limits.
- [ ] Repeat green plus unchanged server `src/alerts.test.ts src/alerts-api.test.ts src/mirror-session.test.ts src/me-api.test.ts`. Keep ordinary mirror bootstrap/cleanup and authorized concurrent writer controls. Stage coordinated Task 3 files; `git commit -s -m "feat: serve reconciliation evidence through passive boot admission"`.

## Task 4: Reuse one authentication owner and qualify stopped sign-in

**Files:** Reuse reply Task 3 dashboard `src/{permission-continuation,inspection-auth,session-signals,main,dashboard-app,api/client,screens/login-screen}.ts`, `src/i18n/{strings,codes}.ts`; kit `src/{auth-generation,index,contract,request,live-connection}.ts`; server session-me from Task 3. Create dashboard `src/dashboard-app.reconcile-auth.test.ts`; extend new shared auth suites, preserve baseline assertions.
**Interfaces:** Shell `SessionEpoch.current/advance/subscribe` owns sole `sessionGeneration`; `AuthGeneration.capture/invalidate/isCurrent/subscribe` delegates. `PermissionContinuation` owns `snapshot/subscribe/signIn/trackAuthentication/requestSignIn/stop/reconcile`; `InspectionAuthController` adapts this same owner/settlement registry exactly as reply Task 3, with no new login controller/counter.
Keep DashboardApi fifth `passive`, sixth optional `{sessionGeneration?: () => number}` forwarded to background; `getMe(options?: RequestOptions)` returns `sessionIdentity` from sessionRowId. Reconciliation read uses no-touch/no-drain session-me and `{passive: true, timeLimitMs: 5000, sessionErrors: "caller"}`.

- [ ] Write red actual shell/module tests: normal password/TOTP/recovery, gesture-only modal passkey, Google return, generic refusal/throttle, same person/new session, changed rights and account without fiscal.view. Stub navigator.credentials, keep WebAuthn real; no enrollment-discovery request, synthetic login shortcut, logout or automatic evidence GET.
- [ ] Write red Stop before submission and after submitted password/passkey verification, accepted Set-Cookie with held/lost body, late failed login, unresolved reconciliation and second-login admission. Actual cookie identity governs refreshed rights; Stop produces zero reopened handles/reads and never claims accepted authentication was undone.
- [ ] Write red delayed old-body/401/activity/session/SSE/finally tests alongside current-callback controls; new rights/idle/busy stay unchanged, while stale decoded node.reset performs full reset. Exercise actual main.ts wiring and contribution rebuilds.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.reconcile-auth.test.ts src/dashboard-app.inspection-auth.test.ts src/inspection-auth.test.ts src/session-signals.test.ts` and separately kit `pnpm --filter @waitron/dashboard-kit exec vitest run src/auth-generation.test.ts src/request.test.ts src/live-connection.test.ts`; observe intended reds for missing behavior.
- [ ] Implement/qualify reply Task 3 shared fences before request 401/error/success/body/activity, observed-fetch revision, session probe/signal/idle/expiry and live connection effects. Rejections still reach their caller; decoded global `node.reset` bypasses stale/caller-error filters. Current callbacks must still work. RequestOptions adds signal/isCurrent/sessionErrors/activity without changing default GET **30000 ms** or ordinary POST no-default-deadline behavior.
- [ ] Track submitted identity promises synchronously before local checks; Stop closes/clears drafts and aborts unsent ceremonies only. Retain submitted work through settlement and one fresh session reconciliation, even on lost response. Block replacement sign-in while unresolved; offer explicit session Read again/Stop, no polling or assumed cached rights.
- [ ] Reuse explicit `beginViewerSignIn()` ordinary same-origin credentialed/no-store GET `/`, discard HTML, then reconcile. Only Sign in invokes it; inspection open/Read again/expiry/Stop cannot bootstrap or refresh mirror cookies. Keep ordinary mode/security protections and track this cookie-setting operation too.
- [ ] Keep only shell `InspectionReturn = {actionId: string; incidentId: string; returnFocus: HTMLElement | null; stopped: boolean}` across contribution rebuilds. Close old handles on auth change; unstopped permitted descriptor rebuilds exactly one empty `{initialRead: "explicit"}` handle. Stop/navigation/disconnect/reset discard descriptor/Google marker. No evidence survives or read replays; reconciliation after Stop may still change account.
- [ ] Repeat green through actual main.ts wiring, real cookie routes and #applyMe rebuild. Run unchanged `src/screens/login-screen.test.ts`, `src/dashboard-app.login-unsaved.test.ts`, `src/dashboard-app.module-screens.test.ts` through dashboard Vitest, and server `src/me-api.test.ts`. Stage coordinated paths; `git commit -s -m "feat: share reconciliation inspection authentication lifecycle"`.

## Task 5: Contribute the transient reconciliation panel

**Files:** Create module dashboard `src/dashboard/reconcile-{client,inspection,strings}.ts`, `reconcile-client.test.ts`, `reconcile-inspection{,.generations,.a11y}.test.ts`, `index.reconcile.test.ts`; modify `src/dashboard/index.ts`. Reuse kit contract/action validation and dashboard shell/bell/Alerts integration; create `apps/dashboard/src/dashboard-app.reconcile-inspection.test.ts`.
**Interfaces:** Reuse `DashboardIncidentAction = {id: string; codes: readonly string[]; labelKey: string; requiresPermission: string; create(ctx: DashboardModuleContext, incidentId: string, options?: {initialRead: "automatic" | "explicit"}): DashboardScreenHandle & {close(): void}}`, optional contribution `incidentActions` and optional context `inspectionAuth/permissionContinuation`.
`ReconcileEvidenceClient(request: DashboardRequest).read(incidentId: string, signal: AbortSignal, isCurrent: () => boolean): Promise<IncidentEvidenceEnvelope>` strictly validates envelope/available module value. Component `dashboard-fiscal-reconcile-inspection`: `client, incidentId, inspectionAuth, initialRead` (default automatic); `close(): void` aborts/clears/emits `inspection-closed` once.

- [ ] Write red action `fiscal-reconcile-inspect`, exact two codes, `fiscal_reconcile.inspect`, fiscal.view; event-only incident id passed by bell/open/handled Alerts. Other contributed actions remain; absent/disabled module/ongoing alerts get none; duplicate action IDs refuse. Shell holds handle outside list refresh lifetime.
- [ ] Write red exact rendered saved/current/reset/ack/cancellation/unavailable states and Review Focus 1–3 limits. No raw issuer/messages or current timestamp when association failed. Current acceptance/cancellation never hides saved discrepancy or implies agency resolution. Client rejects mismatched id/code, unknown wire enums/extra keys/depth/size.
- [ ] Write deferred fetch/body/current controls: `expect(newBusy).toBe(true)` after old finally, zero old facts after account change, Stop enabled while busy, fresh read paints/releases. Cover expiry, newer read, close/reopen, detach and unavailable current response; no clipboard/export/storage/evidence subscriptions.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/reconcile-client.test.ts src/dashboard/reconcile-inspection.test.ts src/dashboard/reconcile-inspection.generations.test.ts src/dashboard/index.reconcile.test.ts` and dashboard `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.reconcile-inspection.test.ts`; observe intended reds.
- [ ] Implement GET only with `{passive: true, timeLimitMs: 5000, signal, isCurrent, sessionErrors: "caller"}`. Normal opening reads once; post-sign-in empty panel waits for explicit Read again. New read aborts/increments/clears old facts. Own `{opening, read, auth}` across success/error/finally/expiry/close/reopen/detach; expiry timer from authorizedUntil clears without polling/touch. Already-expired answer is rejected.
- [ ] Implement Escape/Stop immediate closure and native focus return after the actual closure event; use native controls and userEvent for event-order assertions. Keep Stop enabled and create a new busy gate on reopen.
- [ ] Implement fixed EN/ES copy below using primitives/tokens and text bindings. Refusal/timeout offers applicable in-place Sign in, Read again and Stop, with no referral or invented repair. Absent auth host explains unavailable sign-in capability plus Stop. Mark handled stays outside inspection and retains acknowledgement behavior.
- [ ] Repeat green plus kit contract and existing alert action suites; stage Task 5 files and `git commit -s -m "feat: inspect retained reconciliation findings from alerts"`.

| EN                                                                                                                   | ES                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect evidence; Recorded finding; Current local facts                                                              | Examinar evidencia; Hallazgo registrado; Datos locales actuales                                                                       |
| Missing reference detected; Cancellation discrepancy detected                                                        | Referencia ausente detectada; Discrepancia de anulación detectada                                                                     |
| Unavailable; Issuer matches the associated local record                                                              | No disponible; El emisor coincide con el registro local asociado                                                                      |
| The first open finding is retained. Later findings may not be saved here.                                            | Se conserva el primer hallazgo abierto. Es posible que los posteriores no estén guardados aquí.                                       |
| Lookup period, full agency response, historical states and send history were not retained.                           | No se conservaron el período consultado, la respuesta completa de la AEAT, los estados históricos ni el historial de envíos.          |
| This timestamp records a queue reset. It does not prove another send.                                                | Esta fecha registra un restablecimiento de la cola. No demuestra otro envío.                                                          |
| Local cancellation and its saved acknowledgement do not verify the current agency outcome.                           | La anulación local y su acuse guardado no verifican el resultado actual ante la AEAT.                                                 |
| This inspection makes no fiscal changes. Persistent repair is unavailable here.                                      | Esta inspección no hace cambios fiscales. La reparación persistente no está disponible aquí.                                          |
| Read again; Sign in; Stop                                                                                            | Volver a leer; Iniciar sesión; Cerrar inspección                                                                                      |
| Stop closes inspection without stopping sales or filing. A submitted sign-in may still change the dashboard account. | Cerrar inspección no detiene las ventas ni los envíos fiscales. Un inicio de sesión ya enviado aún puede cambiar la cuenta del panel. |
| Mark handled acknowledges the alert. It does not repair the discrepancy.                                             | Marcar como atendida reconoce la alerta. No repara la discrepancia.                                                                   |

## Task 6: Qualify boundaries, deletion controls and guide twins

**Files:** Extend new owning suites only; modify `apps/server/src/guide/{en,es}/box-status.md`, dashboard `src/i18n/alert-messages.ts`; create `src/i18n/alerts.reconcile.test.ts` there. Both guides add shared `{#fiscal-reconcile-inspection}`; driver owns historical spec/backlog updates.
**Interfaces:** No new runtime API. All checks below are prospective, not executed by the author.

- [ ] Add red exact two-code alert copy tests, then replace only their referral/current-agency assertions: EN “A saved reconciliation finding reported a missing reference. Inspect the retained evidence.” / “A saved reconciliation finding reported a cancellation discrepancy. Inspect the retained evidence.” ES “Un hallazgo de conciliación guardado indicó una referencia ausente. Examina la evidencia conservada.” / “Un hallazgo de conciliación guardado indicó una discrepancia de anulación. Examina la evidencia conservada.” Leave drift_errores/unrelated codes unchanged.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.reconcile.test.ts` red then green after copy changes. Update both guides in second person with separate observation times, first-retained limits, missing association, reset/ack/cancellation/agency distinctions, account change, explicit Read again and Stop/Mark handled. No live fiscal caller or remedy promise.
- [ ] In an **installed disposable complete candidate checkout**, preserve uncommitted candidate files and frozen dependencies. Mutate each protection below independently; run its owning task command, retain named behavioral failure, restore and require green plus legitimate control. Never swap feature-worktree files or alter protected suites/fixtures.

| Owning task / independent deletion                          | Required failing assertion                                                   | Legitimate control                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1: substitute current facts for missing saved context       | exact five not_retained facts, original detection/identity unchanged         | valid saved invoice fields remain visible                     |
| 2: remove each source/sale/node/regime/SIF/triple gate      | no current/observedAt, safe saved retained                                   | exact own historical revoked-SIF record succeeds              |
| 2: select newest or suppress finding for any cancellation   | original saved identity/discrepancy remains, wrong/ambiguous current refused | own pending and accepted cancellation show separate send/ack  |
| 2: infer repeat send/agency acceptance from reset/ack       | repeatSend/agencyOutcome unverified in reset/lost-ack/accepted cases         | real stored state/reset actually changes between observations |
| 2: replace combined dispatcher/callback branches            | all five codes retain correct readers, absent callback seat_absent           | reconciliation-only and fully combined wiring                 |
| 3: hydrate before byte/depth bound                          | invalid raw input zero hydration/seat, no raw leak                           | exact boundaries/escaped strings accepted                     |
| 3: remove initial/final auth separately                     | initial zero lookup/seat; final 401/403 with no partial facts                | permitted current session succeeds                            |
| 3: restore touching/draining/ambient mirror behavior        | all-table/cookie/change-log unchanged, zero mutating calls                   | ordinary mirror bootstrap/cleanup still works                 |
| 3: allow cancelled queued/continuation work                 | zero selects/final callbacks after late release, deadline from boot          | independent writer and subsequent read finish                 |
| 4/5: drop shell/request/live/result/finally gate separately | new rights/idle/facts/busy unchanged by old callback                         | current callback paints/releases                              |
| 4: filter stale decoded node.reset                          | global full reset observed                                                   | stale ordinary 401 suppressed                                 |
| 4: forget submitted auth or replay rebuilt panel            | actual cookie identity, zero stopped handles/automatic GETs                  | unstopped permitted empty panel reads after explicit click    |

- [ ] Re-run Task 3 real boot/transport all-table snapshots and zero-call traps after restoration, including actual middleware and queued late work. Seed distinct PII/issuer/XML/key/raw-message sentinels in all refusal/success/timeout paths; absent from wire/DOM/logs/storage, including intermediate writes. Request diagnostics retain masked path/status/code only, never evidence payload.
- [ ] Run unchanged baselines: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reconcile.test.ts src/reconcile.period.test.ts src/acks.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts`; server `src/alerts.test.ts src/alerts-api.test.ts src/reconcile-duty.test.ts` through its package Vitest. Counts qualify those fake-agency/library cases only, never live AEAT or production reconciliation activation.
- [ ] Add red missing accessibility assertions before fixes; use `mountThemed`/`expectNoA11yViolations` for every distinct panel/refusal/sign-in state in both themes, restore locale. Run module `src/dashboard/reconcile-inspection.a11y.test.ts` via package Vitest plus shared shell auth axe suites. Measure browser headroom before concurrent Chromium.
- [ ] Through coordinated `wa-wt demo <worktree-name>`, LOOK at actual shell/panel in EN/ES × light/dark × **390/1280 px**. Check loading/unavailable/ambiguous/reset/pending/accepted/expired/sign-in/Stop busy/reopen, computed colors, overflow, keyboard/Tab/Enter/Escape, focus return and announcements; retain screenshots/focus/axe receipts.
- [ ] Run unchanged `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`. Inspect real built browser module; text guards alone do not qualify rendering or runtime boundaries.
- [ ] Review full execution-base-to-candidate prose/path diff; `git diff --exit-code <execution-base> -- <concrete-protected-paths>` must show protected production/fixtures/golden suites/guards/migrations byte-identical. Stage Task 6 paths; `git commit -s -m "docs: explain reconciliation evidence and remaining limits"`. Announce readiness for `finish-branch`; driver owns normal hook/current-head CI coverage, whole-branch review and separately authorized landing.

## One author self-review and handoff

Spec coverage: saved categories/identity/source/dedup/missing context → Contracts, Tasks 1/2/5/6; exact trusted association/current/reset/cancellation → Task 2; optional shared seat/action/module boundary → Tasks 2/3/5; raw bounds/fresh auth/whole boot budget/no writes → Task 3; single auth owner/submitted-cookie/explicit reconstruction/global reset → Task 4; result/busy/expiry fences/EN–ES/themes/guides → Tasks 5/6. Each Review Focus case has an owning test and deletion/accepting control.
One self-review checks signature consistency, all five dispatcher branches, build-order callbacks, host-only binding and no timestamp on failed current association. Publication checks are reread, path/status/diff inspection and `git diff --check` only; no tests, install, implementation, commit, push, subagents or external research in this firing.
**Gaps kept explicit:** absent history cannot be recovered; association may be unavailable; local acknowledgements do not verify agency outcome; persistent repair and production caller/authority/cadence remain OPEN. Timers cannot interrupt arbitrary synchronous SQLite/event-loop stalls; actual complete-request deadline/no-late-work measurements are release requirements, not inferred guarantees. Failure to meet them blocks release rather than relaxing five seconds.
The driver obtains the fresh review next and coordinates shared ownership before the already-authorized inline read-only build. No additional owner scope/build question is required.
