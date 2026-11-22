# A993 — a change of producer opens a new fiscal installation by itself: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: plan, refreshed 2026-11-22 on `main` at `dbf567d417` for a fresh read and the owner's
approval. Fiscal: the owner lands every pull request.** Every `file:line` below was read on that
commit; nothing was run except the `git grep`/`grep` commands quoted. The 2026-11-11 version was
written on `53bb877a5e`; what no longer held is listed in "What changed since 2026-11-11".

**Goal:** a production box upgraded to a release whose producer differs from its chain's, carrying
that upgrade's own marker naming the new producer, opens a new installation (new chain, new
five-symbol installation name, new series from 1) by itself at start and trades; without a matching
marker it refuses `sif.producer_changed` as today.

**Architecture:** the new installation is opened by the same activation every restore and
conflict switch already uses (`withHourAdmission` → `activateModuleAllocation` → the writes at
`allocation.ts:435-478`), with a new action `identity-change` whose authority only the fiscal
module's own identity-change step can mint. A950's checked upgrade (the path every install on a
running box takes) writes the marker; its online trial and its stopped checks make the same change
on their own throwaway copies, so a box that cannot read its time service never stops selling the
old release.

**Tech stack:** TypeScript, Vitest, `node:sqlite` through drizzle, the host upgrade driver
(`scripts/box/upgrades/*.mjs`, plain Node).

**Spec:** [A940 design §5.6](../specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993).

Terms. **Producer**: who makes the software and signs its declaration; every Veri\*Factu record
names its tax number. **Installation**: one copy of the software at one taxpayer, named by five
symbols for the UTC minute it was opened, with its own chain of records and invoice series.
**Marker**: a small file the upgrade writes into the box's state folder naming the release being
installed, its producer and the producer it replaces.

## Authority

- Design approved, owner 2026-10-22 about 02:45; way A chosen about 02:55 ("the upgrade changes
  only while it can read the internet's clock, and otherwise the old release keeps selling …; in the
  stuck case the page also accepts a phone's or a till's clock"); countdown about 03:12 (design §11).
- Owner 2026-11-06 about 18:13 (recorded in `docs/backlog/fiscal.md`, A993): "(2) Once A993 exists,
  a start opens a new installation for a producer difference only when the upgrade's own marker
  names that same new producer; otherwise it keeps refusing."
- Owner 2026-11-21 18:17: "build it" (it had been "Later" on 2026-11-11).
- Standing rules: no venue is live, so no compatibility code (CLAUDE.md §3); the placeholder
  producer may be replaced once before any production start (CLAUDE.md §5).

## Global constraints

- `computeHuella`, `chain.ts`, invoice-number allocation, `registros_facturacion` and its triggers,
  `recordSale`/`recordCorrection`/`recordSubstitution` do not change. Every PR runs
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  **unedited**. A task that finds it needs any of these changed stops and asks the owner.
- No schema change, so no migration and no venue reset.
- Production only; a preproduction box keeps trading on its chain under the new producer, as
  Task 8 built and the owner accepted (fiscal.md, A993).
- Only a box that sells changes: `acceptingSales` (`boot.ts:2470`, singleton primary and neither
  fenced nor a mirror). Every other box keeps today's behaviour.
- The name follows CLAUDE.md §5's restore/promotion rules: five symbols for the box's UTC minute
  (`encodeMinuteIdentity`), a second clock within 30 seconds (`compareHourClocks`,
  `hour-clock.ts:67`, with the release floor `readHourRelease`), never a minute in the history the
  box reads (`readHourHistory`, `hour-history-reader.ts:200`). The second clock is the box's time
  service being synchronised (`observeTimeServiceHourClock`, `hour-clock-time-service.ts:12`), or
  from PR 3 a device time confirmed under the box's recovery key; never devices alone.
- Writes go to `venue.db` only (the four tables `allocation.ts:435-478` writes); nothing in
  `node.db` changes, so the two-file order rule does not arise (read, not run).
- FULL review path (fiscal invariants). Every PR also runs `scripts/errors-reachable.test.ts` and
  `scripts/write-path-tables.test.ts` from the root (`pnpm exec vitest run <file>`).

## What changed since 2026-11-11

1. **A950 built the checked upgrade.** Every install on a started box goes through
   `cmd_checked_install` (`deploy/waitron.sh:1098`, called at `:1279-1288`) into
   `scripts/box/upgrades/cli.mjs:332-431`: an online trial on a copy while the old release sells
   (`host.mjs:758`, called at `:284`), stop, a stopped copy, readiness and a real sale on a second
   copy (`candidate.mjs:39`), then Restore/Keep or automatic restore (`transaction.mjs:144-202`). The
   old slice 2 (a `prepare-identity-change` server command inside `waitron.sh install`, waiting for
   A950's PR2) is replaced by PR 4: the host driver writes the marker, and the existing checks do
   the work. Old citations `waitron.sh:765-783`, `:401-442`, `:676` no longer describe the path.
2. **Those checks already refuse a producer change.** `checkUpgradeData` calls
   `checkFilingIdentity` (`upgrade-checks.ts:90`), so today such an upgrade fails at the online
   trial and the old release keeps selling (read, not run). Old question 5 (the copy's test sale)
   is answered by construction: the copies make the change too (PR 2, Task 6).
3. **The copy sale already needs the time service synchronised** (`upgrade-sale.ts:161-163`); the
   online trial runs with no clock relay (`host.mjs:776-803`) while the stopped checks have one
   (`candidate.mjs:72,81`).
4. **"The internet's clock" is now the box's time service.** `hour-clock-internet.ts` is gone; the
   `internet` source means the host reports the time service synchronised
   (`hour-clock-time-service.ts:12-58`, read at `boot.ts:1216`). CLAUDE.md §5: a synchronised time
   service carries a new name on by itself; a device counts only once the page's proof confirms it.
5. **Every filing start already waits for its time** (`gateSeatOnStartClock`, `boot.ts:2589`); the
   identity change reads the time service itself and is not one of the seat's gated members
   (`start-clock-gate.ts:29-45`).
6. **A restore's start already waits with a page** that takes the node recovery key
   (`node-entry.ts:752-840`, `start-clock-waiting.ts:56`, key check at `:92`). PR 3 reuses that page
   instead of the peer waiting start the old slice 3 named.
7. **A947 4a landed**: admission takes the five-symbol minute (`allocation-envelope.ts:451`); the
   actions are `setup`, `restore`, `promote`, `conflict-switch` in four lists
   (`allocation-envelope.ts:289`, `allocation-operation.ts:120`, `allocation.ts:169-171`,
   `hour-selection.ts:384`). A one-shot allocation that skips the persisted selection exists:
   `hour-throwaway-allocation.ts:19-101`, the template here.
8. **Backup verification checks every stored approval's shape** (`backup-verification-history.ts:133-158`;
   operator parser `allocation-operator.ts:13-25`). A new approval or operator kind would make every
   later backup fail verification, so the plan stores the existing version-2 "relinquished"
   approval with a text operator (decision 5).
9. **Line moves:** the refusal runs at `boot.ts:2595-2598`; the seat method is
   `fiscal-verifactu/src/backend.ts:789`, its interface `packages/fiscal/src/backend.ts:499` (the old
   `packages/fiscal/src/backend.ts:605` is wrong); `withOperationAuthority` `operation-authority.ts:51`;
   `createSetupHourClock` `hour-setup-clock.ts:125`; the minute rule `hour-selection.ts:541-566`.
10. **A940 slices 4 and 5 (#2987, #3001, #3014, #3051).** A production start of a build that is not
    a release refuses `server.unreleased_build`, so a production box always runs a numbered release
    and `softwareVersion()` names it. The producer is the image's own `ENV`
    (`deploy/Dockerfile:316-324`), which compose does not pass (`deploy/compose.yml:18-40`), so only
    another image changes it. Kept declarations need nothing.
11. **Asesor Q53(d)(2) is already widened** (`docs/compliance/asesor-questions.md:2080-2081`); the old
    slice 1a docs step is dropped.
12. **`tenants` became `taxpayer`** (A1308 vb1); its writers change only the legal name and domicile
    (`taxpayer-name.ts:18,45`).
13. **The recovery page says the remedy "does not exist yet"** (`i18n/recovery-page.ts:308-320`);
    false once PR 4 lands, so its words and test change (table below).
14. Dropped: old question 0 (answered), the activity-log line (the `fiscal_allocations` row,
    `allocation.ts:466-478`, is the record), the separate asesor edit, and the A1308 collision note
    (no column is added).

## Decisions (recommended defaults; ★ needs the owner)

1. ★ **Producer only, no stored identity column** (design "What each chain stores"). A chain's
   producer is its head record's (`producer-change.ts:26-33`); the code and mode cannot differ today.
2. ★ **No record-time guard** (design "The guard"): it would sit in `chain.ts`. The start's refusal
   stays the guard (`boot.producer-change.test.ts:171`).
3. ★ **The live change is made at the new release's start; the upgrade's trial and stopped checks
   make the same change on their own copies, which are thrown away.** The design's clock reading
   carried across the stop (way A, step 3) goes. A box whose time service is not synchronised fails
   the online trial and never stops the old release, as way A wants.
4. ★ **The stuck page takes the box's recovery key** (as a restore's start wait, and as the conflict
   switch that also opens a new chain on a running box), not a sign-in (design §12, question 4).
   Alternative: a `node.manage` sign-in as the peer waiting start's carry-on (`carry-on.ts:198-315`).
5. **Approval and operator:** version 2 with `oldMachineRelinquished: true`, `oldMachineOffline` and
   `oldMachineAbsent` false (the old installation is this box's, closed by its own step), operator
   the text `identity-change:<release>`. Every existing reader accepts that shape
   (`backup-verification-history.ts:135-153`); the door is the private authority, not the data.
6. **The marker** is `<state>/identity-change.json`:
   `{ "version": 1, "release": "1.4.0", "producerTaxId": "<new>", "fromProducerTaxId": "<old>" }`.
   The host writes it only when the candidate image is a numbered release (`ref.name` label
   `v<version>`) whose `WAITRON_PRODUCER_TAX_ID` differs from the old image's. A start acts only
   when all three match (its `softwareVersion()`, its producer, the chain head's producer), and
   deletes it only when it names its own release and no difference is left. A malformed marker counts
   as absent. Disclosed limit: anyone with root on the box can write the file, as they can edit the
   database; it guards against an accidental producer difference, not a hostile operator.
7. ★ **No new words in the upgrade's report.** A refused trial carries
   `sif.identity_change_waiting` with its reason as A950's failure text; Box status shows A950's
   ordinary deferral. The design's three Spanish report lines are not built.
8. **Order PR 1 → 2 → 3 → 4.** Nothing writes the marker until PR 4, so each PR changes nothing a
   box can reach until the page exists.

## Changed test checks

| Check | Before | After |
| --- | --- | --- |
| `apps/server/src/recovery-surface.test.ts:440-462`, `sif.producer_changed` words (PR 4) | EN title "…and this version of Waitron cannot open one, so the box will not sell."; action "…Changing the producer needs a Waitron version that can open a new fiscal installation, which does not exist yet." (ES likewise) | EN title "This box has been given a different software producer from the one its invoices were recorded under, without the upgrade that opens a new fiscal installation for it, so the box will not sell."; action "Install a Waitron version that names the same producer as this box's invoices. A version with a new producer opens its new fiscal installation by itself when it is installed as an upgrade." ES: "…sin la actualización que le abre una nueva instalación fiscal, así que el equipo no venderá." / "Instala una versión de Waitron que indique el mismo productor que las facturas de este equipo. Una versión con un productor nuevo abre su nueva instalación fiscal por sí sola cuando se instala como actualización." |

No other check reverses: `git grep -n "producer_changed" -- '*.test.*'` lists
`boot.producer-change.test.ts:171-180` (no marker: still refuses), `producer-change.test.ts:59,168,189`
(the seat's refusal, unchanged) and `recovery-surface.test.ts:440-633` (the words above; the
retry-refuses list at `:601-633` stays true).

## Review focus

1. **The marker's owner.** The host runs as root; the app as `waitron` (`deploy/Dockerfile:338`).
   Every copy of the marker is chowned to the state folder's owner, as `candidate.mjs:66-71` does for
   its folders, or the app never reads it (Task 9, a stat assertion).
2. **A failed check puts the old release back with no marker**: the live marker is written after the
   stopped copy, so `restoreStoppedTree` removes it (Task 10).
3. **A crash between the change's commit and the marker's delete**: the next start finds no
   difference and deletes it (Task 5, case 4).
4. **A backup after the change verifies**, and a restore reads its history (Task 3, case 6).
5. **A start that waits is not counted as failed and needs no restart**: it loops in-process and
   carries on when the time service synchronises (Task 5, case 3).

---

## PR 1 — the fiscal module can open an identity-change installation (not yet called)

Result: no behaviour change; `fiscal-verifactu` gains one seat method no route can reach. About 250
production lines, 450 test lines.

### Task 1: the minute rule as a pure function

**Files:** Modify `packages/fiscal-verifactu/src/hour-selection.ts:541-566`; Test
`packages/fiscal-verifactu/src/hour-minute.test.ts` (new).

**Produces:** `export function nextHourMinute(nowMs: number, usedMinutes: readonly number[], settleTargetMs: number): { kind: "take"; minuteMs: number } | { kind: "wait"; targetMs: number; remainingMs: number } | { kind: "refuse"; reason: "minute_in_use" | "minute_not_later"; allowedFromMs?: number; remainingMs?: number; recheckInMs?: number }`, with `settleTargetMs = -Infinity` meaning no settle (as `promote`).

- [ ] Step 1: tests — free current minute → `take` of the current minute; current minute used →
  `wait` with `remainingMs` to the next minute; target more than `WAIT_BOUND_MS` (150 000) ahead →
  `refuse` `minute_in_use` with `allowedFromMs`; a target at `END_MS` → `minute_not_later`.
- [ ] Step 2: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-minute.test.ts` → FAIL (not exported).
- [ ] Step 3: move the rule into `nextHourMinute`; `createHourSelection` calls it.
- [ ] Step 4: the new file, `src/hour-selection.test.ts` and `src/minute-selection-unknown-name.test.ts` pass, the last two unedited.
- [ ] Step 5: `git commit -s`.

### Task 2: the `identity-change` action and its private authority

**Files:** Create `packages/fiscal-verifactu/src/identity-change-authority.ts`; Modify
`allocation-envelope.ts:289,304`, `allocation-operation.ts:120`, `allocation.ts:169-171`; Test
`identity-change-authority.test.ts`.

**Produces:** `withIdentityChangeAuthority<T>(binding: OperationBinding, release: string, run: (authority: OperationAuthority) => Promise<T>): Promise<T>` (calls `withOperationAuthority` with operator `identity-change:<release>`, adds the authority to a module-private `WeakSet`, removes it in `finally`); `isIdentityChangeAuthority(authority: unknown): boolean`. Neither is exported from `index.ts`. At each of the four lists, `identity-change` is accepted only when `isIdentityChangeAuthority` holds, and an identity-change authority is refused for every other action; `:304`'s relinquished check admits `identity-change` beside `promote`.

- [ ] Step 1: tests — an authority from `withOperationAuthority` with action `identity-change` →
  `withHourAdmission` refuses `reauthentication_required`; an identity-change authority with action
  `restore` → refused; the authority after `run` settles → refused; proof by deletion of the
  `WeakSet` check (the first case must fail).
- [ ] Step 2: run it → FAIL. Step 3: implement. Step 4: run it plus `src/hour-throwaway-allocation.test.ts`, `src/allocation-envelope.test.ts`, `src/allocation.test.ts` unedited → PASS.
- [ ] Step 5: `git commit -s`.

### Task 3: `openIdentityChange`, the seat method

**Files:** Create `packages/fiscal-verifactu/src/identity-change.ts`; Modify
`fiscal-verifactu/src/backend.ts:789` (add the method), `packages/fiscal/src/backend.ts:499`
(optional interface member), `fiscal-verifactu/src/errors.ts` (`sif.identity_change_waiting`:
`{ reason: string; remainingMs?: number }`); Test `identity-change.test.ts` (`useVenueDb`, mocked
`readHourRelease` as existing hour tests do).

**Consumes:** Task 1's `nextHourMinute`, Task 2's `withIdentityChangeAuthority`.
**Produces:** `openIdentityChange(db: Database, nodeId: NodeId, marker: IdentityChangeMarker, clocks: { timeService: () => Promise<boolean> }): Promise<"opened" | "nothing-to-open" | "not-named">`, with `IdentityChangeMarker = { release: string; producerTaxId: string; fromProducerTaxId: string }` exported from `packages/fiscal/src/backend.ts`.

Order inside: `not-named` unless `marker.release === softwareVersion()` and `marker.producerTaxId` is the running producer's NIF; `nothing-to-open` outside production; read the clock (`observeTimeServiceHourClock`, then a box sample, `compareHourClocks` with the release floor; `canSelectHour` false → throw `sif.identity_change_waiting` with `clockRefusal`'s reason) before the transaction; inside one `withTransaction`: head producer as `producer-change.ts:26-33` reads it (no head, or equal → `nothing-to-open`; ≠ `marker.fromProducerTaxId` → `not-named`); history through `readHourHistory` + `projectHourHistory` (contradictions → `sif.allocation_invalid` `history_invalid`); `nextHourMinute` (`wait`/`refuse` → throw `sif.identity_change_waiting`); build the input as `hour-throwaway-allocation.ts:47-72` does, with decision 5's approval and `liveSeriesBases`; binding `{ module: "fiscal-verifactu", action: "identity-change", eventId: randomUUID(), sourceId: <old SIF id>, targetNodeId: nodeId }`; then `withHourAdmission` → `createAllocationPreparation` → `activatePreparedModuleAllocation(tx, …)`.

- [ ] Step 1: tests — (1) head under producer A, running B, marker naming B and A, time service
  synchronised → `opened`; the old SIF row revoked, a new one whose `numero_instalacion` is
  `encodeMinuteIdentity` of the box time, old series retired, new `<base>-<name>` series, and the
  next `recordSale` stores `PrimerRegistro` S with the new name while the old record's stored
  `SistemaInformatico` is unchanged. (2) marker naming another release, another producer or another
  `fromProducerTaxId` → `not-named`, nothing written (proof by deletion of each comparison).
  (3) time service not synchronised → throws `sif.identity_change_waiting` `second_clock_missing`,
  nothing written. (4) preproduction → `nothing-to-open`, nothing written. (5) the current minute already in the history →
  `wait` reason. (6) `verifyBackupFiscalHistory` (`backup-verification-history.ts:492`) over the
  changed database passes.
- [ ] Step 2: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change.test.ts` → FAIL.
- [ ] Step 3: implement. Step 4: the file, `src/producer-change.test.ts` unedited and the fiscal gates → PASS; root `scripts/errors-reachable.test.ts`.
- [ ] Step 5: `git commit -s`.

## PR 2 — a start and the upgrade's checks make the change when a marker names it

Result: still unreachable on a box (nothing writes the marker until PR 4); with a marker present, a
selling production start opens the new installation and trades, and the upgrade's checks do the same
on their copies. About 200 production lines, 400 test lines.

### Task 4: the marker file

**Files:** Modify `packages/store/src/state-layout.ts` (export `IDENTITY_CHANGE_FILE = "identity-change.json"`; entry kind `file`, reset `deleted`, backup excluded "An upgrade's one-start instruction."); Create `apps/server/src/identity-change-marker.ts`; Test `identity-change-marker.test.ts`.

**Produces:** `readIdentityChangeMarker(stateDir: string): Promise<IdentityChangeMarker | null>` (exact keys and `version: 1`, else `null`); `deleteIdentityChangeMarker(stateDir: string): Promise<void>` (remove, then flush the folder).

- [ ] Steps: tests (absent → null; malformed, extra key, wrong version → null; well-formed → the three
  fields; delete flushes and a second delete is quiet) → FAIL → implement → `pnpm --filter @waitron/server exec vitest run src/identity-change-marker.test.ts` and root `scripts/state-layout.test.ts` → PASS → `git commit -s`.

### Task 5: the start

**Files:** Modify `apps/server/src/boot.ts:2593-2598`; Test `apps/server/src/boot.producer-change.test.ts` (new cases above the mirror case, which stays last, `:193-195`; the three existing cases unedited).

Before `checkFilingIdentity`, when `acceptingSales` and the marker is present: call
`nodeBackend.openIdentityChange(db, node.nodeId, marker, { timeService: timeServiceSynchronised })`;
on `sif.identity_change_waiting` log `sif.identity_change_pending` with its reason and try again
after `seams.identityChangeRecheckMs ?? WAIT_RECHECK_MS`; on `opened` or `nothing-to-open`, delete
the marker. Then `checkFilingIdentity` runs as today, so `not-named` still refuses.

- [ ] Step 1: tests — (1) marker naming the running build and both producers, time service
  synchronised → trades; the first sale's record is `PrimerRegistro` S under the new name. (2) no
  marker, or one naming another build → `sif.producer_changed`, no SIF row added, and the marker
  naming another build is still there. (3) time service unsynchronised → after two rechecks the start
  has not settled and the failure count in `recovery.json` is unchanged; the time service reports
  synchronised → it trades. (4) the change already made and the marker still present → trades and
  the marker is gone.
- [ ] Step 2: `pnpm --filter @waitron/server exec vitest run src/boot.producer-change.test.ts` → FAIL.
- [ ] Step 3: implement. Step 4: the file, `src/boot.failed-start.test.ts`, root `scripts/module-seams.test.ts` → PASS.
- [ ] Step 5: `git commit -s`.

### Task 6: the upgrade's checks

**Files:** Modify `apps/server/src/upgrade-checks.ts:35,88-90` (an `options: { socketPath?: string }` parameter, passed on by `upgrade-sale.ts:160`); Test `upgrade-trial.test.ts`, `upgrade-sale.test.ts`.

Before line 90, when the copy's node would sell (`readNodeMode` and `isFenced(await readNodeMembership(db), id)` as `boot.ts:2247,2442-2470` read them) and the copy holds a marker: call `openIdentityChange` once with `timeServiceReader(boxHostClient(options))`; a waiting refusal is thrown, failing the check; `opened`/`nothing-to-open` delete the copy's marker. Report `identityChange: "opened"` in the details.

- [ ] Step 1: tests — trial with a matching marker and a synchronised stub → passes and reports
  `opened`; unsynchronised → throws `sif.identity_change_waiting`; no marker → still
  `sif.producer_changed`; sale with a matching marker → the sale's record starts the new chain.
- [ ] Step 2: `pnpm --filter @waitron/server exec vitest run src/upgrade-trial.test.ts src/upgrade-sale.test.ts` → FAIL. Step 3: implement. Step 4: → PASS. Step 5: `git commit -s`.

## PR 3 — the stuck page: the time service, or a device under the box's recovery key

Result: while Task 5's start waits, the box's usual address serves a page that says why, counts
down a minute wait, and accepts a device's time confirmed with the box's recovery key (decision 4).
About 250 production lines, 350 test lines.

### Task 7: the page takes a key check and its own words

**Files:** Modify `apps/server/src/start-clock-waiting.ts:27-41,92` (option `keyMatches?: (key: unknown) => Promise<boolean>`, default `matchesStagedNodeKey(stateDir, key)`; option `words`), `apps/server/src/i18n/start-clock-waiting.ts` (identity-change words, EN and ES); Test `start-clock-waiting.test.ts`.

Words (EN): title "Opening this box's new fiscal installation"; why "This version of Waitron has a new software producer, so the box opens a new fiscal installation before it sells. It carries on by itself once it can check its time over the internet. Or enter this box's recovery key to confirm the time from this device." ES to match. A minute wait shows `wait-countdown.ts`'s countdown.

- [ ] Steps: tests (a request without the key refused `promotion.break_glass_invalid`; with
  `keyMatches` answering true → challenge/confirm work; the restore's existing cases unedited) → FAIL
  → implement → `pnpm --filter @waitron/server exec vitest run src/start-clock-waiting.test.ts` → PASS → `git commit -s`.

### Task 8: the start serves it and uses its confirmation

**Files:** Modify `apps/server/src/boot.ts` (Task 5's loop), `fiscal-verifactu/src/identity-change.ts` and `packages/fiscal/src/backend.ts` (`clocks.confirmation?: () => KeptClockConfirmation | null`); Test `boot.producer-change.test.ts`, `identity-change.test.ts`.

The loop serves `createStartClockWaiting({ keyMatches: <check against readRecoveryKeyVerifier(store.node)>, words: identity })` through `startTradingListener` as the peer waiting start does (`boot.ts:2334-2351`), closing it when the change is made. A confirmation becomes a confirmed device reading as `hosted-hour-recovery.ts:79-85` makes one; a refused try drops it (`dropConfirmation`).

- [ ] Steps: tests (a confirmation from the box's own address is ignored; a device 31 seconds off is
  refused and nothing is written; an agreeing confirmation with the key → opened and the start
  trades; a minute wait answers its remaining milliseconds) → FAIL → implement → both files → PASS.
  The page is opened and looked at in both themes and at phone width (CLAUDE.md §4) → `git commit -s`.

## PR 4 — the upgrade writes the marker

Result: the outcome. A950's driver writes the marker for a producer-changing release; the trial
can read the time service. About 120 production lines, 250 test lines, plus documents.

### Task 9: the host computes the marker and gives it to the trial

**Files:** Modify `scripts/box/upgrades/host.mjs:246-307` (after the candidate ids, inspect `old.app`
and `next.app` for `Config.Env` `WAITRON_PRODUCER_TAX_ID` and the `org.opencontainers.image.ref.name`
label; decision 6's marker or `null`), `:758-803` (write it into the trial copy between capture and
trial, chowned; mount a `clockStatusRelay` folder at `/run/waitron-box` read-only, as
`candidate.mjs:72,81`), `:309-311` (save it as `identity-change.json` in the attempt directory);
export `IDENTITY_CHANGE_FILE` beside `RETAINED_LOCK_PATHS`. Test `host.test.mjs`.

- [ ] Steps: tests (a release with another producer → the trial's state holds the marker, owned by
  the state folder's owner; same producer or a `main` candidate → no marker anywhere; the trial
  carries the relay mount and still `--network none`; the host's file name equals
  `state-layout.ts`'s, as `host.test.mjs:9` reads store constants) → FAIL → implement →
  `pnpm exec vitest run scripts/box/upgrades/host.test.mjs` → PASS → `git commit -s`.

### Task 10: the stopped checks and the live state get it; documents

**Files:** Modify `scripts/box/upgrades/candidate.mjs:64-66` (copy the attempt's marker into
`work/state`, chowned), `host.mjs:329-331` and `:398-409` (both `installCandidate`s write it into
`paths[0]` with `writeFileDurable`, chowned). Tests `candidate.test.mjs`, `host.test.mjs`,
`transaction.test.mjs`. Documents: CLAUDE.md §5 (the producer bullet, `:1026-1033`, becomes "A
production start opens a new installation for another producer only when the upgrade's marker names
it", naming this plan's guards; the restore/promotion bullet `:1034` gains the identity change);
`recovery-page.ts:308-320` and its test (table above); `docs/backlog.md:238,242-246` and
`docs/backlog/fiscal.md:1584-1624` (delete A993; the owner's constraint moves to `## Decisions and
deliberate limits`, `:1086`); `docs/operations/release.md` (a short "Changing the producer" section:
set the three secrets, set `WAITRON_PRODUCER_CHANGE_ALLOWED`, which stays the deliberate act at
`.github/workflows/ci.yml:4695-4732`, and install as an upgrade).

- [ ] Steps: tests (apply → the live state holds the marker after the copy and before the checks; a
  failed check with Restore → the live state has no marker; Keep after a failed check → the marker
  is written; the check copy holds it) → FAIL → implement → the three files and root
  `scripts/claude-md-pointers.test.ts` → PASS; `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` → PASS → `git commit -s`.

## Risks to which chain a record joins

| Risk | Guard |
| --- | --- |
| A sale joins the old chain under the new producer | `checkFilingIdentity` still runs after the step (`boot.ts:2595-2598`); `boot.producer-change.test.ts:171` unedited |
| A stray setting or stale marker opens one | Production, a selling box, a marker naming this release, this producer and the head's; proofs by deletion (Task 3 case 2) |
| Another caller opens one | Private one-use authority, refused for every other action (Task 2) |
| A name from a wrong clock or already used | Time service or key-confirmed device within 30 s, release floor, history (Tasks 3, 8) |
| A half-made change | One transaction through the unchanged activation; the marker outlives a crash (Task 5 case 4) |
| The old release restored with a marker | Written after the stopped copy (Task 10) |
| Two venues of one taxpayer take the same minute | A947's disclosed limit; one main box at a time |

## Not established

- Whether any boot-time watchdog stops a start that waits for many minutes in Task 5's loop (read
  only `node-entry.ts:300-337`'s ordering notes, which say a hanging boot never throws).
- A950's paired upgrades (a spare on the old release promoted after the main box changed) are not
  built; such a promotion opens its chain under the old release's producer, which that release
  declares. Read from the backlog, not checked against code.
