# A1089 Fiscal Environment Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL after separate build approval: use
> superpowers:executing-plans to implement this plan task by task, inline. Steps use checkbox
> (`- [ ]`) syntax. Do not dispatch subagents as a routine execution requirement.

**Goal:** Let you inspect a fiscal-environment incident in the running dashboard, read limited
evidence again, sign in for permitted details and stop, without changing fiscal or saved state.

**Architecture:** Resolve the incident on the server, then ask an optional fiscal contribution to
verify its association with an immutable record. Combine that answer with separately observed
database, boot and allowlisted saved facts; a contributed browser action opens an in-memory
inspection. Share authentication and action generations across the real shell, request callbacks and
connection callbacks so an old answer cannot cross accounts or reopen a stopped inspection.

**Tech Stack:** TypeScript, Hono, Drizzle/node:sqlite, Lit, existing dashboard-kit/UI primitives,
Vitest with real venue databases and Chromium, axe.

**Spec:**
[2026-10-28 fiscal-environment design](../specs/2026-10-28-a1089-fiscal-environment-recovery-design.md),
read in full with this plan. Owner decision **2026-10-29 01:58: A, planning only**, supersedes its
historical “awaiting scope approval” wording for planning. Every build needs separate owner
approval.

## Global Constraints

- Scope: the current running dashboard only. Persistent repair, failed-start access/authentication,
  host correction, supervisor ownership, restart and rollback remain **OPEN**. This does not
  complete A1089.
- Inspection sends no network/AEAT request and performs no write, stamp, reset, restore, retry or
  acknowledgement. Its browser GET to this box is the evidence transport. Mark handled remains an
  independent action.
- Never modify fiscal writers, hashes, chains, number allocation, migrations or protected fixtures.
  Keep `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts`
  byte-identical, and preserve all five existing drain environment cases and their assertions.
- No generic regime imports, fiscal SQL in the host, module-boundary allowlist growth, new
  dependency or external-policy claim. Module absence is a supported unavailable answer.
- Require `fiscal.view` before incident/record facts and `system.manage` before **any** host or
  saved-source read. Recheck session identity and both relevant permissions before response. GET is
  passive and uses `touch: false`, with no change-log drain.
- Keep evidence in memory only: no export, diagnostic persistence, evidence in URLs or local/session
  storage, or polling. Separate observations are never an atomic cross-resource snapshot.
- Five-second diagnostic read deadline; cancellation invalidates results and busy-state ownership.
  Bound disposal of owned late work as specified below. Sign-in is a separate identity write and
  cannot be silently abandoned after submission.
- EN/ES, declared `--wt-*` tokens, real field/dialog primitives, keyboard/focus and both themes.
  Guides use matching explicit heading IDs. No installer/support referral stands in for a missing
  repair.
- A696/A739/A1155 reserve generic shell/server work; A1167 reserves boot work; the certificate plan
  also needs shell/auth continuation. This plan grants **no runtime reservation or build approval**.
  Before execution, re-read their actual diffs, coordinate ownership and qualify any reused
  implementation against these assertions; do not overwrite it or assume matching names mean
  matching behavior. No live settings/model edits.

## Review Focus

1. A genuine incident whose saved `registroId` points at another sale must not expose that record or
   current host facts: Task 1 association test and Task 3 real-route test.
2. Empty process input, an empty winning state value and a changed file after boot must produce
   different source/value facts: Task 2 precedence and temporal-separation tests.
3. Revoking host permission during a slow saved read must disclose no host facts; revoking fiscal
   permission must disclose no evidence: Task 3 final-authorization tests.
4. Stop after sign-in submission may still accept a cookie: Task 4 shell tests must reconcile the
   real account without replaying inspection or logging out.
5. An old response, expiry signal, activity callback or connection event after close/reopen/account
   switch must neither repaint nor release the new busy gate: Tasks 4 and 5 generation tests.

---

## Source orientation and file responsibilities

These are **source-inspection references at `8fc7f3ff0`**, not executed qualification. Reorient at
the approved build's base.

| Existing boundary                     | Receipt and implication                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incident production and lookup        | `packages/fiscal-verifactu/src/drain.ts:661` records `registroId`, host and optional record environment; `:1616` associates a `fiscal_filing` incident with `sale_id`. `packages/core/src/incidents.ts:267` exports `findIncident(tx, id)`. Check the row association, not just the parameter's UUID spelling.                                                 |
| Fiscal seats and browser contribution | `packages/fiscal/src/contribution.ts:128` declares `FiscalContribution`; `:121` has the select-only outbox seat. `packages/fiscal-verifactu/src/slot.ts:50` supplies the implementation; `src/dashboard/index.ts:8` supplies the browser contribution. `packages/dashboard-kit/src/contract.ts` has no incident-action or sign-in-continuation contract today. |
| Stamp versus history                  | `packages/db/src/deployment.ts:56` returns the stamp or null; `apps/server/src/deployment-guard.ts:18` uses a **history classification**, not a stamp. Do not invoke the guard to manufacture inspection facts.                                                                                                                                                |
| Actual configuration handoff          | `apps/server/src/box-env.ts:7` orders secrets/trading/backup; `:28` overlays nonempty process values. `node-entry.ts:659` loads and calls `startServer(env, base)`; `boot.ts:843` currently accepts `(env, base = {}, seams = {})`. `config.ts:338-384` parses environment, dev mode and onboarding intent.                                                    |
| Session and drain                     | `packages/identity/src/management-session.ts:56` resolves with `{ touch: false }`; `packages/db/src/tenancy.ts:30` drains changes on every `withTransaction`. `apps/server/src/me-api.ts:326` uses no-touch resolution but its `asStaff` wrapper still drains. Neither existing alert-list GET nor session-me is a no-write inspection template.               |
| Actual browser lifecycle              | `apps/dashboard/src/main.ts` wires API/module requests, session signals and `LiveConnection`; `dashboard-app.ts:999`, `:1171`, `:1417`, `:1556` own generation, probes, expiry and login completion. `screens/login-screen.ts:645` can submit before its local generation check. An ignored completion cannot undo Set-Cookie.                                 |
| Existing request support              | `packages/dashboard-kit/src/request.ts` has `passive` and `timeLimitMs`; callbacks run before consumer rejection. `live-connection.ts` fences its own stream identity. Both need the shared authentication fence, not merely a panel-local counter.                                                                                                            |

New leaf files own wire types, fiscal association, boot provenance, saved-source reads, the server
route, shared lifecycle primitives and the contributed panel respectively. Exact paths and
signatures follow in their owning tasks. Existing sibling tests to retain/read: `slot.test.ts`,
`box-env.test.ts`, `alerts-api.test.ts`, `me-api.test.ts`, `dashboard-app.login-unsaved.test.ts`,
`screens/login-screen.test.ts`, and the fiscal dashboard certificate `index`, `client`, dialog and
axe suites.

## Contract decisions (all proposed, except named existing functions)

Declare browser-safe wire types in **new** `packages/fiscal/src/environment-evidence-types.ts`;
export types through `packages/fiscal/src/index.ts`. Browser code imports these with `import type`,
never the fiscal runtime. `Environment = "production" | "preproduction"`;
`Intent = "demo" | "prepare" | "live"`; all wire timestamps are ISO strings. Use these exact
discriminated unions:

```ts
type Fact<T> =
  | { state: "known"; value: T }
  | { state: "unknown"; reason: "metadata_null" | "no_stamp" | "unset" | "source_untracked" }
  | { state: "unavailable"; reason: "missing" | "unreadable" | "invalid" };
type Observed<T> = { observedAt: string; fact: Fact<T> };
type Source =
  | { kind: "process" }
  | { kind: "state"; file: StateFile }
  | { kind: "default" }
  | { kind: "unknown" };
type StateFile = "secrets.env" | "trading.env" | "backup.env";
type Sourced<T> = { fact: Fact<T>; source: Source };
type BootEnvironmentEvidence = {
  capturedAt: string;
  environment: Sourced<Environment>;
  developmentMode: Sourced<boolean>;
  onboardingIntent: Sourced<Intent>;
};
type SavedFileEvidence = {
  file: StateFile;
  observedAt: string;
  contents:
    | {
        state: "readable";
        environment: Fact<Environment>;
        developmentMode: Fact<boolean>;
        onboardingIntent: Fact<Intent>;
      }
    | { state: "unavailable"; reason: "missing" | "unreadable" | "invalid" };
};
type WhenDetected = {
  incidentId: string;
  detectedAt: string;
  code: "fiscal.environment_mismatch" | "fiscal.environment_unknown";
  claimedRecordId: Fact<string>;
  recordEnvironment: Fact<Environment>;
};
type RecordEnvironmentEvidence =
  | { state: "verified"; recordId: string; environment: Fact<Environment> }
  | {
      state: "unavailable";
      reason: "seat_absent" | "missing" | "unreadable" | "invalid" | "association_mismatch";
    };
type HostEvidence =
  | { access: "restricted" }
  | { access: "included"; boot: BootEnvironmentEvidence; saved: readonly SavedFileEvidence[] };
type CurrentEvidence =
  | {
      state: "unavailable";
      reason: Exclude<RecordEnvironmentEvidence, { state: "verified" }>["reason"];
      observedAt: string;
    }
  | {
      state: "verified";
      record: Observed<Environment> & { recordId: string };
      databaseStamp: Observed<Environment>;
      host: HostEvidence;
    };
type FiscalEnvironmentEvidence = {
  whenDetected: WhenDetected;
  detectedHost: { access: "restricted" } | { access: "included"; environment: Fact<Environment> };
  current: CurrentEvidence;
  authorizedUntil: string;
};
```

`detectedHost` is also saved incident evidence, never today's host. It is separately permissioned
because incident params include `hostEnvironment`; do not spread params. Unknown-record incidents
map historical record environment to `unknown/metadata_null`. Malformed historical values map to
`unavailable/invalid`; missing required saved parameters are invalid, not inferred. A valid-looking
claimed id remains a claim until the fiscal seat verifies association. If association is
unavailable, return **no current facts**, including stamp/host/saved files. A null stamp is
`unknown/no_stamp`, never `nonproduction`; history classification is deliberately absent from this
response. A missing record is unavailable, never unknown metadata.

## Task 1: Verify the incident-to-record association inside the fiscal module

**Files:** Create `packages/fiscal/src/environment-evidence-types.ts`,
`packages/fiscal-verifactu/src/environment-evidence.ts`,
`packages/fiscal-verifactu/src/environment-evidence.test.ts` ; modify
`packages/fiscal/src/{contribution,index}.ts`, `packages/fiscal-verifactu/src/slot.ts`. Test through
`FISCAL_SLOT`, using `slot.test.ts` fixtures and `useVenueDb` with `../test/migrations.ts`.

**Interfaces:** Add optional `FiscalContribution.environmentEvidence?: FiscalEnvironmentSeat`.
Define/export
`FiscalEnvironmentIncident = { id: string; code: string; source: string; deviceId: string | null; saleId: string | null; params: Readonly<Record<string, unknown>> }`
and
`FiscalEnvironmentSeat.read(tx: Transaction, incident: FiscalEnvironmentIncident, signal: AbortSignal): Promise<RecordEnvironmentEvidence>`.
Produce `readRecordEnvironment` with the same signature in the new regime file and bind it in
`FISCAL_SLOT`.

- [ ] Write failing cases `verifies the saved incident against its sale`,
      `distinguishes null from missing`, and `does not substitute a record from another sale`
      (Review Focus 1). Use real records with production/preproduction/null metadata, and exact
      `toEqual` answers; reject wrong code, source other than `fiscal_filing`, non-null incident
      device, null/wrong sale, malformed/injected id and invalid environment. An old incident linked
      to an older SIF on its genuine sale remains inspectable; current node/SIF identity is not
      invented as an extra gate.
- [ ] Run
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/environment-evidence.test.ts`;
      observe the expected missing-seat/read failure, not fixture/loader errors.
- [ ] Implement select-only lookup of `registrosFacturacion.id`, `saleId`, `entorno` in the module.
      Validate saved code/source/sale/id before returning immutable environment; handle missing
      table/row, sanitized unreadable failure and cancellation. Read no invoice payload, secrets or
      authority transport. Check `signal` before/after awaits. Export type-only contracts without
      importing Node/database runtime into the wire leaf.
- [ ] Repeat that command; require the actual passing Tests count. Run
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/slot.test.ts` for seat
      integration. Preserve the assertions already there.
- [ ] Commit:
      `git add packages/fiscal/src packages/fiscal-verifactu/src/environment-evidence.ts packages/fiscal-verifactu/src/environment-evidence.test.ts packages/fiscal-verifactu/src/slot.ts && git commit -s -m "feat: add read-only fiscal environment evidence seat"`

## Task 2: Capture boot provenance and observe saved inputs separately

**Files:** Create `apps/server/src/environment-provenance.ts`, `environment-provenance.test.ts`,
`environment-saved.ts`, `environment-saved-worker.ts`, `environment-saved.test.ts`,
`boot.environment-evidence.test.ts`; modify `apps/server/src/{box-env,node-entry,boot}.ts` and their
existing tests, `apps/server/package.json`, `apps/server/scripts/dev-server.mjs`,
`deploy/Dockerfile`, `scripts/deploy-image-env.test.ts`. These are future coordinated edits,
especially A1167's boot boundary.

**Interfaces:** In `environment-provenance.ts`, define
`EnvironmentSources = { environment: Source; developmentMode: Source; onboardingIntent: Source }`,
`captureBootEnvironment(config: Pick<ServerConfig, "environment" | "devMode" | "onboardingIntent">, sources: EnvironmentSources | undefined, at: Date): BootEnvironmentEvidence`,
using existing `ServerConfig` from `config.ts`. Extend existing
`loadBoxEnv(base: NodeJS.ProcessEnv, stateDir: string, observe?: (sources: EnvironmentSources) => void): Promise<NodeJS.ProcessEnv>`
with an optional callback; extend `EntryDeps.loadBoxEnv` identically. Extend
`startServer(env: Record<string, string | undefined>, base: NodeJS.ProcessEnv = {}, seams: StartServerSeams = {}, environmentSources?: EnvironmentSources): Promise<StartedServer>`
with a fourth argument; extend
`EntryDeps.startServer(env: NodeJS.ProcessEnv, base?: NodeJS.ProcessEnv, sources?: EnvironmentSources): Promise<{ close(): Promise<void> }>`
and adapt the real entry call with `(env, base, sources) => startServer(env, base, {}, sources)`.
Existing two/three-argument callers keep their meanings. Add
`readSavedEnvironment(stateDir: string, signal: AbortSignal): Promise<readonly SavedFileEvidence[]>`
in `environment-saved.ts`.

- [ ] Write failing `captures the actual winning source` and
      `boot evidence survives a later file change` cases (Review Focus 2). Assert whole
      environment/dev/intent/source shapes for nonempty process wins, empty process fallback,
      secrets then trading then backup, an empty later state value masking an earlier value, no
      values/default preproduction + dev false + unset intent, `dev`, all three intents and invalid
      spellings/combinations. The winning empty state value gives environment/dev defaults; it does
      not restore the earlier file. A winning empty state value retains its state-file source; an
      absent merged key has default source. Include unreadable/skipped boot file and a boot caller
      that supplies no provenance: actual config values remain known but source is unknown.
- [ ] Write saved-input cases for missing/unreadable/invalid files, unset versus null metadata,
      valid `dev`, changed-since-boot and contradictory files. Seed unique secrets/account-key/error
      markers and assert absence from output and logs. Only `WAITRON_ENV` and
      `WAITRON_ONBOARDING_INTENT` are read into evidence; development mode derives from the former.
      Missing/empty keys in a readable saved file are `unknown/unset`, not effective defaults.
      Invalid intent/environment combinations are invalid facts, not boot failures or repairs.
- [ ] Run
      `pnpm --filter @waitron/server exec vitest run src/environment-provenance.test.ts src/environment-saved.test.ts src/box-env.test.ts`;
      confirm new assertions fail for missing provenance/reader.
- [ ] Implement provenance during the **same merge** that returns boot env, then capture config
      values immediately after `loadConfig` in `bootServer`. `node-entry` passes captured source
      labels alongside the existing merged/original env; never retain merged env in the diagnostic
      object or reconstruct boot sources from current files. Leave every other `loadBoxEnv` consumer
      and parse/default behavior intact. Synthetic callers without capture must report unknown
      source, even when values equal a file.
- [ ] Implement current saved reads in an owned worker, fixed filenames only, one regular file at a
      time, at most 64 KiB each. Open with `O_NOFOLLOW`/`O_NONBLOCK`, check the descriptor with
      `fstat`, and reject symlinks/nonregular/oversized files as invalid; sanitize errors. Use
      existing `parseEnvFile` semantics, including last assignment, then validate only allowlisted
      values without returning raw text. Each file gets its own observed time. Terminate the worker
      on abort; settle/observe termination within 1,000 ms and remove listeners/timers. A worker
      failure yields sanitized unavailable facts; do not retry or write. Cover worker exit/abort,
      descriptor cleanup and a usable next read, not merely a raced-away promise.
- [ ] Ship that worker explicitly: add
      `src/environment-saved-worker.ts=dist/environment-saved-worker.js` to the existing
      `bundle-node.mjs` build pairs and copy its bundle and `.NOTICES.txt` beside the existing
      server bundles/notices in `deploy/Dockerfile`. Worker input is only `{ stateDir }`, its
      environment is empty, and its sole output is `SavedFileEvidence[]`; parent rejects any other
      output shape. Use a bundled worker in the real worker test (temporary test output), not an
      assumed `.ts` loader. Test missing/denied worker as unavailable, never a synchronous unbounded
      fallback. Add a failing image-copy assertion first, then run
      `pnpm exec vitest run scripts/deploy-image-env.test.ts` to green; the approved build must
      smoke the emitted worker too. Export `environmentSavedWorkerUrl(moduleUrl: string): URL`: a
      source `.ts` parent resolves `../dist/environment-saved-worker.js`, a built parent resolves
      sibling `./environment-saved-worker.js`. Add `build:environment-worker` to the server manifest
      with the same bundle pair, and have `scripts/dev-server.mjs` run it successfully before
      starting tsx; no on-demand build occurs inside inspection. Add a built-layout smoke that
      launches the emitted worker without tsx, reads known saved values, aborts a held read and
      observes termination within 1,000 ms. Assert both source/built URL resolution, missing bundle
      refusal and valid next read; include notices in the image smoke.
- [ ] Repeat focused tests and
      `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts`; add
      `src/boot.environment-evidence.test.ts` to exercise the real handoff and capture with existing
      boot fixtures. Require passing counts and unchanged original loader assertions. Add that new
      test to the commit.
- [ ] Stage only these task paths;
      `git commit -s -m "feat: capture fiscal environment input provenance"`.

## Task 3: Serve the incident-bound read without touching sessions or draining changes

**Files:** Create `apps/server/src/fiscal-environment-api.ts`, `fiscal-environment-api.test.ts`,
`fiscal-environment-read.ts`, `fiscal-environment-read.test.ts`; modify `apps/server/src/boot.ts`,
`errors.ts`. Route tests use real module seat/database, existing composition/migration fixtures and
the permission-override pattern in `alerts-api.test.ts`; no new dependency loop or regime import in
production host code.

**Interfaces:** Export
`mountFiscalEnvironmentApi(app: Hono, deps: FiscalEnvironmentApiDeps, log: Logger): void`; deps are
`{ db: Database; seat?: FiscalEnvironmentSeat; boot: BootEnvironmentEvidence; readSaved(signal: AbortSignal): Promise<readonly SavedFileEvidence[]>; now(): Date }`.
Export
`readFiscalEnvironmentTurn<T>(db: Database, signal: AbortSignal, read: (tx: Transaction) => Promise<T>): Promise<T>`
from `fiscal-environment-read.ts`. It runs sequential **select-only** work on the existing handle
outside any write-transaction context, with cancellation checks, no queued write turn,
`withTransaction`, change drain or delivery. This deliberate read boundary makes no database
snapshot promise. Do not reuse an authentication attempt's `inTurn` or a draining wrapper.

- [ ] Write failing real-GET tests for `/management-api/fiscal-environment/incidents/:id`: exact
      full wire shape for mismatch/null/matching record and absent stamp; no current facts for
      missing/disabled seat, missing row, forged association or malformed saved params. UUID
      validation is not association proof. Reject query/body options, injected paths/SQL and
      unsupported incident code with `management.request_invalid` (400) or `alert.not_found` (404),
      using existing error codes and imported registries.
- [ ] Add missing/expired/revoked/suspended session and missing-fiscal cases; expect existing
      401/403 codes and zero record/host reads. Fiscal-only access returns restricted host arms and
      **zero** boot/saved-source reads, including detected host. Pause saved reads, change
      permissions/session row, resume: loss of fiscal permission refuses the entire answer; loss of
      system permission removes both host arms (Review Focus 3). Recheck session row id/person id
      even for a new session of the same account; mismatches refuse, never combine identities.
- [ ] Run
      `pnpm --filter @waitron/server exec vitest run src/fiscal-environment-api.test.ts src/fiscal-environment-read.test.ts`;
      observe the missing-route/read-boundary failures.
- [ ] Implement no-store success **and refusal** responses. Resolve `requireManagementSession`
      /`resolveManagementSession(tx, token, { touch: false })` and permissions before any incident
      access; fetch `findIncident` server-side. Pass only that incident to the seat. Only after
      verified association read `readDeploymentEnvironment`; host/saved facts require a separate
      system gate. Before serialization resolve the same cookie again without touch, compare session
      row/person, recheck fiscal/system rights and expiry, then project the allowlisted response.
      Never serialize whole incident params, exceptions or env. `authorizedUntil` is the final
      no-touch session expiry.
- [ ] Enforce 5,000 ms from handler entry across read/body work, with request-abort propagation. Use
      bounded primary-key/limit selects outside write turns, no lock held over worker/file waits;
      check cancellation before every next read and before response. Declare proposed
      `diagnostics.read_timed_out: { deadlineMs: number }` in `errors.ts`, return it as 504 with
      `deadlineMs: 5000`, discard partial data and dispose the saved worker within Task 2's 1,000 ms
      allowance. Browser transport timeout remains existing `connection.timed_out`; the panel
      renders both as a read timeout. Sink late rejections and prevent late work from sending a
      response. Test a held unrelated writer, a delayed worker and abort before/after authorization;
      no deferred callback may start a source read after cancellation.
- [ ] Compare real before/after logical snapshots on success, repeat, refusal, timeout and
      cancellation: immutable record bytes, SIF/chain rows, invoice counters, outbox attempts/state,
      deployment stamp, incident acknowledgement/notes, sessions including last-seen, and pending
      change-log rows; compare state-file bytes. Warm inspection connections before file
      fingerprints. Assert zero submission/transport, stamp/config writes,
      restore/reset/retry/acknowledgement calls, and zero change notifications. Keep background
      duties off in these isolated fixtures; this is a claim about inspection's work, not the live
      box's other duties.
- [ ] Repeat focused tests with passing counts; mount the enabled optional seat and boot capture in
      `boot.ts`, add real-boot route cases to `boot.environment-evidence.test.ts`, and test
      absent-seat boot too. `git add` only Task 3 paths and that boot test;
      `git commit -s -m "feat: expose incident-bound read-only environment evidence"`.

## Task 4: Make in-place sign-in and stale callbacks safe through the actual shell

**Files:** Create `packages/dashboard-kit/src/auth-generation.ts`, `auth-generation.test.ts`; modify
its `index.ts`, `request.ts`, `request.test.ts`, `live-connection.ts`, `live-connection.test.ts`;
create `apps/dashboard/src/inspection-auth.ts`, `inspection-auth.test.ts`,
`dashboard-app.inspection-auth.test.ts`. Modify
`apps/dashboard/src/{main,dashboard-app,session-signals}.ts`, `session-signals.test.ts`,
`api/client.ts`, `screens/login-screen.ts`, `screens/login-screen.test.ts`, and
`apps/server/src/me-api.ts`, `me-api.test.ts`. Qualify shared code already supplied by the reserved
branches/certificate work first.

**Interfaces:** `AuthGeneration` exports `capture(): number`, `invalidate(): number`,
`isCurrent(generation: number): boolean`, `subscribe(listener: () => void): () => void`. Pass the
same instance as `authGeneration?: AuthGeneration` to shell, `createRequest` options,
`LiveConnection` options and `DashboardApi`'s new optional sixth constructor argument (preserve
existing fifth `passive`); propagate into `background`. Add `RequestOptions.signal?: AbortSignal`,
`isCurrent?: () => boolean` and `sessionErrors?: "caller"`. Caller-handled
required/expired/suspended errors still reject to the caller but skip global session dispatch; this
never suppresses `node.reset`. Request callbacks require both captured auth generation and optional
action predicate for account/activity effects. A decoded `node.reset` bypasses both predicates and
caller-handled session errors: it is a global box fact. Define
`InspectionAuthHost = { generation: AuthGeneration; requestSignIn(input: { actionId: string; requiredPermissions: readonly string[] }): Promise<"signed_in" | "stopped" | "unresolved">; trackSubmission<T>(work: Promise<T>): Promise<T> }`
in dashboard-kit's `contract.ts`.

`InspectionAuthController` in `inspection-auth.ts` implements that host plus `stop(): void` and
`reconcile(): Promise<"signed_in" | "signed_out" | "unresolved">`. Its constructor takes
`{ generation: AuthGeneration; readSession(): Promise<InspectionSession>; applySession(session: InspectionSession | null): void; showLogin(host: InspectionAuthHost): void; closeLogin(): void }`
, where `InspectionSession = Awaited<ReturnType<DashboardApi["getMe"]>>`. The shell owns it beyond
any panel/login unmount. `trackSubmission` preserves the credential request's original
result/refusal while scheduling reconciliation independently of local UI generations; ordinary
second-factor refusals leave the normal form usable.

**Shared ownership:** `AuthGeneration` is an adapter over the certificate plan's proposed
`SessionEpoch`, using the shell's existing session generation as the only counter. Its
`capture`/`invalidate` delegate to `current`/`advance`; subscriptions observe those same advances.
`InspectionAuthController` adapts the same shell-owned `PermissionContinuation`, including its
submitted-authentication settlement registry. If either plan builds first, provide these adapters
over that owner; never install a second epoch, login controller or request/session callback fence.
Keep existing `sessionGeneration` getters compatible, and preserve the certificate continuation's
default methods and login choices. These are planning contracts, not assumed implementations.

Define a shell-owned, memory-only
`InspectionReturn = { actionId: string; incidentId: string; returnFocus: HTMLElement | null; stopped: boolean }`.
Capture only this descriptor before sign-in, never evidence, credentials or an old module handle.
Invalidation closes the old handle and clears protected content but retains an unstopped descriptor
through contribution rebuilds. After cookie/session reconciliation, recheck the new account's
`fiscal.view` and reconstruct a new empty handle only when the descriptor remains current and
unstopped. That handle starts in `awaiting-read`, so Read again is available and zero inspection
GETs run automatically. Missing permission clears the descriptor and offers in-place sign-in without
exposing incident evidence. Stop, navigation, shell disconnect and node reset discard it; a late
accepted login may update session identity but cannot reopen a stopped inspection.

- [ ] Write failing shell cases using real `DashboardApp`, login screen and request primitive:
      fiscal viewer requests host sign-in at the panel; password/TOTP/recovery success needs an
      explicit Read again; wrong/unknown/suspended account and throttle preserve normal generic
      refusals. A replacement account lacking fiscal permission sees no old evidence. Do not
      shortcut by faking a `logged-in` event. Stub `navigator.credentials`, retain the real WebAuthn
      library; modal passkeys open only on a press, never on expiry, re-render or navigation.
- [ ] Add Review Focus 4/5 races: Stop before submission; Stop **after** password/passkey
      verification submitted but before accepted Set-Cookie; accepted cookie followed by lost
      response; late failed login after another account signs in; old session
      probe/activity/expiry/SSE events after switching, including same-person new session. Delay
      both response and body. No automatic inspection replay, logout, old-account resurrection, busy
      release or evidence repaint. Read again stays barred while a submitted session outcome is
      unresolved. Also assert stale request/action/session/SSE delivery of `node.reset` performs the
      existing full reset, while stale required/expired/activity callbacks stay ignored. Preserve
      ordinary reset assertions and add a current-callback control. Exercise real `#applyMe`
      contribution rebuild: successful sign-in reconstructs exactly one new `awaiting-read` handle,
      with zero GETs before Read again; Stop before settlement never reconstructs one; the new
      account without `fiscal.view` sees no incident facts.
- [ ] Run
      `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.inspection-auth.test.ts src/inspection-auth.test.ts src/session-signals.test.ts`;
      confirm intended missing-continuation/fence failures. Run kit red cases with
      `pnpm --filter @waitron/dashboard-kit exec vitest run src/auth-generation.test.ts src/request.test.ts src/live-connection.test.ts`.
- [ ] Implement one shared auth generation and per-action generations. Invalidate evidence
      immediately on sign-in start/completion, logout, expiry/revocation, permission change, account
      switch and shell disconnect. Fence **before** request `onError` /`onSuccess`, API
      observed-fetch menu revision updates, shell probes, session signals/activity timers and live
      connection callbacks; a panel's check after rejection is too late. Preserve valid current
      callbacks as negative controls. Compose abort signals with the existing read timer, cancel
      late response bodies, remove listeners and observe abandoned promises. Decode and dispatch
      `node.reset` before every auth/action stale filter, including request `onError`, session
      signals and live callbacks; it still performs the full reset. Do not exempt stale activity or
      ordinary session refusals.
- [ ] Keep the existing login UI mounted inside the shell's inspection continuation, preserving
      unsaved-change coordination and the return focus target. Add
      `LoginScreen.inspectionAuth?: InspectionAuthHost`; use the shared continuation mode, retaining
      explicit password/second-factor, passkey and Google choices while suppressing automatic
      post-login enrolment. A Google redirect may retain only the existing nonsecret return marker
      (action id/incident id, no evidence or credential); after return reconcile the actual session
      and require explicit Read again. A Stop clears that marker too. Ordinary login
      methods/preferences remain intact. Explain that signing in changes the dashboard account. Call
      `trackSubmission` at actual cookie-setting login/verification submission **before** local
      generation guards, including passkey verification. The shell retains this reconciliation after
      the login/panel closes; Stop of this continuation also invalidates the shared auth generation
      without assuming logout.
- [ ] On Stop, close inspection and abort unsent ceremonies; do not abort or forget a submitted
      identity request. Await its settlement and do one fresh passive session-me reconciliation;
      even a failed/lost login response has unknown cookie outcome. Change
      `GET /management-api/session/me`'s own read to a no-touch/no-drain turn (other routes
      unchanged), return additional `sessionIdentity: string` from `sessionRowId`, and add
      `DashboardApi.getMe(options?: RequestOptions)` to pass
      `{ passive: true, timeLimitMs: 5000, sessionErrors: "caller" }` during reconciliation. Adopt
      the observed identity in the shell, discard evidence and require Read again. Serialize
      replacement sign-ins until reconciliation; if the outcome cannot be read, show unresolved and
      offer an explicit session check, never replay login/logout or assume the old cookie survived.
      No polling; submitted work remains tracked until known, including after Stop. No five-second
      abort is applied to the submitted identity POST itself.
- [ ] Repeat those tests plus `src/screens/login-screen.test.ts` and
      `src/dashboard-app.login-unsaved.test.ts`; run
      `pnpm --filter @waitron/server exec vitest run src/me-api.test.ts` and assert session-me
      preserves pending change-log and last-seen. Retain whole-response assertions, deliberately add
      `sessionIdentity` in every owning shape fixture, and trace all `getMe` callers. Stage only
      task paths;
      `git commit -s -m "feat: fence inspection sign-in through dashboard session lifecycle"`.

## Task 5: Contribute the inspection action and read-only panel

**Files:** Modify `packages/dashboard-kit/src/contract.ts`, `contract.test.ts`; create
`packages/fiscal-verifactu/src/dashboard/environment-client.ts`, `environment-client.test.ts`,
`environment-inspection.ts`, `environment-inspection.test.ts`, `environment-strings.ts`,
`environment-inspection.a11y.test.ts`. Modify its `dashboard/index.ts`, `index.test.ts`; modify
`apps/dashboard/src/dashboard-app.ts`, `widgets/{alert-format,alerts-bell}.ts`, their tests, and
`screens/alerts-screen.ts`, `alerts-screen.test.ts`.

**Interfaces:** Add optional
`DashboardContribution.incidentActions?: readonly DashboardIncidentAction[]`.
`DashboardIncidentAction = { id: string; codes: readonly string[]; labelKey: string; requiresPermission: string; create(ctx: DashboardModuleContext, incidentId: string, options?: { initialRead: "automatic" | "explicit" }): DashboardScreenHandle & { close(): void } }`
. Extend `DashboardModuleContext` with optional `inspectionAuth?: InspectionAuthHost`. Produce
`FiscalEnvironmentClient(request: DashboardRequest).read(incidentId: string, signal: AbortSignal, isCurrent: () => boolean): Promise<FiscalEnvironmentEvidence>`.
Produce `dashboard-fiscal-environment-inspection` with properties `client`, `incidentId`,
`inspectionAuth`, and `initialRead: "automatic" | "explicit"` (default `"automatic"`); `close()`
clears evidence/credentials and emits `inspection-closed` once. The shell constructs a contributed
handle per opening and closes it on generation change. Its Task 4 return descriptor survives sign-in
only as specified there; reconciled sign-in reconstructs a new empty `awaiting-read` handle, never
the old one. Render the handle outside alert list refresh lifetimes.

- [ ] Write failing contribution/client/panel cases: only the two environment **event** codes
      receive `fiscal-environment-inspect` with `fiscal.view`; absent/disabled modules and ongoing
      alerts receive none. Generic alert consumers select contributed actions by code/permission and
      send only incident id. Test bell and Alerts page through real shell; no generic regime
      name/import or fake repair-screen destination.
- [ ] Write exact rendered states for loading, historical/current mismatch, null preserved
      unchanged, unavailable/missing/invalid evidence, host restricted, expired and stale. Verify
      `When detected` versus current/boot/saved labels and separate times; current matching facts
      never rewrite an old mismatch or imply repaired. Seed historical secret keys and check
      DOM/network/log output. An ordinary user opening reads once; a reconstructed post-sign-in
      handle waits for explicit Read again. Read again explicitly replaces evidence; no
      evidence-data subscription/cache/storage/export/polling is created. Authentication-generation
      subscriptions remain required.
- [ ] Add Review Focus 5: delayed read across Stop/reopen, overlapping Read again, sign-in, expiry
      and account switch. At 5,000 ms show a bounded read failure; late success/error/finally cannot
      paint or unlock the newer read. Fresh opening is immediately usable. Test valid current
      success and failure alongside stale suppression; use controlled deferred promises, not sleeps.
- [ ] Run
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/environment-client.test.ts src/dashboard/environment-inspection.test.ts src/dashboard/index.test.ts`;
      confirm missing action/panel failures. Run dashboard owning shell/alert tests for the same red
      cases.
- [ ] Implement the contributed action via enabled `DASHBOARD_MODULES`, and add it beside existing
      alert actions. The client calls only the incident GET with
      `{ passive: true, timeLimitMs: 5000, signal, isCurrent }`. A panel holds an opening id,
      monotonic read id and captured auth generation; all completion/error/finally paths must own
      all three. New read aborts the previous one and clears its evidence. Sign-in resolution never
      triggers a read; leave Read again explicit. Pass `{ initialRead: "explicit" }` to the
      reconstructed contribution factory and set the component property identically; that mount
      enters `awaiting-read` without a GET. Ordinary openings omit the option.
- [ ] Use spec EN/ES copy: Inspect environment / Examinar entorno, Read again / Volver a leer, Sign
      in for host details / Iniciar sesión para ver datos del equipo, Stop / Cerrar inspección.
      Include “Nothing was changed”, unknown metadata preserved unchanged and persistent repair
      unavailable. Stop closes only inspection, with no claim about venue-wide sales. Keep Mark
      handled outside the panel and never invoke it from inspection, Stop or sign-in. Keep
      credentials within the existing login screen, not evidence objects.
- [ ] Repeat focused tests with passing counts and kit contract tests. Assert native buttons render,
      Stop/Escape emit closure and return focus, headings/announcements reflect state, and a new
      opening has a new busy gate. Stage only Task 5 paths;
      `git commit -s -m "feat: add contributed fiscal environment inspection panel"`.

## Task 6: Qualify no-write behavior, omission controls and the visible journey

**Files:** Extend the owning tests from Tasks 1–5; modify `apps/server/src/guide/en/box-status.md`,
`es/box-status.md`, and `apps/dashboard/src/help-guide.ts` only if a new guide link is added. Add
matching `{#fiscal-environment-inspection}` headings. No baseline test/fixture rewrites. Keep
qualification receipts in commit/PR text, not as new permanent runtime history.

- [ ] For any qualification assertion missing from an owning suite, add it first, observe its
      expected red failure, implement only the missing approved behavior, then repeat that owning
      command to green. Use real database/state snapshots from Task 3 and whole wire/DOM field
      assertions; retain original behavioral assertions across refactors.
- [ ] In a disposable copy of the complete candidate, make one omission at a time, recording
      command, failure assertion and restoration: delete initial fiscal gate, initial system gate,
      final permission recheck, record association check, provenance capture, stale-generation
      checks (including request callbacks), and no-drain boundary. Each must fail its owning
      disclosure/association/source/stale/snapshot assertion, not compilation. Pair with valid
      fiscal-only/authorized requests, absent seat, genuinely unknown source, current callback,
      independent concurrent writer and empty-change-log cases that still pass. Never perform
      controls by swapping files in the feature checkout.
- [ ] In that copy only, remove successor exclusion from `claimBatch`, then separately blocked-chain
      window exclusion; run
      `node scripts/run-with-deadline.mjs 120 --diagnostics -- pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts -t 'deployment-environment guard'`.
      The zero-attempt successor case and healthy-other-chain-beyond-full-window case respectively
      must fail; restore each deletion and require five passing cases. Do not change production
      drain on the feature branch. These receipts establish the named fixtures, never a venue-wide
      sales stop.
- [ ] Run unchanged baselines:
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts -t 'deployment-environment guard'`;
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`;
      `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts src/restore-gate.test.ts src/alerts.test.ts src/alerts-api.test.ts src/box-env.test.ts`.
      Require actual test counts, not exit status alone. Verify
      `git diff --exit-code <build-base> -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
      and unchanged baseline fixtures/five drain cases. These are local fixtures, including fake
      AEAT; neither old nor new results qualify live AEAT, repair or failed-start recovery.
- [ ] Run
      `pnpm exec vitest run scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/guide-links.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`
      and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; inspect actual
      module bundle with the approved worktree stack (`wa-wt demo <approved-worktree-name>`),
      because text guards do not qualify runtime browser purity. No whole-workspace local run solely
      for finishing; normal pre-push checks and current-head CI own the wider gate.
- [ ] Write `environment-inspection.a11y.test.ts` cases using existing `mountThemed`
      /`expectNoA11yViolations` helpers for every distinct state in both themes; run
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/environment-inspection.a11y.test.ts`.
      Restore locale after each case and measure browser headroom before concurrency. Through the
      **actual shell**, LOOK at EN/ES, light/dark, desktop and phone; exercise loading,
      disagreement, unknown, restricted, unavailable, expired/stale, sign-in/second factor/Stop and
      repeated opening. Check native focus, keyboard/Escape, long translated text, announced errors
      and absence of overflow. Save visual/axe/focus receipts for the approved build; none has been
      performed by this planning task.
- [ ] Update both guides in second person to explain the limited facts, separate times, sign-in
      account change, explicit Read again, safe Stop and independent Mark handled. State persistent
      repair unavailable; do not suggest switching environment, reset, restore or retry as the
      remedy. Review changed alert prose for those two codes against the same scope. Stage only
      qualified paths; `git commit -s -m "docs: explain and qualify fiscal environment inspection"`.
      Announce readiness for `finish-branch`; do not merge without the owner's landing instruction.

## Coverage self-review and open work

Self-review performed once against the complete spec: acceptance group **1 → Tasks 1/3**, **2 → Task
2**, **3 → Tasks 3/4**, **4 → Task 3/6**, **5 → Tasks 2–5**, **6 → Task 6**, **7 → Tasks 4–6**. Each
Review Focus case names its owning tests above. Wire types, optional seat, loader callback/fourth
boot argument, request options and contributed action have one definition and named consumers. The
same `InspectionAuthHost` defined in Task 4 is passed by Task 5; no parallel continuation API is
implied. The review corrected the configuration type to existing `ServerConfig`, named the new
server timeout code explicitly, and included the saved-reader worker's actual bundle/image path.

All checks in this plan are prospective. This author read sources and wrote this artifact only; no
tests, installs or runtime probes were performed. Historical spec baseline receipts are fixtures,
not inspection qualification. No legal/external-policy conclusion is introduced, so no external
provenance claim is needed.

**OPEN:** persistent environment repair and unknown-record recovery authority; failed-start
identity/HTTPS/abuse limits/evidence ownership; supervisor correction/restart/rollback; Lane A
setup/backup mutations. Shared shell/server/boot reservations must be resolved against actual
approved diffs before implementation. The driver owns the dated historical-spec pointer and backlog
paragraph; this plan does not edit either. Any shared-code incompatibility or broader build scope
returns for owner approval before implementation.
