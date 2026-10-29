# A1089 Fiscal Reply Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task, inline. Steps use checkbox (`- [ ]`) syntax. No routine subagents.

**Goal:** Inspect the first retained reply mismatch beside separately observed record states, with in-place sign-in, Read again and Stop, while leaving persistent repair **OPEN**.

**Architecture:** A generic incident endpoint resolves the real incident and delegates validation and fiscal interpretation to an optional fiscal contribution. A module-owned panel consumes a bounded, allowlisted projection in memory. One
shell-owned authentication continuation and generation fences protect the panel, request callbacks and live connections across account changes.

**Tech Stack:** Existing TypeScript, Hono, Drizzle/node:sqlite, Lit, dashboard-kit and `wt-*` controls; Vitest, `useVenueDb`, Chromium and axe. No dependencies or migrations.

**Spec:** [2026-10-28-a1089-fiscal-reply-recovery-design.md](../specs/2026-10-28-a1089-fiscal-reply-recovery-design.md), complete; [audit](../../backlog/self-service-refusals.md#fiscal-reply) and [backlog](../../backlog.md).
Owner **2026-10-29 01:58** selected A, evidence inspection first. The newer **08:07** decision authorizes this read-only build after fresh plan review, without another approval question. It authorizes no certificate, setting, key, filing,
fiscal-record or backup change. This invocation publishes only this plan; the driver adds the dated historical-spec/backlog pointer and obtains the fresh review.

## Global Constraints

- One milestone: running-dashboard reply evidence. Persistent malformed-reply repair remains **OPEN**; inspection does not complete A1089 or qualify W41s-8/W41s-9.
- Sign-in is a separate authorized identity operation. Inspection, Read again and Stop write nothing: no acknowledgements, session stamps, change-log drain, retry-now, fiscal drain, AEAT/network client construction, lookup, submit, reset or
  restore.
- Preserve fiscal writers, numbering, hashes, chains, acknowledgements and retry/probe/hold behavior. Existing fiscal/golden tests, fixtures and assertions remain byte-identical. No guard modifications, migration edits or module-boundary
  allowlist growth.
- Require `fiscal.view`, session resolution with `touch: false`, and final fresh authorization, including expiry, suspension and revocation. Read from the host's existing venue handle in select-only turns without draining or joining a
  writer's transaction.
- Five seconds covers the complete evidence request from the first applicable boot middleware, including admission/access waits and final authorization. Cancellation prevents queued work starting later and suppresses late response/busy release. Bound the remaining work as Task 2
  specifies.
- Memory only, `Cache-Control: no-store` on success/refusal, no evidence cache, polling, export, clipboard action, URL payload, storage, raw payload logging or diagnostics dump. Render values as text.
- Never call retained evidence latest/complete, promise recovered history, infer present state from the warning, or infer repair from Mark handled. Wrong counts apply no lines; equal counts permit independent matching outcomes.
- Before runtime work, read TDD and relevant design-system/CI/workflow instructions. Each task observes intended red, minimal implementation and green; use `git commit -s`, retain hooks, run focused checks locally and current-head package
  coverage in CI.
- A696/A739/A803/A1155 reserve actual shared files. Coordinate their current reservations/diffs, including boot/server/shell/request/login, before execution. This document grants no reservation. No campaign/global, live setting or model
  edits.

## Review Focus

1. A real incident can carry a well-formed id for the wrong sale; Task 1 denies all associated detail, including booleans and current state.
2. A second mismatch or settled queue can coexist with the first retained empty reply; Tasks 1/4 preserve historical evidence and separate observations.
3. Session rights can disappear during a read or its final check; Task 2 returns no evidence and leaves all inspection-owned facts unchanged.
4. Stop after submitted sign-in cannot undo an accepted cookie; Task 3 reconciles actual identity without logout, replay or reopening a stopped panel.
5. Old response/body/401/activity/live callbacks and `finally` can arrive after a new account/read/open; Tasks 3/4 fence them, while decoded `node.reset` remains global.

---

## Source orientation and file map

Inspected at `ab08b4b94a24892d64889c36d1b1361c6d3c77c4`; these are source references, not runtime receipts. Re-read after coordinated rebase.

| Boundary                  | Actual source and consequence                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reply matching            | `packages/fiscal-verifactu/src/drain.ts:1269` checks count, position, reference, invoice triple and any stated operation; `:1384` persists matched outcomes independently. Keep this implementation unchanged.                                                                                         |
| Retained evidence         | `drain.ts:1400` stores `registroIds`, `csv`, `lineasRespuesta` on the first sale; `src/errors.ts:8`/`:15` define invoice/line fields. `packages/core/src/incidents.ts:95` plus `packages/db/src/schema/incidents.ts:69` deduplicate open incidents.                                                    |
| Queue and immutable proof | `packages/fiscal-verifactu/src/schema/{registros,envios,sif,filing-cases}.ts`; `registro-row.ts:93` converts stored invoice date to the reply spelling. Current node identity is not historical proof. `filing-cases.ts:246` reads every held row, so do not call it for this bounded inspection.      |
| Generic seams             | `packages/fiscal/src/contribution.ts:128` and `src/index.ts`; `packages/fiscal-verifactu/src/slot.ts:50`. The evidence seat is new and optional.                                                                                                                                                       |
| Incidents/auth            | `packages/core/src/incidents.ts:267` supplies `findIncident`; `:307` handles incidents separately. `apps/server/src/alerts-api.ts:78` uses draining/touching wrappers; do not copy them. `packages/identity/src/management-session.ts:47` supports no-touch resolution and returns session row/expiry. |
| Host reads                | `packages/db/src/tenancy.ts:35` drains at every `withTransaction`; `packages/store/src/write-queue.ts:30` has no cancellable queue admission. `conventions-data.md:2210` describes committed-reader routing outside an active transaction.                                                             |
| Browser                   | `packages/dashboard-kit/src/{contract,request,live-connection}.ts`; `apps/dashboard/src/{main,session-signals,dashboard-app,api/client}.ts`. No inspection action or continuation exists at this base. `dashboard-app.ts:1200`/`:1457` rebuild contributions after session reads.                      |
| Siblings                  | `drain.cases.test.ts:1371-1566`, `slot.test.ts`, server `alerts-api.test.ts`, `me-api.test.ts`, dashboard `dashboard-app.login-unsaved.test.ts`, module dashboard `client.ts`, `index.ts`, `certificate-card.a11y.test.ts`. Reuse fixtures/helpers without editing protected assertions.               |

Create generic browser-safe types in `packages/fiscal/src/incident-evidence-types.ts`, module wire/parser in `packages/fiscal-verifactu/src/reply-evidence-contract.ts`, module reader in `src/reply-evidence.ts`, host route/turn in
`apps/server/src/incident-evidence-{api,read}.ts`, and module UI in `src/dashboard/reply-{client,inspection,strings}.ts`. Task 3 names all shared auth paths; Task 5 owns guide changes. All new interfaces below are **proposed**.

## Contracts and limits

Generic types: recursive `FiscalEvidenceJson = null | boolean | number | string | readonly FiscalEvidenceJson[] | {readonly [key: string]: FiscalEvidenceJson}`; `EvidenceReader = Pick<Transaction, "select">`; `EvidenceReadControl = {signal:
AbortSignal; check(): void; yield(): Promise<void>}`.
`FiscalEvidenceIncident = {id: string; code: string; source: string; deviceId: string | null; saleId: string | null; params: Readonly<Record<string, unknown>>}`.
`EvidenceUnavailable = {state: "unavailable"; reason: "seat_absent" | "missing" | "unreadable" | "invalid" | "association_mismatch"}`.
`FiscalIncidentEvidence = EvidenceUnavailable | {state: "available"; value: FiscalEvidenceJson}`.
`FiscalIncidentEvidenceSeat = {codes: readonly string[]; read(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<FiscalIncidentEvidence>}`; add optional `FiscalContribution.incidentEvidence?:
FiscalIncidentEvidenceSeat`.
`IncidentEvidenceEnvelope = {schemaVersion: 1; incident: {id: string; code: string; detectedAt: string}; handling: {observedAt: string; handledAt: string | null}; evidence: FiscalIncidentEvidence; authorizedUntil: string}`. Export type-only
wire shapes via fiscal `index.ts`; no DB/Node runtime in the wire leaf. Define `EvidenceReader` in `contribution.ts` instead.

Use **GET `/management-api/alerts/incidents/:id/evidence`**: only a UUID path id, no query/body/options or supplied record list/params. This generic optional endpoint can serve future incident seats by their declared codes; the environment
plan's dedicated endpoint/seat remains independent until the driver explicitly reconciles it. Never import a regime or hardcode its code in the host. Require `fiscal.view` before lookup and the registry claim's permission before dispatch.
Missing incident or unsupported code with a present seat: `alert.not_found` 404; malformed request: `management.request_invalid` 400. Absent enabled seat: the authorized incident envelope with `seat_absent`, not a broken endpoint.

The module defines `ReplyEvidence` and returns its JSON projection as the available `value`:

```ts
type ReplyLineEvidence = {
  position: number; // 1-based retained position, never a reordered association
  status: "Correcto" | "AceptadoConErrores" | "Incorrecto" | "unknown" | null;
  operation: "Alta" | "Anulacion" | "unknown" | null;
  errorCode: number | null;
  referenceMatches: boolean | null;
  invoiceMatches: boolean | null;
  operationMatches: boolean | null;
};
type ReplyCurrent =
  | {
      recordId: string;
      observedAt: string;
      state: "available";
      sendState:
        | "pendiente"
        | "enviando"
        | "aceptado"
        | "aceptado_con_errores"
        | "rechazado"
        | "detenido"
        | "retenido";
      nextAttemptEligibleAt: string;
      heldReason: "not_held" | "set_aside" | "unavailable";
    }
  | {
      recordId: string;
      observedAt: string;
      state: "unavailable";
      reason: "missing" | "unreadable" | "invalid";
    };
type ReplyEvidence = {
  kind: "reply-mismatch";
  retained: {
    source: "incident.params";
    retainedAt: string;
    recordIds: readonly string[];
    sentCount: number;
    replyLineCount: number;
    csv: string | null;
    lines: readonly ReplyLineEvidence[];
  };
  current: readonly ReplyCurrent[];
};
```

`retainedAt` is **incident detection time**, when the retained warning was recorded, not an invented AEAT receive time. `current[i].observedAt` marks that record-state read; `handling.observedAt` marks a separate incident re-read. Neither
their ordering nor final authorization makes them an atomic snapshot. `authorizedUntil` is final no-touch session expiry; expire/clear locally without polling.

Validate **before expansion**: exact required top-level keys `registroIds`, `csv`, `lineasRespuesta`; reject missing/null arrays, extra top-level keys, duplicate ids and non-UUID ids. Record count `1..1000`, reply count `0..2000`, counts
must differ for this incident code. These are inspection caps, not new external-format claims; reject oversize as unavailable/invalid, never silently truncate. Bound serialized params to **1 MiB UTF-8**, CSV to **256** printable ASCII
characters or null. CSV absence is valid unavailable reference, never reconstructed from today's envío.
Each line has exactly `refExterna`, `tipoOperacion`, `idEmisorFactura`, `numSerieFactura`, `fechaExpedicionFactura`, `estado`, `codigo`, `mensaje`. Bound reference/operation/status/issuer/invoice strings to **128** characters;
reference/operation/status may be null as declared in `LineaParams`; issuer/invoice/date must be strings. Date must be a valid `DD-MM-YYYY` calendar date, code a safe integer `0..2147483647` or null, message string `0..4096` characters or
null. Reject control characters in identifiers/CSV. Validate then omit every raw reference, invoice identity, tax id and message from output; unknown bounded status/operation becomes fixed `unknown`.
Only after **all** record associations verify, compare retained position `i` against immutable record `i`: exact id, exact issuer/number and `toAeatDate(storedDate)`, operation from `tipoRegistro`. Missing reference gives `false`; absent
operation gives `null` (the sender allows it); an extra line with no positional record gets three null indicators. Wrong count still means **no line was applied**, regardless of true indicators. Never search another position to manufacture
a match.

## Task 0: Coordinate the execution boundary

**Files:** Read only the current runner reservations, both sibling plans and the source map. The author edits only this document.
**Interfaces:** Read the complete [environment plan](2026-10-29-a1089-fiscal-environment-evidence.md) and [certificate plan](2026-10-29-a1089-aeat-certificate-diagnosis.md); use Task 3's single auth owner and the environment plan's optional
incident-action contract.

- [ ] Driver obtains the required **fresh** plan review. Under the 08:07 owner decision, proceed to the approved read-only build after review and actual shared-file coordination; do not ask the superseded A/B or build-approval question
      again.
- [ ] Resolve A696/A739/A803/A1155 reservations against actual candidate diffs; re-read changed interfaces/callers and record the execution base SHA. Reuse qualified compatible shared work, or execute the shared task inline when released.
      No assumed continuation, duplicate controller or silent broadened scope.

## Task 1: Validate and project retained evidence in the fiscal module

**Files:** Create fiscal `src/incident-evidence-types.ts`; modify fiscal `src/{contribution,index}.ts`. Create fiscal-verifactu `src/reply-evidence{,-contract}.ts`, `src/reply-evidence{,-contract}.test.ts`; modify only its `src/slot.ts`
seat wiring.
**Interfaces:** `parseReplyEvidence(value: unknown): ReplyEvidence` validates/projects wire output; `readReplyEvidence(reader: EvidenceReader, incident: FiscalEvidenceIncident, control: EvidenceReadControl): Promise<FiscalIncidentEvidence>`
implements the seat. Module wiring declares only `codes: ["fiscal.respuesta_descuadrada"]`. The host passes the stored incident; the browser never supplies it.

- [ ] Write red `rejects unverified association before detail` and parser tests: wrong code/source (`fiscal_filing` required), non-null device, null/wrong first sale, absent record/sale/SIF/node, mismatched sale/record node or SIF node,
      malformed/null/duplicate/oversize ids and lines, injected refs, CSV/message/code bounds, extra keys. Assert exact unavailable shape and absence of all details. Test boundaries and valid maximums, not only refusal.
- [ ] Add red `uses the immutable historical invoice` with alta/anulación and an older revoked SIF on a genuine sale. Each listed record must join its existing sale, node and historical SIF, with sale/node/SIF consistency and sale fiscal
      backend `verifactu`; first record's sale must equal the incident sale. Different valid sales/nodes/SIFs in one list remain allowed; do not add a same-chain or current-identity restriction. Association proves these links, not a
      cryptographic batch history.
- [ ] Add red `keeps first retained reply separate from later queue observations`: generate two mismatches with the real drain/fake AEAT before inspection; retain the first CSV/empty lines, advance queue, then inspect. Mark handled
      separately between reads and assert unchanged retained facts, refreshed handling, and independently observed current rows. Use `useVenueDb({migrations: TEST_MIGRATIONS})`, existing `test/drain-fixtures.ts`, no fixture edits.
- [ ] Add red match cases: exact historical triple versus differing issuer/number/date/ref/operation, absent operation, unknown status, extra positional line, duplicate reply references and hostile text. Verify three null indicators for
      out-of-range positions and no raw identity/message keys anywhere in full `toEqual` output. Distinguish missing association from missing current envío.
- [ ] Pin the core assertions in those named cases: `expect(answer).toEqual({state: "unavailable", reason: "association_mismatch"})`; valid first-empty evidence has `expect(value.retained.replyLineCount).toBe(0)` and
      `expect(value.retained.csv).toBe(firstCsv)` after the second drain. Each triple mismatch has `expect(line.invoiceMatches).toBe(false)`, while the historical matching control is true.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/reply-evidence.test.ts src/reply-evidence-contract.test.ts`; require intended missing reader/export/assertion failures, not fixture setup failures.
- [ ] Implement bounded select-only reads sequentially in chunks of **50 ids**. Call `control.check()` before/after each query and `await control.yield()` between chunks so synchronous-query microtasks cannot starve the deadline timer.
      Verify immutable membership first, then read only those envíos and their own filing case. `retenido` plus verified own `fiscal.anulacion_retenida` gives `set_aside`; other held states give `unavailable`, because the complete hold cause is
      not stored on the envío. Non-held states give `not_held`. Never infer a hold cause or a scheduled send from stored eligibility; missing/unreadable/invalid current state yields that row's unavailable arm. Return sanitized association
      failures without exception text.
- [ ] Repeat green with actual Tests counts; run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/slot.test.ts` and `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`. Stage only Task 1 paths; `git
commit -s -m "feat: project bounded retained fiscal reply evidence"`.

## Task 2: Serve authorized evidence without touching or draining

**Files:** Create server `src/incident-evidence-{api,read}.ts`, `src/incident-evidence-{api,read}.test.ts`, `src/incident-evidence.transport.test.ts`, `src/boot.incident-evidence.test.ts`; modify `src/{boot,errors,mirror-session}.ts` and `src/mirror-session.test.ts`. Modify core `src/{incidents,index}.ts`; create core `src/incident-evidence.test.ts`. Test through real
composition/migrations in existing server dependencies.
**Interfaces:** `mountIncidentEvidenceApi(app: Hono, deps: {db: Database; seat?: FiscalIncidentEvidenceSeat; registry: AlertRegistry; now(): Date}, log: Logger): void`.
`readIncidentEvidenceTurn<T>(db: Database, control: EvidenceReadControl, read: (reader: EvidenceReader) => Promise<T>): Promise<T>` invokes select-only work outside write-transaction context, without queue admission, `withTransaction`,
`withWriteLock`, drain or delivery. It is a deliberately non-atomic read boundary. Reuse this helper for Task 3's session-me read by passing the underlying DB to its existing identity reader, not by widening the fiscal reader capability.
`createEvidenceReadControl(signal: AbortSignal, startedAt: number): {control: EvidenceReadControl; dispose(): void}` in `incident-evidence-read.ts` owns the fixed 5000-ms deadline using `performance.now()`. `check()` throws on abort/elapsed
deadline; `yield()` takes one real event-loop turn, checking before/after. The first applicable boot middleware captures `startedAt` before any mode/session middleware; both handlers consume that same request-local control. No caller can supply these values over HTTP.

- [ ] Write red real GET/seat cases for the exact envelope, handled/open events, unsupported code, malformed id/options, absent/disabled seat and unavailable association. Establish initial `fiscal.view` and registry permission before
      incident/seat access; missing/expired/ended/suspended and insufficient rights produce existing 401/403 envelopes and zero detail calls. No generic regime SQL/imports.
- [ ] Write red `rechecks the same session before release`: hold the seat, revoke role/session, suspend person, expire session or replace its identity, then release. Repeat while final authorization is held. Assert denial without partial
      evidence, compare sessionRowId/personId, and set `authorizedUntil` only from the final resolve with `touch: false`. Same-person new session is still a new identity. Keep authorized current-session controls.
- [ ] Write red deadline/admission cases: hold a writer queue before invoking GET; inspection still finishes from committed rows or times out at **5000 ms**, and releasing the writer later starts zero cancelled inspection callbacks. Hold
      seat/response/final auth separately, abort before entry and during each phase, then verify the next read works. Test a signal-ignoring late seat resolution/rejection with zero later state reads/final callbacks/response.
- [ ] Use exact receipts: `expect(after).toEqual(before)` for the all-table snapshot; `expect(seat.read).not.toHaveBeenCalled()` for missing rights; `expect(response.status).toBe(504)` and `expect(selectsAfterCancellation).toBe(0)` after
      releasing held work. A 50-id chunk boundary must yield to the real deadline timer; legitimate concurrent writes and fresh reads must still finish.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/incident-evidence-api.test.ts src/incident-evidence-read.test.ts src/incident-evidence.transport.test.ts`; observe missing route/helper and expected behavioral reds.
- [ ] Implement monotonic **5000 ms from earliest applicable boot middleware**, composed request cancellation and expiry abort, racing every asynchronous boundary through final auth/serialization. Declare/import `diagnostics.read_timed_out: {deadlineMs:
number}`, map to 504 with `5000`, and discard partial results. No request work enters the uncancellable write queue; check elapsed time/signal before and after every select/chunk, so at most the already-issued bounded select can complete
      late. No subsequent query starts after cancellation; observe abandoned promises and dispose timers/listeners within **1000 ms** without extending response authority. Do not claim a timer interrupts synchronous SQLite or an arbitrary
      event-loop stall; reject elapsed reads when control returns and qualify the measured bound below.
- [ ] Resolve cookie/session twice no-touch, use the bounded core reader below only, dispatch by seat-declared codes after registry gating, re-read handling separately and project only the envelope. Sanitize unknown exceptions before
      logger/error-envelope exposure; use fixed unavailable/error codes, never forward params/cause/message. Apply no-store to every path. Preserve security decisions in outer boot/read-only guards while removing the diagnostic paths' implicit session mutations as specified below; add route mounting for absent/enabled fiscal seats without
      instantiating any client.
- [ ] Snapshot every logical table before/after success/repeat/unavailable/refusal/abort/timeout, including immutable records, SIF/chains, acks, envíos/attempts/eligibility, filing cases/events, counters, all incident handling/notes,
      session last-seen/endedAt and pending change-log rows. Watch mutating DB methods/statements and change notifications too, so write-then-restore fails. Install zero-call traps for client/fetch, fiscal
      drain/ack/retry/reset/restore/config/credential/backup operations **after fixture setup**. Deliberate concurrent revocation/handling controls account only for their expected writes.
- [ ] Exercise a real listening Hono transport and socket disconnect, not only synthetic `Request.signal`; use `freePorts(n)` once. Verify actual boot route, current read while an unrelated writer is held, bounded known-dataset selects,
      request deadline and cleanup/next admission. Do not mutate a live child server's DB from the parent; mid-read rights tests use the in-process Hono fixture. Repeat green plus unchanged `src/alerts.test.ts src/alerts-api.test.ts`; `git
commit -s -m "feat: serve no-touch incident evidence reads"` after staging Task 2 paths.

### Complete-request admission and bounded stored input

These are required Task 2 interfaces and red/green checks. Source-derived review found two earlier boundaries: `boot.ts:1684` mounts `mirrorSession` on `*`, and `mirror-session.ts:120` enters a draining write transaction before a handler; ordinary core `findIncident` selects JSON-mapped params (`incidents.ts:267`, `columns.ts:47`). These reads identify work to qualify, not executed runtime measurements.

- [ ] Add `isInspectionRead(method: string, path: string): boolean` in `incident-evidence-read.ts`: only GET of `/management-api/alerts/incidents/<one path segment>/evidence` or `/management-api/session/me`. Invalid ids still receive no-write admission before their normal 400/404 validation. Install the request-local deadline/control before any mirror/session middleware, retaining request logging, origin checks and all mode/security gates. Extend `mirrorSession` with an optional fifth dependency `{ isInspectionRead(method: string, path: string): boolean }`; only these reads bypass ambient stamping, revival, injection and promotion cleanup. They resolve the supplied cookie without touch. Missing/ended/expired cookies refuse; a still-valid viewer overdue for its 60-second keepalive can read unchanged. After promotion, the boot-owned viewer token refuses with `management_session.required` before record access, without ending a row or clearing a cookie. Do not turn an old mirror viewer into a trading administrator. Ordinary requests retain their existing behavior.
- [ ] First add actual-boot/mirror tests for valid-but-overdue, expired, ended and absent viewer sessions; a pending change log; held writer; and promotion while the old viewer cookie survives. Call both diagnostic paths through the complete app. Assert unchanged rows/cookies/change log, zero write-turn admission, correct permission refusal after promotion and the complete 5000-ms budget. Release the held writer and assert no cancelled callback then begins. Keep ordinary mirror keepalive/bootstrap/promotion-cleanup cases as accepting controls. Run `pnpm --filter @waitron/server exec vitest run src/boot.incident-evidence.test.ts src/mirror-session.test.ts src/incident-evidence.transport.test.ts`, observe intended reds, then implement and require green. Inspection never implicitly bootstraps a session; Task 3's explicit sign-in is separate identity work.
- [ ] Export core `findBoundedIncident(tx: Transaction, id: string, limits: { maxParamsBytes: number; maxJsonDepth: number }): Promise<BoundedIncident | null>` and `readIncidentHandling(tx: Transaction, id: string): Promise<{ acknowledgedAt: string | null } | null>`. `BoundedIncident` has `id: string`, `code: string`, `source: string`, `deviceId: string | null`, `saleId: string | null`, `detectedAt: string`, `acknowledgedAt: string | null` and `params: {state: "readable"; value: Readonly<Record<string, unknown>>} | {state: "unavailable"; reason: "invalid" | "unreadable"}`. The handling reread selects no params. These generic core contracts import no fiscal module.
- [ ] Before JSON hydration, select metadata and the stored byte length with `length(cast(params as blob))`; fetch raw `cast(params as text)` only inside a SQL CASE bounded by **1,048,576 bytes**, using a typed SQL expression rather than the JSON-mapped column. A separate payload select must repeat the bound so a changed row cannot evade it. Return invalid for oversize, malformed JSON, non-object roots or nesting deeper than **16**; unreadable is a sanitized read failure. Before `JSON.parse`, run a bounded non-recursive depth scan respecting JSON strings and escapes. Do not stringify a decoded whole object to discover its size. The route passes fixed limits, maps unavailable params to the envelope's unavailable arm without seat calls, and passes only a validated readable object to the module.
- [ ] In new core cases seed raw stored text of 1,048,577 bytes, malformed JSON, 17-level nesting, valid 16-level nesting, escaped braces/quotes, non-object roots and exactly 1,048,576 valid bytes. Assert invalid inputs reach neither JSON hydration nor fiscal seat, while the exact boundary control reads. Test metadata-only handling with malformed/oversize params. Use real `useVenueDb` and raw SQL only during fixture setup; trap writes after setup. Run `pnpm --filter @waitron/core exec vitest run src/incident-evidence.test.ts` red first, then green. Add real-route cases proving no raw params or parse exception reaches logs/wire. Stage these core/mirror files in Task 2's signed commit.

## Task 3: Supply one real shell sign-in continuation and authentication fence

**Files:** Create dashboard `src/permission-continuation.ts`, `src/inspection-auth.ts`, `src/dashboard-app.inspection-auth.test.ts`, `src/inspection-auth.test.ts`; modify
`src/{main,session-signals,dashboard-app,api/client,screens/login-screen}.ts` and their owning tests, `src/i18n/{strings,codes}.ts`. Create kit `src/auth-generation.ts`, `src/auth-generation.test.ts`; modify kit
`src/{index,contract,request,live-connection}.ts` and tests. Modify server `src/me-api.ts`, `src/me-api.test.ts`.
**Interfaces:** Canonical owner is the certificate plan's **shell `PermissionContinuation` and `SessionEpoch`**, backed by the shell's sole `sessionGeneration`. Environment interfaces are adapters, not independent state/controllers. All
references here define a dependency to implement or qualify, not an existing capability.

- `SessionEpoch` in dashboard `session-signals.ts`: `current(): number`, `advance(): number`, `subscribe(listener: () => void): () => void`; existing shell generation getters read this same value.
- Kit `AuthGeneration`: `capture(): number`, `invalidate(): number`, `isCurrent(n: number): boolean`, `subscribe(listener: () => void): () => void`; `adaptAuthGeneration(epoch: {current(): number; advance(): number; subscribe(listener: ()
=> void): () => void}): AuthGeneration` delegates to that owner.
- `DashboardPermissionContinuation` in kit `contract.ts`: `snapshot(): {accountGeneration: number; authenticated: boolean; permissions: readonly string[]}`, `subscribe(listener: (snapshot:
ReturnType<DashboardPermissionContinuation["snapshot"]>) => void): () => void`, `signIn(input: {permission: string; signal: AbortSignal}): Promise<"signed-in" | "stopped">`.
- Shell `PermissionContinuation` implements it and `trackAuthentication(settlement: Promise<unknown>): void`. Environment `InspectionAuthHost = {generation: AuthGeneration; requestSignIn(input: {actionId: string; requiredPermissions:
readonly string[]}): Promise<"signed_in" | "stopped" | "unresolved">; trackSubmission<T>(work: Promise<T>): Promise<T>}` adapts this same registry. Define the same `requestSignIn`, `stop(): void` and `reconcile(): Promise<"signed_in" |
"signed_out" | "unresolved">` on the owner; `InspectionAuthController` delegates them and wraps `trackAuthentication` while preserving the original promise's value/refusal. It has no second login registry/epoch. Canonical `signIn` maps an
  unresolved internal result to `stopped`, retaining the owner's unresolved surface; the inspection adapter preserves `unresolved` explicitly.
- Construct `PermissionContinuation({epoch, readSession, applySession, showLogin, closeLogin, beginViewerSignIn})`, with `readSession(): Promise<Awaited<ReturnType<DashboardApi["getMe"]>>>`, `applySession(session: Awaited<ReturnType<DashboardApi["getMe"]>> |
null): void`, `showLogin(): void`, `closeLogin(): void`. `new InspectionAuthController(owner: PermissionContinuation, generation: AuthGeneration)` supplies the environment adapter.
- Extend `DashboardModuleContext` with optional `permissionContinuation` and `inspectionAuth`. `LoginScreen.continuation = false`, optional `inspectionAuth?: InspectionAuthHost`, `authenticationSubmitted?: (settlement: Promise<unknown>) =>
void`; both tracking hooks feed the one registry, deduplicated by promise identity. Keep password/TOTP/recovery/passkey/Google paths and protections.
- Extend `RequestOptions` with `signal?: AbortSignal`, `isCurrent?: () => boolean`, `sessionErrors?: "caller"`, `activity?: "none"`; explicit `timeLimitMs` works on any method. GET defaults remain 30000 ms, ordinary POST has no default
  deadline; intentional abort is `connection.cancelled`, deadline `connection.timed_out`. Register EN/ES cancellation in dashboard `i18n/codes.ts`.
- Add `sessionGeneration?: () => number` to request/live options. Canonical `DashboardApi` sixth argument is optional `{sessionGeneration?: () => number}`; preserve fifth `passive` and forward the getter to `background`. This resolves the
  sibling plans' differing sixth-argument proposals; their adapters supply `() => epoch.current()`, never another counter.
- `DashboardApi.getMe(options?: RequestOptions)` forwards to session-me, whose response adds `sessionIdentity: string` from `sessionRowId`. Reconciliation uses `{passive: true, timeLimitMs: 5000, sessionErrors: "caller"}` through Task 2's
  no-touch/no-drain boundary. Update all exact whole-response fixtures/callers deliberately, preserving behavioral assertions.

- [ ] Write red actual-shell/login/request tests for password, TOTP/recovery, gesture-only passkey (stub `navigator.credentials`, keep WebAuthn real), Google return, normal generic refusals/throttles, same-person changed session and new
      account without `fiscal.view`. No enrollment-discovery query, synthetic logged-in shortcut, logout call or automatic inspection GET.
- [ ] Write red submitted-auth races: Stop before submission; Stop after password/passkey verification sent but before Set-Cookie/body; accepted cookie with lost response; failed late login after another account; failed session
      reconciliation. Assert observed cookie identity is adopted, old evidence/rights cleared, replacement sign-in blocked while settlement unresolved, and Stop never reconstructs/replays a panel. Normal second-factor refusals leave the form
      usable.
- [ ] Write red stale response/error/body/activity/probe/idle/expiry/SSE cases and current-callback controls. A stale decoded `node.reset` from request, caller-handled errors or live/session signals still performs the existing full reset.
      Stale ordinary session failures/activity neither reset the new account nor extend its idle deadline nor release a new read gate.
- [ ] Pin `expect(logout).not.toHaveBeenCalled()`, `expect(inspectionGets).toHaveLength(0)` after cookie reconciliation, and `expect(reconstructed.initialRead).toBe("explicit")` only for the unstopped permitted descriptor. After Stop assert
      zero reconstructed handles. Keep full current/reset assertions alongside stale-event controls.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.inspection-auth.test.ts src/inspection-auth.test.ts src/session-signals.test.ts` and separately `pnpm --filter @waitron/dashboard-kit exec vitest run
src/auth-generation.test.ts src/request.test.ts src/live-connection.test.ts`; observe intended reds.
- [ ] Implement the single owner and adapters; advance generation on sign-in start/completion/Stop, identity/rights/session change, expiry and shell disconnect. Fence before request success/error, observed-fetch revision updates, session
      signals/probes/activity and live effects. Decode/dispatch `node.reset` before stale filters. Compose cancellation and race fetch/body waits, dispose listeners and cancel late bodies; ordinary POSTs are not passive. `activity: "none"`
      suppresses browser activity only.
- [ ] Add proposed shell dependency `beginViewerSignIn(): Promise<void>` to `PermissionContinuation` construction. Only an explicit Sign in gesture may call it: perform one same-origin raw `fetch("/", {method: "GET", credentials: "include", cache: "no-store"})` through ordinary middleware, discard the HTML without rendering/executing it, then reconcile via the no-write session-me read. Track this cookie-setting bootstrap in the same submitted-identity registry; never run it on opening, Read again, expiry or Stop. On a mirror this reuses its existing ambient viewer bootstrap; on a trading node, insufficient rights continue into the normal credential form. Keep normal security/mode gates, including promoted-viewer cleanup on the ordinary request. Show that this separate sign-in may change the account. Add real-boot and actual-shell cases proving absent/expired mirror cookies stay unchanged during inspection but explicit sign-in can establish the viewer, and Stop after submission reconciles without reopening. No new endpoint or implicit login is introduced.
- [ ] Host normal sign-in in-place in a shell-owned `wt-dialog`, preserving leave coordination/focus and explaining dashboard account change. Track cookie-setting submissions synchronously before local generation checks; Stop cancels unsent
      ceremonies, closes UI and clears draft references, but does not abort/forget submitted identity work. After settlement, including lost responses, do one fresh epoch-fenced session reconciliation; unresolved outcome exposes only explicit
      session Read again and Stop, no polling or assumed old cookie. Never automatically replay login or sign out. Google retains only a nonsecret return marker, no evidence/credential.
- [ ] Keep shell-only `InspectionReturn = {actionId: string; incidentId: string; returnFocus: HTMLElement | null; stopped: boolean}` across contribution rebuilds. Close old handles immediately. After reconciled rights permit it, rebuild
      **one empty** handle with `initialRead: "explicit"`, awaiting fresh Read again; no old facts/handle survive. Stop/navigation/disconnect/node reset discard descriptor/marker. Preserve reconciliation after Stop without reopening inspection.
- [ ] Repeat green plus unchanged login/login-unsaved/module-screen suites and server `src/me-api.test.ts`; assert session-me leaves last-seen/change-log untouched. Exercise `main.ts` wiring, real cookie-setting identity routes and real
      `#applyMe` rebuild, not only isolated controller mocks. Stage coordinated Task 3 paths; `git commit -s -m "feat: share inspection authentication lifecycle fences"`.

## Task 4: Contribute the alert action and transient reply panel

**Files:** Modify kit `src/contract.ts`, `src/contract.test.ts`; create module dashboard `src/dashboard/reply-{client,inspection,strings}.ts`, `reply-client.test.ts`, `reply-inspection{,.generations,.a11y}.test.ts`; modify module
`src/dashboard/index.ts`, `index.test.ts`. Modify dashboard `src/dashboard-app.ts`, `src/widgets/{alert-format,alerts-bell}.ts`, `src/screens/alerts-screen.ts`, their tests, and create `src/dashboard-app.reply-inspection.test.ts`.
**Interfaces:** Reuse environment proposal `DashboardContribution.incidentActions?: readonly DashboardIncidentAction[]`; `DashboardIncidentAction = {id: string; codes: readonly string[]; labelKey: string; requiresPermission: string;
create(ctx: DashboardModuleContext, incidentId: string, options?: {initialRead: "automatic" | "explicit"}): DashboardScreenHandle & {close(): void}}`.
`ReplyEvidenceClient(request: DashboardRequest).read(incidentId: string, signal: AbortSignal, isCurrent: () => boolean): Promise<IncidentEvidenceEnvelope>` validates the envelope and module `ReplyEvidence` available arm, requiring returned
incident id/code match the requested opening. `dashboard-fiscal-reply-inspection` properties: `client`, `incidentId`, `inspectionAuth`, `initialRead` (default `automatic`); `close(): void` aborts/clears/emits `inspection-closed` once. Shell
owns the handle outside list/bell refresh lifetimes.

- [ ] Write red action tests: id `fiscal-reply-inspect`, code only `fiscal.respuesta_descuadrada`, permission `fiscal.view`, label key `fiscal_reply.inspect`. Generic bell/open/handled Alerts consumers match code/permission and pass only
      `incidentIdOf(alert)`. Disabled/absent module and ongoing alerts offer no action; other modules' contributed actions still work; repeated ids are refused by contribution validation.
- [ ] Write red exact rendered states: loading/awaiting-read, first retained empty/mixed facts, missing/invalid/unreadable association, missing current row, held reason unavailable/set-aside, timeout/read failure, expiry and sign-in. First
      opening reads once; post-sign-in reconstruction reads zero times until Read again. `nextAttemptEligibleAt` says eligibility only, including when state is held/settled; never promise a send time.
- [ ] Add red generation races using deferred fetch/body promises: Stop busy, Escape, detach, reopen, overlapping Read again, account switch, expiry and older success/error/finally. Own `{opening, read, auth}` before every effect/release;
      at timeout clear evidence and abort. New opening/read works immediately; old completion never repaints/releases it. Current successes/refusals still paint. No subscriptions for evidence, cache/storage writes, export or automatic reads
      after sign-in.
- [ ] Assert `expect(newReadBusy).toBe(true)` after the old read's `finally`, `expect(oldEvidenceNode).toBeNull()` after account change, and `expect(stopButton.disabled).toBe(false)` while reading. Resolving the current read must then paint
      its own facts and release its gate; an always-empty/always-busy panel fails that control.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/reply-client.test.ts src/dashboard/reply-inspection.test.ts src/dashboard/reply-inspection.generations.test.ts src/dashboard/index.test.ts` and dashboard
      `src/dashboard-app.reply-inspection.test.ts src/screens/alerts-screen.test.ts src/widgets/alerts-bell.test.ts`; observe expected red.
- [ ] Implement client GET only with `{passive: true, timeLimitMs: 5000, signal, isCurrent, sessionErrors: "caller"}`. Read again aborts/increments/clears previous evidence; all results/errors/finally require the three current generations.
      Subscribe to auth invalidation/expiry only. Optional auth host absence produces unavailable sign-in capability plus Stop; never fake a continuation. Sign-in requires visible action and `fiscal.view` reconciliation.
- [ ] Implement module EN/ES copy: **Inspect reply / Examinar respuesta**, **First retained reply / Primera respuesta conservada**, **Current record state / Estado actual del registro**, **Read again / Volver a leer**, **Stop / Cerrar
      inspección**, **Unavailable / No disponible**. Show incident id/detection, ordered ids/counts/CSV and allowlisted line facts, separate current observation times and handling observation. State that later replies may not have been retained
      and this panel cannot repair a persistent mismatch. No raw/HTML detail path.
- [ ] Explain Stop: “Closes inspection without stopping filing or sales.” / “Cierra la inspección sin detener los envíos fiscales ni las ventas.” Keep Stop enabled while busy. Keep Mark handled outside inspection, with “Acknowledging this
      alert does not settle filing” / “Marcar esta alerta como atendida no resuelve el envío fiscal”. Stop/read/sign-in never call acknowledgement. Sign-in copy explains a submitted login may change the account after closing.
- [ ] Repeat green and kit contract tests; inspect native buttons, focus return after actual `wt-close`/inspection closure and reopened busy gate. Preserve all existing alert acknowledgement/navigation assertions; stage Task 4 paths, `git
commit -s -m "feat: inspect retained fiscal replies from alerts"`.

## Task 5: Qualify the boundary and explain the limited choices

**Files:** Extend only new owning suites above; modify `apps/server/src/guide/{en,es}/box-status.md`, `apps/dashboard/src/i18n/alert-messages.ts`, `apps/dashboard/src/i18n/alerts.test.ts`. No guard edits. Exact heading in both guides:
`{#fiscal-reply-inspection}`.
**Interfaces:** No new runtime API. The driver owns backlog/historical-spec updates; this plan author does not edit them.

- [ ] Add any missing qualification assertion red first, then minimally implement and repeat green. Replace only the mismatch alert's support referral when the action exists: explain no lines applied for that retained wrong-count reply and
      offer inspection; omit guaranteed retry/current-state claims. Keep `fiscal.estado_desconocido` and unrelated alert wording outside this milestone. Follow the whole changed prose path set, including guides and module strings.
- [ ] Run unchanged baselines: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.cases.test.ts -t 'reply lines are paired'`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts`. Require actual counts. Existing fixture receipts qualify those cases, never new UI/runtime behavior, live
      AEAT or repair.
- [ ] In a disposable **installed complete candidate copy** only, apply each deletion below independently, run its owning command from Tasks 1–4 (or the baseline above), record the named failing assertion rather than compilation failure,
      restore and require green. Never swap files in the feature checkout; use the testing guide's isolated-checkout procedure and frozen dependencies. Retain logs outside product evidence storage.

| Omission/mutation                                              | Exact failing assertion to retain                                                                                  | Valid control                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Remove count gate in `resolveLines`                            | Existing wrong-count case: `ackOf(id)` is undefined, `recordsAccepted === 0`                                       | Equal-count own line accepts                                  |
| Drop independently matched lines when any line mismatches      | Existing swapped-two-of-three case: third ack `accepted`, only first two later sent                                | Fully matching three records                                  |
| Replace saved evidence with later envío/response facts         | New `keeps first retained reply separate from later queue observations`: retained first CSV/zero lines unchanged   | Current row actually advances                                 |
| Omit first-sale or any-record membership check, one at a time  | `rejects unverified association before detail`: exact unavailable arm, no ids/current/booleans                     | Genuine historical revoked-SIF batch and multiple valid sales |
| Compute invoice match using today's issuer/date                | `uses the immutable historical invoice`: exact expected true/false triple indicators                               | Different immutable issuer/number/date each gives false       |
| Remove size/uniqueness validation                              | Parser boundary cases: duplicate/1001 ids/2001 lines/257 CSV/oversize params yield invalid                         | Valid maximum and zero reply lines                            |
| Remove initial or final authorization                          | Route no-rights/mid-read rights tests: 401/403, no evidence; initial gate zero seat calls                          | Current fiscal viewer sees facts                              |
| Leave mirror ambient middleware active for diagnostic GETs     | Actual-boot overdue/ended/held-writer cases: no stamp/revival/cookie/drain, complete-request deadline              | Ordinary mirror bootstrap/cleanup and valid passive viewer    |
| Decode JSON-mapped incident params before byte/depth checks    | Core raw-storage cases: oversize/malformed/deep data invalid before hydration/seat; handling never reads params    | Exact byte/depth boundary and escaped JSON strings            |
| Use touching session read or draining wrapper                  | Snapshot assertions: last-seen and nonempty pending change-log unchanged                                           | Empty change-log and independent writer finish                |
| Permit continuation work after abort/deadline                  | Turn/transport cancellation test: zero selects/seat/final calls after cancellation and writer release              | Fresh subsequent GET succeeds                                 |
| Remove request/shell/live generation gate, each separately     | Stale callback tests: new account/surface/idle deadline/read busy unchanged                                        | Current callback still applies                                |
| Suppress global reset with a stale filter                      | Stale `node.reset` test: full reset observed despite old generation                                                | Stale ordinary 401 stays suppressed                           |
| Remove submitted-auth registry or explicit-read reconstruction | Real-shell Stop-cookie test: actual reconciled identity, zero reopened handles/GETs; unstopped handle starts empty | Fresh explicit Read again works                               |
| Remove panel result or `finally` ownership check, separately   | Delayed old read test: no old DOM facts and new busy gate still held                                               | New current response releases/paints                          |

- [ ] Run real select-only snapshot/trap/route/shell suites from Tasks 1–4 after restoration; prove malformed input cannot reach unrelated records or raw payload/log paths. Include unique tax-id/message/XML/secret sentinels in
      success/failure/timeout and assert absence from wire/DOM/log/storage. Existing instrumented fetch may retain masked path/status/code only, never payload; test its real integration with held refusal bodies too.
- [ ] Add panel axe cases using existing `mountThemed`/`expectNoA11yViolations` in `packages/fiscal-verifactu/src/dashboard/reply-inspection.a11y.test.ts`; create `apps/dashboard/src/dashboard-app.inspection-auth.a11y.test.ts` for shell sign-in states.
      Cover every distinct state in both themes and restore locale after each case. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/reply-inspection.a11y.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run
src/dashboard-app.inspection-auth.a11y.test.ts`. Measure browser headroom before concurrent Chromium; do not start beside whole-workspace coverage.
- [ ] Through the actual shell/worktree stack (`wa-wt demo <coordinated-worktree-name>`), LOOK at EN/ES × light/dark × **390/1280 px**, including long 1000-id content, loading/unavailable/handled/current divergence, held/settled/expired,
      sign-in factors, Stop busy/reopen. Check keyboard/tab/Enter/Escape, live announcements, native focus/return and overflow; retain visual/focus/axe receipts. Large lists stay bounded and scroll within the dialog.
- [ ] Update both guides in second person: first retained versus current observations, unavailable history/association, eligibility not promised send time, account change and fresh Read again, Stop's limited effect and separate Mark
      handled. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/alert-codes.test.ts
scripts/errors-reachable.test.ts` unchanged. Open the actual browser bundle; text guards do not qualify rendering/purity.
- [ ] Compare execution-base-to-candidate diffs: all existing fiscal/drain/golden/fixture assertions and migrations/guards byte-identical, only new tests and approved shared interfaces changed. Record no runtime
      install/settings/key/filing/backup operation beyond authorized sign-in. Stage qualified Task 5 paths; `git commit -s -m "docs: explain fiscal reply inspection limits"`. Announce readiness for `finish-branch`; driver follows normal
      hook/current-head CI and owner landing authority.

## One author self-review and handoff

Self-review once against every spec section: retained-versus-current facts/limits → Contracts, Tasks 1/4/5; wrong/equal count semantics and repeated-first evidence → Tasks 1/5; generic optional seat/real incident/association → Tasks 1/2;
no-touch/no-drain/final rights/deadline → Task 2; in-place normal sign-in/Stop-cookie/account reset → Task 3; empty reconstruction/request/live/panel generations/global reset → Tasks 3/4; privacy/zero side effects/accessibility/guide twins
→ Tasks 2/4/5. All five Review Focus cases name owning tests. Types, property names and shared adapters were checked across consumers once.

Publication checks for this author: read the written artifact, inspect only its diff/status and `git diff --check`; no implementation, tests, installs, commits, pushes, external research or second plan review. All commands above are
prospective build qualification. The driver supplies the fresh reviewer next, then coordinates actual shared-file ownership before the already-authorized read-only execution.

**Open limits:** persistent reply repair and missing-history recovery; held cause unavailable where no bounded retained proof establishes it; no live AEAT or arbitrary stalled-native-call timing qualification. Task 2 must retain actual
deadline/late-work measurements, not claim timer interruption; failure to meet the five-second acceptance requirement blocks release rather than weakening that requirement. No further owner decision is needed for this read-only build under
08:07; any repair, wider mutation or unresolved shared-contract incompatibility returns to the driver/owner before that work.
