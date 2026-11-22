# A993 — a change of producer opens a new fiscal installation by itself: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: plan, refreshed 2026-11-22 on `main` at `dbf567d417`, then revised after fresh read 1
(`~/waitron-campaign-l/receipts/a993-plan-read-1.md`); for the owner's approval. Fiscal: the owner
lands every pull request.** Every `file:line` below was read on that commit; nothing was run except
the `git grep`/`grep` commands quoted. What no longer held from the 2026-11-11 version is in "What
changed since 2026-11-11"; what read 1 changed is in "Changed after read 1".

**Goal:** a production box upgraded to a release whose producer differs from its chain's opens a
new installation (new chain, new five-symbol installation name, new series from 1) by itself and
trades, but only when the upgrade's own marker names that new producer; any other start with a
different producer refuses `sif.producer_changed` as today.

**Architecture:** A950's checked upgrade, the path every install on a running box takes, works out
the marker from the old and new images and hands it to its own check containers. Its online trial
and its stopped checks open the new installation on their throwaway copies. Its last stopped check
then opens it on the live data, reading the box's time service at that moment. A failure anywhere
leaves or puts back the old release, as for any failed upgrade check. No start ever opens an
installation, so no start waits, and the start's refusal is unchanged. The opening uses the
activation that restore and the conflict switch already use (`withHourAdmission` →
`activateModuleAllocation` → the writes at `allocation.ts:435-478`), with a new action
`identity-change` whose authority only the fiscal module's own step can mint.

**Tech stack:** TypeScript, Vitest, `node:sqlite` through drizzle, the host upgrade driver
(`scripts/box/upgrades/*.mjs`, plain Node).

**Spec:** [A940 design §5.6](../specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993).

Terms. **Producer**: who makes the software and signs its declaration; every Veri\*Factu record
names its tax number. **Installation**: one copy of the software at one taxpayer, named by five
symbols for the UTC minute it was opened, with its own chain of records and invoice series.
**Marker**: what the upgrade hands its check containers, naming the release being installed, its
producer, and the producer it replaces.

## Authority

- Design approved, owner 2026-10-22 about 02:45; way A chosen about 02:55 ("the upgrade changes
  only while it can read the internet's clock, and otherwise the old release keeps selling …; in the
  stuck case the page also accepts a phone's or a till's clock"); countdown about 03:12 (design §11).
- Owner 2026-11-06 about 18:13 (`~/waitron-campaign/questions.md:2416`): "(2) Once A993 exists, a
  start opens a new installation for a producer difference only when the upgrade's own marker names
  that same new producer; otherwise it keeps refusing."
- Owner 2026-11-21 18:17 (`~/waitron-campaign-l/questions.md:1033`): "build it".
- Standing rules: no venue is live, so no compatibility code (CLAUDE.md §3); the placeholder
  producer may be replaced once before any production start (CLAUDE.md §5).

## What it delivers, and what it does not

- **Usable after PR 3:** a single production box upgraded through the checked upgrade to a release
  naming another producer opens its new installation during the upgrade's stop and trades on it.
  Records already made keep the old producer and are sent unchanged (`drain.ts:648` groups by SIF).
- **Still unavailable:**
  - a two-box venue: the checked upgrade refuses any box with a partner, or whose role is not
    serving primary ("paired upgrades are not available", `assertSingleBox`, `host.mjs:500-556`);
  - a box given the new release any other way (a hand-run `docker compose up`): it refuses
    `sif.producer_changed`, and the recovery page says to install it as an upgrade;
  - a change of the two-character code or of the fiscal mode.

## Global constraints

- `computeHuella`, `chain.ts`, invoice-number allocation, `registros_facturacion` and its triggers,
  `recordSale`/`recordCorrection`/`recordSubstitution` do not change. Every PR runs
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  **unedited**. A task that finds it needs any of these changed stops and asks the owner.
- No schema change, so no migration and no venue reset.
- Production only. A preproduction box keeps trading on its chain under the new producer, as Task 8
  of A940 built and the owner accepted (fiscal.md, A993).
- The name follows CLAUDE.md §5's restore and promotion rules: five symbols for the box's UTC minute
  (`encodeMinuteIdentity`); a second clock within 30 seconds (`compareHourClocks`, `hour-clock.ts:67`,
  with the release floor `readHourRelease`); never a minute in the history the box reads
  (`readHourHistory`, `hour-history-reader.ts:200`). The second clock is the box's time service
  being synchronised (`observeTimeServiceHourClock`, `hour-clock-time-service.ts:12`). Devices are
  never used.
- Writes go to `venue.db` only (the four tables `allocation.ts:435-478` writes). Nothing in
  `node.db` changes, so the two-file order rule does not arise (read, not run).
- FULL review path (fiscal invariants). Every PR also runs the root's
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts`.
- **No behaviour change until PR 3.** PRs 1 and 2 touch code every activation and every upgrade
  check runs through. These suites prove it unchanged and run **unedited**:
  `src/allocation-envelope.test.ts`, `src/allocation.test.ts`, `src/hour-throwaway-allocation.test.ts`,
  `src/hosted-hour-recovery.test.ts`, `src/hour-selection.test.ts` (fiscal-verifactu), and
  `src/upgrade-trial.test.ts`, `src/upgrade-sale.test.ts` (server).

## What changed since 2026-11-11

1. **A950 built the checked upgrade.** Every install on a started box goes through
   `cmd_checked_install` (`deploy/waitron.sh:1098`, called at `:1279-1288`) into
   `scripts/box/upgrades/cli.mjs:332-431`. The steps:
   - an online trial on a copy while the old release sells (`host.mjs:758`, called at `:284`);
   - stop, then a stopped copy;
   - readiness and a real sale on a second copy (`candidate.mjs:39`);
   - Restore or Keep, or an automatic restore (`transaction.mjs:144-202`).

   The old slice 2 (a new server command inside `waitron.sh install`) is replaced by the host
   driver and the existing checks. The old citations `waitron.sh:765-783`, `:401-442` and `:676` no
   longer describe the path.
2. **Those checks already refuse a producer change.** `checkUpgradeData` calls
   `checkFilingIdentity` (`upgrade-checks.ts:89-90`), so today such an upgrade fails at the online
   trial and the old release keeps selling (read, not run).
3. **The copy sale already needs the time service synchronised** (`upgrade-sale.ts:161-163`). The
   stopped checks have a clock relay (`candidate.mjs:72,81`); the online trial has none
   (`host.mjs:776-803`).
4. **"The internet's clock" is now the box's time service.** `hour-clock-internet.ts` is gone. The
   `internet` source means the host reports the time service synchronised
   (`hour-clock-time-service.ts:12-58`). CLAUDE.md §5: a synchronised time service carries a new
   name on by itself.
5. **A947 4a landed.** Admission takes the five-symbol minute (`allocation-envelope.ts:451`). The
   actions are `setup`, `restore`, `promote`, `conflict-switch`. A one-shot allocation that skips
   the saved selection exists, `hour-throwaway-allocation.ts:19-101`, and is the template here.
6. **Backup verification checks every stored approval's shape** (`backup-verification-history.ts:133-158`;
   the operator parser is `allocation-operator.ts:13-25`). So the plan reuses an existing shape
   (decision 5).
7. **Line moves.** The refusal runs at `boot.ts:2595-2598`. The seat method is
   `fiscal-verifactu/src/backend.ts:789`, and its interface is `packages/fiscal/src/backend.ts:499`
   (not `:605`).
8. **A940 slices 4 and 5 (#2987, #3001, #3014, #3051).** A production start of a build that is not
   a release refuses `server.unreleased_build`, so `softwareVersion()` names a release. The
   producer is the image's own `ENV` (`deploy/Dockerfile:316-324`), which compose does not pass
   (`deploy/compose.yml:18-40`). Kept declarations need nothing.
9. **Asesor Q53(d)(2) is already widened** (`docs/compliance/asesor-questions.md:2080-2081`).
10. **`tenants` became `taxpayer`** (A1308 vb1). Its writers change only the legal name and the
    domicile (`taxpayer-name.ts:18,45`).
11. **Dropped:** the old question 0 (answered), the activity-log line (the `fiscal_allocations` row,
    `allocation.ts:466-478`, is the record) and the A1308 collision note (no column is added).

## Changed after read 1

- **I1:** the step checks whether there is anything to open before it reads the clock, and checks
  again inside its transaction (Task 2).
- **I2:** read 1 found that a start which waits for its time is counted as a failed start
  (`node-entry.ts:300-310,903-915`), and that it fails A950's resume, which runs
  `docker compose up --wait --wait-timeout 180` (`host.mjs:641`). A failed resume leaves the
  attempt committed but not cleaned up, so later applies are refused (`cli.mjs:384`). The design
  now changes so that no start waits: the upgrade opens the installation during its stop
  (decision 3). This drops the in-boot wait, the boot task and the stuck page (decision 4).
- **I3:** Task 4 drops its role and fencing reads. A box that reaches the checks is always a sole
  serving primary (`host.mjs:500-556`). The two-box limit is stated above.
- **I4:** PR 3's documents task lists every stale receipt (Task 7).
- **M1:** `nextHourMinute` is dropped (decision 9).
- **M3:** the readers of the reused shape are named, and the stale comment is fixed (decision 5).
- **M4:** "no behaviour change" replaces "nothing a box can reach".
- **M5:** the wording is corrected (Task 1, Task 4, decision 10).
- **M6:** the old Task 3 is split (Tasks 2 and 3), the old Task 8 is gone, and the old Task 10 is
  split (Tasks 6 and 7).
- **Rejected:** none.

## Decisions (recommended defaults; ★ needs the owner)

1. ★ **Producer only, with no stored identity column** (departs from the design's "What each chain
   stores"). A chain's producer is its head record's (`producer-change.ts:26-33`). The code and the
   mode cannot differ today.
2. ★ **No check when a record is written** (departs from the design's "The guard"). It would sit in
   `chain.ts`. The start's refusal stays the guard (`boot.producer-change.test.ts:171`, unedited).
3. ★ **The upgrade opens the installation during its stop, as its last check, on the live data,
   reading the time service then.** The trial and the stopped checks open it first on their own
   copies, which are thrown away. No start opens one. So the owner's 2026-11-06 constraint holds:
   every start with a producer difference refuses, and only the upgrade's own step, handed its own
   marker, opens. This matches the design's way A, step 4 ("Migrate, then make the change"). It
   drops step 3's clock reading carried across the stop, because the time service is read inside
   the stop through the relay.
4. ★ **No stuck page, and no phone's or till's clock.** The design's stuck cases were a crash
   between the migration and the change, and a start by hand.
   - **A crash:** A950's recovery restores the old data automatically, or offers Restore
     (`transaction.mjs:205-236`). Keep is refused for an identity-changing attempt (Task 6).
   - **A start by hand:** it refuses, with words that say to install the release as an upgrade.
   - **No time service at the trial:** the upgrade stops there and the old release sells on.
   - **No time service at the stop:** the old release is put back.
5. **The approval and operator shape.** It is the existing version 2 with
   `oldMachineRelinquished: true`, and `oldMachineOffline` and `oldMachineAbsent` false (the old
   installation is this box's, closed by its own step). The operator is the text
   `identity-change:<release>`. Its readers:
   - `backup-verification-history.ts:133-158` accepts it. Read 1 ran "a stored version 2
     relinquished approval verifies", which passes. Its comment at `:134` ("Only a relinquished
     promotion writes version 2") is corrected in Task 3.
   - `hour-history-reader.ts:133-146` and `backup-verification.ts:93-104` read only the event, the
     node and the time.
   - `filing-overview.ts:213-217` leaves it out of "Identity changes without a handover". That is
     right: the old chain closed on the same box, and no history is missing.

   The door is the private authority, not this data.
6. **The marker** is the environment value `WAITRON_IDENTITY_CHANGE` =
   `{"version":1,"release":"1.4.0","producerTaxId":"<new>","fromProducerTaxId":"<old>"}`.
   - **Where it goes:** the host puts it only into its own check containers' env files (trial,
     readiness, sale, live step), and saves it as `identity-change.json` in the attempt directory.
     No state-folder file, and nothing the running app reads.
   - **When it is written:** only when the candidate is a numbered release (its `ref.name` label is
     `v<version>`, as `waitron.sh:474-486` reads it) whose `WAITRON_PRODUCER_TAX_ID` differs from the
     old image's.
   - **When the step acts:** only when all three match: its `softwareVersion()`, its producer, and
     the chain head's producer. An empty or malformed value counts as absent (`isUnset`).
   - **Disclosed limit:** root on the box can run the step by hand, as root can edit the database.
7. ★ **No new words in the upgrade's report.** A refused check carries
   `sif.identity_change_waiting` with its reason as A950's failure text, and Box status shows A950's
   ordinary deferral or rollback. The design's three Spanish report lines are not built.
8. **Order PR 1 → 2 → 3.** Nothing hands over a marker until PR 3.
9. **The minute.** The step takes the box's current minute. It refuses `minute_in_use` when any
   used minute is that minute or later, and the next upgrade attempt retries. There is no 150-second
   wait and no settle, as for `promote`. The shared rule in `hour-selection.ts:541-566` stays
   untouched: while the box is stopped for its upgrade, nothing else can open an installation in
   that minute, and the copies never write to the live history.
10. **`openIdentityChange` takes `Database` and opens its own transaction.** It reads the time
    service (up to 2 seconds, `hour-clock-time-service.ts:4`) outside the write lock. This is
    stated as a commented decision at its site (CLAUDE.md §3).

## Changed test checks

| Check | Before | After |
| --- | --- | --- |
| `apps/server/src/recovery-surface.test.ts:440-462`, the `sif.producer_changed` words (Task 7) | EN title "…and this version of Waitron cannot open one, so the box will not sell."; action "…Changing the producer needs a Waitron version that can open a new fiscal installation, which does not exist yet." (ES likewise) | EN title "This box has been given a different software producer from the one its invoices were recorded under, without the upgrade that opens a new fiscal installation for it, so the box will not sell."; action "Install a Waitron version that names the same producer as this box's invoices. A version with a new producer opens its new fiscal installation by itself when it is installed as an upgrade." ES: "…sin la actualización que le abre una nueva instalación fiscal, así que el equipo no venderá." / "Instala una versión de Waitron que indique el mismo productor que las facturas de este equipo. Una versión con un productor nuevo abre su nueva instalación fiscal por sí sola cuando se instala como actualización." |

No other check reverses. `git grep -n "producer_changed" -- '*.test.*'` lists:
- `boot.producer-change.test.ts:171-180`: still refuses;
- `producer-change.test.ts:59,168,189`: unchanged;
- `recovery-surface.test.ts:440-633`: the words above; the retry list at `:601-633` stays true.

## Review focus

1. **A live step that fails after migrating the live data:** the restore puts the stopped copy back
   whole (`copy.mjs:59-75`), on both Restore and the automatic restore (Task 6).
2. **A crash after the live step commits but before A950 commits:** recovery restores the copy, and
   the opened installation, which carried no record, goes with it. Keep is refused (Task 6).
3. **The sale's second check on its copy:** the copy's chain was already opened by readiness, so the
   step answers `nothing-to-open` before reading any clock (Task 2, case 3).
4. **A backup after the change verifies**, and a restore reads its history (Task 3, case 4).
5. **The marker never reaches the running app:** the reopened Compose and the app's environment
   carry no `WAITRON_IDENTITY_CHANGE` (Task 5).

---

## PR 1 — the fiscal module can open an identity-change installation (not yet called)

Result: no behaviour change. `fiscal-verifactu` gains one seat method that no route reaches. About
200 production lines and 400 test lines.

### Task 1: the `identity-change` action and its private authority

**Files:**
- Create: `packages/fiscal-verifactu/src/identity-change-authority.ts`.
- Modify the three action lists: `allocation-envelope.ts:289` (and the relinquished check at
  `:304`), `allocation-operation.ts:120`, and `allocation.ts:169-171`.
- `hour-selection.ts:384` does **not** gain the action: the identity change skips the saved
  selection.
- Test: `identity-change-authority.test.ts`.

**Produces:**
- `withIdentityChangeAuthority<T>(binding: OperationBinding, release: string, run: (authority: OperationAuthority) => Promise<T>): Promise<T>`.
  It calls `withOperationAuthority` (`operation-authority.ts:51`) with the operator
  `identity-change:<release>`, adds the authority to a module-private `WeakSet`, and removes it in
  `finally`.
- `isIdentityChangeAuthority(authority: unknown): boolean`.
- Neither is exported from `index.ts`.
- Each list accepts `identity-change` only when `isIdentityChangeAuthority` holds, and refuses an
  identity-change authority for every other action. `:304` admits `identity-change` beside
  `promote`.

- [ ] **Step 1: Write the failing tests.**
  - An authority from `withOperationAuthority` with the action `identity-change` →
    `withHourAdmission` refuses `reauthentication_required`.
  - An identity-change authority with the action `restore` → refused.
  - The authority after `run` settles → refused.
  - Proof by deletion: delete the `WeakSet` check, and the first case must fail.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change-authority.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Run the same command plus the constraint suites,
  unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 2: deciding whether to open, and on which minute

**Files:**
- Create: `packages/fiscal-verifactu/src/identity-change.ts`.
- Modify: `errors.ts`, to add `sif.identity_change_waiting`, typed `{ reason: string }`.
- Test: `identity-change.test.ts` (`useVenueDb`, with `readHourRelease` mocked as the existing hour
  tests mock it).

**Produces:**
- `planIdentityChange(db: Database, nodeId: NodeId, marker: IdentityChangeMarker, timeService: () => Promise<boolean>): Promise<{ kind: "nothing-to-open" | "not-named" } | { kind: "open"; minuteMs: number; sourceSifId: string }>`.
- `IdentityChangeMarker = { release: string; producerTaxId: string; fromProducerTaxId: string }`,
  exported from `packages/fiscal/src/backend.ts`.

The checks, in order:
1. **Not named:** `not-named` unless `marker.release === softwareVersion()` and
   `marker.producerTaxId` is the running producer's NIF.
2. **Outside production:** `nothing-to-open`.
3. **Nothing to open (read-only, before any clock):** `nothing-to-open` when there is no chain head,
   or the head already names the running producer, read as `producer-change.ts:26-33` reads it.
   `not-named` when the head is not `marker.fromProducerTaxId`.
4. **The clock:** `observeTimeServiceHourClock`, then a box sample, then `compareHourClocks` with
   the release floor. When `canSelectHour` is false, it throws `sif.identity_change_waiting` with
   `clockRefusal`'s reason.
5. **The minute:** history through `readHourHistory` and `projectHourHistory`. Contradictions →
   `history_invalid`. A used minute at or after the box's minute → `sif.identity_change_waiting`
   `minute_in_use`.

- [ ] **Step 1: Write the failing tests.**
  1. Head under producer A, running B, a marker naming B and A, time service synchronised → `open`,
     on the box's current minute.
  2. A marker naming another release, another producer, or another `fromProducerTaxId` →
     `not-named`. Proof by deletion of each comparison.
  3. The head already under B, time service **unsynchronised** → `nothing-to-open`, with no clock
     read (the stub counts calls).
  4. Head under A, unsynchronised → throws `second_clock_missing`.
  5. Preproduction → `nothing-to-open`.
  6. The current minute already in the history → `minute_in_use`.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with `src/producer-change.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 3: opening it, and the seat method

**Files:**
- Modify: `identity-change.ts`; `fiscal-verifactu/src/backend.ts:789`, to add the method;
  `packages/fiscal/src/backend.ts:499`, to add an optional member (that file is mutation-tested,
  `packages/fiscal/stryker.config.json:7`, but a type member has no mutants); and
  `backup-verification-history.ts:134`, to correct its comment.
- Test: `identity-change.test.ts`.

**Consumes:** Task 1's `withIdentityChangeAuthority` and Task 2's `planIdentityChange`.

**Produces:** `openIdentityChange(db: Database, nodeId: NodeId, marker: IdentityChangeMarker, timeService: () => Promise<boolean>): Promise<"opened" | "nothing-to-open" | "not-named">`.

How it works:
- It plans first, then in one `withTransaction` repeats the plan's reads and refuses if they moved.
- It builds the input as `hour-throwaway-allocation.ts:47-72` builds its input, using decision 5's
  approval, `liveSeriesBases`, `encodeMinuteIdentity(minuteMs)`, and the binding
  `{ module: "fiscal-verifactu", action: "identity-change", eventId: randomUUID(), sourceId: sourceSifId, targetNodeId: nodeId }`.
- Then it runs `withHourAdmission` → `createAllocationPreparation` → `activatePreparedModuleAllocation(tx, …)`.

- [ ] **Step 1: Write the failing tests.**
  1. Case 1 of Task 2 → `opened`:
     - the old SIF row is revoked;
     - a new row's `numero_instalacion` is the minute's five symbols;
     - the old series are retired and new `<base>-<name>` series exist;
     - the next `recordSale` stores `PrimerRegistro` S under the new name;
     - the old record's stored `SistemaInformatico` is unchanged.
  2. Called twice → the second call answers `nothing-to-open`.
  3. The used-name refusal (`installation_used`, `allocation.ts:103-114`) is still reached when the
     plan's minute is planted in `registro_sif` between the plan and the transaction.
  4. `verifyBackupFiscalHistory` (`backup-verification-history.ts:492`) over the changed database
     passes.
- [ ] **Step 2: Run them and watch them fail.** Same command as Task 2 → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the fiscal gates and
  `src/backup-verification-history.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

## PR 2 — the upgrade checks open it when handed a marker

Result: no behaviour change until PR 3, because nothing sets the value yet. With the value set, each
check opens the installation on the data it is given. About 80 production lines and 200 test lines.

### Task 4: `checkUpgradeData` and a live `open` mode

**Files:**
- Modify: `apps/server/src/upgrade-checks.ts:35-89`, adding an
  `options: { socketPath?: string }` parameter that `upgrade-sale.ts:160` passes on.
- Modify: `upgrade-check-entry.ts:25-42`, adding the mode `open`, which is `checkUpgradeData` with
  no listener and refuses unless the value is set.
- Create: `identity-change-marker.ts`.
- Tests: `upgrade-trial.test.ts`, `upgrade-sale.test.ts`, `identity-change-marker.test.ts`.

**Produces:** `readIdentityChangeMarker(env: NodeJS.ProcessEnv): IdentityChangeMarker | null`. It
takes exact keys and `version: 1`; anything else answers `null`.

**How it works:** after the integrity checks and **before** the transaction at `upgrade-checks.ts:89`,
when the marker is set, it calls `backend.openIdentityChange?.(db, node.nodeId, marker, timeServiceReader(boxHostClient(options)))`.
A waiting refusal is thrown and fails the check. The details report `identityChange: <answer>`.
`checkFilingIdentity` then runs as today.

- [ ] **Step 1: Write the failing tests.**
  - The marker reader: absent, empty, malformed, an extra key → `null`; well formed → the three
    fields.
  - The trial with a matching value and a synchronised stub → passes and reports `opened`.
  - Unsynchronised → throws `sif.identity_change_waiting`.
  - No value → still `sif.producer_changed`.
  - The sale with a matching value → its record starts the new chain.
  - `open` with no value → refused.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/identity-change-marker.test.ts src/upgrade-trial.test.ts src/upgrade-sale.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, plus the root's `scripts/module-seams.test.ts` → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

## PR 3 — the upgrade hands over the marker and opens the live installation

Result: the outcome. About 120 production lines and 250 test lines, plus documents.

### Task 5: the host works out the marker and gives it to the trial

**Files:**
- Modify `scripts/box/upgrades/host.mjs`:
  - `:246-307`: after the candidate ids, inspect `old.app` and `next.app` for `Config.Env`
    `WAITRON_PRODUCER_TAX_ID` and the `org.opencontainers.image.ref.name` label, giving decision 6's
    marker or `null`;
  - `:758-803`: add the value to the trial's env file, and mount a `clockStatusRelay` folder
    read-only at `/run/waitron-box`, as `candidate.mjs:72,81` does;
  - `:309-311`: save `identity-change.json` beside `candidate-compose.json`.
- Test: `host.test.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - A release with another producer → the trial's env file carries the value, and the attempt
    directory holds the file.
  - The same producer, or a `main` candidate → neither.
  - The trial carries the relay mount and still runs `--network none`.
  - The Compose that `reopenImages` writes, and `.env`, never carry `WAITRON_IDENTITY_CHANGE`.
- [ ] **Step 2: Run them and watch them fail.** `pnpm exec vitest run scripts/box/upgrades/host.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Same command → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 6: the stopped checks, the live step, and Keep

**Files:**
- Modify `scripts/box/upgrades/candidate.mjs`:
  - `:39-92`: when the attempt holds `identity-change.json`, add its value to the check env file.
  - After the sale (`:172-175`): run `docker run --rm --network none … --entrypoint node <candidate> /app/upgrade-checks.js open`
    with the readiness run's mounts (`:76-87`), but with the live state (`marker.paths[0]`) in place
    of `work/state`. Push its report.
- Modify `cli.mjs:420-430`: `keep` on an attempt holding `identity-change.json` throws "This
  upgrade changes the software producer, so it can only be restored." The words are shown on the
  host console.
- Tests: `candidate.test.mjs`, `cli.test.mjs`, `transaction.test.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - The readiness and sale env files carry the value.
  - The live `open` runs last, against the live state, only with a marker.
  - Its failure fails the checks.
  - Restore after a failed live step puts the live state back byte for byte.
  - Keep on an identity-changing attempt is refused; Keep on any other attempt is unchanged.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm exec vitest run scripts/box/upgrades/candidate.test.mjs scripts/box/upgrades/cli.test.mjs scripts/box/upgrades/transaction.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Same command → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 7: correct every receipt the change retires

The list comes from `git grep -n "A993\|new fiscal installation" -- ':!docs/superpowers'`.

**Files:**
- `CLAUDE.md`: the producer bullet at `:1026-1033` becomes "A production box opens a new
  installation for another producer only through the checked upgrade, whose stopped checks open it;
  every start with a producer difference refuses `sif.producer_changed`". It names this plan's
  guards. The restore and promotion bullet at `:1034` gains the identity change.
- `.github/workflows/ci.yml`: the comment at `:4692-4694`, and the refusal message at `:4734-4737`,
  which becomes "…and production boxes refuse to start on it unless it is installed as an upgrade,
  which opens a new fiscal installation. To publish it anyway, set…".
- `docs/operations/release.md:391-397`: **rewrite** "When the producer or the system code changes".
  The new text covers: set the three secrets, set `WAITRON_PRODUCER_CHANGE_ALLOWED`, install as an
  upgrade, and the two-box limit.
- `docs/compliance/action-plan.md:219`.
- `docs/backlog.md:238`: the A940 entry's "until A993 lands" and "1b (A993) waits …".
- `docs/backlog.md:242-246`: delete A993.
- `docs/backlog/fiscal.md:1566-1571` and `:1578`.
- `docs/backlog/fiscal.md:1584-1624`: delete A993, and move the owner's constraint and decisions
  1–4 and 7 to `## Decisions and deliberate limits` (`:1086`).
- `docs/compliance/2026-11-19-adviser-meeting.md:463`: a dated pointer only, since it is a
  historical record.
- `i18n/recovery-page.ts:308-320` and its test (the table above).

- [ ] **Step 1: Change the test first.** Change `recovery-surface.test.ts:440-462` to the new
  words. `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` → FAIL.
- [ ] **Step 2: Correct the files.** Change the words and every file above.
- [ ] **Step 3: Run the checks.**
  - The test → PASS.
  - `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/ci-workflow.test.mjs` → PASS.
  - The same `git grep` finds only this plan and the dated pointer.
- [ ] **Step 4: Commit** with `git commit -s`.

## Risks to which chain a record joins

| Risk | Guard |
| --- | --- |
| A sale joins the old chain under the new producer | `checkFilingIdentity` at every start (`boot.ts:2595-2598`) and in every check (`upgrade-checks.ts:90`), unedited |
| A stray setting opens one | Only the upgrade's check containers carry the value; it must name this release, this producer and the head's (Task 2, case 2) |
| Another caller opens one | A private, one-use authority, refused for every other action (Task 1) |
| A name from a wrong clock, or one already used | A synchronised time service, the release floor, the history, `installation_used` (Tasks 2 and 3) |
| A half-made change | One transaction through the unchanged activation; a failed or interrupted stop restores the copy (Task 6) |
| Two venues of one taxpayer take the same minute | A947's disclosed limit; one main box at a time |

## Not established

- What Box status shows for an automatic attempt refused at the online trial because the time
  service was not synchronised. A950's existing handling of a failed trial applies; I read it, I did
  not run it.
