# A1308 fiscal 7: drop `acks`, keep AEAT answers that are cleared, guard the sending gate — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `acks`, a second copy of each submission's AEAT answer that nothing decides from;
before a submission row's AEAT answer is cleared, write it to the fiscal history as kind
`aeat.answer_cleared` (AEAT's CSV cannot be fetched again later); and settle the A805 follow-up for
`envio_flujo` (now `verifactu_sending_state`): its one row is never deleted, because deleting it
opens AEAT's send gate early.

**Architecture:** `acks` is written beside every state change of a submission row
(`packages/fiscal-verifactu/src/acks.ts:9-13`: "`writeAck` is the sole producer, always called in the
SAME transaction as the estado write"); its only reader outside tests is the handover summary's
digest (`handover-summary.ts:83-107`, added by A1018 slice 4), which then digests the submission rows'
answer columns instead. The new history kind is written by `keepAnswerBeforeClearing`, which the
three writers of a submission row's four answer values call before they write (traced below):
`setEstado` (`drain.ts:1689-1717`, every drain outcome and setting a cancellation aside), reconcile's
`correct` (`reconcile.ts:513-548`) and reconcile's resubmission `remediateNoTrace`
(`reconcile.ts:555-568`). It writes only when the row holds a value the write is about to change, so
a first answer writes nothing. The sending state's delete refusal is one trigger in the module's
trigger file (fi6).

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §1.1
`verifactu_sending_state`, §3 `aeat.answer_cleared`, §4 (`acks`, `envio_flujo`), §5, §6 ("AEAT's
answer, in both `acks.state`/`acks.csv` and `envios.estado`/`envios.csv`"); README §10 ("AEAT answers
reconcile clears — kept in `verifactu_history`"), "Additions of 6 November 2026" (`envio_flujo`);
Orden HAC/1177/2024 art. 16.2 (the wait between sends,
[`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md):459-461); rules
[2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi6. Line numbers read at `9c66ef0356` (after #2570, `df7fc95182`).

**Owner lands:** yes (AEAT sending state).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply; fi4a's CHECK rule applies to the new kind's CHECK.
- **Sending is unchanged.** What is sent, when, and how answers are stored on the submission row: the
  drain and reconcile suites keep their assertions, except the assertions that read `acks` rows,
  which go with the table (listed in the pull request).
- `aeat.answer_cleared` is written only when the row holds a non-null value among the four that the
  coming write changes: a row with nothing to keep is not evidence, and a write that leaves a value
  as it was loses nothing.

## Review Focus

1. **Every writer of the four answer values calls `keepAnswerBeforeClearing` first.** A reviewer
   re-runs the two searches in "Every writer of the four answer values, traced" on the branch and
   checks each writer of `csv`, `codigo_error`, `mensaje_error` or `confirmado_en` is one of the three
   named there. A search for `csv: null` alone (the plan's first version) misses `setEstado`, which
   rewrites all four on every call, and `correct`, which rewrites `confirmado_en`.
2. **The handover digest still catches a difference** in AEAT answers between a copy and its
   description (A1018 slice 4's purpose).
3. **The gate.** No code path is left that relies on "no row means the gate is open" after a send
   has happened (`drain.ts:439-450`): the row exists from the first send and cannot now be deleted.

---

## What it builds

- **Deleted:** `acks`, `packages/fiscal-verifactu/src/acks.ts` and `acks.test.ts`, the `writeAck`
  and `deleteAck` calls (`drain.ts:20`, `:875`, `:1054`, `:1181`, `:1716`; `reconcile.ts:16`, `:526`,
  `:567`; `record-remedy-held.ts:7`, `:97`), the schema file, classification entry
  (`classification.ts:21`), backup link (`backup-verification-history.ts:442`), the
  `schema-ownership.test.ts:11` entry, and `AckState` (`packages/fiscal/src/backend.ts:155`,
  `index.ts:32`), which nothing else uses (`git grep -nw AckState` at `9c66ef0356`: only these, the
  `acks.ts` import, and a comment at `backend.ts:159`, reworded). `pendingAcks`, `markDelivered`,
  `applyAck`, `newProjection` and `unsentCount` in `acks.ts` have no caller outside tests
  (`git grep -nE "pendingAcks|markDelivered|applyAck|newProjection|ackStateOf"` at `9c66ef0356`; the
  `unsentCount` hits in `apps/server/src/till-api.ts:1743-1753` are a local variable of the same
  name, not this function).
- **The handover summary** (`handover-summary.ts`): `acksSha256` becomes `submissionsSha256`, the
  SHA-256 of `JSON.stringify` of `[registro_id, estado, csv, codigo_error, mensaje_error, enviado_en, confirmado_en]`
  for each of the chain's submission rows, ordered by `registro_id` (the same rows the `envios`
  counts read, `:69-80`). Like the old digest, it changes when any AEAT answer on the chain changes.
  The field is compared only between two boxes on the same version, after a reset.
- **`aeat.answer_cleared`** in `verifactu_history`: `at` = the clearing time; `registro_id`; `data`:
  `by` (`'drain'` or `'reconcile'`: the module whose write replaced the values), `csv`, `codigoError`,
  `mensajeError`, `confirmadoEn`, the values the row held just before.
  `verifactu_history_cleared_ck`: `registro_id is not null and json_extract(data, '$.by') in ('drain', 'reconcile') and json_type(data, '$.csv') is not null and json_type(data, '$.codigoError') is not null and json_type(data, '$.mensajeError') is not null and json_type(data, '$.confirmadoEn') is not null and ref_id is null and person_id is null and event_key is null`
  (each key present; its value may be JSON null). `verifactu_history_kind_ck` gains
  `'aeat.answer_cleared'`.
- **Trigger** `verifactu_sending_state_no_delete` in `packages/fiscal-verifactu/triggers/fiscal-verifactu.sql`:

  ```sql
  CREATE TRIGGER verifactu_sending_state_no_delete BEFORE DELETE ON verifactu_sending_state
  BEGIN SELECT RAISE(ABORT, 'verifactu_sending_state: the sending gate is never deleted'); END
  ```

  Its constant in `src/trigger-refusals.ts` says why: with no row, `readFlujo` reads the gate as open
  (`drain.ts:437-450`), so a delete would let the next envío go before AEAT's wait (art. 16.2). An
  update is not guarded: the drain rewrites the gate after every reply (`drain.ts:503-510`,
  `:1236-1262`), and `on conflict … do update` fires update triggers. "No row" stays a real state: a
  venue that has never sent has none (`schema/envio-flujo.ts`, the table comment: "Lazily created").

**Decision this plan makes** (open to the owner): *every write that replaces a held answer value
keeps it, not only the two the design names.* tables-fiscal §3 names reconcile's resubmission and the
hold at `drain.ts:934` (now `:932`). The trace below finds a third writer that loses a value, reconcile's drift
correction (`correct`, `reconcile.ts:523-524`, rewrites `confirmado_en` on an `aceptado` row AEAT now
reports `AceptadoConErrores`), and finds that the hold, read from the code, never meets a row holding
a value. Calling the keeper inside every writer covers all three and any path the reading missed, at
the cost of one read of the row per write. Default: build it this way.

## Every writer of the four answer values, traced

Searches, run at `9c66ef0356` (re-run on the branch, where the table is `verifactu_submissions`):

```bash
git grep -nE "update envios|update verifactu_submissions|update\(envios\)|update\(verifactuSubmissions\)|insert\(envios\)|insert\(verifactuSubmissions\)" -- packages apps ':!**/*.test.ts' ':!**/test/**' ':!**/testing/**'
git grep -nE "setEstado\(" -- packages/fiscal-verifactu/src ':!**/*.test.ts'
```

The first prints 22 lines at `9c66ef0356`, all in `packages/fiscal-verifactu/src`: six inserts (`backend.ts:347`, `:487`, `:578`, `:706`;
`record-remedy.ts:195`; `record-remedy-absent.ts:157`), which leave the four values null (no default on the four columns, `schema/envios.ts:35-39`), and 16
updates. Only three of the updates write any of the four values:

| Writer | Writes | Callers and what the row holds before | After this plan |
| --- | --- | --- | --- |
| `setEstado`, `drain.ts:1689-1717` | all four, every call (`:1705-1712`), a value not passed becoming null | `setAside` `:932` (retenido, all four null); `applyOutcome` `:1536` (aceptado), `:1555` (rechazado); `settleAcceptedWithErrors` `:1609`; `handleDuplicate` `:1887` (aceptado), `:1900` (rechazado). Every caller acts on a row just claimed (`pendiente` to `enviando`, `:730`) or a probe (`detenido`, `:1121`). Read from the code, not run: those states hold four nulls, because the only ways into them (`:570`, `:730`, `:873`, `:1039`, `:1164`, `:1201`, `:1669`, `record-remedy-held.ts:94`) write none of the four, and the only way out of an answered state back into them is `remediateNoTrace`, which clears first | Calls `keepAnswerBeforeClearing(tx, id, "drain", next)` before its update; writes the ack no more. Expected to write nothing on every caller; a test pins that a first answer writes nothing (Task 1) |
| `correct`, `reconcile.ts:513-548` | `estado`, `confirmado_en = now` (`:523-524`); `csv`, `codigo_error`, `mensaje_error` untouched | lost answer (`:207`, row `pendiente`: four nulls, so nothing to keep); drift to `AceptadoConErrores` (`:255`, row `aceptado` with the `confirmado_en` the drain wrote: that time is lost today) | Calls it with `by: "reconcile"` and the new `confirmado_en`; on the drift path it keeps the old `confirmado_en` (and, unchanged, the row's `csv`) |
| `remediateNoTrace`, `reconcile.ts:555-568` | all four to null (`:557-566`) | row `aceptado` or `aceptado_con_errores` (`:211`), holding the drain's CSV and time | Calls it with `by: "reconcile"` before its update (the design's first place) |

The other thirteen updates write only `estado`, `incidencia`, `technical_incidence`, `enviado_en`,
`intentos`, `proximo_intento_en` or `reconciled_resubmit_at` (`drain.ts:320`, `:570`, `:730`, `:873`,
`:1039`, `:1121`, `:1164`, `:1201`, `:1222`, `:1669`; `outbox.ts:42`; `record-remedy-held.ts:94`;
`reconcile.ts:572`). Outside `packages/fiscal-verifactu/src` nothing writes the table (the first
search has no hit elsewhere; the only other code naming the answer columns reads them:
`certificate-card.ts:42-53`, `slot.ts:71`).

`keepAnswerBeforeClearing` therefore takes the values about to be written and compares each with the
row; the design's "hold" (`setAside`) is covered by the `setEstado` call, and is not a separate call
site.

## Every path that deleted the ack row, and what it does after

| Path | Before | After |
| --- | --- | --- |
| `releaseBrakeHold`, `drain.ts:1031-1056` | `detenido` head back to `pendiente`, then `deleteAck` (`:1054`) | The update alone. The row's four values are null (table above), so nothing is kept |
| `releaseSettledBrakeHolds`, `drain.ts:1150-1184` | each released `detenido` row back to `pendiente`, then `deleteAck` (`:1181`) | The update alone, as above |
| `remediateNoTrace`, `reconcile.ts:555-568` | clears the four values, then `deleteAck` (`:567`) | `keepAnswerBeforeClearing` first, then the update |
| `record-remedy-held.ts:93-97` | `retenido` back to `pendiente`, then `deleteAck` (`:97`) | The update alone. `setAside` cleared the four values when it set the row aside, keeping any it held |

`writeAck`'s other caller, the bulk hold in `haltOpenChainClaims` (`drain.ts:873-875`), loses its
loop; its comment at `:818-819` ("A `halted` ack is written per held id…") goes.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Reading cleared answers on a screen | Not built: the owner's decision keeps them (README §10); a screen is a separate item |
| `ReconcileResult.lostAck` and its name | Unchanged: it names a reconcile outcome, not the table |

## Interfaces

```ts
// added to HistoryEntry in packages/fiscal-verifactu/src/history.ts
| { kind: "aeat.answer_cleared"; nodeId: NodeId; at: Date; registroId: string;
    data: { by: "drain" | "reconcile"; csv: string | null; codigoError: number | null;
            mensajeError: string | null; confirmadoEn: Date | null } };

export interface AnswerValues { csv: string | null; codigoError: number | null; mensajeError: string | null; confirmadoEn: Date | null }

/** Writes `aeat.answer_cleared` with the row's four values as they are now, when one of them is not
 * null and differs from `next`, the values the caller is about to write. */
export function keepAnswerBeforeClearing(tx: Transaction, registroId: string, by: "drain" | "reconcile", next: AnswerValues, now: Date): Promise<void>;

// packages/fiscal-verifactu/src/handover-summary.ts
export type ChainSummary = { /* as today */ submissionsSha256: string /* replaces acksSha256 */ };
```

## Files

**Modify**
- `packages/fiscal-verifactu/src/drain.ts` (ack calls; `setEstado` `:1689-1717` calls
  `keepAnswerBeforeClearing` before its update), `reconcile.ts` (ack calls; `correct` `:513-548` and
  `remediateNoTrace` `:555-568` call it before their updates), `record-remedy-held.ts:7`, `:97`.
- `packages/fiscal-verifactu/src/history.ts`, `schema/verifactu-history.ts` and its test,
  `handover-summary.ts`, `handover-summary.test.ts`, `schema/index.ts`, `classification.ts`,
  `backup-verification-history.ts:442`, `trigger-refusals.ts`, `triggers/fiscal-verifactu.sql`.
- `packages/fiscal/src/backend.ts:150-160`, `packages/fiscal/src/index.ts:32`.
- `scripts/behavioural-triggers.test.ts`, `scripts/schema-constraints.test.ts` (`acks_state_ck`, the
  `acks` key).
- Tests that read or write acks. `git grep -lw acks -- apps packages scripts ':!**/drizzle/**'` prints
  40 files at `9c66ef0356`; of those, `apps/server/src/errors.ts:412`, `apps/server/src/webhook.test.ts`
  and `packages/tunnel/src/*` use the English word, the three `packages/country-es/test-fixtures/demo/madrid-before-move.*`
  files are the demo capture (no row), and the eight product and schema files are named above. The
  test files, and what each loses:
  - set-up writes of an ack (`writeAck`, raw `delete from acks`), deleted: `reconcile.record-versions.test.ts:10`,
    `:48`; `record-remedy-brake.test.ts:13`, `:358`, `:405`, `:424`; `record-remedy-held.test.ts:18`, `:84`;
    `reconcile-sweep.test.ts:59`, `:112`, `:128`; `reconcile.completeness.test.ts:50`;
    `slot.reconciliation.test.ts:44`.
  - snapshot keys and table lists naming `acks`, the key or entry deleted: `record-remedy-brake.test.ts:134`,
    `record-remedy-held.test.ts:160`, `reconcile.completeness.test.ts:39`, `reconcile.unheld.test.ts:86`,
    `schema-ownership.test.ts:11`, `backup-verification-history.test.ts` (4 lines), and
    `drain.conflict-recovery.test.ts:382`'s `select * from acks` inside its back-out check.
  - assertions about ack rows: "Assertions that change, by design" below.
  - `drain.outage.restart.test.ts`, `reconcile.concurrent.test.ts`, `reconcile.conflicts.test.ts`,
    `reconcile.scope.test.ts` (2 lines each) and `drain.cases.test.ts`, `drain.probe.test.ts` (the
    `ackOf` helpers, `:110-115`, `:112-117`): the builder re-runs the search and sorts each hit into
    one of the three kinds above; a hit that is none of them is stop 1.
- `apps/server/src/handover-compare.test.ts:771` and `:1294` use `acks` as "a table or column the
  fiscal summary reads": `alter table acks drop column csv` and `drop table acks`. After this slice
  the summary reads the submission rows' answer columns instead, so both drop
  `verifactu_submissions.mensaje_error` (read by the new digest; `slot.ts:71` reads it too, but the
  compare does not run it). `:1294`'s drop becomes a column drop because the summary no longer reads a
  table of its own. The expected refusals (`handover.modules_differ`, `handover.summary_unreadable`)
  are unchanged; if the database refuses the drop (a trigger or index naming the column), the builder
  picks another column only the digest reads and says which in the pull request.
- Tests that delete the sending state (7 statements: `git grep -n "delete from envio_flujo" -- packages apps`
  at `9c66ef0356`):
  - `drain.test.ts:269` and `:359` (in `afterEach`) and `migrations.test.ts:119` (a test's last line):
    deleted. `useVenueDb`'s reset after every test already drops every trigger, empties every table
    and re-creates the triggers (`packages/db/src/testing/venue-db.ts:134-144`, `:162-165`), and these
    suites use the default `resetPerTest` (`drain.test.ts:34`, `migrations.test.ts:21`), so the
    statements add nothing; left in, the two in `afterEach` would hit the new trigger whenever they run
    before the helper's reset.
  - `drain.clock-step.test.ts:217`, `:221`, `drain.test.ts:593` (`passWithGate`'s `finally`) and
    `:1844` (mid-test, "clear it so the second pass is ungated"): each becomes `openSendingGate(db)`.
- `packages/fiscal-verifactu/test/drain-fixtures.ts`: `openSendingGate(db)` restores the never-sent
  state the deletes produced, the way `useVenueDb`'s reset does: in one transaction, read the
  trigger's text from `sqlite_master`, drop it, `delete from verifactu_sending_state`, run the text
  again. This keeps "no row" exactly, so `technical_incident_token` is cleared as the delete cleared
  it, and `readFlujo` returns `proximoEnvioEn: null` as before. Setting a past `proximo_envio_en`
  instead would not be the same state: `bumpNextDue(result, flujo.proximoEnvioEn)` (`drain.ts:257`,
  `:347`) ignores only a null, so a deferred claim would then report a `nextDueAt` in 1970.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`acks` to `REMOVED_TABLES`; it held
  no captured row).

**Delete**
- `packages/fiscal-verifactu/src/acks.ts`, `acks.test.ts`, `schema/acks.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: kind and CHECK 20, `keepAnswerBeforeClearing` 40, three call sites 10, handover digest 20, trigger and constant 8, `AckState` and comment 4 | ~100 |
| Tests: CHECK cases 50, answer-kept cases 110 (reconcile resubmission, drift, a first answer writing nothing, the unit cases), handover digest re-pointed 40, handover-compare drops 6, trigger cases 30, gate helper and its sites 25; ack set-ups and assertions removed (deletions, uncounted) | ~260 |
| **Total** | **~360** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema/verifactu-history.test.ts src/history.test.ts src/handover-summary.test.ts src/drain src/reconcile src/record-remedy-held.test.ts src/record-remedy-brake.test.ts src/engine-clock-and-floor.test.ts src/migrations.test.ts src/backup-verification-history.test.ts src/slot.reconciliation.test.ts src/schema-ownership.test.ts
# and fi1's record suites
pnpm --filter @waitron/fiscal exec vitest run
pnpm --filter @waitron/server exec vitest run src/handover-compare.test.ts src/handover-stepdown.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts
git grep -nw "acks\|writeAck\|deleteAck\|AckState\|acksSha256" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing (check each hit is not an unrelated English "acks", such as
`apps/server/src/errors.ts:412`'s "the route acks 2xx"; that one stays and is excluded by path in the
pull request's run).

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`. Under each phase (`acks` had no
append-only trigger, so the three are alike; missing lines simulated on 2026-11-08 from `a086eedfb7`
with fi1–fi6 applied):

```text
missing index acks.primary key(registro_id)
missing table acks
changed table verifactu_history.checks[verifactu_history_kind_ck].expression
old: <fi6's five kinds>
new: <the six kinds, with 'aeat.answer_cleared'>
extra table verifactu_history.checks[verifactu_history_cleared_ck]
extra trigger verifactu_sending_state_no_delete
```

Design reasons: tables-fiscal §5 (`acks`: "Dropped with the table; nothing reads it"); §3
`aeat.answer_cleared`; README "Additions of 6 November 2026" for the trigger.

## Assertions that change, by design

Each goes because the table it reads goes (tables-fiscal §5, `acks`: "Dropped with the table; nothing
reads it"); the estado assertions beside each stay.

| Test | Assertion |
| --- | --- |
| `drain.test.ts:1575-1590` | each terminal row has an ack agreeing with `ackStateOf(estado)` |
| `drain.cases.test.ts:149`, `:230`, `:273`, `:691`, `:758` | `ackOf(…)` is `rejected`, `halted`, `accepted_with_errors` |
| `drain.probe.test.ts:241`, `:377`, `:773` | `ackOf(…)` is undefined or `halted` |
| `drain.conflict-recovery.test.ts:90` | the ack rows after a reply |
| `reconcile.test.ts:295-297`, `:361-362`, `:580` | "a `pendiente` row carries NO ack"; the converged ack |
| `reconcile-sweep.test.ts:79`, `slot.reconciliation.test.ts:78`, `:309` | ack row ids and counts |
| `record-remedy-held.test.ts:188`, `record-remedy-brake.test.ts:168` | the release deleted the ack |
| `engine-clock-and-floor.test.ts:120-140` (`describe("markDelivered")`) | the whole block, with its import (`:16`) |
| `migrations.test.ts:123-…` (`describe("acks migration")`) | the whole block |
| `acks.test.ts` | the whole file |

The builder re-runs `git grep -nw "acks\|ackOf\|ackStateOf\|pendingAcks\|markDelivered" -- packages/fiscal-verifactu/src`
on the branch before deleting and lists every assertion removed in the pull request; an assertion
not of these kinds is stop 3.

## Stop points (beyond rules §5)

1. A product read of `acks` exists that this plan does not list (beyond the handover digest).
2. A writer of a submission's `csv`, `codigo_error`, `mensaje_error` or `confirmado_en` exists that
   "Every writer of the four answer values, traced" does not name, or a test shows `setEstado`
   writing `aeat.answer_cleared` on a first answer (the trace read that every caller meets four
   nulls; if one does not, the keeper is right to write, but the trace was wrong and the watcher
   decides whether that row's earlier answer is a case the design must hear about).
3. A drain or reconcile assertion, other than one reading `acks` rows, needs a change.
4. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which identity
   or series a sale uses.
5. A product path deletes the sending-gate row.

## Needs

fi6 (the trigger file and refusal constants it creates).

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: the cleared-answer kind (test first)

- [ ] **Step 1: Failing tests.** In `verifactu-history.test.ts`, the new CHECK as fi4a Task 1. In
  `history.test.ts`: "keeps the four values before they are cleared" — a row `aceptado` with a CSV,
  then `keepAnswerBeforeClearing(…, "reconcile", all null, …)`: one history row whose data equals the
  four values and `by`; "writes nothing when there is nothing to keep" (all four null); "writes
  nothing when the write leaves every held value as it is" (a row with a CSV, `next` carrying the same
  CSV). In `reconcile.test.ts`: after a `noTrace` resubmission (`remediateNoTrace`), the history holds
  the cleared CSV, and the submission row's CSV is null as today; after a drift correction to
  `aceptado_con_errores`, the history holds the row's earlier `confirmado_en`. In `drain.test.ts`
  (control for the trace): after an ordinary accept and an ordinary refusal, the history holds no
  `aeat.answer_cleared` row. What a failing keeper prints there: with its "a held value is not null"
  check removed, the drain control finds a history row and fails.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement; rebuild the set. Run; PASS.
- [ ] **Step 4:** Commit: "Keep an AEAT answer in the fiscal history before it is cleared (A1308 fiscal 7)".

### Task 2: delete acks; the handover digest

- [ ] **Step 1:** Re-point `handover-summary.test.ts`: each `acksSha256: acksHash([…])` becomes
  `submissionsSha256: submissionsHash([…])` over the fixture's submission rows; the control
  "changes when an answer changes" (`:228-236`) edits a submission row's CSV instead of an ack. Run:
  FAIL.
- [ ] **Step 2:** Implement the digest; delete `acks.ts`, its test, the schema file, the calls, the
  entries, the link and `AckState`; remove ack assertions from the tests in Files (pure deletions,
  listed in the pull request). Rebuild the set.
- [ ] **Step 3:** Run the Finish line's fiscal-verifactu, fiscal and server lines. PASS. Commit:
  "Remove acks, a copy of each submission's AEAT answer (A1308 fiscal 7)".

### Task 3: the sending gate's delete refusal (A805)

- [ ] **Step 1: Failing cases** in `scripts/behavioural-triggers.test.ts`: deleting the gate row is
  refused with the constant; accepting controls: the drain's upsert after a reply, and its
  `technical_incident_token` clear (`drain.ts:1259-1260`), both succeed. In `drain-fixtures`' own
  test: after `openSendingGate`, the table has no row and the trigger is present again.
- [ ] **Step 2:** Add the trigger and constant; rebuild. Handle the seven test deletes as Files says
  (three deleted, four become `openSendingGate`). Run the Finish line. PASS.
- [ ] **Step 3:** Commit: "The sending gate's row is never deleted (A1308 fiscal 7, A805)".

### Task 4: protection list, documents, finish

- [ ] **Step 1:** Protection list against `<A>`: exactly "Expected protection-list difference".
- [ ] **Step 2: Documents** (rules §9): delete "`envio_flujo`: decide the remaining DELETE
  restriction (A805 follow-up)" from the bundle; add to `grants-retirement-audit.md` after `:144`:
  "**2026-11-xx:** `envio_flujo` (now `verifactu_sending_state`) was settled by A1308 fiscal 7: its
  row is never deleted (`verifactu_sending_state_no_delete`); updates stay, as the drain writes the
  gate after every reply." `docs/developers/conventions-data.md`: any sentence about acks goes;
  `apps/server/README.md` and `docs/superpowers/plans/2026-11-02-a1018-handover-build.md` are
  checked for `acksSha256` (the plan is historical: a dated pointer line under its Task 4.2 saying
  the field became `submissionsSha256` in A1308 fiscal 7).
- [ ] **Step 3:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset`.
