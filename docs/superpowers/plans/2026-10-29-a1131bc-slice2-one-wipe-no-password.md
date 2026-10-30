# A1131b/c slice 2: one wipe, no password — Implementation Plan

**Revision 5 (2026-10-30).** Folds the fresh review of revision 4
(`~/waitron-campaign/item-a1131bc-2-plan-review-4.md`, 0 critical, 5 important, 10 minor; its probes
in `~/waitron-campaign/a1131bc-2-rev4-review4/`) with the lead's rulings:
- **I1:** the wipe deletes `venue.db-journal` and `node.db-journal` again (D15), and a damaged read
  while any `-journal` sits beside the database answers "not ready" (D3). Revision 4's experiment 2
  is withdrawn: its journal was never one SQLite rolls back, so "no harm" measured nothing.
- **I2:** the damaged-database words claim only what is true in every case: "This box cannot read
  all of the setup database." (OQ-B, the one owner question).
- **I3:** OQ-A parts 1 and 2 (partly created tables, a damaged `node.db`) are already decided by the
  owner's "whatever its damage … table list … anywhere else", so Task 4d builds them. OQ-A part 3
  and OQ-C become notes for the PR.
- **I4:** with the password uncheckable the setup record cannot be read, so Start again is not
  offered and the page says so on load; D5 and D7 now agree that the saved-settings words come only
  from pressing Start again.
- **I5:** Task 4c-1 deletes a database whose invoice table is damaged with no sale, with the fiscal
  module's own reader seen failing.
- The ten minors are folded where they apply (Tasks 3, 4, 6, 9, 11; D8, D13; Current behaviour).

**Revision 4 (2026-10-30), against main e8cfd38ed**, after two owner decisions. A1206 (#2245)
retired the record of used series names and every safety margin ("remove this concept of storing
the used series name on disk … We use the current minute, with confirmed clock times, and the latest
invoice numbers if we have any."); revision 3's Task 0, its file-time Task 1 and its margin
decisions went with it. The owner then widened OQ2 (2026-10-29 ~11:00): "Yes. Start again can
delete the failed setup dB." — whatever its damage, no margin, no reinstall. Tasks and decisions
were renumbered.

Every file:line below was read on e8cfd38ed unless marked run.

**Resume:** nothing built. Next: Task 1 (a further review of this revision only if the lead asks).
OQ-B goes to the owner now; it does not block the build and must be answered before the PR lands.

> **For agentic workers:** built on the FULL review path (fiscal-adjacent: it decides what Start
> again may delete). Implementers are `subagent_type: "implementer"`. A fresh per-task reviewer
> runs after Tasks 2a, 3, 4c-1 (covering 4a, 4b and 4c-1), 4c-2, 4d, 6a and 6b-2 (covering 6b-1),
> then `/finish-branch`. Steps use checkbox (`- [ ]`) syntax. Each task is sized well under 100
> tool calls; an implementer past about 150 calls stops at a passing or cleanly red point, commits,
> and hands over. Update the ledger at the end of every task.

**Goal:** Start again deletes a failed setup with no setup password; the box decides every refusal
and says it in the design's words; a setup database the box finds damaged is deleted whatever the
damage, unless what it can still read shows an invoice or another record Waitron never deletes; the
item counts stop travelling between the page and the box; the confirmation records say whose setup
it was and that nobody signed in.

**Architecture:** server first (the counts leave the wire; one assessment for both actions with no
password; the held database offered without a stopped recovery; the damaged database), then the
setup page (a session-free wipe helper and one Start again flow), then the docs. Not changed: the
"files found" page (A1098), Recover from backup's own flow and the fresh-box restore. Continue is
unchanged except that it is no longer offered with the setup database missing (D8). No file in
`packages/fiscal-verifactu` changes; no migration.

**Tech Stack:** TypeScript, Hono routes, `node:sqlite`, Vitest 4 (node for `apps/server` and
`packages/provisioning`; real headless Chromium for `apps/setup`), Lit.

**Spec:** `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` — §1a, §3,
§4, §9c–§9e and "Slices" item 2 are this plan's scope. Its §2 (`module-evidence/`), §5's margin
bullet, §1a's "with the floor of §5", §9d's sentence about series names and §9b's help line ("This
box will not use this setup's invoice series names again.") are overtaken by the decisions above;
Task 9 adds a dated amendment line to the spec saying so.

**Worktree / branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131bc-2-one-wipe-no-password`,
`feat/a1131bc-2-one-wipe-no-password`, rebased onto main e8cfd38ed. Ledger:
`docs/handoffs/2026-10-29-a1131bc-slice2.md` (gitignored): each task's commit, the `Tests` counts
read, and every test edited by design (old → new).

## Owner question

Answered: OQ1 (moot, A1206); OQ2 (A, then widened at ~11:00 — built here).

- **OQ-B — Words for a setup database the box cannot read.** Spec §9d's approved sentence ends "so
  it cannot list the invoice series names that setup used"; since A1206 nothing lists those names.
  Default, built unless you change it:
  EN "This box cannot read all of the setup database."
  ES «Este equipo no puede leer toda la base de datos de configuración.»
  The page then shows "Start again deletes what was entered in the setup that stopped part way."
  without "No invoice was sent to AEAT.". Example: Marta's setup stops in a power cut and part of
  its database is damaged; pressing Start again shows these two sentences and the tick box.
  The reason is not given on purpose: when the damage is outside the invoice table the box did read
  that table, so "so it cannot check it for invoices" would be false (review 4, I2, run).

## Notes for the PR (decided, not asked)

- **N1 — Not damage, still refused:** a `venue.db` the box is not allowed to open (code 14, run),
  or one over 128 MiB (the inspection calls it unreadable without opening it as a database,
  `packages/provisioning/src/first-setup-resolution-inspection.ts:56`). The box cannot look at it,
  and neither is what a failed setup leaves; `wipeUnavailable`, as today.
- **N2 — Damage beside a visible sale, still refused:** when the readable part of a damaged database
  shows a record Waitron never deletes, the box refuses with `keptFault`, as for an undamaged one.
  That limit is about what the database holds, not damage, and the owner's reason ("If it fails
  during setup then it definitely hasn't issued an invoice") does not describe it. Run (experiment
  3): with one sale and only the invoice table damaged, `sales` 1, `sale_lines` 2, `tenders` 1,
  `sale_settlements` 1 stay readable.
- **N3 — What the removed password step also did:** it ran the owner audit's reconcile and, for a
  claim marker under repair, the marker repair (`packages/provisioning/src/first-setup-owner.ts:245-277`).
  Neither runs before a wipe now. Its refusal of a completed publication (`:212`) needs status
  `complete`, which `setup-finished` already refuses.
- **N4 — The spare file on a nearly full disk:** the box releases its spare before a Start-again
  step only when the journal names a recovery to discard (`releaseSpareBeforeStartAgain`,
  `apps/server/src/spare-space.ts:236-240`, `discardable` `:252-257`). The wipes this slice newly
  offers with no recovery therefore get no release; Task 3 pins what they do on a full disk.
  `docs/developers/conventions-data.md:3339` ("the four requests of the Start-again flow") goes
  stale (the flow no longer uses the password route); its fix waits for #2251 (follow-up line in
  the backlog, Task 9).
- **N5 — Plain HTTP** (D13): the wipe flow draws `wipeUnavailable` for `setup.owner_required`; a
  sentence saying a secure connection is needed is a backlog line.

## Global Constraints

- **Fiscal-adjacent.** No file in `packages/fiscal-verifactu` changes. No change to `computeHuella`,
  the chain, numbering, `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal`. No
  migration. These must pass UNEDITED in Task 11:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run huella` (the three `*.huella.test.ts`
  files that pin fixed hashes: sale-amount, money-conversion, correction-amount).
- **Unchanged:** the "files found" page and its password (`apps/server/src/recovery-start-again.ts`,
  `packages/provisioning/src/first-setup-start-again-choose.ts`); Continue and its password, except
  D8; Recover from backup's flow (slice 3); the fresh-box restore; both routes' `assertHttps`
  (`apps/server/src/setup-first-fiscal-api.ts:983-987`, used at `:992` and `:1021`); A1158
  (damaged setup record or claim marker) and A1161 (a public record or documents file beside a
  present database) keep refusing — neither is about the database's damage.
- **Not edited, to stay clear of #2251 (A1207, open):** `CLAUDE.md`,
  `docs/developers/conventions-data.md`, `apps/server/src/hour-recovery-host.test.ts`,
  anything in `packages/fiscal-verifactu`. Overlaps that remain are listed under "Overlap with #2251".
- **Exact words** (keys in `apps/setup/src/screens/initial-owner-strings.ts`; spec §9c–§9e except
  `setupDatabaseUnreadable`, which is OQ-B's default):
  - `keptFault` EN `The setup database holds records that Waitron never deletes. An unfinished setup should hold none, so this is a fault in Waitron. Deleting this setup is not offered. Reconnect keeps everything as it is.`
    ES `La base de datos de configuración guarda registros que Waitron nunca borra. Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. No se ofrece borrar esta configuración. Reconectar lo deja todo como está.`
  - `tradingSaved` EN `This setup already saved the settings the box sells with, so deleting it is not offered.`
    ES `Esta configuración ya guardó los ajustes con los que vende el equipo, así que no se ofrece borrarla.`
  - `tradingSavedPassword` EN `To finish it, continue with your setup password.` ES `Para terminarla, continúa con tu contraseña de configuración.` (D5)
  - `setupFinished` EN `This setup already finished, so deleting it is not offered. Reconnect to check the saved result.`
    ES `Esta configuración ya terminó, así que no se ofrece borrarla. Reconecta para comprobar el resultado guardado.`
  - `wipeUnavailable` EN `This box cannot confirm that deleting this setup is safe, so it is not offered. Reconnect keeps everything as it is.`
    ES `Este equipo no puede confirmar que borrar esta configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.`
  - `heldChanged` EN `The setup changed after this page read it. Try again.` ES `La configuración cambió después de que esta página la leyera. Inténtalo otra vez.`
  - `setupDatabaseUnreadable` (new; OQ-B) EN `This box cannot read all of the setup database.`
    ES `Este equipo no puede leer toda la base de datos de configuración.`
  - `uncheckable` EN `This box cannot check the original setup password, so Continue is not offered.`
    ES `Este equipo no puede comprobar la contraseña original de configuración, así que no se ofrece Continuar.`
  - Removed keys (both locales): `heldRows`, `heldRowsOne`, `heldKept`, `heldKeptOne`, `heldInvoices`,
    `heldInvoiceOne`, `heldFault`, `startUnavailable`, `startUnavailableOccupied`, `damagedRecordPassword`.
  - Unchanged: `consumed`, `heldLost`, `noInvoiceSent`, `missingConfirm`, `retireConfirmed`,
    `recoveryRecordDamaged`, `recoveryDetailsUnread`, every "files found" string.
  - Refusal rule (CLAUDE.md §3, first bullet): every refusal above says what happened and what the
    offered choices do (Reconnect, or Continue with the setup password); none sends the person to
    anyone else. `keptFault` is the state only a bug produces and says so. The page never draws
    `shell.first_setup.owner_required` ("Resume setup in its owner tab.") in the wipe flow (D13).
- Spanish only in `initial-owner-strings.ts` and `apps/server/src/guide/es/` (CLAUDE.md §3).
- **TDD:** every behaviour test is written first and seen failing; the ledger records the failing
  title and the assertion it failed at. A test that passes before the change (a control, or a guard
  against a regression) is proved by deletion instead: the plan names what to remove, the ledger
  records the failure, then the code is restored and `git diff --exit-code` run on that file. Tests
  whose checks change by design are in "Changed test checks"; any other failing test is a STOP —
  report it, do not edit it. Between tasks, only suites a task names as "red until Task N" may be red.
- **Commands.** Server and provisioning:
  `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter <pkg> exec vitest run <files>`.
  Setup page (real Chromium): check `memory_pressure | grep free` first; run beside another browser
  run only well above 15% free; `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run <files>`.
  Read the `Tests` count every time, never an exit status alone. Root guards, from the worktree
  root: `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/<file>`.
  Full-disk suites need `hdiutil` on macOS (CLAUDE.md §4): read that they did not skip.
- Commits: `git commit -s`, plain-English messages naming each test check changed by design. Do not push.
- Personal data: the record keeps `displayName` and `email` (both on `PERSONAL_LOG_KEYS`); every new
  log reason carries counts and SQLite codes only, never SQLite's message (it can name a table).

## Current behaviour (e8cfd38ed; read, unless marked run)

- **The summary** (`apps/server/src/first-setup-resolution.ts:293-342`) refuses `setup.not_ready`
  for a present database with no stopped recovery (`:303`), always needs a recovered owner
  (`assertRecoveredOwner`, `:257-272`, called at `:311`), and beside a held database answers with
  the counts (`held`, `:338-339`, `heldShown` `:85-92`). The route reads the owner headers
  (`setup-first-fiscal-api.ts:1004`) and does not ask for a restart on
  `setup.start_again_incomplete`; the Start again route does (`:1071-1075`).
- **Start again** (`:343-525`): the held database (occupied, or no venue rows past `claimed`,
  `:370-373`) is offered only beside a stopped recovery (`assertHeldStartAgainOffered`, `found?.kind
  !== "stopped"` at `:78`) and needs the owner (`:395`); otherwise without an owner it accepts only
  an unused assignment or an empty unused workspace (`:401-408`), with an owner also a missing
  database (`:409-413`); `setup.start_again_password_required` is thrown for a damaged recovery-key
  record or a stopped recovery without an owner (`:433-434`). The record is written at `:468-478`
  for a missing database or a discarded recovery; it holds `administrator: { displayName, email }`
  (`packages/provisioning/src/first-setup-start-again-confirmation.ts:36-44`).
- **Counts on the wire**: the summary type's `held` (`first-setup-start-again-confirmation.ts:12-25`),
  the record's `heldShown` (`:94-114`, stored at `:149`), the route's `shownHeld`
  (`setup-first-fiscal-api.ts:109-125`, accepted by `shownSummary` `:90-107`), Start again's echo
  (`first-setup-resolution.ts:444-450`), and on the page `HELD_KEYS`/`readableHeld`/`sameHeld`
  (`apps/setup/src/first-setup-session.ts:79-95`), `summaryOf`/`sameSummary` (`:124-150`), the
  types (`apps/setup/src/api/first-setup-types.ts:133-147`) and the refusal block `heldRefused`
  (`apps/setup/src/setup-app.ts:2607-2621`, drawn at `:2665`).
- **The holdings read** (`apps/server/src/first-setup-database-holdings.ts:42-96`) opens the
  database in place, or copies it when a `-journal` exists or the `-wal` holds pages, then counts
  every table and runs each module's `startAgainHoldings` (`:98-151`). One `catch` (`:80-84`) turns
  any failure into `setup.not_ready` and discards what was counted. With a `-journal` beside the
  database it reads a private copy opened read-write (`:59`, `:75-77`), so SQLite rolls that journal
  into the copy first.
- **The wipe's side files** are `-wal` and `-shm` only (`packages/provisioning/src/first-setup-start-again-deletion.ts:36`),
  so a leftover `venue.db-journal` stays after a wipe; the fresh-box restore moves aside only
  `venue.db`, `-wal` and `-shm` (`apps/server/src/restore.ts:543-555`, `SIDE_FILE_SUFFIXES`
  `packages/store/src/index.ts:55`). The "files found" survey already counts `-journal` as part of
  a database (`first-setup-start-again-leftovers.ts:51`).
- **Which damage reaches what (run, `~/waitron-campaign/a1131bc-2-rev4-probe/output.txt`):** see
  "Experiments for this revision". In short: damage in the `tenants` table (or the file header) is
  labelled `corrupt` and refused before anything is read; damage anywhere else is labelled
  `occupied` and refused by the holdings read; in every page-damage case the read's log reason
  carries SQLite code 11 or 26.
- **The inspection's other labels**: `partial` on "no such table", `unknown` for any other error
  (`first-setup-resolution-inspection.ts:96-108`), `unreadable` when `venue.db` is not a plain file,
  cannot be opened, or is over 128 MiB (`:48-58`). A no-venue-rows database's emptiness check
  swallows its own errors (`packages/provisioning/src/first-setup-empty-database.ts:106-108`), so
  damage there shows only as `emptyDatabase: false`, which the not-held path refuses
  (`first-setup-resolution.ts:401-413`, via `presentAttemptEligibility` `:142-164`).
- **The page**: the saved-settings words are drawn on load from the inspection beside a stopped
  recovery (`setup-app.ts:2517-2532`). Start again is enabled only for an empty database, or a held
  one beside a stopped recovery, with the password checkable (`setup-app.ts:2541-2549`, `presentStartAgainAllowed`
  `:237-242`); beside a stopped recovery it opens the password step (`:2575-2579`,
  `#unlockDamagedRecordStartAgain` `:1505-1527`, `#openPresentConfirmation` `:1533-1570`); a
  `password_required` answer opens it too (`:1465-1479`); with the database missing the ask appears
  only after Continue's password, and only when the setup is not finished (`#resumeFirstSetup`
  `:1303-1365`, missing branch `:1339-1342`; a finished one goes to the first-owner screen,
  `:1344-1349`, where nothing is offered but Reconnect). A summary or Start again refused
  `setup.owner_required` draws `shell.first_setup.owner_required`, "Resume setup in its owner tab."
  (`apps/setup/src/i18n/strings/shell.ts:4`). With the password uncheckable the inspection also has
  no `revision` (both come from the same unreadable setup record,
  `first-setup-resolution-inspection.ts:362-364`), and the server refuses Start again without it
  (`first-setup-resolution.ts:304-305`, `:362-363`).
  The client sends owner headers to both routes (`apps/setup/src/api/client.ts:644-675`).

## Experiments for this revision

1. **Damage classification on real setup databases** (run 2026-10-30; probe
   `~/waitron-campaign/a1131bc-2-rev4-probe/zz-probe.test.ts.txt`, README written before running).
   `heldSetup()` from `apps/server/test/held-setup-database.ts`, WAL checkpointed (`busy 0`,
   `-wal` absent after), then one page shape damaged with `0xab` bytes over the root pages of a table
   and its indexes (from `sqlite_schema.rootpage`). `env -u AI_AGENT -u CLAUDECODE
   TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run
   src/zz-a1131bc-2-rev4-probe.test.ts` → "Tests 9 passed (9)". Printed (label / reader / summary
   with the password, as today):

   | Case | Label | Holdings read | Summary today |
   | --- | --- | --- | --- |
   | healthy, 1 invoice (control) | occupied | rows 112, kept 6, records 1 | answers with counts |
   | invoice table + its indexes, 1 invoice | occupied | not_ready "read failed: ERR_SQLITE_ERROR 11" | same |
   | largest other table (`department_days`) | occupied | not_ready "… 11" | same |
   | `tenants` + its index | corrupt | not_ready "… 11" | not_ready (before the read) |
   | `tenants` + index, 1 invoice | corrupt | not_ready "… 11" | not_ready |
   | page 1 (header and schema) | corrupt | not_ready "… 26" | not_ready |
   | whole file junk bytes | corrupt | not_ready "… 26" | not_ready |
   | 0-byte file | partial | not_ready "… 1" | not_ready |
   | no read permission (control) | unreadable | not_ready "database unreadable: open … 14" | the probe's sign-in threw EACCES first; summary not reached |

   The failing cases written first, none seen: a page outside `tenants`/`locations` labelled
   `corrupt` (which would have overturned round-3 I1's finding); page damage giving a reason
   without code 11 or 26; the permission control giving 11 or 26; a 0-byte file not `partial`. A
   first run damaging only a table's root page left every answer unchanged (`count(*)` and the
   `tenants` read used an index; that run's printout is in the README), which is why the probe damages
   indexes too and why Task 4a's fixtures must.
2. **A leftover rollback journal from another database** (run by review 4,
   `~/waitron-campaign/a1131bc-2-rev4-review4/journal/`; re-run by the planner 2026-10-30 with
   `node probe.mjs` → same printout but byte counts, `output-rerun-planner.txt`). A hot journal
   (pages spilled with `cache_size=10`, writer killed mid-transaction: header valid, `nRec` 7) beside
   an intact database holding 2000 `sales` rows and 1 `registros` row. Control without the journal:
   `sales` 2000, `registros` 1, integrity ok. With it: a read-only open (as the inspection opens)
   fails with code 776; a private copy opened read-write (as the holdings read opens it) rolls the
   wrong journal in, shrinks from 643072 to 184320 bytes, and every table fails with code 11; an
   in-place read-write open does the same to the original. Review 4's case C ran this on the real
   code: `heldSetup({ invoices: 1 })` plus that journal → label `unknown`, holdings read
   `"read failed: ERR_SQLITE_ERROR 11"`, original bytes unchanged. Revision 4's own journal probe is
   withdrawn: its journal never spilled pages, so SQLite never treated it as one to roll back.
3. **What stays readable when only the invoice table is damaged** (run; `~/waitron-campaign/a1131bc-2-rev4-probe/oqc/`).
   Failing case written first: no other append-only table an invoice writes to stays readable with
   rows. `heldSetup({ invoices: 1, recovery: false })`, checkpointed, `registros_facturacion` and its
   indexes' root pages damaged, then each table counted on its own → "Tests 2 passed (2)". Tables
   whose count differs from a no-invoice setup: `sales` 1, `sale_lines` 2, `tenders` 1,
   `sale_settlements` 1 (all append-only, all still readable), `envios` 1 (not append-only,
   readable), `registros_facturacion` "errcode 11". So the failing case did not occur.

4. **Review 4's cases on the real code** (run by review 4, `~/waitron-campaign/a1131bc-2-rev4-review4/vt/`,
   "Tests 3 passed (3)"). A: `department_days` and its indexes damaged, no invoice → label
   `occupied`; `registros_facturacion` reads 0 and the fiscal module's own queries answer
   `{"records":0,"accepted":0}`; the holdings read fails with code 11 (so the box did read the
   invoice table — I2). B: `registros_facturacion` and its indexes damaged, no sale → label
   `occupied`; the only other non-zero append-only table is `fiscal_allocations` (deletable,
   `FISCAL_START_AGAIN_DELETABLE`); the read fails with code 11 (the owner's own example — I5).
   C: the hot journal above.

## Decisions where the spec leaves a choice

- **D1 — One assessment.** Both actions call one internal `assessStartAgain(request, kind)` that runs
  every §1a check in today's Start again order, so the summary refuses exactly what Start again
  would and answers for every offered case: empty unused, held (with or without a stopped recovery),
  missing, damaged, damaged recovery-key record. The page reads it before every confirmation (D7).
- **D2 — The merged acceptance rule** is today's owner branch without `assertRecoveredOwner`
  (`first-setup-resolution.ts:409-413`): refuse `no-current-master` unless the workspace is empty
  and unused; refuse a present, readable, not-held database unless the workspace is empty and unused
  or the assignment is unused. The inspection tests "absence of a paper signer does not make %s
  history eligible for password-free reset" and "a no-master declaration cannot clear saved
  consumption intent" (`first-setup-resolution-inspection.test.ts:118`, `:130`) stay green unedited.
- **D3 — The damaged database (OQ2 widened).** `readSetupDatabase` (Task 4a) reads table by table and
  module by module, each in its own `try`, keeps every count it got, and answers either
  `{ kind: "read", holdings }` or `{ kind: "damaged", code, seen }`. Damage is a step failing with
  SQLite errcode 11 or 26 (primary code, `errcode & 0xff`), or, from Task 4d, "no such table"
  (code 1 with that message, matched in the reader only). **Except:** when any `-journal` sat
  beside the database when the read began, a failure is never damage — it answers
  `setup.not_ready` (review 4, I1: another database's journal rolled into the copy produces exactly
  that code-11 failure on an intact database). Every other failure — the journal check, the copy, a
  full disk, open code 14, a module's own `AppError` — stays `setup.not_ready`, as today. `code` is
  `errcode 11`, `errcode 26` or `no such table`, never SQLite's message. The assessment then goes by
  the inspection's label `L`, the attempt status `S`, and `PRESENT` = claimed, consumption-intent,
  abandoned (`first-setup-resolution.ts:182-186`):

  | Row | When | What the box does |
  | --- | --- | --- |
  | a | `L` missing | the missing-database path, as today (no password) |
  | b | `L` no-venue-rows, `S` in PRESENT, empty | today's unused-setup proof (D2) |
  | c | `S` in PRESENT and either `L` no-venue-rows not empty, or `L` corrupt/unknown/partial | NEW: read; no damage → `setup.not_ready` (as today); `damaged` with kept seen → `kept-records`; `damaged` with nothing kept seen → trading.env refuses `trading-settings`, else the unused-setup proof with the database counted as empty → offered as "cannot be read" |
  | d | `L` occupied, or no-venue-rows with `S` not in PRESENT (today's held) | today's held checks (trading-settings, setup-finished) without the stopped-recovery condition; read; kept seen → `kept-records`; `damaged` → offered as "cannot be read"; read with 0 rows → `setup.not_ready`; else offered |
  | e | `L` corrupt/unknown/partial, `S` not in PRESENT | trading-settings, setup-finished; read; kept seen → `kept-records`; `damaged` → offered as "cannot be read"; read with no damage → `setup.not_ready` (label and read disagree) |
  | f | `L` unreadable | `setup.not_ready`, as today (N1) |

  `partial` joins rows c and e in Task 4d; until then it stays in row f. Row c keeps A1161's limits
  (a public record or documents file, an outside record) because they are part of the unused-setup
  proof, not about damage. Every row keeps the later checks: outside evidence, the disk and layout
  check, `restore-request.json`, the marker's size, a pending deletion. "Kept seen" means
  `seen.kept > 0 || seen.records > 0` (N2). **`node.db`** (Task 4d): the disk check's "node.db
  unreadable" refusal (`packages/provisioning/src/first-setup-start-again-deletion.ts:470-483`) stops
  refusing when the failure is damage (same codes, same journal exception); the summary then carries
  `databaseUnreadable`, and the wipe deletes `node.db` as it already does (`itemsOnDisk`, `:296`).
  "node.db holds a table" and "node.db-wal holds pages" keep refusing.
- **D4 — Shown and confirmed.** A damaged database's summary carries `databaseUnreadable: true`.
  Start again then needs `confirmUnreadableDatabase: { shown }` (or, beside a stopped recovery,
  `confirmRecoveryDiscard: { shown }` whose `shown` carries it), compared deep-equal with the box's
  own summary; a damaged database without it, or the field without damage, is
  `setup.attempt_conflict`. It writes a record with `database: "unreadable"` (§4's fourth case).
- **D5 — The saved-settings words.** `tradingSaved` and `tradingSavedPassword` are two keys (§9e
  keeps the second; its text becomes §9c's second sentence), drawn together, so the text is exactly
  §9c's. They are drawn only from the box's `trading-settings` refusal after pressing Start again
  (D7); today's on-load drawing from the inspection (`setup-app.ts:2517-2532`) goes. Pressing needs
  a readable setup record, which always comes with a checkable password
  (`first-setup-resolution-inspection.ts:362-364`), so Continue is always there to finish it.
- **D6 — The record** becomes `version: 2` with `setupAdministrator: { displayName, email }`,
  `confirmedOn: "repair-page"`, `signedIn: false`, `database: "missing" | "present" | "unreadable"`,
  and `shown` without `held`. No product code parses a record back: outside tests, `rg -l
  "START_AGAIN_CONFIRMATIONS_DIR|first-setup-start-again-confirmations"` (run 2026-10-30) finds the
  writer and its export, `FIRST_SETUP_HOST_FILES` (a list of paths, `first-setup-state.ts:155`), the
  records guard, `deploy/waitron.sh` and `deploy/README.md`; tests list the folder or read records
  they wrote. So no compatibility code (CLAUDE.md §3, pre-live).
- **D7 — The page reads the summary when Start again is pressed**, never on load (spec §1 step 1). A
  refusal hides Start again and draws its words. The one on-load refusal line: with the password
  uncheckable the setup record cannot be read, Start again is not offered, and the page draws
  `uncheckable` and `wipeUnavailable` (both approved words) — no other state draws refusal words on
  load. **Recover from backup is left exactly as today**; making it the wipe and hiding it beside a
  refusal is slice 3.
- **D8 — With the database missing the page no longer offers Continue.** For a setup that is not
  finished, Continue's password led only to the Start again ask (`#resumeFirstSetup` `:1339-1342`),
  which now opens from Start again. For a finished one it led to the first-owner screen with nothing
  offered but Reconnect (`:1344-1349`); now Start again's summary refuses `setup-finished` and the
  page draws `setupFinished`, which says what happened and what Reconnect does.
- **D9 — The kept-records log reason** is `rows=<n> kept=<n> records=<n> accepted=<n>` on the
  summary's refusal and on Start again's; when the read was `damaged` it adds `damaged=<code>`.
- **D10 — The damaged-database line** (`setupDatabaseUnreadable`) goes where the recovery-key line
  goes, above `start-again-deletes`, which then shows `heldLost` alone.
- **D11 — A readable held database with no stopped recovery is wiped without an echo or a record**:
  the page sends no `confirm*` field and §4 lists no record for it. What guards it: the inspection id
  pins the database's bytes (`first-setup-resolution-inspection.ts:279-280` fingerprint `venue.db`
  and `venue.db-wal`, digested into the id at `:370`), and the box refuses kept rows and invoices at
  the send. A fifth record case is the owner's to add. Stated in the PR.
- **D12 — The summary route asks for a restart on `setup.start_again_incomplete`**, as the Start
  again route does: under D1 the page reads the summary first, so a pending marker would otherwise
  leave the page stuck until the box restarts.
- **D13 — Plain HTTP keeps answering `setup.owner_required`**; renaming the code is out of scope.
  Inside the wipe flow the page's `wipeRefusal` maps it to `"unavailable"` and draws
  `wipeUnavailable`, never "Resume setup in its owner tab." (false for a password-free Start again,
  and it sends the person elsewhere). The page's "Set up secure connection" link stays drawn. A
  backlog line asks for words saying a secure connection is needed (N5, Task 9).
- **D14 — What anyone on the network can now read and cause**: the summary answers without a
  password, so anyone who can open the page sees what the setup reached, any stopped recovery's
  times, and whether the setup database could be read; and each summary of a held or damaged
  database reads it (and may copy it), with no password throttle. Added to the spec's §3 cost list,
  the guide and the PR (Task 9).
- **D15 — The wipe deletes `venue.db-journal` and `node.db-journal`** (review 4, I1): added to
  `SIDE_FILES` (`first-setup-start-again-deletion.ts:36`), which are deleted without comparison
  against the marker (`:516`). Always safe: the database each belongs to goes in the same pass. Why:
  otherwise a hot journal stays beside the venue folder, and the fresh-box restore, which moves aside
  only `-wal` and `-shm`, leaves it beside the restored database, whose first read-write open rolls
  it in (experiment 2 shows that open corrupting an intact database).

## Changed test checks (the PR description names each)

Rows are by title at e8cfd38ed; line numbers drift.

**Classes** (apply wherever they occur; the ledger lists each file touched):

| Class | Old | New | Why |
| --- | --- | --- | --- |
| M1 | a direct `startAgainSummary`/`startAgainFirstSetup` call passes `owner` | no `owner` key; **keep** any `recoverFirstSetupOwner`/`signIn` step the test runs first (its own side effects stay under test) | §3 |
| M2 | a record fixture or assertion reads `administrator` or `version: 1` | `setupAdministrator`, `confirmedOn: "repair-page"`, `signedIn: false`, `version: 2` | §4, D6 |
| M3 | a summary fixture or expectation carries `held` | the same without `held` | counts leave the wire |
| M4 | a route call sends owner headers to the summary or Start again route | sends none | §3 |

**Server and provisioning:**

| Test | Old | New | Why |
| --- | --- | --- | --- |
| held: "a legitimate held setup database beside a stopped recovery answers the summary with what it holds" | `toEqual` with `held` | same without `held`; retitle "…answers the summary" | counts gone |
| held: "a held setup database with an invoice record still answers the summary, counting it" | resolves, `held.records` 1 | rejects `setup.start_again_refused` `{ cause: "kept-records" }`, disk unchanged | D1, §1a |
| held: "a held setup database with no recovery started is still refused setup.not_ready…" and "…still refuses Start again setup.not_ready…" | refused | deleted; Task 3's offered-without-recovery test replaces them | §1a row 4 |
| held: "%s with no recovery started is refused setup.not_ready, not start_again_refused…" | `not_ready` | `start_again_refused` with `trading-settings` / `setup-finished`; retitle | D1, §1a |
| held: "a database read as %s beside a stopped recovery (%o) is still refused setup.not_ready…" | four rows `not_ready` | `unknown {}` and `partial {}` unchanged (the label is stubbed over a readable database: no damage → `not_ready`); `unknown {tradingSettings}` → `trading-settings` (Task 4c-1); `partial {tradingSettings}` → `trading-settings` from Task 4d | D3 rows e, f |
| held: "in the held state, a confirmation whose summary has no held counts is refused setup.attempt_conflict…" | conflict | deleted; Task 1's route test refuses a `held` key | counts gone |
| held: "in the held state, the Start again route passes the shown held counts on…" | shown carries counts | carries none; retitle | counts gone |
| held: "in the held state, Start again confirming the summary deletes the setup, and keeps who chose it" | `administrator` | M2; retitle "…keeps whose setup it was" | §4 |
| route: "HTTPS lets a shown summary carrying held counts past the body check, and refuses a malformed one" | `held` accepted | any `held` key → 400 `setup.request_invalid`; the other malformed cases kept | counts gone |
| full-disk e2e: "in the held state, with the box's spare file, the summary answers with what the setup database holds…" | counts | no counts; retitle | counts gone |
| provisioning confirmation: "a confirmation that discards a stopped recovery beside a held database keeps what it held", "a held database with an invoice record its module lists as deletable is kept as shown" | `held` stored | deleted; new "a shown.held key is not stored in the record" | counts gone |
| provisioning choose: "Move then finishes Start again …" (record fixture `:608`) | `administrator`, no version | M2 on the fixture only; assertions unedited | D6 |
| start-again: "the summary refuses an owner who has not recovered the attempt" | `owner_required` | deleted; Task 2a's "the summary answers with no owner, for a missing database" replaces it | §3 |
| start-again: "the summary route refuses when the database is present" | 503 `not_ready` | 200 with `{ reached }`; retitle | D1 |
| start-again: "the summary route refuses without the owner headers" | `owner_required` | 200 with the summary; retitle | §3 |
| start-again: "the password-required refusal answers 403 over HTTPS" | 403 | deleted with the code; Task 2a's "Start again over HTTPS with no owner headers starts again" replaces it | §3 |
| start-again: "a damaged record with no owner still refuses for a marker over its limit, before asking for the password…" | same | same assertion; retitle without "before asking for the password" | §3 |
| start-again: "the Start again route passes recoveryRecordDamagedShown on: with the owner and a damaged record…" | owner headers, password step | no headers; keep the password step only if the test needs its side effect, else drop it; retitle | §3 |
| start-again: "a corrupt venue database beside a damaged picks file is refused setup.not_ready…" | `not_ready` | without `confirmUnreadableDatabase` → `attempt_conflict`, nothing changes; with it → deleted, record `database: "unreadable"` | D3 row c, D4 |
| inspection: "password-free Start again refuses a %s database" | three rows `not_ready` | `missing` unchanged; `corrupt` → `attempt_conflict` without the echo, nothing changes (Task 4c-1); `partial` (0 bytes) → the same from Task 4d | D3 row c |
| hour-finish: "password-free hour restart refuses a %s database" | `corrupt` row `not_ready` | `attempt_conflict` without the echo, originals unchanged | D3 |
| hour-finish: "a missing hour database refuses a confirmed Start again from an owner whose latest event is not a fresh recovery" | refused | deleted; replaced by "…a confirmed Start again with no owner goes ahead" | §3 |
| unused-pdf: "a damaged recovery-key record (%s) asks for the setup password instead of starting again without one, and nothing changes" | `password_required` | without `recoveryRecordDamagedShown` → `attempt_conflict`, nothing changes; with it → deleted; retitle | §3 |
| unused-pdf: "a rehashed document with an invalid module confirmation cannot authorise unused-PDF reset without the setup password" | `password_required` | same two-way shape; retitle | §3 |
| unused-pdf: "a damaged recovery-key record alone asks for the setup password with no params" | `password_required` `{}` | two-way shape; retitle | §3 |
| unused-pdf: "a damaged record beside a refused artifact refuses setup.not_ready without asking for the password" | `not_ready` | same; retitle | §3 |
| unused-pdf: "with the setup password …" cases (`:343`, `:359`, `:401`, `:432`) | password step first | M1; retitle without "with the setup password" | §3 |
| backup-discard: "with the database present, the password and the confirmed summary discard a stopped recovery, with a record of who chose it" | password, `administrator` | no password; M2; retitle "…with a record of whose setup it was" | §3, §4 |
| backup-discard: "…a stopped recovery's Start again without the setup password is refused setup.start_again_password_required…" | refused | goes ahead; the recovery is discarded; retitle | §3 |
| backup-discard: "with the database present and no recovery, the summary refuses setup.not_ready and confirmRecoveryDiscard is refused…" | summary refused | summary answers with no `recovery`; the `confirmRecoveryDiscard` half unchanged | D1 |
| holdings: "answers setup.not_ready when the database file cannot be read" (`"not a database"`) | `not_ready` | `{ kind: "damaged", code: "errcode 26" }`, every count 0 | D3 |
| deletion (provisioning): side files | `-wal`, `-shm` deleted; a `-journal` left | also `venue.db-journal`, `node.db-journal` deleted; any existing case listing what a wipe leaves (`first-setup-start-again-marker.test.ts`, `expectOnlyKept`) gains or loses the journal only | D15 |
| full-disk e2e: "with the box's spare file, the password step, the summary and Start again all work on a full disk…" | password step first | M1: the password step dropped from the flow; retitle without "the password step" | §3 |

Unchanged on purpose (must stay green unedited): "with the database present, a damaged %s still
refuses Start again setup.not_ready…" (A1161), the two A1158 cases ("…refused setup.owner_required
at the password step", "…refused setup.attempt_conflict for the revision it sends"), every
`recovery-start-again.test.ts` and `first-setup-start-again-choose.test.ts` case but the one fixture,
"a stopped recovery beside trading.env: Start again refuses setup.not_ready…" (backup-discard,
`selectedRepair` fixture; which check refuses it was not traced for this revision — if it turns
red, STOP), and the holdings cases for a failed copy and a module seat's code. The holdings case "reads through a
private copy, read-write, when a leftover -journal sits beside the database" stays green: its hot
journal is the same database's own (copied mid-transaction, `:219-237`), so rolling it back gives
the right database, the read succeeds, and D3's journal exception (which acts only on a failure)
never applies; if it turns red, STOP. "without a spare file, the password step of the Start-again flow on a full disk answers 507"
stays: the password route is still Continue's and still a Start-again route for the spare release.

**Setup page** (titles at e8cfd38ed, classified from titles; every test in a class keeps its
non-password assertions: enabled/disabled, order, request body, Cancel, Check again, restarting):

| Class | Tests | Old → New | Why |
| --- | --- | --- | --- |
| P1 retired | `setup-app-resolution.test.ts`: "with the database present and no stopped recovery, a password refusal with params %o reads no summary and keeps today's warning", "a damaged recovery-key record asks for the administrator password…", "Cancel at the password step sends nothing and offers Start again again", "Continue after Cancel at the warning sends recover, never resume…", "a wrong password there keeps Start again offered…", "Cancel at the password step reached from Start again…", "Cancel at the password step reached after a refused Start again…", "the password step calls recover, never resume…", "a refused Start again at the warning goes back to the password step…", "the password step draws neither Abandon nor…", "an abandoned attempt's warning and its password step after a refused send…", "a refused Start again from the held confirmation goes back to the password step…", "a wrong password at the damaged-record password step…", "Continue at the damaged-record password step with no password…", "a damaged record's Start again refused storage.disk_full … goes back to the password", "the password step refused storage.disk_full says the disk is full"; `setup-app-missing-database.test.ts`: "keeps a missing database on repair after password recovery…", "retires only after password recovery, confirmation and a fresh owner-bound missing inspection", "requires password recovery again after a refused retirement…", "shows none of the ask's lines before the password step", "shows the before-password line only before the password step", "explains a password step refused because a recovery is in progress"; `first-setup-retirement.test.ts`: "retires recovered %s work and requires password recovery even after a refresh", "after a sent Start again with the database present, the stopped recovery's summary and another Start again need the password again…"; `setup-app-resolution.a11y.test.ts`: the `password` states (the code at `:162`) | the password state deleted from the loop, or the test deleted; Task 6b-1's `setup-app-wipe.test.ts` pins "no password field, no owner header" for each case | §3 |
| P2 password removed from the path | every other test in those files whose setup types a password to reach Start again's confirmation (titles with "after the password", "the password, then…", "…stopped recovery…", "…damaged…") | the password step removed; the summary read on pressing Start again; other assertions kept | §3, D7 |
| P3 counts | `setup-app-held-refusals.test.ts` (whole file), `first-setup-retirement.test.ts` "a setup database holding records with no stopped recovery drawn still refuses Start again, even with held counts", "refuses a summary whose held counts changed…" | count lines → §9c words from the refusal cause; count-changed cases deleted (the box refuses at the summary now); "no stopped recovery … refuses" → offered | counts gone, §1a row 4 |
| P4 offer gating | "does not offer password-free retirement of a %s database", "a database holding records with no stopped recovery keeps Start again disabled and says why…", "saved trading settings beside a stopped recovery and a database holding records keep Start again disabled", "offers no Start again in the ask while a backup recovery's journal reports %s", "does not offer missing-database retirement for %s work" | Start again is offered; pressing it draws the box's refusal words or the ask | D1, D7 |
| P5 moved | the session-method cases of `first-setup-retirement.test.ts` (`missingDatabaseSummary`, `retireMissingDatabase`, `stoppedRecoverySummary`, `retireDamagedRecord`) | moved to `apps/setup/src/start-again-wipe.test.ts` against `readWipeSummary`/`sendWipe`; every "changed between display and confirmation … sends nothing" assertion kept | Task 6a |
| P6 words | slice-1 assertions on `startUnavailable*`, `heldChanged`, `uncheckable`, `tradingSaved` texts | §9c/§9e words | §9 |
| P7 real pairing | `setup-app-held-refusals.test.ts` "saved trading settings where the password cannot be checked leave off the sentence about the password" (`:185`, which pairs `password: "uncheckable"` with a revision the box never sends) | inspection with `revision: null`, `ownerGeneration: null`: no Start again, `uncheckable` and `wipeUnavailable` drawn, no `tradingSaved`; retitle | D5, D7 (review 4, I4) |
| P8 extended | `setup-app-resolution.test.ts` "explains an uncheckable password and sends no secret" | unchanged assertions, plus `wipeUnavailable` drawn | D7 |

## Review Focus

1. **An operational failure is never damage.** A full disk or failed copy beside a database holding
   an invoice, and a `venue.db` the box may not open, answer `setup.not_ready`, never "cannot be
   read". Tasks 4a, 4c-1.
2. **Another database's journal never makes an intact database deletable** (D3's journal exception,
   D15). Tasks 4a, 4b, 4c-1.
3. **A readable database labelled corrupt/unknown is never deleted as unreadable**: with an invoice,
   `kept-records`; with none, `setup.not_ready` (D3 row e). Task 4c-1, by stubbing the label over a
   real held database.
4. **A damaged table beside readable kept rows** refuses `kept-records` and deletes nothing. Task 4c-1
   (the `tenants`-with-invoice shape from experiment 1, and N2's invoice-table-with-sale shape).
5. **A damaged database is deleted only after the page showed "cannot be read"** (D4). Task 4c-2.
6. **A send refused `kept-records` after the page drew a confirmation** closes it, draws
   `heldChanged`, and offers Start again again (whose summary then draws `keptFault`). Task 7a.

## Overlap with #2251 (A1207, open, parked for the owner)

`gh pr diff 2251 --name-only` (run 2026-10-30) against this plan's files:

| File | #2251 changes | This plan changes | Handling |
| --- | --- | --- | --- |
| `apps/server/src/guide/en/backup-recovery.md`, `…/es/…` | the recovery-controls paragraph (EN ~`:123-128`) | the Start again paragraphs (EN `:26-37`) | different hunks; whichever lands second rebases |
| `docs/operations/first-live-fiscal-setup.md` | the clock-wait list (`:44-58`) and one clause at `:88-89` ("and later than every name the box can still read") | `:84-92`, `:97-104`, `:114-124` | same paragraph at `:84-92`: change only the sentences about Start again's limits and password; leave `:87-89` (the naming clause) exactly as it is |
| `docs/backlog.md`, `docs/backlog/setup.md` | its own entries and the A1206 decision text | the A1131c, A1159, full-disk, summary-cause entries and two new lines | different entries |
| `apps/server/src/first-setup-retired-assignments.test.ts` | two new tests after "ordinary hour preparation retains…" | M1/M2 edits only (Task 2b) | different hunks |

Not touched here, to stay clear: `CLAUDE.md`, `docs/developers/conventions-data.md` (its stale
`:3339`, N4, is a follow-up line in the backlog), `apps/server/src/hour-recovery-host.test.ts`,
everything in `packages/fiscal-verifactu`.

---

### Task 1: The counts leave the wire; the summary refuses kept records

**Files:** `packages/provisioning/src/first-setup-start-again-confirmation.ts` (drop `StartAgainHeld`,
`HELD_KEYS`, `heldShown`, the `held` member and its line in `confirmation()`),
`packages/provisioning/src/index.ts` (`:183`, stop exporting `StartAgainHeld`),
`apps/server/src/setup-first-fiscal-api.ts` (`shownSummary` `:90-107` loses `held`; delete
`shownHeld` `:109-125` and its import `:17`), `apps/server/src/first-setup-resolution.ts` (delete
`heldShown` `:85-92`; the summary throws `refused("kept-records")` with D9's reason when the
holdings show kept rows or records; Start again's refusal at `:400` gets the same reason; the echo
at `:444-450` loses `held`). Tests: M3 and the counts rows above.

**Consumers traced** (`rg -l "StartAgainHeld|heldShown|shownHeld|readableHeld|\.held\b" apps packages scripts`,
run 2026-10-30): provisioning confirmation and its test; server resolution, route parser,
`first-setup-start-again-held.test.ts`, `first-setup-resolution.route.test.ts`,
`start-again-full-disk.e2e.test.ts`; setup page types, session, `setup-app.ts`, its tests and
`apps/setup/test/held-database-browser.ts`. The page keeps its own JSON types and accepts a summary
with no `held` (`first-setup-session.ts:135`), but its `stoppedRecoverySummary` refuses a held
database's summary without one (`:747-748`): the real page beside a held database is broken from
here until Task 6b-1. Page suites mock the API (read), so they stay green.

- [ ] **Step 1: Failing tests.**
  - route test "a shown summary carrying held counts is refused setup.request_invalid", one case each
    for `confirmMissingDatabase.shown.held` and `confirmRecoveryDiscard.shown.held`. Fails at the
    status check: today the parser accepts valid counts.
  - held test "a held setup database with an invoice record refuses the summary kept-records, and
    nothing changes" (`expectRefused`, `heldSetup({ invoices: 1 })`). Fails: the summary resolves.
  - held test, route level, "the summary's kept-records refusal logs the counts, not the answer":
    capture the `log` given to `mountFirstSetupResolutionApi`; the `warn` line for
    `setup.start_again_refused` has `logReason` matching `/rows=\d+ kept=\d+ records=1 accepted=0/`
    and the JSON answer is exactly `{ error: { code, params: { cause: "kept-records" } } }`.
  - provisioning "a shown.held key is not stored in the record". Fails: the record keeps `held`.
- [ ] **Step 2:** run `… pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-resolution.route.test.ts`
  and `… pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts`;
  the new cases fail as stated.
- [ ] **Step 3: Implement** as listed; apply M3 and the counts rows.
- [ ] **Step 4:** the Step 2 files plus `src/start-again-full-disk.e2e.test.ts`; typecheck both packages.
- [ ] **Step 5:** commit.

### Task 2a: No password for the wipe; one assessment; records say nobody signed in

**Files:** `apps/server/src/first-setup-resolution.ts` (the whole `createFirstSetupResolutionActions`
body), `apps/server/src/setup-first-fiscal-api.ts` (summary route stops calling `firstFiscalOwner`
`:1004` and asks for a restart on `setup.start_again_incomplete`, D12; Start again route stops
passing `owner` `:1066-1068`; drop the status line `:38`), `apps/server/src/errors.ts` (retire
`setup.start_again_password_required`, `:1046`), `packages/provisioning/src/first-setup-start-again-confirmation.ts`
(D6 shape with `database: "missing" | "present"`; `"unreadable"` is Task 4c-2's). The page's branch on
that code (`apps/setup/src/setup-app.ts:1465-1479`) goes in Task 6b-1. The PR carries N3 (what the
removed password step also ran). Tests: only the new ones below
plus the rows of the start-again, backup-discard and hour-finish files; the unused-pdf rows are 2b's.

**Interfaces — Produces:**
- `StartAgainSummaryRequest = { inspectionId: string; revision: number; ownerGeneration: number }`.
- `StartAgainFirstSetupRequest` = today's minus `owner`.
- internal `assessStartAgain(request, kind: "summary" | "start-again")`: today's checks merged in
  Start again's order, with the disk check before the holdings read in both (as the summary does
  today, `:318`), returning what the summary and the send need (`state`, `found`, `recovery`,
  `missing`, `held`, `holdings`, `discarding`, `box`, `recoveryRecordDamaged`). The summary's
  `recoveryRecordDamaged` is the value Start again compares, so the page can echo it.
- Without D3 rows c and e yet (Task 4c-1): a corrupt or unknown label is refused `setup.not_ready`, as today.

- [ ] **Step 1: Failing tests.**
  - start-again "the summary answers with no owner, for a missing database" (action level). Fails:
    `setup.owner_required`.
  - start-again "Start again over HTTPS with no owner headers starts again" (route, TLS socket as
    `postSummary` does; answer `{ restarting: true }`; `expectStartAgainDeleted`). Fails: today's
    no-owner branch refuses the missing database (`:401-408`).
  - start-again "a plain-HTTP request to the Start again route is refused, and nothing changes"
    (`incoming: { socket: new Socket() }`, as "the summary route refuses over plain HTTP" does;
    `setup.owner_required`; attempt files unchanged; no confirmations folder). It passes today; prove
    it by deletion: comment out `assertHttps(c)` at the Start again route, see it fail, restore,
    `git diff --exit-code` on that file.
  - start-again "a summary with a deletion already marked answers setup.start_again_incomplete and
    asks for a restart" (route; `requestRestart` spy called once). Fails: no restart (D12).
  - inspection "with an empty unused setup, the summary answers, and Start again deletes it with no
    owner" (`actionsFixture`, no `register`). Fails: the summary refuses `not_ready` (`:303`).
  - damaged-recovery "with an empty database and a damaged recovery-key record, the summary carries
    recoveryRecordDamaged; Start again without the flag is refused setup.attempt_conflict, and with
    it deletes the setup". Fails: summary `not_ready`.
  - provisioning "a record is version 2, names whose setup it was, and says it was confirmed on the
    repair page with nobody signed in" (`Object.keys` order pinned, as the file's key test is).
- [ ] **Step 2:** run `… @waitron/server exec vitest run src/first-setup-start-again.test.ts src/first-setup-resolution-inspection.test.ts src/first-setup-start-again-damaged-recovery.test.ts src/first-setup-resolution.route.test.ts`
  and the provisioning confirmation file; the new cases fail as stated.
- [ ] **Step 3: Implement.** Write `assessStartAgain`; delete `assertRecoveredOwner` and its calls;
  apply D2; delete the `password_required` throw (`:433-434`); keep every other refusal, the two
  "no await" invariants (`:465-467`, `:480-482`) and `markerFor`'s size check. The record:
  `setupAdministrator` from `state.frozen.request.admin`, `confirmedOn: "repair-page"`,
  `signedIn: false`, `version: 2`.
- [ ] **Step 4:** the Step 2 files green, plus `src/recovery-start-again.test.ts` (unedited) and
  `scripts/errors-reachable.test.ts`. Typecheck server and provisioning. **Red until Task 2b, by
  design:** the M1/M2/M4 files not yet edited — record each failing title against its class.
- [ ] **Step 5:** commit. **Per-task reviewer** (the acceptance rule decides what may be deleted).

### Task 2b: The existing server suites follow (M1, M2, M4, unused-pdf rows)

About 240 matches across 21 files (`/usr/bin/grep -cE 'owner[,:} ]|X-Waitron-Setup-Owner'`, run
2026-10-30, an overcount since it also matches prose; largest: start-again 45, recovery-delivery 32,
backup-discard 31), plus about 17 `administrator` lines.
Work file by file, running each after editing it.

- [ ] **Step 1:** M1, M2 and M4 in `first-setup-start-again`, `-backup`, `-backup-discard`,
  `-backup-restart`, `-held`, `-damaged-recovery`, `first-setup-resolution-inspection`,
  `first-setup-resolution.route`, `first-fiscal-hour-finish`, `first-fiscal-hour.e2e`,
  `first-setup-unused-pdf` (plus its table rows), `first-setup-retired-assignments` (M1/M2 lines only:
  #2251 adds tests to this file), `first-setup-set-aside-lifetime`, `first-setup-backup-handoff`,
  `start-again-full-disk.e2e`, `setup-first-fiscal-api.disk-full`, `setup-first-backup-api-adapters`,
  `first-setup-workspace`, `first-setup-recovery-delivery` (all `apps/server/src/*.test.ts`), and
  the M2 fixture in `packages/provisioning/src/first-setup-start-again-choose.test.ts:608`
  (assertions unedited).
- [ ] **Step 2:** run every file of Step 1, then `src/recovery-start-again.test.ts` and
  `first-setup-start-again-choose.test.ts` (the "files found" page keeps its password), then root
  `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/start-again-records-writers.test.ts`. Setup-page suites stay green (they mock the API).
  Commit, naming each edited title.

### Task 3: A held database is offered with or without a stopped recovery; every §1a row

**Files:** `apps/server/src/first-setup-resolution.ts` (`assertHeldStartAgainOffered` drops the
`found?.kind !== "stopped"` condition `:78`; its doc comment follows). Move `tree`/`snapshot` from
`first-setup-start-again-held.test.ts:63-82` into `apps/server/test/start-again-deleted.ts` as
`diskSnapshot(roots)`. Tests in `first-setup-start-again-held.test.ts`,
`first-setup-resolution-inspection.test.ts`, `first-setup-start-again.test.ts`.

- [ ] **Step 1: Failing tests (held file unless named):**
  - "a held setup database with no recovery: the summary answers and Start again deletes it with no
    password" (`heldSetup({ recovery: false })`; `expectStartAgainDeleted`; no record, D11). Fails:
    summary `not_ready`.
  - **The wipe, then the fresh-box restore**: "a held setup database, wiped, then the fresh-box
    restore writes into the usual folders". After the wipe, stage and run the fresh-box restore as
    the spec's probe T2/T4 does (`restoreApp`, `archiveForm`, `stageRestoreRequest`,
    `runStagedRestore`, `agreeInternet`, `clock` from `apps/server/test/hour-recovery-host.ts`):
    `venue.db` in the usual venue folder, `trading.env` in the usual state folder, no
    `first-setup-resolutions` folder, `resolveFirstSetupBackupWorkspace` answers "absent". **Control**
    (an ordinary test): the same staged restore on a second `heldSetup({ recovery: false })` without
    the wipe is refused (`setup.attempt_conflict` or `setup.attempt_uncertain`, spec T3/R1c) and
    places nothing. Write down before running: the main test fails if the wipe leaves anything the
    restore refuses on; the control fails if the restore ignores a failed setup. The test asserts
    nothing about which series name the restore takes (that is A1206/A1207's).
  - §1a refusal rows, each "refuses …, and deletes nothing" with `diskSnapshot` equal before and
    after and no confirmations folder, each through the SUMMARY as well as Start again: trading.env
    (no recovery) → `trading-settings`; complete → `setup-finished`; invoice record (no recovery) →
    `kept-records`; a view-only database → `not_ready` (existing, unedited); in the inspection file:
    empty database past claimed (status beyond `PRESENT_START_AGAIN_STATUSES`) → `not_ready`;
    `restore-request.json` in state → `not_ready`; an unexpected folder in `first-setup-resolutions`
    → `not_ready`; `first-setup-workspaces` in state → `setup.workspace_unsupported`; in the
    start-again file: outside evidence (existing), marker over its limit (existing).
  - "a deletion already marked: Start again answers setup.start_again_incomplete and the route asks
    for a restart" (route; `writeStartAgainMarker` first; `requestRestart` spy called once). No
    server test pins this today (`rg start_again_incomplete apps/server/src/*.test.ts`, run
    2026-10-30, finds none on this route); it is expected to pass before and after (the route asks at
    `setup-first-fiscal-api.ts:1071-1075`), so prove it by deletion: comment out that `setTimeout`,
    see it fail, restore.
  - **Cut after the marker**: "a power cut during a held wipe with no recovery: the next start
    finishes the deletion" — `remove` throwing on its second call, as "a power cut during the
    attempt's deletion…" (`first-setup-start-again-backup-restart.test.ts`) does; then
    `finishStartAgainDeletion(f.roots)`; `expectStartAgainDeleted`.
  - **Full disk, no recovery (N4)**, in `apps/server/src/start-again-full-disk.e2e.test.ts`: "in the
    held state with no recovery, on a full disk with the box's spare file, the spare is not
    released" — `heldSetup({ recovery: false })` on the file's small filesystem, filled as its
    held case fills it. Written down before running, from the code: the spare file is still there
    afterwards (`discardable` answers false with no journal, `spare-space.ts:252-254`); the summary
    answers, because the read opens the database in place when the `-wal` is empty
    (`first-setup-database-holdings.ts:59`, no copy); Start again answers 507 `storage.disk_full`
    when its marker cannot be written, with nothing deleted. The test asserts what the run prints for
    Start again (either 507 with the attempt files unchanged, or the wipe done); if it is anything
    else, or a half-done wipe, STOP for the lead. The ledger and the retitled backlog entry (Task 9)
    say which.
- [ ] **Step 2:** run the three files; the offered-without-recovery, restore and new
  refusal-through-summary cases fail; the control passes before and after. Then the full-disk file
  (read that it did not skip).
- [ ] **Step 3: Implement** the one-condition change and its comment; apply the held rows of the
  changed-checks table.
- [ ] **Step 4:** the three files, the full-disk file and `src/first-setup-resolution.boot.test.ts`. Read every count.
- [ ] **Step 5:** commit. **Per-task reviewer** (§1a: what a held database may lose).

### Task 4a: The holdings read keeps what it counted and names damage

**Files:** `apps/server/src/first-setup-database-holdings.ts` (`readSetupDatabaseHoldings` becomes
`readSetupDatabase`, D3), `apps/server/src/first-setup-database-holdings.test.ts`,
`apps/server/src/first-setup-resolution.ts` (callers take `kind: "read"`; a `damaged` answer is
refused `setup.not_ready` until Task 4c-1, so behaviour is unchanged here).

**Interfaces — Produces:**
`readSetupDatabase(roots, modules): Promise<{ kind: "read"; holdings: SetupDatabaseHoldings } | { kind: "damaged"; code: "errcode 11" | "errcode 26"; seen: SetupDatabaseHoldings }>`.
The schema read, each table's count and each module's `startAgainHoldings` run in their own `try`;
a failure whose primary code (`errcode & 0xff`) is 11 or 26 marks the read damaged and the loop
goes on; any other failure throws `setup.not_ready` with today's reasons. An open that fails at
stage "open" with 11 or 26 is damage too. When a `-journal` was present at the start (today's
`journal` flag, `:51-59`), a failure that would be damage throws `setup.not_ready` with reason
`journal beside a damaged read: <code>` instead (D3's exception).

**Fixtures.** `heldSetup({ recovery: false })` databases, WAL checkpointed with
`pragma wal_checkpoint(TRUNCATE)` and the `-wal` checked absent, damaged over the root pages of a
table **and its indexes** (`select rootpage from sqlite_schema where tbl_name = ?`; experiment 1
shows a table page alone goes unread). A hot journal from ANOTHER database: build a scratch
database with the recipe of the existing case at `first-setup-database-holdings.test.ts:219-237`
(`journal_mode = delete`, `cache_size = 2`, a big insert inside `begin`, copy the database and its
`-journal` mid-transaction), then copy only that `-journal` beside the held `venue.db`; check its
first 8 bytes are SQLite's journal magic (`d9 d5 05 f9 20 a1 63 d7`) before using it.

- [ ] **Step 1: Failing tests:**
  - "damage in one table is reported with errcode 11, keeping every other table's counts"
    (`department_days`; `seen.rows` > 0 and less than the healthy count). Fails: `not_ready`.
  - "damage in tenants beside an invoice still counts the kept rows and the invoice record"
    (`invoices: 1`; `seen.kept` ≥ 1, `seen.records` 1). Fails: `not_ready`.
  - "a damaged invoice table with no sale is reported damaged, with nothing kept and no records
    seen" (review 4, I5: `registros_facturacion` and its indexes; `kind: "damaged"`, `code:
    "errcode 11"`, `seen.kept` 0, `seen.records` 0). Fails: `not_ready`.
  - "a module seat failing with code 11 marks the read damaged" (the file's `withHoldings` helper with
    a seat that throws `Object.assign(new Error("x"), { errcode: 11 })`; `kind: "damaged"`). Fails:
    `not_ready`. Its control is the existing "passes on a module seat's error code, never its
    reason" (an `AppError` stays `not_ready`), unedited.
  - "a damaged first page is reported with errcode 26 and nothing counted". Fails: `not_ready`.
  - the changed check "answers setup.not_ready when the database file cannot be read" → damaged 26.
  - **Journal exception (Review Focus 2):** "an intact database with another database's hot journal
    beside it is not ready, never damaged" (`invoices: 1` plus the foreign journal; `rejects`
    `setup.not_ready` with the `journal beside a damaged read` reason; the original `venue.db` bytes
    unchanged). It passes today (the old reader refuses everything); prove it by deletion: drop the
    journal exception, see it answer `kind: "damaged"`, restore. **Control:** the same database
    without the journal answers `kind: "read"` with `records: 1`.
  - other controls passing before and after: no read permission (`chmod 000`) → `not_ready` with an
    "open" reason, never `damaged`; the copy cannot be written (existing `mkdtemp` case); a 0-byte
    file → `not_ready` (code 1; Task 4d changes it).
- [ ] **Step 2:** run `… @waitron/server exec vitest run src/first-setup-database-holdings.test.ts`;
  the damage cases and the changed check fail as stated.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the holdings file, `src/first-setup-start-again-held.test.ts`; typecheck the server.
- [ ] **Step 5:** commit (the reviewer after 4c-1 covers it).

### Task 4b: The wipe deletes leftover journals

**Files:** `packages/provisioning/src/first-setup-start-again-deletion.ts` (`SIDE_FILES` `:36` gains
`venue.db-journal` and `node.db-journal`), `packages/provisioning/src/first-setup-start-again-marker.test.ts`,
`apps/server/src/first-setup-start-again-held.test.ts`.

- [ ] **Step 1: Failing tests:**
  - provisioning: "Start again's deletion removes a venue.db-journal and a node.db-journal beside the
    databases" (marker from `startAgainMarkerFor`, then `deleteMarkedAttempt`; both journals `ENOENT`).
    Fails: both journals still there.
  - provisioning: "finishing an interrupted deletion removes a leftover journal too" (the marker
    written, deletion cut by a `remove` that throws once, then `finishStartAgainDeletion`). Fails the
    same way.
  - held (review 4, I1 fix 4): "a held database with a leftover journal, wiped, then the fresh-box
    restore: the restored database passes integrity_check and no journal is left" — Task 3's
    wipe-then-restore shape with Task 4a's foreign hot journal beside `venue.db` before the wipe;
    after the restore, `pragma integrity_check` on the restored `venue.db` answers `ok` and no
    `venue.db-journal` exists. Fails today: the journal survives the wipe (written down before
    running: if the restore's first open rolls it in, `integrity_check` fails; if not, the "no
    journal left" assertion still fails).
- [ ] **Step 2:** run `… @waitron/provisioning exec vitest run src/first-setup-start-again-marker.test.ts`
  and the held file; the three cases fail.
- [ ] **Step 3: Implement**; apply the deletion row of the changed checks.
- [ ] **Step 4:** the provisioning start-again files (`… vitest run src/first-setup-start-again`),
  the held file; typecheck provisioning.
- [ ] **Step 5:** commit.

### Task 4c-1: Start again deletes a damaged setup database (D3 rows c, d, e)

**Files:** `apps/server/src/first-setup-resolution.ts` (D3 rows c and e; row d's `damaged` branch),
`packages/provisioning/src/first-setup-start-again-confirmation.ts` (`StartAgainSummary.databaseUnreadable?: true`
so the summary can carry it). Tests in `first-setup-start-again-held.test.ts` (real activated
databases), `first-setup-start-again.test.ts` (row c, `abandonedAttempt`),
`first-setup-resolution-inspection.test.ts` and `first-fiscal-hour-finish.test.ts`. Until Task
4c-2, Start again refuses a damaged database `setup.attempt_conflict` (no echo exists yet), so this
task's "deletes" checks are on the summary; 4c-2 adds the deleting send.

- [ ] **Step 1: Failing tests.** Each "refuses" case asserts the disk unchanged and no confirmations
  folder.
  - row d: "a held database with a damaged table (no recovery): the summary says it cannot be read"
    (`department_days` + indexes; summary `toEqual({ reached: "fiscal-finished", databaseUnreadable: true })`).
    Fails: summary `not_ready`.
  - **row d, the owner's example (review 4, I5):** "a held database whose invoice table is damaged,
    with no sale: the summary says it cannot be read, and the fiscal module's own reader failed with
    code 11". Assert the label is `occupied` first; wrap the fiscal module's
    `provisioning.initialSetup.startAgainHoldings` in `host.modules` with a recorder; assert the
    summary `toEqual({ reached: "fiscal-finished", databaseUnreadable: true })` and the recorder
    `toEqual([{ rejected: true, errcode: 11 }])`. **Control:** the same database undamaged — the
    summary has no `databaseUnreadable` and the recorder `toEqual([{ resolved: { records: 0, accepted: 0 } }])`.
    Fails: summary `not_ready`.
  - row e: "a damaged first page / junk bytes (attempt committed): the summary says it cannot be
    read" (`it.each`). Fails: summary `not_ready`.
  - row c: "an unused attempt whose database cannot be read: the summary says so"
    (`abandonedAttempt`, `venue.db` overwritten with "not a database"). Fails: `not_ready`.
  - Review Focus 4: "a damaged tenants page beside an invoice refuses kept-records, and deletes
    nothing" (`heldSetup({ invoices: 1, recovery: false })`; assert the label is `corrupt` first).
    Fails: `not_ready`. And N2's shape: "the same sale with only the invoice table and its indexes
    damaged refuses kept-records" (experiment 3); fails today too (`not_ready`).
  - Review Focus 2: "an intact held database with an invoice and another database's hot journal
    beside it is refused setup.not_ready, and nothing changes" (Task 4a's foreign journal; the label
    is `unknown`, review 4 case C). Passes before and after; prove it by deletion of 4a's journal
    exception (it then answers `databaseUnreadable`). **Control:** without the journal the summary
    refuses `kept-records`.
  - Review Focus 1, controls passing before and after: "a damaged database whose private copy fails
    is refused setup.not_ready" (`heldSetup({ pendingWal: true, recovery: false })`, so the `-wal`
    holds committed pages and the read takes the copy path — not a `-journal`, which D3's exception
    already refuses — then damage a table; stub `copyVenueFiles` or `mkdtemp` to
    throw `ENOSPC`, assert the stub was called); "a venue.db the box may not open is refused
    setup.not_ready" (`chmod 000`, restored after).
  - Review Focus 3: "a readable held database labelled corrupt refuses kept-records with an invoice
    and setup.not_ready without one" (label stubbed through `inspectFirstSetupResolution`, as the
    held file's "a database read as %s" test does). The `not_ready` half passes before and after.
  - "saved trading settings beside a damaged database refuse trading-settings"; "a finished setup
    beside a damaged database refuses setup-finished".
  - apply the changed-checks rows marked Task 4c-1: inspection "password-free Start again refuses a
    %s database" (`corrupt`), hour-finish "password-free hour restart refuses a %s database"
    (`corrupt`), start-again "a corrupt venue database beside a damaged picks file…", held "a
    database read as %s…" (`unknown {tradingSettings}`). If the box answers `setup.not_ready` where
    the table says `attempt_conflict`, find which non-damage limit refused and write it in the
    ledger; if none, STOP.
- [ ] **Step 2:** run the held, start-again, inspection and hour-finish files; the new cases fail as
  stated, the named controls pass.
- [ ] **Step 3: Implement** D3 rows c and e and row d's `damaged` branch.
- [ ] **Step 4:** the Step 2 files plus `src/first-setup-database-holdings.test.ts`,
  `src/start-again-full-disk.e2e.test.ts`; typecheck both packages.
- [ ] **Step 5:** commit. **Per-task reviewer** (Tasks 4a–4c-1: what may be deleted unread; Review
  Focus 1–4).

### Task 4c-2: The page's confirmation of a damaged database, and its record (D4)

**Files:** `apps/server/src/first-setup-resolution.ts` (the echo check and the record),
`apps/server/src/setup-first-fiscal-api.ts` (`shownSummary` accepts `databaseUnreadable: true`;
new body key `confirmUnreadableDatabase`, parsed like `recoveryDiscardConfirmation`, requiring
`shown.databaseUnreadable === true`), `packages/provisioning/src/first-setup-start-again-confirmation.ts`
(`database: "unreadable"` exactly when `shown.databaseUnreadable === true`). Tests in the held,
start-again and route files and the provisioning confirmation test.

- [ ] **Step 1: Failing tests.** Each "deletes" case asserts `expectStartAgainDeleted` and one record
  with `database: "unreadable"` and `shown.databaseUnreadable: true`.
  - for each summary case of Task 4c-1 that says "cannot be read" (row d table, row d invoice
    table, row e, row c): "…and Start again with that confirmation deletes it". Fails: Start again
    refuses `attempt_conflict`.
  - Review Focus 5: "a damaged database without confirmUnreadableDatabase is refused
    setup.attempt_conflict, and nothing changes" (passes before and after: prove by deletion of the
    echo check); "confirmUnreadableDatabase beside a readable database is refused
    setup.attempt_conflict" (assert at the action; it also passes today, because `exactKeys`
    refuses the unknown key with the same code, so prove it by deletion of the new
    "field without damage" check once the key is accepted).
  - beside a stopped recovery: "a damaged database beside a stopped recovery: the summary names both;
    confirmRecoveryDiscard with that summary deletes both" (`heldSetup()`). Fails: summary `not_ready`.
  - route: `confirmUnreadableDatabase` with `shown.databaseUnreadable: true` passes the parser; without
    it, or with any other value, 400 `setup.request_invalid`.
  - provisioning: a record `"unreadable"` without `shown.databaseUnreadable` is refused
    `setup.attempt_invalid`; `databaseUnreadable` with `"present"` or `"missing"` is refused.
  - the remaining changed-checks rows marked 4c-1 now also check the "with it → deleted" half
    (start-again "a corrupt venue database beside a damaged picks file…").
- [ ] **Step 2:** run the held, start-again and route files and the provisioning confirmation file;
  the new cases fail as stated.
- [ ] **Step 3: Implement** D4.
- [ ] **Step 4:** the Step 2 files; root `scripts/start-again-records-writers.test.ts`; typecheck
  both packages.
- [ ] **Step 5:** commit. **Per-task reviewer** (what the page must have shown before a damaged
  database is deleted; the record).

### Task 4d: Partly created tables and a damaged `node.db` count as damage

The owner's 11:00 answer ("whatever its damage — header, table list, identity page, the invoice
table or anywhere else") covers both (review 4, I3).

**Files:** `apps/server/src/first-setup-database-holdings.ts` ("no such table" is damage),
`apps/server/src/first-setup-resolution.ts` (`partial` joins rows c and e),
`packages/provisioning/src/first-setup-start-again-deletion.ts` (`assertStartAgainAllowedOnDisk`'s
`node.db` check, `:470-483`, answers `nodeDatabaseDamaged` for damage instead of refusing; the
journal exception applies to `node.db-journal`). Tests in the holdings, held, inspection and
provisioning deletion files.

- [ ] **Step 1: Failing tests:**
  - holdings: "a 0-byte venue.db is reported damaged (no such table)". Fails: `not_ready`.
  - held: "a database missing `registros_facturacion` (dropped) is deleted once confirmed"; "a
    database missing a table beside a readable sale refuses kept-records" (`invoices: 1`, drop
    `department_days`). The first fails with `not_ready`; the second passes before and after (a
    control: prove by deletion of the kept-seen check).
  - inspection: the changed check "password-free Start again refuses a %s database" `partial` row →
    `attempt_conflict` without the echo; plus "…with the confirmation, a 0-byte database is deleted".
  - held: the changed check "a database read as %s…" `partial {tradingSettings}` → `trading-settings`.
  - provisioning: "a damaged node.db (junk bytes) no longer refuses the disk check, and is deleted
    with the setup"; controls passing before and after: "node.db holds a table" and "node.db-wal
    holds pages" still refuse `not_ready` (existing cases, unedited); "a damaged node.db with a
    node.db-journal beside it still refuses" (prove by deletion of the journal exception).
  - held: "a held database with a damaged node.db: the summary says it cannot be read, and Start
    again with that confirmation deletes both". Fails: `not_ready`.
- [ ] **Step 2:** run the holdings, held, inspection files and `… @waitron/provisioning exec vitest
  run src/first-setup-start-again`; the new cases fail as stated.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** the Step 2 files; typecheck both packages.
- [ ] **Step 5:** commit. **Per-task reviewer.**

### Task 5: Server checkpoint

- [ ] Check memory, then run
  `… pnpm --filter @waitron/server exec vitest run src/first-setup src/start-again src/recovery-start-again src/first-fiscal-hour`
  and `pnpm --filter @waitron/provisioning test:coverage` (`98/98/98/95`; read the per-file table for
  `first-setup-start-again-confirmation.ts` and `-deletion.ts`). Fix only coverage gaps in code this
  branch changed. Ledger: counts and anything red.

### Task 6a: The page's wipe helper, client and types

**Files:** create `apps/setup/src/start-again-wipe.ts` and `apps/setup/src/start-again-wipe.test.ts`;
modify `apps/setup/src/api/client.ts` (`:644-675`), `apps/setup/src/api/first-setup-types.ts`
(`:133-147`: drop `held` and `StartAgainHeld`, add `databaseUnreadable?: true`),
`apps/setup/src/first-setup-session.ts` (delete `HELD_KEYS`, `readableHeld`, `sameHeld`,
`summaryOf`, `sameSummary` `:79-150`, and the four Start again methods with their snapshot and owner
helpers `:639-783`; `heldStartAgainDatabase` `:105-112` goes in 6b-1 with its last caller).

**Interfaces — Produces:**
- `api.startAgainSummary(snapshot): Promise<StartAgainSummary>` — no owner headers.
- `api.startAgainFirstSetup(snapshot, confirm?: StartAgainConfirm): Promise<{ restarting: true }>`,
  `StartAgainConfirm = { confirmMissingDatabase?; recoveryRecordDamagedShown?: true; confirmRecoveryDiscard?; confirmUnreadableDatabase? }` — no owner headers.
- `readWipeSummary(api, snapshot): Promise<StartAgainSummary>` — today's `summaryOf` without `held`,
  with `databaseUnreadable`.
- `sendWipe(api, snapshot, database: FirstSetupInspection["database"], shown): Promise<{ restarting: true }>`
  — reads the summary again; not the same as `shown` → `{ code: "setup.attempt_conflict" }` and sends
  nothing; else sends at most one `confirm*` field: missing → `confirmMissingDatabase: {
  nothingFiledOrSold: true, shown }`; present with `shown.recovery` → `confirmRecoveryDiscard: {
  shown }`; present with `shown.databaseUnreadable` and no recovery → `confirmUnreadableDatabase: {
  shown }`; otherwise none (D11). **Plus**, with the database present and
  `shown.recoveryRecordDamaged`, `recoveryRecordDamagedShown: true` alongside whichever `confirm*`
  field is sent (the box compares that flag for a held database too, `first-setup-resolution.ts:436-439`).
- `wipeRefusal(error): "setup-finished" | "trading-settings" | "kept-records" | "unavailable" | undefined`
  (`setup.not_ready` and `setup.owner_required` → `"unavailable"`, D13).

- [ ] **Step 1: Failing tests** in `start-again-wipe.test.ts`: the P5 cases ported (every "changed
  between display and confirmation … sends nothing" case kept: reached, damaged record, recovery,
  database unreadable); "a summary carrying held is refused as unreadable"; "no request carries
  X-Waitron-Setup-Owner"; one case per `sendWipe` row; the combined case "a stopped recovery and a
  damaged recovery-key record send confirmRecoveryDiscard and recoveryRecordDamagedShown together"
  (review 4, M6); `wipeRefusal` for each code including `owner_required` → `"unavailable"`. Fails:
  the module does not exist.
- [ ] **Step 2:** run it; it fails.
- [ ] **Step 3: Implement.** `setup-app.ts` is left calling the deleted session methods — **red
  until Task 6b-1, by design:** every `apps/setup` suite that mounts the repair page (record the files).
- [ ] **Step 4:** the new file green; `pnpm --filter @waitron/setup typecheck` fails only in
  `setup-app.ts` and its tests (ledger).
- [ ] **Step 5:** commit. **Per-task reviewer** (what the page sends to delete a setup).

### Task 6b-1: The page: one Start again flow, no password

**Files:** create `apps/setup/src/setup-app-wipe.test.ts`; modify `apps/setup/src/setup-app.ts`,
`apps/setup/src/first-setup-session.ts` (`heldStartAgainDatabase`).

Page flow: Start again is enabled whenever the inspection has a non-null `revision` and
`ownerGeneration`, nothing is running, no refusal is drawn and the page is not busy. With the
password uncheckable there is no `revision` (Current behaviour), so Start again is not offered and
the page draws `uncheckable` and `wipeUnavailable` (D7). Pressing Start again runs one
`#openWipeConfirmation()`: inspect; with the database missing also read the backup status as
`#readMissingAsk` does (`:1366-1384`, no session), otherwise read the activity (running → back to
the repair page, as today); then `readWipeSummary`. An answer draws the confirmation (missing: the
ask lines and the stopped block from the summary, then the existing confirmation); a refusal sets
the drawn refusal (`wipeRefusal`) and hides Start again; any other error draws
`#describeRepairError`; a failed read keeps today's "unread" state and Check again. Confirm calls
`sendWipe`; a send refused `kept-records` closes the confirmation, draws `heldChanged`, and offers
Start again again; any other refusal draws its words and closes the confirmation. Delete the
password states (`firstDamagedRecord` "password", `#damagedInferred`,
`#unlockDamagedRecordStartAgain`, the `password_required` branch `:1465-1479`,
`firstStoppedSummary` and `firstMissingSummary` merged into one `firstWipeSummary`) and the on-load
saved-settings drawing (`:2517-2532`, D5). Continue's password form is not drawn with the database
missing (D8), and `#resumeFirstSetup`'s missing branch goes. In this task the refusal causes draw
today's keys where they still exist; 6b-2 swaps in the §9c words.

- [ ] **Step 1: Failing tests** in `setup-app-wipe.test.ts`, for each case — empty unused, held with
  no recovery, held beside a stopped recovery, damaged recovery-key record, missing database (not
  finished, and finished: D8), database that cannot be read: pressing Start again draws no password
  field (`data-test="resume-password"` absent inside the confirmation), reads the summary with no
  owner header, and Confirm sends exactly the fields `sendWipe` names; with the database missing no
  Continue is drawn; a summary refused `setup.owner_required` draws no "owner tab" text (D13); with
  the real uncheckable pairing (`password: "uncheckable"`, `revision: null`, `ownerGeneration:
  null`), Start again is disabled and no summary is requested. Fails: today's page opens a password
  step.
- [ ] **Step 2:** run it; the new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `setup-app-wipe.test.ts` green; `pnpm --filter @waitron/setup typecheck` and `lint`
  clean. **Red until Tasks 7a–8, by design:** `setup-app-resolution.test.ts`,
  `setup-app-missing-database.test.ts`, `setup-app-held-refusals.test.ts`,
  `first-setup-retirement.test.ts`, the three a11y files — record each failing title against its
  class (P1–P8). A failing title in any other file is a STOP.
- [ ] **Step 5:** commit (the reviewer after 6b-2 covers it).

### Task 6b-2: The page: the box's words

**Files:** `apps/setup/src/screens/initial-owner-strings.ts`, `apps/setup/src/setup-app.ts` (the
refusal and confirmation drawing only), `apps/setup/src/setup-app-wipe.test.ts`,
`apps/setup/src/setup-app-resolution.test.ts` (the words test only).

Words: the refusal causes draw `setupFinished`, `tradingSaved` followed by `tradingSavedPassword`
(D5), `keptFault`, `wipeUnavailable`; `databaseUnreadable` draws `setupDatabaseUnreadable` (D10);
`noInvoiceFound` becomes `!missing && summary.databaseUnreadable !== true`; `uncheckable` takes its
new words; the removed keys go.

- [ ] **Step 1: Failing tests** (`it.each` over EN and ES): in `setup-app-wipe.test.ts`, each refusal
  cause draws its §9c words and no Start again; `trading-settings` draws `tradingSaved` and
  `tradingSavedPassword` together; the unreadable case draws `setupDatabaseUnreadable` and
  `heldLost` without `noInvoiceSent`; `setup.owner_required` and `setup.not_ready` draw
  `wipeUnavailable`; the uncheckable pairing draws `uncheckable` (new words) and `wipeUnavailable`.
  In `setup-app-resolution.test.ts`, extend "Start again's confirmation words are the design's, in
  English and Spanish" (`:120`) with every Global Constraints literal and
  `Object.hasOwn(..., key) === false` for every removed key.
- [ ] **Step 2:** run both files' new cases; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `setup-app-wipe.test.ts` green, and `setup-app-resolution.test.ts -t "Start again's
  confirmation words"` green; typecheck and lint clean. Still red until 7a–8, as in 6b-1.
- [ ] **Step 5:** commit. **Per-task reviewer** (6b-1 and 6b-2).

### Task 7a: Page suites, part 1 — refusals, retirement and a11y

**Files:** `apps/setup/src/setup-app-held-refusals.test.ts`, `first-setup-retirement.test.ts`,
`setup-app-resolution.a11y.test.ts`, `setup-app-held-database.a11y.test.ts`,
`apps/setup/test/held-database-browser.ts`.

- [ ] **Step 1:** Review Focus 6's test first, in `setup-app-held-refusals.test.ts`: "a send refused
  kept-records after the confirmation closes it, says the setup changed, and Start again then draws
  the fault" (EN and ES). If it fails, fix the code, not the test.
- [ ] **Step 2:** apply P1 (including the a11y `password` states), P3, P4, P6, P7; delete what P5
  moved. Add a11y states in `setup-app-held-database.a11y.test.ts`'s loop: `"refused-fault"`
  (summary refused kept-records) and `"unreadable"` (summary with `databaseUnreadable`), both themes,
  390 and 1280 px, axe plus the existing `scrollWidth` check, each with the guarded screenshot
  (`VITE_A1131BC_HELD_LOOK`, `:91`).
- [ ] **Step 3:** run the five files; all green; read counts. Commit, naming each edit by class.

### Task 7b: Page suites, part 2 — the present-database resolution suite

**Files:** `apps/setup/src/setup-app-resolution.test.ts` (2342 lines).

- [ ] **Step 1:** apply P1, P2, P4, P6, P8 in file order, in chunks of about ten tests, running the file
  after each chunk.
- [ ] **Step 2:** whole file green; read the count. Commit, naming each edit by class.

### Task 8: Page suites, part 3 — missing database

**Files:** `apps/setup/src/setup-app-missing-database.test.ts`, `setup-app-missing-database.a11y.test.ts`,
`apps/setup/test/missing-database-browser.ts`.

- [ ] **Step 1:** tests first: "with the database missing, the page offers Start again and no
  Continue; pressing it draws what the setup reached and the missing-database tick, with no
  password" (EN, ES), and "with the database missing and the setup finished, pressing Start again
  draws setupFinished and no Start again" (D8). If either fails, fix the code.
- [ ] **Step 2:** apply P1, P2, P4; keep the stopped-recovery, uncertain-journal, running and Check
  again assertions — their reads now happen on pressing Start again.
- [ ] **Step 3:** run both files, then every `apps/setup` suite naming `start-again`, `held`,
  `missing`, `resolution`, `retirement` or `wipe` in one run (memory checked); all green.
  `pnpm --filter @waitron/setup typecheck`. Commit.

### Task 9: Docs that would otherwise be false

**Files:** `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`,
`docs/operations/first-live-fiscal-setup.md`, `deploy/README.md`, `deploy/waitron.sh` (comment
`:742-745`), `apps/server/README.md`, `docs/developers/testing-guide.md`, `docs/backlog.md`,
`docs/backlog/setup.md`, `docs/backlog/self-service-refusals.md`, the spec (one dated amendment line).

Find every sentence again with
`rg -n -i "start again.{0,160}password|password.{0,160}start again|who confirmed|what the (repair )?page showed|after you enter(ed)? the (administrator )?password|password step|introduzcas la contraseña|introdujeras la contraseña|positively empty|holds records|not_ready.{0,60}unreadable" apps/server/src/guide docs/operations docs/developers deploy apps/server/README.md docs/backlog`.
Hits on e8cfd38ed (run 2026-10-30):
- **edit:** EN guide `:30`, `:33`, `:37` (the paragraph `:26-37`); ES guide `:31`, `:40`; runbook
  `:86`, `:98`, `:102`, `:116`, `:119`; `deploy/README.md:391` (the bullet `:388-391`);
  `deploy/waitron.sh:743`; `apps/server/README.md:57` (`:54-58`); `docs/developers/testing-guide.md:1323`;
  `docs/backlog/setup.md:611-619` (the full-disk entry: its "password step" is now the summary read;
  rewrite with N4); `docs/backlog/self-service-refusals.md:706` (A1158: "`setup.owner_required` at the password step
  with the venue database missing" is now Continue's path only; before rewording, run a scratch case,
  not committed, of the summary and Start again on that state — damaged `first-setup.json`, database
  missing — and write what they answer).
- **dated decision lines, never deleted (CLAUDE.md §6):** `docs/backlog/setup.md:692` and `:748` —
  each gains a dated pointer ("2026-10-30, A1131bc slice 2: offered without a stopped recovery and
  without a password"), its text otherwise unchanged. `:595` is A1131's history paragraph: leave it.
- **left alone:** runbook `:92` (the "files found" page keeps its password),
  `docs/developers/design-system.md:3865` and `docs/backlog/dashboard.md:707` (the dashboard's own
  password steps), `docs/operations/a679-changed-checks.md:1840` (dated historical record),
  `docs/backlog/mockups/a1131bc-restore/README.md:14` (picture 1's caption already says "no password
  and no item counts", true after this slice).

After the edit each must say:
- Start again asks for no password; anyone who can open the repair page can use it and can see what
  the summary shows (D14, once, in the guide and the runbook).
- Pressing it shows what Start again deletes; the box refuses, in §9c's words, beside saved selling
  settings (and says Continue with the setup password finishes it), a finished setup, or a database
  holding an invoice or another record Waitron never deletes; with no stopped recovery beside it too.
- If the box cannot read all of the setup database it says so (OQ-B's words) and Start again still
  deletes it; the box may not have been able to check that database for invoices. No margin, floor
  or wait is mentioned.
- The records say whose setup it was, that it was confirmed on the repair page with nobody signed
  in, when, and the summary the page confirmed — written when the database was missing, damaged, or
  a stopped recovery was discarded; not "who confirmed" and not "what the page showed".
- The "files found" page still asks for the administrator password.
- Runbook `:84-92`: change only the sentences about Start again's limits and password; leave the
  naming clause at `:87-89` exactly as it is (#2251 rewrites it).
- EN and ES say the same; headings and `{#id}`s untouched.

Backlog (CLAUDE.md §6: delete what is finished, keep each open point short):
- `docs/backlog.md` A1131c entry: slice 2 = this branch; drop "with the safety margin taken from
  when it last saved anything" (the owner widened it, A1206 retired the margin) and "until slice 2
  removes them"; slices 3–4 still to come.
- A1159 (backlog.md and `self-service-refusals.md`): a present database the box finds damaged is now
  deleted; what is left is N1 (a file the box may not open, or over 128 MiB). Rewrite to that.
  `self-service-refusals.md:460`'s list follows.
- "The Start again summary's `setup.not_ready` carries no cause": the page now draws
  `wipeUnavailable`, with the cause in the log line (spec §9c); keep one short line only for the
  part still open — no cause-specific words.
- "On a full disk, the repair page's password step needs room…": retitle to the summary read, and
  add N4 with Task 3's full-disk result (the newly offered wipes get no spare release).
- New lines: N5 (plain HTTP has no words saying a secure connection is needed); "after #2251 lands:
  `docs/developers/conventions-data.md:3339` says four requests in the Start-again flow; the password
  route is now only Continue's" (N4).
- `docs/backlog/setup.md` decisions: a dated line for the owner's 2026-10-29 ~11:00 answer
  ("Yes. Start again can delete the failed setup dB.") and how it is built here (D3, N1, N2).
- The spec: one dated line under its header — "2026-10-30, slice 2 revision 5: no margin (A1206);
  a damaged setup database is deleted whatever the damage (owner, 2026-10-29 ~11:00); §2's
  `module-evidence/` check is moot; §9d's sentence is replaced (OQ-B); §9b's help line ("This box
  will not use this setup's invoice series names again.") has nothing behind it since A1206 and is
  for slice 3 to drop".

- [ ] **Step 1:** edit; `pnpm exec prettier --write` on the two guide files and `apps/server/README.md`;
  `docs/` is Prettier-ignored, so READ the runbook paragraphs `:80-130` and each backlog entry whole
  after editing (CLAUDE.md §1: a behaviour change retires every receipt about the old one).
- [ ] **Step 2:** re-run the search; expect only: runbook `:92`, `design-system.md`, `dashboard.md`,
  `a679-changed-checks.md`, the dated decision lines in `docs/backlog/setup.md` (with their new
  pointers), `setup.md:595`, A1158's reworded line, the mockups caption, and Continue's own
  password lines.
- [ ] **Step 3:** `… pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, then
  root `scripts/guide-links.test.ts scripts/english-only.test.ts scripts/waitron-sh.test.mjs scripts/claude-md-pointers.test.ts`,
  then `pnpm format:check`. Commit.

### Task 10: Look check (pictures 3 and 4)

- [ ] Check memory. Run
  `env -u AI_AGENT -u CLAUDECODE VITE_A1131BC_HELD_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-held-database.a11y.test.ts`.
  Copy the new `__screenshots__` PNGs (`find apps/setup -path '*__screenshots__*' -newer apps/setup/src/setup-app.ts -name '*.png'`)
  to `~/waitron-campaign/a1131bc-2-shots/`. Open, for `refused-fault` and `unreadable`: EN and ES ×
  light and dark at 390 px, and EN light at 1280 px; plus one empty-unused confirmation. Passes when:
  `keptFault` shows with no count and no Start again (Recover from backup may still show — D7);
  "This box cannot read all of the setup database." and `heldLost` show without `noInvoiceSent` and
  with no date or series line; nothing overflows the card at 390 px; dark text is legible; no
  password field anywhere on these screens. Compare with
  `docs/backlog/mockups/a1131bc-restore/3-refused-fault*.png` and `4-unreadable-setup*.png`
  (picture 4's buttons are slice 3's; its "New series names can start from…" line is gone since
  A1206). Write what was opened and seen into the ledger. Never commit a shot.

### Task 11: Final checks

- [ ] `git diff --stat e8cfd38ed -- packages/fiscal-verifactu packages/migrations '**/migrations/**' CLAUDE.md docs/developers/conventions-data.md` prints nothing.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`,
  `… exec vitest run inmutabilidad` and `… exec vitest run huella` (the three `*.huella.test.ts`
  files), all unedited, all green (read the counts).
- [ ] Root guards: `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/start-again-records-writers.test.ts`, `scripts/english-only.test.ts`,
  `scripts/guide-links.test.ts`, `scripts/alert-codes.test.ts` (no incident code added; run to
  confirm), `scripts/claude-md-pointers.test.ts`.
- [ ] Typecheck and lint `@waitron/provisioning`, `@waitron/server`, `@waitron/setup`; `pnpm format:check`.
- [ ] Ledger `Status: done` for the build; tell the lead it is ready for `/finish-branch` with this
  plan. The PR description carries D3's table, D4, D5, D11, D13, D14, D15, N1–N5, OQ-B's answer,
  the changed-checks tables, the look-check list, and the #2251 overlap.

## Self-review notes

- Spec coverage: §3 → Tasks 2a/2b; §1a rows → Task 3 (+ Tasks 4c-1/4c-2's damaged row); §4 → Tasks
  2a, 4c-2; OQ2 widened → Tasks 4a–4d; §9c–§9e → Task 6b-2; counts off the wire → Tasks 1, 6a; docs →
  Task 9; "Slices" item 2's tests → Task 3 (wipe then restore with its control; refusals delete
  nothing; cut after the marker), Task 2a (plain HTTP). Item 2's note and floor tests are retired
  with the note (A1206).
- Review 4: I1 → D3's journal exception, D15, Tasks 4a/4b/4c-1, experiment 2 rewritten; I2 → OQ-B's
  words, Task 9's guide sentence; I3 → Task 4d built by default, N1, N2; I4 → D5, D7, Task 6b-1, P7;
  I5 → Tasks 4a and 4c-1's invoice-table cases. M1 → Current behaviour `:80-84`; M2 → D8, Architecture,
  Task 8; M3 → D13, N5; M4 → Task 9's hit list; M5 → N4, Task 3, Task 9; M6 → Task 6a; M7 → Tasks
  4c-1/4c-2 and 6b-1/6b-2; M8 → the spec line in Task 9; M9 → Global Constraints, Task 11; M10 → N3.
- Removed since revision 3: Task 0 (gate, moot), Task 1 (file-time floor; `attemptLastWriteMs`
  deleted by A1206), the floor decisions, the M1-twin class, every `namesFrom` and `floorMs` line,
  `confirmUnreadable` (A1206 removed it; D4's `confirmUnreadableDatabase` is new).
- Not in this slice: Recover from backup as the wipe and its confirmation (§9b), "Join or recover"
  after the restart, removing the old recovery code (slices 3 and 4).
