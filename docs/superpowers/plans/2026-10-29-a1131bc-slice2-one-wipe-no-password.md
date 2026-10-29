# A1131b/c slice 2: one wipe, no password — Implementation Plan

> **For agentic workers:** this plan is built INLINE by the lead session (owner's instruction for
> this slice), on the FULL review path: a fresh per-task reviewer after Tasks 1, 3, 4, 5 and 7 (the
> ones that decide what enters the never-reuse note, or change the cross-package contract), then
> `/finish-branch`. Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Each task
> is sized well under 60 tool calls; stop at the end of each task, update the ledger, and checkpoint.

**Goal:** Start again deletes a failed setup with no setup password; the box itself decides every
refusal and says it in the design's words; a setup database the box cannot read can be deleted with
a safety margin from the setup's last saved write; the item counts no longer travel between the page
and the box; the confirmation records say whose setup it was and that nobody signed in.

**Architecture:** Server first (provisioning helpers, then the two Start again actions merged around
one assessment both call, then the routes), then the setup page (a session-free wipe helper and one
Start again flow for every case), then the docs. The "files found" page (A1098), Continue and the
fresh-box restore are not changed. Nothing in `packages/fiscal-verifactu`; no migration.

**Tech Stack:** TypeScript, Hono routes, `node:sqlite`, Vitest 4 (node for `apps/server` and
`packages/provisioning`; real headless Chromium for `apps/setup`), Lit.

**Spec:** `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` — read the
whole of it; §1a, §3, §4, §5, §9c–§9e and "Slices" item 2 are this plan's scope. Slice 1's plan
(`docs/superpowers/plans/2026-10-29-a1131bc-slice1-start-again-words.md`, landed as #2230) left the
counts on the wire and the refusal block drawing them; this slice removes both.

**Worktree / branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131bc-2-one-wipe-no-password`,
`feat/a1131bc-2-one-wipe-no-password`, off main `bff4a7809`. Ledger:
`docs/handoffs/2026-10-29-a1131bc-slice2.md` (gitignored), updated at the end of every task with
the task's commit, the `Tests` counts read, and every test edited by design (old → new).

## Global Constraints

- **Fiscal-adjacent.** No file in `packages/fiscal-verifactu` changes (the only possible exception
  is Task 0's STOP, which goes to the owner first). No change to `computeHuella`, the chain,
  numbering, `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal`. No migration.
  These must pass UNEDITED in Task 12:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`.
- **Unchanged:** the "files found" page and its password (`apps/server/src/recovery-start-again.ts`,
  `packages/provisioning/src/first-setup-start-again-choose.ts`); Continue and its password; the
  fresh-box restore; both routes' `assertHttps` (`apps/server/src/setup-first-fiscal-api.ts:1022`,
  used at `:1031` and `:1060`); the note's writers (Start again and A1098's Move only).
- **Exact words** (spec §9c–§9e; keys in `apps/setup/src/screens/initial-owner-strings.ts`):
  - `keptFault` EN `The setup database holds records that Waitron never deletes. An unfinished setup should hold none, so this is a fault in Waitron. Deleting this setup is not offered. Reconnect keeps everything as it is.`
    ES `La base de datos de configuración guarda registros que Waitron nunca borra. Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. No se ofrece borrar esta configuración. Reconectar lo deja todo como está.`
  - `tradingSaved` EN `This setup already saved the settings the box sells with, so deleting it is not offered.`
    ES `Esta configuración ya guardó los ajustes con los que vende el equipo, así que no se ofrece borrarla.`
  - `tradingSavedPassword` EN `To finish it, continue with your setup password.` ES `Para terminarla, continúa con tu contraseña de configuración.` (decision D7)
  - `setupFinished` EN `This setup already finished, so deleting it is not offered. Reconnect to check the saved result.`
    ES `Esta configuración ya terminó, así que no se ofrece borrarla. Reconecta para comprobar el resultado guardado.`
  - `wipeUnavailable` EN `This box cannot confirm that deleting this setup is safe, so it is not offered. Reconnect keeps everything as it is.`
    ES `Este equipo no puede confirmar que borrar esta configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.`
  - `heldChanged` EN `The setup changed after this page read it. Try again.` ES `La configuración cambió después de que esta página la leyera. Inténtalo otra vez.`
  - `setupDatabaseUnreadable` (new) EN `This box cannot read the setup database, so it cannot list the invoice series names that setup used.`
    ES `Este equipo no puede leer la base de datos de configuración, así que no puede saber qué nombres de serie de facturas usó esa configuración.`
  - `uncheckable` EN `This box cannot check the original setup password, so Continue is not offered.`
    ES `Este equipo no puede comprobar la contraseña original de configuración, así que no se ofrece Continuar.`
  - Removed keys (both locales): `heldRows`, `heldRowsOne`, `heldKept`, `heldKeptOne`, `heldInvoices`,
    `heldInvoiceOne`, `heldFault`, `startUnavailable`, `startUnavailableOccupied`, `damagedRecordPassword`.
  - Unchanged: `consumed`, `heldLost`, `noInvoiceSent`, `startAgainHelp`, `namesFrom`, every
    "files found" string.
- Spanish only in `initial-owner-strings.ts` and `apps/server/src/guide/es/` (CLAUDE.md §3).
- **TDD:** each behaviour test written first and seen failing, with the failing names in the ledger.
  Tests whose assertions change by design are in "Tests edited by design"; any other failing test is
  a STOP — report it, do not edit it. Between tasks, the only suites allowed to be red are the ones a
  task names as "red until Task N".
- **Commands.** Server and provisioning:
  `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter <pkg> exec vitest run <files>`.
  Setup page (real Chromium): check `memory_pressure | grep free` first and run beside another
  browser run only well above 15% free; `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run <files>`.
  Read the `Tests` count every time, never an exit status alone. Root guards:
  `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/<file>` from the worktree root.
- Commits: `git commit -s`, plain-English messages that name each test edited by design. Do not push.
- Personal data: any new log field naming a person uses a `PERSONAL_LOG_KEYS` name
  (`apps/server/src/log-personal-data.ts`). This slice adds no such field: the counts in the
  kept-records log reason are numbers only; the record keeps `displayName` and `email` (both listed).

## Current behaviour (read on bff4a7809, not run, unless marked)

The spec's line numbers were re-checked; they still hold except where noted.

- **Password steps that guard the wipe**: `first-setup-resolution.ts:468` (summary always needs a
  recovered owner), `:562` (held), `:577` (any request with an owner), `:605-612` (throws
  `setup.start_again_password_required` for a damaged recovery-key record, a stopped recovery or
  damaged picks without an owner). The summary route reads the owner headers and refuses without
  them (`setup-first-fiscal-api.ts:1043`, `firstFiscalOwner`); the Start again route passes them on
  when present (`:1110-1112`).
- **Without an owner, Start again today** accepts only an unused assignment, or an empty unused
  workspace (`:568-575`). **With an owner** it accepts what the no-owner branch accepts plus a
  missing database and an empty workspace answered `current-master` (`:576-581`). Every refusal of
  the owner branch other than `assertRecoveredOwner` is about the setup, not the person.
- **The held state** (`:95-109`) is offered only beside a stopped recovery (`found?.kind !==
  "stopped"` → `setup.not_ready`, `:103`). A database the inspection calls `unreadable`, `corrupt`,
  `partial` or `unknown` falls into `held` (`:530-533`) and is refused there (review R2).
- **The summary is narrower than Start again**: with the database present and no recovery it answers
  only when the series picks are damaged (`:451-460`, `:491`); the empty unused setup is sent
  straight to Start again by the page with no summary (`apps/setup/src/setup-app.ts:1461`).
- **Counts on the wire**: `heldShown` (`first-setup-resolution.ts:110-117`), the route parser
  `shownHeld` (`setup-first-fiscal-api.ts:129-145`), the deep-equal check (`first-setup-resolution.ts:636-654`),
  the record's `heldShown` (`packages/provisioning/src/first-setup-start-again-confirmation.ts:133-154`),
  the page session's `readableHeld`/`sameHeld` (`apps/setup/src/first-setup-session.ts:107-124`, `:183`),
  the page types (`apps/setup/src/api/first-setup-types.ts:140-147`), and the refusal block
  `heldRefused` (`setup-app.ts:2639-2654`, chosen at `:2697`).
- **The error boundary logs** every `AppError` at `warn` with its params and its log-only `reason`
  as `logReason` (`packages/server-kit/src/error-boundary.ts:38-52`, read).
- **The confirmation record** (`first-setup-start-again-confirmation.ts:47-55`, written at
  `first-setup-resolution.ts:664-674`) holds `administrator: { displayName, email }`. It is written
  only after the password was checked (review R5). No code reads a record back: `rg
  START_AGAIN_CONFIRMATIONS_DIR` finds only its writer, `deploy/waitron.sh:749` and
  `scripts/start-again-note-writers.test.ts:37` (run 2026-10-29).
- **The A1099 file-time floor** (`attemptLastWriteMs`, `packages/provisioning/src/first-setup-start-again-deletion.ts:333-354`)
  skips `venue.db`, `node.db` and every side file on purpose: the inspection's read-only open moves
  `venue.db-shm`, and a floor that moved between the summary and Start again would fail the deep-equal
  check (A1099 plan G5, `git show 52bfd6f65`; its test "a venue.db-shm time moved between the summary
  and Start again leaves the floor as shown"). The deletion list's side files are
  `-wal` and `-shm` only (`:36`); a `-journal` is neither counted nor deleted. The holdings reader
  expects a leftover `venue.db-journal` and rolls a copy back (`apps/server/src/first-setup-database-holdings.ts:53-80`).
- **The inspection calls a readable database `unreadable`** when it is over 128 MiB
  (`packages/provisioning/src/first-setup-resolution-inspection.ts:56`, limit set at `:257`), and
  calls a database `corrupt` only for SQLite errcode 11 or 26 (`:101-107`). The holdings reader
  answers `setup.not_ready` for a corrupt file AND for operational failures — a failed copy, a full
  disk, a failed journal check (`first-setup-database-holdings.ts:58-86`).
- **The page**: Start again is enabled only for an empty database or a stopped recovery beside a held
  one, and only when the password is checkable (`setup-app.ts:2572-2581`); pressing it beside a
  stopped recovery or a damaged record opens the password step (`:2605-2615`, `:1474-1494`,
  `#unlockDamagedRecordStartAgain` `:1521-1544`); with the database missing the whole ask appears only
  after Continue's password (`#resumeFirstSetup` `:1313-1343`). The backup status and activity reads
  send no owner (`apps/setup/src/api/client.ts:284`, `:332`).

## Decisions where the spec leaves a choice

- **D1 — One assessment.** Both actions call one internal `assessStartAgain` that runs every §1a
  check in today's order, so the summary refuses exactly what Start again would. The summary now
  answers for every offered row (empty unused, held, missing, unreadable, damaged records, stopped
  recovery); the page reads it before every confirmation.
- **D2 — The merged acceptance rule** is today's owner branch without `assertRecoveredOwner`:
  refuse `no-current-master` unless the workspace is empty and unused, and refuse a present,
  readable, non-held database unless the workspace is empty and unused or the assignment is unused.
  The inspection tests that pin today's no-owner refusals ("absence of a paper signer does not make
  %s history eligible…", "a no-master declaration cannot clear saved consumption intent") must stay
  green unedited: they pin refusals this rule keeps.
- **D3 — "Cannot be read" is decided by reading, not by the inspection's label.** The wipe takes the
  §5 path only when the inspection's `database` is `unreadable`, `corrupt`, `partial` or `unknown`
  AND the holdings read fails with SQLite damage (primary errcode 11 or 26, or "no such table").
  A readable database the inspection mislabelled (over 128 MiB) goes through the invoice check; an
  operational failure (copy, full disk, journal check, I/O) stays `setup.not_ready`. Otherwise a full
  disk would turn a database holding invoices into "cannot be read" and delete it.
- **D4 — The §5 floor counts `venue.db`, `node.db`, `-wal` and `-journal`, not `-shm`.** The spec
  lists `-shm`; it holds no committed data and every reader moves it (Current behaviour), so counting
  it would make every Start again past an unreadable database fail its deep-equal check. The owner's
  words were "when that setup last saved anything"; `-shm` is not a save. A control pins it. **Raise
  this with the plan reviewer and in the PR description.**
- **D5 — The wipe also deletes `venue.db-journal` and `node.db-journal`** (added to the deletion
  list's side files). A hot journal left beside the venue database a later restore writes could be
  rolled into it. The spec counts `-journal` for the floor but does not name its deletion. Raise it
  in the PR.
- **D6 — An unreadable database with no frozen module that has a floor seat is refused**
  (`setup.not_ready`, words `wipeUnavailable`): no margin can be computed and §9d's words need one.
- **D7 — `tradingSaved` is split** so the page draws "To finish it, continue with your setup
  password." (`tradingSavedPassword`, new value) only when the password is checkable, as today
  (`setup-app.ts:2560-2563`); with both drawn the text is exactly §9c's. With the password
  uncheckable the `uncheckable` line says Continue is not offered, and the continue sentence would
  contradict it.
- **D8 — The record** becomes `version: 2` with `setupAdministrator: { displayName, email }`,
  `confirmedOn: "repair-page"`, `signedIn: false`, and `database: "missing" | "present" |
  "unreadable"`. No reader exists (above), so no compatibility code (CLAUDE.md §3, pre-live).
- **D9 — The page reads the summary when Start again is pressed**, never on load (spec §1 step 1).
  A summary refusal hides Start again and draws its words; **Recover from backup is left exactly as
  today** — making it the same wipe, and hiding it beside a refusal (picture 3's "neither button"),
  is slice 3's ("Pictures 2 and 3"). The look check shows picture 3's words, not its buttons.
- **D10 — With the database missing the page no longer offers Continue.** Continue's password led
  there only to the Start again ask (`#resumeFirstSetup` `:1338-1343`); the ask now opens from Start
  again.
- **D11 — The kept-records log reason** is `rows=<n> kept=<n> records=<n> accepted=<n>`, on the
  summary's refusal and on Start again's.
- **D12 — The unreadable-database line** goes where the damaged-record lines go, above
  `start-again-deletes`, which then shows `heldLost` alone; the help line and `namesFrom` keep their
  slice-1 order (help, then names). Picture 4 is the slice-3 Recover variant and draws `namesFrom`
  first; the order is left as slice 1 settled it.

## Tests edited by design (the PR description names each)

Rows are by test title (line numbers drift). "Retitle" changes only a title that names the password.

**Mechanical classes** (apply wherever they occur; list each file touched in the ledger):

| Class | Old | New | Why |
| --- | --- | --- | --- |
| M1 | a direct `startAgainSummary`/`startAgainFirstSetup` call passes `owner` | drop the `owner` key; **keep** any password step (`recover`/`signIn`) the test runs before it | §3: the actions no longer take an owner; the step's own side effects (sealing a lapsed recovery, rewriting the attempt) stay under test |
| M2 | a record assertion reads `administrator`, `version: 1` | `setupAdministrator`, `confirmedOn: "repair-page"`, `signedIn: false`, `version: 2` | §4, D8 |
| M3 | a summary fixture or expectation carries `held` | the same without `held` | counts leave the wire |
| M4 | a route call sends owner headers to the summary or Start again route | sends none | §3 |

**Server and provisioning:**

| Test | Old | New | Why |
| --- | --- | --- | --- |
| held: "a legitimate held setup database beside a stopped recovery answers the summary with what it holds" | `toEqual` includes `held` | same `toEqual` without `held`; retitle "…answers the summary" | counts gone |
| held: "a held setup database with an invoice record still answers the summary, counting it" | resolves, `held.records` 1 | rejects `setup.start_again_refused` `{ cause: "kept-records" }`, `snapshot` unchanged | D1, §1a |
| held: "a held setup database with no recovery started is still refused setup.not_ready…" and "…still refuses Start again setup.not_ready…" | refused | replaced by Task 4's offered-without-recovery test | §1a row 4 |
| held: "in the held state, a confirmation whose summary has no held counts is refused setup.attempt_conflict…" | conflict | deleted; Task 2's route test refuses a `held` key instead | counts gone |
| held: "in the held state, the Start again route passes the shown held counts on…" | shown carries counts | shown carries none | counts gone |
| route: "HTTPS lets a shown summary carrying held counts past the body check, and refuses a malformed one" | `held` accepted | any `held` key answers 400 `setup.request_invalid`; malformed cases kept for the other keys | counts gone |
| full-disk e2e: "in the held state, with the box's spare file, the summary answers with what the setup database holds…" | counts in summary | no counts; retitle | counts gone |
| provisioning confirmation: "a confirmation that discards a stopped recovery beside a held database keeps what it held", "a held database with an invoice record its module lists as deletable is kept as shown", and the `held` malformed-count `it.each` | `held` stored/validated | deleted; one new case: a `shown.held` key is not stored | counts gone |
| note: "the summary route refuses without the owner headers" | `setup.owner_required` | answers 200 with the summary | §3 |
| note: "with the database present and no password, a damaged kept picks file asks for the password, and nothing changes" | `setup.start_again_password_required` | without `confirmUnreadable` → `setup.attempt_conflict`, nothing changes; retitle | §3 |
| note: "with the database present and the setup password, a damaged kept picks file without confirmUnreadable…", "…gets a summary naming it, and Start again without confirming it…" | with owner | same assertions, no owner; retitle | §3 |
| note: "…the same file times on an intact picks file leave the summary refused and Start again password-free, and the note keeps the name" | summary refused | summary answers with no `unreadable`; Start again goes ahead; note keeps the name | D1 |
| note: "…a damaged kept picks file still needs the recovered owner before the summary answers" | owner required | deleted; Task 3 adds "the summary answers with no owner" | §3 |
| note: "…read only by a module the attempt never froze leaves the summary refused before the password" | refused | the summary answers with no `unreadable`; if the box refuses instead, STOP unless the refusal is a §1a row | D1 |
| note: "the password-required refusal answers 403 over HTTPS" | 403 | deleted with the code; Task 3 adds "Start again over HTTPS with no owner headers starts again" | §3 |
| note: "a damaged record with no owner still refuses for a marker over its limit, before asking for the password…" | same | same assertion; retitle without "before asking for the password" | §3 |
| note: "the Start again route passes recoveryRecordDamagedShown on: with the owner and a damaged record…" | owner headers | none | §3 |
| backup-discard: "with the database present, the password and the confirmed summary discard a stopped recovery, with a record of who chose it" | password step, `administrator` | no password; M2 record; retitle "…with a record of whose setup it was" | §3, §4 |
| backup-discard: "…a stopped recovery's Start again without the setup password is refused setup.start_again_password_required…" | refused | goes ahead; the recovery is discarded; retitle | §3 |
| backup-discard: "with the database present and no recovery, the summary refuses setup.not_ready and confirmRecoveryDiscard is refused…" | summary refused | summary answers with no `recovery`; the `confirmRecoveryDiscard` half unchanged | D1 |
| first-fiscal-hour-finish: "a missing hour database refuses a confirmed Start again from an owner whose latest event is not a fresh recovery" | refused | deleted; replaced by "…a confirmed Start again with no owner goes ahead" | §3 |

**Setup page** — classified from titles only (read, not run). Every row in the right-hand column of
the classes keeps its non-password assertions (enabled/disabled, order, request body, restarting).

| Class | Tests (by title) | Old → New | Why |
| --- | --- | --- | --- |
| P1 retired | `setup-app-resolution.test.ts`: "a damaged recovery-key record asks for the administrator password…", "Cancel at the password step sends nothing and offers Start again again", "Cancel at the password step reached from Start again…", "the password step calls recover, never resume…", "a wrong password there keeps Start again offered…", "the password step draws neither Abandon nor…", "a wrong password at the damaged-record password step…", "Continue at the damaged-record password step with no password…", the `"the password step"`/`"…after a refused send"` table at ~1348-1360, "an abandoned attempt's warning and its password step after a refused send…"; `setup-app-missing-database.test.ts`: "keeps a missing database on repair after password recovery…", "requires password recovery again after a refused retirement…", "shows none of the ask's lines before the password step", "shows the before-password line only before the password step"; `first-setup-retirement.test.ts`: "retires recovered %s work and requires password recovery even after a refresh", "after a sent Start again with the database present, the stopped recovery's summary and another Start again need the password again…" | password step asserted → deleted; Task 7's `setup-app-wipe.test.ts` pins "no password field, no owner header" for each case | §3 |
| P2 password removed from the path | every other test in those three files whose setup types a password to reach Start again's confirmation (titles containing "after the password", "the password, then…", "with the database present and a stopped recovery…", "…damaged…", "…stopped recovery…") | the password step removed from the path; the summary is read on pressing Start again; assertions about lines, order, Cancel, Check again and the request body kept | §3, D9 |
| P3 counts | `setup-app-held-refusals.test.ts` (whole file), `first-setup-retirement.test.ts` "refuses a summary whose held counts changed…" `it.each`, "reads a summary naming what the setup database holds…", "beside a stopped recovery and a setup database holding $name…", "a setup database holding records with no stopped recovery drawn still refuses Start again, even with held counts" | count lines → §9c words from the refusal cause; count-changed cases deleted (the box refuses at the summary now); "no stopped recovery … refuses" → offered | counts gone, §1a row 4 |
| P4 offer gating | "does not offer password-free retirement of a %s database", "a database holding records with no stopped recovery keeps Start again disabled and says why", "saved trading settings … keep Start again disabled", "offers no Start again in the ask while a backup recovery's journal reports %s" | Start again is offered; pressing it draws the box's refusal words (`wipeUnavailable`, `tradingSaved…`) or the ask | D1, D9 |
| P5 moved | the session-method cases of `first-setup-retirement.test.ts` (`missingDatabaseSummary`, `retireMissingDatabase`, `stoppedRecoverySummary`, `damagedRecordSummary`, `retireDamagedRecord`) | moved to `apps/setup/src/start-again-wipe.test.ts` against `readWipeSummary`/`sendWipe`, every "changed between display and confirmation … sends nothing" assertion kept | Task 7 |
| P6 words | slice-1 assertions on `startUnavailable*`, `heldChanged`, `uncheckable`, `tradingSaved` texts | the §9c/§9e words | §9 |

## Review Focus

1. **A full disk or a failed copy beside a database holding an invoice** must refuse
   (`setup.not_ready`), never take the "cannot be read" path and delete it. Pinned in Task 5.
2. **A readable database the inspection labels `unreadable`** (over 128 MiB) must still meet the
   invoice check. Pinned in Task 5 by stubbing the inspection's label over a real held database.
3. **A reader moving `-shm` between the summary and Start again** must not move the §5 floor, or
   every Start again past an unreadable database is refused `attempt_conflict`. Pinned in Tasks 1 and 5.
4. **A leftover `venue.db-journal`** must not survive the wipe beside a later restored database.
   Pinned in Task 1.
5. **A send refused `kept-records` after the page drew a confirmation** must close the confirmation,
   draw `heldChanged`, and offer Start again again (whose summary then draws `keptFault`). Pinned in
   Task 8.

---

### Task 0: Can `<state>/module-evidence/` exist beside a failed setup? (gate — STOP if yes)

**Files:** none committed. Probe: `apps/server/src/zz-a1131bc-2-module-evidence.test.ts`, deleted
before the task ends. Output to `~/waitron-campaign/a1131bc-2-module-evidence/`.

Reading done while planning (not run): the writers are `restoreSecrets`
(`apps/server/src/restore.ts:677-691`, called at `:341` after the database is placed, migrated and
its hooks run; `trading.env` is written last in the same unpack) and the old recovery's
`first-setup-backup-recovery.ts:562`, which writes under `record.target.target.stateDir`.
`recovery-unpack-command.ts` unpacks a recovery bundle, whose files are `RECOVERY_FILES`
(`state-secrets.ts:16-23`: no module evidence). `adopt.ts` writes only `pending-adoption.json` into
the state folder (`:135`), and the staged reset removes databases and three files
(`reset-request.ts:106-109`). The spec's `restore.ts:273-274` is the destination check, not the write.

- [ ] **Step 1: Writers.** Run
  `rg -n "module-evidence" --glob '!*.test.*' --glob '!docs/**' apps packages deploy scripts` and
  `rg -n "restoreSecrets\(|unpackBundleToDir\(" --glob '!*.test.*' apps packages`. Save both outputs.
  **STOP** if a writer into a state folder appears other than the three above.
- [ ] **Step 2: Probe, failing cases written first** (copy them into the output folder's README
  before running):
  - (a) After a real repair-page recovery to "selected" (`selectedRepair()`,
    `apps/server/test/first-setup-backup-resume-fixture.ts`): `<state>/module-evidence` is absent and
    `<state>/first-setup-resolutions/backup-recovery/<id>/target/state/module-evidence` is present.
    Failing case: `<state>/module-evidence` exists → STOP.
  - (b) A box with a restored venue (the spec's probe T2, `~/waitron-campaign/a1131bc-redesign-measure/where-restore-writes.test.ts.txt`)
    whose `trading.env` and `restore-request.json` are then removed by hand, with a
    `module-evidence/fiscal-verifactu/hour-history.json` left in the state folder: a first-setup
    claim (`assertVenueFirstSetupAllowed(venueDir)` and the owner store's claim the probe's T3 uses)
    is refused. Failing case: the claim succeeds → STOP.
  - (b-control): the same with the restored `venue.db` and its side files also removed → the claim
    succeeds. If the control is refused too, (b) proved nothing: fix the probe, do not proceed.
- [ ] **Step 3: Resets.** Run `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/waitron-sh.test.mjs -t "removes the transient volumes"`
  and read `deploy/waitron.sh:741-749`: a plain reset keeps only `tls`, the note, the confirmations,
  the choices and the set-aside folder. STOP if `module-evidence` is kept.
- [ ] **Step 4: Decide.** All three pass → write the finding, the commands and the counts into the
  ledger and carry on. Any STOP → write a worked example (which writer, which sequence of presses,
  which name could be reused) into the ledger, delete the probe, and stop the slice for the owner.
  Name the option that needs no fiscal-module change: refuse the wipe while `<state>/module-evidence`
  exists (one entry in the deletion module's `REFUSED.state` list), against reading it into the floor.
- [ ] **Step 5:** delete the probe; `git status --short` shows nothing.

### Task 1: The file-time floor can count the databases; the wipe deletes journals

**Files:** Modify `packages/provisioning/src/first-setup-start-again-deletion.ts` (`SIDE_FILES` `:36`,
`attemptLastWriteMs` `:333-354`, doc comment from `:333`). Test `packages/provisioning/src/first-setup-start-again-last-write.test.ts`,
`packages/provisioning/src/first-setup-start-again-deletion.test.ts`.

**Interfaces — Produces:** `attemptLastWriteMs(roots, options?: { discarding?: string; held?: true; databases?: true }): Promise<number | null>`.
With `databases`, also counts `venue/venue.db`, `venue/node.db`, `venue.db-wal`, `node.db-wal`,
`venue.db-journal`, `node.db-journal`; never `-shm`. Without it, unchanged.

- [ ] **Step 1: Failing tests** in the last-write test file (stamp every item to T with `utimes`, as
  the file's existing cases do):
  - "with databases, a venue.db written later moves the answer" → T + 1 h.
  - "with databases, a venue.db-wal newer than every other file moves the answer, with venue.db
    itself left older" → T + 1 h (the `-wal` control on its own, spec §5).
  - "with databases, a venue.db-journal written later moves the answer".
  - "with databases, a venue.db-shm written later does not move the answer" → T (D4).
  - "without databases, a venue.db written later still does not move the answer" → T (A1099 unchanged).
  In the deletion test file: "Start again's deletion removes a venue.db-journal and a node.db-journal
  beside the databases" (marker from `startAgainMarkerFor`, then `deleteMarkedAttempt`, both
  journals ENOENT).
- [ ] **Step 2:** run `… pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-last-write.test.ts src/first-setup-start-again-deletion.test.ts`;
  the five `databases`/journal cases fail (`databases` ignored; journal present), the `-shm` and
  "without databases" cases pass.
- [ ] **Step 3: Implement.** Add both journals to `SIDE_FILES`. In `attemptLastWriteMs`, when
  `databases` is set, keep the database `file` items and the `side` items whose name does not end in
  `-shm`, and `lstat` `venue.db-journal`/`node.db-journal` where present. Update the function's doc
  comment to say what each mode counts.
- [ ] **Step 4:** same command, all pass; then the whole package's start-again files:
  `… vitest run src/first-setup-start-again` (prefix match). Typecheck and lint the package.
- [ ] **Step 5:** commit. **Per-task reviewer** (fiscal-adjacent: what moves the floor).

### Task 2: The counts leave the wire; the box refuses kept records at the summary

**Files:** Modify `packages/provisioning/src/first-setup-start-again-confirmation.ts` (drop
`StartAgainHeld`, `HELD_KEYS`, `heldShown`, the `held` member and its line in `confirmation()`),
`packages/provisioning/src/index.ts` (stop exporting `StartAgainHeld`),
`apps/server/src/setup-first-fiscal-api.ts` (`shownSummary` loses the optional `held`; delete
`shownHeld`), `apps/server/src/first-setup-resolution.ts` (delete `heldShown`; the summary throws
`refused("kept-records")` with the D11 reason; Start again's existing kept-records refusal gets the
same reason). Tests: the M3 class and the server/provisioning rows of the table above.

**Consumers traced** (`rg -l "StartAgainHeld|held:|heldShown|shownHeld|readableHeld"` over
`apps packages scripts`, run 2026-10-29): provisioning confirmation + its test; server
resolution, route parser, `first-setup-start-again-held.test.ts`, `first-setup-resolution.route.test.ts`,
`start-again-full-disk.e2e.test.ts`; setup page types, session, `setup-app.ts`, its tests and
`apps/setup/test/held-database-browser.ts`. The setup page keeps its own JSON shapes
(`apps/setup/src/api/client.ts:20`) and is changed in Task 7; until then it still accepts a `held`
the box no longer sends. The fiscal module's `startAgainHoldings` seat still returns its counts
(`packages/fiscal-verifactu/src/start-again-holdings.test.ts`, unchanged); only the wire loses them.

- [ ] **Step 1: Failing tests.** Route test: "a shown summary carrying held counts is refused
  setup.request_invalid" (both the summary-echo fields: `confirmMissingDatabase.shown.held`,
  `confirmRecoveryDiscard.shown.held`). Held test: "a held setup database with an invoice record
  refuses the summary kept-records, and nothing changes" (use the file's `expectRefused` and
  `snapshot`). Held test, route level: "the summary's kept-records refusal logs the counts, not the
  answer": capture `log` given to `mountFirstSetupResolutionApi`; the `warn` line for
  `setup.start_again_refused` has `logReason` matching `/rows=\d+ kept=\d+ records=1 accepted=0/`,
  and the JSON answer is exactly `{ error: { code, params: { cause: "kept-records" } } }`.
  Provisioning: "a shown.held key is not stored in the record".
- [ ] **Step 2:** run the route, held and confirmation test files; the new cases fail.
- [ ] **Step 3: Implement** as listed under Files. Apply the M3 and table edits.
- [ ] **Step 4:** run `src/first-setup-start-again-held.test.ts src/first-setup-resolution.route.test.ts src/start-again-full-disk.e2e.test.ts`
  (server) and `src/first-setup-start-again-confirmation.test.ts` (provisioning); typecheck both
  packages. The full-disk suite needs `hdiutil` on macOS (CLAUDE.md §4); read that it did not skip.
- [ ] **Step 5:** commit.

### Task 3: No password for the wipe; one assessment; records say nobody signed in

**Files:** Modify `apps/server/src/first-setup-resolution.ts` (whole `createFirstSetupResolutionActions`
body), `apps/server/src/setup-first-fiscal-api.ts` (summary route stops calling `firstFiscalOwner`;
Start again route stops passing `owner`; drop the status line `:39`), `apps/server/src/errors.ts`
(retire `setup.start_again_password_required`, `:1041`), `apps/setup/src/setup-app.ts:1479` only to
delete the dead comparison, `packages/provisioning/src/first-setup-start-again-confirmation.ts` (D8
shape, except `"unreadable"`, which is Task 5's). Tests: M1, M2, M4 and the note/backup-discard/
first-fiscal-hour-finish rows.

**Interfaces — Produces:**
- `StartAgainSummaryRequest = { inspectionId: string; revision: number; ownerGeneration: number }`.
- `StartAgainFirstSetupRequest` = today's minus `owner`.
- internal `assessStartAgain(request, kind: "summary" | "start-again")` returning what the summary
  needs (`state`, `found`, `recovery`, `missing`, `held`, `holdings`, `discarding`, `gathered`,
  `box`, `marker`, `recoveryRecordDamaged`) — the checks of today's two bodies merged in Start
  again's order, with the disk check before the holdings read in both (as the summary does today,
  `:474-477`). The summary's `recoveryRecordDamaged` is the same value Start again compares
  (`gathered.recoveryRecordDamaged`, or the unused assignment's on the empty path, `:556-559`), so
  the page can echo it.
- `StartAgainConfirmation` per D8 with `database: "missing" | "present"` for now.

- [ ] **Step 1: Failing tests.**
  - note test: "the summary answers with no owner, for a missing database" (action level, no `owner`).
  - note test: "Start again over HTTPS with no owner headers starts again" (route, TLS socket as the
    file's `postSummary` does; answer `{ restarting: true }`; `expectStartAgainDeleted`).
  - note test: "**a plain-HTTP request to the Start again route is refused, and nothing changes**"
    (`incoming: { socket: new Socket() }`, as "the summary route refuses over plain HTTP" does; answer
    `setup.owner_required`; `attemptFiles(f)` unchanged; no confirmations folder). Then prove it by
    deletion: comment out `assertHttps(c)` at the Start again route, see this test fail, restore.
  - inspection test: "with an empty unused setup, the summary answers, and Start again deletes it
    with no owner" (`actionsFixture`, no `register`).
  - damaged-recovery test: "with an empty database and a damaged recovery-key record, the summary
    carries recoveryRecordDamaged; Start again without the flag is refused setup.attempt_conflict,
    and with it deletes the setup".
  - provisioning: "a record is version 2, names whose setup it was, and says it was confirmed on the
    repair page with nobody signed in" (`Object.keys` order pinned, as the file's existing key test is).
  - errors: `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/errors-reachable.test.ts` is
    green before and after (the code leaves the registry and its only thrower together).
- [ ] **Step 2:** run the five server files and the provisioning file; the new cases fail
  (`owner_required`, `start_again_password_required`, summary `not_ready`).
- [ ] **Step 3: Implement.** Write `assessStartAgain`; delete `assertRecoveredOwner`'s three calls
  and the function; apply D2; delete the `password_required` throw (`:605-612`); keep every other
  refusal, the two "no await" ordering comments' invariants (`:661-663`, `:676-680`) and the
  `markerFor` size check. The record: `setupAdministrator: state.frozen.request.admin`'s
  `{ displayName, email }`, `confirmedOn: "repair-page"`, `signedIn: false`, `version: 2`.
- [ ] **Step 4:** apply M1, M2, M4 and the table rows. Run every server file in the M1 list
  (`first-setup-start-again-note`, `-backup`, `-backup-discard`, `-backup-restart`, `-held`,
  `-damaged-recovery`, `-name-records`, `first-setup-resolution-inspection`, `first-setup-resolution.route`,
  `first-fiscal-hour-finish`, `first-fiscal-hour.e2e`, `first-setup-unused-pdf`,
  `first-setup-retired-assignments`, `first-setup-set-aside-lifetime`, `first-setup-backup-handoff`,
  `start-again-full-disk.e2e`, `spare-space`, `setup-first-fiscal-api.disk-full`,
  `setup-first-backup-api-adapters`, `first-setup-workspace`, `first-setup-recovery-delivery`),
  then `recovery-start-again.test.ts` and `packages/provisioning`'s
  `first-setup-start-again-choose.test.ts` **unedited** (the "files found" page keeps its password).
  Then `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/start-again-note-writers.test.ts`; typecheck server and provisioning.
  Setup-page suites stay green: the page still sends what it sent (Task 7 changes it).
- [ ] **Step 5:** commit. **Per-task reviewer** (the acceptance rule decides what may be deleted).

### Task 4: A database holding rows is offered with or without a stopped recovery; every §1a row

**Files:** Modify `apps/server/src/first-setup-resolution.ts` (`assertHeldStartAgainOffered` drops
the `found?.kind !== "stopped"` condition, `:103`; its doc comment follows). Move `tree`/`snapshot`
from `first-setup-start-again-held.test.ts:69-89` into `apps/server/test/start-again-deleted.ts` as
`diskSnapshot(roots)` and use it from every test below. Tests in `first-setup-start-again-held.test.ts`,
`first-setup-resolution-inspection.test.ts`, `first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing tests (held test file unless named):**
  - "a held setup database with no recovery: the summary answers and Start again deletes it with no
    password; the note covers the attempt's name and a later installation the database holds"
    (`heldSetup({ recovery: false })`, `writeLaterInstallation` as "the note's floor follows a later
    installation…" does; `expectStartAgainDeleted`; note `floorMs` ≥ the later name's minute + 1
    minute, `decodeMinuteIdentity`).
  - **The wipe-then-restore test**: "a held setup database with series names, wiped, then the
    fresh-box restore writes into the usual folders under a name later than every name the database
    held". After the wipe above, stage and run the fresh-box restore as the spec's probe T2/T4 does
    (`restoreApp`, `archiveForm`, `stageRestoreRequest`, `runStagedRestore`, `agreeInternet`,
    `clock` from `hour-recovery-host.ts`) with the clock set to the later name's minute: refused
    `sif.allocation_invalid` `minute_not_later` (as `hour-recovery-host.test.ts` "the start-again
    note" asserts); then the clock past the note: `venue.db` in the usual venue folder, no
    `first-setup-resolutions` folder, `resolveFirstSetupBackupWorkspace` "absent", and every live
    series name's minute later than every name the wiped database held.
    **Control** (same file, `it.fails` is not enough — write it as an ordinary test that asserts the
    reuse): with `raiseStartAgainNote` mocked to a no-op for that case only (`vi.mock` of
    `@waitron/provisioning` with `{ spy: true }` and `mockImplementationOnce`), the restore at the
    later name's minute is ACCEPTED and its series name equals a name the wiped database held.
    Write down, before running, that the main test fails if the note step is missing and the control
    fails if the note step is still in effect.
  - §1a refusal rows, each "refuses …, and deletes nothing" with `diskSnapshot` equal before and
    after, the note unchanged and no confirmations folder:
    trading.env (no recovery) → `start_again_refused` `trading-settings`; complete → `setup-finished`;
    invoice record (no recovery) → `kept-records`; a view-only database → `not_ready` (existing,
    unedited); in the inspection test file: empty database past claimed (`f.store.update(…,
    { kind: "consumption-intent" })` then `activation-started`, or the file's nearest fixture) →
    `not_ready`; `restore-request.json` in state → `not_ready`; an unexpected folder in
    `first-setup-resolutions` → `not_ready`; `first-setup-workspaces` in state →
    `setup.workspace_unsupported`; in the note test file: outside evidence (existing), marker over
    its limit (existing). Each through the SUMMARY as well as Start again.
  - "a deletion already marked: Start again answers setup.start_again_incomplete and the route asks
    for a restart" — existing ("start again is refused while a deletion marker exists…"); add only the
    route's restart assertion if absent.
  - **Cut after the marker**: "a power cut during a held wipe with no recovery: the next start
    finishes the deletion" — `remove` that throws on its second call, as
    "a power cut during the attempt's deletion…" (`first-setup-start-again-backup-restart.test.ts`)
    does; then `finishStartAgainDeletion(f.roots)`; `expectStartAgainDeleted`; note unchanged since
    before the marker.
- [ ] **Step 2:** run the three files; the offered-without-recovery, restore and new refusal-through-
  summary cases fail; the control is expected to fail too until Step 3 (it needs the offered wipe).
- [ ] **Step 3: Implement** the one-line change and its comment.
- [ ] **Step 4:** run the three files plus `hour-recovery-host.test.ts -t "the start-again note"`
  (unedited) and `first-setup-resolution.boot.test.ts`. Read every `Tests` count.
- [ ] **Step 5:** commit. **Per-task reviewer** (§1a and the note).

### Task 5: A setup database the box cannot read (question 2, answer A)

**Files:** Modify `apps/server/src/first-setup-database-holdings.ts` (new export),
`apps/server/src/first-setup-resolution.ts` (`assessStartAgain` branch; `gatherStartAgainFloor`
gains `databaseUnreadable`), `apps/server/src/setup-first-fiscal-api.ts:144` (`UNREADABLE_RECORDS`),
`packages/provisioning/src/first-setup-start-again-confirmation.ts` (`UNREADABLE_RECORDS`, `database:
"unreadable"`). Tests in `first-setup-start-again-held.test.ts` (it has a real activated database to
damage) and the provisioning confirmation test.

**Interfaces — Produces:**
- `readSetupDatabaseHoldingsOrDamage(roots, modules): Promise<SetupDatabaseHoldings | { damaged: string }>`
  — `{ damaged }` only for D3's SQLite damage; every other failure throws `setup.not_ready` as
  `readSetupDatabaseHoldings` does.
- Unreadable record kinds, in this order everywhere: `"setup-database"`, `"series-picks"`,
  `"public-record"`, `"fiscal-documents"`.
- The record: `database: "unreadable"` requires `shown.unreadable.records` to include `"setup-database"`.

Behaviour: when the inspection's `database` is one of D3's four and the holdings read answers
`{ damaged }`: trading.env → `trading-settings`; status `complete` → `setup-finished`; outside
evidence, disk check (with `held: true`), marker size as every row; then
`gatherStartAgainFloor(…, databaseUnreadable = true)` adds `"setup-database"`, reads past a damaged
public record or documents file as the missing path does, and takes the floor from
`attemptLastWriteMs(roots, { ...deletion, databases: true })`; D6 when no frozen module has a seat.
Start again then needs `confirmUnreadable: { shown }` (or `confirmRecoveryDiscard` beside a stopped
recovery, as today) and writes the record with `database: "unreadable"`. If the holdings read
answers holdings instead, the held rules apply.

- [ ] **Step 1: Failing tests.**
  - "a setup database of junk bytes: the summary names it unreadable with a floor; Start again with
    confirmUnreadable deletes it, writes an unreadable record, and the note's floor is no earlier
    than its newest file time plus the margin" (overwrite `venue.db` with random bytes, remove its
    side files; stamp files to T, `venue.db` to T + 10 min).
  - **The two floor controls on their own** (spec §5): (i) `venue.db` stamped later than every other
    file moves `unreadable.floorMs`; (ii) `venue.db-wal` newer than every other file, `venue.db` left
    older, moves it too.
  - "a -shm moved between the summary and Start again leaves the floor as shown, and Start again goes
    ahead" (D4, Review Focus 3).
  - "Start again past an unreadable database without confirmUnreadable is refused attempt_conflict,
    and nothing changes".
  - Review Focus 1: "a corrupt database whose copy fails refuses setup.not_ready and deletes nothing"
    — stub the holdings copy to throw `ENOSPC` (`vi.mock` of `./first-setup-database-holdings.js` is
    already in the file; or the copy helper it calls).
  - Review Focus 2: "a readable held database the inspection labels unreadable still refuses
    kept-records for an invoice record" (`heldSetup({ invoices: 1, recovery: false })`, inspection
    stubbed to `database: "unreadable"` through the host's `inspectFirstSetupResolution`).
  - "saved trading settings beside an unreadable database refuse trading-settings, and nothing
    changes"; "an unreadable database with no frozen seat is refused setup.not_ready" (D6).
  - Provisioning: an `"unreadable"` record without `"setup-database"` is refused `setup.attempt_invalid`.
  - Route: `confirmUnreadable.shown.unreadable.records` `["setup-database", "series-picks"]` passes
    the parser; `["series-picks", "setup-database"]` is refused (order).
- [ ] **Step 2:** run the held and route files and the provisioning confirmation test; the new cases
  fail (`setup.not_ready` today, review R2).
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4:** run the held, note, route and inspection files and the whole provisioning
  start-again set; typecheck both packages; `scripts/start-again-note-writers.test.ts` unedited.
- [ ] **Step 5:** commit. **Per-task reviewer** (Q2 A: what may be deleted unread, and its floor).

### Task 6: Server checkpoint

- [ ] Run, from the worktree root, the server's start-again and first-setup suites in one go
  (`… pnpm --filter @waitron/server exec vitest run src/first-setup src/start-again src/recovery-start-again src/first-fiscal-hour src/hour-recovery-host`)
  after checking memory, and `packages/provisioning`'s `test:coverage` (coverage `98/98/98/95`;
  read the per-file table for `first-setup-start-again-deletion.ts` and `-confirmation.ts`). Fix only
  coverage gaps in code this branch changed. Ledger: counts and anything red.

### Task 7: The page: one Start again flow, no password, the box's words

**Files:** Create `apps/setup/src/start-again-wipe.ts` and `apps/setup/src/start-again-wipe.test.ts`,
`apps/setup/src/setup-app-wipe.test.ts`. Modify `apps/setup/src/api/client.ts` (`:641-673`),
`apps/setup/src/api/first-setup-types.ts` (`:140-155`), `apps/setup/src/first-setup-session.ts`
(delete `HELD_KEYS`, `readableHeld`, `sameHeld`, `heldStartAgainDatabase`, `summaryOf`,
`sameSummary`, `readable*` and the five Start again methods and their owner helpers `:679-839`; keep
`startAgainRefusalCause` or move it), `apps/setup/src/setup-app.ts`,
`apps/setup/src/screens/initial-owner-strings.ts`.

**Interfaces — Produces:**
- `api.startAgainSummary(snapshot): Promise<StartAgainSummary>` — no owner headers.
- `api.startAgainFirstSetup(snapshot, confirm?: StartAgainConfirm): Promise<{ restarting: true }>`,
  `StartAgainConfirm = { confirmMissingDatabase?; recoveryRecordDamagedShown?: true; confirmRecoveryDiscard?; confirmUnreadable? }` — no owner headers.
- `readWipeSummary(api, snapshot): Promise<StartAgainSummary>` — validates the shape (today's
  `summaryOf` without `held`, with `"setup-database"`).
- `sendWipe(api, snapshot, database: FirstSetupInspection["database"], shown): Promise<{ restarting: true }>`
  — reads the summary again; not the same as `shown` → `{ code: "setup.attempt_conflict" }` and
  sends nothing; else sends: missing → `confirmMissingDatabase: { nothingFiledOrSold: true, shown }`;
  present with `shown.recovery` → `confirmRecoveryDiscard: { shown }`; present with
  `shown.unreadable` and no recovery → `confirmUnreadable: { shown }`; `shown.recoveryRecordDamaged`
  → `recoveryRecordDamagedShown: true`.
- `wipeRefusal(error): "setup-finished" | "trading-settings" | "kept-records" | "unavailable" | undefined`
  (`setup.not_ready` → `"unavailable"`).

Page flow (`setup-app.ts`): Start again is enabled whenever the inspection has a non-null `revision`
and `ownerGeneration`, nothing is running, no refusal is drawn and the page is not busy — whatever
the password's state. Pressing it runs one `#openWipeConfirmation()`: inspect; with the database
missing also read the backup status as `#readMissingAsk` does (`:1376-1393`, no session), otherwise
read the activity (running → back to the repair page, as today); then `readWipeSummary`. An answer
draws the confirmation (missing: the ask lines and the stopped block from the summary, then the
existing confirmation); a refusal sets the drawn refusal (`wipeRefusal`) and hides Start again; a
failed read keeps today's "unread" state and Check again. Confirm calls `sendWipe`; a send refused
`kept-records` closes the confirmation, draws `heldChanged`, and offers Start again again; any other
refusal draws its words and closes the confirmation. Delete the password states
(`firstDamagedRecord` "password", `#damagedInferred`, `#seriesPicksUnreadable`,
`#unlockDamagedRecordStartAgain`, `firstStoppedSummary`/`firstDamagedSummary`/`firstMissingSummary`
merged into one `firstWipeSummary`). Words: the refusal causes draw `setupFinished`,
`tradingSaved` (+ `tradingSavedPassword` when the password is checkable, D7), `keptFault`,
`wipeUnavailable`; `"setup-database"` draws `setupDatabaseUnreadable` (D12); `noInvoiceFound`
becomes `!missing && !(summary.unreadable?.records.includes("setup-database") ?? false)` — the box
answers a present, readable database only after finding no invoice record. Continue's password form
is not drawn with the database missing (D10), and `#resumeFirstSetup`'s missing branch goes.

- [ ] **Step 1: Failing tests.** `start-again-wipe.test.ts`: the P5 cases ported to
  `readWipeSummary`/`sendWipe` (each "changed between display and confirmation … sends nothing"
  case kept: names floor, damaged records, recovery, reached, lastName); plus "a summary carrying
  held is refused as unreadable" and "no request carries X-Waitron-Setup-Owner". `setup-app-wipe.test.ts`
  (`it.each` over EN and ES where words are asserted): for each case — empty unused, held with no
  recovery, held beside a stopped recovery, damaged picks, damaged recovery-key record, missing
  database, unreadable database — pressing Start again draws no password field
  (`data-test="resume-password"` absent inside the confirmation), reads the summary with no owner
  header, and Confirm sends exactly the fields `sendWipe` names; each refusal cause draws its §9c
  words and no Start again; a send refused `kept-records` draws `heldChanged` and offers Start again;
  with the password uncheckable, Start again is offered and `uncheckable` reads the new words;
  `tradingSaved` alone when the password is uncheckable (D7). Strings test in
  `setup-app-resolution.test.ts` "Start again's confirmation words are the design's…" extended with
  every Global Constraints literal and `Object.hasOwn(..., key) === false` for every removed key.
- [ ] **Step 2:** run the three files; the new cases fail.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4:** run the three files; `pnpm --filter @waitron/setup typecheck` and `lint` clean.
  **Red until Tasks 8–9, by design:** `setup-app-resolution.test.ts`, `setup-app-missing-database.test.ts`,
  `setup-app-held-refusals.test.ts`, `first-setup-retirement.test.ts`, and the three a11y files —
  record each failing title in the ledger against its class (P1–P6). A failing title in any other
  file is a STOP.
- [ ] **Step 5:** commit. **Per-task reviewer** (the page now sends what deletes a setup).

### Task 8: Page suites, part 1 — present database and refusals

**Files:** `apps/setup/src/setup-app-resolution.test.ts`, `setup-app-held-refusals.test.ts`,
`setup-app-resolution.a11y.test.ts`, `setup-app-held-database.a11y.test.ts`,
`first-setup-retirement.test.ts`, `apps/setup/test/held-database-browser.ts`.

- [ ] **Step 1:** Review Focus 5 test first, in `setup-app-held-refusals.test.ts`: "a send refused
  kept-records after the confirmation closes it, says the setup changed, and Start again then draws
  the fault" (EN and ES). Run it; it fails only if Task 7 missed it — then fix the code, not the test.
- [ ] **Step 2:** apply the P1–P4, P6 edits to these files; delete what P5 moved. Keep every
  non-password assertion. Add the a11y states the new screens need in `setup-app-held-database.a11y.test.ts`'s
  loop: `"refused-fault"` (summary refused kept-records) and `"unreadable"` (summary naming
  `setup-database`), both themes, 390 and 1280 px, axe plus the existing `scrollWidth` check, each
  with the guarded screenshot `if (import.meta.env.VITE_A1131BC_HELD_LOOK === "1") await page.screenshot(...)`
  slice 1 added.
- [ ] **Step 3:** run the six files; all green; read counts. Commit, naming each P-class edit.

### Task 9: Page suites, part 2 — missing database

**Files:** `apps/setup/src/setup-app-missing-database.test.ts`, `setup-app-missing-database.a11y.test.ts`,
`apps/setup/test/missing-database-browser.ts`.

- [ ] **Step 1:** a test first: "with the database missing, the page offers Start again and no
  Continue; pressing it draws what the setup reached and the missing-database tick, with no password"
  (EN, ES). It passes if Task 7 is right; if it fails, fix the code.
- [ ] **Step 2:** apply P1, P2, P4 edits; keep the stopped-recovery, uncertain-journal, running and
  Check again assertions — their reads now happen on pressing Start again.
- [ ] **Step 3:** run both files, then every `apps/setup` suite that names `start-again`, `held`,
  `missing`, `resolution`, `retirement` or `wipe` in one run (memory checked); all green.
  `pnpm --filter @waitron/setup typecheck`. Commit.

### Task 10: Docs that would otherwise be false

**Files:** `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`,
`docs/operations/first-live-fiscal-setup.md`, `deploy/README.md`, `deploy/waitron.sh` (comment
`:742-745`), `apps/server/README.md`, `docs/backlog/setup.md`, `docs/backlog.md`.

Find every sentence again with
`rg -n -i "start again.{0,160}password|password.{0,160}start again|who confirmed|what the (repair )?page showed|after you enter(ed)? the (administrator )?password|password step|saved items|cuántos|introduzcas la contraseña|introdujeras la contraseña" apps/server/src/guide docs/operations deploy apps/server/README.md docs/backlog/setup.md`.
Hits on 2026-10-29: EN guide `:29-31`, `:32-33`, `:37`, `:45-47`, `:50`; ES guide `:31`, `:34`, `:40`,
`:48`, `:50`, `:53`; runbook `:97-98`, `:102`, `:106`, `:116-118`, `:131-135`, `:150-156`;
`deploy/README.md:395-398`; `deploy/waitron.sh:744`; `apps/server/README.md:58-61`;
`docs/backlog/setup.md:651` (the full-disk entry's "password step" is now the summary read).
`docs/operations/a679-changed-checks.md:1838` is a dated historical record: leave it.

After the edit, each must say: Start again asks for no password, and anyone who can open the repair
page can use it (§3's cost, once, in the guide); the box refuses beside saved selling settings, a
finished setup, or a database holding an invoice or another record Waitron never deletes, in §9c's
words; a setup database the box cannot read is deleted with the safety margin, and new series names
start no earlier than a margin after the setup last saved anything — not "after you entered the
password" (read the seat's margin in `packages/fiscal-verifactu/src/initial-hour-setup.ts:142-200`
before writing any number; the old "two and a half to three and a half minutes after you entered
the password" came from the password step rewriting files and is retired); the records say whose
setup it was, that it was confirmed on the repair page with nobody signed in, when, and the
summary the box gave the page (what the setup reached, its last series name, any stopped recovery
or damaged records) — not "who confirmed" and not "what the page showed"; the "files found" page
still asks for the administrator password. EN and ES say the same; headings and `{#id}`s untouched.
`docs/backlog.md`'s A1131c entry: slice 2 = this branch; drop "until slice 2 removes them"; slices 3–4
still to come.

- [ ] **Step 1:** edit; `pnpm exec prettier --write` on the two guide files and the root
  `apps/server/README.md`; `docs/` is Prettier-ignored, so READ the runbook paragraphs `:80-170`
  whole after editing (CLAUDE.md §1: a behaviour change retires every receipt).
- [ ] **Step 2:** re-run the search; expect only the "files found" page's password and Continue's.
- [ ] **Step 3:** `… pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-backup-recovery.test.ts src/guide-pages.test.ts`,
  `… pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts scripts/waitron-sh.test.mjs`,
  `pnpm format:check`. Commit.

### Task 11: Look check (pictures 3 and 4)

- [ ] Check memory. Run
  `env -u AI_AGENT -u CLAUDECODE VITE_A1131BC_HELD_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-held-database.a11y.test.ts`
  and `VITE_A679_RESOLUTION_LOOK=1 … src/setup-app-resolution.a11y.test.ts -t confirmation`. Copy the
  new `__screenshots__` PNGs (`find apps/setup -path '*__screenshots__*' -newer apps/setup/src/setup-app.ts -name '*.png'`)
  to `~/waitron-campaign/a1131bc-2-shots/`. Open, for `refused-fault` and `unreadable`: EN and ES ×
  light and dark at 390 px, and EN light at 1280 px; plus one empty-unused confirmation. Passes when:
  `keptFault` shows with no count and no Start again (Recover from backup may still show — D9);
  `setupDatabaseUnreadable`, `heldLost` alone, the help line and `namesFrom` with a date and time
  appear; nothing overflows the card at 390 px; dark text is legible; no password field anywhere on
  these screens. Compare with `docs/backlog/mockups/a1131bc-restore/3-refused-fault*.png` and
  `4-unreadable-setup*.png` (picture 4's buttons and tick are slice 3's). Write what was opened and
  seen into the ledger for the PR description. Never commit a shot.

### Task 12: Final checks

- [ ] `git diff --stat bff4a7809 -- packages/fiscal-verifactu packages/migrations '**/migrations/**'` prints nothing.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`, both unedited, both green
  (read the counts).
- [ ] Root guards: `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/start-again-note-writers.test.ts`, `scripts/english-only.test.ts`,
  `scripts/guide-links.test.ts`, `scripts/alert-codes.test.ts` (no incident code added; run to
  confirm), `scripts/claude-md-pointers.test.ts` only if `CLAUDE.md` changed.
- [ ] Typecheck and lint `@waitron/provisioning`, `@waitron/server`, `@waitron/setup`;
  `pnpm format:check`.
- [ ] Ledger `Status: done` for the build; tell the lead it is ready for `/finish-branch` with this
  plan, D4/D5/D9 and the edited-test table for the PR description.

## Self-review notes

- Spec coverage: §3 → Task 3; §1a rows → Task 4 (+ Task 5's row); §4 → Tasks 3 and 5; §5 and Q2 A
  → Tasks 1 and 5; §2's check → Task 0; §9c–§9e → Task 7; counts off the wire → Tasks 2 and 7;
  `first-setup-retirement.test.ts:249-264` → P3/P5; docs → Task 10; tests listed in "Slices" item 2
  → Task 4 (wipe then restore with its control; refusals delete nothing; cut after the marker),
  Task 3 (plain HTTP), Tasks 1 and 5 (the two floor controls, the `-wal` one on its own).
- Not in this slice: Recover from backup as the wipe and its confirmation (§9b), "Join or recover"
  after the restart, removing the old recovery code (slices 3 and 4).
