# A1042: "Start again" keeps one small note, not an archive — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Task 0 re-runs a fresh-context review of this plan against main after A731 lands, before any implementer is dispatched.**

**Revisions, 2026-10-24.** Revised three times for fresh-context reviews, all with probes run on main: `~/waitron-campaign/item-a1042-plan-review.md` (round 1: 4 high, 4 medium, 8 low), `item-a1042-plan-review-2.md` (round 2: 2 high, 6 medium, 4 low) and `item-a1042-plan-review-3.md` (round 3: 3 high, 6 medium, 7 low). The PR description lists each finding and what changed. Round 2 corrected the plan's account of `node.db`: it holds no tables at all. Round 3 corrected the recovery-page wording to the owner's never-reset rule and covered the record store's nested step folders.

**Goal:** when the owner presses **Start again** on an unused first setup, the box checks once that the attempt never activated, filed or sold anything, deletes the attempt, and keeps one small note: the last invoice series name any attempt chose. From then on the box never issues a series name at or before that note.

**Architecture:** the note is one small file in the box's own settings folder (the "state folder", `WAITRON_STATE_DIR`), written only by Start again, only ever raised, and never carried in or written by a backup. Every place that picks a new production series name — first setup, a restore, a re-registration and a promotion — adds the note to the history it already checks, as a "time floor" (the earliest moment a new name may be taken). A second small file, written before any deletion and removed after it, names exactly what Start again is deleting, so a deletion cut off by a power cut is finished safely or refused with a page that says what to do. The kept copies of abandoned attempts ("retirement archives") and the separate folder each new attempt used to get (a "workspace") are removed.

**Tech stack:** TypeScript, Node's `node:sqlite`, Vitest (real databases through `useVenueDb`), Lit and Chromium for the setup screens.

**Spec:** the owner's ruling of 2026-10-24 04:39 (`~/waitron-campaign/questions.md`, "OWNER ANSWER — A1037's open question: neither; replace the archive with one small note") and the queue entry A1042 (`~/waitron-campaign/queue.md`). Read both with this plan. The ruling supersedes "Preserve the original attempt and artifacts" in `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md:157`.

**Before the build:** the owner answers the open questions and approves the section "Existing assertions this plan changes" in one answer. Until then no implementer is dispatched.

## Words used in this plan

- **Attempt:** one run of first setup, from claiming the box to finishing. Its record is `first-setup.json` in the state folder and `first-setup-claim.json` in the venue folder.
- **Series name:** the five symbols after an invoice series letter, such as `0CNQT` in `A-0CNQT`. They encode the UTC minute the name was chosen (`packages/fiscal-verifactu/src/hour-identity.ts`), so a later minute is a later name.
- **Start again:** the repair page's button for an interrupted, unused attempt (`apps/setup/src/setup-app.ts:2188-2231`).
- **Retirement archive:** what Start again keeps today — a byte-for-byte copy of the abandoned attempt's files, plus the abandoned folders themselves.
- **Workspace:** the fresh pair of folders under `<state>/first-setup-workspaces/<id>/` that Start again moves the box into today. The box's original folders are the **anchor**.
- **Kept picks file:** `module-preparation-state.json`, which keeps every name the chooser has picked on this box, in the anchor state folder.
- **Empty-database proof:** the one-time check that the venue database holds no business rows and the attempt never reached activation.
- **Time floor:** a moment before which no new series name may be taken. The name chooser already takes several (`packages/fiscal-verifactu/src/hour-history.ts:20,72-73`).
- **Module seat:** a hook in the shared module contract that a module fills in, so shared code can ask the fiscal module a question without knowing fiscal rules (`CLAUDE.md` §3, composition list rule).
- **Throwaway naming:** the naming used by Demo, Preparation, a development box's Live, and the readiness test run before a production Live; it has no history check (`apps/server/src/setup-api.ts:585,598-605`, `packages/provisioning/src/fiscal-readiness-runner.ts:40`).
- **Side files:** SQLite's `-wal` and `-shm` files beside a database.
- **Recovery page:** the page the box serves when it cannot start, with a title and an action chosen by error code (`apps/server/src/recovery-surface.ts:251-480`). **Repair page:** the setup app's page for an interrupted first setup.
- **Golden huella test:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, which pins the fingerprint ("huella") of real fiscal records; the **inmutabilidad suite** is `packages/fiscal-verifactu/src/inmutabilidad.test.ts`, which pins that fiscal records cannot be changed.
- **STOP:** the campaign rule that a changed or deleted existing assertion waits for the owner.

## Global constraints

- Fiscal: invoice series names. Review path FULL. The PR ends `needs-owner-review`; the owner lands it.
- The golden huella test and the inmutabilidad suite pass **unedited**. No change to `registerSif`, fiscal writers, hashes, numbering, SQL, migrations or `registros_facturacion`.
- No migration. No backwards-compatibility code (`CLAUDE.md` §3).
- The empty-database proof is never loosened. Who may Start again (`apps/server/src/first-setup-resolution.ts:233-299`) stays as it is, except where an approved open question narrows it; **no implementer changes those rules to make a test reach its scenario.** This plan only narrows them (Q1, the `node.db` rule, outside evidence, an unfinished deletion).
- Missing, partial, corrupt or unreadable never counts as empty, **with one stated exception:** a missing `node.db` counts as nothing to check, because no migration set is ever applied to it (`packages/migrations/src/apply.ts:33`, "`node.db` stays empty (#548)"; `packages/db/src/client.ts:56`). A missing note file, or a missing state folder, means "no floor" (`readDurableHostJson` returns `null` for both, `packages/provisioning/src/durable-host-json.ts:22-26`); a note that exists but is empty, partial, has unknown keys, or holds an empty string is refused, never read as "no floor" (`CLAUDE.md` §3, "An empty value is a valid value").
- The note and the deletion marker are written only inside Start again's existing turn — `host.resolution.withVenueExclusion` (holding `venue.lock`, which refuses a second process) and `host.coordinator.run` (one action at a time in this process) — and the marker is removed by the start under `lockVenueDatabase`. Writes go through `writeDurableHostJson` (`durable-host-json.ts:44-90`: temporary file, file sync, rename, folder sync; it sets the folder to `0700`, as the claim marker already does, `packages/provisioning/src/first-setup-state.ts:558`). Never unlink `venue.lock`, `venue.holder.json`, `migrations.lock` or `recovery.lock`.
- Each new provisioning file has `import "./errors.js";`.
- Error codes. Reused: `sif.allocation_invalid` with `{ reason: "minute_not_later", allowedFromMs }` for a name refused because of the note, which the setup and restore screens already explain in English and Spanish (`packages/fiscal-verifactu/src/setup/clock-wait.ts:100-111,263-269`); `setup.attempt_invalid` for a damaged note (the setup screen shows "The saved setup cannot be read. Contact support.", `apps/setup/src/i18n/strings/shell.ts:8`); `setup.not_ready` for a Start again that is not allowed. **New, two:** `setup.start_again_incomplete` (a Start again deletion is unfinished, or cannot be finished safely) and `setup.workspace_unsupported` (the box holds a first setup kept by an earlier Waitron, D4). Each is registered in `packages/provisioning/src/errors.ts` with no params, imported where thrown, given recovery-page operator text (D5), and given setup-app wording in English and Spanish through both `apps/setup/src/i18n/strings/shell.ts` and the code-to-text map `FIRST_SETUP_ERROR_MESSAGES` (`apps/setup/src/setup-app.ts:194-199`, read at `:749,1152,1442`; without the map entry nothing reads the strings). Why new codes and not `setup.attempt_uncertain`: the recovery page picks its advice by code, and `setup.attempt_uncertain` is also thrown on committed paths (`apps/server/src/first-setup-publication.ts:27-34`, `first-fiscal-activation.ts:31-33`, `packages/provisioning/src/first-setup-state.ts:513`), so its text must stay general.
- **The recovery page never suggests wiping or resetting anything** (owner decision 2026-09-10, `apps/server/src/recovery-surface.ts:247-249`: "the action is always restore or reinstall"). The test that pins it is `apps/server/src/recovery-surface.test.ts:386-394`, "never suggests wiping anything, in either language". Every task that touches recovery-page text runs `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` whole, not only its new cases.
- English only in code, tests and comments; Spanish only in translation files.
- Coverage holds `98/98/98/95` in every touched package. `@waitron/fiscal-verifactu` has no mutation run (no Stryker config there; `docs/developers/ci-and-gates.md:417` lists only `packages/fiscal`).
- Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover.
- **Any change to an existing assertion that is not in "Existing assertions this plan changes" is a STOP.** The implementer reports it; it does not make it.
- A run with no `Tests` count is no evidence (`CLAUDE.md` §4). Run each command from the worktree root.

## Current behaviour (read at db4e0a6bf, with runs named)

What was run. By me: `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts` (36 passed), and the sweep commands in "How the assertion list was built". By the reviewers, in throwaway worktrees at the same commit:

- Turning off the kept-picks history source moves today's refusals to the archive check (`setup.attempt_conflict`, HTTP 409).
- Start again on an attempt that has chosen a name, with the `no-current-master` answer, is refused `setup.not_ready`. With the `current-master` answer, a new attempt whose clock is 10 minutes behind is refused `minute_not_later` with `allowedFromMs` 1792150980000 (the start of the minute after the abandoned name), and the kept picks file is still there afterwards.
- After the start's own `applyMigrations` and `openVenueDatabase`, `node.db` has an empty `sqlite_schema`; `venue.db` holds `change_log, node_roles, mirror_config, join_requests, node_sealed_state, fiscal_certificate_installs, fiscal_certificate_reminders`. `firstSetupDatabaseIsEmpty` answers `true` for that `venue.db` and `false` for that `node.db`. A read-only open of a missing file throws "unable to open database file".
- Read-only opens of both databases create `-wal` and `-shm` side files, which stay after the connections close; a read-only open leaves `-wal` at 0 bytes. A committed row can live in `-wal` alone while the main file's bytes, and so its SHA-256, stay the same (round 3: `main=8192 -wal=4152`, same hash, a later reader sees the row; `packages/store/src/index.ts:51-54` says the same).
- After a complete Live first setup and the trading restart, `node.db` still has an empty schema (round 3).
- Two password recoveries on one attempt leave the record folder holding `000001.json … 000004.json`, `manifest.json`, `original-0-0.json` **and a `step-000003/` subfolder** with its own `manifest.json` and chunk (round 3; `packages/provisioning/src/first-setup-resolution.ts:461-462`).
- The recovery page rendered with `uncounted: true` for a code that has nothing to do with the disk prints "This start was not counted: the disk is full." (round 3).
- The password Start again on a missing database succeeds for an attempt abandoned after `activation-started`, and also for one taken through `committed` with a result; with the database present, the same attempt is refused `setup.not_ready`.
- One attempt from `hourFirstFiscalFixture` leaves `first-fiscal-documents/fiscal-verifactu.recovery.json`, `first-setup-node-key.json`, `first-setup.json`, `module-preparation-state.json` in the state folder and `first-setup-claim.json`, `venue.db`, `venue.lock` in the venue folder.

Everything else in this section was read.

**Where Start again keeps the attempt.** `startAgainFirstSetup` (`apps/server/src/first-setup-resolution.ts:210-345`) checks the request against a fresh inspection (`:222-229`), requires the attempt's status to be `claimed`, `consumption-intent` or `abandoned` (`:233`), runs the empty-database proof (`:234-270`), snapshots the attempt's files (`:251`), makes a new workspace path (`:307-318`), writes a `retire` record holding the snapshot (`:319-337`), and moves the box into the new workspace (`:338`; `selectFirstSetupWorkspace`, `packages/provisioning/src/first-setup-workspace.ts:330-408`, writes the retirement witness, the backlink and both selection files at `:399-401`). The abandoned folders stay. The route answers `{ workspaceId, selectionGeneration, restarting: true }` and restarts the server (`apps/server/src/setup-first-fiscal-api.ts:813-851`). Start again is served only by the repair listener, which runs without the venue store open: the route is wired at `apps/server/src/first-setup-entry.ts:165`, and ordinary setup mounts the repair routes without it (`setup-first-fiscal-api.ts:416`).

**Who may Start again today.**
- With no password: an attempt with no history beyond claiming (`unused`, `first-setup-resolution.ts:40-51`) plus a confirmed `no-current-master` answer (`:276-282`); or an attempt that chose a name but never used it (`apps/server/src/first-setup-unused-assignment.ts:9-140`) with a `current-master` answer or none (`:253-258`).
- With the original password: also a missing database (`:296-298`). On that route only the status is checked (`:233`); history and result are not read. In production any status except `complete` and `abandoned` can be abandoned through `POST /setup-api/first-setup/abandon` (`setup-first-fiscal-api.ts:555-561`, `packages/provisioning/src/first-setup-owner.ts:171-185`, `first-setup-state.ts:720-722,799-801`), so an attempt whose fiscal commit finished can be started again with its database missing (reviewer's probe). This is not a live defect today: Start again deletes nothing, it archives the attempt with its frozen request and inputs, the next attempt's names are checked against the archives and the kept picks file, and the database was already gone before Start again ran (round-2 review, item M5, read). Q1 decides it for the new design.

**Every reader of the archives.**

| Reader | Defined | Called from | What it decides |
| --- | --- | --- | --- |
| `readFirstSetupRetirementArchives` | `packages/provisioning/src/first-setup-workspace.ts:511-550` | `apps/server/src/module-operation-host.ts:54`; `apps/server/src/first-setup-resolution.ts:242`; A731's branch `apps/server/src/first-setup-backup-history.ts:58` (d5fe61367, not on main) | walks every retirement and re-checks every archived file |
| `readFirstSetupRetirements` | `first-setup-workspace.ts:552-559` | `packages/provisioning/src/first-setup-runtime.ts:88` (refuses `setup.not_ready` if any exist and no host reader was given) | — |
| `readRetiredFirstSetupStates` | `first-setup-workspace.ts:572-576` | `packages/provisioning/src/first-setup-state.ts:650` (`claim` refuses a new attempt that reuses any old id) | — |
| `readRetiredSetup` (host seat) | type `packages/module/src/operation-preparation.ts:48-54`; server `apps/server/src/module-operation-host.ts:52-78` | `packages/provisioning/src/first-setup-preparation.ts:85` (`assertFreshAssignment`, refusing `setup.attempt_conflict`, `:91-121`), run at select `:226`, import `:267`, activation (`apps/server/src/first-fiscal-activation.ts:111`, `packages/provisioning/src/first-setup-activation.ts:105`) and evidence reads (`module-operation-host.ts:119`); `first-setup-runtime.ts:212`; the historical dispatcher `packages/fiscal-verifactu/src/allocation-configuration.ts:58-119`, which production does not use (its header `:1`; `packages/fiscal-verifactu/src/index.ts:8`) | refuses a fresh name at or before a retired one, including names in the retired attempt's public evidence (`module-operation-host.ts:54-67`) |
| `readOriginals` | `packages/provisioning/src/first-setup-resolution.ts:513` | `first-setup-workspace.ts:172,277,390,536`; `apps/server/src/first-setup-resolution.ts:154,175`; `packages/provisioning/src/first-setup-owner-audit.ts:60` (the password-recovery audit reads its own records; unaffected) | reads archived bytes |

**Where the name is chosen and checked against history.** The chooser (`packages/fiscal-verifactu/src/hour-selection.ts:255-500`) takes history from the database (`packages/fiscal-verifactu/src/hour-preparation.ts:162-175`), from the kept picks file (`hour-selection.ts:292-310`, added as `retained-intents` at `:385-406`) and, on a restore, from the backup plus a `backup-created` floor (`apps/server/src/recovery-preparation.ts:200-209`). It refuses `minute_not_later` when the earliest allowed minute is more than 150 seconds away (`hour-selection.ts:444-463`), before anything is written (writes at `:492,507`). The kept picks file lives in the anchor state folder (`packages/provisioning/src/module-preparation-state.ts:78-80,101-104`), survives Start again, and **is what refuses today's "clock behind" case** (reviewer's probe). So unless Start again folds that file into the note and deletes it, removing the note's check would fail no test.

**What a backup carries.** A module-history file projected from the kept picks file (`apps/server/src/backup-sources.ts:41-61`, read from the anchor at `apps/server/src/archive-entries.ts:37-42`). Once Start again deletes that file, an abandoned name stops appearing in later backups. That is safe: every later name is later than the note (D2), and a trading box's backup carries that later name in its database.

**The two database files.** The venue folder holds `venue.db` and `node.db` (`packages/store/src/index.ts:47-49`). Every migration set is applied to `venue.db`; `node.db` has no tables (`apply.ts:33`, `client.ts:56`, reviewer's probe). The tables classified `local` — `node_roles`, `mirror_config`, `join_requests`, `change_log`, `node_sealed_state` (`packages/db/src/classification.ts:239-257`) and the certificate tables (`packages/fiscal-verifactu/src/classification.ts:17-26`) — therefore live in `venue.db`, so today's proof already covers them. The recovery-key verifier is written to `venue.db`'s `node_roles` only once the attempt is `committed` or `publication` (`packages/provisioning/src/first-setup-node-key.ts:160-182`). A first-setup start creates a missing `node.db` (`apps/server/src/boot.ts:932,964`; `packages/store/src/index.ts:247-248`). The empty-database proof's inspection opens `venue.db` only (`packages/provisioning/src/first-setup-resolution-inspection.ts:87`); the repair page's `GET /setup-api/first-setup/resolution` runs that inspection with no venue lock and no coordinator turn (`setup-first-fiscal-api.ts:611-615`).

**What the start does today when admission fails.** `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:45-110`) serves the repair app (`kind: "resolution"`) when workspace resolution or its admission check throws (`:61-82`). In the supervised entry, `runEntry` calls it with no `catch` (`apps/server/src/node-entry.ts:316`); a throw there reaches `bootThisProcess`'s `.catch`, which logs `server.boot_failed` and exits (`:648-656`), so the container restarts into the same refusal with no page. The full-disk branch shows the pattern for serving the recovery page without counting a failure (`node-entry.ts:368-384`). The direct entry (`apps/server/src/first-setup-launch.ts:72-100`) falls back to a bootstrap-only listener when `launch()` fails (`:58-63`).

**What lane E's A731 changes (assumed; Task 0 re-checks).** From its plan `docs/superpowers/plans/2026-10-24-a731-repair-backup.md` (main b49f701a1) and its branch `feat/a731-repair-backup` (d5fe61367, with uncommitted work):

1. A separate "version 2" recovery journal under `<anchor state>/first-setup-resolutions/backup-recovery/<id>/`, restoring into a nested target and selecting it through paired discovery files (plan `:83,87`); a repair route under `/setup-api/first-setup/resolution/backup` (`:116`).
2. Edits to `apps/server/src/{module-operation-host,setup-first-fiscal-api,first-setup-entry,first-setup-launch,node-entry,boot,cloud-recovery}.ts` and `apps/setup/src/{setup-app.ts,screens/initial-owner-strings.ts}` (`:63-64`).
3. It keeps today's retirements, workspace selection and readers unchanged (`:7,84`); its history reader walks the archives (`first-setup-backup-history.ts:57-60`) and calls `firstSetupAnchorFor` (`:57`; also `first-setup-backup-recovery.ts:216`).
4. It carries archive-based floors into the restore target's module history file and requires that "a second backup/recovery still sees the later floor" (plan `:102`); its tests race its commit against "normal empty start-again" (`:120`).
5. Its restore runs `createSelectedRecoveryPreparation` on the nested target's folders (`:102`).
6. It preserves old databases and never deletes (`:21`).

## Decisions

### D1. Where the note lives: one file in the box's own state folder

The note is `first-setup-start-again.json` in the box's own state folder, found by `boxFolders` (Task 0b). Exact keys only:

```json
{ "version": 1, "floorMs": 1792150980000, "lastName": "0CNQT", "module": "fiscal-verifactu" }
```

`floorMs` is the first moment a later name may be taken (the start of the minute after the last name). `lastName` is that name, for people reading the folder; shared code never parses it. `module` is the module whose seat gave the floor. Limit 4096 bytes.

| Place | Survives Start again | Survives a restore | Rolled back by a restore | Verdict |
| --- | --- | --- | --- | --- |
| inside `venue.db` | no — Start again deletes it | no — a restore replaces it | yes | rejected |
| inside the kept picks file | yes today | yes | no | rejected: it is the growing list of every pick (each pick writes a revision holding the whole list again: `hour-selection.ts:420` with `module-preparation-state.ts:127-137`), the archive the owner asked to remove |
| a file in the venue folder | yes | partly — a restore removes some venue sub-folders (`apps/server/src/restore.ts:654`) | no | rejected |
| **a file in the state folder** | **yes** | **yes — a restore writes only named files there** | **no — see below** | **chosen** |
| copied into every backup | — | — | yes — an older backup would bring back an older note | rejected |

A restore cannot overwrite it: a restore archive writes only its database dump and state-folder secrets (`restore.ts:221-241`), and its secret entries are filtered through `isFirstSetupHostPath` (`:236-241`, reached from all three archive readers at `:190`, `:208`, `:866`). The note's name joins `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:137-151`), so an archive carrying it is refused as an unexpected entry, and a recovery bundle carrying it is refused `recovery.bundle_invalid` (`apps/server/src/state-secrets.ts:87`). Task 2 checks whether the bucket-stream restore (`apps/server/src/restore-stream.ts`) writes state files by another path.

When the restored backup has its own history, the latest floor wins: the note sits beside the backup's history and its `backup-created` floor on every restore, re-registration and promotion (Task 6).

**Ways the note is lost, and what each means for reusing a name.** Every new production name still needs the box's clock and a second clock to agree within 30 seconds (`CLAUDE.md` §5), so after any of these a repeated name needs both clocks to read earlier than the forgotten name.

| Event | What happens to the note | Owner question |
| --- | --- | --- |
| `waitron.sh reset` | deleted today: it empties the state folder except `tls/` (`deploy/waitron.sh:739-745`, the `find` at `:744`). Its production check (`is_production`, `:521-583`) reads two signals, `trading.env` and the venue database's deployment stamp; whether a part-way first setup has the stamp was not traced, and Q4's answer does not depend on it | Q4 |
| `waitron.sh reset --all` | deleted with the whole state volume (`deploy/waitron.sh:738`) | Q4 (the way out of a damaged note) |
| reinstall from the USB stick | deleted with the disk | Q3 |
| A950's upgrade rollback (not built) | rolled back with every volume to the snapshot (`docs/backlog/box.md:80-96`) | Q5 |
| reinstall from the dashboard (B3's revision, not on main — no mention in `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`) | depends on B3 | none: Task 7 adds to B3's backlog entry that the reinstall carries the note with the saved configuration and puts it back before first setup |

### D2. The note is read as a time floor, everywhere a production name is chosen

The history reader applies `timeFloorMs` from every source with no taxpayer or environment filter (`hour-history.ts:72-73`), whereas named records of another taxpayer or environment are skipped (`:93`). A time floor therefore binds the whole box, as the owner worded it (Q2 confirms). Shared code hands it over in the shape `recovery-preparation.ts:204-209` already uses for `backup-created`: `{ reference: "start-again-note", complete: true, records: [], timeFloorMs: note.floorMs }`. With a correct clock a new name is later than the note anyway; the floor only bites when the box's clock reads earlier than the minute after the note's name. Throwaway naming stays outside every history check, as today (Q6).

### D3. Start again deletes the attempt in place, under a marker that names exactly what it deletes

**Invariant:** Start again runs only on the repair listener, where the venue store is not open (Current behaviour). A change that offers it in ordinary setup must first close the store; Task 3c pins the route's absence from ordinary setup with a test.

**Refused before anything is written** (`setup.not_ready` unless named otherwise):
- the database is missing (Q1 A);
- `node.db` exists and its `sqlite_schema` has any row whose name does not start with `sqlite_`. A missing `node.db` is not opened (opening it read-only throws) and counts as nothing to check (Global constraints). `firstSetupDatabaseIsEmpty` is never called on `node.db`: it answers `false` for an untouched one;
- any of `trading.env`, `setup-operation.json`, `restore-request.json`, `reset-request.json`, `modules.json`, `cloud-replacement.json` is present (the inspection's own artifact list, `first-setup-resolution-inspection.ts:287-297`);
- `.venue.db-litestream/` is present in the venue folder. The stream runs only once backup settings exist (`apps/server/src/stream-host.ts:155`, read), so an unused attempt never has it, and a streamed folder is never half-emptied (`CLAUDE.md` §3);
- any outside evidence is configured or present. Production configures none (`packages/fiscal-verifactu/src/initial-hour-setup.ts:115`, read into `packages/provisioning/src/first-setup-runtime.ts:123-133`), so this refuses only test and historical configurations;
- any A731 journal (Task 0 names its folder), a legacy workspace file (D4, `setup.workspace_unsupported`), or anything under `first-setup-resolutions/` that is not a record folder laid out as below;
- a deletion marker already exists (`setup.start_again_incomplete`; the next start finishes or refuses it, D5);
- the marker would exceed its limit (below). This is checked before writing, because `writeDurableHostJson` itself turns an over-limit write into `setup.attempt_invalid` (`durable-host-json.ts:52-53,86-87`).

**The floor comes from a new module seat**, so shared code never reads a series name:

```ts
// packages/module/src/initial-setup.ts, on InitialSetupContribution
startAgainFloor?(input: {
  readonly attempts: readonly { readonly context: InitialSetupContext; readonly input: unknown }[];
  readonly preparations: readonly unknown[];
  readonly publicEvidence: readonly unknown[];
}): { readonly floorMs: number; readonly lastName: string } | null;
```

`publicEvidence` is the abandoned attempt's own public evidence, gathered from the live snapshot (`captureFirstSetupOriginals`, `first-setup-resolution.ts:251`) by the readers `module-operation-host.ts:54-67` applies to archives today — `readFirstFiscalEvidenceSnapshot`, `readFirstSetupRecoveryDeliverySnapshot` and `readFirstFiscalDeliverySnapshot` — **without** the `outside-file:` branch (`:56-63`), since outside evidence refuses Start again.

**What a record folder holds.** Each UUID-named folder under `first-setup-resolutions/` (written by the record store, `packages/provisioning/src/first-setup-resolution.ts:372`) holds `NNNNNN.json` records, evidence chunks (`original-*.json`) and a `manifest.json`, and, for every record from step 3 on, a `step-NNNNNN/` subfolder with its own chunks and manifest (`:461-462`). The password-recovery audit writes to one fixed id per attempt (`packages/provisioning/src/first-setup-owner-audit.ts:15-25`) and adds a step for each recovery (`:123-155`), so a second recovery on one attempt creates `step-000003/` (round 3's probe). These folders hold this attempt's marker repairs, ownership rebinds and password-recovery audit, and those of its earlier attempts in `previous`.

**The deletion list, in order.** Main database files first, so that a read opening the venue folder after them finds nothing to open; then their side files; then the rest; the claim pair last. Every entry of a listed folder is covered, including names that start with a dot (a crash in `writeDurableHostJson` leaves `.first-setup-<uuid>.tmp`, `durable-host-json.ts:50`).

1. Venue folder: `venue.db`, `node.db`, then `venue.db-wal`, `venue.db-shm`, `node.db-wal`, `node.db-shm`.
2. State folder:
   - `module-preparation-state.json` (Task 1b deletes it directly; Task 3c moves its deletion into this marked list);
   - each file in `first-fiscal-documents/`, then the folder;
   - `first-setup-node-key.json`; `module-operation-public.json`;
   - in each record folder: each file in each `step-*` subfolder, then that subfolder; then each file of the record folder, then the folder; then `first-setup-resolutions/`.
3. Venue folder: `first-setup-claim.json`. State folder: `first-setup.json`, last.

A folder is removed only with `rmdir` once empty, never recursively, so a file that appeared after the marker was written makes the removal fail and is never swept away.

**Order of writes:**
1. The existing proof, unchanged, plus the refusals above.
2. Raise the note, only if the seat gives a floor.
3. Write the deletion marker `first-setup-deleting.json` in the **venue** folder, whether or not the attempt chose a name. Exact keys:
   - `version: 1`, `attemptId`, `frozenDigest` (from `first-setup.json`), and canonical `venueDir` and `stateDir`;
   - `files`: one entry for every present file of the list at every level (record folders and their `step-*` subfolders included), `{ root: "venue" | "state", name: <relative path, no "..">, size: <bytes>, sha256: <hex> }`;
   - `wal`: for `venue.db-wal` and `node.db-wal`, either `null` (absent) or `{ size, sha256 }`. These cannot change while Start again holds `venue.lock`, and a read-only reader does not write to a `-wal` (round 3's probe left it at 0 bytes).

   `-shm` files are never recorded. The limit is 1 MiB: `first-fiscal-documents/` holds at most 1024 names before the inspection refuses (`first-setup-resolution-inspection.ts:308-309`), an entry is under 300 bytes, and the record folders of one attempt hold far fewer.
4. Delete in the list's order, syncing each parent folder.
5. Remove the marker; sync the venue folder.

**Side files.**
- A `-shm` file is never fingerprinted. A read-only open rewrites it, and the repair page's poll opens `venue.db` read-only with no lock (`setup-first-fiscal-api.ts:611-615`); a hash of it would go stale after a harmless read and strand the box after a power cut.
- A `-wal` is accepted at the finish only if it is absent, 0 bytes, or exactly the recorded bytes. Otherwise the finish refuses, because committed rows can live in a `-wal` while the main file's hash is unchanged (Current behaviour). That covers a process that does not check the marker writing after a cut — `waitron-break-glass` (`apps/server/src/break-glass-command.ts:27`) or `packages/credentials/src/bin.ts`.
- The alternative, putting the GET inspection behind the coordinator so nothing can touch the files during deletion, was rejected. It would also have to cover every other in-process reader, and a power cut between a read and the marker's hashes would still strand the box.
- Task 3c tests an inspection read interleaved between the deletions, then a cut, then the next start finishing.

**Finishing at the next start** (`finishStartAgainDeletion`, D5 says where it runs). With no marker it does nothing. With one, it first canonicalises the folders it is given, as `bindRoots` does (`first-setup-state.ts:528-536`). It then deletes only if all of these hold, and otherwise refuses `setup.start_again_incomplete` and deletes nothing:
- the marker's folders are those canonical folders;
- nothing on the refusal list is present;
- every listed file still present has its recorded size and SHA-256;
- each `-wal` passes the rule above;
- no main database file, claim-pair file or record file is present that the marker does not name (a newly placed `venue.db` fails here).

Then it deletes the present items in the list's order and removes the marker.

**A deletion that throws** (an `rmdir` refused, an `EACCES`) leaves the marker in place. The route answers `setup.start_again_incomplete` and requests a restart (`requestRestart`, as the success path does at `setup-first-fiscal-api.ts:845`), so the next start finishes the deletion or serves the recovery page.

**While a marker exists, these refuse `setup.start_again_incomplete`:**
- Start again itself;
- a new claim (`first-setup-state.ts` `claim`);
- **every write of the first-setup store**, through its `persist` (`first-setup-state.ts:554-559`; this covers abandon, ownership recovery and every other `update`);
- **every write of the record store**, through `prepare` and `apply` (`packages/provisioning/src/first-setup-resolution.ts`; this covers marker repair, ownership rebind and the password-recovery audit);
- every caller of `assertVenueFirstSetupAllowed`: restore placement (`apps/server/src/restore.ts:354`), restore staging (`restore-request.ts:416`), the `waitron-restore` command (`restore-command.ts:300`), reset (`reset-request.ts:97`), and command-line provisioning when no `authorize` is given (`packages/provisioning/src/cli.ts:505,514`);
- the `assertOtherAllowed` hook used by adopt and provision (`apps/server/src/boot.ts:1085`, used by `setup-api.ts:655`), which reads the state store and so needs the marker check added;
- the recovery entry (`apps/server/src/recovery-entry.ts:56`);
- A731's repair open (Task 0 names it).

**Not covered, and safe:** `waitron-rejoin` (`apps/server/src/rejoin-command.ts:89-136`), `waitron-break-glass` and `packages/credentials/src/bin.ts` do not check the marker. Each changes `venue.db` or its `-wal`, which makes the finisher refuse rather than delete. Task 3d reads `rejoin-command.ts:89-136`; if a rejoin can remove or overwrite the marker itself, it adds the marker check there.

The marker's name also joins `FIRST_SETUP_HOST_FILES`. That follows `first-setup-claim.json`'s precedent, and is harmless rather than needed: nothing a restore carries reaches the venue folder except `venue.db` (`restore.ts:221-241`).

### D4. Boxes that already hold archives: refused, not read

Pre-live, every box may be reset (`CLAUDE.md` §3). Nothing reads an old archive or seeds the note from one.

A box is refused `setup.workspace_unsupported` when its folders hold `first-setup-selection.json`, `first-setup-retirement.json`, `first-setup-workspace.json` or `<state>/first-setup-workspaces/`, or when its venue folder sits inside `first-setup-workspaces/<id>/` (today's check at `first-setup-workspace.ts:461,492`, kept because such a folder is a workspace from that same older layout). It is refused at the start (D5), and wherever today's check `assertFirstSetupVenueTarget` refuses an old witness: claim, update, `inspectFirstSetupMarker` and `assertVenueFirstSetupAllowed` (`first-setup-state.ts:488-506`). So the restore command, staged restore and reset keep refusing such a box.

`assertNoLegacyFirstSetupWorkspace` refuses `setup.workspace_unsupported` only when one of those names is actually present. Every other failure — a folder that is a symbolic link, or one that cannot be read — keeps today's `setup.attempt_uncertain` (`first-setup-workspace.ts:471-473`), so a symbolic link is never described as "an older Waitron".

The way out, for a developer: `wa-wt reset demo <name>`. On a box, the recovery page says "reinstall Waitron" (D5), keeping to the owner's never-reset rule. The PR's first line says so, as #1990's did.

The first-setup record store keeps its `retire` and `select-workspace` action names and its `nextWorkspace` field for now (`packages/provisioning/src/first-setup-resolution.ts:20-48`). After this change nothing writes them. Their only readers that decide anything are `apps/server/src/first-setup-resolution.ts:115` (removed in Task 5d) and `:245` (removed in Task 4b), and Start again deletes the record folders. Removing them would rewrite the record store's own durability and integrity suites without changing what the box does. Task 7 adds a backlog entry to remove them.

### D5. What the operator sees when the start refuses

`resolveFirstSetupEntry` canonicalises the folders as today (`first-setup-entry.ts:51-62`; the canonicalisation-failure branch is unchanged). Then, in a `try` of their own, before the workspace resolution's `try`, it runs `assertNoLegacyFirstSetupWorkspace` and `finishStartAgainDeletion`, and turns either new code into a new admission result `{ kind: "refused", code, roots }`. Any other error keeps today's behaviour: it goes to the repair app.

Both consumers of the admission result handle the new kind (`first-setup-launch.ts:95-106`; `node-entry.ts:388-405`).

**Supervised entry** (`runEntry`):
- The refused branch goes after `needsConnectionBootstrap` (`node-entry.ts:338`); the full-disk branch (`:368`) takes precedence.
- First it writes `server.boot_started`, then `server.boot_failed` with `{ errorCode: code, detail }`, through `pageLog` (`node-entry.ts:211-218`), as `runAdmittedEntry` does (`:491-553`). This keeps the page's "Why the last start failed" (`lastFailureIn`, `recovery-surface.ts:60-69`) from showing an earlier start's failure.
- Then it serves `recoveryApp` with:
  - the state from a new helper `refusedAtStart(current, code, at)` beside `fullDiskAtStart` (`apps/server/src/recovery-state.ts:152`), which the start serves and never writes;
  - a new flag `refusedAtStart: true` on `RecoveryDeps`, **not** `uncounted: true`, whose status line is about the disk (`recovery-surface.ts:169,188,533-534`);
  - **Try again** exiting so Docker restarts the box.
- No restart loop and no failure count: it returns before `runAdmittedEntry` (`:441`), the only place the count is written.

**Direct entry** (`first-setup-launch.ts:72-100`): serves the same `recoveryApp` through its `listen` (`:43-47`), with `state` from `refusedAtStart(await readRecoveryState(stateDir), code, now)`, `logDir` from `resolveLogDir(env, stateDir)`, and `onRetry` calling the existing `requestRestart` (SIGTERM by default, `:75`).

**Raw `bootServer`** (`boot.ts:869`, used by tests and development, not by a box): throws the code.

**What the page shows.**

The new status line, in both languages:
- English: "Level: {level}. This start was refused before it began, and was not counted."
- Spanish: "Nivel: {level}. Este arranque se rechazó antes de empezar y no se ha contado."

The operator text is chosen by code (`recovery-surface.ts:474-481`). Both actions follow the never-reset rule (Global constraints) and the wording of the existing rows (`:404`, `:417`):

| Code | Title (English / Spanish) | Action (English / Spanish) |
| --- | --- | --- |
| `setup.workspace_unsupported` | This box holds a first setup kept by an older Waitron. / Este equipo guarda una configuración inicial de una versión anterior de Waitron. | Ask whoever installed this box to reinstall Waitron on it. / Pide a quien instaló este equipo que reinstale Waitron en él. |
| `setup.start_again_incomplete` | Start again did not finish, and the box found files it did not expect. / «Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba. | Ask whoever installed this box to look at its setup folders before anything else: the files it found may be a restored venue. / Antes de nada, pide a quien instaló este equipo que revise sus carpetas de configuración: los archivos que encontró pueden ser un local recuperado. |

Setup-app wording for the same two codes (`shell.ts`, through `FIRST_SETUP_ERROR_MESSAGES`), for the repair page and any restore or reset screen that receives them:

| Code | English | Spanish |
| --- | --- | --- |
| `setup.start_again_incomplete` | Start again has not finished. Restart the box, then try again. | «Empezar de nuevo» aún no ha terminado. Reinicia el equipo y vuelve a intentarlo. |
| `setup.workspace_unsupported` | This box holds a first setup kept by an older Waitron. Reinstall Waitron on it. | Este equipo guarda una configuración inicial de una versión anterior de Waitron. Reinstala Waitron en él. |

A damaged note is not a start refusal. It is read only when a name is chosen, so the setup or restore screen shows `setup.attempt_invalid`'s existing text, and the installer's way out is `waitron.sh reset --all` (Q4).

## Review focus

1. **Clock set back by more than 150 seconds behind the note**, with a second clock that agrees: refused `minute_not_later` with `allowedFromMs` equal to the note's floor; nothing recorded. Task 1b.
2. **Power lost at each step of Start again** — after the note, after the marker, after each deletion, with a repair-page read in between: the next start finishes exactly the marked deletion, or serves the recovery page and deletes nothing; a restored or newly placed database, and rows written into a `-wal` after the cut, are never deleted. Tasks 3b, 3c.
3. **An attempt that never chose a name, or whose owner recovered the password twice (a `step-000003/` record subfolder), interrupted mid-deletion:** the next start finishes it and leaves nothing behind. Tasks 3b, 3c.
4. **A damaged note** (empty file, `{}`, `"lastName": ""`, an extra key, a lower floor): refused wherever it is read; a second Start again never lowers it. Task 2.
5. **The abandoned attempt's `node.db`** is never reused by the next attempt, and a `node.db` that holds a table refuses Start again. Task 3c.

## Open questions for the owner (each with a recommended answer)

1. **Start again when the venue database is missing.** Today the original password allows it, and only the attempt's status is checked (`first-setup-resolution.ts:233,296-298`). Because any status except `complete` and `abandoned` can be abandoned, this admits even an attempt whose fiscal commit finished (`committed`), as the store allows (reviewer's probe: resolved; with the database present: refused). It is not a live defect today, because Start again deletes nothing and the next attempt is checked against the kept archive and picks file. **A (recommended): refuse Start again when the database is missing; the repair page points to recovery from a backup (A731) or a reinstall.** B: allow it with the original password and delete anyway — then Start again would delete the archive and kept picks of an attempt that may have committed, with no database to prove anything, and the route must first learn to read the attempt's history. The tasks follow A.
2. **One floor for the whole box, whatever the tax number.** Example: an attempt for NIF B12345678 (typed wrongly) chose `0CNQT` and was abandoned; the next attempt, for NIF B87654321, must choose a name later than `0CNQT`. **A (recommended): yes — "the box never issues a series name at or before that record".** B: one floor per tax number and environment, as today's archive check does. A changes items S7c and S7k below.
3. **A full reinstall from the USB stick forgets the note.** **A (recommended): accept it** — the note only guards names never used, a trading box's backup carries a later name, and every new production name needs two agreeing clocks. B: keep the note somewhere the stick does not erase (a B3 design change).
4. **`waitron.sh reset` forgets the note**, and D4 recommends that reset for old boxes. **A (recommended): a plain `waitron.sh reset` keeps the note, as it keeps `tls/`; `reset --all` still removes everything** and is the way out of a damaged note. The note holds one time and one name. B: the reset deletes it, as today. Task 6b builds A.
5. **A950's upgrade rollback** (not built) would roll the note back with every volume, forgetting a name chosen after the snapshot. **A (recommended): add to A950's backlog entry that its rollback must keep the newer note.** Nothing is built here. B: accept the loss.
6. **Throwaway naming stays outside the floor** (Demo, Preparation, a development box's Live, the readiness run). **A (recommended): leave it outside.** Those are preproduction names in databases never promoted to production (`CLAUDE.md` §5), and the note guards names that never reached the tax agency. B: make the throwaway path (`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts`) respect the note too.
7. **Approve "Existing assertions this plan changes"** below in one answer. **A (recommended): approve as listed.** B: name the items to keep, and the plan is revised.

## How the assertion list was built

1. One sweep over every test file and test helper, for every symbol, file, field, route answer and code the tasks change or delete:
   ```sh
   PAT='readFirstSetupRetirementArchives|readFirstSetupRetirements|readRetiredFirstSetupStates|readRetiredSetup|selectFirstSetupWorkspace|resolveFirstSetupWorkspace|inspectFirstSetupWorkspaceSelection|assertFirstSetupBootTarget|assertFirstSetupVenueTarget|firstSetupAnchorFor|nextWorkspace|selectionGeneration|workspaceId|first-setup-workspaces|first-setup-selection\.json|first-setup-retirement\.json|first-setup-workspace\.json|"retire"|select-workspace|retireMissingDatabase|startAgainFirstSetup|resolution/start-again|module-preparation-state\.json|old attempt is retained|assertFreshAssignment|WorkspaceBinding'
   git ls-files '*.test.ts' '*.test.mjs' 'apps/*/test/*.ts' | xargs /usr/bin/grep -c -E "$PAT" | /usr/bin/grep -v ':0$'
   ```
   It prints 56 files at db4e0a6bf (re-run under bash, piped to `wc -l`; an earlier draft of this plan said 57). Each was read at its hits (`/usr/bin/grep -n -E "$PAT" <file>`).
2. Hits that do not change, and why:
   - `module-preparation-state.json` read in suites that never call Start again (`first-fiscal-hour-clock`, `-configured`, `-import.e2e`, `-modes`, `-preparation`, `-route`, `setup-first-fiscal.route`, `hour-promotion`, `hour-recovery-host`, `hour-recovery-placement-3`, `cli-owned-entry`, `cli-same-hour-entry`, `module-preparation-backup`, `setup-preparation-host`). Only Start again deletes that file.
   - The paper-register `"retire"` events (`packages/fiscal-verifactu/src/{paper-register-history,register-document,register-history}.test.ts`), which are another concept.
   - `packages/provisioning/src/first-setup-host-path.test.ts:12-15` and `apps/server/src/first-setup-entry.test.ts:334-365`, whose lists only gain the two new file names.
   - The record store's suites `packages/provisioning/src/first-setup-resolution{,.integrity,.durability}.test.ts`, `first-setup-owner-audit.test.ts:344,360-363` and `apps/server/src/first-fiscal-declared-publication.test.ts:228`, because the record store keeps its actions and fields (D4).
3. Additions that need no approval (a whole-shape pin gaining a key): a `readSetupFacts` result gains `floors: []` in the stubs of `packages/fiscal-verifactu/src/{hour-preparation,initial-hour-setup,hour-setup-defaults}.test.ts`, `packages/provisioning/src/{setup-preparation-host,first-setup-runtime}.test.ts` and `apps/server/src/testing/hour-test-clock.test.ts`. Recovery history arrays gain nothing when no note exists (`startAgainFloorSources(null)` is `[]`), so suites without a note keep their pinned histories.
4. A second sweep for the two new codes and the refusals added to existing entry points: `git ls-files '*.test.ts' | xargs /usr/bin/grep -n -E 'assertVenueFirstSetupAllowed|inspectFirstSetupMarker|assertOtherSetupAllowed|attempt_uncertain'`. The legacy-refusal hits are items P5, P6 and S16.
5. Task 0's last step re-runs both sweeps after A731 lands; each task's first step re-runs the first sweep narrowed to its files.

## Existing assertions this plan changes — owner approval needed before the build

Line numbers at db4e0a6bf; Task 0 re-reads them after A731. "Subject gone" means the case tests something this change removes — archives, workspaces, workspace selection, the missing-database Start again (Q1 A) — and has no successor. The task named makes the change. Tests whose expected screen text comes from the strings file follow the new wording without an assertion change and are not listed.

**Wire body**
- **W1.** `apps/server/src/setup-first-fiscal-api.ts:846-850`, the Start again answer: `{ workspaceId, selectionGeneration, restarting: true }` → `{ restarting: true }` (keys removed; no workspace). Pinned at `apps/server/src/first-fiscal-hour-finish.test.ts:489`. The setup app's client already types the answer as `{ restarting: true }` (`apps/setup/src/api/client.ts:579-583`), and `apps/setup/src/first-setup-retirement.test.ts:112-120` is the incomplete-answer case, unchanged. The stubs that send the old shape change with it: `apps/setup/test/missing-database-browser.ts:61-65` and `apps/setup/src/setup-app-resolution.test.ts:52` (A4). Task 3e.

**Server — `apps/server/src/first-setup-unused-pdf.test.ts`**
- **S1.** `:84-119` "a never-activated box with a delivered PDF can start again after answering %s". Old: the new folders differ (`:90`); the records are `retire`/`select-workspace` (`:95-101`); the register is kept (`:102`); `readOriginals` equals the snapshot (`:103`); every old file is byte-for-byte unchanged (`:104-110`); `readForRepair().consumptionIntent` is true (`:111`); the new venue has no `venue.db` (`:112-114`); the old owner's status is `setup.attempt_uncertain` (`:115-117`). New: the same folders hold nothing on D3's list; no marker remains; the note's `lastName` is the PDF's name; the old owner's status is refused (Task 3e records the code; STOP if it succeeds). Why: deleted, not kept. Task 3e.
- **S2.** `:120-165` "retiring the unused PDF excludes hour $identity …": `assertFreshAssignment` → `setup.attempt_conflict` for spent rows becomes the next selection → `minute_not_later` at or before the note; the unspent row's name is selected. Why: the after-the-fact archive check goes. Task 4c.
- **S3.** `:178-184`: resolves `{ selectionGeneration: 1 }` → resolves, note written. Task 3e.
- **S4.** `:186-203` "successive never-activated PDFs retain every old block while allowing a third replacement": the third Start again's `selectionGeneration: 3` under the same anchor → three Start agains in the same folders succeed and the note's floor is the latest name. Task 3e.
- **S5.** `:205-238` "an earlier abandoned activation with a missing database does not become empty …": the password Start again on a missing database succeeds → refused `setup.not_ready` (Q1 A). A row shaped like the reviewer's `committed` probe is added and refused too. Task 3a.
- **S6.** `:279-281` (`first-setup-retirement.json` absent): passes whatever the code does once that file no longer exists → replaced by "no deletion marker and no note change". Task 3e.
- **S7.** `:325-355` and `:357-…` (interrupted unused-PDF selection resumes; HTTPS fresh answer for the same selection): deleted, subject gone. Task 5d.

**Server — `apps/server/src/first-setup-retired-assignments.test.ts`** (the fixture retires through `records.prepare` and `selectFirstSetupWorkspace`, `:281-302`; rebuilt on Start again in Task 4b)
- **S7a.** `:359-368` "fresh events cannot reuse a retired hour …": `assertFreshAssignment` → `setup.attempt_conflict` becomes the selection → `minute_not_later`. Task 4b.
- **S7b.** `:369-381` "retirement still permits a %s": the `later-hour` row stays permitted. Task 4b.
- **S7c.** the same case's `other-taxpayer` and `other-environment` rows: permitted → refused `minute_not_later` (Q2 A). Task 4b.
- **S7d.** `:382-428` "the real hour candidate route protects a retired hour before freezing hour offset %s": offset 1 answers 400 `minute_not_later` with `allowedFromMs: instant(1) + 180_000` → refused or waiting, then a name later than the note; the exact answer is recorded by the task (the old value came from the kept picks file). STOP if a name at or before the note is ever given. Offset 2 is unchanged. Task 4b.
- **S7e.** `:430-447` "activation refuses a retired hour even when a caller bypassed the candidate route": deleted. Activation no longer re-checks. A frozen request is written only by `select` (`packages/provisioning/src/first-setup-preparation.ts:242`, which runs the chooser with the note) and by `import`, which accepts only an input equal to that request (`:266`, through `packages/fiscal-verifactu/src/initial-hour-setup.ts:79`). Task 4b re-runs `/usr/bin/grep -rn 'kind: "candidates"\|kind: "import"' --include='*.ts' apps packages`; a new non-test writer is a STOP.
- **S7f.** `:449-455` "a retired hour at offset42 bounds fresh offset%s": `assertFreshAssignment` refusal → selection refusal for 1, 41, 42; 43 permitted. Task 4b.
- **S7g.** `:457-476` "an empty replacement cannot erase inherited spent hours": Start again refused `setup.not_ready` → Start again succeeds, and the note keeps the inherited floor. Task 4c.
- **S7h.** `:478-507` "password recovery retires an unused replacement …": `selectionGeneration: 2`, two retirements with `register: null`, and the second retirement's state equal to the old → Start again with the password succeeds in the same folders, and the note holds the later of the two names. Task 4c.
- **S7i.** `:509-520` and `:544-553` (retained public hour42; retained recovery document): `assertFreshAssignment` refusal → the name is folded into the note from the attempt's own public evidence, and the next selection is refused at or before it. `:570-582`'s outside row (`source: "outside"`): → Start again refused `setup.not_ready` while outside evidence is configured. Task 4c.
- **S7j.** `:522-528` "a retained hour under another software ID still consumes that taxpayer's hour": the same, through the note. Task 4c.
- **S7k.** `:530-543` "retained public hour facts preserve the %s namespace": permitted → refused (Q2 A). Task 4c.
- **S7l.** `:555-568` "damaged retired recovery document %s never becomes absence of history" and `:584-592` "invalid retained public evidence fails with a domain refusal": the damage now refuses Start again itself (`setup.attempt_invalid` or the seat's `sif.allocation_invalid`), never "no floor". Task 4c.
- **S7m.** `:594-680` "ordinary hour preparation retains earlier abandoned events for %s": `reuse` keeps its refusal, from the note; `later` keeps `0CR6J`, and the assertions on the old kept picks file (`:619-620`) move to the new attempt's file. Task 4c.
- **S7n.** `:683-…` "a live outside history may %s without releasing its archived hour42": → Start again refused `setup.not_ready` while outside evidence is configured (outside evidence is no longer folded). Task 4c.

**Server — `apps/server/src/first-fiscal-hour-finish.test.ts`**
- **S8.** `:267-366` "empty never-activated hour restart retains originals and burns the entire hour on every base". Old: new folders (`:290`), `resolveFirstSetupWorkspace` equals the binding (`:291-…`), `readOriginals` equals the snapshot (`:304`), files unchanged (`:305-322`), the kept picks file byte-for-byte unchanged (`:323`, read at `:276`), the old owner refused (`:325-…`). New: the kept picks file is gone after Start again (Task 1b); then, in Task 3e, the folders hold nothing on D3's list and the note holds the abandoned name. The case's subject — every base's name is burnt — is kept: the next selection is refused at or before the note (`:348-…`) and a later name is selected (`:354-…`). Tasks 1b and 3e.
- **S9.** `:368-421` (Start again refused for a non-empty database): the refusal stays; the vacuous `first-setup-retirement.json` absence check (`:416`) → "no marker and no note change". Task 3e.
- **S10.** `:498-535` "a missing hour database needs freshly recovered ownership before retirement": → refused `setup.not_ready` whatever the ownership (Q1 A). Task 3a.
- **S11.** `:712-756` "hour restart can resume an interrupted workspace selection …": deleted, subject gone. Task 5d.

**Server — other files**
- **S12.** `apps/server/src/first-fiscal-hour.e2e.test.ts:23-193` (six rows: a trusted HTTPS password Start again on a missing database, writing `restore-request.json` and `reset-request.json` at `:75-76`, and binding fields at `:101-129`): → each row refused `setup.not_ready` (Q1 A); the binding assertions go. Task 3a.
- **S13.** `apps/server/src/first-setup-resolution.route.test.ts:12-114` (missing-database recovery and retirement over HTTPS, binding at `:95`): → refused `setup.not_ready` (Q1 A). Task 3a.
- **S14.** `apps/server/src/first-setup-resolution-inspection.test.ts`: `:96-111` "Start again retires a qualified unused workspace …" (`assertVenueFirstSetupAllowed` refuses afterwards) → after a finished deletion it passes, and the folders are empty of D3's list; `:176-221` (authenticated missing-database retirement) → refused (Q1 A, Task 3a); `:285-338` (two browsers; `selectionGeneration: 2` at `:325`) → one deletion, the second request refused `setup.start_again_incomplete` or `setup.not_ready` (recorded); the vacuous `first-setup-retirement.json` absence checks at `:122,171,230,280,415` → "no marker and no note change". Task 3e unless noted.
- **S15.** `apps/server/src/first-setup-recovery-delivery.test.ts:488-492`: the recovery document's bytes stay in place after Start again → the document is deleted with `first-fiscal-documents/`. Task 3e.
- **S16.** `apps/server/src/first-setup-workspace.test.ts` (three cases — raw boot `:25-39`, the restore command, staged restore and reset — refusing an old witness with `setup.attempt_uncertain`): refusal kept, code → `setup.workspace_unsupported` (D4). Task 5c.
- **S17.** `apps/server/src/first-setup-resolution.boot.test.ts` (workspace-selection cases built on `:56`): replaced by the legacy-refusal and unfinished-deletion cases served on the recovery page (D5). Subject gone. Task 5c.
- **S18.** `apps/server/src/first-setup-retirement-reads.test.ts` (whole suite; `:78` counts archive file opens): deleted, subject gone. Task 4c.
- **S19.** `apps/server/src/first-setup-empty-selection.route.test.ts` (whole suite, `:205-400`): deleted, subject gone. Its HTTPS refusal (`:271`) moves to the Start again route; its "a file appears after retirement" rows (`:338-353`) are succeeded by Task 3c's marker cases. Task 5d.
- **S20.** `apps/server/src/first-setup-selection.route.test.ts` (whole suite, `:145-336`): deleted, subject gone. Its password-throttling case (`:297`) moves to ownership recovery unless a case there already checks it (Task 5d greps first). Task 5d.
- **S21.** `apps/server/src/hour-backup-state.test.ts:207-316` ("captures the original anchor journal and restored floor after workspace retirement") and `apps/server/src/recovery-document-evidence.test.ts:106-158` ("retains the anchor's journal and both public floors after workspace selection"): deleted, subject gone; the anchor reads become reads of the folders given. Task 5e.
- **S22.** `apps/server/src/node-entry.full-disk.test.ts:424-503` ("a start that first setup moved to a workspace") and `apps/server/src/start-full-disk.e2e.test.ts:493-532`: deleted, subject gone (the start no longer cleans a workspace's staging). Task 5e.

**Provisioning**
- **P1.** `packages/provisioning/src/first-setup-workspace.test.ts` (whole suite, 44 cases): deleted, replaced by the legacy-refusal cases. Subject gone. Task 5a.
- **P2.** `packages/provisioning/src/first-setup-state.test.ts:994-1160` (`retiredFixture`; claim refuses ids reused from retired attempts, `:1154`): deleted; the check against earlier attempts in `previous` stays. Task 4a.
- **P3.** `packages/provisioning/src/first-setup-preparation.test.ts:307-…, 402-…, 428-…` and `first-setup-command.test.ts:463-…` (conflicts driven by `readRetiredSetup`): deleted; Task 1b's cases check the floor. Task 4a.
- **P4.** `packages/provisioning/src/cli-first-setup.test.ts:277-334` "a command without a retired-evidence adapter refuses a successor workspace" (the `first-setup-runtime.ts:88` refusal): deleted with that refusal. Its other workspace fixtures are re-pointed to plain folders, assertions unchanged. Task 4a.
- **P5.** `packages/provisioning/src/first-setup-state.test.ts:975-992` "a retired root cannot be claimed again or accept a delayed state update": refusal kept, code `setup.attempt_uncertain` → `setup.workspace_unsupported`. Task 5a.
- **P6.** `packages/provisioning/src/first-setup-owner.test.ts:573-593` "retirement refuses existing owner capabilities …": the same code change. Task 5a.
- **P7.** `packages/provisioning/src/module-preparation-state.test.ts:243` (workspace fixture) and `:274-278` (`expect(await firstSetupAnchorFor(next))…`): the fixture becomes plain folders and the anchor assertion goes. Task 5a.

**Fiscal** (the historical dispatcher)
- **F1.** `packages/fiscal-verifactu/src/declared-paper-standby.test.ts:514,565,589,625,657`, `initial-cloud-setup.test.ts:335` and `declared-paper-consumers.test.ts:374` (each supplies `readRetiredSetup` and asserts its refusal): deleted with the retired-archive block of `allocation-configuration.ts:58-119`, which production does not use. Subject gone. Neither `allocation-configuration.test.ts` mentions retired setup (round-2 grep printed nothing), so neither is listed. Task 4d.

**Setup app** (Task 5f)
- **A1.** `apps/setup/src/setup-app-workspace-selection.test.ts` (whole suite, `:22-369`), `setup-app-workspace-selection.a11y.test.ts` and `apps/setup/test/workspace-selection-browser.ts`: deleted, subject gone.
- **A2.** `apps/setup/src/setup-app-missing-database.test.ts` (whole suite, `:20-131`) and `setup-app-missing-database.a11y.test.ts`: replaced (Q1 A) by "no Start again on a missing database" and its a11y case.
- **A3.** `apps/setup/src/first-setup-retirement.test.ts`: the file tests `retireMissingDatabase()` throughout (six calls), so Q1 A removes most of it; the remaining Start again cases from `claimed`, `consumption-intent` and `abandoned` (`:62-84`) keep their assertions.
- **A4.** `apps/setup/src/setup-app-resolution.test.ts:52` (a Start again stub sending the old answer) → sends `{ restarting: true }`; `:333`, `:338` and `:362` pin the literal "The old attempt is retained." (`:338` fails under the new wording; `:333` and `:362` would pass whatever happens) → read `restarting` from the strings file.

**A731's landed cases** (Task 0 lists them by `file:line`): its archive-based floor carry-forward and its race against the old Start again change to the note. Each is added here, and to the owner's approval, before Task 4b.

---

## Tasks

| Task | Title |
| --- | --- |
| 0 | After A731 lands, re-check this plan against main, with a fresh-context review |
| 0b | One way to find the box's own folders |
| 1a | The note file and the fiscal module's floor |
| 1b | Setup never issues a name at or before the note; Start again writes it and deletes the kept picks file |
| 2 | The note cannot be lowered, damaged into "no floor", or carried in by a restore |
| 3a | Start again is refused when the database is missing (Q1 A) |
| 3b | The deletion marker, and finishing an interrupted deletion safely |
| 3c | Start again deletes the attempt in place under the marker |
| 3d | Every other write and entry point refuses while a deletion is unfinished |
| 3e | The existing Start again suites follow the deletion |
| 4a | Remove the retirement readers: module contract and provisioning |
| 4b | Remove the retirement readers from the server, and rebuild the retired-name cases (S7a–S7f) |
| 4c | The remaining retired-name cases (S7g–S7n, S2, S18) and the second deletion proof |
| 4d | Remove the retired block of the historical dispatcher |
| 5a | Provisioning forgets workspaces; old archives are refused |
| 5b | The recovery page's text for the two refusals |
| 5c | The start serves that page for an old archive or an unfinishable deletion |
| 5d | The server's repair routes forget workspace selection |
| 5e | The anchor readers and the workspace clean-up go |
| 5f | The setup screens |
| 6 | Restores, re-registrations and promotions honour the note |
| 6b | `waitron.sh reset` keeps the note (Q4 A) |
| 7 | Documentation, backlog and the A679 pointer |
| 8 | Final qualification and parking for the owner |

**Push groups.** Tasks 3c–3e are pushed together, because 3c changes the Start again answer that 3e's suites still pin. Tasks 5a–5e are pushed together, because 5a leaves the server's type check red until 5e. Every other task ends green.

### Task 0: After A731 lands, re-check this plan against main, with a fresh-context review

**Files:** read only; edit only this plan.

- [ ] **Step 1:** In the build worktree (`python3 ~/workspace/tools/worktree.py new waitron feat/a1042-start-again-note --headless`, from current main), confirm A731 is on main: `git log --oneline --grep=A731 -5`. If not, stop.
- [ ] **Step 2:** `/usr/bin/grep -rn "readFirstSetupRetirementArchives\|readFirstSetupRetirements\|readRetiredFirstSetupStates\|readRetiredSetup\|selectFirstSetupWorkspace\|resolveFirstSetupWorkspace\|firstSetupAnchorFor\|startAgainFirstSetup\|assertVenueFirstSetupAllowed" --include='*.ts' apps packages scripts`. Put each A731 caller beside the task that changes it.
- [ ] **Step 3:** For A731, record by `file:line`: (a) where it carries archive-based floors into its restore target's module history file, and its "a second backup/recovery still sees the later floor" case; (b) its tests that race its commit against Start again; (c) its calls of `firstSetupAnchorFor`; (d) how it finds the box's own folders from inside its nested target (its discovery file and resolver), for Task 0b; (e) its journal folder's name (D3's refusal list); (f) whether its observation fingerprint covers files D3 deletes; (g) whether it added `apps/server/src/guide/{en,es}/backup-recovery.md` mentioning Start again; (h) its repair-open entry point (D3's marker refusals); (i) how its new entry admission orders against D5's refusals.
- [ ] **Step 4:** Check whether lane B's #2025 (clock check at every start) has landed; this plan does not depend on it.
- [ ] **Step 5:** Re-run both sweeps of "How the assertion list was built"; correct moved line numbers; add every new hit, and (a) and (b), to the list. Send the additions to the owner before Task 4b.
- [ ] **Step 6:** Dispatch a fresh-context review of the updated plan against main (high effort, not an implementer), with probes where a claim can be run. Fold its findings into the plan; any change to the owner questions or the assertion list goes back to the owner. No implementer is dispatched before this review is folded in.
- [ ] **Step 7:** Commit `git add docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md && git commit -s -m "docs: re-check A1042's plan against main after A731"`.

### Task 0b: One way to find the box's own folders

**Files:** Create `packages/provisioning/src/box-folders.ts` and `box-folders.test.ts`; modify `packages/provisioning/src/index.ts`.

**Interfaces — produces:** `boxFolders(roots: { stateDir: string; venueDir: string }): Promise<{ stateDir: string; venueDir: string }>`, the box's own folders: for a first-setup workspace, its anchor (through today's `firstSetupAnchorFor`, until Task 5a); for a folder inside A731's nested target, the anchor its discovery file names (A731's resolver, Task 0 Step 3d); otherwise the folders given, canonical. An ambiguous answer refuses `setup.attempt_uncertain`. Tasks 1b, 3c and 6 read the note through it; Task 5a keeps it without the workspace branch.

- [ ] **Step 1:** Failing cases: "plain folders are their own", "a workspace's folders give the anchor", "A731's target gives the anchor", "a target whose discovery file disagrees is refused". Run `pnpm --filter @waitron/provisioning exec vitest run src/box-folders.test.ts`; expected FAIL (missing module).
- [ ] **Step 2:** Implement; run; PASS.
- [ ] **Step 3:** Commit `git commit -s -m "Find the box's own folders from a workspace or a repair target (A1042)"`.

### Task 1a: The note file and the fiscal module's floor

**Files:**
- Create: `packages/provisioning/src/first-setup-start-again-note.ts` and its `.test.ts`
- Modify: `packages/provisioning/src/first-setup-state.ts:137-148` (add `first-setup-start-again.json` and `first-setup-deleting.json`), `packages/provisioning/src/errors.ts` (the two new codes), `packages/provisioning/src/index.ts`, `packages/module/src/initial-setup.ts:69-84` (seat), `packages/fiscal-verifactu/src/initial-hour-setup.ts` (seat body) and its test

**Interfaces — produces:**
- `START_AGAIN_NOTE_FILE = "first-setup-start-again.json"`
- `interface StartAgainNote { version: 1; floorMs: number; lastName: string; module: string }`
- `readStartAgainNote(stateDir: string): Promise<StartAgainNote | null>` — missing file or folder → `null`; anything not exactly this shape → `setup.attempt_invalid`; limit 4096 bytes.
- `raiseStartAgainNote(stateDir: string, next: Omit<StartAgainNote, "version">): Promise<StartAgainNote>` — keeps whichever has the later `floorMs`, with that one's `lastName` and `module`; writes only when it rises.
- `startAgainFloorSources(note: StartAgainNote | null): readonly { reference: "start-again-note"; complete: true; records: readonly []; timeFloorMs: number }[]` — `[]` for `null`.
- Seat `startAgainFloor` as in D3. The fiscal body takes the latest minute across every attempt's frozen request or input (`readHourSetupInput`, `initial-hour-setup.ts:45`), every intent in `preparations` (`publicHourSelectionHistory`, `hour-selection.ts:178`, each row checked as `hour-backup-state.ts:22-44` does) and every name in `publicEvidence` (as `retainedAssignments` reads it, `packages/fiscal-verifactu/src/initial-setup.ts:289`; `createHourInitialSetup` spreads it from its base); `floorMs = EPOCH + (minute + 1) × 60 000`; `null` when there is none; any unreadable value throws `sif.allocation_invalid` (`history_invalid`), never `null`.

- [ ] **Step 1: Failing tests.** Provisioning: "a missing note is no floor", "a missing state folder is no floor", "a note round-trips exactly", "raising never lowers the floor" (write 200, raise to 100, read 200 with the first `lastName`), "an unreadable note is refused, not read as absent". Fiscal: "no name gives no floor", "the latest of a frozen request, an intent and public evidence gives the floor", "the floor is the start of the minute after the name", "an unreadable intent refuses rather than giving no floor".
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts`; expected FAIL on the missing exports and seat.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both, `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-host-path.test.ts` (its pin only gains entries) and `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts`; PASS.
- [ ] **Step 5:** Commit `git commit -s -m "The start-again note file and the fiscal module's floor seat (A1042)"`.

### Task 1b: Setup never issues a name at or before the note; Start again writes it and deletes the kept picks file

Start again still makes a workspace here; Task 3c makes it delete in place.

**Files:**
- Create: `apps/server/src/first-setup-start-again-note.test.ts`
- Modify: `packages/module/src/operation-preparation.ts:29-35` (`readSetupFacts` gains `readonly floors: readonly unknown[]`), `packages/provisioning/src/first-setup-runtime.ts:236-245` (`floors: startAgainFloorSources(await readStartAgainNote((await boxFolders(options)).stateDir))`), `packages/fiscal-verifactu/src/hour-preparation.ts:173` (`history: [facts.localHistory, ...facts.floors]`), `apps/server/src/first-setup-resolution.ts:249-300` (gather, raise, delete the kept picks file)
- The six stubs in "How the assertion list was built" item 3 gain `floors: []`; S8's first part (`first-fiscal-hour-finish.test.ts:323`: the kept picks file is gone after Start again)
- Fixture: `apps/server/test/hour-first-fiscal.ts` (`hourFirstFiscalFixture`), the `answer()` and `start()` helpers of `apps/server/src/first-setup-unused-pdf.test.ts:66-81`, the clock helpers in `apps/server/src/testing/hour-test-clock.ts`

- [ ] **Step 1: Write the failing test** `apps/server/src/first-setup-start-again-note.test.ts` on `hourFirstFiscalFixture` (an attempt that has chosen a name and has a delivered recovery PDF), starting again with the `current-master` answer built exactly as `first-setup-unused-pdf.test.ts:66-81` builds it:
  - `"a start-again with the clock set back behind the abandoned attempt's name is refused, not given a repeated name"`: read the abandoned name `M` from the frozen request; Start again; `expect(await readStartAgainNote(anchorStateDir)).toEqual({ version: 1, floorMs: F, lastName: M, module: "fiscal-verifactu" })` where `F` is the start of the minute after `M`; the kept picks file in the anchor state folder is gone; set both clocks to 10 minutes before `M`'s minute; a new attempt's selection rejects with `{ code: "sif.allocation_invalid", params: { reason: "minute_not_later", allowedFromMs: F } }`; afterwards the new attempt's frozen request is `null`, `consumptionIntent` is `false`, and `readModulePreparationHistory` holds no intent for the new event.
  - `"at the abandoned name's own minute, setup waits and then chooses a later name"`: clock at the start of `M`'s minute; `selectPastWaits` resolves to a name whose `decodeMinuteIdentity` is greater than `M`'s.
  - `"a clock past the note chooses a later name at once"`: clock 5 minutes after `F`; the name decodes later than `M`.
- [ ] **Step 2: Run it and read the failure.** `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`. **The refusal assertions already pass on today's code**, because the kept picks file refuses the clock-behind case. The test fails today only on the note assertions: it prints that `readStartAgainNote` returned `null` where the note object was expected (or the missing export, if Task 1a has not landed), and the kept picks file still exists. What makes the check count is the deletion proof in Step 5, and again in Task 4c. **Do not change Start again's rules to make the test reach its scenario.** If the fixture is refused `setup.not_ready`, the fixture is wrong: STOP and report.
- [ ] **Step 3: Implement.** In `startAgainFirstSetup`, after the proof and before `records.prepare`: for each frozen module with a seat, collect `[state, ...state.previous]` contexts and inputs (`firstSetupModuleContext`), `readModulePreparationHistory(anchor, module)` and the attempt's own public evidence from `snapshot.originals` (D3's readers, without `outside-file:`); take the latest floor; `raiseStartAgainNote(anchor.stateDir, …)` when there is one; remove `<anchor state>/module-preparation-state.json`. If `host.modules` is missing, refuse `setup.not_ready` as `:256` does.
- [ ] **Step 4:** Run the new file (PASS, non-zero count), the six stub files, and `pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour-finish.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-recovery-delivery.test.ts src/first-setup-resolution-inspection.test.ts`. Only S8's `:323` change is expected; anything else is a STOP. `first-setup-retired-assignments.test.ts` is unaffected here (its fixture retires without Start again, `:281-302`).
- [ ] **Step 5: Prove the check by deletion.** In a scratch commit, remove `...facts.floors` from `hour-preparation.ts:173` and re-run the new file. Written before running: a broken check shows as `setup.attempt_conflict` (the archive check still exists until Task 4c) or a given name, instead of `minute_not_later`. Record the output in the commit message; restore; re-run green.
- [ ] **Step 6:** Commit `git commit -s -m "Start again records the last series name; setup never issues one at or before it (A1042; item S8 part 1)"`.

### Task 2: The note cannot be lowered, damaged into "no floor", or carried in by a restore

**Files:** `packages/provisioning/src/first-setup-start-again-note.ts` and its test; `apps/server/src/first-setup-entry.test.ts:334-365` (gains two rows); `apps/server/src/first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing cases.** Provisioning, one `it.each` row each, all `setup.attempt_invalid`: empty file; `{}`; `"lastName": ""`; an extra key; `floorMs` as a string; `floorMs: 1.5`; `floorMs` before the name epoch; `module: ""`; a symbolic link in place of the file. `first-setup-entry.test.ts:334-365` gains the rows `first-setup-start-again.json` and `first-setup-deleting.json`: a bundle naming either is refused `recovery.bundle_invalid` and `validateDatabaseEntries` refuses a `secrets/` entry naming either. Server: `"two Start again requests at once raise the note once"` (barriers, not sleeps).
- [ ] **Step 2:** Read `apps/server/src/restore-stream.ts`. If the bucket-stream restore writes state files by a path that does not reach `validateEntryMetadata`, add a case for it; otherwise put the receipt (`file:line`) in the commit message.
- [ ] **Step 3:** Run the three files; expected FAIL only where Task 1a's store does not refuse yet.
- [ ] **Step 4:** Implement the remaining validation: integers only, `floorMs` at or after the name epoch, `lastName` 1–64 characters, `module` matching `/^[a-z][a-z0-9-]*$/`.
- [ ] **Step 5:** Run the three files and `pnpm exec vitest run scripts/errors-reachable.test.ts`; PASS.
- [ ] **Step 6:** Commit `git commit -s -m "Refuse a damaged or lowered start-again note; restores never carry one (A1042)"`.

### Task 3a: Start again is refused when the database is missing (Q1 A)

**Files:** `apps/server/src/first-setup-resolution.ts:233-299` (refuse `setup.not_ready` when `inspection.database === "missing"`, before any authority branch); tests S5, S10, S12, S13 and S14's `:176-221`.

- [ ] **Step 1:** Rewrite those cases as their items say, including S5's added `committed` row. Run `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-fiscal-hour-finish.test.ts src/first-fiscal-hour.e2e.test.ts src/first-setup-resolution.route.test.ts src/first-setup-resolution-inspection.test.ts`; expected FAIL on the rewritten cases (Start again still succeeds).
- [ ] **Step 2:** Implement; re-run; PASS.
- [ ] **Step 3:** Commit `git commit -s -m "Start again is refused on a missing database (A1042, owner Q1; items S5, S10, S12, S13, S14 part)"`.

### Task 3b: The deletion marker, and finishing an interrupted deletion safely

Unit work in provisioning; nothing calls it yet.

**Files:** `packages/provisioning/src/first-setup-start-again-note.ts` (marker read, write and removal; `finishStartAgainDeletion`; `assertNoStartAgainDeletion`), its test.

**Interfaces — produces:**
- `writeStartAgainMarker(roots, marker: StartAgainMarker): Promise<void>` and `readStartAgainMarker(venueDir): Promise<StartAgainMarker | null>`, the marker as in D3. `markerSize(marker): number` lets the caller refuse `setup.not_ready` before writing anything over 1 MiB.
- `deleteMarkedAttempt(roots, marker, remove?: (path: string, kind: "file" | "folder") => Promise<void>): Promise<void>` — D3's order and side-file rules: record `step-*` subfolders before their record folder, every entry of a listed folder including dot-names, folders by `rmdir`. `remove` is replaced only by tests, to inject a failure.
- `finishStartAgainDeletion(roots: { stateDir: string; venueDir: string }): Promise<void>` — canonicalises the folders, then takes `lockVenueDatabase` and makes D3's checks, then `deleteMarkedAttempt`, then removes the marker; otherwise `setup.start_again_incomplete`, nothing deleted.
- `assertNoStartAgainDeletion(venueDir: string): Promise<void>` — refuses `setup.start_again_incomplete` while a marker exists.

- [ ] **Step 1: Failing cases**, on real files in a temporary folder:
  - "no marker does nothing";
  - "a marked deletion cut after the marker, after the first, middle and last deletion is finished" (inject through `remove`);
  - "an attempt that never chose a name is finished from the marker alone";
  - "a record folder with a `step-000003/` subfolder is finished, subfolder first";
  - "a leftover `.first-setup-<uuid>.tmp` in a listed folder is removed with it";
  - "a side file recreated by a read after its main file was deleted is removed", and "a zero-length `-wal` is accepted";
  - "folders given through a symbolic link are canonicalised before they are compared with the marker";
  - refusals, each with nothing deleted:
    - a pending deletion beside `trading.env`;
    - beside a `venue.db` whose bytes differ from the marker;
    - beside a newly placed `venue.db` the marker does not name;
    - **a row written into `venue.db-wal` after the cut** (the main file's bytes unchanged);
    - a marker naming other folders;
    - a file newly added inside `first-fiscal-documents/` (the `rmdir` fails);
  - "a marker over 1 MiB is refused `setup.not_ready` before anything is written".
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts`; expected FAIL (missing exports).
- [ ] **Step 3:** Implement; run; PASS.
- [ ] **Step 4:** Commit `git commit -s -m "A deletion marker that names exactly what Start again deletes, and a safe finisher (A1042)"`.

### Task 3c: Start again deletes the attempt in place under the marker

**Files:** `apps/server/src/first-setup-resolution.ts:210-345` (D3's refusals and order of writes; replace `:300-342`; the kept picks file's deletion from Task 1b moves into the marked list), `apps/server/src/setup-first-fiscal-api.ts:813-851` (W1, and the answer and restart for a deletion that throws); tests: `apps/server/src/first-setup-start-again-note.test.ts`.

- [ ] **Step 1:** Re-run the first sweep narrowed to `first-setup-resolution|setup-first-fiscal-api|start-again`, and confirm every hit is an item for Task 3e.
- [ ] **Step 2: Failing cases**, fixtures opening the venue folder with `openVenueDatabase` so `node.db` exists:
  - "start again leaves no workspace and none of the attempt's files, node.db included";
  - "start again is refused when node.db holds a table" (`create table t(x)` in `node.db`);
  - "start again with no node.db does not create one and succeeds";
  - one row per name on D3's refusal list, including `.venue.db-litestream/` (folders unchanged, no marker, no note change);
  - "start again is refused while a deletion marker exists" (`setup.start_again_incomplete`; the first marker unchanged);
  - "an attempt whose owner recovered the password twice can start again, and the next start finds nothing left";
  - "a deletion that throws part-way answers `setup.start_again_incomplete` and requests a restart, and the restart finishes it";
  - "the start-again route is not served by ordinary setup";
  - "a repair-page inspection read between deletions, then a cut, still lets the next start finish" (the GET route's inspection, then `finishStartAgainDeletion`).
- [ ] **Step 3:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`; expected FAIL (a workspace is still made).
- [ ] **Step 4: Implement.** Keep `:211-299` (request check, status check, proof, authority) apart from D3's added refusals. Invalidate the host's caches as `:339-341` do.
- [ ] **Step 5:** Run the file; PASS. The suites of Task 3e are expected red until it lands; nothing else may fail.
- [ ] **Step 6:** Commit `git commit -s -m "Start again deletes the unused attempt in place under a marker (A1042)"`.

### Task 3d: Every other write and entry point refuses while a deletion is unfinished

**Files:**
- `packages/provisioning/src/first-setup-state.ts`: `persist` (`:554-559`), `claim`, and `assertVenueFirstSetupAllowed` (`:502-506`) call `assertNoStartAgainDeletion`.
- `packages/provisioning/src/first-setup-resolution.ts`: `prepare` and `apply` call it.
- `apps/server/src/boot.ts:1085` (`assertOtherAllowed`) and `apps/server/src/recovery-entry.ts:56`.
- A731's repair open (Task 0).
- The setup app: `apps/setup/src/setup-app.ts:194-199` (`FIRST_SETUP_ERROR_MESSAGES` gains both codes) and `apps/setup/src/i18n/strings/shell.ts` (D5's setup-app wording, English and Spanish).
- Tests: `apps/server/src/first-setup-start-again-note.test.ts`, `packages/provisioning/src/first-setup-start-again-note.test.ts`, `apps/setup/src/setup-app-resolution.test.ts`.

- [ ] **Step 1: Failing cases:**
  - "while a deletion is pending, a claim, abandon, ownership recovery, a record-store prepare or apply, restore placement, restore staging, the restore command, reset, adopt and the recovery entry are refused" — one row each, `setup.start_again_incomplete`, and the marked files unchanged;
  - in `setup-app-resolution.test.ts`, reading the expected text from the strings file in both languages: the repair page shows each new code's text, and so does one restore or reset screen receiving `setup.start_again_incomplete`.
- [ ] **Step 2:** Run the three files (check free memory before the setup package's Chromium run); expected FAIL.
- [ ] **Step 3:** Implement. Read `apps/server/src/rejoin-command.ts:89-136`; if a rejoin can remove or overwrite the marker, add the check there with a case.
- [ ] **Step 4:** Run the three files and `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-state.test.ts src/first-setup-resolution.test.ts src/first-setup-resolution.durability.test.ts src/first-setup-resolution.integrity.test.ts`. Only assertion-list items may change; these four suites are not on it.
- [ ] **Step 5:** Commit `git commit -s -m "Every first-setup write and placing path refuses while Start again is unfinished (A1042)"`.

### Task 3e: The existing Start again suites follow the deletion

**Files (tests and stubs only):** `apps/server/src/first-setup-unused-pdf.test.ts` (S1, S3, S4, S6), `first-fiscal-hour-finish.test.ts` (W1, S8 part 2, S9), `first-setup-resolution-inspection.test.ts` (S14 except `:176-221`), `first-setup-recovery-delivery.test.ts` (S15), `apps/setup/test/missing-database-browser.ts:61-65` (W1).

- [ ] **Step 1:** Change each case exactly as its item says; anything else is a STOP. Write each value an item says is "recorded" into the commit message.
- [ ] **Step 2:** Run each file with `pnpm --filter <package> exec vitest run <file>`.
- [ ] **Step 3:** Commit `git commit -s -m "Start again suites follow the deletion in place (A1042; items W1, S1, S3, S4, S6, S8 part 2, S9, S14, S15)"`, then push 3c–3e together.

### Task 4a: Remove the retirement readers — module contract and provisioning

**Files:** `packages/module/src/operation-preparation.ts:48-54` (delete `readRetiredSetup`), `packages/provisioning/src/first-setup-runtime.ts:79,85-91,115,212,278`, `packages/provisioning/src/first-setup-preparation.ts:28,85-101,109` (keep the `state.previous` loop, `:102-121`), `packages/provisioning/src/first-setup-state.ts:650-668` (claim keeps the id check against `previous`), `packages/provisioning/src/first-setup-workspace.ts:511-576` (delete the three readers), `packages/provisioning/src/index.ts:69-70`; tests P2, P3, P4.

- [ ] **Step 1:** Delete; `pnpm --filter @waitron/provisioning typecheck` and `pnpm --filter @waitron/module typecheck` find the callers.
- [ ] **Step 2:** Apply P2–P4; run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-preparation.test.ts src/first-setup-command.test.ts src/first-setup-state.test.ts src/first-setup-runtime.test.ts src/cli-first-setup.test.ts`.
- [ ] **Step 3:** Commit `git commit -s -m "Remove the retired-archive readers from the module contract and provisioning (A1042; items P2-P4)"`.

### Task 4b: Remove the retirement readers from the server, and rebuild the retired-name cases (S7a–S7f)

**Files:** `apps/server/src/module-operation-host.ts:15,52-78,82`, `apps/server/src/first-setup-resolution.ts:242-270` (the inherited-register and per-retirement loops go; the current attempt's proof stays), A731's callers from Task 0; `apps/server/src/first-setup-retired-assignments.test.ts` (fixture rebuilt on Start again; S7a–S7f).

- [ ] **Step 1:** Re-run S7e's grep; a new non-test writer is a STOP.
- [ ] **Step 2:** Delete the readers; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 3:** Rebuild the fixture so each case abandons an attempt through `startAgainFirstSetup` (as Task 1b's test does); apply S7a–S7f. Cases S7g–S7n are marked `it.skip` with their item name for the length of this task only; Task 4c removes every skip. Run `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts`.
- [ ] **Step 4:** Commit `git commit -s -m "Server: retired-archive readers removed; retired-name cases rebuilt on Start again (A1042; items S7a-S7f)"`.

### Task 4c: The remaining retired-name cases (S7g–S7n, S2, S18) and the second deletion proof

**Files:** `apps/server/src/first-setup-retired-assignments.test.ts` (S7g–S7n, every skip from 4b removed), `apps/server/src/first-setup-unused-pdf.test.ts` (S2), `apps/server/src/first-setup-retirement-reads.test.ts` (S18, deleted).

- [ ] **Step 1:** Apply the items; run `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-start-again-note.test.ts`; `/usr/bin/grep -n "it.skip" apps/server/src/first-setup-retired-assignments.test.ts` prints nothing.
- [ ] **Step 2: Re-prove Task 1b's check by deletion** — the code around it changed shape (`CLAUDE.md` §4). Written before running: with the archive check gone, a broken check shows as a name at or before `M` being given. Record the output; restore; re-run green.
- [ ] **Step 3:** Commit `git commit -s -m "The note is the only memory of an abandoned name (A1042; items S7g-S7n, S2, S18)"`.

### Task 4d: Remove the retired block of the historical dispatcher

**Files:** `packages/fiscal-verifactu/src/allocation-configuration.ts:58-119`; tests F1.

- [ ] **Step 1:** Delete the block; `pnpm --filter @waitron/fiscal-verifactu typecheck` and `pnpm --filter @waitron/composition typecheck`.
- [ ] **Step 2:** Apply F1; run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declared-paper-standby.test.ts src/initial-cloud-setup.test.ts src/declared-paper-consumers.test.ts src/allocation-configuration.test.ts` and `pnpm --filter @waitron/composition exec vitest run src/allocation-configuration.test.ts`.
- [ ] **Step 3:** Commit `git commit -s -m "Historical dispatcher: drop the retired-archive block (A1042; item F1)"`.

### Task 5a: Provisioning forgets workspaces; old archives are refused

**Files:** `packages/provisioning/src/first-setup-workspace.ts` (keep only `assertNoLegacyFirstSetupWorkspace`), `first-setup-state.ts` (claim, update, `inspectFirstSetupMarker` and `assertVenueFirstSetupAllowed` call it in place of `assertFirstSetupVenueTarget`; the old names stay in `FIRST_SETUP_HOST_FILES`), `module-preparation-state.ts:78,103`, `first-setup-resolution-inspection.ts:256-259`, `first-setup-owner.ts`, `first-setup-finish-audit.ts` (the folders given, or `boxFolders`, in place of `firstSetupAnchorFor`), `box-folders.ts` (drop the workspace branch), `index.ts`; tests P1, P5, P6, P7. The record store (`first-setup-resolution.ts`) is not changed (D4).

**Interfaces — produces:** `assertNoLegacyFirstSetupWorkspace(roots: { stateDir: string; venueDir: string }): Promise<void>` — refuses `setup.workspace_unsupported` only when one of D4's names is present, or the venue folder sits inside `first-setup-workspaces/<id>/` (kept from `first-setup-workspace.ts:461,492`); any other failure (a symbolic-link or unreadable folder) keeps today's `setup.attempt_uncertain` (`:471-473`).

- [ ] **Step 1: Failing cases** (replacing P1): one row per D4 name in each folder → `setup.workspace_unsupported`; an empty file counts; a venue folder inside `first-setup-workspaces/<id>/` → `setup.workspace_unsupported`; a folder that is a symbolic link → `setup.attempt_uncertain`; a box with none passes.
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-workspace.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement and delete; apply P5–P7; run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-workspace.test.ts src/first-setup-state.test.ts src/first-setup-owner.test.ts src/module-preparation-state.test.ts src/cli-first-setup.test.ts src/box-folders.test.ts src/first-setup-resolution-inspection.test.ts`.
- [ ] **Step 4:** Commit (no push until 5e) `git commit -s -m "Provisioning: no first-setup workspaces; a pre-A1042 archive is refused (A1042; items P1, P5-P7)"`.

### Task 5b: The recovery page's text for the two refusals

**Files:**
- `apps/server/src/recovery-surface.ts`:
  - `:251-457`: D5's two `OPERATOR_TEXT` rows;
  - `RecoveryDeps` gains `refusedAtStart?: true`;
  - `PAGE_TEXT` (`:165-195`) gains D5's status line in both languages, chosen at `:533-534` in place of the counted or uncounted line.
- `apps/server/src/recovery-state.ts:152`: `refusedAtStart(current: RecoveryState, code: ErrorCode, at: Date): RecoveryState` beside `fullDiskAtStart`. It is served, never written.
- Tests: `apps/server/src/recovery-surface.test.ts`, `apps/server/src/recovery-state.test.ts`.

- [ ] **Step 1: Failing cases:** each code renders its title and action in both languages; a page served with `refusedAtStart: true` shows D5's status line in both languages and never contains "disk" or "disco"; `refusedAtStart` sets `lastErrorCode` and the level and touches nothing on disk.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-state.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement. Run `src/recovery-surface.test.ts` **whole**: "never suggests wiping anything, in either language" (`:386-394`) must pass unedited. Render the page's HTML to a file and open it with the workspace's Playwright Chromium in both languages, light and dark, at phone width (`CLAUDE.md` §4).
- [ ] **Step 4:** Commit `git commit -s -m "Recovery page: text for an old archive and an unfinishable Start again (A1042)"`.

### Task 5c: The start serves that page for an old archive or an unfinishable deletion

**Files:**
- `apps/server/src/first-setup-entry.ts:45-110`: D5's checks after canonicalising, in their own `try`, returning `{ kind: "refused", code, roots }`.
- `apps/server/src/node-entry.ts`:
  - after `:338`, before the resolution branch, with the full-disk branch at `:368` taking precedence;
  - the `server.boot_started` and `server.boot_failed` pair through `pageLog` (`:211-218`);
  - `recoveryApp` with `refusedAtStart(...)` and `refusedAtStart: true`;
  - the admission consumer at `:388-405`.
- `apps/server/src/first-setup-launch.ts:72-106`: the same page through `listen`, with D5's `state`, `logDir` and `onRetry`.
- `apps/server/src/boot.ts:869`: throws.
- Tests: S16, S17, `apps/server/src/node-entry.test.ts`, `first-setup-entry.test.ts`.

- [ ] **Step 1: Failing cases** in `first-setup-resolution.boot.test.ts`, through `runEntry` and `startServerOrFirstSetupResolution` with real listeners (`freePorts(n)` once per case):
  - "a box holding a pre-A1042 archive serves the recovery page naming it, in every entry mode" — fetch the page and assert the English and Spanish title, action and D5's status line;
  - "the start finishes an interrupted Start again before serving setup";
  - "an unfinishable deletion serves the recovery page naming it, and Try again exits";
  - "a refused start after an earlier failed start shows the new code under 'Why the last start failed'" (an older `server.boot_failed` in the log first);
  - "folders reached through a symbolic link still finish an interrupted Start again" (the checks run after canonicalising).
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement; apply S16 and S17; run the files above plus `src/first-setup-workspace.test.ts src/node-entry.test.ts src/first-setup-entry.test.ts src/recovery-surface.test.ts`.
- [ ] **Step 4:** Commit `git commit -s -m "Start: serve the recovery page for an old archive or an unfinishable Start again (A1042; items S16, S17)"`.

### Task 5d: The server's repair routes forget workspace selection

**Files:** `apps/server/src/first-setup-resolution.ts:61-209` (delete `inspectWorkspaceSelection`, `resumeWorkspaceSelection`), `apps/server/src/setup-first-fiscal-api.ts` (their routes), `apps/server/src/first-setup-unused-assignment.ts:50` (drop `workspace:predecessor`); tests S7, S11, S19, S20.

- [ ] **Step 1:** Before deleting S20, grep the ownership-recovery suites for a failed-password throttling case; if none, move S20's `:297` case there first. Move S19's `:271` HTTPS refusal to the Start again route.
- [ ] **Step 2:** Delete; apply the items; run `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-fiscal-hour-finish.test.ts src/first-setup-start-again-note.test.ts` and the file the throttling case moved to.
- [ ] **Step 3:** Commit `git commit -s -m "Server: drop workspace-selection resumption (A1042; items S7, S11, S19, S20)"`.

### Task 5e: The anchor readers and the workspace clean-up go

**Files:** `apps/server/src/archive-entries.ts:37-42`, `apps/server/src/recovery-document-evidence.ts:16` (the folders given, through `boxFolders`), `apps/server/src/node-entry.ts:352-366` (the moved-folders clean-up and its `moved` branch), A731's callers from Task 0; tests S21, S22.

- [ ] **Step 1:** Delete; `pnpm --filter @waitron/server typecheck` passes (5a's red ends here).
- [ ] **Step 2:** Apply S21 and S22; run `pnpm --filter @waitron/server exec vitest run src/hour-backup-state.test.ts src/recovery-document-evidence.test.ts src/node-entry.full-disk.test.ts`. The `start-full-disk.e2e.test.ts` case needs a small real filesystem (`hdiutil` on macOS; `WAITRON_FULL_DISK_DIR` on Linux); a skip is not a pass (`CLAUDE.md` §4).
- [ ] **Step 3:** Commit `git commit -s -m "Server: no anchor lookups or workspace clean-up (A1042; items S21, S22)"`, then push 5a–5e together.

### Task 5f: The setup screens

**Files:** `apps/setup/src/screens/initial-owner-strings.ts:11-28,50-62`, `apps/setup/src/setup-app.ts:1244-1265,2188-2239`, `apps/setup/src/first-setup-session.ts:558`, `apps/setup/src/api/client.ts` (the workspace-selection and missing-database retirement methods go); tests A1–A4, `setup-app-resolution.unsaved.test.ts`, `setup-app-resolution.a11y.test.ts`.

Wording (concise, as the owner prefers):

| Key | English | Spanish |
| --- | --- | --- |
| `startAgainHelp` | Deletes this unused attempt. The invoice series names it chose are never used again. | Borra este intento sin usar. Los nombres de serie que eligió no se vuelven a usar. |
| `retireConfirmed` | Delete the old attempt and start again. | Borrar el intento anterior y empezar de nuevo. |
| `restarting` | The old attempt is deleted. Reconnect to continue. | El intento anterior se ha borrado. Reconecta para continuar. |
| `missingDatabase` (Q1 A) | The setup database is missing. Recover from a backup or reinstall the box. | Falta la base de datos de la configuración. Recupera desde una copia o reinstala el equipo. |

- [ ] **Step 1: Failing cases** in `setup-app-resolution.test.ts`, reading expected text from the strings file in both languages: the confirmation shows the new help and label; after Start again the page shows `restarting`; with a missing database no Start again button is drawn.
- [ ] **Step 2:** Check free memory (`memory_pressure | grep free`), then `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`; expected FAIL on the old text.
- [ ] **Step 3:** Implement; apply A1–A4; run the files above and `pnpm --filter @waitron/setup build`. Open the repair page and look at it in light and dark, at phone width, in both languages.
- [ ] **Step 4:** Commit `git commit -s -m "Setup: Start again says it deletes the attempt (A1042; items A1-A4)"`.

### Task 6: Restores, re-registrations and promotions honour the note

**Files:** `apps/server/src/recovery-preparation.ts:200-209` (append `startAgainFloorSources(await readStartAgainNote((await boxFolders(options)).stateDir))` beside `backup-created`), `apps/server/src/node-operation-preparation.ts:89-110` (the same, into `current.history`), A731's recovery-facts builder from Task 0. Tests go through the production builders, not the test-only helpers `apps/server/test/hour-recovery-host.ts` and `apps/server/src/testing/staged-hour-*.ts`, which build their own chooser.

- [ ] **Step 1: Failing cases:** "a restore with the clock set back behind the start-again note is refused, not given a repeated name" (a note at `F`, a backup whose history ends before `F`, both clocks 10 minutes before `F` → `minute_not_later` with `allowedFromMs: F`); "a backup whose history is later than the note wins"; "a restore into A731's nested target reads the box's own note"; one re-registration case with the note ahead → refused.
- [ ] **Step 2:** Run each file with `pnpm --filter @waitron/server exec vitest run <file>`; expected FAIL (a name is given).
- [ ] **Step 3:** Implement; run; PASS. Prove each addition by deletion as in Task 1b Step 5, recording the output.
- [ ] **Step 4:** Commit `git commit -s -m "Restore, re-register and promote honour the start-again note (A1042)"`.

### Task 6b: `waitron.sh reset` keeps the note (Q4 A)

**Files:** `deploy/waitron.sh:744` (`! -name tls ! -name first-setup-start-again.json`), `scripts/waitron-sh.test.mjs`.

- [ ] **Step 1: Failing cases** in `scripts/waitron-sh.test.mjs`:
  - beside the existing text match at `:1485-1491`: "a plain reset's state clean-up spares the start-again note". This is weaker than its name — under stubbed Docker it can only match the command text.
  - "the reset's state clean-up keeps tls/ and the note and removes the rest": extract the `sh -c` expression and run it with `WAITRON_STATE_DIR` set to a temporary folder holding `tls/`, the note and two other files.
  - "reset --all removes the state volume": the existing `rm_volume waitron_state` match.

  Run `pnpm exec vitest run scripts/waitron-sh.test.mjs`; expected FAIL.
- [ ] **Step 2:** Implement; run; PASS.
- [ ] **Step 3:** Commit `git commit -s -m "waitron.sh reset keeps the start-again note (A1042)"`.

### Task 7: Documentation, backlog and the A679 pointer

**Files:**
- `docs/backlog/setup.md:307-326`: move "Owner decision: should a setup request stop re-checking every old 'start again' archive in full?" into `## Decisions and deliberate limits` (`:328`) as "DECIDED (owner, 2026-10-24): neither — Start again deletes the attempt after its empty-database proof and keeps one small note of the last series name (A1042)". Give D1's file, D2's floor and the owner's answers to Q1–Q6 one sentence each.
- `docs/backlog.md:571-574`: delete the open-decision entry, and an A1042 entry if one exists by then.
- B3's entry, `docs/backlog.md:4535`: the dashboard reinstall carries the note.
- A950's entry, `docs/backlog/box.md:80-96`: Q5's answer.
- New backlog entries:
  - "The recovery page's never-wipe test misses Spanish subjunctive forms": `apps/server/src/recovery-surface.test.ts:386-394` matches `\brestablece` but not `restablezca` or `restablezcas`. Tightening it changes an existing assertion, so the owner approves that change.
  - "The first-setup record store still accepts the `retire` and `select-workspace` actions and `nextWorkspace`, which nothing writes since A1042" (D4).
  - Only if the owner answers Q1 B: "The password Start again on a missing database checks only the attempt's status, and admits an attempt whose fiscal commit finished".
- `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md`: a dated pointer at the top and beside `:157` — "Dated pointer, 2026-10-24: 'Preserve the original attempt and artifacts' is superseded by A1042 — Start again deletes the attempt and keeps one small note; see `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md`".
- `docs/operations/first-live-fiscal-setup.md:84-87`; `docs/developers/conventions-data.md:2964-2967,3078-3083`; `docs/developers/testing-guide.md:1307`; `deploy/README.md` where it describes the reset (Q4).
- `CLAUDE.md` §5's installation-name rule: one clause naming the note, and only if "every name in the history it can read" no longer covers it.

User guide: none at db4e0a6bf (`/usr/bin/grep -rn -i "start again\|empezar de nuevo" apps/server/src/guide` finds nothing). If Task 0 found A731's `backup-recovery.md` mentioning Start again, change both languages with the same `{#id}`s.

- [ ] **Step 1:** Read the whole base-to-tip range for claims about kept attempts, workspaces or archives: `/usr/bin/grep -rn -i "workspace\|retire\|retain.*attempt\|archive" docs/operations docs/developers README.md apps/server/README.md deploy/README.md`, reviewing every hit (`CLAUDE.md` §1). Historical documents get a dated pointer, never a rewrite.
- [ ] **Step 2:** Make the edits.
- [ ] **Step 3:** Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and, if a guide changed, `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`. For each changed `.md` outside `docs/`, `pnpm exec prettier --check <file>`; inside `docs/`, `pnpm exec prettier --file-info <file>` shows it is ignored.
- [ ] **Step 4:** Commit `git commit -s -m "Docs: Start again keeps one small note; A1037's question settled (A1042)"`.

### Task 8: Final qualification and parking for the owner

- [ ] **Step 1:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/hour-selection.test.ts src/hour-clock.test.ts src/minute-selection-unknown-name.test.ts`; `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts` prints nothing.
- [ ] **Step 2:** `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/coverage-thresholds.test.ts scripts/waitron-sh.test.mjs`, and `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` whole.
- [ ] **Step 3:** Coverage once for the touched non-shard packages, reading the per-file table: `pnpm --filter @waitron/provisioning test:coverage`, `pnpm --filter @waitron/fiscal-verifactu test:coverage`, `pnpm --filter @waitron/module test:coverage` (server and setup are left to CI's shards).
- [ ] **Step 4:** Compare the branch's changed assertions with "Existing assertions this plan changes": `git diff main --stat -- '*.test.ts' '*.test.mjs' 'apps/*/test/*.ts'` and read each hunk; re-run both sweeps on the branch. Anything not on the list is a STOP.
- [ ] **Step 5:** `/finish-branch` on the worktree — FULL path, the Codex run-it seat as two reviews side by side (the second sets the checklist aside). Brief both with Review focus 1–5 and the owner's answers to Q1–Q7.
- [ ] **Step 6:** Open the PR. First line: "Reset any development or demo box that holds a first-setup workspace or start-again archive (`wa-wt reset demo <name>`): such a box now refuses to start and says so." State the owner's answers as built, and list each finding of the plan reviews (three rounds, and Task 0's) with what changed. Watch CI on the current head; park `needs-owner-review` (fiscal: series names); post the landing note to `~/waitron-campaign/questions.md`.

## Self-review

- **Spec coverage.**
  - Delete after the empty-database proof: Tasks 1b and 3c.
  - One small note: D1, Tasks 1a and 2.
  - Never at or before it: D2, Tasks 1b and 6.
  - Readers replaced: Tasks 4a–4d; the workspace machinery: Tasks 5a–5e.
  - A1037's question moved to Decisions, and the A679 pointer: Task 7.
  - Survives a reinstall and a restore, and the named ways it is lost: D1, Tasks 2, 6b and 7, Q3–Q5.
  - Old boxes: D4, D5, Tasks 5a–5c.
  - Failing test first, proved by deletion: Task 1b Steps 1, 2 and 5; re-proved in Task 4c Step 2.
  - Waits for A731 and re-checks: Tasks 0 and 0b.
- **Names across tasks:** `boxFolders`, `readStartAgainNote`, `raiseStartAgainNote`, `startAgainFloorSources`, `writeStartAgainMarker`, `readStartAgainMarker`, `deleteMarkedAttempt`, `finishStartAgainDeletion`, `assertNoStartAgainDeletion`, `assertNoLegacyFirstSetupWorkspace`, `START_AGAIN_NOTE_FILE`, seat `startAgainFloor`, facts field `floors`, admission kind `refused`, recovery flag `refusedAtStart` and helper `refusedAtStart`, `markerSize`, codes `setup.start_again_incomplete` and `setup.workspace_unsupported`, files `first-setup-start-again.json` (state folder) and `first-setup-deleting.json` (venue folder).
- **Assumptions to watch:** A731's shape (Task 0 Step 3); S7d's exact answer (Task 4b records it); whether `rejoin` can remove the marker (Task 3d Step 3).
