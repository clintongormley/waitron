# A1131 — Start again stays enabled beside a stopped recovery when the setup database holds records

Status: plan, written 2026-10-28 at `fe4872ac2` on `feat/a1131-start-again-enabled`
(worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131-start-again-enabled`).

**Scope.** This plan builds the FIRST of A1131's two places only: a stopped backup recovery beside a
setup database that already holds records. The SECOND place (a recovery record that cannot be read,
with the setup database missing) is not built here: the fiscal check below found that Start again
there could delete a venue database the box has been trading from, and the owner's own condition
says to ask first. That question is in `/Users/clintongormley/waitron-campaign/a1131-question.md`;
the backlog entry is narrowed to the second place, not deleted (Task 9).

Words used here:

- **setup database**: `<venue>/venue.db` (and its pair `<venue>/node.db`) of the interrupted first
  setup — the folder the repair page inspects (`inspectFirstSetupResolution`,
  `packages/provisioning/src/first-setup-resolution-inspection.ts:96-138`).
- **recovery target**: where a backup recovery places the restored venue,
  `<state>/first-setup-resolutions/backup-recovery/<id>/target/{venue,state}`
  (`apps/server/src/first-setup-backup-recovery.ts:602-615`). It is never the setup database.
- **holds records**: the inspection reads `database: "occupied"` (a tenant or venue row) or
  `database: "no-venue-rows"` with `emptyDatabase: false` (some other application table has a row).
- **held state**: the state this plan opens — a stopped recovery (`stoppedRecovery()` answers
  `kind: "stopped"`, `apps/server/src/first-setup-resolution.ts:270-345`) beside a setup database
  that holds records, with the attempt record readable and its status anything but `complete`.
- **invoice record**: a row of the fiscal module's `registros_facturacion`; **accepted by AEAT**:
  an `envios` row for it with `estado` in (`aceptado`, `aceptado_con_errores`), the set
  `packages/fiscal-verifactu/src/reconcile.ts:63` already uses.

## Fiscal check

What was run, and what it printed. Each probe was a throwaway test, deleted afterwards (the tree is
clean at the commit of this plan).

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

(`database missing` there is only because that suite's database lives outside the fixture's venue
folder; the counts are of the real activated database.) Activation writes 20 rows, among them a chain
header (`cadenas`) and the installation's registration (`registro_sif`), and no invoice record and
nothing for AEAT. The series names in the database are the attempt's own frozen input, which
Start again's floor already reads (`gatherStartAgainFloor`'s `attempts`,
`apps/server/src/first-setup-resolution.ts:181-196`).

Why that is the only origin the product has for the held state — followed, not run as one test:
an attempt whose publication has not completed is kept off the trading start
(`needsResolution`, `apps/server/src/first-setup-entry.ts:45-62`; the run-time recheck
`:299-311`, exercised by "startup rechecks a newly activation-started attempt before entering its
callback", `apps/server/src/first-setup-resolution.boot.test.ts:301-327`), so no till ever sells
from such a database; other setup writes are fenced while a first-setup claim exists
(`assertOtherAllowed`, `apps/server/src/setup-api.ts:672-686`). What I did NOT prove: that no hand
placement or future path can put rows of unknown origin beside a claimed attempt. The plan does not
rest on that: the server counts invoice records itself (rule 1 below) and reads the database's own
series names into the floor (rule 2).

### Probe 2 — a recovery record that cannot be read (the second place; NOT built)

A throwaway `apps/server/src/zz-a1131-probe.test.ts` built on the `fixture("selected")` of
`apps/server/src/first-setup-backup-entry.test.ts:33-79` (a recovery journalled through `restored`
and selected), started the box, then overwrote the journal's last record with `damaged` and
started it again. Failing case, written before running (the stop would NOT hold): after the damage
the box still starts normally from the target, or the page's status names the recovery's phase.

```
PROBE before damage: kind normal roots are target true
PROBE after damage: kind resolution roots are anchor true
PROBE status 200 {"phase":"uncertain","proofRequired":true}
PROBE anchor venue.db exists false
PROBE target state files ["first-setup-resolutions","trading.env"]
PROBE disk check refused setup.not_ready refused artifact: venue/first-setup-resolutions
```

So a selected recovery — the box's trading venue, which lives in the recovery target — whose journal
becomes unreadable lands on exactly the second place's page: "The setup database is missing", "This
box found a recovery from backup whose records cannot be read", phase `uncertain`. The page and the
box cannot tell it from a recovery that never placed anything, and Start again can only make
progress there by deleting or abandoning that folder (its disk check refuses today, last line). That
could delete invoice records this box filed with AEAT whose only copy is the target, and the
recovery's series name, recorded in the unreadable journal and the target, would no longer be
readable history. That is the owner's stop; the question carries a worked example.

### The rules this plan builds (the held state only)

1. **Start again in the held state is refused if the setup database holds any invoice record.** The
   count comes from the fiscal module through a new seat (Task 1), read from a private copy of the
   database (Task 2). The page shows the counts and does not offer the confirmation (Task 6). Why:
   deleting an invoice record is the loss the owner's condition forbids; the box never sells from an
   unfinished setup, so such a database is a fault, said so at the site.
2. **The floor written to `first-setup-start-again.json` also covers every series name the setup
   database itself holds**, read through the fiscal module's existing history reader
   (`readRecoveryHistory`, as `apps/server/src/first-setup-backup-history.ts:73-80` does for a
   retained database) and handed to `startAgainFloor` as a new input. Why: CLAUDE.md §5 — a new name
   strictly later than all readable history; that database is readable history until Start again
   deletes it.
3. **Status `complete` stays refused**, as on the missing-database path (D3a,
   `apps/server/src/first-setup-resolution.ts:519-522`). A held database with no stopped recovery
   beside it stays refused (only these two states change). An empty database beside an attempt that
   reached activation stays refused (the second row of the suite at
   `apps/server/src/first-setup-start-again-backup-discard.test.ts:826-846` is unchanged).
4. Everything else Start again checks today still applies unchanged: the setup password, the
   discard confirmation with the summary compared byte for byte, `trading.env` and the other refused
   files (`assertStartAgainAllowedOnDisk`), the deletion marker, the running-recovery checks.

## Owner question this PR carries (wording)

> The page now says what the setup database holds. For the example in Task 6 the words are below.
> Do they say enough about what is lost? (The second place, the unreadable recovery record, is a
> separate question already sent.)

## Global constraints

- `git commit -s` for every commit; no `--no-verify`.
- TDD: each task's failing test first, run it, watch it fail for the stated reason.
- Do not edit `packages/fiscal-verifactu/src/write-path.e2e.test.ts` or
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- No shipped migration file changes. No new table.
- Generic code (`packages/provisioning`, `apps/server`, `apps/setup`) never names
  `registros_facturacion`, `envios` or AEAT states: it reads counts through the module seat
  (CLAUDE.md §3, composition seats). The page's own words already name AEAT.
- An implementer past about 150 tool calls stops at a passing or cleanly red point, commits, and
  returns a handover: done, left, files, each check's state.
- Run focused tests only; CI runs the package suites (`CLAUDE.md` §2).

## Tasks

### Task 0: Re-check against main, and measure the node file and `trading.env` per status

Files: none committed except this plan's "Task 0 findings" section.

- Rebase on main; re-read the line references above; fix any that moved.
- Measure, in a throwaway test built on `fixture()` of `first-fiscal-interruption.test.ts` but with
  the database in the fixture's venue folder (`firstFiscalFixture` + `archiveTo` as
  `first-setup-resolution.boot.test.ts:304-305` does): for faults `publication` and `identity`,
  print (a) the attempt status, (b) whether `<venue>/node.db` exists and holds a table, (c) whether
  `<state>/trading.env` exists, (d) what `assertStartAgainAllowedOnDisk(roots)` answers.
- Write the four answers into a "Task 0 findings" section of this plan. If (d) refuses with
  `node.db holds a table` for a status the held state admits, Task 4 also relaxes that one check for
  the held state only (a node file holding tables is then expected; it is already on the deletion
  list, `first-setup-start-again-deletion.ts:284`). If (d) refuses with `trading.env`, that status
  stays refused and the page says so after the password (existing `shell.not_ready` words): record
  which statuses.
- Commit the findings (`-s`). Delete the probe.

### Task 1: The fiscal module counts its invoice records and reads names from a database's history

Files: `packages/module/src/initial-setup.ts`, `packages/fiscal-verifactu/src/initial-hour-setup.ts`
(and the module file that registers it), new test
`packages/fiscal-verifactu/src/start-again-holdings.test.ts`.

- Contract: `InitialSetupContribution.startAgainHoldings?(db: Pick<Database, "execute">)
  : Promise<{ readonly records: number; readonly accepted: number }>`; and `startAgainFloor`'s
  input gains `readonly databaseHistory?: readonly unknown[]` — "what the module's
  `readRecoveryHistory` returned for a database Start again is about to delete; one it cannot read
  refuses".
- Failing tests first (they fail on the missing seat / on a floor that ignores the history):
  1. On a migrated venue database (`useVenueDb` with `TEST_MIGRATIONS`): no invoice record →
     `{ records: 0, accepted: 0 }`; after writing two invoice records through the real write path
     helpers the package's tests already use, one with an `envios` row at `aceptado` →
     `{ records: 2, accepted: 1 }`; an `envios` row at `pendiente` is not counted as accepted.
  2. `hourStartAgainFloor` given `databaseHistory` naming minute M (the shape
     `readHourHistoryWithRecordFloor` returns) answers `floorMs ≥ EPOCH_MS + (M + 1) * MINUTE_MS`
     and `lastName` for M; given a source it cannot read, it refuses (`history_invalid`); given
     none, it answers exactly as today (existing cases unchanged).
- Minimal change: the count is two `select count(*)` reads. An `envios` row's primary key is its
  record's id and references it (`packages/fiscal-verifactu/src/schema/envios.ts:19-22`), so
  `records: 0` means nothing was sent — the page's `heldNoInvoices` line rests on that; the history minutes come from the same
  reader `hour-preparation.ts:173` already applies to `facts.localHistory`.
- Deletion control: drop the `accepted` filter → test 1's `pendiente` row fails; drop
  `databaseHistory` from the minute list → test 2 fails.
- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/start-again-holdings.test.ts`
  and the existing `src/hour-start-again-floor*.test.ts` if present (grep `hourStartAgainFloor`).

### Task 2: The server reads a setup database's holdings and history from a private copy

Files: `apps/server/src/first-setup-backup-history.ts` (extract the private-copy reader into an
exported helper, e.g. `readPrivateVenueCopy(venueDir, read)`), new
`apps/server/src/first-setup-database-holdings.ts` and its test.

- `readSetupDatabaseHoldings(roots, modules, frozenModules)` returns
  `{ rows, records, accepted, history: Record<module, unknown[]> }`:
  `rows` = every row of every table in the copied `venue.db` and `node.db` except SQLite's own and
  each migration set's journal table (`manifestSets()[i].table`, the bookkeeping
  `firstSetupDatabaseIsEmpty` skips); `records`/`accepted` summed over the frozen modules'
  `startAgainHoldings`; `history` from each frozen module's `operations.readRecoveryHistory`.
  A module that has a `startAgainFloor` seat but no history reader refuses `setup.not_ready`.
- Failing test first (fails: module missing): an activated folder from Task 0's fixture answers
  `rows: 20` (or the number Task 0 printed), `records: 0`, `accepted: 0`, and a history naming the
  attempt's own installation; the original files' bytes are unchanged after the read (the extracted
  helper's guarantee, `first-setup-backup-history.test.ts:63`); an empty migrated database answers
  `rows: 0`.
- The existing `apps/server/src/first-setup-backup-history.test.ts` passes unedited.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-database-holdings.test.ts src/first-setup-backup-history.test.ts`.

### Task 3: The summary answers in the held state, with what the database holds

Files: `packages/provisioning/src/first-setup-start-again-confirmation.ts` (summary type and the
confirmation-record parser), `apps/server/src/first-setup-resolution.ts` (`startAgainSummary`,
`gatherStartAgainFloor`), test in `apps/server/src/first-setup-start-again-backup-discard.test.ts`
and the provisioning confirmation test.

- `StartAgainSummary` gains `held?: { rows: number; records: number; accepted: number }`; the
  confirmation parser accepts exactly those three non-negative safe integers and nothing else
  (failing test: a record with `held` is refused today as `setup.attempt_invalid`).
- `startAgainSummary`: when `found?.kind === "stopped"`, the database holds records (Words), and the
  status is not `complete`, it no longer answers `setup.not_ready` at `:441-446`; it reads holdings
  (Task 2), passes `history` into the floor as `databaseHistory`, and answers the summary with
  `held`. It also runs `assertStartAgainAllowedOnDisk(roots, { discarding })`, so a refusal the
  Start again would raise is raised here first.
- Failing tests first, each building a real stopped recovery (`selectedRepair()` then `close`) and a
  real held setup database (Task 0's way), not `databasePresent`:
  1. legitimate: the summary answers `held: { rows: N, records: 0, accepted: 0 }`, its `recovery`
     block as today, and (with no damaged record) no `unreadable`;
  2. records present (seed one invoice record into the copy's source): the summary answers
     `held.records: 1` — so the page can explain — and Start again (Task 4) refuses;
  3. still refused `setup.not_ready`, nothing written: status `complete`; a held database with no
     recovery started; `database: "unknown"`/`"partial"` beside a stopped recovery; an EMPTY
     database beside an attempt at `activation-started` (row 2 of `:826-846`, unedited).
- Deletion control: remove the new branch → test 1 fails with `setup.not_ready`.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-backup-discard.test.ts`
  and `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts`.

### Task 4: Start again goes ahead in the held state, and only there

Files: `apps/server/src/first-setup-resolution.ts` (`startAgainFirstSetup`),
`packages/provisioning/src/first-setup-start-again-deletion.ts` only if Task 0 found the node file
refused; tests in a new `apps/server/src/first-setup-start-again-held.test.ts`.

- In the held state: owner required (password), `confirmRecoveryDiscard.shown` must equal the
  summary (now with `held`), `held.records > 0` → `setup.not_ready` before any write; the
  `PRESENT_START_AGAIN_STATUSES`, `no-venue-rows`, `emptyWorkspace`/`unusedAssignment` gates at
  `:519-555` are skipped for the held state only; the floor includes `databaseHistory`; then the
  existing sequence (confirmation record with `database: "present"`, note, abandon, empty, marker,
  delete) runs unchanged, deleting `venue.db` and (per Task 0) `node.db`.
- Failing tests first:
  1. a held folder from a real activation + stopped recovery: after Start again the venue and state
     trees hold only what an empty Start again leaves (compare with the existing
     `expectNothingWritten`/`tree` helpers of the discard suite), the confirmation record holds the
     shown `held`, `readStartAgainNote` floor ≥ the floor `hourStartAgainFloor` gives for the
     database's series name (decode it from `invoice_series.code`, printed in Probe 1), the
     recovery's journal ends `abandoned`;
  2. a database whose history names a LATER minute than the attempt's input (write a second
     `fiscal_allocations`/series row through the module's own test helper, or hand the copy a
     history with a later identity): the note's floor follows the database, not the attempt —
     deletion control for rule 2;
  3. still refused, nothing changed (tree, journal, note, confirmations all equal before/after):
     `held.records: 1`; status `complete`; a `shown` without `held`; a hand-made request with
     `confirmMissingDatabase`; a held database with no stopped recovery.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-start-again-backup-discard.test.ts src/first-setup-start-again-note.test.ts`.

### Task 5: The HTTPS route and the fence

Files: `apps/server/src/setup-first-fiscal-api.ts` only if the route's body parser rejects `held`
in `confirmRecoveryDiscard.shown`; test in `apps/server/src/first-setup-resolution.route.test.ts`.

- Failing test first: POST `/setup-api/first-setup/resolution/start-again` with a shown summary
  carrying `held` is accepted end to end over the test HTTPS server; the same body with an extra
  key inside `held` is refused `setup.attempt_conflict`.
- Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.route.test.ts`.

### Task 6: The page

Files: `apps/setup/src/screens/initial-owner-strings.ts`, `apps/setup/src/setup-app.ts`
(`#renderFirstOwner`, `canRestart` and the confirm block), `apps/setup/src/api/first-setup-types.ts`
(summary type), tests `apps/setup/src/setup-app-resolution.test.ts`, a new
`apps/setup/src/setup-app-held-database.a11y.test.ts`.

- Start again is enabled when `stoppedHere` and the inspection says the database holds records
  (Words). Pressing it goes to the existing password step; the summary then shows, above the
  existing stopped-recovery block, the lines below, then the existing `startAgainHelp`, the checkbox
  `retireConfirmed`, Cancel and Start again — unchanged controls.
- With `held.records > 0` the page shows the refusal lines instead and no checkbox and no
  confirming Start again; Cancel stays.
- Words (new keys; `{rows}`, `{records}`, `{accepted}` replaced with plain numbers):

| key | English | Spanish |
| --- | --- | --- |
| `heldRows` | The setup database already holds {rows} records from this setup. | La base de datos de configuración ya tiene {rows} registros de esta configuración. |
| `heldRowsOne` | The setup database already holds 1 record from this setup. | La base de datos de configuración ya tiene 1 registro de esta configuración. |
| `heldNoInvoices` | None of them is an invoice, and nothing was sent to AEAT. | Ninguno es una factura y no se envió nada a la AEAT. |
| `heldLost` | Start again deletes them with this attempt. You will enter this setup's details again. | Empezar de nuevo los borra junto con este intento. Tendrás que volver a introducir los datos de esta configuración. |
| `heldInvoices` | It holds {records} invoices, {accepted} of them accepted by AEAT. | Tiene {records} facturas, {accepted} de ellas aceptadas por la AEAT. |
| `heldInvoiceAccepted` | It holds 1 invoice. AEAT accepted it. | Tiene 1 factura. La AEAT la aceptó. |
| `heldInvoiceNotAccepted` | It holds 1 invoice. AEAT has not accepted it. | Tiene 1 factura. La AEAT no la ha aceptado. |
| `heldFault` | An unfinished setup should hold no invoices, so this is a fault in Waitron. Start again would delete them, so it is not offered. Reconnect keeps everything as it is. | Una configuración sin terminar no debería tener facturas, así que es un fallo de Waitron. Empezar de nuevo las borraría, así que no se ofrece. Reconectar lo deja todo como está. |

  Worked example (Probe 1's database): "The setup database already holds 20 records from this
  setup. None of them is an invoice, and nothing was sent to AEAT. Start again deletes them with
  this attempt. You will enter this setup's details again." then today's "A recovery from backup
  started on … and did not finish. Start again deletes it." and "Deletes this attempt. This box will
  not use its invoice series names again."
- `startUnavailableOccupied` stays, now shown only for a held database with no stopped recovery.
- Failing tests first (both locales): (a) the test at `setup-app-resolution.test.ts:1940-1960`
  changes (see "Tests whose checks change"); (b) after the password the held lines appear in order,
  with `heldRowsOne` for `rows: 1`; (c) `records: 2, accepted: 1` shows `heldInvoices` and
  `heldFault`, no `retire-confirmed`, no `confirm-start-again`, Cancel enabled; (d) still refused:
  a held database with no stopped recovery keeps Start again disabled with
  `startUnavailableOccupied`.
- a11y: axe over the held confirmation and the held refusal, light and dark (the pattern of
  `setup-app-missing-database.a11y.test.ts`).
- English-only guard: the Spanish lives only in the strings file (allowed: translation file).
- Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts src/setup-app-held-database.a11y.test.ts`.

### Task 7: The guides

Files: `apps/server/src/guide/en/backup-recovery.md` and `apps/server/src/guide/es/backup-recovery.md`,
section `{#interrupted-setup}` (headings and ids unchanged).

- Replace the sentence "Otherwise the page shows **Start again** beside the stopped recovery,
  available only when the box can check that the setup's database is empty." with: "Otherwise the
  page shows **Start again** beside the stopped recovery. If the setup's database already holds
  records, the page says how many after you enter the password, and that none of them is an invoice
  or was sent to AEAT; if it holds invoices, Start again is not offered, because it would delete
  them."
- Spanish: replace "Si no, la página muestra **Empezar de nuevo** junto a la recuperación detenida,
  disponible solo si el equipo puede comprobar que la base de datos de la configuración está vacía."
  with: "Si no, la página muestra **Empezar de nuevo** junto a la recuperación detenida. Si la base
  de datos de la configuración ya tiene registros, la página dice cuántos después de que introduzcas
  la contraseña, y que ninguno es una factura ni se envió a la AEAT; si tiene facturas, no ofrece
  Empezar de nuevo, porque las borraría."
- Run: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.

### Task 8: Look at it

- Build the setup app (`pnpm --filter @waitron/setup build`), open the repair page with a stubbed
  held summary (the way A1042's Task 3a2-era check did, plan
  `2026-10-24-a1042-start-again-series-note.md:1175`: stubbed API answers in the browser test
  harness, screenshot with the workspace's Playwright Chromium), in English and Spanish, light and
  dark, at phone width (about 375 px), for: the held confirmation, the held refusal. Check the lines
  wrap without overlap and the danger button turns red only once the box is ticked.
- Keep the screenshots out of the commit; say in the PR that it was done and what was seen.

### Task 9: Docs

- `docs/backlog/setup.md`, entry "A1131: …": cut the first bullet and the case-1 words, keep the
  second bullet as the open point, retitle it "A1131: Start again beside a recovery record that
  cannot be read, with the setup database missing", and add one line: "Waits for the owner: an
  unreadable record may belong to a recovery the box has been trading from (A1131 question,
  2026-10-28)." Update its line in `docs/backlog.md` (`:593-596`) to match.
- `## Decisions and deliberate limits` in `docs/backlog/setup.md`: add "**DECIDED (owner,
  2026-10-26; built as A1131 part 1): beside a stopped recovery, Start again is offered even when the
  setup database holds records.** The page says how many, and that none is an invoice or was sent to
  AEAT; a database holding an invoice is refused as a fault, and the start-again note's floor also
  covers the database's own series names."
- Do not fold in the neighbouring entries (below).

## Tests whose checks change (the PR names each)

| Test | Today's assertion | New assertion |
| --- | --- | --- |
| `apps/setup/src/setup-app-resolution.test.ts:1940-1960` "with the database present and holding records beside a stopped recovery, the disabled Start again says why" | `start-again` disabled; text contains `startUnavailableOccupied` | `start-again` enabled; no `startUnavailableOccupied`; renamed "… Start again is offered and, after the password, says what the database holds" |
| `apps/server/src/first-setup-start-again-backup-discard.test.ts:826-846`, row "the venue database holds rows" | summary refuses `setup.not_ready` | moved to Task 3's legitimate case with a real held database (the `databasePresent(host, "occupied")` stub cannot be read by the holdings reader); row "the attempt reached activation" stays unedited |

Grep before Task 6 and Task 3 for any other assertion of today's refusal:
`grep -rn "startUnavailableOccupied\|\"occupied\"" apps/setup/src apps/server/src/first-setup-*.test.ts`.
Any further hit that asserts the held state's refusal is listed here before it is edited; a hit
about a database with no stopped recovery is not edited.

## Guard suites to run

- No new error code (refusals reuse `setup.not_ready`), so `scripts/alert-codes.test.ts` and
  `scripts/errors-reachable.test.ts` should not move; run both once to show it.
- `scripts/english-only.test.ts` (new Spanish only in the strings file and guide).
- `scripts/module-seams.test.ts` (the new seat; generic code names no fiscal table).
- `scripts/personal-log-params.test.ts` (no names in the new params: counts only).
- `scripts/native-form-fields.test.ts` and `scripts/style-token-names.test.ts` if the page change
  adds markup.

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
