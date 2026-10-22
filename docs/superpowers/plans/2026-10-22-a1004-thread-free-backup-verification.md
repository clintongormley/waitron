# A1004 Thread-free Backup Verification Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, task by task. Steps use checkboxes. Read superpowers:test-driven-development before writing implementation or tests.

**Goal:** Run the genuine backup verifier with Node worker threads denied, preserving ordinary server/restore/tool monitoring and venue exclusion.

**Architecture:** Add a store helper that owns a fresh disposable directory and grants a temporary exception only to opens of that exact directory in its asynchronous callback. Keep the SQLite venue lock, share counting and ordinary watchdog startup. Place and migrate the verification copy inside this scope, then close its query handle before removing it.

Choose this over threading a capability through placement, migrations and database APIs: the helper can allocate only a new child, while those ordinary APIs remain unchanged. Its permission is tied to both asynchronous context and canonical directory, never to a process-wide flag.

**Tech stack:** TypeScript, Node `AsyncLocalStorage`, `node:sqlite`, real worker threads, Vitest, existing Node bundler.

**Spec:** Owner's A1004 instructions in this session; `~/waitron-campaign-g/queue.md` A1004 and `~/waitron-campaign-g/RUNNER.md` H2–H13. No separate design document is required.

## Constraints and source trace

- Work in `waitron-fix-a1004-thread-free-backup-verification`. Check other lanes' active diffs before implementation; preserve their work.
- Do not edit fiscal files, `apps/server/src/testing/backup-verification-fixture.ts` (Lane A A947), `scripts/` guards, CLAUDE rules or other lanes' files. Reuse the fixture unchanged.
- `apps/server/src/backup-verification.ts:177,264` allocates scratch and copies `placement.db`; `backup-data-placement.ts:28` restores that copy and calls `applyMigrations`.
- The remaining chain is `packages/migrations/src/apply.ts:migrateEverySet` → `packages/db/src/client.ts:69` → `packages/store/src/index.ts:231` → `venue-lock.ts:85` → `venue-liveness.ts:290` → `Worker`.
- Placement and migrations **write the disposable copy**. Module checks receive read-only `before`/`after` handles (`backup-verification.ts:225,287`); no live venue participates. Do not call the whole path read-only.
- The watchdog detects a holder whose main thread stops ticking and kills its process (`venue-liveness.ts:128,190`). Recommendation: omit this duty only for the fresh verification copy, which holds no live venue hostage; retain exclusion. The verifier's cooperative deadline cannot interrupt synchronous work, so the caller must retain its independent process deadline.
- No permission-denied catch that continues opening, global disable, environment toggle, public `watchdog=false`, or `exclusive:false` workaround. Leave ordinary opener signatures and migration/restore behavior intact.
- Read relevant sections of `docs/developers/{conventions-data,testing-guide,ci-and-gates,workflow-guide,writing-claims}.md`. Preserve coverage bars and behavioral assertions.

## Review focus

- An unrelated asynchronous caller, even while verification is suspended, must retain ordinary monitoring (Task 1).
- Canonical paths, aliases and expired asynchronous contexts must not broaden the exception (Task 1).
- Same-directory promotion and either close order must preserve the lock and active monitoring (Task 1).
- Exceptions and cleanup errors must close handles and prevent a passing verdict with uncertain cleanup (Tasks 1–2).
- A real permission-denied run must exercise placement and all owners, rather than only importing the bundle (Task 2).

## File map

- Create `packages/store/src/verification-venue-copy.ts`: directory ownership/cleanup; `verification-venue-scope.ts`: private asynchronous scope and canonical-directory cleanup gate; sibling `verification-venue-copy.test.ts`: behavior tests. The helper may inspect lock holders; the lock imports only the scope module, avoiding an import cycle.
- Modify `packages/store/src/venue-lock.ts`: track whether each holder started liveness and promote ordinary shares; export only the helper and cleanup-error type through `packages/store/src/index.ts`.
- Modify `apps/server/src/backup-verification.ts`: scope placement/module checks and close `after` locally. Do not change shared placement or migration APIs.
- Create `apps/server/src/backup-verification.permission.test.ts`: real fixture, compiled verifier and permission subprocesses.
- Update only relevant behavior prose in `docs/developers/conventions-data.md` and `testing-guide.md`, plus A1004's backlog entry if present when implementation finishes.

### Task 1: Scope the disposable-copy exception without weakening ordinary opens

**Interfaces:** Export `withVerificationVenueCopy<T>(scratchRoot: string, body: (directory: string) => Promise<T>): Promise<T>` and `VerificationVenueCopyCleanupError extends Error` with `directory: string` and `removalBlocked: boolean` from the store. Internal scope predicates take already-canonical paths; internal `hasVenueLockShares(directory: string): boolean` reads the holder map without exposing it publicly.

**Execution order:** First write Task 2's permission regression harness and observe the genuine unchanged verifier failing at placement. Then complete Task 1 and Task 2's integration. A missing helper/import is insufficient evidence of the reported bug.

- [ ] Add failing tests named `fresh copy keeps the process lock without liveness`, `ordinary sharing promotes before returning`, and `failed promotion preserves existing shares`. Assert observable lock ownership, holder files and actual watchdog presence, not only mocked call counts.
- [ ] Add `unrelated callers stay monitored` using deferred gates: start the ordinary caller outside the helper context while its callback waits; test both another directory and an outside-context share of the exact copy.
- [ ] Add `aliases match only the canonical copy`, `nested and parallel copies stay isolated`, and `expired descendants regain ordinary monitoring`. Cover a symlink to the copy, a sibling/prefix/child path, and a symlink redirected outside it. Capture a deferred descendant within the callback and resume it only after scope expiry.
- [ ] Add `release order preserves monitored holders`: verification-first and ordinary-first, duplicate release, ordinary-first acquisition, and two ordinary shares. Monitoring stays until the holder's final share; a verification-only final release never removes another folder's heartbeat or stops its watchdog.
- [ ] Add success/throw cleanup tests: callback return/error propagation, unique child allocation, empty scratch afterwards, `realpath`/callback/removal failures, and scope revocation before asynchronous cleanup. A removal failure throws `VerificationVenueCopyCleanupError` with its cause; a callback error is preserved when cleanup succeeds.
- [ ] Add `ordinary share outliving callback retains the locked copy`: helper rejects with `removalBlocked=true`, directory/lock/actual watchdog remain, and an independent child is refused until the ordinary share closes. Add an open racing callback settlement; it either obtains its share before cleanup starts and forces retention, or is refused before acquiring a share. Test both schedules with gates, not sleeps.
- [ ] Run `pnpm --filter @waitron/store exec vitest run src/verification-venue-copy.test.ts`; retain the expected RED output. Initial missing-helper failures establish the interface; rerun each behavior as it becomes reachable.
- [ ] Implement the helper with its own `mkdtemp(join(scratchRoot, "verification-venue-"))`; canonicalize using `realpath`. Store `{ directory, active }` in private `AsyncLocalStorage`; never accept an existing directory or register a global exemption. Test the active flag after awaited canonicalization.
- [ ] In `finally`, revoke `active` and mark the canonical child as being removed synchronously before checking outstanding shares. If shares remain, retain the child and throw `VerificationVenueCopyCleanupError` with `removalBlocked=true`. Otherwise keep the cleanup gate through awaited recursive removal, then remove the gate in `finally`; a filesystem failure has `removalBlocked=false`. Clean the allocated child even if canonicalization failed.
- [ ] `lockVenueDirectory` checks the cleanup gate after awaited `realpath`, immediately before its synchronous lock/share section, and refuses acquisitions while removal is running. The gate is a private safety barrier for freshly owned copies, never an exemption. Inherited async work loses the exemption at callback settlement; nested scopes restore the outer context. The callback must await owned work and close its handles on success and exception.
- [ ] Add `monitored: boolean` to `Holder`. In the existing synchronous acquisition section, start liveness unless the exact active scope matches. For an existing unmonitored holder, an ordinary caller must successfully call `beginHolding(key)` before incrementing shares or marking it monitored. A failed promotion propagates unchanged and leaves the existing connection/shares intact; a failed first acquisition closes its new connection.
- [ ] Never demote a monitored holder. On final release, call `endHolding` only if monitoring began, before closing the SQLite lock. Keep the original `begin immediate`, real-path map, error mapping and idempotent release.
- [ ] Add `verification lock excludes an independent process`: the child tries `begin immediate` on the same `venue.lock` and prints `refused 5` while a verification share remains, then `acquired` after final release while the callback still owns the directory. Use the existing venue-lock suite's child protocol; retain PID-scoped teardown and bounded waits.
- [ ] Run `pnpm --filter @waitron/store exec vitest run src/verification-venue-copy.test.ts src/venue-lock.test.ts src/venue-liveness.test.ts src/venue-liveness.order.test.ts`; require nonzero test counts and all PASS. Retain the existing actual-worker/frozen-holder tests unchanged.
- [ ] Commit the store implementation and tests with `git commit -s` after inspecting the staged paths.

### Task 2: Exercise the complete verifier under denied worker permission

**Interfaces:** Consume Task 1's helper/error. Keep `verifyBackupArtifact(request, deps)` and the private bundle's exports/protocol unchanged.

- [ ] In the new server suite, call existing `useBackupVerificationFixture()` unchanged in the permitted parent; preserve its real encrypted data, keys, captured history and fixed clock. Never seed fiscal data manually or change its assertions.
- [ ] Create a small test runner entry importing the real `backup-verification-entry.ts`, `openVenueDatabase` and the internal watchdog observer. Bundle that runner with `scripts/bundle-node.mjs`, so real verification and the default-open controls use one store module instance. Copy migrations into its private bundle directory, following the existing runtime suite's pattern without editing that suite. Build once per suite outside the denied child; bound build and child waits within the test timeout.
- [ ] Pass serialized request/key/path/clock inputs in a private file; recreate `AbortSignal`, `now`, and `modules: BACKUP_VERIFICATION_MODULES` in the child. Use the bundle's current target/runtime and migration root in the request, rather than the fixture's source-only target. Do not serialize functions or fake owner results. The unchanged root runtime suite separately exercises the exact production entry/export surface.
- [ ] Add `real bundled verifier passes with workers denied`: run Node with `--permission`, explicit `--allow-fs-read` for runner/bundle/migrations, private request/key file, encrypted archive, scratch and a separate ordinary-open probe directory. Grant `--allow-fs-write` only for scratch and that probe directory. Omit `--allow-worker`, child-process and network permissions; clear inherited `NODE_OPTIONS`. A direct `new Worker` control must report `ERR_ACCESS_DENIED` and permission `WorkerThreads`.
- [ ] Assert parsed verifier result `status="passed"`, `reason="none"`, all expected owners/checks passing, `activation="not_attempted"`, correct measured archive/request bindings, and empty scratch. Compare source logical data and original encrypted archive bytes before/after in the parent; no database-byte identity claim. Add a copied core-owner wrapper in the runner to compare all `before`/`after` rows with `querySnapshot`-equivalent logic before delegating to the real owner, so changed scratch rows cannot hide behind unchanged source bytes.
- [ ] In that SAME denied subprocess, call the ordinary server opener `openVenueDatabase(probeDirectory)` after verification and assert it throws `ERR_ACCESS_DENIED` / `WorkerThreads`, with no holder file or lingering lock. Also gate an ordinary open while verification scope is active (Task 1's independent context test covers the asynchronous isolation).
- [ ] Add a permitted-process control: ordinary `openVenueDatabase` creates an actual `Worker` and holder, two shares retain exclusion until final close, then worker exit is awaited. Observe existing internal `runningWatchdog` through the same bundled graph; do not replace `Worker` with a fake.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification.permission.test.ts`; before integration, require the genuine verifier case to fail with `unavailable/unexpected` traced to worker denial at placement, while the direct worker and ordinary-open controls already pass. Retain RED evidence.
- [ ] Replace the fixed scratch `venue` directory with `await withVerificationVenueCopy(scratch, async venueDir => ...)` around placement, placed integrity/key checks and module checks only. Keep input sealing, source query, compatibility and secret validation outside it. The callback computes/returns the module results; scope only the minimum placement/check region.
- [ ] Close `after` in a callback-local `finally`, before helper removal; do not leave it solely on the outer cleanup stack. Preserve outer input/before/validated cleanup, byte/deadline/cancellation boundaries and scratch accounting. Map helper removal or handle-close failures to `unavailable/cleanup_uncertain`, including beside a data refusal; never convert worker denial into success. If `removalBlocked=true`, still close owned handles but skip outer recursive scratch removal, so it cannot unlink a surviving ordinary holder's lock.
- [ ] Add `placement failure cleans the copy`, `owner refusal cleans the copy`, `cancelled verification cleans the copy`, and `cleanup uncertainty cannot pass` in the new suite. Inject failures at the boundary without changing genuine owners/fixtures; assert handle closure precedes directory removal and original bytes/data remain unchanged. Hold an outside ordinary share past callback settlement and prove outer cleanup retains its directory/lock until close; the test then explicitly removes its retained scratch.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification.permission.test.ts src/backup-verification.test.ts src/backup-verification.installed.test.ts src/backup-verification.authority.test.ts`; require all cases PASS, no skips. Run `pnpm exec vitest run scripts/backup-verification-runtime.test.mjs` unchanged for the production export/import boundary.
- [ ] In installed disposable copies only, independently delete (1) the scoped exemption: denied real verification must fail; (2) ordinary `beginHolding`: denied ordinary-open and permitted actual-worker assertions must fail; (3) promotion: same-directory ordinary sharing must fail; (4) lock acquisition: independent-child contention must fail; (5) active-directory/expiry guards: isolation tests must fail; (6) cleanup gate/retention or outer cleanup protection: surviving-share tests must fail. Restore each control and rerun acceptance; retain commands, failing assertions and output.
- [ ] Audit prose across the full base-to-tip path set, including `apps/server/README.md` and developer lock/verification sections. Document the copy-only exception and writable scratch migrations precisely; leave historical receipts intact with a dated pointer where needed. Delete only A1004's completed backlog entry, if present; record unrelated findings for the driver.
- [ ] Commit integration, tests and scoped documentation with `git commit -s`; report any changed test checks in the PR as the queue requires. Do not edit an unrelated check to force green.

### Task 3: Finish and land the implementation through the existing campaign gates

- [ ] Run focused checks above after any final change and inspect their counts. Do not add a workspace-wide test run solely for finishing. Announce readiness for `finish-branch`, then continue under the owner's existing autonomous authorization.
- [ ] Use the Codex `finish-branch` skill: after its initial rebase, obtain one Claude run-it whole-branch review with dependencies in an independent temporary checkout containing the complete candidate tree. Triage completed findings; retain that approval across later rebases unless new changes require review.
- [ ] Push signed commits through the normal hook without bypasses. Verify required CI checks and coverage belong to the exact current head; inspect `changes` scope to confirm store, server and affected consumers were selected. Resolve findings/conversations before landing.
- [ ] Use `land-branch` under RUNNER H11: acquire `~/waitron-campaign-shared/main.lock` by successful atomic `mkdir`, retry every 30 s for at most ten minutes, and hold it through the entire merge, main update, `pnpm install` and cleanup. Only remove your acquired lock; handle an old empty lock exactly as H11 specifies. Existing owner authorization covers this land.
- [ ] Verify local/remote feature branch removal and exact merge-SHA main CI run (H12); retain PR/SHA/run/test/control/review receipts. The campaign driver records the landed pin for lane D in its questions file, as A1004 requests; this plan-author turn edits no campaign state or other lane.

## Handoff and limits

This artifact is the plan only: no implementation, tests, permission experiment, commits, finish or land were performed while authoring it. No routine design approval is pending. Implementation must first reproduce the worker-denied failure; any lane overlap on the same changed lines is a coordination blocker, not permission to alter reserved files.
