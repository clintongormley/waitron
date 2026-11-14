# A1308 file layout fl10: the module list moves from `modules.json` into the `settings` table — OWNER LANDS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** The venue's module on/off list is the `settings` row `modules` inside `venue.db`, so a
restore can never pair a database with another time's module list; boot migrates core's set first,
reads the row, then migrates the enabled modules' sets.

**Architecture:** A settings document `modules` (slice 1b-i's `defineSettingsDocument`, key
`"modules"`, version 1, defaults `{ modules: {} }`, checked by `parseModuleConfig`,
`packages/module/src/config.ts:13-19`) replaces the file. `readModuleConfig`/`writeModuleConfig`
(`apps/server/src/module-config.ts`) keep their names and return types but take a database handle.
Trading-mode boot (`boot.ts:1210-1225`) runs `applyMigrations` twice: core and node first, then the
enabled set read from the row (re-applying core is a no-op). Every writer saves the row; every reader
reads it; archives, backup verification and handover stop carrying a `modules.json` file because the
row rides inside `venue.db`. No table, column or migration changes (slice 1a: no set gains a second
migration; this adds a data row only).

**Tech Stack:** TypeScript 7, `node:sqlite` via `@waitron/db`, Vitest 4.1.12.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 (`modules.json` paragraph),
§3 rows 9 and 63, §4 "Wrong module set after a restore", §5 T5; README §7 "`modules.json` moves into
`settings` if core's tables can migrate before modules are read"; settings table:
[`2026-11-08-a1308-1b-settings-table.md`](2026-11-08-a1308-1b-settings-table.md). Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md). Lines at `649b7576e0`.

**Who lands: the owner.** The list chooses the fiscal module (`fiscal-slot.ts:12-49`), and this
changes what a restore's recovery preview (`recovery-fiscal-selection.ts:32-39`) and a handover's
comparison (`handover-compare.ts:334`) read to decide it.

**Blocked on A1379 part 2, through fl8a.** This slice needs fl8a (Start again's list), which needs
fl7 and A1379 pull request 2; the owner answered part 2's three questions on 2026-11-09
(`docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md`), so it waits only to land.

**First line of the pull request:** "Every venue is reset: the module list moves into venue.db;
backups and exports from before this cannot be restored."

## A correction to the design (read, not run)

files.md calls the file "dashboard-editable". No dashboard route writes it
(`docs/backlog/architecture.md:31-33`; `packages/module/src/config.ts:13` calls it
"operator-editable"); its writers are setup, adoption, provisioning, the command line and dev
tooling (Task 2). The owner's decision to move it stands on the restore-pairing reason alone.

## T5 — read, not run; Task 1 runs it

Readers before the database is in use: boot (`boot.ts:1095`), which chooses the trading-mode
migration sets from it (`:1215-1219`); the repair page (`first-setup-entry.ts:249`, no migration,
already tolerates an unreadable list). Restore migrates every module regardless
(`restore.ts:446-452`; `restore-request.ts:469-471`), and `node-entry.ts` opens `venue.db` before
boot anyway (`assertNotAhead`, `:654`). Core declares no `requires`
(`packages/composition/src/modules.ts:151-161`) and `scripts/module-graph-honesty.test.ts` requires
any SQL dependency between sets to be declared, so core's set depends on no other; `settings` is in
core's set (1b-i) and its `updated_by` key points at `persons`, also core. So core can be migrated,
the row read, and the rest migrated. Task 1's first test is the run; if it fails, that is T5's
failing result (stop point).

## Global Constraints

- Rules §1, §4, §5, §6, §8, §9. `git commit -s`; never `--no-verify`.
- An absent row behaves as an absent file does today: everything enabled, so a venue with both
  fiscal modules enabled fails `module.fiscal_slot_ambiguous` exactly as `provision.ts:181-183`
  arranges today. No new default.
- `handover.modules_differ` keeps its meaning: the two boxes' switched-off sets must match.

## What it builds

1. `packages/module/src/config.ts` exports the document: `MODULES_SETTINGS =
   defineSettingsDocument<{ modules: Record<string, boolean> }>({ module: "modules", version: 1,
   defaults: { modules: {} }, parse })`; `parse` reuses `parseModuleOverrides` for the check.
   (If 1b-i placed `defineSettingsDocument` in `@waitron/db`, `@waitron/module` already depends on
   it; check `packages/module/package.json` and stop if it does not.)
2. `module-config.ts`: `readModuleConfig(db: Database): Promise<ModuleConfig>`;
   `writeModuleConfig(db: Database, config: ModuleConfig, actor: string | null): Promise<void>` via
   `saveSettings` with the revision it read.
3. Boot (`boot.ts:1095-1104,1210-1278`): in trading mode, `applyMigrations` for core and node, a
   short-lived open to read the row, then `applyMigrations` for `orderedMigrationSets(enabled)`.
   **Core's triggers-restored alert is kept.** Today boot lists the append-only triggers missing
   BEFORE it migrates (`missingBeforeMigration`, `append-only-watch.ts:27`, called at
   `boot.ts:1223`), because migrating puts them back; it then logs
   `append_only.triggers_restored` and stamps `appendOnlyRestored.restoredAt` (`:1255-1260`),
   which the alert reads (`alert-sources.ts`). If the check ran only before the second pass, core's
   triggers would already be back from the first pass and the alert would never fire for a core
   table such as `sales`. So boot runs `missingBeforeMigration` twice: over the first pass's
   append-only tables (core and node) before the first pass, and over the second pass's remaining
   tables (those not already checked) before the second pass. The two lists are joined into the one
   `restoredTriggers` that `:1255-1260` reads, so the log line, `restoredAt` and the alert come from
   the same place as today. `assertAppendOnlyIntact` (`:1251`) runs once, after the second pass,
   over both passes' tables. Setup mode still migrates everything in one pass and reads the row from
   the open database. The first-setup host takes `moduleConfig: () => ModuleConfig` in place of a
   value (it already takes `database: () => db`).
4. Writers: `module-operation-host.ts:104-109` (`publishSelection`), `adopt.ts:84,193-194` (after its
   commit, `boot.ts:1632-1633`), `provision.ts:181-183`,
   `packages/provisioning/src/first-setup-command-deployment.ts:188-194`,
   `packages/provisioning/src/bin.ts:70-71,90-99` and `cli.ts:63-64,481` (through the database the
   command already opens, `cli.ts:514`), `apps/server/scripts/dev-setup.ts:332-342`.
5. Readers: `first-setup-entry.ts:249` (reads the row from the setup database read-only; an unreadable
   database keeps today's `.catch` behaviour), `mirror-bundle.ts:160-168,224`,
   `handover-manifest.ts:197-204`, `first-setup-runtime.ts:135-140,183-187`,
   `module-operation-host.ts:90-94`, `recovery-fiscal-selection.ts:32-39` (from the preview's own
   open copy, `recovery-backup-preview.ts:54-74`).
6. The file stops travelling: `backup-optional-state.ts:12`, `archive-entries.ts:48`,
   `backup-data-placement.ts:50`, `backup-verification-compatibility.ts:78,226`,
   `backup-verification-secrets.ts:95-109`, `reset-request.ts:111`,
   `first-setup-start-again-deletion.ts:59,79-88,137,277,494-497,601-603` (the database Start again
   deletes holds the row), `first-setup-resolution-inspection.ts:284`, `setup-api.ts:265`,
   `venue-fiscal.ts:20`. Handover: `packages/handover/src/manifest.ts:143-148` keeps one row, item
   `settings:modules`, class transferred, compared by the same digest; `indicator-parse.ts:127`,
   `handover-compare.ts:334` and `errors.ts:242` use that item name.
7. Layout: `MODULES_FILE` deleted. Docs: `deploy/README.md:25,465`, `docs/backlog/architecture.md:31-33,323-325`,
   `docs/backlog/box.md:310`, `docs/backlog/replication-cloud.md:1198`, `docs/backlog.md` lines that
   say the list is a file (`git grep -n modules.json docs/backlog* deploy`). Wording:
   `apps/dashboard/src/i18n/codes.ts:1468-1475` at `5338b917a2` (`:1464-1471` at this plan's base;
   `handover.settings_unreadable` and
   `handover.destination_settings_unreadable`, English and Spanish) name `modules.json`; it becomes
   "its module list" / "su lista de módulos" (fl9 changes the `module-preparation-state.json` name
   in the same sentences).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| A dashboard screen to switch modules | None exists today and the design asks for none | — |
| Deriving the fiscal slot from `nodes.filing_module` (`boot.ts:2077`) instead of the list | A behaviour change the design does not make | — |

## Files

As named in What it builds, including `apps/dashboard/src/i18n/codes.ts`. Test: the 101 test files
naming `modules.json` (re-counted at `5338b917a2`; 49 boot tests hold 87 of the hits, most writing
`FISCAL_NONE_OFF` before boot) move to a helper `seedModuleSettings(venueDir, overrides)` in
`apps/server/test/module-settings.ts`, which migrates core's set if needed and saves the row. That
migration is work boot would otherwise do itself on its first pass, so the net added work per test
should be one open and one row write; Task 2 measures it rather than assuming it; and the harnesses
`apps/server/src/testing/{boot-harness.ts:36, place-copy-box.ts:319,396, staged-hour-crash.ts:182,
staged-hour-restore.ts:173, stream-loop-scenario.ts:362, stream-pause-scenario.ts:408}`.

## Size

Estimated: code ~450 counted (boot with the two-pass trigger check ~110, config and module-config
~60, writers ~80, readers ~70, archive/verification/handover/Start again ~110, layout ~5, recovery
selection ~15); tests ~430 (helper ~50, T5 and new cases ~120, fixture edits across ~100 files
~260); docs ~30. **Total counted ~910.** At the cap's edge: if it passes ~1,200, stop (rules §5.6) and split archive and handover
out into a second owner-landed PR.

## Finish line

- `git grep -n 'modules\.json' -- apps packages scripts deploy` prints nothing.
- `pnpm --filter @waitron/server exec vitest run src/module-config src/boot. src/provision src/mirror-bundle src/handover- src/recovery-fiscal-selection src/backup- src/restore src/reset-request src/first-setup src/first-fiscal src/hour- src/promote-endpoint-e2e src/start-from-spare.e2e src/till-reroute-e2e`;
  `pnpm --filter @waitron/provisioning exec vitest run src/cli- src/first-setup-start-again`;
  `pnpm --filter @waitron/handover exec vitest run`; `pnpm --filter @waitron/module exec vitest run src/config`.
- `pnpm exec vitest run scripts/handover-manifest-complete.test.ts scripts/state-layout.test.ts scripts/module-graph-honesty.test.ts scripts/live-subscriptions.test.ts`.
- Typecheck module, server, provisioning, handover, store; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.** A `settings` row is data; no table, column, index or trigger changes. (If 1b-i's
`settings_module_ck` refused `"modules"`, that would be a stop, not a schema change here.)

## Stop points

Rules §5, plus:
- **T5 fails**: Task 1's first test shows core's set cannot be migrated and read before the module
  list is known. The design's fallback: `modules.json` stays a file, written durably (fl3 already
  does); the watcher confirms and this plan ends.
- `@waitron/module` cannot reach `defineSettingsDocument` without a new dependency that closes a
  workspace loop (`scripts/workspace-cycles.test.ts`): stop.

## Needs

1b-i (the settings table and API) landed; fl3 and fl8a landed (Start again's list), and through
fl8a, fl7 and A1379 pull request 2 (header). Batch 3's
environment plans need not land first.

## Review Focus

1. A trading venue with workforce switched off in the row: workforce's tables are not created, and
   its routes are not mounted (Task 1).
2. A venue with no row and both fiscal modules: boot fails `module.fiscal_slot_ambiguous`, as today
   (Task 1).
3. A restore of an archive whose database switches bookings off: the restored box runs with bookings
   off, whatever the box had before (Task 3).
4. A handover between boxes with different switched-off sets still refuses
   `handover.modules_differ` (existing cases, item name only).
5. The repair page with an unreadable setup database still renders (existing
   `first-setup-entry` cases).
6. A core append-only trigger dropped while the box was off still raises
   `append_only.triggers_restored` at the next start (existing cases, unchanged assertions), and so
   does a module set's (Task 1).

---

### Task 1: The document and boot's two passes (T5)

- [ ] **Step 1:** Failing cases: in `apps/server/src/boot.test.ts` (or the boot file that owns
  module selection), `"trading boot migrates core, reads the modules row, then migrates only the
  enabled sets"` (seed core-only venue with a row switching `workforce` off; expect `persons`
  present and workforce's first table absent, and no workforce route mounted);
  `"no modules row with both fiscal modules is ambiguous"`; `"a module set's append-only trigger
  dropped while the box was off is reported restored"` (drop `registros_facturacion`'s delete
  trigger, a `fiscal-verifactu` table, `packages/fiscal-verifactu/src/classification.ts:6`, on a
  venue whose row enables that module; boot; expect one `append_only.triggers_restored` line naming
  it); in `packages/module/src/config.test.ts`, `"the modules document refuses a mandatory module
  switched off"`. Core's alert is proved by the two existing cases, which keep their assertions
  (rules §4) and only move their module-list set-up to `seedModuleSettings`:
  `apps/server/src/boot.failed-start.test.ts:1090`, "a trigger dropped while the box was off is put
  back and the start goes on" (drops core's `sales_append_only_delete` and expects the warning line
  naming it), and `apps/server/src/boot.restore.test.ts:605-675` (the alert is raised when a start
  put back a dropped trigger, and not for an untouched venue). If the check ran only before the
  second pass, the first would print an empty list where it expects `["sales_append_only_delete"]`.
- [ ] **Step 2:** Run; fail. Implement What it builds 1-3. Run; pass — this is T5's run; paste the
  result in the PR. Commit.

### Task 2: Writers and readers

- [ ] **Step 1:** Write `seedModuleSettings` and move the fixtures to it (rules §4: set-up only);
  list in the PR every test whose assertion read the file and now reads the row. Measure before and
  after: `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts
  src/boot.restore.test.ts`, three runs each on the base and on the branch, reading Vitest's
  `Duration` line. The failing result is the branch's median more than 10% slower than the base's:
  stop (rules §5.4); the fallback is a helper that copies a core-migrated venue folder made once per
  test file, and the watcher confirms it.
- [ ] **Step 2:** Implement What it builds 4-5. Run the Finish line's server and provisioning
  files. Commit.

### Task 3: Archives, verification, handover, Start again

- [ ] **Step 1:** Failing case in `restore.test.ts`: `"a restored box takes the module list from the
  archive's database"`. No case for an older archive that still carries `secrets/modules.json`:
  none exists (owner, 2026-11-08: "no old backups exist"; CLAUDE.md §3, no backwards-compatibility
  code before go-live), so the verifier's `modules.json` block (`backup-verification-secrets.ts:95-108`)
  is simply deleted and nothing refuses or converts such an archive.
- [ ] **Step 2:** Implement What it builds 6-7. Run the Finish line. Commit.

## After the tasks

`/finish-branch` with this plan as its note; the lane marks the PR "owner lands" and does not merge.

## Implementation decisions, 2026-11-14

The watcher cleared the catalogue-aware `modulesSettings(modules)` factory at 03:37,
instantiated beside server composition as `MODULES_SETTINGS`. The document shape and
mandatory-module check stay as planned. At 04:14 the watcher replaced Task 1's
workforce-off example with toggleable bookings: workforce became mandatory in A1002.
The mandatory-workforce refusal and default-ambiguous assertions stay. These are
watcher clearances, not a separate owner approval of the design.

At 05:08 the watcher cleared the additional `upgrade-checks.ts` reader, using its
already-open environment-checked probe, and retirement of module-config's malformed
JSON, EISDIR and mode-0600 file checks. Default, enabled, unknown-module and round-trip
assertions remain on the row. The fixture helper also accepts an already-open venue
handle; directory fixtures migrate core only when `settings` is absent, so seeding
cannot restore a deliberately dropped trigger before the boot under test.

At 05:30 the watcher cleared one coherent PR up to 2,600 counted lines because the
caller and fixture ports cannot land independently. At 05:43 the watcher cleared
Start again removing a setup database holding only its module selection, with no
committed venue or fiscal rows. The three corresponding refusal cases now check
deletion; trading-configuration and retained-ledger refusals remain. The owner
lands this slice. These are watcher clearances, not a separate owner design approval.

At 06:09 the watcher cleared reuse of the failed-start fixture's migrated
template row, saving selection again only for an explicit override. The timing
comparison uses five runs on each side and the same 10% median stop.


At 06:32 the watcher cleared the gathered review corrections and up to 2,700
counted lines. Provisioning saves the module row in applyVenue's existing
beforeCommit transaction, using its supplied catalogue and keeping the caller's
hook. The unused repair-page reader in What it builds 5 is removed: that
resolution app mounts inspection, summary and Start again, with no row-dependent
methods. Its existing unreadable-database cases remain. The no-row restore case
reads the restored venue instead of the suite's database. The held-setup row
count changes from 122 to 125: the measured differences are settings 2→3 and
activity_log 5→7, with kept/record/byte assertions retained. The handover digest
stays as Global Constraints requires; the watcher settled reviewer B's question
about its value. These corrections are watcher clearances, not separate owner
approval of the design.
