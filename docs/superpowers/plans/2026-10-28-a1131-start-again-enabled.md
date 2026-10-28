# A1131 — Start again stays enabled beside a stopped recovery when the setup database holds records

Status: plan, written 2026-10-28 at `fe4872ac2` on `feat/a1131-start-again-enabled`
(worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131-start-again-enabled`);
revised the same day after a fresh-context plan review (0 critical, 9 important, 4 minor; all
folded in, see "Review round 1" at the end).

**Scope.** This plan builds the FIRST of A1131's two places only: a stopped backup recovery beside a
setup database that already holds records. The SECOND place (a recovery record that cannot be read,
with the setup database missing) is not built here: the fiscal check below found that Start again
there could delete a venue database the box has been trading from, and the owner's own condition
says to ask first. That question is in `/Users/clintongormley/waitron-campaign/a1131-question.md`;
the backlog entry is narrowed to the second place, not deleted (Task 10).

Words used here:

- **setup database**: `<venue>/venue.db` of the interrupted first setup — the file the repair page
  inspects (`inspectFirstSetupResolution`,
  `packages/provisioning/src/first-setup-resolution-inspection.ts:260`, which reads the database
  through `inspectDatabase`, `:77-138`). Its pair `<venue>/node.db` has no tables, even after a
  complete Live setup and the trading restart (A1042 plan round 3,
  `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md:96-98,126`).
- **recovery target**: where a backup recovery places the restored venue,
  `<state>/first-setup-resolutions/backup-recovery/<id>/target/{venue,state}`
  (`apps/server/src/first-setup-backup-recovery.ts:602-615`). It is never the setup database.
- **holds records**: the inspection reads `database: "occupied"` (a tenant or venue row) or
  `database: "no-venue-rows"` with `emptyDatabase: false` (some other application table has a row).
- **held state**: the state this plan opens — a stopped recovery (`stoppedRecovery()` answers
  `kind: "stopped"`, `apps/server/src/first-setup-resolution.ts:296-365`) beside a setup database
  that holds records, with the attempt record readable.
- **kept rows**: rows in any append-only table (each migration set's `appendOnlyTables`,
  `packages/migrations/src/manifest.ts:26,60`) that no module declares as written by its own
  activation (Task 1a). Invoice records are kept rows.
- **invoice record**: a row the fiscal module counts as one (its `registros_facturacion`);
  **accepted by AEAT**: its `envios` row has `estado` in (`aceptado`, `aceptado_con_errores`), the
  set `packages/fiscal-verifactu/src/reconcile.ts:63` already uses. Generic code never names either.

## Fiscal check

What was run, and what it printed. Each probe was a throwaway test, deleted afterwards.

### Probe 1 — what a setup database holds after activation that did not finish

Appended to `apps/server/src/first-fiscal-interruption.test.ts` (restored afterwards): the file's
own `fixture("publication")`, which activates a real first setup with the real fiscal schema and
injects a failure at publication, then counted every table's rows.
Failing case, written before running: any row in `registros_facturacion`, `envios`, `acks` or
`envio_flujo`, or an invoice series whose name is not the attempt's own installation name.

```
PROBE status committed database missing empty false
PROBE tables with rows {"cadenas":1,"deployment":1,"device_profiles":3,"fiscal_allocations":1,"invoice_series":3,"kitchen_stations":1,"locations":1,"management_sessions":1,"node_membership":1,"node_roles":1,"nodes":1,"persons":1,"registro_sif":1,"tenant_credentials":2,"tenants":1}
PROBE fiscal record tables {"registros_facturacion":0,"envios":0,"acks":0,"envio_flujo":0}
PROBE series [{"code":"A-0CNNY",…},{"code":"FF-0CNNY",…},{"code":"R-0CNNY",…}]
PROBE attempt input names {"fiscal-verifactu":{"allocation":{…"installationIdentity":"0CNNY","series":[{"code":"A-0CNNY"…}]…}}}
```

Limits of that probe: the fixture enables only `core`, `fiscal-verifactu` and `fiscal-none`
(`first-fiscal-interruption.test.ts:56-60`) and stubs the trading-settings write
(`persistTrading`, `:138-141`), so its 20 rows are not the count a real box shows; Task 0 measures
that with every module. `database missing` is only because that suite's database lives outside the
fixture's venue folder. No invoice record and nothing for AEAT; the series names in the database
are the attempt's own frozen input, which Start again's floor already reads
(`gatherStartAgainFloor`'s `attempts`, `apps/server/src/first-setup-resolution.ts:189-202`).

Why the box itself writes no invoice into an unfinished setup's database — followed, not run as
one test: an
attempt whose publication has not completed is kept off the trading start (`needsResolution`,
`apps/server/src/first-setup-entry.ts:45-62`; the run-time recheck `:299-311`, exercised by
"startup rechecks a newly activation-started attempt before entering its callback",
`apps/server/src/first-setup-resolution.boot.test.ts:301-327`), so no till sells from such a
database; other setup writes are fenced while a first-setup claim exists (`assertOtherAllowed`,
`apps/server/src/setup-api.ts:672-686`). Not proven: that no hand placement or future path can put
rows of unknown origin beside a claimed attempt. The plan does not rest on that (rules 1 and 2).

Trading settings, from code: real publication writes `<state>/trading.env`
(`writeTradingEnv`, `apps/server/src/first-setup-publication.ts:69-74`) BEFORE the attempt moves to
`publication` (`persistTrading` then `advance({ kind: "publication" })`,
`packages/provisioning/src/first-setup-activation.ts:212-214`). So a `publication` attempt always
has it and a `committed` one may; Start again's disk check refuses it
(`REFUSED.state`, `packages/provisioning/src/first-setup-start-again-deletion.ts:36-38`; suite case
"a stopped recovery beside trading.env: Start again refuses setup.not_ready",
`apps/server/src/first-setup-start-again-backup-discard.test.ts:449-459`).

### Probe 3 — can a backup recovery start and stop beside a setup database that holds records?

Appended to `apps/server/src/first-setup-start-again-backup.test.ts` (restored afterwards), whose
harness already runs recoveries: `repairFixture()` (a claimed attempt, no setup database), then
`suite.db.archiveTo(<venue>/venue.db)` from `apps/server/test/hour-recovery-host.ts:79` (a real,
populated venue database), a fresh observation, `open`, `prepare({ action: "clock-challenge" })`,
`close`, `liveness()`. Failing case, written before running (place 1 unreachable this way): `open`
or `prepare` refuses, or `liveness()` is not `stopped`.

```
PROBE database occupied empty false status claimed
PROBE open ok
PROBE prepare ok
PROBE after close stopped prepared
```

So the box opens, runs and stops a recovery beside a setup database that holds records; nothing in
`open` or `prepare` looks at the setup database's rows. Not shown: the same with the attempt past
activation. Moving the attempt record straight from `claimed` to `activation-started` through the
store is refused (`setup.attempt_conflict`, same probe), so that order needs a real activation;
Task 2 opens with it. The rows in this probe were placed by the test, standing in for rows the
box did not write itself (a hand-placed or left-over database); the box accepts the state all the
same, which is why rules 1 and 2 do not rely on where the rows came from.

### Probe 2 — a recovery record that cannot be read (the second place; NOT built)

A throwaway `apps/server/src/zz-a1131-probe.test.ts` built on the `fixture("selected")` of
`apps/server/src/first-setup-backup-entry.test.ts:33-79` (a recovery journalled through `restored`
and selected), started the box, then overwrote the journal's last record with `damaged` and started
it again. Failing case, written before running (the stop would NOT hold): after the damage the box
still starts normally from the target, or the page's status names the recovery's phase.

```
PROBE before damage: kind normal roots are target true
PROBE after damage: kind resolution roots are anchor true
PROBE status 200 {"phase":"uncertain","proofRequired":true}
PROBE anchor venue.db exists false
PROBE target state files ["first-setup-resolutions","trading.env"]
PROBE disk check refused setup.not_ready refused artifact: venue/first-setup-resolutions
```

A selected recovery — the box's trading venue, which lives in the recovery target — whose journal
becomes unreadable lands on exactly the second place's page, status `uncertain`, which the page
cannot tell from a recovery that never placed anything. Start again could only make progress there
by deleting or abandoning that folder, which could delete invoice records this box filed with AEAT
whose only copy is the target. That is the owner's stop; the question carries a worked example.

### The rules this plan builds (the held state only)

Owner decision (2026-10-26): Start again is offered beside a stopped recovery even when the setup
database holds records, with the page saying what is there and what is lost. The rules below are
this plan's own, made to respect the owner's fiscal stop; the PR asks the owner to confirm them.

1. **Start again in the held state is refused when the setup database holds any kept row, or any
   invoice record a module counts** (`kept > 0 || records > 0`, so a module that wrongly lists its
   invoice table as deletable still cannot let one go). Holdings come from every module in
   `host.modules` that answers (Task 1a–1b), read from the database without writing (Task 3); the
   append-only tables come from the manifest and the database's own triggers, not from the enabled
   modules (Task 3). The page shows the counts and
   offers no confirmation (Task 8b). Why: deleting a row Waitron never deletes is the loss the
   owner's condition forbids; an unfinished setup never sells, so such a database is a fault, said
   so at the site.
2. **The note's floor also covers every series name the setup database holds**: the fiscal module's
   history of that database is handed to `startAgainFloor` as a new input, and the module takes the
   highest minute across every record in it, whatever its taxpayer or environment, refusing a
   history it cannot read in full (Task 1c). Why: CLAUDE.md §5 — a new name strictly later than all
   readable history; that database is readable history until Start again deletes it.
3. **Still refused, each with its own words on the page:** saved trading settings
   (`trading.env` present — the page sees it in `inspection.artifacts` before the password,
   `apps/setup/src/api/first-setup-types.ts:68-72`, and keeps Start again disabled); status
   `complete` (found after the password; the server answers a new refusal the page has words for,
   as D3a does on the missing-database path, `apps/server/src/first-setup-resolution.ts:480-484`).
   A real `complete` attempt always has `trading.env` (written before `publication`, above), so the
   server checks `trading.env` first and the page shows `tradingSaved`; `setupFinished` is reached
   only when `trading.env` is absent beside a `complete` record, which no product path is known to
   leave — it is kept as a defence, not a common view.
   Also still refused, unchanged: a database that holds records with no stopped recovery beside it;
   an EMPTY database beside an attempt that reached activation (second row of
   `first-setup-start-again-backup-discard.test.ts:826-846`, unedited).
4. Everything else Start again checks today still applies: the setup password, the discard
   confirmation with the summary compared exactly, the other refused files
   (`assertStartAgainAllowedOnDisk`), the deletion marker, the running-recovery checks.

## Owner question this PR carries (wording)

> 1. Beside a stopped recovery, Start again is now offered when the setup database holds records.
>    After the password the page says how many, that none is an invoice, and that no invoice was
>    sent to AEAT (words in Tasks 8a and 8b). Do they say enough about what is lost?
> 2. Start again stays off in three cases, each explained on the page: the database holds an
>    invoice or another record Waitron never deletes (said to be a fault in Waitron); the setup
>    already saved the settings the box trades with (the page asks for the setup password to
>    finish it instead); the setup already finished. These are my rules, made to respect your
>    condition that nothing filed with AEAT is lost — confirm or change them.
>
> (The second place, the unreadable recovery record, is a separate question already sent.)

## Global constraints

- `git commit -s` for every commit; no `--no-verify`.
- TDD: each task's failing test first, run it, watch it fail for the stated reason.
- Do not edit `packages/fiscal-verifactu/src/write-path.e2e.test.ts` or
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- No shipped migration file changes. No new table.
- Generic code (`packages/provisioning`, `packages/module`, `apps/server`, `apps/setup`) names no
  fiscal table and no AEAT state; it reads counts and lists through module seats. The page's own
  words already name AEAT.
- An implementer past about 150 tool calls stops at a passing or cleanly red point, commits, and
  returns a handover: done, left, files, each check's state.
- Run focused tests only; CI runs the package suites (`CLAUDE.md` §2).

## Tasks

### Task 0: Re-check against main, and measure what activation writes with every module

Files: none committed except this plan's "Task 0 findings" section.

- Rebase on main; re-read every line reference above; fix any that moved.
- Throwaway test: a real first-setup activation with `ALL_MODULES` (not the cut-down fixture of
  Probe 1) that stops at `committed` (inject the failure at publication, as
  `first-fiscal-interruption.test.ts` does, but with every module), with the database in the
  fixture's venue folder. Print (a) every table with rows and its count, excluding SQLite's own
  tables, each migration set's journal table and `_litestream_*`; (b) which of those are
  append-only, from `manifestSets()[i].appendOnlyTables`; (c) the owning module of each append-only
  table with rows; (d) `node.db`'s table list (A1042 measured only a fresh and a complete setup).
- Write (a)–(d) into "Task 0 findings". (b)+(c) is the list Task 1b's declarations must match;
  the total in (a) replaces "N" in Task 8a's worked example. If (d) lists any table, stop and
  report: the node-file check would refuse the held state.
- Commit the findings (`-s`). Delete the probe.

### Task 1a: The module contract

Files: `packages/module/src/initial-setup.ts`, `packages/module/src/module.ts`, the module
package's error registry and `scripts/errors-reachable.test.ts`'s expectations if it lists codes,
tests.

- `InitialSetupContribution.startAgainHoldings?(db: Pick<Database, "execute">)
  : Promise<{ readonly records: number; readonly accepted: number }>` — "invoice records in a
  setup database Start again is about to delete; refuses (throws) when its own tables are missing
  from a database whose migration set is applied, never counts them as 0".
- `InitialSetupContribution.startAgainHistory?(db: Pick<Database, "execute">)
  : Promise<readonly unknown[]>` — "the module's name history of a setup database Start again is
  about to delete, read with plain reads only: no transaction, no write lock, no change-log drain".
  Why a new seat: the existing `readRecoveryHistory` (`readHourRecoveryHistory`,
  `packages/fiscal-verifactu/src/hour-recovery-state.ts:15-19`) runs inside `withTransaction`
  (`packages/db/src/tenancy.ts:30-41`), which takes the write lock and drains the change log with
  a `delete … returning` — a read-only, immutable connection refuses that write ("attempt to write
  a readonly database", reviewer's probe). The new seat is used on both read paths of Task 3, so
  there is one history reader to test.
- `WaitronModule.startAgainDeletable?: readonly string[]` — "whole append-only tables (every row
  in them may go) that this module's own first-setup activation writes, which Start again may
  delete with an unfinished setup. Their names still reach the floor through `startAgainHistory`;
  listing a table here never hides it from the floor."
- `startAgainFloor`'s input gains `readonly databaseHistory?: readonly unknown[]` — "what the
  module's `startAgainHistory` returned; one the module cannot read in full refuses".
- Composition refuses a module that lists in `startAgainDeletable` a table none of its own
  migration sets declares append-only, with a new error code (e.g.
  `module.start_again_deletable_invalid`, registered in the module package's error registry, so
  `scripts/errors-reachable.test.ts` sees it). The check goes where module descriptors are
  validated at composition (grep the existing descriptor refusals near
  `packages/module/src/module.ts:1675`, which is where `appendOnlyTables` is built).
- Failing test: that refusal, with a table the module does not own; a correct list composes.
- Run: `pnpm --filter @waitron/module exec vitest run <touched test file>`;
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts`.

### Task 1b: The fiscal module's holdings, history and deletable list

Files: `packages/fiscal-verifactu/src/initial-hour-setup.ts` (the contribution at `:403`),
`packages/fiscal-verifactu/src/hour-configuration.ts` (the historical contribution at `:87`),
`packages/fiscal-verifactu/src/hour-history-reader.ts`, the module descriptor, new test
`packages/fiscal-verifactu/src/start-again-holdings.test.ts`.

- Register `startAgainHoldings` and `startAgainHistory` in BOTH contributions (`:403` and `:87`).
- `startAgainHistory`: `readHourHistory` builds its rows with Drizzle's query builder on a
  `Transaction` (`hour-history-reader.ts:49-62`), so it cannot run over a plain `execute` target.
  Split it: the reads stay in `readHourHistory`; the turning of rows into an `HourHistorySource`
  becomes a pure function both call. `startAgainHistory` reads the same tables with plain
  `db.execute(sql\`…\`)` statements and hands the rows to that function. A test pins that both give
  the same source for one database.
- Declare `startAgainDeletable` with exactly Task 0's fiscal-owned list, pinned by a `toEqual`
  test (and any other owning module's list in its own descriptor, pinned the same way).
- Failing tests first (fail on the missing seats):
  1. On a migrated venue database (`useVenueDb` with `TEST_MIGRATIONS`): no invoice record →
     `{ records: 0, accepted: 0 }`; after two invoice records through the package's existing write
     path helpers, one with its `envios` row at `aceptado` → `{ records: 2, accepted: 1 }`; a
     `pendiente` row is not counted as accepted.
  2. A database without the fiscal tables but with the fiscal migration set's journal → refuses.
  3. `startAgainHistory` over a read-only connection of an activated database equals
     `readHourHistory`'s source for it.
- An `envios` row's primary key is its record's id and references it
  (`packages/fiscal-verifactu/src/schema/envios.ts:19-22`), so `records: 0` means no invoice was
  sent — the page's `heldNoInvoices` line rests on that.
- Deletion control: drop the `accepted` filter → test 1's `pendiente` case fails.
- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/start-again-holdings.test.ts`
  and the package's existing history-reader tests (grep `readHourHistory` in `*.test.ts`).

### Task 1c: The floor reads every name in a database's history, and refuses what it cannot read

Files: `packages/fiscal-verifactu/src/initial-hour-setup.ts` (`hourStartAgainFloor`, `:141-190`),
its test file (grep `hourStartAgainFloor` under `packages/fiscal-verifactu/src`).

- `hourStartAgainFloor` reads `databaseHistory` itself — it does NOT call `projectHourHistory`,
  which drops rows (the plan reviewer's probe, reported to the planner and not re-run: one
  incomplete source with minute 100 under the right taxpayer, minute 900 under another and a
  nameless row printed `{"greatest":100,"contradictions":["venue:incomplete","c:invalid_record"]}`).
  It takes the highest minute across every record of every source, whatever the record's taxpayer
  or environment, and refuses `history_invalid` when a source is not `complete`
  (`readHourHistory` marks a database incomplete when an `invoice_series` row matches no
  `registro_sif` row, `packages/fiscal-verifactu/src/hour-history-reader.ts:120-133`), when a
  record has no readable name, or when a source or record is malformed.
- Failing tests first: (1) a complete source naming minute M → `floorMs = EPOCH_MS + (M + 1) *
  MINUTE_MS` and `lastName` for M; (2) a later minute under ANOTHER taxpayer raises the floor to it;
  (3) an incomplete source → `history_invalid`; (4) a record with no identity → `history_invalid`;
  (5) a malformed source (not an object, `records` not an array) → `history_invalid`; (6) no
  `databaseHistory` → exactly today's answers (existing cases unedited).
- Deletion control: filter records by taxpayer → test 2 fails; skip the `complete` check → test 3
  fails.
- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run <that test file>`.

### Task 2: One shared test helper for a held setup

Files: new `apps/server/test/held-setup-database.ts` (beside its siblings, e.g.
`first-setup-backup-recovery-fixture.ts`); its own test in
`apps/server/src/held-setup-database.test.ts` (the package's Vitest and coverage include only
`src/**/*.ts`, `apps/server/vitest.config.ts:38`; `apps/server/test/` holds no test files).

- Step 1, a probe that decides the order: Probe 3 showed a recovery opens and stops beside a
  database that holds rows with the attempt at `claimed`; it did NOT show an attempt past
  activation. `selectedRepair()` builds its own box and takes no roots
  (`apps/server/test/first-setup-backup-recovery-fixture.ts:136`, through `repairFixture` →
  `fixture(true)` → `archiveHost()`), so the helper works on ITS box: try (A) `selectedRepair()`,
  `close` the recovery, then drive `f.host` through activation to `committed`; and (B) activation
  to `committed` first, then `open`/`prepare`/`close` a recovery. Record which works, with its
  output, in "Task 0 findings". If neither can be driven, stop and report: the held state is then
  shown only with rows the box did not write (Probe 3), and the helper builds that instead.
- `heldSetup(options)` returns the roots, host, workspace, service, an owner sign-in helper and the
  attempt's installation name. Options: `invoices: n` (n invoice records through the fiscal
  module's own test write path), `status` (only statuses the store reaches through real steps),
  `tradingSettings: true` (write `<state>/trading.env`), `pendingWal: true` (leave one committed
  row in `venue.db-wal`).
- Its test: the inspection reads `occupied`, `liveness()` is `stopped`, and `invoices: 1` leaves
  one invoice record (counted through the fiscal module's seat; generic test code names no fiscal
  table).
- Run: `pnpm --filter @waitron/server exec vitest run src/held-setup-database.test.ts`.

### Task 3: The server reads holdings and history without writing

Files: new `apps/server/src/first-setup-database-holdings.ts` and its test; the private-copy logic
of `apps/server/src/first-setup-backup-history.ts:31-90` is reused, not duplicated.

- `readSetupDatabaseHoldings(roots, modules)`, called only inside the summary's and Start again's
  existing venue exclusion and coordinator turn (`host.resolution.withVenueExclusion(() =>
  host.coordinator.run(…))`, `apps/server/src/first-setup-resolution.ts:403-404`; the exclusion is
  `lockVenueDatabase`, `packages/db/src/client.ts:84-91`), returns
  `{ rows, kept, records, accepted, history }`:
  - Opening: inside that one turn, check `venue.db-wal` and `venue.db-journal`; when the WAL is
    missing or empty AND no `-journal` exists, open `venue.db` read-only with `immutable=1`, as the
    node file check does (`first-setup-start-again-deletion.ts:483-494`); otherwise read through
    the existing private copy (which copies `-wal` and `-journal`, `first-setup-backup-history.ts:65`)
    opened read-only. Why both conditions: an immutable open ignores WAL pages (reviewer's probe:
    1 row read where 2 were committed). Why avoid the copy: Start again is the way out of a full
    disk (guide `apps/server/src/guide/en/backup-recovery.md:53`, about 8 MB spare) and the
    database may be up to 128 MiB.
  - Both paths give the module seats a plain `execute` target over that read-only connection, built
    as `inspectDatabase` builds one (`packages/provisioning/src/first-setup-resolution-inspection.ts:89-101`).
  - Append-only tables: the union of every set's `appendOnlyTables` in `manifestSets()` (every
    module in the manifest, enabled or not) and every table in the database carrying a
    `<table>_append_only_update` or `_delete` trigger (the names
    `appendOnlyTriggers`, `packages/store/src/append-only.ts:68-80`, gives them), read from
    `sqlite_schema`. Never from `host.modules`.
  - `rows`: every row of every table except SQLite's own, each migration set's journal table and
    `_litestream_*`; `kept`: rows in those append-only tables that no module in the MANIFEST lists
    in `startAgainDeletable`; `records`/`accepted`: summed over EVERY module in `modules` whose
    initial setup has `startAgainHoldings`; `history`: per module with `startAgainFloor`, its
    `startAgainHistory` — such a module without that seat refuses `setup.not_ready`.
  - A failed read (the copy cannot be written, the file cannot be opened) answers
    `setup.not_ready`, which the page already words; the test name says so.
- Failing tests first (fail: module missing), on Task 2's helper: legitimate → `rows` equals Task
  0's total, `kept: 0`, `records: 0`; `invoices: 1` → `kept ≥ 1`, `records: 1`; the original files'
  bytes and side files are unchanged after the read; an empty migrated database → `rows: 0`;
  `pendingWal` → read through the copy and the pending row counted; a row in an append-only table
  of a module that is in the manifest but not in `modules` → counted in `kept`.
- `apps/server/src/first-setup-backup-history.test.ts` passes unedited.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-database-holdings.test.ts src/first-setup-backup-history.test.ts`.

### Task 4a: The summary type and the confirmation record (provisioning)

Files: `packages/provisioning/src/first-setup-start-again-confirmation.ts`, its test.

- `StartAgainSummary` gains `held?: { rows: number; kept: number; records: number;
  accepted: number }`; the confirmation-record parser accepts exactly those four non-negative safe
  integers, with `accepted ≤ records` and `kept ≤ rows`, and nothing else. (Not `records ≤ kept`:
  rule 1's defence case is a module that wrongly lists its invoice table as deletable.)
- Failing test: a record holding `held` is refused today `setup.attempt_invalid`; an extra key,
  a negative or a non-integer count, or `accepted > records` stays refused.
- Run: `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts`.

### Task 4b: The server's summary in the held state

Files: `apps/server/src/first-setup-resolution.ts` (`startAgainSummary` from `:402`, the refusal
at `:424-429`; `gatherStartAgainFloor`), `apps/server/src/errors.ts`,
`apps/server/src/setup-first-fiscal-api.ts` (its error boundary, `:33-48`, maps an unlisted code to
`setup.provision_failed`), new test file `apps/server/src/first-setup-start-again-held.test.ts`.

- New error code `setup.start_again_refused`, params `{ cause: "setup-finished" |
  "kept-records" | "trading-settings" }` (no personal data), registered in `errors.ts` and mapped
  to 409 in that boundary.
- In the held state the summary no longer answers `setup.not_ready` at `:424-429`. In this order:
  `trading.env` present → `setup.start_again_refused` `trading-settings` (before the disk check,
  which would say only `setup.not_ready`, and before the status, because a real `complete` attempt
  always has it); status `complete` → `setup-finished`; then it reads holdings (Task 3), passes
  `history` as `databaseHistory`, runs `assertStartAgainAllowedOnDisk(roots, { discarding })`, and
  answers with `held`. `kept > 0 || records > 0` still answers the summary, so the page can explain.
- Failing tests first, all on Task 2's helper: (1) legitimate → `held: { rows: N, kept: 0,
  records: 0, accepted: 0 }`, the `recovery` block as today; (2) `invoices: 1` → summary with
  `held.records: 1`; (3) `tradingSettings` → `trading-settings`, also when the status is
  `complete`; (4) `complete` without `trading.env` → `setup-finished`; (5) still refused
  `setup.not_ready`, nothing written: a held database with no recovery started;
  `database: "unknown"`/`"partial"` beside a stopped recovery; an empty database beside an
  `activation-started` attempt (the existing row, unedited).
- Deletion control: remove the new branch → test 1 fails with `setup.not_ready`.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-start-again-backup-discard.test.ts`
  and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.

### Task 5: Start again goes ahead in the held state, and only there

Files: `apps/server/src/first-setup-resolution.ts` (`startAgainFirstSetup`), the same new test file.

- In the held state: owner required, `confirmRecoveryDiscard.shown` must equal the summary (with
  `held`); `trading.env` → `setup.start_again_refused` `trading-settings`, status `complete` →
  `setup-finished`, `kept > 0 || records > 0` → `kept-records`, each before any write. The
  `PRESENT_START_AGAIN_STATUSES`, `no-venue-rows` and `emptyWorkspace`/`unusedAssignment` gates at
  `:484-518` are skipped for the held state only; the floor includes `databaseHistory`; then the
  existing sequence (confirmation record with `database: "present"`, note, abandon, empty, marker,
  delete) runs unchanged. The node-file check stays as it is (Task 0 (d)).
- Failing tests first, on Task 2's helper:
  1. after Start again the venue and state trees hold only what an empty Start again leaves (the
     discard suite's `tree`/`expectNothingWritten` helpers), the confirmation record holds the
     shown `held`, `readStartAgainNote`'s floor is at least the floor `hourStartAgainFloor` gives
     for the attempt's installation name, and the journal ends `abandoned`;
  2. rule 2's deletion control: before Start again, write a LATER installation into the setup
     database — one `registro_sif` row (later `numeroInstalacion`, same node), its three
     `invoice_series` rows (`A-`, `FF-`, `R-` + that name, same node) and one `fiscal_allocations`
     row naming that `registro_sif` — through the fiscal module's test helpers, so the history
     stays `complete`; the note's floor follows that later name, not the attempt's;
  3. rule 1's defence: with a test module list in which the fiscal module ALSO lists its invoice
     table as deletable, `invoices: 1` makes `kept` 0 and `records` 1, and Start again still
     refuses `kept-records`;
  4. still refused, nothing changed (tree, journal, note, confirmations equal before/after):
     `invoices: 1`; `complete` without `trading.env`; `tradingSettings`; a `shown` without `held`;
     a hand-made request with `confirmMissingDatabase`; a held database with no stopped recovery.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-start-again-backup-discard.test.ts src/first-setup-start-again-note.test.ts`.

### Task 5b: The held state on a full disk

Files: `apps/server/src/start-again-full-disk.e2e.test.ts`, with its small real filesystem
(`apps/server/src/testing/full-disk.ts`; macOS makes it with `hdiutil`, Linux needs
`WAITRON_FULL_DISK_DIR`, CLAUDE.md §4).

- Failing test first: the held state on a full disk with the spare file — the summary answers with
  `held` and Start again completes, as its neighbour case at `:150` does for an empty database.
  Before Task 3's immutable path it fails on the copy (or answers `setup.not_ready`).
- Run: `pnpm --filter @waitron/server exec vitest run src/start-again-full-disk.e2e.test.ts`.

### Task 6: The HTTPS route accepts `held`

Files: `apps/server/src/setup-first-fiscal-api.ts` (`shownSummary`, `:94-99`, which today lists
only `reached`, `lastName`, `recoveryRecordDamaged`, `recovery`, `unreadable`); test in
`apps/server/src/first-setup-resolution.route.test.ts`.

- `shownSummary` accepts an optional `held` with exactly the four counts (non-negative safe
  integers). This change is unconditional.
- Failing tests first: a POST to `/setup-api/first-setup/resolution/start-again` whose shown summary
  carries `held` reaches Start again over the test HTTPS server; the same body with an extra key
  inside `held`, or a negative count, is refused `setup.request_invalid` with `field: "body"`
  (`invalid()`, `:49-51`).
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.route.test.ts`.

### Task 7: The setup app's session reads and compares `held`

Files: `apps/setup/src/first-setup-session.ts` (`summaryOf`, `:105-122`; `sameSummary`,
`:123-135`), `apps/setup/src/api/first-setup-types.ts`, test
`apps/setup/src/first-setup-retirement.test.ts`.

- `summaryOf` accepts `held` (same shape as Task 4a); `sameSummary` compares it.
- Failing tests first: a summary with `held` is refused `setup.attempt_invalid` today; a second
  summary read whose `held` differs from the first (e.g. `rows` 20 → 21) is treated as changed, as
  a changed `recovery` is.
- The session maps `setup.start_again_refused` with its `cause` to the page (Task 8b), not to
  `shell.not_ready`.
- Run: `pnpm --filter @waitron/setup exec vitest run src/first-setup-retirement.test.ts src/first-setup-session.test.ts`.

### Task 8a: The page — the held confirmation

Files: `apps/setup/src/screens/initial-owner-strings.ts`, `apps/setup/src/setup-app.ts`
(`#renderFirstOwner`, `canRestart` and the confirm block), tests
`apps/setup/src/setup-app-resolution.test.ts`, new `apps/setup/src/setup-app-held-database.a11y.test.ts`.

- Start again is enabled when `stoppedHere` and the inspection says the database holds records,
  unless `inspection.artifacts` shows `trading.env` present (Task 8b).
- Pressing it goes to the existing password step; the summary then shows, above the existing
  stopped-recovery block, the held lines, then `startAgainHelp`, the `retireConfirmed` checkbox,
  Cancel and Start again — unchanged controls.
- Words (new keys; placeholders replaced with plain numbers):

| key | English | Spanish |
| --- | --- | --- |
| `heldRows` | The setup database already holds {rows} saved items. | La base de datos de configuración ya guarda {rows} elementos. |
| `heldRowsOne` | The setup database already holds 1 saved item. | La base de datos de configuración ya guarda 1 elemento. |
| `heldNoInvoices` | None of them is an invoice, so no invoice was sent to AEAT. | Ninguno es una factura, así que no se envió ninguna factura a la AEAT. |
| `heldNoInvoicesOne` | It is not an invoice, so no invoice was sent to AEAT. | No es una factura, así que no se envió ninguna factura a la AEAT. |
| `heldLost` | Start again deletes them with this attempt. You will enter this setup's details again. | Empezar de nuevo los borra junto con este intento. Tendrás que volver a introducir los datos de esta configuración. |

  Worked example (N from Task 0): "The setup database already holds N saved items. None of them is
  an invoice, so no invoice was sent to AEAT. Start again deletes them with this attempt. You will
  enter this setup's details again." then today's "A recovery from backup started on … and did not
  finish. Start again deletes it." and "Deletes this attempt. This box will not use its invoice
  series names again."
- `startUnavailableOccupied` stays, shown only for a database that holds records with no stopped
  recovery.
- Failing tests first (both locales): (a) the test at `setup-app-resolution.test.ts:1940-1960`
  changes (see "Tests whose checks change"); (b) after the password the held lines appear in order,
  `heldRowsOne`/`heldNoInvoicesOne` for `rows: 1`; (c) still refused: a database that holds
  records with no stopped recovery keeps Start again disabled with `startUnavailableOccupied`.
- a11y: axe over the held confirmation, light and dark (the pattern of
  `setup-app-missing-database.a11y.test.ts`).
- Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts src/setup-app-held-database.a11y.test.ts`.

### Task 8b: The page — the three refusal views

Files: as Task 8a, plus `apps/setup/src/setup-app-held-refusals.test.ts` (new) and the same a11y
file.

- `trading.env` present in `inspection.artifacts` beside a stopped recovery: Start again stays
  disabled and the page shows `tradingSaved` instead of `startUnavailableOccupied`. Its last
  sentence names the password field: the test asserts `resume-password` is on screen in that view;
  where the inspection says `password: "uncheckable"` the sentence is left off.
- `held.kept > 0 || held.records > 0` after the password: the kept lines and `heldFault`, no
  checkbox, no confirming Start again; Cancel stays; `reconnect-first` is on screen (drawn
  unconditionally, `setup-app.ts:2818`; the test asserts it in this view).
- `setup.start_again_refused` `setup-finished` after the password shows `setupFinished`;
  `trading-settings` after the password (the file appeared since the page loaded) shows
  `tradingSaved`; neither shows `shell.not_ready`'s words.
- Words:

| key | English | Spanish |
| --- | --- | --- |
| `heldKept` | It holds {kept} items that Waitron never deletes. | Tiene {kept} elementos que Waitron nunca borra. |
| `heldKeptOne` | It holds 1 item that Waitron never deletes. | Tiene 1 elemento que Waitron nunca borra. |
| `heldInvoices` | {records} of them are invoices; AEAT accepted {accepted}. | {records} son facturas; la AEAT aceptó {accepted}. |
| `heldInvoiceOne` | 1 of them is an invoice; AEAT accepted {accepted}. | 1 es una factura; la AEAT aceptó {accepted}. |
| `heldFault` | An unfinished setup should hold none of these, so this is a fault in Waitron. Start again would delete them, so it is not offered. Reconnect keeps everything as it is. | Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. Empezar de nuevo los borraría, así que no se ofrece. Reconectar lo deja todo como está. |
| `tradingSaved` | This setup already saved the settings the box trades with. Start again would delete a setup that is ready to trade, so it is not offered here. Enter your setup password to see what is left to do. | Esta configuración ya guardó los ajustes con los que vende el equipo. Empezar de nuevo borraría una configuración lista para vender, así que no se ofrece aquí. Introduce tu contraseña de configuración para ver qué falta. |
| `setupFinished` | This setup already finished. Start again would delete a finished setup, so it is not offered. Reconnect to check the saved result. | Esta configuración ya terminó. Empezar de nuevo borraría una configuración terminada, así que no se ofrece. Reconecta para comprobar el resultado guardado. |

  `heldKept`/`heldKeptOne` show when `kept > 0` (with `kept: 0, records: 1`, the defence case, the
  page shows `heldInvoiceOne`/`heldInvoices` alone, then `heldFault`); `heldInvoices`/`heldInvoiceOne`
  show only when `records > 0`. `tradingSaved` says "see what is left to do", not "finish it",
  because a `complete` attempt also has `trading.env` (rule 3).
- Failing tests first (both locales): (a) `kept: 2, records: 1, accepted: 0` shows `heldKept`,
  `heldInvoiceOne`, `heldFault`, no `retire-confirmed`, no `confirm-start-again`, Cancel enabled,
  `reconnect-first` present; (b) `kept: 0, records: 1` shows `heldInvoiceOne` and `heldFault`;
  (c) `trading.env` present beside a stopped recovery → Start again disabled, `tradingSaved`,
  `resume-password` present; (d) the `setup-finished` answer → `setupFinished`; (e) the
  `trading-settings` answer after the password → `tradingSaved`.
- a11y: axe over the kept refusal, `tradingSaved` and `setupFinished`, light and dark.
- Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app-held-refusals.test.ts src/setup-app-held-database.a11y.test.ts`.

### Task 9: The guides

Files: `apps/server/src/guide/en/backup-recovery.md` and `apps/server/src/guide/es/backup-recovery.md`,
section `{#interrupted-setup}` (headings and ids unchanged).

- English: replace "Otherwise the page shows **Start again** beside the stopped recovery, available
  only when the box can check that the setup's database is empty." with: "Otherwise the page shows
  **Start again** beside the stopped recovery. If the setup's database already holds saved items,
  the page says how many after you enter the password, and that none is an invoice. Start again is
  not offered if the database holds an invoice or another item Waitron never deletes, if the setup
  already saved the settings the box trades with, or if it already finished."
- Spanish: replace "Si no, la página muestra **Empezar de nuevo** junto a la recuperación detenida,
  disponible solo si el equipo puede comprobar que la base de datos de la configuración está vacía."
  with: "Si no, la página muestra **Empezar de nuevo** junto a la recuperación detenida. Si la base
  de datos de la configuración ya guarda elementos, la página dice cuántos después de que
  introduzcas la contraseña, y que ninguno es una factura. Empezar de nuevo no se ofrece si la base
  de datos tiene una factura u otro elemento que Waitron nunca borra, si la configuración ya guardó
  los ajustes con los que vende el equipo, o si ya terminó."
- Run: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.

### Task 10: Look at it, then the docs

- Look: build the setup app (`pnpm --filter @waitron/setup build`), open the repair page with
  stubbed answers in the browser test harness and screenshot it with the workspace's Playwright
  Chromium (A1042's way, `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md:1175`),
  in English and Spanish, light and dark, at phone width (about 375 px), for: the held
  confirmation, the kept refusal, `tradingSaved`, `setupFinished`. Check wrapping and that the
  danger button turns red only once the box is ticked. Screenshots stay out of the commit; the PR
  says what was seen.
- `docs/backlog/setup.md`, entry "A1131: …": cut the first bullet and the case-1 words, keep the
  second bullet as the open point, retitle it "A1131: Start again beside a recovery record that
  cannot be read, with the setup database missing", and add: "Waits for the owner: an unreadable
  record may belong to a recovery the box has been trading from (A1131 question, 2026-10-28)."
  Update its line in `docs/backlog.md` (`:593-596`) to match.
- `## Decisions and deliberate limits` in `docs/backlog/setup.md`, two parts:
  "**DECIDED (owner, 2026-10-26): beside a stopped recovery, Start again is offered even when the
  setup database holds records; the page says what is there and what is lost.**" and, separately,
  "**Built with it, to respect the owner's fiscal stop (A1131 part 1; awaiting the owner's
  confirmation in the PR):** Start again stays off when the database holds an invoice or another
  row Waitron never deletes (said to be a fault), when the setup saved its trading settings, or
  when it finished; the start-again note's floor also covers the database's own series names."

## Tests whose checks change (the PR names each)

| Test | Today's assertion | New assertion |
| --- | --- | --- |
| `apps/setup/src/setup-app-resolution.test.ts:1940-1960` "with the database present and holding records beside a stopped recovery, the disabled Start again says why" | `start-again` disabled; text contains `startUnavailableOccupied` | `start-again` enabled; no `startUnavailableOccupied`; renamed "… Start again is offered and, after the password, says what the database holds" |
| `apps/server/src/first-setup-start-again-backup-discard.test.ts:826-846`, row "the venue database holds rows" | summary refuses `setup.not_ready` | moved to Task 4b's legitimate case on Task 2's real held database (the `databasePresent(host, "occupied")` stub cannot be read by the holdings reader); row "the attempt reached activation" stays unedited |

Before Tasks 4b and 8, grep for any other assertion of today's refusal:
`grep -rn "startUnavailableOccupied\|\"occupied\"\|databasePresent(" apps/setup/src apps/server/src/*.test.ts`.
At this plan's commit `databasePresent(` appears only in
`apps/server/src/first-setup-start-again-backup-discard.test.ts` (8 hits). A hit that asserts the
held state's refusal is listed here before it is edited; a hit about a database with no stopped
recovery, or an empty one, is not edited.

## Guard suites to run

- `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` (new code
  `setup.start_again_refused`; it is not an incident code).
- `scripts/english-only.test.ts` (new Spanish only in the strings file and guide).
- `scripts/module-seams.test.ts` (new seats; generic code names no fiscal table).
- `scripts/personal-log-params.test.ts` (params are a `cause` word and counts only).
- `scripts/native-form-fields.test.ts` and `scripts/style-token-names.test.ts` if the page adds
  markup.

## Neighbouring backlog entries

- "A recovery that Start again recorded as discarded can still be resumed after a power cut": the
  held state goes through the same order (confirmation record before the `abandoned` record), so it
  adds states that pass through that window; it does not widen the window. Not made worse in kind;
  not folded in.
- "A stale signed-in setup tab's activation request is not refused while a Waitron Cloud recovery
  waits": untouched — Start again's checks run inside the existing fence.
- "A Waitron Cloud recovery whose download takes more than 30 seconds…": untouched.

## Task 0 findings

(Filled in by Task 0.)

## Review round 1 (2026-10-28) — what changed

Each finding's evidence was re-read before folding; none was declined.

- I1 floor drops rows → Task 1c reads every record itself, with four refusal/raise tests
  (`hour-history-reader.ts:120-133` confirmed: an unmatched series sets `complete = false`).
- I2 only frozen modules asked → Task 3 asks every module in `host.modules`; unanswered tables
  surface as kept rows.
- I3 other append-only tables → "kept rows" from `appendOnlyTables` and `startAgainDeletable`
  (Tasks 0, 1a, 1b, 3), same fault words.
- I4 Task 0's measurements → dropped; node file cited to A1042 round 3; trading settings from code
  (`first-setup-activation.ts:212-214`, `first-setup-publication.ts:69-74`); no node-file
  loosening.
- I5 `shell.not_ready` words after an offered Start again → `tradingSaved` before the password,
  `setup.start_again_refused` with causes after it (`shell.ts:33` confirmed).
- I6 parsers → Task 6 (route, unconditional, `setup.request_invalid` `field: "body"`) and Task 7
  (session `summaryOf`/`sameSummary`).
- I7 full disk → immutable read-only open when the WAL is empty, copy only otherwise, failure
  answers `setup.not_ready`, a case in `start-again-full-disk.e2e.test.ts`.
- I8 decisions entry → owner decision and the plan's own rules split; the rules go to the owner in
  the PR question.
- I9 task size → Task 2 helper in `apps/server/test/`; summary split into 4a/4b; page split into 7/8;
  Task 5 test 2 names the rows to write.
- M1 line references corrected and re-checked. M2 both registrations named (`:403`, `:87`).
  M3 words: "no invoice was sent", Spanish "elementos" not "registros", the count comes from
  Task 0, `reconnect-first` asserted on screen. M4 `_litestream_*` excluded, a missing fiscal table
  refuses, grep widened to `databasePresent(`.

## Review round 3 (2026-10-28) — what changed

Each finding's evidence was re-read before folding.

- I-1 the history reader writes → confirmed (`hour-recovery-state.ts:15-19` → `withTransaction`,
  `tenancy.ts:30-41`). Folded with one change: the proposed "call `readHourHistory` over a plain
  `execute` target" does not work as written, because `readHourHistory` builds its reads with
  Drizzle's query builder on a `Transaction` (`hour-history-reader.ts:49-62`). Task 1b splits it
  into reads plus a pure row-to-source function, and the new `startAgainHistory` seat (Task 1a)
  reads the same tables with plain statements; it is used on both read paths, so there is one
  reader. `drizzleNodeSqlite` is no longer mentioned.
- I-2 defence in depth → `kept > 0 || records > 0` refuses in the summary's page view and in Start
  again; Task 5 test 3 lists the invoice table as deletable and still refuses; Task 1b pins the
  list with `toEqual`; Task 4a no longer requires `records ≤ kept`.
- I-3 (a) append-only tables from `manifestSets()` plus the database's own append-only triggers,
  never `host.modules`; Task 3 tests a disabled module's table. (b) Probe 3 run now (command and
  output under "Fiscal check"): a recovery opens, prepares and stops beside a setup database that
  holds rows, with the attempt at `claimed`. The past-activation order is not shown (the store
  refuses a shortcut status change); Task 2 opens with probes of both orders and a stop rule.
- M-1 the read happens inside the existing venue exclusion and coordinator turn, with the WAL and
  `-journal` checked in the same turn. M-2 `trading.env` is checked before `complete`;
  `tradingSaved` no longer says "finish it"; `setupFinished` is a defence view; tests for both.
  M-3 composition refusal has its own code and registry entry; `module.ts:1675` described as where
  `appendOnlyTables` is built. M-4 `setup-first-fiscal-api.ts` in Task 4b's files. M-5 contract
  says whole tables, and names still reach the floor. M-6 the `projectHourHistory` output is
  labelled the reviewer's; Task 0 prints `node.db`'s tables for a `committed` attempt. M-7 the
  full-disk case is its own task (5b); the page is split (8a confirmation, 8b refusals) with their
  own a11y cases; the helper's test is under `apps/server/src/`.
