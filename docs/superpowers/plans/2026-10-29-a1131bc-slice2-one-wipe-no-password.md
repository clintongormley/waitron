# A1131b/c slice 2: one wipe, no password — Implementation Plan

**Resume:** start at **Task 0** (nothing built yet). Task 0 is a gate: if it finds a path that leaves
`<state>/module-evidence/` beside a later failed setup, the build stops before Task 1 and lane A
relays owner question OQ1 below.

> **For agentic workers:** this plan is built INLINE by the lead session (owner's instruction for
> this slice), on the FULL review path: a fresh per-task reviewer after Tasks 1, 3a, 4, 5, 7a and 7b
> (the ones that decide what enters the never-reuse note, what may be deleted, or change the
> cross-package contract), then `/finish-branch`. Use superpowers:executing-plans. Steps use
> checkbox (`- [ ]`) syntax. Each task is sized well under 60 tool calls; stop at the end of each
> task, update the ledger, and checkpoint.

**Goal:** Start again deletes a failed setup with no setup password; the box itself decides every
refusal and says it in the design's words; a setup database the box cannot read can be deleted with
a safety margin no earlier than the setup's last saved write; the item counts no longer travel
between the page and the box; the confirmation records say whose setup it was and that nobody signed
in.

**Architecture:** Server first (provisioning helpers, then the two Start again actions merged around
one assessment both call, then the routes), then the setup page (a session-free wipe helper and one
Start again flow for every case), then the docs. The "files found" page (A1098), Continue and the
fresh-box restore are not changed. Nothing in `packages/fiscal-verifactu`; no migration.

**Tech Stack:** TypeScript, Hono routes, `node:sqlite`, Vitest 4 (node for `apps/server` and
`packages/provisioning`; real headless Chromium for `apps/setup`), Lit.

**Spec:** `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` — read the
whole of it; §1a, §3, §4, §5, §9c–§9e and "Slices" item 2 are this plan's scope. Slice 1's plan
(`docs/superpowers/plans/2026-10-29-a1131bc-slice1-start-again-words.md`, landed as #2230) left the
counts on the wire and the refusal block drawing them; this slice removes both. Plan review folded:
`~/waitron-campaign/item-a1131bc-2-plan-review.md` (0 critical, 7 important, 9 minor).

**Worktree / branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131bc-2-one-wipe-no-password`,
`feat/a1131bc-2-one-wipe-no-password`, off main `bff4a7809`. Ledger:
`docs/handoffs/2026-10-29-a1131bc-slice2.md` (gitignored), updated at the end of every task with
the task's commit, the `Tests` counts read, and every test edited by design (old → new).

## Owner questions

- **OQ1 — only if Task 0 stops** (the review expects it to, through `rejoin`). Draft for lane A,
  with the worked example Task 0 confirms:
  > A box restored from a backup keeps a copy of that backup's record of invoice series names in its
  > settings folder. If that box is later rejoined to another box as its standby (`waitron rejoin`),
  > the rejoin deletes its databases and its selling settings and the box goes back to first setup —
  > but that copy stays. Example: Marta's old box was restored from a backup in March, rejoined in
  > May, then set up again; the setup stopped part way and she presses Start again. Start again
  > records the failed setup's series names so they are never used again, but not the names in that
  > copy, and a later restore replaces the copy with the backup's own. **A (recommended):** Start
  > again and Recover from backup are refused while that copy is there (no change to the fiscal
  > rules); the way out is a reinstall, which deletes the copy too. **B:** the box also reads that
  > copy into the safety margin; this changes the fiscal module's rule, so it needs its own review.
  > **C:** do nothing: new names are taken from the clock's current minute, which is later than any
  > name in the copy unless the clock was wrong.
- **OQ2 — answer before the PR lands, not before the build** (review I1; a correction of the
  coordinator's "so nothing filed or sold can ever be wiped"). With question 2's answer A, the box
  deletes a setup database it cannot read. Task 5 refuses whenever any part it CAN read shows an
  invoice record or a record Waitron never deletes. But when the damaged part is itself the table
  that holds invoices, or the file's header (so the box cannot even list its tables), the box
  cannot see whether an invoice is there. Example: a power cut corrupts the page of the setup
  database that holds invoice records; every other table reads as empty; the box offers the delete
  with the margin. **A (recommended, what Task 5 builds, and what Q2 A's example already implies):**
  delete with the margin, and the guide says the box could not check that database for invoices.
  **B:** refuse unless the damage is confined to tables Start again deletes anyway; then a database
  damaged in its header is refused too, which is answer C of Q2 for the commonest damage. Switching
  to B is one condition in `readSetupDatabaseHoldingsOrDamage` plus its tests.

## Global Constraints

- **Fiscal-adjacent.** No file in `packages/fiscal-verifactu` changes (the only possible exception
  is OQ1's B, which goes to the owner first). No change to `computeHuella`, the chain, numbering,
  `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal`. No migration. These must
  pass UNEDITED in Task 12:
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
  - `tradingSavedPassword` EN `To finish it, continue with your setup password.` ES `Para terminarla, continúa con tu contraseña de configuración.` (D7)
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
  kept-records log reason are numbers only; the record keeps `displayName` and `email` (both
  listed). A `{ damaged }` reason carries an error code only, never SQLite's message, which can name
  a table.

## Current behaviour (read on bff4a7809, not run, unless marked)

The spec's line numbers were re-checked; they still hold except where noted.

- **Password steps that guard the wipe**: `first-setup-resolution.ts:468` (summary always needs a
  recovered owner), `:562` (held), `:577` (any request with an owner), `:605-612` (throws
  `setup.start_again_password_required` for a damaged recovery-key record, a stopped recovery or
  damaged picks without an owner). The summary route reads the owner headers and refuses without
  them (`setup-first-fiscal-api.ts:1043`, `firstFiscalOwner`); the Start again route passes them on
  when present (`:1110-1112`). The password step also ran marker repair and the audit reconcile
  (`first-setup-owner.ts:250-283`) and refused a setup whose publication completed (`:212`); Start
  again's own `complete` checks already cover the last (review answer 1).
- **Without an owner, Start again today** accepts only an unused assignment, or an empty unused
  workspace (`:568-575`). **With an owner** it accepts what the no-owner branch accepts plus a
  missing database and an empty workspace answered `current-master` (`:576-581`). Every refusal of
  the owner branch other than `assertRecoveredOwner` is about the setup, not the person.
- **The held state** (`:95-109`) is offered only beside a stopped recovery (`found?.kind !==
  "stopped"` → `setup.not_ready`, `:103`), and `assertHeldStartAgainOffered` refuses any database
  the inspection did not label `occupied` or `no-venue-rows` before anything reads it (`:467`,
  `:534`). So a database the inspection calls `unreadable`, `corrupt`, `partial` or `unknown` is
  refused there (review R2).
- **The summary is narrower than Start again**: with the database present and no recovery it answers
  only when the series picks are damaged (`:451-460`, `:491`); the empty unused setup is sent
  straight to Start again by the page with no summary (`apps/setup/src/setup-app.ts:1461`). The
  summary route does not ask for a restart on `setup.start_again_incomplete`; the Start again route
  does (`setup-first-fiscal-api.ts:1115-1119`).
- **Counts on the wire**: `heldShown` (`first-setup-resolution.ts:110-117`), the route parser
  `shownHeld` (`setup-first-fiscal-api.ts:129-145`), the deep-equal check (`first-setup-resolution.ts:636-654`),
  the record's `heldShown` (`packages/provisioning/src/first-setup-start-again-confirmation.ts:133-154`),
  the page session's `readableHeld`/`sameHeld` (`apps/setup/src/first-setup-session.ts:107-124`, `:183`),
  the page types (`apps/setup/src/api/first-setup-types.ts:140-147`), and the refusal block
  `heldRefused` (`setup-app.ts:2639-2654`, chosen at `:2697`).
- **The holdings read** (`apps/server/src/first-setup-database-holdings.ts:100-158`) counts every
  table's rows first (`count(*)` per table, kept rows for append-only tables not on any module's
  deletable list), then calls each module's `startAgainHoldings` (invoice records) and
  `startAgainHistory`. Any throw in that sequence lands in one `catch` (`:82-86`) that discards
  what was counted and answers `setup.not_ready`; the same `catch` takes a failed copy, a full disk
  and a failed journal check (`:53-80`).
- **The error boundary logs** every `AppError` at `warn` with its params and its log-only `reason`
  as `logReason` (`packages/server-kit/src/error-boundary.ts:38-52`, read).
- **The confirmation record** (`first-setup-start-again-confirmation.ts:47-55`, written at
  `first-setup-resolution.ts:664-674`) holds `administrator: { displayName, email }`. It is written
  only after the password was checked (review R5). No code reads a record back: `rg
  START_AGAIN_CONFIRMATIONS_DIR` finds only its writer, `deploy/waitron.sh:749` and
  `scripts/start-again-note-writers.test.ts:37` (run 2026-10-29). One test writes a record directly:
  `packages/provisioning/src/first-setup-start-again-choose.test.ts:629-634`.
- **The A1099 file-time floor** (`attemptLastWriteMs`, `packages/provisioning/src/first-setup-start-again-deletion.ts:333-354`)
  skips `venue.db`, `node.db` and every side file on purpose: the inspection's read-only open moves
  `venue.db-shm`, and a floor that moved between the summary and Start again would fail the
  deep-equal check (A1099 plan G5, `git show 52bfd6f65`). The margin is "the first whole minute more
  than 150 seconds after the newest modification time" (`docs/developers/conventions-data.md:5086-5091`).
  The review's scratch runs (E1, E2) found: a save moves `-wal` (or `venue.db` on checkpoint),
  never `-shm` alone; the box's FIRST read-only open of a closed WAL-mode database creates an empty
  `-wal` stamped at that read; later reads move only `-shm`. The deletion list's side files are
  `-wal` and `-shm` only (`:36`); a `-journal` is neither counted nor deleted. The holdings reader
  expects a leftover `venue.db-journal` and rolls a copy back (`first-setup-database-holdings.ts:53-80`).
- **The inspection calls a readable database `unreadable`** when it is over 128 MiB
  (`packages/provisioning/src/first-setup-resolution-inspection.ts:56`, limit set at `:257`), calls
  one `partial` on "no such table", and `corrupt` only for SQLite errcode 11 or 26 (`:98-107`).
- **The floor-gathering early return**: `gatherStartAgainFloor` returns `{ floor: recoveryFloor,
  known: null }` with no `unreadable` when the attempt froze no modules (`first-setup-resolution.ts:151-152`),
  and a frozen module with no `startAgainFloor` seat is skipped (`:165-166`). Only
  `fiscal-verifactu` has the seat; `fiscal-none` declares no provisioning seat
  (`packages/fiscal-none/src/slot.ts:14-17`: "a no-regime node has no SIF, installation number or
  hash chain"). The missing-database path in that situation goes ahead with no note.
- **The page**: Start again is enabled only for an empty database or a stopped recovery beside a held
  one, and only when the password is checkable (`setup-app.ts:2572-2581`); pressing it beside a
  stopped recovery or a damaged record opens the password step (`:2605-2615`, `:1474-1494`,
  `#unlockDamagedRecordStartAgain` `:1521-1544`); with the database missing the whole ask appears
  only after Continue's password (`#resumeFirstSetup` `:1313-1343`). The backup status and activity
  reads send no owner (`apps/setup/src/api/client.ts:284`, `:332`).

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
- **D3 — "Cannot be read" (review I1, I2).** Where it sits: in `assessStartAgain`, **before**
  `assertHeldStartAgainOffered`, a branch taken when the inspection's `database` is `unreadable`,
  `corrupt` or `unknown` (not `partial`: a missing table is a part-migrated database, not damage; it
  stays refused at `assertHeldStartAgainOffered`, `setup.not_ready`). The branch checks trading.env,
  `complete`, outside evidence and the disk (with `held: true`), then calls
  `readSetupDatabaseHoldingsOrDamage`, which reads table by table and keeps what it counted:
  - any table it could read shows kept rows, or any module's `startAgainHoldings` it could run shows
    records → `setup.start_again_refused` `kept-records` (D11 reason), whatever else is damaged;
  - otherwise, a failure with SQLite primary errcode 11 or 26 (anywhere: schema read, a table count,
    a module reader) → `{ damaged: <code> }` and the §5 path;
  - otherwise, the database was readable after all (a mislabelled one, e.g. over 128 MiB) →
    `setup.not_ready` (`wipeUnavailable`). Conservative: offering a mislabelled readable database
    would be a new §1a behaviour.
  - Any operational failure (a failed copy, a full disk, a failed journal check, I/O) → `setup.not_ready`
    as today. Otherwise a full disk would turn a database holding invoices into "cannot be read".
  The residual — damage inside the very table that holds invoices, or in the header — is OQ2.
- **D4 — The §5 floor counts `venue.db`, `node.db`, `-wal` and `-journal`, not `-shm`.** The spec
  lists `-shm`; it holds no committed data and every reader moves it (review E1, E2), so counting it
  would make every Start again past an unreadable database fail its deep-equal check. The owner's
  words were "when that setup last saved anything"; `-shm` is not a save. Because the box's first
  read creates an empty `-wal` at that moment (E2), the floor is **no earlier than** the setup's last
  save — sometimes the time of the box's first read, which is later and so safe, and does not move
  after. Docs say "no earlier than". A control pins `-shm`. Stated in the PR description.
- **D5 — The wipe also deletes `venue.db-journal` and `node.db-journal`** (added to the deletion
  list's side files, which are deleted without comparison against the marker, deletion module
  `:541`). A hot journal left beside the venue database a later restore writes could be rolled into
  it. The spec counts `-journal` for the floor but does not name its deletion. Stated in the PR.
- **D6 — An unreadable database with no floor seat (review I3, minor 4).** Rule: the database is
  offered, as the missing database is in the same situation today, with `unreadable.records`
  including `"setup-database"` and `unreadable.floorMs: null`, and no note is raised for it. Why
  this is consistent with Q2 A: the owner's margin exists "so no series name it may have used is
  reused"; a setup whose frozen modules have no floor seat (today `fiscal-none`, which "has no SIF,
  installation number or hash chain") chose no series name the margin guards, so there is no margin
  to take. Refusing it would be Q2's answer C, which the owner rejected. The check runs **before**
  `gatherStartAgainFloor`'s early return, and `floorMs` is set only from a seat's own floor over the
  file times — never from `recoveryFloor`, which still raises the note separately as today. With a
  seat that answers no floor from the file times, the database is refused `setup.not_ready`.
  Consequence: `StartAgainUnreadable.floorMs` becomes `number | null` (null only alongside
  `"setup-database"`), in the three parsers and the page (no `namesFrom` line when null).
- **D7 — `tradingSaved` is split** so the page draws "To finish it, continue with your setup
  password." (`tradingSavedPassword`) only when the password is checkable, as today
  (`setup-app.ts:2560-2563`); with both drawn the text is exactly §9c's. Spec §9e says
  `tradingSavedPassword` "stays": the key stays, its text changes to carry §9c's second sentence;
  the old text was only ever drawn beside `tradingSaved` (`:2562`). Stated in the PR.
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
  summary's refusal and on Start again's; for D3's partial read it adds `damaged=<code>`.
- **D12 — The unreadable-database line** goes where the damaged-record lines go, above
  `start-again-deletes`, which then shows `heldLost` alone; the help line and `namesFrom` keep their
  slice-1 order (help, then names). Picture 4 is the slice-3 Recover variant and draws `namesFrom`
  first; the order is left as slice 1 settled it.
- **D13 — A held database with no stopped recovery is wiped without an echo or a record** (review
  minor 1). The page sends no `confirm*` field, so nothing compares what it showed, and §4 lists no
  record for it. What still guards it: the box refuses kept rows and invoice records at the send
  (`first-setup-resolution.ts:567`) and at the summary (Task 2). Not adding a record: §4's list of
  record cases is the approved design, and a fifth case is the owner's to widen. Stated in the PR.
- **D14 — The summary route asks for a restart on `setup.start_again_incomplete`** as the Start
  again route does (review minor 2): under D1 the page reads the summary first, so a pending marker
  would otherwise leave the page stuck until the box restarts.
- **D15 — Plain HTTP keeps answering `setup.owner_required`** (review minor 3). Renaming the code is
  out of scope; `wipeRefusal` returns `undefined` for it, and the page draws today's
  `shell.first_setup.owner_required` message through `#describeRepairError`. Pinned in Task 7b.
- **D16 — What anyone on the network can now read** (review minor 9): the summary answers without
  a password, so it shows anyone who can open the page the setup's last series name, what it
  reached and any stopped recovery's times; it loses the password step's request throttle, while
  each summary of a held database may copy the database. Added to the spec's §3 cost list, the guide
  and the PR (Task 10).

## Tests edited by design (the PR description names each)

Rows are by test title (line numbers drift). "Retitle" changes only a title that names the password.

**Classes** (apply wherever they occur; list each file touched in the ledger):

| Class | Old | New | Why |
| --- | --- | --- | --- |
| M1 | a direct `startAgainSummary`/`startAgainFirstSetup` call passes `owner` | drop the `owner` key; **keep** any password step (`recover`/`signIn`) the test runs before it | §3: the actions no longer take an owner; the step's own side effects (sealing a lapsed recovery, rewriting the attempt) stay under test |
| M1-twin | a test kept under M1 asserts a floor, a margin or a note | unchanged, **plus** one twin case with no password step asserting the note's floor is the first whole minute more than 150 s after the newest counted file time | review I5: the password step rewrote `first-setup.json` and so raised the floor to "when the password was entered"; the page never runs it now. Files: `first-setup-start-again-note.test.ts` (damaged-picks and missing-database floor cases, e.g. "after a Start again past a damaged picks file, a clock a minute before the time floor waits…"), `first-setup-start-again-backup-discard.test.ts` ("…discard past a damaged picks file shows it…", "…keeps the unreadable records…", "…a stopped recovery's later floor wins…"), `first-setup-unused-pdf.test.ts` floor cases. The PR says the password-time floor is retired |
| M2 | a record assertion or fixture reads `administrator`, `version: 1` | `setupAdministrator`, `confirmedOn: "repair-page"`, `signedIn: false`, `version: 2` | §4, D8 |
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
| provisioning choose: "Move then finishes Start again: … A1042's confirmation records are byte-identical" (`:629-634` fixture) | writes `administrator`, no version | M2 on the fixture only; every assertion unedited | D8 (review I6) |
| note: "the summary route refuses without the owner headers" | `setup.owner_required` | answers 200 with the summary | §3 |
| note: "with the database present and no password, a damaged kept picks file asks for the password, and nothing changes" | `setup.start_again_password_required` | without `confirmUnreadable` → `setup.attempt_conflict`, nothing changes; retitle | §3 |
| note: "with the database present and the setup password, a damaged kept picks file without confirmUnreadable…", "…gets a summary naming it, and Start again without confirming it…" | with owner | same assertions, no owner; retitle | §3 |
| note: "…the same file times on an intact picks file leave the summary refused and Start again password-free, and the note keeps the name" | summary refused | summary answers with no `unreadable`; Start again goes ahead; note keeps the name | D1 |
| note: "…a damaged kept picks file still needs the recovered owner before the summary answers" | owner required | deleted; Task 3a adds "the summary answers with no owner" | §3 |
| note: "…read only by a module the attempt never froze leaves the summary refused before the password" | refused | the summary answers with no `unreadable`; if the box refuses instead, STOP unless the refusal is a §1a row | D1 |
| note: "the password-required refusal answers 403 over HTTPS" | 403 | deleted with the code; Task 3a adds "Start again over HTTPS with no owner headers starts again" | §3 |
| note: "a damaged record with no owner still refuses for a marker over its limit, before asking for the password…" | same | same assertion; retitle without "before asking for the password" | §3 |
| note: "the Start again route passes recoveryRecordDamagedShown on: with the owner and a damaged record…" | owner headers | none | §3 |
| unused-pdf: "a damaged recovery-key record (%s) asks for the setup password instead of starting again without one, and nothing changes" (`it.each` manifest/binding) | `setup.start_again_password_required` | without `recoveryRecordDamagedShown` → `setup.attempt_conflict`, nothing changes; with it → deletes, and the note keeps the attempt's name; retitle | §3 (review I6) |
| unused-pdf: "a rehashed document with an invalid module confirmation cannot authorise unused-PDF reset without the setup password" | `password_required` | same two-way shape as above; retitle | §3 |
| unused-pdf: "a damaged record beside a refused artifact refuses setup.not_ready without asking for the password" | `not_ready` | same assertion; retitle without "without asking for the password" | §3 |
| unused-pdf: "with the database present, a damaged kept picks file asks for the setup password, says so, and nothing changes" | `password_required` with `seriesPicksUnreadable` | without `confirmUnreadable` → `attempt_conflict`, nothing changes; with it → deletes; retitle | §3 |
| unused-pdf: "a damaged recovery-key record alone asks for the setup password with no params" | `password_required` `{}` | two-way shape as above; retitle | §3 |
| backup-discard: "with the database present, the password and the confirmed summary discard a stopped recovery, with a record of who chose it" | password step, `administrator` | no password; M2 record; retitle "…with a record of whose setup it was" | §3, §4 |
| backup-discard: "…a stopped recovery's Start again without the setup password is refused setup.start_again_password_required…" | refused | goes ahead; the recovery is discarded; retitle | §3 |
| backup-discard: "with the database present and no recovery, the summary refuses setup.not_ready and confirmRecoveryDiscard is refused…" | summary refused | summary answers with no `recovery`; the `confirmRecoveryDiscard` half unchanged | D1 |
| first-fiscal-hour-finish: "a missing hour database refuses a confirmed Start again from an owner whose latest event is not a fresh recovery" | refused | deleted; replaced by "…a confirmed Start again with no owner goes ahead" | §3 |

**Setup page** — classified from titles only (read, not run). Every test in a class keeps its
non-password assertions (enabled/disabled, order, request body, restarting).

| Class | Tests (by title) | Old → New | Why |
| --- | --- | --- | --- |
| P1 retired | `setup-app-resolution.test.ts`: "a damaged recovery-key record asks for the administrator password…", "Cancel at the password step sends nothing and offers Start again again", "Cancel at the password step reached from Start again…", "the password step calls recover, never resume…", "a wrong password there keeps Start again offered…", "the password step draws neither Abandon nor…", "a wrong password at the damaged-record password step…", "Continue at the damaged-record password step with no password…", the `"the password step"`/`"…after a refused send"` table at ~1348-1360, "an abandoned attempt's warning and its password step after a refused send…"; `setup-app-missing-database.test.ts`: "keeps a missing database on repair after password recovery…", "requires password recovery again after a refused retirement…", "shows none of the ask's lines before the password step", "shows the before-password line only before the password step"; `first-setup-retirement.test.ts`: "retires recovered %s work and requires password recovery even after a refresh", "after a sent Start again with the database present, the stopped recovery's summary and another Start again need the password again…"; `setup-app-resolution.a11y.test.ts`: the `"password"` step of the loops at `:135` (`password`/`warning`), `:219` (`password`/`confirmation`, which asserts the password code at `:162` and `:263`) and `:351` (`stopped`/`password`/`confirmation`/`unread`) | password state asserted → that state deleted from the loop or the test deleted; Task 7b's `setup-app-wipe.test.ts` pins "no password field, no owner header" for each case | §3 (review I6) |
| P2 password removed from the path | every other test in those files whose setup types a password to reach Start again's confirmation (titles containing "after the password", "the password, then…", "with the database present and a stopped recovery…", "…damaged…", "…stopped recovery…") | the password step removed from the path; the summary is read on pressing Start again; assertions about lines, order, Cancel, Check again and the request body kept | §3, D9 |
| P3 counts | `setup-app-held-refusals.test.ts` (whole file), `first-setup-retirement.test.ts` "refuses a summary whose held counts changed…" `it.each`, "reads a summary naming what the setup database holds…", "beside a stopped recovery and a setup database holding $name…", "a setup database holding records with no stopped recovery drawn still refuses Start again, even with held counts" | count lines → §9c words from the refusal cause; count-changed cases deleted (the box refuses at the summary now); "no stopped recovery … refuses" → offered | counts gone, §1a row 4 |
| P4 offer gating | "does not offer password-free retirement of a %s database", "a database holding records with no stopped recovery keeps Start again disabled and says why", "saved trading settings … keep Start again disabled", "offers no Start again in the ask while a backup recovery's journal reports %s" | Start again is offered; pressing it draws the box's refusal words (`wipeUnavailable`, `tradingSaved…`) or the ask | D1, D9 |
| P5 moved | the session-method cases of `first-setup-retirement.test.ts` (`missingDatabaseSummary`, `retireMissingDatabase`, `stoppedRecoverySummary`, `damagedRecordSummary`, `retireDamagedRecord`) | moved to `apps/setup/src/start-again-wipe.test.ts` against `readWipeSummary`/`sendWipe`, every "changed between display and confirmation … sends nothing" assertion kept | Task 7a |
| P6 words | slice-1 assertions on `startUnavailable*`, `heldChanged`, `uncheckable`, `tradingSaved` texts | the §9c/§9e words | §9 |

## Review Focus

1. **A full disk or a failed copy beside a database holding an invoice** must refuse
   (`setup.not_ready`), never take the "cannot be read" path. Pinned in Task 5.
2. **A readable database the inspection labels `unreadable`** (over 128 MiB) must never be deleted
   unchecked: with an invoice record it answers `kept-records`; with none, `setup.not_ready` (D3).
   Pinned in Task 5 by stubbing the inspection's label over a real held database.
3. **A damaged table beside a readable table holding kept rows** must refuse `kept-records` and
   delete nothing (review I1). Pinned in Task 5.
4. **A reader moving `-shm`, or the first read creating `-wal`, between the summary and Start
   again** must leave the §5 floor as shown. Pinned in Tasks 1 and 5 (the errcode-11 WAL case).
5. **A send refused `kept-records` after the page drew a confirmation** must close the
   confirmation, draw `heldChanged`, and offer Start again again (whose summary then draws
   `keptFault`). Pinned in Task 8b.

---

### Task 0: Can `<state>/module-evidence/` sit beside a later failed setup? (gate)

**STOP rule.** If **any** code path leaves `<state>/module-evidence/` in place while making the box
claimable for a first setup, the build STOPS before Task 1: write the worked example (which path,
which presses, which names the note would miss) and the step outputs into the ledger, and lane A
relays OQ1 with that example. No code is written for this slice until the owner answers.

**Files:** none committed. Probe: `apps/server/src/zz-a1131bc-2-module-evidence.test.ts`, deleted
before the task ends. Outputs to `~/waitron-campaign/a1131bc-2-module-evidence/`.

Read while planning and in the plan review (not run): writers are `restoreSecrets`
(`apps/server/src/restore.ts:677-691`; callers `restore.ts:341`, after the database is placed,
migrated and its hooks run, and `apps/server/src/backup-data-placement.ts:70`), and the old
recovery's `first-setup-backup-recovery.ts:562`, under `record.target.target.stateDir`.
`recovery-unpack-command.ts` unpacks only `RECOVERY_FILES` (`state-secrets.ts:16-23`). Paths back
to first setup that leave the folder: **`apps/server/src/rejoin-command.ts:131-139`** (deletes the
databases, re-migrates, clears `trading.env`, "next boot is setup mode"; guards `rejoin.ts:43-52`
need only a fenced node and a serving primary — the review expects this to be the STOP), and the
staged reset `reset-request.ts:106-109` (databases plus three named files). `waitron.sh reset`
empties the state folder but for its kept list.

- [ ] **Step 1: Writers.** Run
  `rg -n "module-evidence" --glob '!*.test.*' --glob '!docs/**' apps packages deploy scripts` and
  `rg -n "restoreSecrets\(|unpackBundleToDir\(" --glob '!*.test.*' apps packages`. Expected writers:
  the three above. A writer beyond them joins Step 3's list.
- [ ] **Step 2: Paths back to first setup.** Run
  `rg -n "wipeVenueDatabases\(|clearTradingEnv\(|setup mode" --glob '!*.test.*' apps/server/src packages`
  and list every caller that can leave a box claimable for first setup with its state folder
  otherwise intact. Expected: rejoin, the staged reset; any other joins Step 3.
- [ ] **Step 3: Probe each path** (failing case written first in the output README: "the claim is
  refused"; the STOP case is the claim succeeding with `module-evidence` present):
  - (a) rejoin: on a box with a restored venue (the spec's probe T2,
    `~/waitron-campaign/a1131bc-redesign-measure/where-restore-writes.test.ts.txt`), run the rejoin
    wipe (`rejoinAsSecondary` with a fenced held document, or the `wipeDatabase` step it calls), then
    a first-setup claim (`assertVenueFirstSetupAllowed(venueDir)` and the owner store's claim the
    probe's T3 uses). Record whether `<state>/module-evidence` is still there and whether the claim
    succeeds.
  - (b) the staged reset: same, with `runStagedReset`.
  - (c) the old recovery: after `selectedRepair()` (`apps/server/test/first-setup-backup-resume-fixture.ts`),
    `<state>/module-evidence` is absent and the target's copy is present.
  - Control for (a) and (b): a box with no restored venue, the claim succeeds — so a refusal in (a)
    or (b) is not a broken probe.
- [ ] **Step 4: Who reads it after a wipe.** `rg -n "module-evidence|hour-history" packages/fiscal-verifactu/src apps/server/src --glob '!*.test.*'`:
  record whether a first setup's or a fresh-box restore's name choice reads `<state>/module-evidence`
  (the worked example for OQ1 needs it).
- [ ] **Step 5: Decide.** Any path in Step 3 that leaves the folder and allows the claim → STOP per
  the rule above. Otherwise write the finding, the commands and the counts into the ledger and
  carry on. Delete the probe; `git status --short` shows nothing.

### Task 1: The file-time floor can count the databases; the wipe deletes journals

**Files:** Modify `packages/provisioning/src/first-setup-start-again-deletion.ts` (`SIDE_FILES` `:36`,
`attemptLastWriteMs` `:333-354`). Test `packages/provisioning/src/first-setup-start-again-last-write.test.ts`,
`packages/provisioning/src/first-setup-start-again-deletion.test.ts`.

**Interfaces — Produces:** `attemptLastWriteMs(roots, options?: { discarding?: string; held?: true; databases?: true }): Promise<number | null>`.
With `databases`, also counts `venue/venue.db`, `venue/node.db`, and every side item that does not
end in `-shm` (`-wal`, `-journal`). Without it, unchanged.

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
- [ ] **Step 2:** run `… pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-last-write.test.ts src/first-setup-start-again-deletion.test.ts`.
  Expected: four fail (the three `databases` cases that should move, and the journal deletion); the
  `-shm` and "without databases" cases pass.
- [ ] **Step 3: Implement.** Add both journals to `SIDE_FILES` (so `itemsOnDisk` lists them as side
  items; no separate `lstat`). In `attemptLastWriteMs`, when `databases` is set, keep the database
  `file` items and the `side` items whose name does not end in `-shm`. Update the doc comment to say
  what each mode counts.
- [ ] **Step 4:** same command, all pass; then the package's start-again files
  (`… vitest run src/first-setup-start-again`). Typecheck and lint the package.
- [ ] **Step 5:** commit. **Per-task reviewer** (fiscal-adjacent: what moves the floor).

### Task 2: The counts leave the wire; the box refuses kept records at the summary

**Files:** Modify `packages/provisioning/src/first-setup-start-again-confirmation.ts` (drop
`StartAgainHeld`, `HELD_KEYS`, `heldShown`, the `held` member and its line in `confirmation()`),
`packages/provisioning/src/index.ts` (stop exporting `StartAgainHeld`),
`apps/server/src/setup-first-fiscal-api.ts` (`shownSummary` loses the optional `held`; delete
`shownHeld`), `apps/server/src/first-setup-resolution.ts` (delete `heldShown`; the summary throws
`refused("kept-records")` with the D11 reason; Start again's existing kept-records refusal gets the
same reason). Tests: class M3 and the server/provisioning rows above.

**Consumers traced** (`rg -l "StartAgainHeld|held:|heldShown|shownHeld|readableHeld"` over
`apps packages scripts`, run 2026-10-29): provisioning confirmation + its test; server
resolution, route parser, `first-setup-start-again-held.test.ts`, `first-setup-resolution.route.test.ts`,
`start-again-full-disk.e2e.test.ts`; setup page types, session, `setup-app.ts`, its tests and
`apps/setup/test/held-database-browser.ts`. The setup page keeps its own JSON shapes
(`apps/setup/src/api/client.ts:20`) and is changed in Task 7a; until then it still accepts a `held`
the box no longer sends. The fiscal module's `startAgainHoldings` seat still returns its counts
(`packages/fiscal-verifactu/src/start-again-holdings.test.ts`, unchanged); only the wire loses them.

- [ ] **Step 1: Failing tests.** Route test: "a shown summary carrying held counts is refused
  setup.request_invalid", for each echo field: `confirmMissingDatabase.shown.held`,
  `confirmRecoveryDiscard.shown.held` and `confirmUnreadable.shown.held`. Held test: "a held setup
  database with an invoice record refuses the summary kept-records, and nothing changes" (the
  file's `expectRefused` and `snapshot`). Held test, route level: "the summary's kept-records
  refusal logs the counts, not the answer": capture `log` given to `mountFirstSetupResolutionApi`;
  the `warn` line for `setup.start_again_refused` has `logReason` matching
  `/rows=\d+ kept=\d+ records=1 accepted=0/`, and the JSON answer is exactly
  `{ error: { code, params: { cause: "kept-records" } } }`. Provisioning: "a shown.held key is not
  stored in the record".
- [ ] **Step 2:** run the route, held and confirmation test files; the new cases fail.
- [ ] **Step 3: Implement** as listed under Files. Apply M3 and the table rows.
- [ ] **Step 4:** run `src/first-setup-start-again-held.test.ts src/first-setup-resolution.route.test.ts src/start-again-full-disk.e2e.test.ts`
  (server) and `src/first-setup-start-again-confirmation.test.ts` (provisioning); typecheck both
  packages. The full-disk suite needs `hdiutil` on macOS (CLAUDE.md §4); read that it did not skip.
- [ ] **Step 5:** commit.

### Task 3a: No password for the wipe; one assessment; records say nobody signed in

**Files:** Modify `apps/server/src/first-setup-resolution.ts` (whole `createFirstSetupResolutionActions`
body), `apps/server/src/setup-first-fiscal-api.ts` (summary route stops calling `firstFiscalOwner`
and asks for a restart on `setup.start_again_incomplete`, D14; Start again route stops passing
`owner`; drop the status line `:39`), `apps/server/src/errors.ts` (retire
`setup.start_again_password_required`, `:1041`), `apps/setup/src/setup-app.ts:1479` only to delete
the dead comparison, `packages/provisioning/src/first-setup-start-again-confirmation.ts` (D8 shape,
except `"unreadable"`, which is Task 5's). Tests: only the new ones below, plus the table rows of
the note, backup-discard, unused-pdf and first-fiscal-hour-finish files.

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
  - note test: "the summary answers with no owner, for a missing database" (action level).
  - note test: "Start again over HTTPS with no owner headers starts again" (route, TLS socket as the
    file's `postSummary` does; answer `{ restarting: true }`; `expectStartAgainDeleted`).
  - note test: "**a plain-HTTP request to the Start again route is refused, and nothing changes**"
    (`incoming: { socket: new Socket() }`, as "the summary route refuses over plain HTTP" does;
    answer `setup.owner_required`; `attemptFiles(f)` unchanged; no confirmations folder). Then prove
    it by deletion: comment out `assertHttps(c)` at the Start again route, see this test fail, restore.
  - note test: "a summary with a deletion already marked answers setup.start_again_incomplete and
    asks for a restart" (route, `requestRestart` spy called once) (D14).
  - inspection test: "with an empty unused setup, the summary answers, and Start again deletes it
    with no owner" (`actionsFixture`, no `register`).
  - damaged-recovery test: "with an empty database and a damaged recovery-key record, the summary
    carries recoveryRecordDamaged; Start again without the flag is refused setup.attempt_conflict,
    and with it deletes the setup".
  - provisioning: "a record is version 2, names whose setup it was, and says it was confirmed on the
    repair page with nobody signed in" (`Object.keys` order pinned, as the file's key test is).
- [ ] **Step 2:** run the note, inspection, damaged-recovery and route files and the provisioning
  confirmation file; the new cases fail (`owner_required`, `start_again_password_required`, summary
  `not_ready`, no restart).
- [ ] **Step 3: Implement.** Write `assessStartAgain`; delete `assertRecoveredOwner`'s three calls
  and the function; apply D2; delete the `password_required` throw (`:605-612`); keep every other
  refusal, the two "no await" ordering comments' invariants (`:661-663`, `:676-680`) and the
  `markerFor` size check. The record: `setupAdministrator` from `state.frozen.request.admin`'s
  `{ displayName, email }`, `confirmedOn: "repair-page"`, `signedIn: false`, `version: 2`.
- [ ] **Step 4:** run the Step 2 files green, plus `recovery-start-again.test.ts` (unedited) and
  `scripts/errors-reachable.test.ts` (the code leaves the registry and its only thrower together).
  Typecheck server and provisioning. **Red until Task 3b, by design:** the M1/M2/M4 files not yet
  edited — record each failing title in the ledger against its class.
- [ ] **Step 5:** commit. **Per-task reviewer** (the acceptance rule decides what may be deleted).

### Task 3b: The existing server suites follow (M1, M1-twin, M2, M4, unused-pdf rows)

About 210 owner or record sites across 18 files (review I7 count: 60 in the note test, 30 in
recovery-delivery, 24 in backup-discard). Work file by file, running each file after editing it.

- [ ] **Step 1:** M1, M2 and M4 in: `first-setup-start-again-note`, `-backup`, `-backup-discard`,
  `-backup-restart`, `-held`, `-damaged-recovery`, `-name-records`, `first-setup-resolution-inspection`,
  `first-setup-resolution.route`, `first-fiscal-hour-finish`, `first-fiscal-hour.e2e`,
  `first-setup-unused-pdf` (plus its five table rows), `first-setup-retired-assignments`,
  `first-setup-set-aside-lifetime`, `first-setup-backup-handoff`, `start-again-full-disk.e2e`,
  `spare-space`, `setup-first-fiscal-api.disk-full`, `setup-first-backup-api-adapters`,
  `first-setup-workspace`, `first-setup-recovery-delivery`; and the M2 fixture in
  `packages/provisioning/src/first-setup-start-again-choose.test.ts:629-634` (assertions unedited).
- [ ] **Step 2: M1-twin.** In each file the class names, add the no-password twin of each floor or
  note case; write the expected floor by hand from the stamped file times (first whole minute more
  than 150 s after the newest), not from the code.
- [ ] **Step 3:** run every file of Step 1, then `recovery-start-again.test.ts` and
  `first-setup-start-again-choose.test.ts` (the "files found" page keeps its password), then
  `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/start-again-note-writers.test.ts`. Setup-page suites stay green: the page still sends
  what it sent (Task 7 changes it). Commit, naming each edited title.

### Task 4: A database holding rows is offered with or without a stopped recovery; every §1a row

**Files:** Modify `apps/server/src/first-setup-resolution.ts` (`assertHeldStartAgainOffered` drops
the `found?.kind !== "stopped"` condition, `:103`; its doc comment follows). Move `tree`/`snapshot`
from `first-setup-start-again-held.test.ts:69-89` into `apps/server/test/start-again-deleted.ts` as
`diskSnapshot(roots)` and use it below. Tests in `first-setup-start-again-held.test.ts`,
`first-setup-resolution-inspection.test.ts`, `first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing tests (held test file unless named):**
  - "a held setup database with no recovery: the summary answers and Start again deletes it with no
    password; the note covers the attempt's name and a later installation the database holds"
    (`heldSetup({ recovery: false })`, `writeLaterInstallation` as "the note's floor follows a later
    installation…" does; `expectStartAgainDeleted`; note `floorMs` later than the later name's
    minute, `decodeMinuteIdentity`).
  - **The wipe-then-restore test**: "a held setup database with series names, wiped, then the
    fresh-box restore writes into the usual folders under a name later than every name the database
    held". After the wipe above, stage and run the fresh-box restore as the spec's probe T2/T4 does
    (`restoreApp`, `archiveForm`, `stageRestoreRequest`, `runStagedRestore`, `agreeInternet`,
    `clock` from `hour-recovery-host.ts`) with the clock at the later name's minute: refused
    `sif.allocation_invalid` `minute_not_later` (as `hour-recovery-host.test.ts` "the start-again
    note" asserts); then the clock past the note: `venue.db` in the usual venue folder, no
    `first-setup-resolutions` folder, `resolveFirstSetupBackupWorkspace` "absent", and every live
    series name's minute later than every name the wiped database held.
    **Control** (an ordinary test asserting the reuse, not `it.fails`): with `raiseStartAgainNote`
    mocked to a no-op for that case only (`vi.mock` of `@waitron/provisioning` with `{ spy: true }`
    and `mockImplementationOnce`), the restore at the later name's minute is ACCEPTED and its series
    name equals a name the wiped database held. Write down before running: the main test fails if
    the note step is missing; the control fails if the note step is still in effect.
  - §1a refusal rows, each "refuses …, and deletes nothing" with `diskSnapshot` equal before and
    after, the note unchanged and no confirmations folder, each through the SUMMARY as well as Start
    again: trading.env (no recovery) → `start_again_refused` `trading-settings`; complete →
    `setup-finished`; invoice record (no recovery) → `kept-records`; a view-only database →
    `not_ready` (existing, unedited); in the inspection test file: empty database past claimed
    (status beyond `PRESENT_START_AGAIN_STATUSES` through `f.store.update`, or the file's nearest
    fixture) → `not_ready`; `restore-request.json` in state → `not_ready`; an unexpected folder in
    `first-setup-resolutions` → `not_ready`; `first-setup-workspaces` in state →
    `setup.workspace_unsupported`; in the note test file: outside evidence (existing), marker over
    its limit (existing).
  - "a deletion already marked: Start again answers setup.start_again_incomplete and the route asks
    for a restart" — existing ("start again is refused while a deletion marker exists…"); add only the
    route's restart assertion if absent.
  - **Cut after the marker**: "a power cut during a held wipe with no recovery: the next start
    finishes the deletion" — `remove` that throws on its second call, as "a power cut during the
    attempt's deletion…" (`first-setup-start-again-backup-restart.test.ts`) does; then
    `finishStartAgainDeletion(f.roots)`; `expectStartAgainDeleted`; note unchanged since before the
    marker.
- [ ] **Step 2:** run the three files; the offered-without-recovery, restore and new
  refusal-through-summary cases fail; the control fails too until Step 3 (it needs the offered wipe).
- [ ] **Step 3: Implement** the one-line change and its comment.
- [ ] **Step 4:** run the three files plus `hour-recovery-host.test.ts -t "the start-again note"`
  (unedited) and `first-setup-resolution.boot.test.ts`. Read every `Tests` count.
- [ ] **Step 5:** commit. **Per-task reviewer** (§1a and the note).

### Task 5: A setup database the box cannot read (question 2, answer A)

**Files:** Modify `apps/server/src/first-setup-database-holdings.ts` (new export; table-by-table
read), `apps/server/src/first-setup-resolution.ts` (D3 branch before `assertHeldStartAgainOffered`;
D6 before `gatherStartAgainFloor`'s early return; `gatherStartAgainFloor` gains
`databaseUnreadable`), `apps/server/src/setup-first-fiscal-api.ts:144` (`UNREADABLE_RECORDS`,
`shownUnreadable`), `packages/provisioning/src/first-setup-start-again-confirmation.ts`
(`UNREADABLE_RECORDS`, `unreadableShown`, `database: "unreadable"`). Tests in
`first-setup-start-again-held.test.ts` (it has a real activated database to damage), the route test
and the provisioning confirmation test.

**Interfaces — Produces:**
- `readSetupDatabaseHoldingsOrDamage(roots, modules): Promise<SetupDatabaseHoldings | { damaged: string; partial: Pick<SetupDatabaseHoldings, "rows" | "kept" | "records" | "accepted"> }>`
  per D3: it counts each table in its own `try`, runs each module reader in its own `try`, keeps
  every count it got, and answers `{ damaged }` only when some step failed with primary errcode 11
  or 26 and nothing it read showed kept rows or records (the caller refuses `kept-records` from
  `partial` otherwise). `damaged` is the error code alone (`sqlite errcode 11`). Every other failure
  throws `setup.not_ready` as `readSetupDatabaseHoldings` does.
- Unreadable record kinds, in this order everywhere: `"setup-database"`, `"series-picks"`,
  `"public-record"`, `"fiscal-documents"`. `StartAgainUnreadable.floorMs: number | null`, null only
  when `records` includes `"setup-database"` and no frozen module has a floor seat (D6).
- The record: `database: "unreadable"` requires `shown.unreadable.records` to include
  `"setup-database"`.

Behaviour: the D3 branch, then (for `{ damaged }` with nothing kept seen) D6's seat check, then
`gatherStartAgainFloor(…, databaseUnreadable = true)`: adds `"setup-database"`, reads past a damaged
public record or documents file as the missing path does, and takes the seat's floor from
`attemptLastWriteMs(roots, { ...deletion, databases: true })`. Start again then needs
`confirmUnreadable: { shown }` (or `confirmRecoveryDiscard` beside a stopped recovery, as today) and
writes the record with `database: "unreadable"`.

- [ ] **Step 1: Failing tests.**
  - "a setup database of junk bytes: the summary names it unreadable with a floor; Start again with
    confirmUnreadable deletes it, writes an unreadable record, and the note's floor is the first
    whole minute more than 150 s after its newest counted file time" (overwrite `venue.db` with
    random bytes — errcode 26 — remove its side files; stamp files to T, `venue.db` to T + 10 min).
  - **The realistic case** (review minor 8): a WAL-mode database with one damaged page after the
    header (errcode 11, the review's E2 damage), end to end: inspection, summary, then Start again;
    the `-wal` the first read creates and the `-shm` each read moves leave `unreadable.floorMs` equal
    at the summary and at Start again, and Start again goes ahead.
  - **The two floor controls on their own** (spec §5): (i) `venue.db` stamped later than every other
    file moves `unreadable.floorMs`; (ii) `venue.db-wal` newer than every other file, `venue.db` left
    older, moves it too.
  - "a -shm moved between the summary and Start again leaves the floor as shown, and Start again goes
    ahead" (D4).
  - Review Focus 3: "a damaged table beside a readable table holding kept rows refuses kept-records,
    and deletes nothing" (damage a page of a deletable table in a database that holds a kept row).
  - "Start again past an unreadable database without confirmUnreadable is refused attempt_conflict,
    and nothing changes".
  - Review Focus 1: "a corrupt database whose copy fails refuses setup.not_ready and deletes nothing"
    — stub the holdings copy to throw `ENOSPC`.
  - Review Focus 2: "a readable held database the inspection labels unreadable refuses kept-records
    for an invoice record, and setup.not_ready with none" (`heldSetup({ invoices: 1, recovery: false })`
    and `heldSetup({ recovery: false })`, inspection stubbed to `database: "unreadable"` through the
    host's `inspectFirstSetupResolution`).
  - "a part-migrated database (inspection `partial`) is still refused setup.not_ready" (D3).
  - "saved trading settings beside an unreadable database refuse trading-settings, and nothing
    changes".
  - **D6, three shapes** (review I3): no frozen modules; frozen modules with no floor seat; no seat
    beside a stopped recovery. Each: the summary carries `"setup-database"` with `floorMs: null`;
    Start again deletes; in the third the note equals the recovery's own floor (unchanged rule) and
    `unreadable.floorMs` stays null.
  - Provisioning: an `"unreadable"` record without `"setup-database"` is refused `setup.attempt_invalid`;
    `floorMs: null` without `"setup-database"` is refused.
  - Route: `confirmUnreadable.shown.unreadable.records` `["setup-database", "series-picks"]` passes
    the parser; `["series-picks", "setup-database"]` is refused (order); `floorMs: null` passes only
    with `"setup-database"`.
- [ ] **Step 2:** run the held and route files and the provisioning confirmation test; the new cases
  fail (`setup.not_ready` today, review R2).
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4:** run the held, note, route and inspection files and the provisioning start-again
  set; typecheck both packages; `scripts/start-again-note-writers.test.ts` unedited.
- [ ] **Step 5:** commit. **Per-task reviewer** (Q2 A: what may be deleted unread, and its floor).
  Record OQ2 in the ledger for lane A if not yet relayed.

### Task 6: Server checkpoint

- [ ] Run the server's start-again and first-setup suites in one go after checking memory
  (`… pnpm --filter @waitron/server exec vitest run src/first-setup src/start-again src/recovery-start-again src/first-fiscal-hour src/hour-recovery-host`)
  and `packages/provisioning`'s `test:coverage` (`98/98/98/95`; read the per-file table for
  `first-setup-start-again-deletion.ts` and `-confirmation.ts`). Fix only coverage gaps in code this
  branch changed. Ledger: counts and anything red.

### Task 7a: The page's wipe helper, client and types

**Files:** Create `apps/setup/src/start-again-wipe.ts`, `apps/setup/src/start-again-wipe.test.ts`.
Modify `apps/setup/src/api/client.ts` (`:641-673`), `apps/setup/src/api/first-setup-types.ts`
(`:140-155`), `apps/setup/src/first-setup-session.ts` (delete `HELD_KEYS`, `readableHeld`,
`sameHeld`, `summaryOf`, `sameSummary`, the `readable*` helpers and the five Start again methods and
their owner helpers `:679-839`; `heldStartAgainDatabase` goes in 7b with its last caller).

**Interfaces — Produces:**
- `api.startAgainSummary(snapshot): Promise<StartAgainSummary>` — no owner headers.
- `api.startAgainFirstSetup(snapshot, confirm?: StartAgainConfirm): Promise<{ restarting: true }>`,
  `StartAgainConfirm = { confirmMissingDatabase?; recoveryRecordDamagedShown?: true; confirmRecoveryDiscard?; confirmUnreadable? }` — no owner headers.
- `readWipeSummary(api, snapshot): Promise<StartAgainSummary>` — validates the shape (today's
  `summaryOf` without `held`, with `"setup-database"` and nullable `floorMs`).
- `sendWipe(api, snapshot, database: FirstSetupInspection["database"], shown): Promise<{ restarting: true }>`
  — reads the summary again; not the same as `shown` → `{ code: "setup.attempt_conflict" }` and
  sends nothing; else sends: missing → `confirmMissingDatabase: { nothingFiledOrSold: true, shown }`;
  present with `shown.recovery` → `confirmRecoveryDiscard: { shown }`; present with
  `shown.unreadable` and no recovery → `confirmUnreadable: { shown }`; `shown.recoveryRecordDamaged`
  → `recoveryRecordDamagedShown: true`; otherwise nothing (D13).
- `wipeRefusal(error): "setup-finished" | "trading-settings" | "kept-records" | "unavailable" | undefined`
  (`setup.not_ready` → `"unavailable"`; `setup.owner_required` → `undefined`, D15).

- [ ] **Step 1: Failing tests** in `start-again-wipe.test.ts`: the P5 cases ported to
  `readWipeSummary`/`sendWipe` (every "changed between display and confirmation … sends nothing"
  case kept: names floor, damaged records, recovery, reached, lastName); "a summary carrying held is
  refused as unreadable"; "no request carries X-Waitron-Setup-Owner"; one case per `sendWipe` row;
  `wipeRefusal` for each code including `owner_required`.
- [ ] **Step 2:** run it; it fails (module missing).
- [ ] **Step 3: Implement**; `setup-app.ts` is left calling the deleted session methods — **red
  until Task 7b, by design:** every `apps/setup` suite that mounts the repair page. Record the
  failing files in the ledger.
- [ ] **Step 4:** the new file green; `pnpm --filter @waitron/setup typecheck` is expected to fail
  only in `setup-app.ts` and its tests (ledger).
- [ ] **Step 5:** commit. **Per-task reviewer** (what the page sends to delete a setup).

### Task 7b: The page: one Start again flow, no password, the box's words

**Files:** Create `apps/setup/src/setup-app-wipe.test.ts`. Modify `apps/setup/src/setup-app.ts`,
`apps/setup/src/screens/initial-owner-strings.ts`, `apps/setup/src/first-setup-session.ts`
(`heldStartAgainDatabase`).

Page flow: Start again is enabled whenever the inspection has a non-null `revision` and
`ownerGeneration`, nothing is running, no refusal is drawn and the page is not busy — whatever the
password's state. Pressing it runs one `#openWipeConfirmation()`: inspect; with the database missing
also read the backup status as `#readMissingAsk` does (`:1376-1393`, no session), otherwise read the
activity (running → back to the repair page, as today); then `readWipeSummary`. An answer draws the
confirmation (missing: the ask lines and the stopped block from the summary, then the existing
confirmation); a refusal sets the drawn refusal (`wipeRefusal`) and hides Start again; any other
error draws `#describeRepairError` (D15); a failed read keeps today's "unread" state and Check
again. Confirm calls `sendWipe`; a send refused `kept-records` closes the confirmation, draws
`heldChanged`, and offers Start again again; any other refusal draws its words and closes the
confirmation. Delete the password states (`firstDamagedRecord` "password", `#damagedInferred`,
`#seriesPicksUnreadable`, `#unlockDamagedRecordStartAgain`, `firstStoppedSummary`/
`firstDamagedSummary`/`firstMissingSummary` merged into one `firstWipeSummary`). Words: the refusal
causes draw `setupFinished`, `tradingSaved` (+ `tradingSavedPassword` when the password is
checkable, D7), `keptFault`, `wipeUnavailable`; `"setup-database"` draws `setupDatabaseUnreadable`
(D12); `namesFrom` only when `floorMs` is not null; `noInvoiceFound` becomes
`!missing && !(summary.unreadable?.records.includes("setup-database") ?? false)` — the box answers a
present, readable database only after finding no invoice record. Continue's password form is not
drawn with the database missing (D10), and `#resumeFirstSetup`'s missing branch goes.

- [ ] **Step 1: Failing tests.** `setup-app-wipe.test.ts` (`it.each` over EN and ES where words are
  asserted): for each case — empty unused, held with no recovery, held beside a stopped recovery,
  damaged picks, damaged recovery-key record, missing database, unreadable database (with and
  without `floorMs`) — pressing Start again draws no password field (`data-test="resume-password"`
  absent inside the confirmation), reads the summary with no owner header, and Confirm sends exactly
  the fields `sendWipe` names; each refusal cause draws its §9c words and no Start again;
  `setup.owner_required` draws the existing owner-required message; with the password uncheckable,
  Start again is offered and `uncheckable` reads the new words; `tradingSaved` alone when the
  password is uncheckable (D7). In `setup-app-resolution.test.ts`, extend "Start again's
  confirmation words are the design's…" with every Global Constraints literal and
  `Object.hasOwn(..., key) === false` for every removed key.
- [ ] **Step 2:** run both; the new cases fail.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4:** both files green; `pnpm --filter @waitron/setup typecheck` and `lint` clean.
  **Red until Tasks 8a–9, by design:** `setup-app-resolution.test.ts` (its other cases),
  `setup-app-missing-database.test.ts`, `setup-app-held-refusals.test.ts`,
  `first-setup-retirement.test.ts`, and the three a11y files — record each failing title against
  its class (P1–P6). A failing title in any other file is a STOP.
- [ ] **Step 5:** commit. **Per-task reviewer**.

### Task 8a: Page suites, part 1 — refusals, retirement and a11y

**Files:** `apps/setup/src/setup-app-held-refusals.test.ts`, `first-setup-retirement.test.ts`,
`setup-app-resolution.a11y.test.ts`, `setup-app-held-database.a11y.test.ts`,
`apps/setup/test/held-database-browser.ts`.

- [ ] **Step 1:** Review Focus 5's test first, in `setup-app-held-refusals.test.ts`: "a send refused
  kept-records after the confirmation closes it, says the setup changed, and Start again then draws
  the fault" (EN and ES). If it fails, fix the code, not the test.
- [ ] **Step 2:** apply P1 (including the a11y loops' `password` states), P3, P4, P6; delete what P5
  moved. Add the a11y states the new screens need in `setup-app-held-database.a11y.test.ts`'s loop:
  `"refused-fault"` (summary refused kept-records) and `"unreadable"` (summary naming
  `setup-database`), both themes, 390 and 1280 px, axe plus the existing `scrollWidth` check, each
  with the guarded screenshot `if (import.meta.env.VITE_A1131BC_HELD_LOOK === "1") await page.screenshot(...)`
  slice 1 added.
- [ ] **Step 3:** run the five files; all green; read counts. Commit, naming each edit by class.

### Task 8b: Page suites, part 2 — the present-database resolution suite

**Files:** `apps/setup/src/setup-app-resolution.test.ts` (2561 lines).

- [ ] **Step 1:** apply P1, P2, P4, P6 in file order, in chunks of about ten tests, running the file
  after each chunk.
- [ ] **Step 2:** whole file green; read the count. Commit, naming each edit by class.

### Task 9: Page suites, part 3 — missing database

**Files:** `apps/setup/src/setup-app-missing-database.test.ts`, `setup-app-missing-database.a11y.test.ts`,
`apps/setup/test/missing-database-browser.ts`.

- [ ] **Step 1:** a test first: "with the database missing, the page offers Start again and no
  Continue; pressing it draws what the setup reached and the missing-database tick, with no password"
  (EN, ES). If it fails, fix the code.
- [ ] **Step 2:** apply P1, P2, P4; keep the stopped-recovery, uncertain-journal, running and Check
  again assertions — their reads now happen on pressing Start again.
- [ ] **Step 3:** run both files, then every `apps/setup` suite that names `start-again`, `held`,
  `missing`, `resolution`, `retirement` or `wipe` in one run (memory checked); all green.
  `pnpm --filter @waitron/setup typecheck`. Commit.

### Task 10: Docs that would otherwise be false

**Files:** `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`,
`docs/operations/first-live-fiscal-setup.md`, `deploy/README.md`, `deploy/waitron.sh` (comment
`:742-745`), `apps/server/README.md`, `docs/developers/conventions-data.md` (`:5086-5091`),
`CLAUDE.md` (§5's list of what raises the note's floor), `docs/backlog/setup.md`, `docs/backlog.md`,
and the spec's §3 cost list (D16; a dated amendment line, as earlier amendments are written).

Find every sentence again with
`rg -n -i "start again.{0,160}password|password.{0,160}start again|who confirmed|what the (repair )?page showed|after you enter(ed)? the (administrator )?password|password step|saved items|cuántos|introduzcas la contraseña|introdujeras la contraseña|other than its databases|beside a stopped recovery, with a setup database" apps/server/src/guide docs/operations docs/developers deploy apps/server/README.md docs/backlog/setup.md CLAUDE.md`.
Hits on 2026-10-29: EN guide `:29-31`, `:32-33`, `:37`, `:45-47`, `:50`; ES guide `:31`, `:34`, `:40`,
`:48`, `:50`, `:53`; runbook `:97-98`, `:102`, `:106`, `:116-118`, `:131-135`, `:150-156`;
`deploy/README.md:395-398`; `deploy/waitron.sh:744`; `apps/server/README.md:58-61`;
`conventions-data.md:5086-5091` ("other than its databases"; A1131 limited to "beside a stopped
recovery"); `docs/backlog/setup.md:651` (the full-disk entry's "password step" is now the summary
read). `docs/operations/a679-changed-checks.md:1838` is a dated historical record: leave it.
CLAUDE.md §5's note entry lists the ways the floor is raised (Move, A1099 damaged name records):
add the unreadable setup database in one clause, keep the line's length, and run
`scripts/claude-md-pointers.test.ts`.

After the edit, each must say: Start again asks for no password, and anyone who can open the repair
page can use it, and can see what the summary shows (D16, once, in the guide); the box refuses
beside saved selling settings, a finished setup, or a database holding an invoice or another record
Waitron never deletes, in §9c's words; a setup database the box cannot read is deleted, and new
series names start **no earlier than** the first whole minute more than 150 seconds after the
setup's newest file time, counting its databases (D4) — not "after you entered the password" (the
old "two and a half to three and a half minutes after you entered the password" came from the
password step rewriting files and is retired); the box could not check an unreadable database for
invoices (OQ2's answer decides the exact sentence; write A's and change it if the owner answers B);
the records say whose setup it was, that it was confirmed on the repair page with nobody signed in,
when, and the summary the box gave the page (what the setup reached, its last series name, any
stopped recovery or damaged records) — not "who confirmed" and not "what the page showed"; the
"files found" page still asks for the administrator password. EN and ES say the same; headings and
`{#id}`s untouched. `docs/backlog.md`'s A1131c entry: slice 2 = this branch; drop "until slice 2
removes them"; slices 3–4 still to come.

- [ ] **Step 1:** edit; `pnpm exec prettier --write` on the two guide files, `apps/server/README.md`
  and `CLAUDE.md`; `docs/` is Prettier-ignored, so READ the runbook paragraphs `:80-170` and the
  conventions entry whole after editing (CLAUDE.md §1: a behaviour change retires every receipt).
- [ ] **Step 2:** re-run the search; expect only the "files found" page's password and Continue's.
- [ ] **Step 3:** `… pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-backup-recovery.test.ts src/guide-pages.test.ts`,
  `… pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts scripts/waitron-sh.test.mjs scripts/claude-md-pointers.test.ts`,
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
  confirm), `scripts/claude-md-pointers.test.ts`.
- [ ] Typecheck and lint `@waitron/provisioning`, `@waitron/server`, `@waitron/setup`;
  `pnpm format:check`.
- [ ] Ledger `Status: done` for the build; tell the lead it is ready for `/finish-branch` with this
  plan; the PR description carries D4, D5, D7, D13, D16, the retired password-time floor, OQ2's
  answer, the edited-test tables and the look-check list.

## Self-review notes

- Spec coverage: §3 → Tasks 3a/3b; §1a rows → Task 4 (+ Task 5's row); §4 → Tasks 3a and 5; §5 and
  Q2 A → Tasks 1 and 5; §2's check → Task 0; §9c–§9e → Task 7b; counts off the wire → Tasks 2, 7a;
  `first-setup-retirement.test.ts:249-264` → P3/P5; docs → Task 10; tests listed in "Slices" item 2
  → Task 4 (wipe then restore with its control; refusals delete nothing; cut after the marker),
  Task 3a (plain HTTP), Tasks 1 and 5 (the two floor controls, the `-wal` one on its own).
- Review minors: 1 → D13 (stated, no record added: §4 is the approved list); 2 → D14; 3 → D15;
  4 → D6; 5 → D7; 6 → Task 1 Steps 2–3; 7 → Task 2 Step 1; 8 → Task 5's errcode-11 case, D4's "no
  earlier than", the code-only reason; 9 → D16.
- Not in this slice: Recover from backup as the wipe and its confirmation (§9b), "Join or recover"
  after the restart, removing the old recovery code (slices 3 and 4).
