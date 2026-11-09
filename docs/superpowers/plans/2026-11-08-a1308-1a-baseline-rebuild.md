# A1308 slice 1a: the starting-migration rebuild command — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command, `pnpm --filter @waitron/server migration-baseline rebuild --set <name>`, that
rewrites a migration set's one starting migration from its TypeScript schema plus its hand-written
SQL, a check-only form of it that CI runs for every set, and its one-off use on all eight sets so
that later slices compare cleanly.

**Architecture:** A new `rebuild.ts` beside the A760 tools in `apps/server/scripts/migration-baseline/`
runs `drizzle-kit generate` into a throwaway folder, appends the set's `triggers/<set>.sql` if it has
one, and replaces the set's `drizzle/` folder and its line in `scripts/migration-baseline-epoch.json`
only when the result differs. It refuses a `drizzle/` folder holding anything but the one starting
migration, so it can never delete a hand-written migration. Core's 42 hand-written triggers move into
`packages/db/triggers/core.sql`. A root guard runs the check-only form for every set and refuses a
second migration in any set; it replaces `scripts/migrations-match-schema.test.ts`, which is deleted.

**Tech Stack:** TypeScript run by `tsx`, Vitest, drizzle-kit 0.31.11 (every set's package, checked
2026-11-08), `node:sqlite` through the existing protection-list tool.

**Spec:** [design](../specs/2026-11-02-rationalisation/README.md) §6 "Migrations and upgrades" and
§9; [slice rules](2026-11-08-a1308-slice-rules.md) (every rule there applies; this plan cites it as
"rules §n", including §8's "any schema change, A1308 or not, is made with the rebuild command");
[build order](2026-11-08-a1308-build-order.md), batch 1, slice 1a.

**Changed on `main` since (checked 2026-11-09 against `48d527dbc8`):** #2594 (`5f11ab6405`) added
core's first generated migration, `packages/db/drizzle/0001_print_job_kind_index.sql` (one
`CREATE INDEX print_jobs_printer_kind_idx ON print_jobs (printer_id, kind)`), from one `index(...)`
line in `packages/db/src/schema/print-jobs.ts`; the same range changed two comments in
`packages/db/src/schema/orders.ts` and `working-order-counters.ts`. Its `0001_snapshot.json` has
`prevId` equal to `0000_snapshot.json`'s `id` and differs from it only by that index (`jq -S .tables`
diff, run), so it passes this plan's `--fold-generated` test, and core folds it exactly as
workforce-es folds its `0001`. Core's SQL hash in the Finish line was measured before it and is
re-measured by the builder (stop point 4); the protection-list prediction does not change, because
the base list and the slice's both hold the index.

**Base:** worktree HEAD `a086eedfb7` (`main` `d908a5b8d4` plus two docs commits). `main` at
`15e6f3de87` (2026-11-08) has no change under `packages/*/drizzle`, `packages/*/src/schema`,
`packages/migrations` or the epoch file since `d908a5b8d4` (`git diff --stat`, run). Every
measurement below was taken in a throwaway worktree of `a086eedfb7`, or read-only in the docs
worktree; nothing was committed. A reviewer reproduced the method independently: the seven SQL
hashes matched, `compare` gave 238 `changed` lines with no `missing` or `extra`, and a second
generation was byte-identical.

**Who lands it: the lane.** **Owner, 2026-11-09:** the lane lands 1a. The rebuild changes
the column order of `sales`, `sale_lines`, `tenants` and `registros_facturacion` (today's name for
`verifactu_records`), which rules §6 names, and nothing else about them. The reviewer's evidence,
read not run by this plan's author: no production code depends on column order — `SELECT *` readers
read by column name (`apps/server/src/backup-evidence.ts:57-80` sorts the names), nothing outside
tests inserts by position into a table whose order changes, no production code reads table
definitions back, and the fiscal hash is built from named fields.

**Why every set (coordinator, 2026-11-08):** the slice-4b plan writer found `payments`' committed
starting migration does not match a fresh regeneration. Measured here for every set: each populated
set's committed SQL differs from what `drizzle-kit generate` writes into an empty folder today (node
5 changed lines, workforce 111, workforce-es 4 plus its `0001`, payments 51, bookings 6,
fiscal-verifactu 94, core 870 before its triggers), because A760's `preserve` kept the old history's
text and column order.

## Words used here

- **Migration set:** one folder of drizzle migration files with its own journal table; the eight
  are named in `packages/migrations/migrations.manifest.json` (`core`, `node`, `workforce`,
  `workforce-es`, `payments`, `fiscal-verifactu`, `fiscal-none`, `bookings`).
- **Starting migration:** a set's `drizzle/0000_baseline.sql`, with `drizzle/meta/_journal.json`
  (its date, `when`, in milliseconds) and `drizzle/meta/0000_snapshot.json` (drizzle's record of the
  schema, used to work out the next migration).
- **Epoch file:** `scripts/migration-baseline-epoch.json`; it records each populated set's tag,
  `when` and the SHA-256 of its SQL, and `scripts/migration-upgrade.test.ts` (`verifyEpoch`,
  :160-185) refuses any mismatch.
- **Hand-written SQL file:** `<package>/triggers/<set>.sql`, for any set; only `CREATE TRIGGER`
  statements, appended after the generated SQL. Today only core has one.
- **Protection list:** the slice-0 tool (`apps/server/scripts/protection-list/`) that lists every
  CHECK, trigger, foreign key and index a freshly built database holds, and compares two lists
  (`docs/developers/testing-guide.md#the-protection-list`).
- **Change-feed trigger:** `waitron_change_<table>_update`, installed by code at every start
  (`packages/db/src/change-feed.ts:116`); its `WHEN` clause compares every column in the table's
  column order, so it changes whenever column order does.

## What it builds

1. `rebuild --set <name> [--fold-generated <tag>]` and `rebuild-check --set <name>` on the existing
   CLI (`apps/server/scripts/migration-baseline/cli.ts`), for every set the manifest names, read the
   way `manifestCopySets()` reads it (`apps/server/scripts/migration-baseline/copies.ts:31-37`).
   `rebuild` refuses a `drizzle/` folder holding anything other than `0000_baseline.sql`,
   `meta/_journal.json` and `meta/0000_snapshot.json` (an empty set: the journal alone), unless
   `--fold-generated` names a second migration that it can show drizzle-kit generated.
   `rebuild-check` writes nothing and fails unless a rebuild would change nothing.
2. Hand-written SQL for any set in `<package>/triggers/<set>.sql`; core's 42 triggers move there out
   of `packages/db/drizzle/0000_baseline.sql` (today lines 3008–3856), in today's order and text.
3. A root guard, `scripts/starting-migrations.test.ts`: every set holds one starting migration and
   nothing else, and `rebuild-check` passes for every set. That covers the trigger tail, any hand
   edit to a set's SQL, snapshot, journal or epoch line, and a drizzle-kit upgrade that changes the
   generated text. It runs in the root project and replaces `scripts/migrations-match-schema.test.ts`
   (item 9).
4. The eight packages' `db:generate` scripts point at the rebuild command; `db:generate:custom` is
   deleted (a hand-written migration is no longer allowed).
5. The pinned backup-verification hash (`apps/server/src/backup-verification-target.test.ts:413-427`)
   pins only what stays steady across a rebuild, with controls.
6. The one-off rebuild of all eight sets; `workforce-es`'s generated `0001_continuous_paid_breaks`
   (landed 2026-11-08 by #2597: four `ALTER TABLE … ADD` statements) folds into its starting
   migration through `--fold-generated`, and so does core's generated `0001_print_job_kind_index`
   (landed 2026-11-08 by #2594: one `CREATE INDEX`).
7. The two-branch rehearsal (rules §2.4), run once by hand and pasted into the pull request.
8. The method in `docs/developers/conventions-data.md`, the testing guide's A760 tools section,
   `packages/db/README.md` and one CLAUDE.md §3 entry, including that work beside A1308 changes a
   schema the same way.
9. `scripts/migrations-match-schema.test.ts` is deleted (coordinator, 2026-11-08: CI time is the
   bottleneck). `rebuild-check` compares the regenerated snapshot (less its random `id`) with the
   committed one, which is the whole of the old guard's job, as well as the SQL and the epoch; the
   old guard's three negative cases move onto the new guard (Task 6). Every current pointer to it
   is updated.

## What it leaves out

| Left out | Why | Who takes it |
| --- | --- | --- |
| CLAUDE.md §3's drizzle table-rebuild entries (rebuild-plus-add-column, expression index, `node:sqlite` rehearsal, foreign keys ON during a rebuild) | They return at go-live, when venues can no longer be reset and migrations become incremental again (coordinator, 2026-11-08). The rebuild entry says so in one clause. | Kept as they are. |
| A `--set all` form | Slices name the sets they changed (rules §2.2); one run per set keeps each refusal attributable. | Not planned. |
| Any table, column, constraint or trigger change | This slice changes only column order, clause form and where hand-written SQL is written. | Slices 1b onward. |

## Files

- Create: `apps/server/scripts/migration-baseline/rebuild.ts`
- Create: `apps/server/scripts/migration-baseline/rebuild.test.ts`
- Create: `packages/db/triggers/core.sql` (moved text, by command — Task 3)
- Create: `scripts/starting-migrations.test.ts`
- Delete: `scripts/migrations-match-schema.test.ts` (296 lines)
- Modify, pointer to the old guard: `vitest.config.ts:27-28` (comment), `packages/fiscal-none/drizzle.config.ts:5-7`
  (comment), `scripts/two-file-foreign-keys.test.ts:24-29` (header gaps 1 and 2),
  `docs/developers/conventions-data.md:1509-1510`, `:3660` and `CLAUDE.md:610`. Left as dated
  receipts: `conventions-data.md:1764` and `:3813`, `docs/operations/a760-migration-squash*.md`.
  No root-guard shard list names test files: `git grep migrations-match-schema -- .github scripts`
  finds only the test itself and `scripts/two-file-foreign-keys.test.ts`'s header, and the root-guards job runs the root
  project whole (`.github/workflows/ci.yml`, `root-guards`; workers from
  `scripts/root-test-budget.mjs`).
- Modify: `apps/server/scripts/migration-baseline/cli.ts:1-31, :79-89` (usage, optional flag, dispatch)
- Modify: `apps/server/scripts/migration-baseline/cli.test.ts` (three cases)
- Modify: `apps/server/src/backup-verification-target.test.ts:413-427` (the steady pin, Task 4)
- Modify: the `scripts` of `packages/{db,node-db,workforce,workforce-es,payments,fiscal-verifactu,fiscal-none,bookings}/package.json`
  (`db:generate`, `db:generate:custom`), and `packages/db/README.md:25-26, :69`
- Modify, comment pointer only: `packages/db/src/schema/bill-payments.ts:33, :137`,
  `packages/db/src/schema/catalogue.ts:39, :73`, `packages/catalogue/src/variant-fallback.ts:61`,
  `packages/media/src/image-references.test.ts:38`, `scripts/behavioural-triggers.test.ts:32`;
  and cut the two-line comment at `packages/db/src/schema/sales.ts:281-282` ("the column's
  `REFERENCES` … names none"), which the rebuild makes false: the rebuilt SQL writes
  `ON DELETE no action`, and the comment only explained matching A760's preserved text.
- Regenerated by the command (not hand-edited): `packages/{db,node-db,workforce,workforce-es,payments,bookings,fiscal-verifactu}/drizzle/**`
  and `scripts/migration-baseline-epoch.json`; `packages/fiscal-none/drizzle/` is rewritten
  byte-identical.
- Deleted by the command: `packages/workforce-es/drizzle/0001_continuous_paid_breaks.sql`,
  `packages/workforce-es/drizzle/meta/0001_snapshot.json`, `packages/db/drizzle/0001_print_job_kind_index.sql`,
  `packages/db/drizzle/meta/0001_snapshot.json`
- Modify docs: `docs/developers/conventions-data.md` (:448, :1657, :3650-3660),
  `docs/developers/testing-guide.md` (:3364-3395), `CLAUDE.md:607-611`,
  `docs/backlog/architecture.md:1053-1054`

Not touched, by reading (not run): `apps/server/scripts/copy-migrations.mjs:19-22` copies each
manifest `from` folder (`drizzle/`) whole; `copies.ts:31-56` compares those folders;
`deploy/Dockerfile:215` copies `dist/drizzle/`. `<package>/triggers/` is outside `drizzle/`, so
nothing ships it, and nothing needs to: the rebuilt SQL already holds its statements. `.sql` has no
Prettier parser (`prettier --file-info packages/db/triggers/core.sql` printed
`"inferredParser": null`), so `format:check` skips it.

## Size

| | Lines (estimate) |
| --- | --- |
| Code: `rebuild.ts` ~240, `cli.ts` +30, eight `package.json` script pairs ~16 | ~286 |
| Tests: `rebuild.test.ts` ~340, `cli.test.ts` +25, `scripts/starting-migrations.test.ts` ~170 (the old guard's three controls included), the steady backup pin ~40 | ~575 |
| Comments re-pointed or cut (12) and docs (~65, `packages/db/README.md` included) | ~77 |
| **Counted** | **~940** |

Not counted (rules §1): the generated files the command writes (core's SQL alone shows 870 changed
lines in `git diff --shortstat`; the other six populated sets' files, every journal and snapshot,
and the epoch about 600 more, measured on the scratch tree), including the workforce-es deletions
(243 lines); the deleted `scripts/migrations-match-schema.test.ts` (296 lines); and
`packages/db/triggers/core.sql` (849 lines), text moved by the one `awk` command in
Task 3 — the reviewer re-runs it on the base and checks the file is byte-identical, as for a rename
script's output. About 3 hours; one pull request.

## Finish line

Each line is a check someone can run from the repository root after the pull request lands:

1. For each of the eight sets, `pnpm --filter @waitron/server migration-baseline rebuild-check --set <name>`
   exits 0, and `rebuild --set <name>` prints `unchanged <name>` and leaves `git status --porcelain`
   empty.
2. `shasum -a 256 packages/*/drizzle/0000_baseline.sql` prints these (measured on the rebuilt
   scratch tree), and the epoch file records the same:

   | Set | SHA-256 |
   | --- | --- |
   | core | measured before #2594's index; the builder records the rebuilt hash in the pull request, and the reviewer re-runs the rebuild on the base and compares |
   | node | `b06a23f66d22d3ee373aef6bc5afd58126dfb5e66214e58e5f7cab450a2fc91f` |
   | workforce | `1e3e95d1d248ad0b8b2d616c1815867bd6301d0a3d3d69b56d5f41a82171afd2` |
   | workforce-es | `bf21f3fa8bef6380d8e0b7d881fe29b7bd1321f1bc2c70ce894d442659a7235d` |
   | payments | `cb457bb380a00e179b18af49a7b0b3c77944b7c0c3d2e9ba4f320f8afe13182d` |
   | bookings | `f9e8c7d2d63a067fc3c5e8f1865493e5e35b4427461f45be5a52a6e8759b3710` |
   | fiscal-verifactu | `2f806e48a4944b9563c1e978267488b0852c1129fbc159be2f71214012bcbae2` |

3. `grep -c '^CREATE TRIGGER' packages/db/triggers/core.sql` prints `42`;
   `ls packages/workforce-es/drizzle` and `ls packages/db/drizzle` each print `0000_baseline.sql meta`; no `package.json` under
   `packages/` has a `db:generate:custom` script.
4. `pnpm exec vitest run scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/journal-monotonic.test.ts scripts/two-file-foreign-keys.test.ts scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts`
   passes (on the scratch tree with every set rebuilt, these nine files less the new guard, plus the
   old `migrations-match-schema`, gave `574 passed`). `ls scripts/migrations-match-schema.test.ts`
   finds nothing.
5. `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts` and
   `pnpm --filter @waitron/server exec vitest run src/backup-verification-target.test.ts` pass, and
   the second pins `1a109d84eb58390749267c66343114ec8fd5e702183946d2e10098b7206b9777`.
6. `pnpm protection-list compare` between the base and the slice prints exactly the next section.
7. Adding a byte to `packages/db/triggers/core.sql`, or a file `drizzle/0001_x.sql` to any set,
   makes `scripts/starting-migrations.test.ts` fail naming the set (proof by deletion, Task 6).

## Expected protection-list difference

Produced in a throwaway worktree of `a086eedfb7` with exactly the rebuilds this plan makes (core with
its triggers appended; the six other populated sets regenerated; fiscal-none unchanged). `compare`
exited 1 and wrote 720 lines: six `DIFF` headers (both compositions × `sql-only`, `migrated`,
`change-feed`, all `database=venue`; no `node.db` header) and 238 `changed` lines, each followed by
`old:` and `new:`. No `missing` and no `extra` line.

**Design reason, every line:** a rebuilt starting migration declares each table's columns in the
order the TypeScript schema declares them, where A760's preserved text kept the order the old
history's `ALTER TABLE … ADD COLUMN`s left (rules §2; design §6 "Each later slice then edits those
starting migrations"). The change-feed update trigger lists the same comparisons in the new order.
No column, type, default, constraint, index or trigger body changes. The generated text also writes
column-level `REFERENCES` and `CHECK` clauses as table-level `FOREIGN KEY … ON UPDATE no action ON
DELETE no action` and `CONSTRAINT … CHECK` clauses (core: 32 changed lines naming `REFERENCES`, 6
naming `CHECK`; fiscal-verifactu: 2 `REFERENCES`); that is form only, and `compare` prints nothing
for it.

For the tables in both compositions: `changed table <t>.columnOrder` under all six headers (6 lines),
and `changed trigger waitron_change_<t>_update.when` under the two `phase=change-feed` headers (2
lines). Per set:

| Set | Tables (each 6 + 2 lines unless stated) |
| --- | --- |
| core (25) | `adjustments`, `departments`, `devices`, `dining_tables`, `floor_plan_tables`, `floor_reset_tables`, `invoice_deliveries`, `kitchen_courses`, `kitchen_stations`, `order_draft_lines`, `order_drafts`, `order_groups`, `persons`, `print_agents`, `print_jobs`, `printers`, `products`, `sale_lines`, `sales`, `tenants`, `ticket_items`, `units`, `webauthn_credentials`, `working_line_contexts`, `working_orders` |
| payments (2) | `card_readers`, `payment_refunds` |
| workforce-es (1) | `convenio_config` — `created_at` moves to last; the four columns the folded `0001` added keep their places |
| bookings (1) | `bookings` |
| fiscal-verifactu (2) | `registros_facturacion`, `envios`: `changed table <t>.columnOrder` under the three `composition=fiscal-verifactu` headers only (3 lines each, 6 in all); no change-feed line, because neither table is in the change feed |
| node | none — its text changes (5 lines); nothing the list compares does |
| workforce | none — its text changes (111 lines); nothing the list compares does |
| fiscal-none | none — no tables; its journal is rewritten byte-identical |

29 tables × 8 = 232 lines, plus 6 for fiscal-verifactu = 238. In `registros_facturacion`,
`corrects_registro_id` moves from last to second and `subsanacion`, `rechazo_previo`,
`sin_registro_previo` move from the end to 15th–17th (38 columns, same members); in `envios`,
`technical_incidence` moves up beside `incidencia`. The append-only triggers on
`registros_facturacion` print no line. `compare` does not print the `journal rows:` summary, so
workforce-es going from 2 journal rows to 1 prints nothing (observed).

The builder also checks that every `old:`/`new:` pair is a reordering and nothing more:

```bash
node -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").split("\n");let bad=0;
for(let i=0;i<lines.length;i++){if(!lines[i].startsWith("changed "))continue;
 const o=lines[i+1].slice(5),n=lines[i+2].slice(5);
 const parts=s=>lines[i].endsWith(".when")?s.split(/\bor\b/).map(x=>x.trim()).sort():JSON.parse(s).sort();
 if(JSON.stringify(parts(o))!==JSON.stringify(parts(n))){bad++;console.log(lines[i]);}}
console.log(bad?"NOT A REORDERING":"all reorderings");' <report file>
```

Expected: `all reorderings`. Measured on the scratch report (all eight sets): `all reorderings`; on
a copy with one column name altered in a `new:` array and one comparison added to a `new:` trigger
clause, it printed both `changed` lines and `NOT A REORDERING`.

## Stop points (beyond rules §5)

1. Before Task 1: `git diff --stat a086eedfb7 HEAD -- 'packages/*/drizzle' 'packages/*/src/schema' packages/migrations scripts/migration-baseline-epoch.json`
   prints anything beyond #2594's files (`packages/db/drizzle/0001_print_job_kind_index.sql`,
   `packages/db/drizzle/meta/0001_snapshot.json`, `packages/db/drizzle/meta/_journal.json`, and in
   `packages/db/src/schema` the `print_jobs_printer_kind_idx` line and the two comment edits named
   under "Changed on `main` since"). The prediction and the hashes above are for `a086eedfb7`'s
   schema; ask the watcher for a re-derived prediction.
2. Any set's `node_modules/drizzle-kit/package.json` version is not `0.31.11`.
3. Task 3's extracted file does not start with `CREATE TRIGGER tenders_reject_post_settlement`, does
   not hold 42 `CREATE TRIGGER` lines, or does not reproduce today's tail byte for byte.
4. A rebuilt set's SQL hash differs from the Finish line table, or `--fold-generated` refuses
   workforce-es's or core's `0001`. Core's hash is the exception: it was measured before #2594, so
   the builder records it instead, after checking that a second rebuild prints `unchanged core`.
5. A test outside this plan's lists fails after Task 5 for a reason tied to column order (for
   example a test that reads a `SELECT *` row's key order, or a digest over exported rows). Report
   it; do not change its assertion (rules §4).
6. The rehearsal (Task 7) gives SQL that differs between the rebased branch and the control.
7. The root-guards job on the pull request takes more than about 4 minutes because of
   `scripts/starting-migrations.test.ts` (twelve drizzle-kit runs, replacing the old guard's eleven;
   core's takes about 5 s locally). Report it with the job's durations; do not cut the check.

## Global Constraints

- Rules §1–§9 apply. Never edit `drizzle/*.sql`, `drizzle/meta/*` or the epoch file by hand; in
  this slice the command writes them (rules §2.3).
- The pull request's first line: "Every venue is reset: core, node, workforce, workforce-es,
  payments, bookings, fiscal-verifactu; backups and exports from before this cannot be restored or
  imported." (rules §2; CLAUDE.md §3 "Editing a shipped migration file").
- apps/server's coverage covers `src/**/*.ts` only and excludes `scripts/**`
  (`apps/server/vitest.config.ts:38, :43`), so the 98/98/98/95 thresholds do not reach
  `rebuild.ts`; the tests still name the assertion that fails for each behaviour.
- Every commit `git commit -s`; plain English in commit messages and the pull request.
- Run focused tests locally; CI runs the package suites (CLAUDE.md §2).

## Review Focus

1. **A rebuild never deletes a hand-written migration.** A folder holding any file beyond the
   starting migration is refused, before anything is generated; `--fold-generated` accepts only a
   migration whose snapshot changed the schema. Pinned in Task 1 ("refuses a folder holding anything
   else" and the fold cases) and by Task 6's guard.
2. **A failed or refused run leaves the set and the epoch exactly as they were**, and
   `rebuild-check` never writes. Pinned in Task 1.
3. **A second run straight after a rebuild changes no byte**, including the epoch file's layout
   (Prettier puts `emptySets` on one line). Pinned in Task 1 and Task 2.
4. **The output does not depend on what the folder held before** (main's copy, another branch's
   copy). That is what makes "take main's copy and re-run" safe. Pinned in Task 2's real
   drizzle-kit case.
5. **A database migrated by the old starting migration fails loudly rather than skipping the new
   one.** Drizzle applies a migration only when the recorded `created_at` is below its `when`
   (`scripts/journal-monotonic.test.ts:14-18`, read, not run), so the new `when` must be above every
   `when` the old journal held. Pinned in Task 1.

---

### Task 1: The rebuild logic, against a stand-in drizzle-kit

**Files:**
- Create: `apps/server/scripts/migration-baseline/rebuild.ts`
- Test: `apps/server/scripts/migration-baseline/rebuild.test.ts`

**Interfaces:**
- Consumes: `manifestCopySets(): CopySet[]` (`copies.ts:31`); `createdObject(statement)` from
  `../protection-list/sql-tokens.js` (returns `{ kind, name } | null`; it reads tokens, so case and
  comments do not matter — read, not run; a test below pins lower case).
- Produces (all exported from `rebuild.ts`):

```ts
export interface RebuildSet { readonly name: string; readonly folder: string; readonly packageDir: string }
export interface GenerateInput { readonly packageDir: string; readonly configPath: string; readonly outDir: string }
export interface GenerateRun { status: number | null; signal: string | null; error: string | undefined; stdout: string; stderr: string }
export type Generate = (input: GenerateInput) => Promise<GenerateRun>;
export interface RebuildOptions {
  readonly set: RebuildSet;
  readonly epochFile?: string;          // default EPOCH_FILE
  readonly generate?: Generate;         // default runDrizzleKit
  readonly mode?: "write" | "check";    // default "write"; "check" writes nothing
  readonly foldGenerated?: string;      // a second migration's tag, e.g. "0001_continuous_paid_breaks"
}
export interface RebuildResult {
  readonly outcome: "rebuilt" | "unchanged" | "epoch-only";   // in "check" mode: what a write would do
  readonly differences: readonly string[];  // e.g. "0000_baseline.sql differs", "epoch sha256 differs"; empty when unchanged
  readonly when: number | null;             // null for an empty set
  readonly sha256: string | null;
}
export const EPOCH_FILE: string;                       // <repo>/scripts/migration-baseline-epoch.json
export function rebuildSets(): RebuildSet[];           // manifestCopySets() + packageDir = dirname(folder)
export function triggerFileFor(set: Pick<RebuildSet, "name" | "packageDir">): string; // <packageDir>/triggers/<name>.sql
export function splitStatements(sql: string): string[];
export function readTriggers(file: string): string | null;
export function folderProblems(files: readonly string[], populated: boolean, foldGenerated?: string): string[];
export function assembleBaseline(generated: string, triggers: string | null): string;
export function generationFailure(run: GenerateRun): string | undefined;
export function nextWhen(generated: number, previous: readonly number[]): number;
export function updateEpochText(text: string, name: string, when: number, sha256: string): string;
export const runDrizzleKit: Generate;
export async function rebuildBaseline(options: RebuildOptions): Promise<RebuildResult>;
```

Decisions the implementer cannot make alone:

- **Order of work.** (1) Read the epoch: a set in `entries` is populated, a set in `emptySets` is
  empty, a set in neither is refused (`has no entry`). (2) Check the set's folder with
  `folderProblems` and refuse on any problem, naming each file. (3) With `foldGenerated`, check that
  migration (below). (4) Read the hand-written SQL file. (5) Generate. (6) Compare. (7) In
  `"write"` mode only, write. Nothing is written before step 7, and nothing at all in `"check"`.
- **`folderProblems`**: for a populated set the files (relative, `/`-separated, sorted) must be
  exactly `0000_baseline.sql`, `meta/0000_snapshot.json`, `meta/_journal.json`; for an empty set,
  exactly `meta/_journal.json`. With `foldGenerated = T`, `T.sql` and `meta/<idx>_snapshot.json`
  are also allowed. Each other file is one problem: `<set>: drizzle/<file> is not the starting
  migration; a rebuild would delete it. Move hand-written SQL to triggers/<set>.sql, or pass
  --fold-generated <tag> for a migration drizzle-kit generated.` A journal with more entries than
  the files allowed is also a problem.
- **`--fold-generated T`** is accepted only when: `T` is not `0000_baseline`; the journal has an
  entry tagged `T` with `idx >= 1` and it is the last entry; `T.sql` and
  `meta/<idx padded to 4>_snapshot.json` exist; that snapshot's `prevId` equals the previous
  snapshot's `id`; its `tables` differ from the previous snapshot's (a `--custom` migration leaves
  the snapshot unchanged, `scripts/migrations-match-schema.test.ts:26-28`); and no statement of
  `T.sql` (by `splitStatements`) gives `createdObject(...)?.kind === "trigger"`. Each failure
  refuses with a message naming the condition (`not drizzle-generated: its snapshot does not change
  the schema`, `holds a CREATE TRIGGER`, …). Measured: workforce-es's `0001_snapshot.json` has
  `prevId` equal to `0000_snapshot.json`'s `id` and different `tables`; its SQL is four
  `ALTER TABLE … ADD` statements on `convenio_config`.
- **`splitStatements`** splits on `--> statement-breakpoint` wherever it appears, with surrounding
  whitespace removed — drizzle writes it both on its own line and inline after `;` (counted 2026-11-08: the inline `;--> statement-breakpoint` form appears 3 times in today's
  committed SQL, all in workforce-es's `0001`, and 296 times in the seven regenerated starting
  migrations, mostly after index statements) — and drops nothing else.
- **`readTriggers`**: absent file → `null`. Otherwise trailing whitespace is removed, the text is
  split with `splitStatements`, and every statement must give `createdObject(...)?.kind ===
  "trigger"`, names unique, at least one. The `triggers/` folder may hold no file other than
  `<name>.sql` for a set the manifest names. Works for any set.
- **Generation goes to a throwaway folder**: `mkdtemp(join(tmpdir(), "wt-rebuild-"))`, a config
  there that reads `import base from <absolute packageDir/drizzle.config.ts>` and exports
  `{ ...base, out: relative(packageDir, outDir) }` (`out` must be relative: drizzle-kit prefixes
  `./`, `scripts/migrations-match-schema.test.ts:31-34`), and
  `drizzle-kit generate --config <that file> --name baseline` with `cwd: packageDir`, stdin not a
  terminal, timeout 300 000 ms (`migrations-match-schema.test.ts:43`). Removed in a `finally`.
  Measured: core generates in about 5 s; two runs give byte-identical SQL; the snapshot differs only
  in its top-level `"id"` (a random UUID) and the journal only in `"when"` (the time of the run).
- **`generationFailure`** accepts a run only when `status === 0` and stdout contains
  `"No schema changes, nothing to migrate"` or `"Your SQL migration file"` — the markers of
  `migrations-match-schema.test.ts:167-173`, which shows a throwing schema module and a rename
  question (`"Interactive prompts require a TTY"`) both exit 0. The message starts
  `drizzle-kit generate did not report finishing` and includes stdout and stderr. After a run it
  accepts, the output must hold exactly the files `folderProblems` allows with no fold (an empty
  set: drizzle-kit writes `{"version":"7","dialect":"sqlite","entries":[]}`, measured
  byte-identical to the committed one); a populated set that produced no SQL is refused
  (`generated nothing`), an empty set that produced SQL too (`declares tables`).
- **`assembleBaseline`**: `generated` unchanged when `triggers` is null; otherwise
  `generated + "\n--> statement-breakpoint\n" + triggers`. Measured: drizzle-kit's SQL ends in `;`
  with no newline, and this layout reproduces today's trigger tail byte for byte.
- **Unchanged** means: no fold was asked for, the assembled SQL equals the committed SQL byte for
  byte, the snapshots are equal once each top-level `id` is removed, and the epoch entry equals the
  journal's `when` and the SQL's SHA-256. If only the epoch differs, the outcome is `epoch-only`
  (and in `"write"` mode only the epoch line is rewritten). Every difference found is listed in
  `differences`.
- **Rebuilt**: delete every file under the set's folder (keep the folder), write the assembled SQL,
  drizzle-kit's snapshot as generated, and drizzle-kit's journal text with only its `when` value
  replaced by `nextWhen(generatedWhen, everyWhenInTheOldJournal)` = `max(generated, max(previous) + 1)`.
  Then the epoch.
- **`updateEpochText`** edits only the `"when"` and `"sha256"` values of the named entry in the
  existing text, then parses the result and throws unless that entry, and only it, carries the new
  values; it throws `has no entry` for a name the entries do not hold. Measured: a
  regular-expression replacement of the two values in `fiscal-verifactu`'s entry left a file that
  `prettier --check` accepted; `JSON.stringify(…, null, 2)` did not (it splits `emptySets` over
  three lines).

- [ ] **Step 1: Write the failing tests** in `rebuild.test.ts`, each on a temp folder, a temp epoch
  copied from a fixture string in the real file's layout, and a stand-in `generate` that writes
  chosen files into `outDir` and returns a chosen run. Cases and assertions:
  - `rebuilds a populated set and appends its hand-written SQL`, run for a set named `core` and for
    one named `payments` (any set may have a triggers file): files equal
    `["0000_baseline.sql","meta/0000_snapshot.json","meta/_journal.json"]`; SQL equals
    `GENERATED + "\n--> statement-breakpoint\n" + TRIGGERS.trimEnd()`; the epoch entry holds the new
    `when` and the SQL's SHA-256; `outcome === "rebuilt"`.
  - `a second run changes no byte`: stand-ins differing only in snapshot `id` and journal `when`;
    second `outcome === "unchanged"`, `differences` empty, every file and the epoch byte-identical.
  - `check mode reports and writes nothing`: with the trigger file edited, `mode: "check"` gives
    `outcome "rebuilt"` and `differences` containing `0000_baseline.sql differs`; with only the epoch
    corrupted, `"epoch-only"` and `epoch sha256 differs`; in both, folder and epoch byte-identical.
  - `check mode reports a snapshot that no longer matches the schema` (the old guard's whole job):
    stand-in SQL identical to the committed SQL, stand-in snapshot with one more table; outcome
    `"rebuilt"`, `differences` equal to `["meta/0000_snapshot.json differs"]`; and a snapshot that
    differs only in its top-level `id` gives `"unchanged"`.
  - `rewrites only the epoch when the files already match` (`mode: "write"`): outcome
    `"epoch-only"`, set files byte-identical, epoch corrected.
  - `refuses a folder holding anything else, before generating`, `it.each` over an extra
    `0001_x.sql`, an extra `meta/0001_snapshot.json`, a stray `notes.txt`, and a second journal
    entry: rejects with `is not the starting migration` (or the journal message), the stand-in
    `generate` was never called, folder and epoch byte-identical.
  - `folds a generated second migration and dates the result after it`: old journal `when` 1000 and
    2000, `0001_more.sql` holding two `ALTER TABLE … ADD` statements, `meta/0001_snapshot.json` with
    `prevId` = 0000's `id` and one more column; stand-in returns `when` 1500; with
    `foldGenerated: "0001_more"` the result has the three files only and journal `when` 2001; with
    stand-in `when` 5000, 5000.
  - `refuses a fold that is not drizzle-generated`, `it.each`: snapshot `tables` equal to 0000's
    (`does not change the schema`); `0001_more.sql` holding `create trigger t before insert on x
    begin select 1; end` in lower case (`holds a CREATE TRIGGER`); `prevId` not chained; the tag not
    the last journal entry; `foldGenerated: "0000_baseline"`. Each leaves everything untouched.
  - `leaves the folder and the epoch byte-identical when generation fails`, `it.each`: exit 0
    printing `Error: schema import failed` (message has `did not report finishing` and the error);
    exit 0 printing `Interactive prompts require a TTY`; exit 1; marker printed but no
    `0000_baseline.sql` written (`generated nothing`); an extra file written.
  - `refuses a hand-written SQL file that is not only CREATE TRIGGER statements`, `it.each`: a
    `CREATE TABLE` statement (`statement 2 is not a CREATE TRIGGER`), an empty statement between two
    breakpoints (`statement 2 is empty`), a duplicated name (`defined twice`), an empty file
    (`holds no CREATE TRIGGER`), a stray `triggers/other.sql` (`unexpected file`). A lower-case
    `create trigger` statement is accepted.
  - `splitStatements reads both breakpoint forms`: `"a;--> statement-breakpoint\nb;\n--> statement-breakpoint\nc;"`
    gives `["a;","b;","c;"]`.
  - `refuses a set whose population disagrees with the epoch`: populated in the epoch but nothing
    generated (`generated nothing`); listed empty but SQL generated (`declares tables`); in neither
    list (`has no entry`).
  - `keeps an empty set empty`: journal-only run gives `outcome "unchanged"`, `when: null`.
  - `updateEpochText keeps the layout`: on the real file's text, changing `core`'s values changes
    exactly two lines; an unknown name throws `has no entry`.
- [ ] **Step 2: Run** `cd apps/server && pnpm exec vitest run scripts/migration-baseline/rebuild.test.ts`.
  Expected: FAIL, `rebuild.js` cannot be found.
- [ ] **Step 3: Implement `rebuild.ts`** to the interfaces and decisions above. `runDrizzleKit`
  follows `generate()` in `migrations-match-schema.test.ts:111-148` (promisified `execFile` of
  `<packageDir>/node_modules/.bin/drizzle-kit`, a rejection caught into a `GenerateRun`).
- [ ] **Step 4: Run** the same command. Expected: PASS, with a `Tests` count (CLAUDE.md §4).
- [ ] **Step 5: Commit** `git add apps/server/scripts/migration-baseline/rebuild.ts apps/server/scripts/migration-baseline/rebuild.test.ts && git commit -s -m "Add the starting-migration rebuild logic (A1308 slice 1a)"`

### Task 2: The command line and the real drizzle-kit

**Files:**
- Modify: `apps/server/scripts/migration-baseline/cli.ts`
- Modify: `apps/server/scripts/migration-baseline/cli.test.ts`
- Modify: `apps/server/scripts/migration-baseline/rebuild.test.ts`

**Interfaces:**
- Consumes: `rebuildBaseline`, `rebuildSets` (Task 1).
- Produces: `runCli(["rebuild", "--set", name, ("--fold-generated", tag)?], print)` resolving 0
  and printing `<outcome> <name>` then, for a populated set, `when <n>` and `sha256 <hex>`;
  `runCli(["rebuild-check", "--set", name], print)` resolving 0 when unchanged, otherwise printing
  `would change <name>` and each difference and resolving 1. Refusals throw (exit 2 through `tsx`).

- [ ] **Step 1: Write the failing tests.** In `cli.test.ts`:
  - `refuses a set the manifest does not name, for rebuild and rebuild-check` — each rejects with
    `"The manifest has no set named nowhere"`; `runCli(["rebuild"])` rejects with `"Usage:"`.
  - `rebuild takes --fold-generated as an optional flag` — `runCli(["rebuild","--set","nowhere","--fold-generated","0001_x"])`
    rejects with the unknown-set message, not `"Usage:"`; `["rebuild","--set","core","--bogus","x"]`
    rejects with `"Usage:"`.
  In `rebuild.test.ts`, one case with the real drizzle-kit (`describe` timeout 330 000 ms):
  `gives the same migration whatever the folder held, and nothing changes the second time` — take
  `bookings` from `rebuildSets()`; copy its `drizzle/` twice (A, B); in B replace `0000_baseline.sql`
  with `CREATE TABLE junk (id integer);` and change the snapshot's `tables` (both as main's copy of
  another branch might be); give each a temp epoch copied from the real one; rebuild both with
  `{ set: { ...bookings, folder: copy }, epochFile }`. Assert A's and B's SQL are byte-identical and
  their snapshots equal with `id` removed; then `mode: "check"` on A returns `"unchanged"`, and a
  second `"write"` run on A returns `"unchanged"` with every byte the same. It never writes the real
  folder or epoch.
- [ ] **Step 2: Run** `cd apps/server && pnpm exec vitest run scripts/migration-baseline/cli.test.ts scripts/migration-baseline/rebuild.test.ts`.
  Expected: FAIL on the `cli` cases (today `rebuild` is an unknown command and gives `"Usage:"`).
- [ ] **Step 3: Implement.** Give `flags()` an optional list:
  `flags(args, required: readonly string[], optional: readonly string[] = [])`. Add `rebuild` and
  `rebuild-check` beside `preserve`, the same unknown-set message, and the two usage lines
  `rebuild --set <name> [--fold-generated <tag>]` and `rebuild-check --set <name>` in `USAGE` and the
  header comment.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS with a `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Add rebuild and rebuild-check to the migration-baseline command line"` with the three files.

### Task 3: Core's triggers move to their own file

**Files:**
- Create: `packages/db/triggers/core.sql`
- Modify (pointer each): `packages/db/src/schema/bill-payments.ts:33, :137`,
  `packages/db/src/schema/catalogue.ts:39, :73`, `packages/catalogue/src/variant-fallback.ts:61`,
  `packages/media/src/image-references.test.ts:38`, `scripts/behavioural-triggers.test.ts:32`
- Modify (cut): `packages/db/src/schema/sales.ts:281-282`

- [ ] **Step 1: Extract the file** with exactly this command:

```bash
mkdir -p packages/db/triggers
awk '/^CREATE TRIGGER tenders_reject_post_settlement$/{on=1} on' packages/db/drizzle/0000_baseline.sql > packages/db/triggers/core.sql
head -1 packages/db/triggers/core.sql                     # CREATE TRIGGER tenders_reject_post_settlement
grep -c '^CREATE TRIGGER' packages/db/triggers/core.sql   # 42
wc -l < packages/db/triggers/core.sql                     # 849
cmp <(sed -n '3008,$p' packages/db/drizzle/0000_baseline.sql) <(printf '%s' "$(cat packages/db/triggers/core.sql)") && echo SAME
```

  Expected: the three values shown and `SAME`. Measured on the base: the tail runs from line 3008 to
  the end (3856) with no other statement kind; `awk` adds the one trailing newline, which
  `readTriggers` removes. Anything else is stop point 3.
- [ ] **Step 2: Check the file reads cleanly:**
  `cd apps/server && pnpm exec tsx -e 'import("./scripts/migration-baseline/rebuild.ts").then(m => console.log(m.splitStatements(m.readTriggers("../../packages/db/triggers/core.sql")).length))'`.
  Expected: `42`.
- [ ] **Step 3: Re-point the seven comments** to say the triggers are written in
  `packages/db/triggers/core.sql` (`triggers/core.sql` inside `packages/db`); pointer text only. Cut
  `sales.ts:281-282`; the `foreignKey` it sits above is unchanged.
- [ ] **Step 4: Run** `pnpm exec vitest run scripts/behavioural-triggers.test.ts`. Expected: PASS
  (no SQL changed yet).
- [ ] **Step 5: Commit** `git commit -s -m "Write core's hand-written triggers in packages/db/triggers/core.sql"`.

### Task 4: A backup-verification pin that a rebuild does not move

**Files:**
- Modify: `apps/server/src/backup-verification-target.test.ts:413-427`

**Interfaces:**
- Consumes: `buildBackupVerificationTarget` (`apps/server/src/backup-verification-target.ts:98-150`),
  whose result has, per module, `name`, `packageVersion`, `requires`, `schema`, `migrationTable`,
  `migrationDigest`, `semanticsVersion`, `policyDigest`, and at the top `version`, `runtime`,
  `modules`, `compositionDigest`, `migrationDigest`, `policyDigest`, `digest`
  (`apps/server/src/backup-verification-protocol.ts:230-255`).
- Produces: a test-local `steadyTarget(target)` that removes each module's `migrationDigest` and
  `schema` and the top-level `migrationDigest` and `digest` (both are computed from those two),
  keeping composition, policy, migration table names and module hosting.

Why: today's pin hashes the whole target, journal dates included, so after any rebuild it can only
be updated by pasting the printed value, which proves nothing, and every lane rebuilding a set
conflicts on it. The SQL's integrity is pinned by the epoch and `verifyEpoch`.

- [ ] **Step 1: Write the tests** (replacing the one case at :413-427, keeping its first
  assertion about `tablesIn`):
  - `pins today's composition, policy and hosting of the real modules`:
    `sha256(JSON.stringify(steadyTarget(build(real tree))))` is
    `"1a109d84eb58390749267c66343114ec8fd5e702183946d2e10098b7206b9777"`.
  - `the pin does not move when migrations are rebuilt`: copy every manifest set's folder into a
    temp root as `<root>/<set>/`, add 12 345 to core's journal `when`, append a newline to core's
    SQL, and drop workforce-es's second journal entry; build with `migrationsRoot: root`; the full
    hash differs from the real tree's and the steady hash equals the pin.
  - `the pin moves when composition or policy changes` (the control): with `payments`'
    `version` set to `"9.9.9"`, and separately with its `backup.verification.publicEvidenceDigest`
    set to `"0".repeat(64)`, the steady hash differs from the pin.
  Measured (read-only script against the docs worktree's sources): the full hash of today's target
  is `33f57efe…`, today's pin, so the script builds what the test builds; steady base
  `1a109d84…`; steady after the migration changes above `1a109d84…` (full hash changed to
  `e1088f10…`); composition control `0e845d60…`; policy control `fd83e83d…`. Bumping
  `verification.version` instead is refused (`semantics_missing`), so the control uses the
  evidence digest.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/backup-verification-target.test.ts`.
  Expected: PASS (the new pin holds on today's tree; the controls differ). Then check the control
  catches what it should: temporarily stop `steadyTarget` removing `schema`; expect "the pin does not
  move" to FAIL; restore.
- [ ] **Step 3: Commit** `git commit -s -m "Pin the backup target's composition and policy, not its migration bytes"`.

### Task 5: Rebuild every set once, and check the result

**Files:** the regenerated and deleted files listed under "Files"; no hand edits.

- [ ] **Step 1: Base protection list** (rules §3): in a throwaway worktree of the base
  (`git worktree add --detach <dir> <the branch's base on main, at or after 5f11ab6405> && pnpm install --frozen-lockfile` there, so the base list already holds #2594's index),
  `cd apps/server && pnpm protection-list list --out <empty absolute dir A>`.
- [ ] **Step 2: Rebuild**, one set at a time, stopping at the first failure:

```bash
bash -eu -c '
for set in node workforce payments bookings fiscal-verifactu fiscal-none; do
  pnpm --filter @waitron/server migration-baseline rebuild --set "$set"
done
pnpm --filter @waitron/server migration-baseline rebuild --set core --fold-generated 0001_print_job_kind_index
pnpm --filter @waitron/server migration-baseline rebuild --set workforce-es --fold-generated 0001_continuous_paid_breaks
'; echo "status $?"
```

  Expected: `rebuilt` for the five populated sets in the loop, `unchanged fiscal-none`, `rebuilt
  core`, `rebuilt workforce-es`, then `status 0`. Any other status is a failure to report, not to retry.
- [ ] **Step 3: Check nothing more would change:**

```bash
bash -eu -c '
for set in core node workforce workforce-es payments bookings fiscal-verifactu fiscal-none; do
  pnpm --filter @waitron/server migration-baseline rebuild-check --set "$set"
done
'; echo "status $?"
```

  Expected: `status 0`. Check the hashes against the Finish line table
  (`shasum -a 256 packages/*/drizzle/0000_baseline.sql`), and that
  `git status --porcelain packages/fiscal-none` prints nothing.
- [ ] **Step 4: Run the guards** in Finish line 4 (without the new guard, which Task 6 adds) and 5,
  plus `pnpm exec prettier --check scripts/migration-baseline-epoch.json`. Expected: all pass.
- [ ] **Step 5: Run the package tests that read migration text**, each from its package:
  `packages/db`: `pnpm exec vitest run` (114 files, 1977 tests passed on the scratch tree);
  `packages/fiscal-verifactu`: `pnpm exec vitest run` (281 files, 6191 tests passed on the scratch
  tree with all eight sets rebuilt); `packages/bookings`, `packages/payments`, `packages/workforce`,
  `packages/workforce-es`: `pnpm exec vitest run src/schema/schema-conformance.test.ts`;
  `packages/migrations`: `pnpm exec vitest run src`; `packages/sync-enrolment`:
  `pnpm exec vitest run src/testing`; and from `apps/server`, the readers of exported and backed-up
  rows: `pnpm exec vitest run src/configuration-*.test.ts src/backup-verification*.test.ts src/restore-fiscal-e2e.test.ts`
  (18 files; on the scratch tree 17 passed and the 18th failed only at the old full-target pin, which
  Task 4 replaces). 101 more `apps/server` files that an interrupted whole-package run reached all
  passed on the scratch tree; CI runs the rest (CLAUDE.md §2). A failure tied to column order is
  stop point 5.
- [ ] **Step 6: Compare** (rules §3): `pnpm protection-list list --out <empty absolute dir B>`,
  then `pnpm protection-list compare --old <A> --new <B> --report <absolute file>`. Expected: exit 1
  and exactly the lines in "Expected protection-list difference"; run the reordering check. Paste
  the report's summary and the check's output into the pull request.
- [ ] **Step 7: Commit** the generated files and deletions only:
  `git add -A packages/db/drizzle packages/node-db/drizzle packages/workforce/drizzle packages/workforce-es/drizzle packages/payments/drizzle packages/bookings/drizzle packages/fiscal-verifactu/drizzle scripts/migration-baseline-epoch.json && git commit -s`
  with a first line naming the venue reset (Global Constraints) and a body saying the files were
  written by `migration-baseline rebuild` and nothing was edited by hand.

### Task 6: The root guard, and the old authoring scripts

**Files:**
- Create: `scripts/starting-migrations.test.ts`
- Delete: `scripts/migrations-match-schema.test.ts`
- Modify: the eight `package.json` files and `packages/db/README.md:25-26, :69`; the comments at
  `vitest.config.ts:27-28`, `packages/fiscal-none/drizzle.config.ts:5-7` and
  `scripts/two-file-foreign-keys.test.ts:24-29`

**Interfaces:**
- Consumes: `rebuildSets`, `rebuildBaseline`, `folderProblems`, `runDrizzleKit`, `generationFailure`,
  `EPOCH_FILE` (Task 1), imported
  from `../apps/server/scripts/migration-baseline/rebuild.js`.

The guard lives in the root project, so it runs on every CI run whichever package changed (CLAUDE.md
§4). Its header says it is weaker than its name: it trusts drizzle-kit's output and the epoch, does
not run the triggers (`scripts/behavioural-triggers.test.ts` does), and does not see SQL installed
by code at migration or start.

- [ ] **Step 1: Write the guard:**
  - `every set holds one starting migration and nothing else`: for each set,
    `folderProblems(filesUnder(folder), populated)` is `[]` (populated read from the epoch), with a
    discovery floor (`rebuildSets().length` is 8, as `scripts/journal-monotonic.test.ts:78`).
  - `it.concurrent.for(rebuildSets())("%s: a rebuild would change nothing")` —
    `rebuildBaseline({ set, mode: "check" })` resolves with `outcome "unchanged"`, the message
    listing `differences` and saying to run `migration-baseline rebuild --set <name>`; timeout
    330 000 ms per case.
  - Controls on copies (never the real tree), run concurrently like the cases above:
    - a copy of `bookings`' folder plus `0001_x.sql` gives one `folderProblems` entry naming it;
    - a copy of `bookings`' folder with one byte appended to its SQL, checked with a temp epoch,
      gives an outcome other than `"unchanged"` and `0000_baseline.sql differs`;
    - moved from the old guard (`migrations-match-schema.test.ts:203-296` at the base), same
      assertions: **a snapshot that lacks a table the schema declares** — a copy of `workforce`'s
      folder with `tables.shifts` deleted from its snapshot gives `differences` containing
      `meta/0000_snapshot.json differs`; **a schema module that throws at import** —
      `runDrizzleKit` with a config spreading `bookings`' and replacing `schema` with a file that
      throws `negative control: schema import failed`, then `generationFailure(run)` contains that
      text and the output folder is empty; **drizzle-kit stopping to ask about a rename** —
      `runDrizzleKit` with `out` set to a copy of `bookings`' folder whose snapshot renames
      `booking_time` to `booking_time_before`, then `generationFailure(run)` contains
      `Interactive prompts require a TTY` and the copy is unchanged. (A rebuild always generates
      into an empty folder, so it cannot meet a rename question; the case keeps the detector proven.)
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/starting-migrations.test.ts`. Expected: PASS
  with a `Tests` count, and note the file's duration (stop point 7).
- [ ] **Step 2a: Retire the old guard.** Read `rebuildBaseline` once more and confirm in the commit
  message that `"check"` mode compares the regenerated snapshot (less `id`) with the committed one;
  then `git rm scripts/migrations-match-schema.test.ts`. Re-point the three comments:
  `vitest.config.ts:27-28` describes `starting-migrations` (one starting migration per set; a
  check-only rebuild of each); `packages/fiscal-none/drizzle.config.ts:5-7` names
  `scripts/starting-migrations.test.ts`; `scripts/two-file-foreign-keys.test.ts` gap 1 names it as
  what fails an ungenerated key, and gap 2 says a key cannot be added by hand-written SQL while that
  SQL is `CREATE TRIGGER` statements only (`readTriggers`) and no set holds a second migration. Run
  `pnpm exec vitest run scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts`:
  PASS.
- [ ] **Step 3: Prove it by deletion on the real tree:** append a space to
  `packages/db/triggers/core.sql`, run the guard, expect `core: a rebuild would change nothing` to
  FAIL with `0000_baseline.sql differs`; restore with `git checkout packages/db/triggers/core.sql`.
  Then create `packages/payments/drizzle/0001_x.sql`, expect the first case to FAIL naming it;
  delete the file.
- [ ] **Step 4: The authoring scripts.** In each of the eight `package.json` files set
  `"db:generate": "pnpm --filter @waitron/server migration-baseline rebuild --set <set>"` with that
  package's set name (`packages/db` → `core`, `packages/node-db` → `node`, the rest their own
  name), and delete `"db:generate:custom"`. An old habit such as `pnpm db:generate --name x` then
  reaches the command with `--name x`, which it refuses with its usage text. In
  `packages/db/README.md` change the two table rows and the `:69` sentence to say `db:generate`
  rebuilds the starting migration and that hand-written SQL goes in `triggers/core.sql`.
- [ ] **Step 5: Run** `pnpm --filter @waitron/bookings db:generate`. Expected: `unchanged bookings`.
  Then `pnpm install --frozen-lockfile` (scripts are not in the lockfile; expect no change) and
  `pnpm exec prettier --check packages/*/package.json packages/db/README.md`.
- [ ] **Step 6: Commit** `git commit -s -m "Guard one starting migration per set, retire migrations-match-schema, point db:generate at the rebuild"`.

### Task 7: The two-branch rehearsal (rules §2.4)

Why a rehearsal and not a test: what the command must guarantee is that its output depends only on
the TypeScript schema and the hand-written SQL file, never on what the set's folder held; Task 2
tests that on every run. The git half — a conflict appears, and taking `main`'s copy resolves it —
is git's behaviour, and running it needs a whole repository and two real core generations, too heavy
for the suite. It is run once and its output goes in the pull request. A conflict is certain
whenever two branches rebuild the same set: each run writes a new snapshot `id` and journal `when`
on the same lines.

- [ ] **Step 1:** In a throwaway worktree of this branch's head, with `pnpm install --frozen-lockfile`:
  branch `rehearsal-a` adds `rehearsalA: label("rehearsal_a"),` after `staffAbbreviation` in
  `packages/db/src/schema/catalogue/units.ts`; branch `rehearsal-b` (from the same commit) adds
  `rehearsalB: label("rehearsal_b"),` after `tradingName` in
  `packages/db/src/schema/venue-service/service.ts`. Each runs `rebuild --set core` and commits with
  `git add -A packages/db scripts/migration-baseline-epoch.json`.
- [ ] **Step 2:** Rebase B onto A and resolve exactly as a lane would:

```bash
git switch rehearsal-b
git rebase rehearsal-a                    # stops: conflicts in packages/db/drizzle/ and the epoch file
git checkout --ours -- packages/db/drizzle scripts/migration-baseline-epoch.json
                                          # during a rebase "ours" is the branch being rebased onto
                                          # (main, here rehearsal-a); `git checkout origin/main -- …`
                                          # does the same for a real lane
pnpm --filter @waitron/server migration-baseline rebuild --set core      # expect: rebuilt core
git add -A packages/db/drizzle scripts/migration-baseline-epoch.json     # -A stages deletions too
git rebase --continue
```

  Record that `apps/server/src/backup-verification-target.test.ts` did not conflict (Task 4's pin
  does not move on a rebuild).
- [ ] **Step 3: Control:** branch `rehearsal-c` from the same start with both column additions made
  by hand, then `rebuild --set core`.
- [ ] **Step 4: Compare:** `git diff rehearsal-b rehearsal-c -- packages/db/drizzle/0000_baseline.sql`
  is empty; the snapshots differ only on the `"id"` line; the epoch differs only in core's `when`.
  The failing case would be a non-empty SQL diff (stop point 6). The other direction:
  `git diff rehearsal-a rehearsal-c -- packages/db/drizzle/0000_baseline.sql` is NOT empty (A lacks
  `rehearsal_b`), so the comparison can tell. Run `rebuild-check --set core` on B: exit 0. Paste the
  commands and outputs into the pull request; `git worktree remove` the throwaway worktree.

### Task 8: Say how it works

**Files:** `docs/developers/conventions-data.md`, `docs/developers/testing-guide.md`, `CLAUDE.md`,
`docs/backlog/architecture.md`.

- [ ] **Step 1:** `conventions-data.md`, section "A drizzle migration-number collision on rebase is
  fixed by regeneration" (:3650): retitle it "A schema change rebuilds the set's one starting
  migration" and replace the first paragraph's procedure (:3652-3660) with the method: change the
  TypeScript schema, and hand-written SQL only in `<package>/triggers/<set>.sql` (never a migration
  of its own); run `pnpm --filter @waitron/server migration-baseline rebuild --set <name>`; every
  venue is reset; on a rebase conflict in a set's `drizzle/` files or the epoch file, `git checkout
  --ours -- <those paths>` (main's side during a rebase), re-run the command, `git add -A` them;
  `rebuild-check` in `scripts/starting-migrations.test.ts` fails CI on any hand edit or a
  drizzle-kit upgrade that changes generated text, which then needs a rebuild and a reset. Add one
  sentence: work beside A1308 changes a schema the same way (slice rules §8). Keep the list of
  guards to run, "Paid for on #165" and the "Since A760" history below. Also :448 — the two
  `REFERENCES` lines are now `:1965` and `:1993` (measured on the rebuilt core; re-check with the
  grep printed there and date it); and :1657 — add that core's triggers are written in
  `packages/db/triggers/core.sql`. And :1509-1510: the gap "caught elsewhere" is now caught by
  `rebuild-check` in `scripts/starting-migrations.test.ts`; the second gap cannot arise while
  hand-written SQL is `CREATE TRIGGER` statements only and no set holds a second migration. In the
  guard list kept under the rewritten paragraph (:3660), `scripts/migrations-match-schema.test.ts`
  becomes `scripts/starting-migrations.test.ts`.
- [ ] **Step 2:** `testing-guide.md`, "The A760 baseline tools" (:3364; "Three commands" is :3367):
  four commands now, plus a bullet for `rebuild` and `rebuild-check` — what they write, the folder
  refusal and `--fold-generated`, that a refusal writes nothing, that a second run changes nothing,
  how the journal is dated, exit codes (`rebuild` 0/2, `rebuild-check` 0/1/2), and that their tests
  run in `apps/server`'s suite with one real drizzle-kit case, while the root guard runs the check
  for every set.
- [ ] **Step 3:** `CLAUDE.md:607-611`: the entry becomes "**A schema change rebuilds the set's one
  starting migration, never a new migration or a hand edit:** change the TypeScript schema
  (hand-written SQL only in `<package>/triggers/<set>.sql`) and run `migration-baseline rebuild
  --set <name>`; on a rebase conflict take `main`'s copy (`git checkout --ours`) and re-run it.
  Until go-live; from go-live, incremental migrations and the rebuild hazards below apply again.
  Guard: `scripts/starting-migrations.test.ts`, weaker than its name: trusts drizzle-kit." followed
  by the existing "verify by RUNNING …" list with `scripts/migrations-match-schema.test.ts`
  replaced by `scripts/starting-migrations.test.ts`. Net change one or two lines;
  `scripts/claude-md-pointers.test.ts` must still pass.
- [ ] **Step 4:** `docs/backlog/architecture.md:1053-1054`: "Next is [A760]" is stale (A760 has
  landed); point it at the build order instead. No other backlog entry is finished by this slice.
- [ ] **Step 5:** Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and
  `pnpm exec prettier --check CLAUDE.md`. Expected: pass. Commit with `git commit -s`.

Then `/finish-branch` (rules §9), one push.

## Questions the code could not settle

None open. The coordinator settled the earlier two on 2026-11-08: retire
`migrations-match-schema` here; keep CLAUDE.md §3's table-rebuild entries for go-live.
