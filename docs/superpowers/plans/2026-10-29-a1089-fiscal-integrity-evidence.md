# A1089 Fiscal Integrity Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement task-by-task, inline. Steps use checkbox (`- [ ]`) syntax. No routine subagents.

**Goal:** Inspect saved predecessor-check issues and local validation warnings, with sign-in, Read again and Stop, while persistent repair remains **OPEN**.

**Architecture:** Reuse the reply plan's proposed generic incident endpoint and optional fiscal evidence seat. The regime validates saved evidence and proves operation-specific association before exposing separately timed current facts. Reuse one shell-owned authentication continuation and generation across requests, connections and panels.

**Tech Stack:** Existing TypeScript, Hono, Drizzle/node:sqlite, Lit, dashboard-kit, `wt-*`, Vitest, `useVenueDb`, Chromium and axe; no dependencies or migrations.

**Spec:** [complete integrity design](../specs/2026-10-29-a1089-fiscal-integrity-recovery-design.md), [audit](../../backlog/self-service-refusals.md#fiscal-integrity), [backlog](../../backlog.md).
Owner **2026-10-29 01:58** chose evidence-first A for all five areas. The newer **08:07** instruction authorizes read-only BUILD after fresh plan review, with sign-in, Read again and Stop. Do not ask another scope/build question.
This firing publishes **one plan only**. The driver supplies the fresh reviewer and dated historical-spec/backlog pointers; the historical proposal remains intact.

## Global Constraints

- Running-dashboard inspection only. Persistent repair, whole-chain auditing and missing-history recovery remain **OPEN**; this does not complete A1089 or W41s-8/W41s-9.
- Distinguish `chain.verification_failed` from `fiscal.record_flagged`. The saved check concerns at most the last two predecessor rows, never the whole chain/every column. Its checked count is unknown; issue count is not checked count.
- Expected/found are detection-time comparisons from then-stored inputs, never proposed repairs. Software/validator versions are unknown unless retained. No revalidation, `checkIntegrity`, `verifyChain` or hash recomputation during inspection. Agency outcome stays unverified.
- Inspection/Read again/Stop make no writes, acknowledgement, session stamp, change-log drain, fiscal writer/drain, client construction, AEAT request, retry, number allocation, reset, restore or configuration change. Sign-in is a separate authorized identity operation.
- Require `fiscal.view` before lookup and fresh final authorization, including expiry, suspension/revocation and identical session row/person. Resolve with `touch: false`. Host reads are select-only, no queue, transaction or drain; they are not an atomic snapshot.
- **5000 ms** covers earliest real boot admission, mirror/promotion/session middleware, every wait/read and final authorization/serialization. Cancellation prevents late queued reads/writes, results and busy releases. The read-only gate precedes mutating middleware.
- Memory only; `Cache-Control: no-store` on success/refusal. No polling, export, clipboard, evidence URL/storage/cache, PII, invoice identities, raw payload/XML/messages/log dumps or arbitrary text. Render bounded projected structures as text.
- Preserve fiscal production writers, chains, invoice allocation, golden/protected tests, existing fixtures/assertions, guards and migrations byte-identical. No server fiscal imports/SQL or import-allowlist growth.
- Read TDD before future code; each task observes intended red, minimal implementation, green and `git commit -s`. Keep hooks; focused local checks and current-head CI coverage follow repository policy.
- A696/A739/A803/A1155 and Lane B recovery own actual shared paths. Coordinate current reservations/diffs before execution; this plan reserves none. No campaign/global edits.

## Review Focus

1. Sale and void incidents can deduplicate on the same sale: Task 2 preserves the first saved issue and refuses an ambiguous event instead of selecting the newest row.
2. A predecessor may belong to a different sale, or be missing now: Tasks 1/2 retain safe saved facts independently of current association.
3. Equal-length warning arrays can silently lose their pairing through sorting: Tasks 1/5 preserve each original positional pair, including unknown labels.
4. Permission loss or promotion can occur before a handler or during final authorization: Task 3 denies evidence without session/queue/drain side effects.
5. Stop after submitted sign-in may still accept a cookie, while old callbacks arrive: Tasks 4/5 reconcile actual identity, require explicit Read again and fence stale effects without suppressing global `node.reset`.

---

## Source orientation and file map

Inspected at `024e0459e07687256ff152c0f05ed23019cef7b5`; these are source readings, not runtime qualification. Re-read after coordinated rebase.

| Boundary             | Actual source and implication                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partial check        | `packages/fiscal-verifactu/src/verify.ts:50` selects last two by node sequence; `:66/:88/:93` produce the three issue kinds. `packages/core/src/errors.ts:132` stores issues without `checked`.                      |
| Detecting operations | Core `src/record-sale.ts:203/:330`, `record-correction.ts:236/:283`, `record-substitution.ts:147/:196` attach to the newly issued sale; `record-void.ts:49/:75` attaches to the voided sale and writes `sale_voids`. |
| Fiscal association   | Module `src/backend.ts:270/:387/:464/:566` append sale alta, void anulación, corrective R5 and substitution F3. Void generation uses the backend clock, separately from core's wall-clock detection.                 |
| Saved warning        | Module `src/chain.ts:186/:242/:248/:257` validates at generation, saves ordered fields/codes without exact record id; `src/errors.ts:105` declares it. Read neither validator messages nor raw field values.         |
| Membership           | `packages/db/src/schema/sales.ts:65/:334`, `schema/sale-voids.ts:13`; module `src/schema/registros.ts:25` holds node, SIF, sale, sequence and the four-part predecessor pointer.                                     |
| Dedup/handling       | Core `src/incidents.ts:95/:267/:307`, DB `schema/incidents.ts:69`; first open incident survives conflicts. Acknowledge stays separate from inspection.                                                               |
| Host/auth            | Server `src/boot.ts:1097/:1664/:1684`, `mirror-session.ts:120`, `me-api.ts:326`; identity `src/management-session.ts:47`; DB `src/tenancy.ts:35` drains even a read transaction.                                     |
| Browser              | Kit `src/{contract,request,live-connection}.ts`; dashboard `src/{main,dashboard-app,session-signals,api/client}.ts`; `widgets/alert-format.ts:29` extracts an event incident id.                                     |

Create module `src/integrity-evidence-contract.ts` (safe wire/parser), `src/integrity-evidence.ts` (saved projection), `src/integrity-evidence-association.ts` (bounded current association), `src/incident-evidence.ts` (combined module dispatch), and dashboard `src/dashboard/integrity-{client,inspection,strings}.ts`.
Shared generic/server/auth/action files below are dependencies to implement or qualify once, not duplicate implementations. Read the full [reply plan](2026-10-29-a1089-fiscal-reply-evidence.md), [environment plan](2026-10-29-a1089-fiscal-environment-evidence.md) and [certificate plan](2026-10-29-a1089-aeat-certificate-diagnosis.md).

## Proposed shared and integrity contracts

**Shared canonical contract:** reuse reply-plan `FiscalEvidenceJson`, `FiscalEvidenceIncident`, `EvidenceReader = Pick<Transaction, "select">`, `EvidenceReadControl = {signal: AbortSignal; check(): void; yield(): Promise<void>}`, `FiscalIncidentEvidenceSeat` and `IncidentEvidenceEnvelope`, with the single detection-time addition in Task 1. They are **PLANNED**, absent at this inspection base.
Seat: `{codes: readonly string[]; read(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<FiscalIncidentEvidence>}` on optional `FiscalContribution.incidentEvidence`. Generic unavailable reasons remain `seat_absent | missing | unreadable | invalid | association_mismatch`; available wraps opaque JSON `value`.
Envelope: `{schemaVersion: 1; incident: {id: string; code: string; detectedAt: string}; handling: {observedAt: string; handledAt: string | null}; evidence: FiscalIncidentEvidence; authorizedUntil: string}`. Handling has its own observation time; no notes/person/device names enter it.
**GET `/management-api/alerts/incidents/:id/evidence`** accepts only one UUID, no query/body/options. Malformed request: `management.request_invalid` 400; missing/unsupported incident with a present seat: `alert.not_found` 404; absent/disabled seat: authorized unavailable envelope. Registry claim permission supplements `fiscal.view`.
The module's **one combined dispatcher** declares exact codes `fiscal.respuesta_descuadrada`, `chain.verification_failed`, `fiscal.record_flagged`, routing reply to its proposed reader when supplied and the latter two to this reader. It must validate source/origin/regime binding per branch; code prefix alone is never binding. Environment's dedicated seat remains independent.
The optional reply callback allows integrity to build before the reply reader without implementing reply behavior here; absent callback returns `seat_absent`. When the reply reader lands, slot wiring supplies it to this same dispatcher, never replaces the integrity codes.

Module browser-safe JSON types in `integrity-evidence-contract.ts`:

```ts
type UnknownFact = { state: "unknown"; reason: "not_retained" };
type SafeId = { state: "known"; value: string } | { state: "unavailable" };
type HashFact = { state: "known"; value: string } | { state: "unavailable" };
type SavedIssue = {
  position: number;
  kind: "predecessor-hash-mismatch" | "predecessor-link-mismatch" | "predecessor-missing" | "unknown";
  claimedPredecessorId: SafeId;
  comparison: { state: "pair"; expected: HashFact; found: HashFact } | { state: "none" };
};
type WarningPair = {
  position: number;
  field: "generation-time" | "regime-code" | "unknown";
  lineIndex: number | null;
  code: "FECHA_HORA_FUTURE" | "CLAVE_REGIMEN_REQUIRED" | "CLAVE_REGIMEN_VALUE" | "unknown";
};
type AssociationUnavailable = { state: "unavailable"; reason: "missing" | "unreadable" | "invalid" | "association_mismatch" | "ambiguous" | "record_id_not_retained" };
type CurrentIntegrity = { observedAt: string; scope: "stored-event-predecessor" } & (
  | AssociationUnavailable
  | {
      state: "available";
      operation: "sale" | "correction" | "substitution" | "void";
      eventRecordId: string;
      predecessorRecordId: string;
      nodeId: string;
      eventSequence: number;
      predecessorSequence: number;
      eventHash: HashFact;
      eventPredecessorHash: HashFact;
      predecessorHash: HashFact;
    }
);
type IntegrityEvidence = {
  kind: "integrity";
  category: "predecessor-check" | "local-validation";
  retained: {
    source: "incident.params";
    retainedAt: string;
    retention: "first-open-incident";
    scope: "last-two-predecessor-check" | "generation-time-local-validation";
    checkedCount: UnknownFact;
    softwareVersion: UnknownFact;
    validatorVersion: UnknownFact;
    details: { state: "available"; issues: readonly SavedIssue[]; warnings: readonly WarningPair[] } | { state: "unavailable"; reason: "invalid" };
  };
  current: CurrentIntegrity;
  agencyOutcome: "unverified";
};
```

All timestamps are validated ISO UTC strings. Positions are 1-based retained positions. Known UUIDs are labelled **claimed** until association; no sale/customer/invoice details are projected. Current fields describe stored columns only, without recomputing hashes or judging integrity.
Fixed limits: raw params **1,048,576 UTF-8 bytes**, JSON nesting **16**, chain issues **1..64**, paired warnings **1..128**, issue code **128** characters, warning field **256**, warning code **128**. Reject structures beyond limits without truncation. Hash known only for exact `/^[0-9A-F]{64}$/`, rejecting NUL/controls and extra characters.
The integrity wire projection is capped at **131,072 UTF-8 bytes** before server serialization release; overflow returns sanitized unavailable/invalid. Reject a wire arm with extra keys, invalid timestamps, mismatched category/scope or nonempty opposite-kind details. Chain details contain issues and empty warnings; local-validation details contain warnings and empty issues.
Chain requires exact top keys `deviceId, issues`; issue keys `issueCode, recordId, issueParams`. Validate params device equals incident device. Recognized mismatch params have exactly `expected, found`; validate each independently, preserve recognized kind/id when a hash is invalid. Missing-predecessor params must be empty and emit `comparison: none`. Unknown bounded issue codes emit fixed `unknown`, no params echo/current lookup.
Warnings require exact top keys `fields, codes`, both arrays of equal permitted length, all bounded strings. Zip in saved order **before** label projection, never sort/filter independently. Map exact `FechaHoraHusoGenRegistro` to `generation-time`; `Desglose[n].ClaveRegimen` to `regime-code` with `n` an integer **0..999**; all other fields/codes become fixed `unknown`, no raw label echo.
Two well-formed swapped saved labels cannot be authenticated against missing original metadata; promise positional preservation, not tamper detection. Malformed pairs make details invalid, never guessed pairs. Unknown detection versions/count remain unknown even when today's runtime can supply values.
Host raw-input refusal yields generic unavailable without a module call. Within bounded readable input, invalid details/current association still return permitted sanitized retained evidence in the available integrity projection; never discard valid issues because another issue lacks linkage.

## Task 0: Coordinate review and execution dependencies

**Files:** Read-only current runner reservations, full spec/audit and three shared plans. Driver owns historical pointers/backlog.
**Interfaces:** The reply plan's newer combined auth/server decisions below resolve sibling proposals without introducing another owner.

- [ ] Obtain the required fresh plan review; execute the already-authorized read-only build only after that review and actual shared-file coordination. Record execution-base SHA.
- [ ] Compare A696/A739/A803/A1155/Lane B recovery candidate diffs and callers. Reuse compatible qualified shared work or implement it inline when released. Keep this plan's runtime file map as proposed, not a reservation.

## Task 1: Parse saved issues and warning pairs without interpretation drift

**Files:** Create/reuse fiscal `src/incident-evidence-types.ts`; modify fiscal `src/{contribution,index}.ts` for the shared contracts. Create module `src/integrity-evidence-contract.ts`, `src/integrity-evidence-contract.test.ts`, `src/integrity-evidence.ts`, `src/integrity-evidence.test.ts`.
**Interfaces:** `parseIntegrityEvidence(value: unknown): IntegrityEvidence` validates the wire union; `projectSavedIntegrity(incident: FiscalEvidenceIncident): IntegrityEvidence["retained"]` projects bounded saved input.
Extend shared `FiscalEvidenceIncident` once with required `detectedAt: string`; core's bounded reader supplies it, never the browser. Update proposed reply adapter/test call sites deliberately. Export the browser-safe JSON types type-only through fiscal index; define the DB-dependent EvidenceReader in contribution.ts.

- [ ] Write red `keeps all three saved issue kinds distinct`: exact whole-object assertions for hash mismatch, link mismatch and missing predecessor; expected/found survive unchanged, missing has no pair, checked/version facts are `unknown/not_retained`. Unknown kinds and malformed/null IDs never authorize lookups.
- [ ] Write red `zips warnings before projecting labels`: two deliberately different field/code positions, reversed arrays and swapped codes retain their respective original positions; unequal/null/oversize arrays are invalid. Unknown labels containing HTML/PII sentinel strings yield only fixed unknown. Exact boundary lengths/recognized pairs remain accepted.
- [ ] Write red malformed/control/NUL/lowercase/63/65-character hashes and extra keys: retain safe recognized kind/id and independent valid hash only; no raw string/exception reaches the complete wire object. Invalid structures cannot masquerade as empty successful checks.
- [ ] Pin these assertions in the named cases, using fixture-generated IDs and the complete expected safe object alongside them:

```ts
expect(saved.details).toEqual({ state: "available", issues: expectedIssues, warnings: [] });
expect(saved.checkedCount).toEqual({ state: "unknown", reason: "not_retained" });
expect(saved.softwareVersion).toEqual({ state: "unknown", reason: "not_retained" });
expect(saved.validatorVersion).toEqual({ state: "unknown", reason: "not_retained" });
expect(warningDetails.warnings).toEqual([
  { position: 1, field: "regime-code", lineIndex: 7, code: "CLAVE_REGIMEN_VALUE" },
  { position: 2, field: "generation-time", lineIndex: null, code: "FECHA_HORA_FUTURE" },
]);
expect(missingIssue.comparison).toEqual({ state: "none" });
expect(JSON.stringify(answer)).not.toContain(privateSentinel);
```

- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/integrity-evidence-contract.test.ts src/integrity-evidence.test.ts`; observe intended missing-parser/projector assertion failures, not loader/setup failures.
- [ ] Implement the strict parsers/projection and closed labels above. Validate readable object bounds before expansion. Never obtain installed library/build versions, invoke a validator or reconstruct missing evidence.
- [ ] Repeat the same command to green with actual Tests counts; stage only Task 1 paths and `git commit -s -m "feat: project retained fiscal integrity evidence"`.

## Task 2: Prove operation and predecessor membership before current detail

**Files:** Create module `src/integrity-evidence-association.ts`, `src/integrity-evidence-association.test.ts`, `src/incident-evidence.ts`, `src/incident-evidence.test.ts`; extend new `src/integrity-evidence.test.ts`; modify only evidence wiring in `src/slot.ts` and add new `src/slot.integrity-evidence.test.ts`.
**Interfaces:** `readIntegrityEvidence(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<FiscalIncidentEvidence>`; `readIntegrityAssociation(reader: EvidenceReader, incident: FiscalEvidenceIncident, saved: IntegrityEvidence["retained"], control: EvidenceReadControl): Promise<CurrentIntegrity>`.
`createIncidentEvidenceSeat(replyReader?: FiscalIncidentEvidenceSeat["read"]): FiscalIncidentEvidenceSeat` creates the combined dispatcher in `src/incident-evidence.ts`; its read closure uses `readIntegrityEvidence`. Slot supplies the qualified reply reader when present; absent reply callback returns `seat_absent` for that code without disabling integrity. No unimplemented import is required.

- [ ] Write red `binds each detecting operation, not the newest sale record` with real `useVenueDb({migrations: TEST_MIGRATIONS})`, current module seed helpers and core operations plus real backend. Cover sale/correction/substitution/void, and all four sale origins `device/demo_seed/readiness_test/operator_script`. Install inspection traps only after fixture recording.
- [ ] Assert source/device match the event sale's stored origin, `sales.fiscalBackend === "verifactu"`, sale node exists, and chain params device equals incident device. Fiscal-filing/dashboard/wrong-device/wrong-regime integrity bindings get current `association_mismatch` and zero fiscal reads, retaining permitted sanitized saved facts. The active enabled seat, never `chain.` prefix ownership, interprets core-owned chain incidents. Reply's branch separately requires `fiscal_filing` and its own reader's full membership checks.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/integrity-evidence-association.test.ts src/incident-evidence.test.ts src/slot.integrity-evidence.test.ts`; observe intended absent-association/dispatch failures.
- [ ] Implement bounded **association-only** selects first, selecting explicit scalar columns, never `.select()`/JSON payloads. Use the following operation map; count candidates with limit **2**, not ORDER BY newest. An old historical SIF need not equal the current installation.

| Detecting operation | Required retained/core and event facts                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sale                | `sale.issuedAt === incident.detectedAt`, no `correctsSaleId`, no substitution membership; unique `alta` of that sale, type F1/F2, generated instant equals issuance.                                                             |
| Correction          | Same detection/issuance equality on the **corrective** sale, non-null `correctsSaleId`, no substitution membership; unique own `alta`, type R5. Never choose the corrected sale's alta.                                          |
| Substitution        | Same equality on the **F3** sale, null correction link, substitution membership exists; unique own `alta`, type F3. Never choose a substituted ticket. Membership existence uses limit 1, not an unbounded member list.          |
| Void                | `sale_voids.saleId === incident.saleId` and `voidedAt === incident.detectedAt`; unique own `anulacion` plus original alta. Do not equate backend generation time with core detection time or use sale issuance to choose a void. |

- [ ] Require exactly one eligible operation/event across that map; zero returns missing/association_mismatch, multiple returns ambiguous. Multiple distinct predecessor IDs return ambiguous; any unknown issue/null/invalid ID returns invalid current association. Preserve all safe saved entries in either case. Only a fully recognized list naming one immediate predecessor permits current proof; never substitute the event record.
- [ ] For that event and claimed predecessor, require same node and historical SIF whose node matches; predecessor sequence is a positive safe integer and event sequence equals it plus **1**. Require event `primerRegistro === false` and exact four-part predecessor identity (issuer, invoice number, date, hash) against predecessor columns. Compare identities internally, never project them. A predecessor's sale **may differ**. No second-predecessor read or chain walk is authorized.
- [ ] Only after proof, select allowlisted current event/predecessor hash/sequence facts by exact verified IDs; record their observation time. Check association again on the selected scalar rows before projection. Check control before/after every select and `await control.yield()` between bounded phases. No `execute`, writer capability, chain head, computed hash or current filing-client construction.
- [ ] Write red wrong-node/sale/SIF/source/sequence/pointer/hash, two candidates, missing event/predecessor and malformed current hash cases; assert `current.state === "unavailable"` with exact reason **and unchanged saved issues**. Positive control: another-sale predecessor and old SIF return available; missing n−2 remains only a saved issue, no invented pair/check count.
- [ ] Write red `warning has no exact record id`: valid warning always returns `record_id_not_retained`, zero fiscal-row reads even with one apparent same-sale/timestamp match. A sales/origin binding failure never removes otherwise safe warning pairs. Record no guessed id in wire/DOM.
- [ ] Write red `first retained incident survives later detection`: record two incidents using real `recordIncident`/dedup on one sale, including sale then void; second issues cannot replace first. Mark handled separately then reread; only separately timed handling changes. Mixed provable/unprovable saved issues retain all safe entries.
- [ ] Pin association assertions, including legitimate accepting controls:

```ts
expect(missing.current.state).toBe("unavailable");
expect(missing.retained.details).toEqual(firstRetainedDetails);
expect(verified.current).toMatchObject({ state: "available", eventRecordId, predecessorRecordId });
expect(warning.current).toMatchObject({ state: "unavailable", reason: "record_id_not_retained" });
expect(fiscalSelectsDuringWarning).toBe(0);
expect(verifyChainTrap).not.toHaveBeenCalled();
expect(validatorTrap).not.toHaveBeenCalled();
```

- [ ] Repeat focused commands plus `src/integrity-evidence.test.ts` and unchanged `src/slot.test.ts`; require green counts and zero validator/verification/client calls during reads. Stage Task 2 paths; `git commit -s -m "feat: bind integrity observations to their detecting operation"`.

## Task 3: Qualify the one generic route from real boot admission

**Files:** Reuse/create reply-plan fiscal `src/incident-evidence-types.ts`, `src/{contribution,index}.ts`; server `src/incident-evidence-{api,read}.ts`, `src/{boot,mirror-session,errors,me-api}.ts`; core `src/{incidents,index}.ts`. Add server `src/incident-evidence.integrity.test.ts`, `src/boot.integrity-evidence.test.ts`; extend new shared `incident-evidence-{api,read}.test.ts`, `incident-evidence.transport.test.ts` and core `src/incident-evidence.test.ts`.
**Interfaces:** Reuse `mountIncidentEvidenceApi(app: Hono, deps: {db: Database; seat?: FiscalIncidentEvidenceSeat; registry: AlertRegistry; now(): Date}, log: Logger): void`, `readIncidentEvidenceTurn<T>(db: Database, control: EvidenceReadControl, read: (reader: EvidenceReader) => Promise<T>): Promise<T>` and `createEvidenceReadControl(signal: AbortSignal, startedAt: number): {control: EvidenceReadControl; dispose(): void}` from reply Task 2. Add no dedicated integrity endpoint.

- [ ] Write red exact route/envelope cases through real composition: both integrity codes, open/handled, missing/invalid UUID, query/body, absent/disabled seat, unbound source/regime, unavailable association retaining saved facts. Authorize `fiscal.view` before even metadata lookup, registry permission before dispatch and again before release. No generic regime imports/SQL/code allowlist.
- [ ] Before Drizzle JSON hydration, implement/qualify shared `findBoundedIncident(tx, id, {maxParamsBytes: 1048576, maxJsonDepth: 16})` and metadata-only `readIncidentHandling(tx, id)` from reply Task 2. Fetch length via `length(cast(params as blob))`; bounded CASE fetches raw text, repeating bounds on a second select. Scan nesting iteratively respecting strings/escapes **before JSON.parse**; never first select the JSON-mapped column or stringify hydrated input.
- [ ] Add red real-storage **1,048,577-byte**, malformed JSON, nonobject, depth **17** and valid exact-byte/depth-16/escaped-brace controls. Assert zero hydration/seat calls for invalid input, metadata-only handling still works and no raw params/parse exception reaches logs/wire.
- [ ] Add red authorization before lookup and after held seat/final check: missing/expired/revoked/suspended and rights loss, same-person replacement session, actual expiry while reading. Exact 401/403, zero initial seat calls, final denial contains no partial saved/current evidence; final no-touch expiry supplies `authorizedUntil`.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/incident-evidence.integrity.test.ts src/boot.integrity-evidence.test.ts src/incident-evidence-read.test.ts src/incident-evidence.transport.test.ts` and core `src/incident-evidence.test.ts`; observe intended reds before implementing shared gaps.
- [ ] Install the fixed 5000-ms monotonic control/no-store at the earliest applicable boot admission **before** mirror/session queues and mutating middleware. Preserve origin/security/mode gates; read-only gating stays earlier than mutations. Reuse `isInspectionRead(method,path)` for only generic evidence GET and session-me GET, including invalid ids' no-write admission.
- [ ] Qualify reply's optional fifth `mirrorSession` dependency: diagnostic reads never stamp/revive/inject cookies or perform promotion cleanup. Absent/ended/expired viewer refuses; valid-overdue viewer reads unchanged; promoted viewer refuses `management_session.required` without cookie clearing/session end. Ordinary mirror bootstrap/keepalive/promotion cleanup still work as controls.
- [ ] Keep reads outside `withTransaction`, `withWriteLock`, session attempt turns and write queue. Race admission/seat/final auth/body against the **same** deadline and request/socket cancellation. Timeout returns sanitized `diagnostics.read_timed_out` 504 with `{deadlineMs: 5000}`; no partial facts. Every next select checks cancellation; never queue deferred work that can execute later. Observe late promises/dispose timers/listeners within **1000 ms** without extending response authority.
- [ ] Hold writer, admission, seat and final auth separately; abort at each phase and release later. Assert `selectsAfterCancellation === 0`, no late queued writes/final authorization/response and a fresh subsequent read succeeds. Check actual listening transport disconnect using one `freePorts(n)` draw, not only synthetic Request.signal.
- [ ] Use actual boot mirror/promotion/session-me/evidence paths with pending change log and held writer. Compare **all-table logical snapshots**, including records, SIF/chains, envíos/attempts, counters, incident handling/notes and session stamps; `expect(after).toEqual(before)`. Trap mutating statements plus notifications to catch write-then-restore, and zero ack/drain/AEAT/validator/verification/client construction after fixture setup. Deliberate revocation writes are accounted for separately.
- [ ] Repeat green plus unchanged server `src/alerts.test.ts src/alerts-api.test.ts src/mirror-session.test.ts src/me-api.test.ts`; stage coordinated Task 3 paths and `git commit -s -m "feat: serve integrity evidence through no-touch admission"`.

## Task 4: Reuse and qualify one real authentication owner

**Files:** Shared reply Task 3 paths: dashboard `src/{permission-continuation,inspection-auth,session-signals,main,dashboard-app,api/client,screens/login-screen}.ts`, `src/i18n/{strings,codes}.ts`; kit `src/{auth-generation,index,contract,request,live-connection}.ts`; server session-me from Task 3. Add dashboard `src/dashboard-app.integrity-auth.test.ts`; qualify shared auth/request/live tests, no competing controller.
**Interfaces:** `SessionEpoch.current/advance/subscribe` owns the sole shell `sessionGeneration`; kit `AuthGeneration.capture/invalidate/isCurrent/subscribe` delegates to it. `PermissionContinuation` owns `snapshot/subscribe/signIn/trackAuthentication/requestSignIn/stop/reconcile`; `InspectionAuthController` is its adapter, exactly as reply Task 3 reconciles the environment/certificate proposals.
`DashboardApi` retains fifth `passive`, sixth optional `{sessionGeneration?: () => number}` propagated to background clients. `getMe(options?: RequestOptions)` returns `sessionIdentity` from sessionRowId through Task 3's no-touch/no-drain route. `DashboardModuleContext.inspectionAuth` and `permissionContinuation` share this owner.

- [ ] Write red actual-shell login/factor and cookie cases: password, TOTP/recovery, explicit modal passkey, Google return, normal generic refusal/throttle, same-person new session, account lacking `fiscal.view`. Keep `navigator.credentials` stubbed and WebAuthn real; no enrolment-discovery query or logout shortcut.
- [ ] Write red Stop before/after submitted password/passkey verification, Set-Cookie before held/lost response, late failed login, unresolved reconciliation and second sign-in admission. Assert actual cookie identity adopted, protected facts cleared, zero replay/reopening after Stop and no assumed cancellation of an accepted sign-in.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.integrity-auth.test.ts src/dashboard-app.inspection-auth.test.ts src/inspection-auth.test.ts src/session-signals.test.ts` and kit `src/auth-generation.test.ts src/request.test.ts src/live-connection.test.ts`; observe intended reds for any missing shared behavior.
- [ ] Implement/qualify request options `{signal, isCurrent, sessionErrors: "caller", activity: "none"}`, preserving defaults: GET **30000 ms**, ordinary POST no default deadline. Fence request success/error/body/activity, observed-fetch revisions, shell probes/idle/expiry, session signals and live callbacks before effects. Always dispatch decoded global `node.reset` before stale/caller-error filters. Current callbacks still apply.
- [ ] Track submitted authentication synchronously in the one settlement registry before local guards. Stop closes/clears drafts, aborts unsent ceremonies and invalidates generations, but retains submitted work through settlement and one fresh passive session reconciliation. Unresolved identity offers explicit session Read again/Stop, blocks replacement sign-in, never polls/replays/logs out.
- [ ] Reuse reply `beginViewerSignIn()` only on an explicit Sign in gesture: ordinary same-origin GET `/` with credentials/no-store, discard HTML, then no-write session reconciliation. Inspection open/Read again/expiry/Stop never bootstrap a mirror viewer. Ordinary mode/security gates still govern that separate identity operation.
- [ ] Shell retains only `InspectionReturn = {actionId: string; incidentId: string; returnFocus: HTMLElement | null; stopped: boolean}`. Close old handles on auth changes; rebuild exactly one **empty permitted** handle with `{initialRead: "explicit"}` only for an unstopped descriptor. No GET before Read again; navigation/disconnect/Stop/reset discard descriptor and Google return marker.
- [ ] Repeat green plus unchanged login/login-unsaved/module-screen and server me suites. Include real `main.ts` wiring and `#applyMe` contribution rebuilds; stale 401/activity/live/finally cannot affect the new account, while stale decoded `node.reset` still resets it. Stage coordinated paths; `git commit -s -m "feat: share integrity inspection authentication lifecycle"`.

## Task 5: Contribute the bounded integrity panel and action

**Files:** Create module dashboard `src/dashboard/integrity-{client,inspection,strings}.ts`, `integrity-client.test.ts`, `integrity-inspection{,.generations,.a11y}.test.ts`; modify dashboard `index.ts` and add `index.integrity.test.ts`. Reuse kit `contract.ts` incident actions; dashboard `dashboard-app.ts`, `widgets/{alert-format,alerts-bell}.ts`, `screens/alerts-screen.ts` shared action integration; add `src/dashboard-app.integrity-inspection.test.ts`.
**Interfaces:** Reuse `DashboardIncidentAction = {id: string; codes: readonly string[]; labelKey: string; requiresPermission: string; create(ctx: DashboardModuleContext, incidentId: string, options?: {initialRead: "automatic" | "explicit"}): DashboardScreenHandle & {close(): void}}` and optional contribution `incidentActions` from reply/environment; no second alert destination system.
`IntegrityEvidenceClient(request: DashboardRequest).read(incidentId: string, signal: AbortSignal, isCurrent: () => boolean): Promise<IncidentEvidenceEnvelope>` validates the envelope, requested id/code and available `IntegrityEvidence`. `dashboard-fiscal-integrity-inspection` properties: `client`, `incidentId`, `inspectionAuth`, `initialRead` (default `automatic`); `close(): void` aborts/clears/emits `inspection-closed` once.

- [ ] Write red action tests: `fiscal-integrity-inspect`, exact two integrity codes, label key `fiscal_integrity.inspect`, `fiscal.view`; disabled/absent modules/ongoing alerts get no action. Bell/open/handled Alerts pass incidentId only, other modules' actions remain and duplicate action IDs refuse. Shell owns handle beyond list refresh lifetime.
- [ ] Write red exact rendered saved-chain versus local-warning states, missing/invalid/ambiguous current association with retained safe details, unknown versions/counts, missing-predecessor no-pair and no warning record ID. Never render whole-chain proof, agency acceptance or expected hash as replacement; unknown labels are fixed localized text.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/integrity-client.test.ts src/dashboard/integrity-inspection.test.ts src/dashboard/integrity-inspection.generations.test.ts src/dashboard/index.integrity.test.ts` and dashboard `src/dashboard-app.integrity-inspection.test.ts`; observe intended red.
- [ ] Implement one GET using `{passive: true, timeLimitMs: 5000, signal, isCurrent, sessionErrors: "caller"}`. Each opening/read/account generation owns success/refusal/expiry/finally. Read again aborts/increments/clears old evidence; Stop remains enabled while busy, closes immediately, and stale close/detach/reopen callbacks neither repaint nor release a newer gate. Subscribe only to auth invalidation, not evidence polling/live refresh.
- [ ] Arm one generation-owned expiry timer from `authorizedUntil`; reject already-expired envelopes and clear evidence when it elapses, without a session touch or automatic GET. Clear/dispose that timer on replacement/Stop/detach. Current unavailable observations retain their scope/time without implying a successful record read.
- [ ] Use exact EN/ES labels: **Inspect evidence / Examinar evidencia**, **Saved at detection / Guardado al detectar**, **Local validation warning / Aviso de validación local**, **Agency outcome unverified / Resultado ante la AEAT sin verificar**, **Current stored observations / Observaciones almacenadas actuales**, **Unavailable / No disponible**, **Ambiguous association / Asociación ambigua**, **Read again / Volver a leer**, **Stop / Cerrar inspección**.
- [ ] Show incident id/detection separately from current `observedAt`/scope and handling observation. Explain first retained evidence may omit later observations. Explain expected hash uses then-stored inputs, link mismatch compares stored hashes, and missing predecessor supplies no pair. No successful current observation means repaired/accepted. Keep unknown software/validator/check count explicit.
- [ ] Explain Stop closes inspection without stopping filing/sales; submitted sign-in may still change the account. Offer in-place Sign in when needed, Read again and Stop after refusal/timeout; absent auth hook explains unavailable capability. Reconstructed sign-in panel starts awaiting-read. Existing Mark handled stays separate and explicitly acknowledges only, never repairs or clears proof.
- [ ] Add deferred fetch/body races for old success/error/finally after Stop/reopen/new read/expiry/account change. Assert `stopButton.disabled === false`, no old DOM facts, newer busy remains true; current response then paints/releases. Use real native buttons, `userEvent`, actual closure event and focus return. Repeat green plus owning alert/kit contract suites; stage Task 5 paths; `git commit -s -m "feat: inspect fiscal integrity evidence from alerts"`.

## Task 6: Qualify the limits, deletion controls and guide twins

**Files:** Extend only new owning suites; modify `apps/server/src/guide/{en,es}/box-status.md` with shared `{#fiscal-integrity-inspection}`, dashboard `src/i18n/alert-messages.ts` and add `src/i18n/alerts.integrity.test.ts`. No guard/migration/protected test edits.
**Interfaces:** No new runtime API. Driver owns historical spec/audit/backlog updates.

- [ ] Write red two-code wording tests, remove support-only/product-bug/agency-acceptance claims. Exact EN chain: “A saved predecessor check reported an issue. Inspect the retained evidence; this was not a whole-chain audit.” ES: “Una comprobación de predecesores guardada indicó un problema. Examina la evidencia conservada; no fue una auditoría de toda la cadena.” Warning EN: “Local validation saved a warning. Inspect the retained evidence; the agency outcome is unverified.” ES: “La validación local guardó un aviso. Examina la evidencia conservada; el resultado ante la AEAT no está verificado.” No invented available repair.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.integrity.test.ts` red then green after copy changes. Follow all changed prose across full execution-base-to-tip, including module strings and guides; preserve unrelated messages/assertions.
- [ ] Run unchanged baselines: module `src/verify.test.ts src/chain.validation-warnings.test.ts src/chain.record-validation.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts` through `pnpm --filter @waitron/fiscal-verifactu exec vitest run`; core four record suites with `-t 'chain verification fails'`. Require actual Tests counts; fixtures are not live AEAT/full-chain/repair qualification.
- [ ] In an **installed disposable complete candidate** only, mutate one protection at a time using testing-guide isolated-checkout/frozen-dependency procedure; preserve uncommitted candidate files too. Run the owning Task 1–5 command, retain the named behavioral assertion failure, restore and require green plus the legitimate control. Never swap files in the feature checkout.

| Independent mutation                                              | Required failing assertion                                                           | Legitimate accepting control                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Replace retained facts/count/version with current/inferred values | `keeps all three saved issue kinds distinct`: exact saved pairs and unknown facts    | Real two-issue observation still unknown checked count |
| Independently sort either warning array                           | `zips warnings before projecting labels`: exact ordered pairs                        | Unknown labels and reversed retained order preserved   |
| Bypass pre-hydration byte/depth bound                             | Core oversize/deep cases: hydration/seat calls zero                                  | Exact byte/depth boundary and escaped strings accepted |
| Remove source/regime/device gate                                  | Dispatch case: current association_mismatch, saved facts retained, zero fiscal reads | All four legitimate sale origins                       |
| Choose newest sale row or original corrected/substituted ticket   | Four-operation case: exact event id/operation, ambiguity refused                     | Unique own correction/F3/void with separate clock      |
| Drop same-node, sequence or any pointer component, separately     | Forged association cases: no current detail, saved evidence unchanged                | Different-sale predecessor and historical SIF accepted |
| Clear saved issues when predecessor/current row is missing        | Missing-row case: exact retained issue still present                                 | Fully provable current association available           |
| Guess a warning's sole/latest record                              | Warning case: `record_id_not_retained`, zero fiscal selects                          | Valid retained warning pairs visible                   |
| Use second deduplicated incident as saved evidence                | First-retained case: original issue/hash unchanged after void                        | Separate handling observation updates                  |
| Remove initial/final authorization, separately                    | Route gate: zero seat calls / final 401–403 with no evidence                         | Current authorized session reads successfully          |
| Restore ambient mirror writes or draining/touching wrapper        | Actual boot snapshot: unchanged session/cookie/change log, zero mutations            | Ordinary mirror bootstrap/cleanup still works          |
| Let cancelled work enter queue or continue selects                | Held-writer/deadline case: zero selects/writes after release                         | Fresh next read succeeds                               |
| Remove request/shell/live/panel generation gate, separately       | Old callback case: new rights/idle/evidence/busy unchanged                           | Current callback paints/releases                       |
| Filter decoded `node.reset` as stale                              | Full global reset assertion fires despite old generation                             | Stale ordinary 401 ignored                             |
| Forget submitted sign-in or auto-read rebuilt panel               | Actual-cookie Stop: reconciled identity, zero reopened handles/GETs                  | Unstopped permitted handle awaits explicit Read again  |

- [ ] Repeat real snapshots/traps after restoration for success, unavailable, malformed evidence, refusal, timeout and Stop. Seed unique PII/secret/XML/message sentinels; assert absence from wire/DOM/logs/storage, including intermediate writes. Instrument actual request logging without raw body/params; no client/AEAT/validator/verification/drain/ack calls after setup.
- [ ] Add red missing accessibility/state assertions before fixes; use existing `mountThemed`/`expectNoA11yViolations` for every distinct state in both themes, restore locale in finally. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/integrity-inspection.a11y.test.ts` and shared shell auth axe suites. Measure browser headroom before concurrent Chromium.
- [ ] On actual coordinated `wa-wt demo <worktree-name>` LOOK at EN/ES × light/dark × **390/1280 px**, computed theme colors and native controls. Exercise maximum lists/long hashes, loading/unavailable/ambiguous/expired, all sign-in factors, Stop busy/reopen, keyboard/Tab/Enter/Escape, announcements/focus return and overflow; retain visual/focus/axe receipts. No string-only rendering qualification.
- [ ] Update both guides in second person: saved partial check versus local warning, first retained limits, distinct timestamps, expected not repair, unknown versions/count, agency unverified, missing association preserves safe evidence, sign-in/account change, explicit Read again, enabled Stop and separate acknowledgement. Run unchanged `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`.
- [ ] Inspect complete base-to-tip diff and verify protected production files, old fiscal/golden/fixture assertions, guards and migrations byte-identical using `git diff --exit-code <execution-base> -- <protected-paths>` with the concrete audited path list. Stage only Task 6 paths; `git commit -s -m "docs: explain fiscal integrity inspection limits"`. Announce readiness for `finish-branch`; driver owns normal hooks/current-head CI and landing authority.

## One author self-review and handoff

Spec coverage: saved scope/three issue kinds/paired warnings/privacy → Contracts, Tasks 1/5/6; all four operations and safe retained fallback → Task 2; generic optional dispatch/source binding → Tasks 2/3; raw bounds/no writes/whole-request deadline/fresh rights → Task 3; one auth owner/submitted-cookie/empty reconstruction/global reset → Task 4; stale result/busy/Stop/EN–ES/themes/guides → Tasks 5/6. Each Review Focus case names an owning assertion. Shared signatures, detection-time addition and consumers were checked once.
Publication checks only: reread this plan against the complete spec and shared contracts once, inspect its diff/status and run `git diff --check`. No runtime code, tests, installs, commit, push, extra review, spawn or external research in this author firing. All build commands above remain prospective; the driver supplies the fresh reviewer next.
**Gaps kept explicit:** warnings retain no exact record id, original checked count or detection software/validator version; valid swapped saved pairs cannot be authenticated. Missing/ambiguous operation/predecessor proof permits saved evidence only. Timers cannot interrupt arbitrary synchronous SQLite/event-loop stalls; actual boot/transport deadline and no-late-work measurements are release requirements, not inferred guarantees. Persistent repair and agency acceptance remain unqualified. No additional owner question is required for the approved read-only scope.
