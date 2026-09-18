# SQLite slice 1 — the storage swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PostgreSQL with SQLite as Waitron's storage engine for a single standalone venue — sell, file, print, report, close the day — with no streaming, no object store and no second node.

**Architecture:** Three phases. **Prepare** (P1–P10) lands ten changes on today's PostgreSQL, each green and independently useful; their job is to move work out of the flip. **The flip** (F1) is one pull request that changes the engine and cannot be smaller. **Tidy** (T1–T3) deletes what the flip left inert, each green on SQLite. Every item is its own worktree, branch and pull request.

**Tech Stack:** Node 26 (`node:sqlite`, stable on this version), `drizzle-orm@0.45.2` with its SQLite dialect and a local adapter, `drizzle-kit@0.31.10`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` — read it before any task. The topology design it argues from is `docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** Its §1 (writing claims), §2 (the gate), §3 (conventions) and §4 (testing) apply to every task here, and several tasks exist because of a rule in it.
- **Every commit needs `git commit -s`.** Never commit to `main`. Each item gets its own worktree, created with `python3 ~/workspace/tools/worktree.py new waitron <branch>` — never a plain `git worktree add`.
- **Branch naming:** `feat/sqlite-slice1-<slug>` for prepare and tidy items, `feat/sqlite-slice1-flip` for F1.
- **TDD, always.** Failing test first, watch it fail for the right reason, then the minimal implementation. A test that never failed proves nothing.
- **The gate per item:** focused behavioural tests while implementing, then `/finish-branch`, which runs the local checks once and watches CI. Do not add a whole-workspace local run just to finish an item.
- **Prepare items must leave `main` green on PostgreSQL.** If an item cannot, it is in the wrong phase — stop and say so rather than bending it.
- **No backwards-compatibility or data-migration code.** Waitron is pre-production; schema changes drop and recreate (`CLAUDE.md` §3).
- **Comments state the invariant and the non-obvious why, never the history.** The receipt goes in the commit message and the pull request thread.
- **Plain English in commit messages and pull request text.** Exact file, function and error-code names appear once as pointers; a command that was run goes in verbatim.
- **Money is whole cents; quantity is whole thousandths; rates are whole basis points.** Never a blanket "numeric becomes cents" — the scales differ and truncating them is silent corruption.
- **A new workspace package must be wired in, or the root guards fail.** Guards that the pre-push
  hook and CI's lint job run on every push read workspace members BY NAME. Measured on 2026-09-16 by
  adding a member and then removing the wiring: unwired, `npx vitest run` at the repository root gives
  `Test Files  3 failed | 39 passed`, including `scripts/coverage-thresholds.test.ts` crashing with
  `ENOENT` looking for a `vitest.config.ts`; wired, `42 passed` and 3033 tests. This bites task F1,
  which creates `packages/store`.
- **`WAITRON_ENV` unset means preproduction.** Nothing in this plan may make a production database reachable by accident.

### The review boundary the campaign runner obeys

Items marked **owner review** touch the unrepairable fiscal core or the arithmetic feeding it. The runner opens the pull request, applies review findings, and **leaves it open** — it does not land it. Items marked **autonomous** the runner lands itself.

| Item | Phase | Depends on | Runner |
| --- | --- | --- | --- |
| P1 | prepare | — | autonomous |
| P2 | prepare | — | autonomous |
| P3 | prepare | — | autonomous |
| P4a | prepare | — | autonomous |
| P4b | prepare | P4a | owner review |
| P5 | prepare | P1 | owner review |
| P6 | prepare | P1 | owner review |
| P7 | prepare | — | autonomous |
| P8 | prepare | — | autonomous |
| P9 | prepare | — | autonomous |
| P10 | prepare | — | owner review |
| F1 | flip | all of P1–P10 | owner review |
| T1 | tidy | F1 | autonomous |
| T2 | tidy | F1 | autonomous |
| T3 | tidy | F1, T1, T2 | autonomous |

---

## File Structure

**Created by the prepare phase:**

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema/columns.ts` | The column and table vocabulary. Every table definition imports from here. Today emits PostgreSQL types; F1 swaps the bodies. |
| `packages/db/src/schema/columns.test.ts` | Proves each helper emits the type it claims, by reading the generated SQL. |
| `packages/db/src/testing/venue-db.ts` | The one test-database helper. Today wraps `usePgliteDb`; F1 swaps its body. |
| `packages/db/src/change-log.ts` | The post-commit change publisher that replaces `LISTEN`/`NOTIFY`. |
| `packages/db/src/job-claim.ts` | The shared claim-by-update helper that replaces `FOR UPDATE SKIP LOCKED`. |
| `packages/db/src/constraint-target.ts` | Answers "which table and columns did this refusal name?", replacing constraint-name matching. |
| `scripts/write-path-tables.test.ts` | The guard that replaces what grants enforce: a write path may not touch a table it has no business writing. |

**Created by the flip:**

| File | Responsibility |
| --- | --- |
| `packages/store/src/index.ts` | Opens `venue.db` and `node.db`, sets pragmas, hands out connections. |
| `packages/store/src/node-sqlite-adapter.ts` | The adapter that lets Drizzle's `better-sqlite3` driver drive `node:sqlite`. |
| `packages/store/src/write-queue.ts` | Serialises write transactions. One writer at a time, matching the engine. |
| `packages/store/src/append-only.ts` | Installs the `RAISE(ABORT)` triggers on every `ledger` table. |
| `packages/store/src/archive.ts` | `VACUUM INTO`, replacing the `pg_dump` path. |
| `scripts/two-file-foreign-keys.test.ts` | Fails if a foreign key crosses between `venue.db` and `node.db`. |

**Deleted by the flip:** `packages/sync` entirely; `packages/db/src/change-listener.ts`; `packages/db/src/testing/{postgres,shared-container,two-node,two-node-wireguard,networked-postgres}.ts`; `apps/server/src/pg-restore.ts`; the role and grant provisioning in `packages/provisioning`; `scripts/append-only-enable-always.test.ts`.

---

## Task P1: The column and table vocabulary

**Runner:** autonomous. **Depends on:** nothing.

Route all 795 column definitions and 106 table definitions through one module that today emits exactly today's PostgreSQL types. Nothing observable changes; the generated migrations must be byte-identical.

This task has two halves that land as **two pull requests**: P1a proves the vocabulary on one module and reports what it could not hide; P1b rolls it out. Do not skip the report — the spec's §5.1 says the enum may not hide cleanly, and the rollout's shape depends on the answer.

**Files:**

- Create: `packages/db/src/schema/columns.ts`
- Create: `packages/db/src/schema/columns.test.ts`
- Modify (P1a): `packages/db/src/schema/drawer-opens.ts`
- Modify (P1b): every remaining file that calls `pgTable(` (71 of them when this was written; 34 after `packages/db` and `packages/catalogue` landed, read on 2026-09-17)
- Modify (P1b, its first step): `packages/db/src/index.ts` (export the vocabulary)
- Create (P1b, its last step): `scripts/column-vocabulary.test.ts` (the guard)

**Interfaces:**

- Produces, consumed by P5, P6 and F1:
  - `id(name: string)` — a uuid primary-key-shaped column
  - `ts(name: string)` — a timestamptz column in `date` mode, read back as a `Date`
  - `tsString(name: string)` — the same column type in `string` mode, read back as the driver's string; the two emit identical SQL, so a column keeps whichever mode it already had
  - `json<T>(name: string)` — a jsonb column typed `T`
  - `money(name: string)` — a monetary amount
  - `quantity(name: string)` — a quantity with three decimal places
  - `rate(name: string)` — a percentage rate with two decimal places
  - `enumText<T extends string>(name: string, values: readonly T[])` — a closed vocabulary: a text column carrying its permitted values
  - `enumCheck(column)` — the `in (...)` constraint body for an `enumText` column, built from that column's own values, so the constraint and the type cannot list different sets
  - `table` — the table builder
- Consumes: nothing.

### P1a — prove the vocabulary on one module

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/columns.test.ts`. It asserts the generated DDL, not the builder's shape — a test that only checks the helper returns *something* would pass with every helper wrong.

```ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { table, id, ts, json, money, quantity, rate, enumText } from "./columns.js";

const probe = table("probe", {
  pk: id("pk").primaryKey().defaultRandom(),
  at: ts("at"),
  doc: json<{ a: number }>("doc"),
  amount: money("amount"),
  qty: quantity("qty"),
  vat: rate("vat"),
  kind: enumText("kind", ["cash_sale", "manual"] as const),
});

const columnsOf = () => Object.fromEntries(getTableConfig(probe).columns.map((c) => [c.name, c]));

describe("the column vocabulary emits today's PostgreSQL types", () => {
  it("keeps the exact SQL type of every helper", () => {
    const c = columnsOf();
    expect(c.pk.getSQLType()).toBe("uuid");
    expect(c.at.getSQLType()).toBe("timestamp with time zone");
    expect(c.doc.getSQLType()).toBe("jsonb");
    expect(c.amount.getSQLType()).toBe("numeric(12, 2)");
    expect(c.qty.getSQLType()).toBe("numeric(12, 3)");
    expect(c.vat.getSQLType()).toBe("numeric(5, 2)");
    expect(c.kind.getSQLType()).toBe("text");
  });

  it("gives a timestamp column date mode, not string mode", () => {
    // The mode changes what a read returns without changing the column type, so
    // the type assertion above cannot catch it. `ts` is the date-mode helper;
    // string-mode columns need their own helper, `tsString` — string mode is the
    // majority in this repository, which this plan originally had backwards. See
    // the P1a findings below.
    expect(columnsOf().at.mapFromDriverValue("2026-09-16T10:00:00Z")).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- columns.test.ts
```

Expected: FAIL — `Cannot find module './columns.js'`.

- [ ] **Step 3: Write the vocabulary**

Create `packages/db/src/schema/columns.ts`:

Updated 2026-09-17, after the item ran: the sketch below is the shape that actually landed, which
differs from what this plan first proposed in three places — a second timestamp helper (`tsString`),
a different `enumText` body, and a new `enumCheck` helper. The "P1a findings" section under these
steps has the timestamp one. The other two were measured while writing the file and their receipts
are in the file's own comments, not in the findings. The comments below are shortened so the step
stays readable; read `packages/db/src/schema/columns.ts` for the full version.

```ts
import { getTableColumns, sql, type AnyColumn } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The one place the storage engine's column types are named.
 *
 * Every table definition imports its columns from here so the engine can be changed in one file
 * rather than in 795 column definitions across 72 files. The bodies below emit PostgreSQL types;
 * the SQLite switch replaces them and nothing else.
 *
 * Scale is part of the meaning, not decoration: money, quantity and rate are three different
 * scales and a single "numeric" helper would let one silently truncate another.
 */

/** A uuid identifier. */
export const id = (name: string) => uuid(name);

/** A moment on the server clock, read back as a JavaScript `Date`. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A moment on the server clock, read back as the string the driver rendered — no `Date` is built.
 * `ts` and `tsString` emit the same SQL type, so the step 6 probe cannot tell them apart; only a
 * test of `mapFromDriverValue` can.
 */
export const tsString = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** A structured document. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

/** A monetary amount: two decimal places. */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** A quantity: three decimal places, so 0.005 kg is representable. */
export const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** A percentage rate: two decimal places, e.g. a 21.00 VAT rate. */
export const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * A closed vocabulary: a text column whose permitted values are listed in a `check()` constraint.
 *
 * This is NOT the house preference in either direction — the repository declares more `pgEnum`
 * types than checked text columns. Text plus a check is for an AUDIT vocabulary that may widen,
 * where widening costs a one-line migration instead of an `ALTER TYPE`. A per-venue CONFIG mode
 * stays a `pgEnum`. The file itself names an example of each.
 *
 * Passing the values to `text` (rather than typing the column with `$type<T>()` and ignoring them)
 * is what puts them on the column as `enumValues`, which is what `enumCheck` below reads.
 */
export const enumText = <T extends string>(name: string, values: readonly T[]) =>
  text(name, { enum: values as readonly [T, ...T[]] });

/**
 * The `in (...)` constraint body for an `enumText` column, read off that column's own values, so
 * the constraint and the column's TypeScript type cannot list different sets. Two measured details
 * it has to carry — `.inlineParams()`, and a fallback to the table's own column — are written out
 * in the real file's comment, with what each measurement was.
 */
export const enumCheck = (column: AnyColumn) => {
  const onTable: readonly AnyColumn[] = Object.values(getTableColumns(column.table));
  const values: readonly string[] | undefined =
    column.enumValues ?? onTable.find((c) => c.name === column.name)?.enumValues;
  if (values === undefined) {
    throw new Error(`enumCheck: column "${column.name}" was not declared with enumText`);
  }
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`.inlineParams();
};

export const flag = (name: string) => boolean(name);
export const count = (name: string) => integer(name);
export const label = (name: string) => text(name);

export const table = pgTable;
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @waitron/db test -- columns.test.ts
```

Expected: PASS, both cases.

- [ ] **Step 5: Convert one module and prove the migration is unchanged**

Rewrite `packages/db/src/schema/drawer-opens.ts` to import from `./columns.js`. The check constraint stays on the table, exactly where it was; only the column builders move, and the constraint's values now come from the column instead of being typed a second time.

Updated 2026-09-17, after the item ran: the constraint body and the exported type below are not
what this plan first proposed. The hand-written `sql` string and the hand-written union type were
each a second copy of the same vocabulary, written out by hand beside the `enumText` call that
already held it; both now read the column instead, through `enumCheck` and `enumValues`. The `sql`
import goes with them. The landed file is `packages/db/src/schema/drawer-opens.ts`.

```ts
import { check } from "drizzle-orm/pg-core";
import { enumCheck, enumText, flag, id, table, ts } from "./columns.js";

export const drawerOpens = table(
  "drawer_opens",
  {
    id: id("id").primaryKey().defaultRandom(),
    tillId: id("till_id").notNull(),
    personId: id("person_id").notNull(),
    openedAt: ts("opened_at").notNull().defaultNow(),
    reason: enumText("reason", ["cash_sale", "manual"] as const).notNull(),
    saleId: id("sale_id"),
    authorizedBy: id("authorized_by"),
    viaOverride: flag("via_override").notNull().default(false),
  },
  (t) => [check("drawer_opens_reason_ck", enumCheck(t.reason))],
);

/** The `reason` vocabulary as a type, read off the column — the `orders.ts` `DONENESS` shape. */
export type DrawerOpenReason = (typeof drawerOpens.reason.enumValues)[number];
```

Keep the existing explanatory comments — thin them where they narrate history, per `CLAUDE.md` §1, but do not delete the ones stating why `till_id` and `sale_id` carry hand-written foreign keys.

- [ ] **Step 6: Prove nothing changed, by regenerating**

This is the acceptance check for the whole task, and it must be run, not reasoned about.

**Do not use `drizzle-kit check` for this.** It never reads the schema source — it only checks the
migration folder against itself — so it answers "everything's fine" whatever the helpers emit.
Measured on 2026-09-17 in `packages/db` by changing `flag` from `boolean(name)` to `integer(name)`
and running `pnpm --filter @waitron/db exec drizzle-kit check`: `Everything's fine`, exit 0, with a
column type already broken.

Generate into a throwaway COPY of the migration folder instead, and diff:

```bash
cp -R drizzle drizzle-probe-tmp
grep schema: drizzle.config.ts          # this package's own schema entry point
pnpm exec drizzle-kit generate --dialect postgresql --schema ./src/schema/index.ts --out ./drizzle-probe-tmp --name probe
diff -r drizzle drizzle-probe-tmp
rm -rf drizzle-probe-tmp
```

**All three of `--dialect`, `--schema` and `--out` have to be on the command line, and `--schema`
differs between packages.** Passing any one of them makes drizzle-kit ignore `drizzle.config.ts`
entirely, and it then refuses because the other two are missing. Measured in `packages/db` on
2026-09-17, passing only `--out`:

```text
Error  Please provide required params:
    [x] schema: undefined
    [x] dialect: undefined
    [✓] out: './drizzle-probe-tmp'
```

exit 1 — and `[x]` there marks a MISSING parameter, not one supplied by the config file. So read the
entry point out of the package's own `drizzle.config.ts` (the `grep` above) and pass it. Nine
packages use `./src/schema/index.ts`; four do not — `packages/bookings` uses
`./src/schema/bookings.ts`, `packages/media` uses `./src/schema/images.ts`, `packages/venue-service`
uses `./src/schema/service.ts`, and `packages/fiscal-none` uses `./src/index.ts`.

**Read the exit status and the message, never the silent `diff` alone.** This is the trap that makes
the probe worth stating carefully: when drizzle-kit refuses it exits non-zero and says why, but it
also writes nothing at all, so the `diff -r` that follows is silent — which is exactly what a PASS
looks like. A silent diff on its own is not evidence. The
pass you are looking for is `No schema changes, nothing to migrate` with exit 0 AND a silent diff.
(`CLAUDE.md` §1: a measurement taken where both answers look alike measures nothing. This one cost a
false receipt in this plan's own first draft, caught by a reviewer who ran a control.)

Two smaller things. Run it from the package directory — `--out` is resolved relative to the working
directory, so an absolute path fails. And the scratch folder is created inside the package, so a run
that stops part-way leaves `drizzle-probe-tmp` sitting in `git status`; delete it.

Expected: `No schema changes, nothing to migrate`, and `diff -r` silent — the schema the vocabulary
produces is the schema already in the snapshots. The real migration folder is never written to.

This probe has a control in the other direction, which is why it is trusted: with the broken `flag`
above, the same commands emitted
`ALTER TABLE "drawer_opens" ALTER COLUMN "via_override" SET DATA TYPE integer;`. **If it reports a
difference, the vocabulary is wrong**, not the snapshot; fix the helper rather than regenerating.

- [ ] **Step 7: Run the package suite**

```bash
pnpm --filter @waitron/db test:coverage
```

Expected: PASS.

- [ ] **Step 8: Write the report**

Append a short section to the plan file itself (this file), under "P1a findings", stating for each helper whether it hid the difference cleanly and naming anything it could not. Specifically answer: does any table use a real `pgEnum` that `enumText` cannot express, and how many?

Count DECLARATIONS, not every line that mentions the word:

```bash
grep -rnE 'export const [A-Za-z0-9_]+ = pgEnum\(' packages apps --include='*.ts' \
  | grep -v node_modules | grep -v '.test.ts' | wc -l
grep -rlE 'export const [A-Za-z0-9_]+ = pgEnum\(' packages apps --include='*.ts' \
  | grep -v node_modules | grep -v '.test.ts' | wc -l
```

A bare `grep -rn 'pgEnum('` with the same two filters returns a larger number, because some comments
quote `pgEnum(` while explaining a column. Whichever filter you use, write it into the finding beside
the number, so a later reader re-running a different command does not conclude the finding is stale.

- [ ] **Step 9: Commit and open the pull request**

```bash
git add packages/db/src/schema/columns.ts packages/db/src/schema/columns.test.ts \
        packages/db/src/schema/drawer-opens.ts docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md
git commit -s -m "Put the database column types in one module, and use it for one table

The SQLite switch has to change 795 column definitions across 72 files. Routing
them through one module first means the switch changes this file instead.

The helpers emit exactly the PostgreSQL types they replace. The check for that
is generating the migrations into a copy of the migration folder and diffing it
against the real one: drizzle-kit reported no schema changes, and the diff was
empty. One table, drawer_opens, now uses them. The report of what the
vocabulary could not hide is in the plan."
```

Then `/finish-branch`.

### P1a findings

What the vocabulary hid, and what it could not. Everything below was measured on 2026-09-17, and
each finding says which measurement it rests on: the generate-into-a-copy probe from step 6, a
census by `grep` over `packages` and `apps` skipping `node_modules` and test files, a direct probe of
a column's `mapFromDriverValue` or `mapToDriverValue`, or — where the finding is that some check does
NOT catch something — making the change in the source and running that check over it.

**Hidden cleanly — `drawer_opens` converted with no schema change at all.** `id`, `ts`, `json`,
`money`, `quantity`, `rate`, `flag`, `count`, `label` and `table` each emit exactly the type they
replace; `drizzle-kit generate` against a copy of the snapshot folder produced
`No schema changes, nothing to migrate` and `diff -r` was silent.

**The acceptance check in this plan was wrong, and it is now fixed above.** `drizzle-kit check`
does not read the schema source. Control: `flag` changed from `boolean(name)` to `integer(name)`,
`drizzle-kit check` still printed `Everything's fine` and exited 0. The generate-into-a-copy probe
caught the same break immediately. A pass and a fail looked identical under the old check, so it was
measuring nothing.

**What `enumText` could NOT hide: the database enum.** Counted on 2026-09-17 with the step 8
command, which matches a declaration — `export const … = pgEnum(` — and drops `node_modules` and
test files: **35 declarations across 21 files**. The filter matters, so here it is spelled out: a
bare `grep -rn 'pgEnum('` with the same two exclusions returns 38 across 24 on this commit, and the
three extra lines are comments quoting `pgEnum(` while explaining a column, in
`packages/ui/src/floor.ts`, `apps/till/src/api/client.ts` and `apps/dashboard/src/api/client.ts`.
Both numbers are right; they answer different questions. Treat the shape as the finding rather than
either number. A `pgEnum` is a distinct PostgreSQL type created by
`CREATE TYPE … AS ENUM`; `enumText` emits `text`. Pointing `enumText` at one is a real schema change,
measured by converting `ticket_items.state` from `ticketState("state")` to
`enumText("state", ["queued", "preparing", "ready"] as const)`:

```sql
ALTER TABLE "ticket_items" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ticket_items" ALTER COLUMN "state" SET DEFAULT 'queued';
```

**Consequence for P1b: leave every `pgEnum` column alone.** Convert the columns around it and keep
importing `pgEnum` from `drizzle-orm/pg-core` in the files that declare one. The rollout cannot carry
the enums, because doing so breaks the "no schema change" rule that is the whole point of P1.

**Consequence for F1:** SQLite has no enum type, so every one of them has to become text plus a
check constraint at the flip, and that conversion carries a migration — it is flip work, not prepare
work. The mechanical part is already proven: `enumText` plus a `check()` is exactly the shape
`drawer_opens.reason` already uses, and this item converted it.

**One thing the guard in P1b step 5 will not see.** A file that keeps importing `pgEnum` (every file
declaring one must) still has a `drizzle-orm/pg-core` import line, and it passes: the guard reports
only the names the vocabulary itself imports, and `pgEnum` is not one of them. That is correct, but
it means the guard proves "no raw column builder", never "fully converted". _Corrected 2026-09-18,
when the guard shipped: this paragraph used to describe a two-part predicate — an import line plus a
separate search for builder NAMES — that the shipped guard does not have; it makes one match, on the
import specifier. The four later passages of this plan that mention this guard state only the
conclusion, which still holds; the draft predicate is described once more, in the
`packages/fiscal-verifactu` report, and is corrected there._

**What `ts` could NOT hide: a timestamp's mode — and this is the finding to read twice.** `ts()` is
hard-wired to `mode: "date"`, on the assumption written into this plan's own test comment that date
mode is what every existing caller uses. That assumption was wrong.

The mode changes what the driver mapping does in both directions, and does not change the SQL type.
Probed on 2026-09-17 by handing each spelling's `mapFromDriverValue` the string
`"2026-09-16T10:00:00Z"`: a `timestamp` with no mode at all gave back a `Date`, `mode: "date"` gave
back a `Date`, and `mode: "string"` gave back the string. The write direction differs too, probed the
same day: date mode's `mapToDriverValue` handed that same string threw
`TypeError: value.toISOString is not a function`, and string mode's handed a `Date` returned
`"2026-09-16T10:00:00.000Z"`. All spellings report the SQL type `timestamp with time zone`. So they
emit the same DDL, produce the same generated migration, and leave the step 4 probe's `diff -r`
silent. **Converting a string-mode column to `ts()` changes every read of that column, and the
schema probe — the acceptance check this task leans on — cannot see it.**

What WOULD notice, so nobody dismisses this warning as invisible to everything: `ts()` and
`tsString()` give a column different TypeScript types in both directions — a select returns `Date`
against `string`, and an insert wants the opposite — so most call sites for a converted column stop
compiling, and the pre-push hook typechecks the packages a push changed. P1b step 4 also runs
`pnpm --filter <package> test:coverage`, and any call site that does compile and then writes a
string into a date-mode column hits the `TypeError` above. The warning is worth keeping anyway,
because the check this plan calls the acceptance check for the task stays silent, and because
"most call sites stop compiling" is a statement about the types, not a count anybody has taken —
nobody has converted a string-mode column and counted what went red. Read the mode off the line
being replaced; do not lean on the compiler to find it for you.

String mode is not the minority case. Counted on 2026-09-17 across `packages` and `apps`, skipping
`node_modules` and test files: about 90 timestamp columns in about 45 files carry `mode: "string"`,
against about 19 carrying `mode: "date"` — roughly five to one the other way from what the plan
assumed. The two modes are not even split cleanly by package:
`dailyCloses.closedAt` in `packages/db/src/schema/daily-closes.ts` is date mode and
`saleVoids.voidedAt` in `packages/db/src/schema/sale-voids.ts` is string mode, in the same
package. Those numbers are a dated measurement, not the finding; the
finding is that the mode is per column and the probe is blind to it.

So the vocabulary carries two timestamp helpers rather than one: `ts` for date mode, and the
`tsString` this item adds for string mode. **P1b must read the mode off each line it is replacing and
keep it, column by column.** A file converted mechanically, every `timestamp(...)` becoming
`ts(...)`, passes step 4's probe and its `diff -r`, because the only thing it changed is the one
thing neither of them looks at.

**Five more column builders are in live use, and the vocabulary has an equivalent for none of them.**
Step 3 tells the reader to replace each column builder with its vocabulary equivalent. For these
there is nothing to replace it with. Counted on 2026-09-17 over the non-test files that import from
`drizzle-orm/pg-core`:

| Builder                          | Sites on 2026-09-17 | Where to look first                                                                                                                                            |
| -------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date()`                         | 14                  | `packages/db/src/schema/daily-closes.ts:59`, `packages/db/src/schema/purchase-invoices.ts:63,66`, `packages/fiscal-verifactu/src/schema/registros.ts:56,101` |
| `time()`                         | 4                   | `packages/db/src/schema/tenants.ts:134`, `packages/bookings/src/schema/bookings.ts:57`                                                                          |
| `smallint()`                     | 5                   | `packages/db/src/schema/dining-tables.ts:59,60,62`                                                                                                             |
| `bigint(…, { mode: "number" })`  | 3                   | `catalogue.version` and `node_membership.term` in `packages/db/src/schema/`, `webauthn_credentials.counter` in `packages/identity/src/schema/webauthn.ts` — named rather than numbered, the conversions having moved all three |
| a hand-rolled `bytea` customType | 3                   | `packages/db/src/schema/print-jobs.ts:26`, `packages/credentials/src/schema/tenant-credentials.ts:15`, `packages/media/src/schema/images.ts:16`                  |

**Add each missing helper, with its own generated-type test, before converting the first column that
needs it** — the same shape as the cases already in `packages/db/src/schema/columns.test.ts`. Do not
improvise a substitution at the call site. Reaching for `count()` because a `smallint` holds a small
number, or `label()` because a date is stored as text elsewhere, puts the engine decision back into
the call sites that P1 exists to empty, and the flip then has to find them again.

_Updated 2026-09-17: all five now have a helper, so the paragraph and table above no longer describe
the tree. They stay as written because a findings section records what was true when it was
written._ P1b step 1 below added `day`, `timeOfDay`, `smallCount`, `bigCount` and `binary` to
`packages/db/src/schema/columns.ts` and re-exported all of them from `packages/db/src/index.ts`,
each with its own cases in `packages/db/src/schema/columns.test.ts`. What each one is called, what
it emits and why it is named that way is in P1b step 1 — that is where the detail lives now. What
has NOT happened is the conversion: no table file changed on that branch, so every site listed in
the table above is still spelled the old way.

_Updated 2026-09-17: that is no longer true of `packages/db`._ P1b's second pull request converted
all 33 of its table files, so every `packages/db` row of the table above — `day`, `timeOfDay`,
`smallCount` and `bigCount` — is now in live use. Every `packages/db` line number in this findings
section went with it: the table's rows, and the `print-jobs.ts:26` pointer the `bytea` paragraphs
below use, all name lines those 33 rewrites moved. The claims they carry are still true; the
numbers are not. `binary` was the one helper still unused by any column when that was written;
P1b's THIRD pull request put it to use, on `print_jobs.payload`. The other
packages' rows are untouched. The table itself stays as written, because a findings section records
what was true when it was written.

`bytea` needs a decision before it can have a helper, because the three blocks are not the same
block. `packages/db/src/schema/print-jobs.ts:26` and
`packages/credentials/src/schema/tenant-credentials.ts:15` both declare
`customType<{ data: Buffer; driverData: Buffer }>`, so TypeScript hands their callers a node
`Buffer`. `packages/media/src/schema/images.ts:16` declares
`customType<{ data: Uint8Array; driverData: Buffer }>` and converts in both directions, so its
callers get a plain `Uint8Array`. One named binary helper can be the only version F1 changes in one
place ONLY once those two shapes are reconciled — which means picking the type callers see and
changing the call sites on the other side. Until that decision is made and the callers are checked,
the vocabulary would need two binary helpers, which puts the engine decision back where P1 is trying
to remove it. `packages/media` is on the rollout list in P1b step 2, so this lands inside P1b, not
after it.

_Updated 2026-09-17: the decision has been taken, and it went ONE helper, not two._ The vocabulary's
`binary` hands callers a `Uint8Array` and binds a node `Buffer` — that is the `packages/media`
shape, not the `Buffer`-both-ways shape — in the private `bytea` custom type in
`packages/db/src/schema/columns.ts`. Why that side was picked, and which call sites it
moves, is in P1b step 1 below; that is where the detail lives now. **The callers on the other side
have NOT been changed yet.** All three hand-rolled blocks named above are still in the tree —
the `bytea` custom type in `packages/db/src/schema/print-jobs.ts` and
`packages/credentials/src/schema/tenant-credentials.ts:15` still declare
`customType<{ data: Buffer; driverData: Buffer }>`, and `packages/media/src/schema/images.ts:16`
still declares its own `customType<{ data: Uint8Array; driverData: Buffer }>`. Read on 2026-09-17
with `grep -n customType packages/db/src/schema/print-jobs.ts \
packages/credentials/src/schema/tenant-credentials.ts packages/media/src/schema/images.ts`, which
printed all three declarations. Replacing them is step 3's work, not step 1's.

_Corrected 2026-09-17, later the same day: one of the three has gone._ P1b's THIRD pull request
deleted `print-jobs.ts`'s block, moved `print_jobs.payload` onto the shared `binary` helper and
changed its callers. `packages/credentials` and `packages/media` still declare theirs, so the
paragraph above holds for those two and no longer for `packages/db`.

_Corrected again 2026-09-18: a second of the three has gone._ P1b's THIRTEENTH pull request deleted
`tenant-credentials.ts`'s block and moved that table's `ciphertext`, `iv` and `auth_tag` onto the
shared `binary` helper. Only `packages/media`'s block is left, and it is the one that already
declares the shape the vocabulary took — so the "callers on the other side" the paragraph above is
about have all now been changed. What changing them cost in `packages/credentials` is in that
package's report under step 3.

_Corrected a third time, 2026-09-18: the last of the three has gone._ P1b's FOURTEENTH pull request
deleted `packages/media/src/schema/images.ts`'s block and moved `media_image_data.bytes` onto the
shared `binary` helper. `grep -rn customType packages apps --include="*.ts"` now matches no file
but `packages/db/src/schema/columns.ts` and `columns.test.ts`, where the one match is prose. That
receipt is stated at FILE granularity on purpose: the docstring carrying it is itself one of the
matches, so a count of matching LINES can move on a reword — which is what happened: an earlier
draft counted five, and this one's own rewording took it to four. So every paragraph on this
page written while a hand-rolled block was still in the tree is a dated record rather than a
description of today's tree. This one cost no caller anything: media's block declared
the `Uint8Array`-facing shape body for body, proved by `diff` of the two five-line blocks exiting 0
before the deletion.

**Two `text` columns that must never become `label()`.**
`packages/fiscal-verifactu/src/schema/registros.ts:88-89` stores `cuota_total` and `importe_total` as
`text` deliberately, and the comment above them says why: `packages/verifactu/src/huella.ts` hashes
those stored values verbatim as strings, so the bytes stored have to be the bytes hashed — which a
character type gives and `numeric` does not: `numeric(12,2)` re-renders on read and is additionally
too narrow for the format's twelve integer digits. Under a mechanical conversion those two lines look exactly like free text and
`label()` is the obvious substitution.

It must not be made, and nothing in P1b would report it. `label()` emits `text` today, so the step 4
probe stays silent, and no design document says `label()`'s body changes at the flip — the mapping
table in `2026-09-16-sqlite-slice1-storage-swap-design.md` has no row for plain text. The reason is
the simpler one: these two columns must stay outside any generic decision about text, and `label()`
is that decision. The
existing guard, `packages/fiscal-verifactu/src/monetary-columns.test.ts`, inserts a
twelve-integer-digit amount and asserts it reads back byte-identically — it names no helper and reads
no schema source.

That last sentence was a reading of the test file until 2026-09-17, when the substitution was
actually made and the guard run. `registros_facturacion`'s `cuota_total` and `importe_total` were
changed from `text(...)` to a locally defined `label(...)` with the same body the vocabulary's
helper has, and:

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/monetary-columns.test.ts
```

exited 0, reporting `Test Files 1 passed (1)` and `Tests 1 passed (1)`. The substitution was in
place and the guard did not notice it. So this is the test that catches a lossy column type, not the
test that catches this substitution — measured, not inferred. `CLAUDE.md` §5: a wrong value in the
fiscal records is not repairable afterwards.

**The vocabulary is not exported yet, and P1b's first cross-package conversion cannot start until it
is.** P1a deliberately left `packages/db/src/index.ts` alone — nothing outside `packages/db` needed
the vocabulary yet, and the commit message says so. But `packages/db`'s `exports` map is enumerated
rather than a wildcard (`packages/db/package.json`; `CLAUDE.md` §3 pins that it is enumerated), so
`.` → `./src/index.ts` is the only door any other package has, and on 2026-09-17 neither
`packages/db/src/index.ts` nor `packages/db/src/schema/index.ts` mentions `columns.js`. That is why
P1b now opens with a step that adds the export. There is no dependency problem in doing it: of the
sixteen packages on the rollout list, fifteen already declare `@waitron/db` in their `dependencies`
(read out of each `package.json` on 2026-09-17). The sixteenth is `packages/db` itself, which does
not declare a dependency on itself and does not need one — its own files import `./columns.js`
directly. (The list has held fourteen since the owner removed `recipes` and `layouts` from it later
that day; the conclusion is unchanged, because both of the removed two were among the fifteen.)

_Updated 2026-09-17: the paragraph above is done, and stays as written because a findings section
records what was true when it was written._ The branch that landed P1b step 1 below is what retired
it: `packages/db/src/index.ts` now re-exports the vocabulary's names, listed one by one rather than
starred, so every package that depends on `@waitron/db` can reach it through the one door the
enumerated `exports` map opens. The export block is `packages/db/src/index.ts:6-27`; the command
that shows it is `sed -n '6,27p' packages/db/src/index.ts`, which prints the two comment lines and
the whole hand-listed block (eighteen names, read on 2026-09-17). A plain
`grep -n columns packages/db/src/index.ts` is NOT the receipt for this claim and was cited here in
error: it matches two lines, the comment and the closing `} from "./schema/columns.js";`, and
neither of them shows a single name. The names
are hand-listed because the test that pins them — `packages/db/src/schema/columns.test.ts` — cannot
fail under a star export: no helper added later could ever be missing from it. **A helper added in
step 3 has to be added to that export list in the same change**, or that test goes red.

One half of the paragraph is still true and does not need fixing:
`packages/db/src/schema/index.ts` still does not mention `columns.js`, and it should not.
`grep -n columns packages/db/src/schema/index.ts` finds nothing, and that file is the barrel of TABLE
modules — every line in it re-exports a file that defines tables, and the type of `Database` is built
from it. `columns.ts` defines no table: `grep -nE 'table\(|pgTable\(' packages/db/src/schema/columns.ts`
returns no matches at all, because its only mention of the table builder is
`export const table = pgTable;`, which passes the builder along rather than calling it. Re-exporting
it from the schema barrel would put column helpers into the shape `Database` is parameterised on, for
no gain.

### P1b — roll the vocabulary out

- [x] **Step 1: Export the vocabulary from `packages/db`, first, on its own** — done 2026-09-17

P1a left `packages/db/src/index.ts` untouched on purpose, and that is the reason this step existed:
until it ran, nothing outside `packages/db` could reach `columns.ts`, because `packages/db`'s
`exports` map is enumerated rather than a wildcard (`packages/db/package.json`) and
`.` → `./src/index.ts` is the only door. So the export had to come before converting any other
package; every package on the list below except `packages/db` itself already declares `@waitron/db`
in its `dependencies`, so nothing else had to move.

_Done 2026-09-17: the door is open. `packages/db/src/index.ts:6-27` re-exports the vocabulary, the
names listed one by one rather than starred — `sed -n '6,27p' packages/db/src/index.ts`._

Add the missing helpers here too, each with its own generated-type case in
`packages/db/src/schema/columns.test.ts`, before the first column that needs one is converted:
`date`, `time`, `smallint`, `bigint` and the binary (`bytea`) type. The P1a findings above list where
each one is in use. (The string-mode timestamp is not on that list: P1a added `tsString` already.)

**What step 1 actually added, so step 3 does not have to re-derive it.** The five helpers are `day`
(`date`, bare), `timeOfDay` (`time`, bare), `smallCount` (`smallint`), `bigCount` (`bigint` in number
mode) and `binary` (the `bytea` custom type).

Three of them are named for what the column MEANS, matching the file's existing
`money`/`quantity`/`rate` style rather than the SQL type: `day`, `timeOfDay` and `binary`. The two
integer helpers are not, and that is on purpose. `smallCount` and `bigCount` spell the SQL WIDTH out
in prose, because the width is the only thing that separates them from the `count` helper the file
already has, and there is no one meaning they could be named after instead. The `smallint` columns in
the tree are not counts of anything: `availability.weekday` and `shift_templates.weekday` in
`packages/workforce` are days of the week, and `dining_tables`'s `pos_x`,
`pos_y` and `rotation` in `packages/db/src/schema/dining-tables.ts` are a position on a floor plan
and an angle. The `bigint` columns are no more alike than that: `catalogue.version` in
`packages/db/src/schema/catalogue.ts` is a catalogue version, `node_membership.term` in
`packages/db/src/schema/node-membership.ts` is a membership term and
`webauthn_credentials.counter` in `packages/identity/src/schema/webauthn.ts` is a WebAuthn
signature counter. **Every site in this paragraph is named rather than numbered**, and that is a
repair rather than a style: each was first cited by line number, and by 2026-09-18 four of the five
had moved under a conversion — `packages/db`'s own for the two `dining_tables` positions and for
both bigint sites, the workforce conversion for `availability.weekday`. Every one was re-opened and
re-read on 2026-09-18. So the helper names the width and the call site keeps the meaning.

**What each helper copies is a property to check, not a count to match.** The rule is: each helper
emits exactly what the sites it replaces emit today, so read the spelling off the call sites rather
than trusting a total. As a dated reading, taken by grep over `packages` and `apps` on 2026-09-17,
skipping `node_modules` and test files: every `date` site (14 of them) and every `time` site (4) uses
the bare form with no options object, every `smallint` site (5) likewise, and every `bigint` site (3)
passes `{ mode: "number" }`. Those numbers are the receipt for that reading, not the instruction — a
later grep returning different numbers means the tree moved, not that the rule changed.

Two of the five carry the `ts`/`tsString` trap — a second spelling emitting the SAME SQL type — so
`columns.test.ts` pins each by its read mapping. A bare `date(name)` is drizzle's STRING mode
(`columnType` `PgDateString`, a read returns `"2026-09-16"`), while `date(name, { mode: "date" })`
returns a `Date`; `bigint` in number mode is `PgBigInt53` and returns a number, while bigint mode
returns `42n`. Both pairs emit identical DDL, so the step 4 probe is blind to picking the wrong one.

**The binary decision, and what it will cost the conversion pull requests.** The three hand-rolled
`bytea` blocks disagree with each other, and step 1 converted none of them — all three were still in
the tree, checked on 2026-09-17. _None of the three is left. P1b's third pull request deleted
`print-jobs.ts`'s block and moved that column onto the shared helper, its THIRTEENTH deleted
`tenant-credentials.ts`'s, and its FOURTEENTH deleted `packages/media/src/schema/images.ts`'s — so
all three files named next are a dated record of where those blocks used to be._ The `bytea` custom
type in `packages/db/src/schema/print-jobs.ts`
and
`packages/credentials/src/schema/tenant-credentials.ts:15` hand callers a node `Buffer`;
`packages/media/src/schema/images.ts:16` hands them a `Uint8Array`. The vocabulary took the
`Uint8Array` shape, read off the callers rather than argued: `packages/printing/src/outbox.ts:26`
already accepts a `Uint8Array` (`payload: Uint8Array,`) and calls `Buffer.from` at line 55 only
because the column demands a `Buffer`, and `packages/printing/src/runtime.ts:288-291` copies a
read-back payload straight back into a `Uint8Array`. So the conversion deletes the `outbox.ts` hand
conversion; the `runtime.ts` copy STAYS, for the reason the correction under step 2 below gives —
that row is read with raw SQL and no column mapping runs over it.

**The call sites are not confined to the two packages that own those columns.** Converting
`print-jobs.ts` changes what its callers are handed from `Buffer` to `Uint8Array`, and the SQL type
stays `bytea` either way — **the step 4 probe will not report it**. Each of these was opened and read
on 2026-09-17:

- `packages/printing/src/outbox.ts:55` — `payload: Buffer.from(payload),` on the insert. The
  conversion deletes the `Buffer.from`.
- `packages/printing/src/runtime.ts:291` —
  `await transport.send(target, new Uint8Array(job.payload));` on the read back. The conversion
  deletes the `new Uint8Array`, and the three comment lines above it (288-290) explaining the copy go
  with it.
- `packages/printing/src/outbox.test.ts:33-38` — a test helper `jobRow`, whose return type on line 38
  is written out as `Promise<{ status: string; payload: Buffer }>`. That type has to change, and so
  does the doc comment above it, which says the payload "decodes through the bytea customType to a
  Buffer".
- `apps/server/src/till-sale-integrated.pg.test.ts:278-288` — a helper whose signature on line 279 is
  `async function printJobPayloads(cfg: TillConfig, printerId: string): Promise<Buffer[]>`, with the
  same kind of doc comment above it on line 278.
- `packages/db/src/schema/printing.test.ts:243-245` — the one that changes meaning rather than just
  type. Line 244 is `expect(Buffer.isBuffer(row!.payload)).toBe(true);`, and that assertion FLIPS to
  `false` the moment the column becomes `binary`, because the helper's `fromDriver` returns
  `new Uint8Array(value)` — the `fromDriver` of the private `bytea` custom type in
  `packages/db/src/schema/columns.ts`, read on 2026-09-17. (Two earlier drafts of this bullet cited
  that custom type by line number and both went stale, once when step 1 moved it and once when
  step 3 added a line above it. It is named rather than numbered for that reason.)
  Line 245 then calls
  `row!.payload.toString("utf8")`, which a `Uint8Array` does not support in the way a `Buffer` does,
  so it needs rewriting too, not just retyping.

`print-jobs.ts` lives in `packages/db`, which is the FIRST package on step 2's rollout list below, so
this arrives at the very start of the rollout rather than at the end. **The `packages/db` conversion
pull request has to include `packages/printing` and `apps/server` in its own verification — their
typechecks and their suites — and neither of those packages appears on step 2's list at all.** This
is the exact shape that has already cost this project three rounds of red CI: a `packages/db` change
that breaks a sibling package's fixtures, which a per-task review of the `packages/db` diff and a
typecheck scoped to the changed package both miss.

- [x] **Step 2: Split the work by package** — `packages/db` finished 2026-09-17 (its table files, then its binary column); `packages/catalogue` finished 2026-09-17; `packages/payments` finished 2026-09-18; `packages/fiscal-verifactu` finished 2026-09-18; `packages/identity` finished 2026-09-18; `packages/workforce` finished 2026-09-18; `packages/workforce-es` finished 2026-09-18; `packages/bookings` finished 2026-09-18; `packages/scheduler` finished 2026-09-18; `packages/venue-service` finished 2026-09-18; `packages/credentials` finished 2026-09-18; `packages/media` finished 2026-09-18. The list is complete — `purchasing` and `reporting` are on it but have no `pgTable(` and no `drizzle-orm/pg-core` import in `src`, re-checked 2026-09-18.

One pull request per package, in this order, so a conflict is confined: `packages/db`, then `catalogue`, `payments`, `fiscal-verifactu`, `identity`, `workforce`, `workforce-es`, `bookings`, `scheduler`, `venue-service`, `credentials`, `media`, `purchasing`, `reporting`.

**`packages/db` took TWO pull requests, and the second one was the binary column.** The first
converted all 33 of its table files with no behaviour change of any kind; the `print_jobs.payload`
column kept its local `bytea` custom type until the second. The reason is the measured blast
radius, which is wider than the bullet list further up this step claims: on 2026-09-17,
`grep -rn "\.payload" packages/printing/src apps/server/src packages/db/src` found the column read
in `apps/server/src/receipt-print.test.ts` (about twenty sites), `till-api.reprint.test.ts`,
`till-api.pg.test.ts`, `working-order.test.ts`, `working-order.pg.test.ts` and `print-api.test.ts`
as well as the five files the bullets name, plus `apps/server/src/till-api.receipt.test.ts` and
`apps/server/src/kitchen-print.test.ts`, which the first write-up of this list missed. Thirteen
files read that column, not the five the bullets name. Putting all of that beside a 33-file
mechanical conversion would bury it. Neither of the two late additions breaks under the conversion
— `decodeTicket` in `apps/server/src/testing/decode-ticket.ts` accepts either type — so the
conclusion does not move; the list does.

_Corrected 2026-09-17, and the correction is the more useful half._ The paragraph above first said
that `receipt-print.test.ts:755-756`, which compares the read-back value against `Buffer.from(...)`
through `toContainEqual`, is a behaviour assertion that flips. It does not flip, and that was a
claim made by reading. Run instead:

```
expect([new Uint8Array(bytes)]).toContainEqual(Buffer.from(bytes));   // passes
expect([Buffer.from(bytes)]).toContainEqual(Buffer.from(bytes));      // passes — the control
expect(() => expect([new Uint8Array([1, 2])]).toContainEqual(Buffer.from(bytes))).toThrow();
```

All three pass, so that matcher does not distinguish the two types while still rejecting different
bytes. `toEqual` is a different story and worth knowing for the second pull request: measured the
same day, `expect(new Uint8Array(bytes)).toEqual(Buffer.from(bytes))` DOES throw, with a
Buffer-against-Buffer control passing. No payload site uses it today.

What DOES change is narrower and worth knowing before the second pull request:
`Buffer.isBuffer(...)` at `packages/db/src/schema/printing.test.ts:244` flips from true to false —
a failure, so it cannot be missed — and `.toString("utf8")` on the line below it stops decoding.
Measured the same day: `Buffer.from("Hello").toString("utf8")` is `"Hello"`, while
`new Uint8Array(Buffer.from("Hello")).toString("utf8")` is `"72,101,108,108,111"`, because
`Uint8Array`'s `toString` ignores the argument. That one is a silently wrong answer rather than a
red test, which is the reason the column is being converted on its own.

_What the binary pull request actually cost, recorded 2026-09-17 after it was built._ The column
moved onto the `binary` helper, the local `bytea` block in `print-jobs.ts` went, and the hand
conversion in `outbox.ts` went with it. The readers cost SIX signature retypes, not thirteen file
edits: `jobRow` in `packages/printing/src/outbox.test.ts`, `printJobsFor` in
`apps/server/src/kitchen-print.test.ts`, `receipt-print.test.ts` and `till-api.receipt.test.ts`,
`printJobPayloads` in `till-sale-integrated.pg.test.ts`, and `jobRows` in `working-order.test.ts`.
Every other reader either wrapped the value already — in `new Uint8Array(...)`, `Buffer.from(...)`
or `decodeTicket`, all of which accept either type — or passed it somewhere that takes either, as
`resendPrintJob` does when it hands `job.payload` back to `enqueuePrintJob`
(`packages/printing/src/outbox.ts`). That second case was the Codex reviewer's correction to a
first write-up that said all of them wrapped. `pnpm -r typecheck` is what found the list: it
exited 2 on the first of them and 0 once all six were done, so the set is measured rather than
grepped — with the limit that a typecheck sees a SIGNATURE, not a matcher. The matchers were
measured separately, above: `toContainEqual` cannot tell the two types apart and `toEqual` can, and
neither is a type error. The two assertions in `packages/db/src/schema/printing.test.ts` were rewritten first, as
the failing test: `Buffer.isBuffer(...)` now expects `false` (it is the DISCRIMINATING assertion —
a Buffer IS a Uint8Array, so `instanceof` would hold either way), and the decode moved to
`TextDecoder`. Watched red (`expected true to be false`) before the column changed.

**One of those bullets is WRONG, and the correction matters for the second pull request.** The
bullet says converting the column deletes `new Uint8Array(job.payload)` at
`packages/printing/src/runtime.ts:291`. It does not. That value never passes through drizzle's
column mapping: `runtime.ts` reads the row with a raw SQL query through `tx.execute`, and
`ClaimedJob.payload` is hand-declared as `Buffer` in that file. A raw query is mapped by the
driver, not by the column, so that path keeps receiving a node `Buffer` whatever the column
declares, and both the conversion and the three comment lines above it stay.

The decisive premise there is that drizzle's `execute` does not apply a column's `fromDriver`, and
that is a statement about another part of the system, so it was RUN rather than read. Against real
PostgreSQL on 2026-09-17, one physical `print_jobs` row was read twice — once through
`.select({ payload: … })` on a table object declaring `payload` with the vocabulary's `binary`
helper, and once through `tx.execute` with raw SQL — and the probe printed:

```
BUILDER: Uint8Array isBuffer=false | RAW: Buffer isBuffer=true
```

with an assertion that both reads carried the same bytes, which passed. That last part is the
control: it is what makes the difference a difference of mapping rather than of data. Run against
the column as it stood then, with its local `bytea` that declares no `fromDriver`, the same probe
prints `Buffer` on both sides — which is why the experiment has to use a `binary` column to mean
anything.

_Dated note, 2026-09-17, later the same day:_ that last sentence describes the local `bytea` P1b's
THIRD pull request deleted. On today's tree `print_jobs.payload` IS a `binary` column, so the
builder side of the probe already reads `Uint8Array` and only the raw-SQL side reads `Buffer`.

- [x] **Step 3: For each package, convert every table file** — done 2026-09-18 with `packages/media`, the last package on step 2's list with anything to convert.

Replace `pgTable` with `table`, and each column builder with its vocabulary equivalent. Leave `check()`, `index()`, `unique()`, `foreignKey()` and `primaryKey()` imports coming from `drizzle-orm/pg-core` — the vocabulary covers columns and the table builder only.

Three things this step is not allowed to do mechanically, each from the P1a findings above: a
`timestamp` keeps the mode it already has, read off the line being replaced; a builder with no
vocabulary equivalent waits for the helper rather than borrowing a near-enough one; and
`registros_facturacion`'s `cuota_total` and `importe_total` stay as they are — they are `text`
because the fiscal fingerprint hashes the stored bytes, and `label()` is not a synonym for that.

**What the conversion could not hide, reported for `packages/db` as the spec asks.** Three carve-outs
survived a 33-file conversion, and each one is a thing the vocabulary cannot absorb rather than a
corner that was skipped. _A fourth kind was missed here and found when `packages/catalogue` was
converted: an ARRAY column, which this package has three of. The catalogue report below carries it._

- **Every `pgEnum` column and declaration** — 23 declarations and 24 columns across this package.
  `enumText` emits `text`, so pointing it at a database enum is a real schema change; P1a measured
  that on `ticket_items.state`. The files that declare one keep importing `pgEnum` from
  `drizzle-orm/pg-core`, which is also why the step 5 guard can never prove "fully converted".
- **Every existing `check()`-backed text column** — all eight became plain `label()` columns beside
  their untouched constraints, rather than `enumText` plus `enumCheck`. **Two different reasons, and
  the first one covers only three of the eight.** `enumCheck` joins its values with `", "`, so on a
  constraint written without those spaces the substitution changes the DDL: measured 2026-09-17 by
  making it on `option_groups.type` and running the step 4 probe, which generated a migration
  dropping and re-adding `option_groups_type_ck` with `in ('text', 'extras', 'options')` for
  `in ('text','extras','options')` — and nothing else. `products.pricing_unit` and
  `products.vat_class` are written the same way. The other five — `deployment.mode`,
  `deployment.singleton_role`, `incidents.severity`, `print_jobs.kind` and `invoice_series.purpose`
  — already carry the spacing `enumCheck` emits, so substituting there would be schema-silent; they
  were left alone because rewriting a constraint was outside this conversion's scope, which is a
  scope decision and not a measurement. `incidents.severity` also brands its type as the exported
  `IncidentSeverity`, which `enumText` would replace with a union derived from the values array.
  Consequence: `drawer_opens` is the only table in this package using `enumText`/`enumCheck`, and
  that pair is for NEW columns. Both reasons are written beside the helper in `columns.ts` so the
  next package's converter does not re-derive them.
- **The binary column**, for the reason the two paragraphs above step 3 give.

The one thing a reader should NOT conclude from a silent probe: the probe is blind to a timestamp's
mode and to a caller-facing type, so it is the typechecker and the package's own suite that carried
those. Both were run: `pnpm -r typecheck` exited 0 for the whole workspace, and
`pnpm --filter @waitron/db test:coverage` exited 0 with 615 tests.

**And the same report for `packages/catalogue`, which is a much shorter one.** Its four table files
hold 52 columns between them — 6 in `categories.ts`, 22 in `menu.ts`, 9 in `units.ts`, 15 in
`variants.ts` — and every column BUILDER had a vocabulary equivalent, so none is left coming from
`drizzle-orm/pg-core`: the files used `uuid`, `text`, `jsonb`, `integer`, `boolean` and
`numeric(12, 2)` and nothing else. There is no `pgEnum` in the package at all, and no timestamp,
date, time, smallint, bigint or binary column — which is why the `ts`/`tsString` trap has no surface
here, read off the diff rather than assumed.

Two things the conversion did NOT absorb, and the second one is the more useful.

The first is the check-constraint carve-out: `units.hardware_unit` became a plain `label()` beside
its untouched `check(... in ('kg', 'g', 'mg'))`. That constraint is written WITH the `", "` spacing
`enumCheck` emits, so this is the SECOND of the two reasons `columns.ts` records, not the first —
substituting would have been schema-silent, which the run-it reviewer established by making the
substitution and running the step 4 probe over it (`No schema changes, nothing to migrate`, exit 0,
silent diff). _An earlier draft of this paragraph claimed the opposite — that the spacing was absent
and the reason therefore measured. It was written without re-reading the constraint, and three
reviewers caught it; the quoted constraint two lines above it already showed the spacing._ There IS
a second reason, and it is a measurement rather than a scope decision: `enumText` narrows what a
caller may WRITE. Measured 2026-09-17 with `tsc --noEmit` over two probe tables declared one each
way, the `enumText` column refused a `string | null | undefined` with `Type 'string' is not
assignable to type '"g" | "kg" | "mg" | null | undefined'` while the `label()` control compiled.
That is caller-facing and the probe is blind to it.

_Superseded 2026-09-18 as to its CONDITION, by the `packages/fiscal-verifactu` report further down
this step: whether `enumText` narrows depends on the COLUMN as well as the spelling — `as const`
narrows in every case, a bare array literal narrows on a NOT NULL column and loses it on a nullable
one, and a variable holding the array never narrows. (And that reading is itself dated: the `const`
type parameter taken later the same day left only the UNANNOTATED-variable case wide.) The fact this
paragraph rests on — that the pair is not a free substitution on an existing column — stands._

The second is the ARRAY column. `content_languages.languages` is `label("languages").array()`, and
`.array()` is a drizzle call reached OFF the helper — the vocabulary has no array helper and its
bodies cannot redirect one. This is not a catalogue peculiarity. `grep -rn "\.array()" packages/*/src`
on 2026-09-17, skipping tests, returns five columns in all: this one, three in `packages/db`
(`join-requests.decoy_numbers`, `sales.invoice_locales`, `tenants.invoice_locales`) — whose own
report above does not mention them either — and one still unconverted in `packages/media`
(`images.labels`), which the converter of that package will meet. _Dated note, 2026-09-18: it has.
P1b's fourteenth pull request converted it to `label("labels").array()`, so all five array columns
in the tree are now written that way. `grep -rn "\.array()" packages apps --include="*.ts"` returns
exactly five lines and nothing else; four of them show `label(...).array()` whole, and media's shows
`.array()` alone, because prettier breaks that chain and leaves `label("labels")` on the line
above._ The spec gives arrays their own row in the flip table
(`2026-09-16-sqlite-slice1-storage-swap-design.md` — array becomes text holding JSON), so F1 has to
handle them whatever the vocabulary does, and no conversion pull request in this rollout can claim
to have absorbed them.

Verified three ways on 2026-09-17, each with a control: the step 4 probe ran silent at exit 0 with
`No schema changes, nothing to migrate`, and pointing `units.precision` at `smallCount` instead made
the same command write `0002_probe.sql` and add a journal entry, so the silent run means something;
a column-by-column comparison of every builder call against the file at the BASE commit, mapping each helper
back to the drizzle call it emits, reported 0 mismatches across all 52 columns and reported exactly
that one column under the same mutation; and a line-by-line comparison of everything that is NOT a
column — 235 lines of `check()` bodies, indexes, uniques, foreign keys, primary keys and comments —
found them identical. _The first run of that comparison reported 38 columns, not 52: it keyed each
column by name and field alone, so where two tables in one file both declare `menu_id` or
`display_order`, the later declaration silently replaced the earlier and 14 columns were never
compared at all. Keying by table as well is what produced the 52. The lesson is the plainer one: a
checker that reports a total is itself a claim, and a total nobody cross-checked against the probe's
own per-table counts — which printed 52 all along — is where this one hid._ Behaviour, which no
probe can reach, was carried by `pnpm -r typecheck` (exit 0 for the whole workspace) and
`pnpm --filter @waitron/catalogue test:coverage` (exit 0, 29 files, 492 tests, no test edited).

**And the same report for `packages/payments`.** Its five table files hold 41 columns — 8 in
`card-readers.ts`, 2 in `device-card-readers.ts`, 5 in `payment-policy.ts`, 8 in
`payment-refunds.ts`, 18 in `payments.ts` — and the builders they used were `uuid`, `text`,
`boolean`, `integer`, the two-decimal `numeric` and `timestamp` in STRING mode, every one of which
has a helper. All ten timestamp columns in the package are string mode, read off each line being
replaced: over the five files at the base commit `grep -c 'mode: "string"'` returns 10 (3 + 0 + 2 +
1 + 4, in the order this paragraph lists the files) and `grep -c 'mode: "date"'` returns 0, and the
converted files hold exactly 10 `tsString` calls and no `ts` call at all. There is no array column
(`grep -rn '\.array()' packages/payments/src --include='*.ts'` exits 1), and no `date`, `time`,
`smallint`, `bigint` or `bytea` column on either side of the diff.

Two things the conversion did not absorb.

The first is the two `pgEnum` columns — `payments.state` (`payment_state`, ten values) and
`payment_refunds.state` (`payment_refund_state`, two). `enumText` emits `text`, so pointing it at a
database enum is a real schema change; both files keep importing `pgEnum` from
`drizzle-orm/pg-core`, which is again why the step 5 guard can never prove a package "fully
converted".

The second is the check-constraint carve-out. `payment_policy.offline_mode` and
`payments.card_entry_mode` both became plain `label()` columns beside untouched constraints, and
both fall under reasons `columns.ts` already records. Not one each: the caller-facing narrowing
reason applies to BOTH — `packages/payments/src/store.ts:27` and `:320` type `cardEntryMode` as
`string | null` — and `card_entry_mode` is refused by the DDL-spacing reason on top of it, which is
the measured, decisive one. `offline_mode` is refused by the narrowing reason alone, its constraint
already carrying `enumCheck`'s spacing.

- `payment_policy_offline_mode_ck` is `${t.offlineMode} in ('accept_offline', 'cash_only')`, quoted
  from the file. It carries the `", "` spacing `enumCheck` emits, so substituting there would be
  schema-silent, and the reason for leaving it is the caller-facing one #397 measured: `enumText`
  narrows what a caller may WRITE. _Read that with the 2026-09-18 correction further down this step,
  and with the `const` type parameter taken later that day, which left the values' ORIGIN as the
  whole condition: written inline they narrow, and held in an UNANNOTATED variable they do not —
  `as const` or a `("a" | "b")[]` annotation on that declaration narrows. A converter still has to
  take a control that actually reaches the column before reporting it either way._
- `payments_card_entry_mode_ck` is
  `${t.cardEntryMode} is null or ${t.cardEntryMode} in ('contactless','chip','swipe','unknown')`,
  also quoted from the file. Its values are written WITHOUT the `", "` spacing, so this is the
  first of the two reasons — substituting changes the DDL, exactly as measured on
  `option_groups.type` in #397.

_A claim this report first made and both reviewers falsified, kept because the correction is the
useful part._ It said `enumCheck` could not express `payments_card_entry_mode_ck` **at all** — that
its body returns only the `in (…)` fragment, "no null arm, and no way to add one", making this the
first constraint in the rollout the pair was structurally unable to produce. That is wrong, and it
was written by reading `enumCheck`'s body rather than by composing it. The null arm is written
AROUND the helper, and the composition is sound: rendered 2026-09-18 through `PgDialect.sqlToQuery`
— the call drizzle-kit itself makes on a check constraint — `sql\`${col} is null or
${enumCheck(col)}\`` produces `"…"."card_entry_mode" is null or "…"."card_entry_mode" in
('contactless', 'chip', 'swipe', 'unknown')` with `params: []`, the bare helper rendering the same
fragment without the null arm as the control. The empty parameter list is the part worth keeping:
`.inlineParams()` survives the nesting, so the values stay literals instead of becoming bind
parameters. The run-it reviewer went further and executed all three forms against PGlite — original,
bare and composed — and every one accepted null and the four permitted modes and rejected an invalid
value with `23514`. **So a nullable column is not a reason the pair cannot be used, and this package
met no shape the earlier reports had not.**

Verified on 2026-09-18, each with a control. The step 4 probe was run BEFORE any edit as a baseline
(silent, `No schema changes, nothing to migrate`, exit 0) and after (the same, `diff -r` silent),
and the NEGATIVE CONTROL was taken in the same worktree before converting anything:
`offline_amount_cap` moved from scale 2 to scale 3 made the same command write `0002_probe.sql` and
add a journal entry, so the silent runs mean something. A column-by-column comparison against the
base commit, built on drizzle's own `getTableConfig` rather than on text — comparing SQL type,
`columnType`, nullability, primary key, defaults, enum values, uniqueness and the read mapping,
keyed by TABLE as well as column name — reported **41 columns, 0 mismatches**, cross-checked against
the probe's own per-table counts, which print 8/2/5/8/18 and sum to the same 41.

**That comparison was proved by a mutation the probe is blind to, which is the point of having it.**
`payments.settled_at` was moved from `tsString` to `ts` — the same SQL type, a different read
mapping. The comparison reported exactly that column, `PgTimestampString` → `PgTimestamp`, with the
read mapping going from the driver's string to a `Date`. The probe, run on the same mutated tree,
printed `No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`. So the
`ts`/`tsString` trap is invisible to the acceptance check this plan prescribes, measured here rather
than argued.

A line-by-line comparison then established the property the count above cannot: **every line this
branch changes in the five files is an import line, a column declaration, or the one `pgTable(` →
`table(` rename on each file's table-opening line; nothing else differs.** Every `pgEnum`
declaration, `check()` body, index, unique, foreign key, primary key and comment is identical on
both sides, with one stated normalisation — `pgTable(` is rewritten to `table(` before comparing,
that being the one rename the conversion makes outside the column lines.

_Stated as a property rather than as a line count on purpose, and the reason is a defect in the
first version of this paragraph._ It said "182 lines", and a reviewer counting a different way got
197. Both numbers were honest; neither was the point. Worse, the filter that produced 182 matched a
foreign-key block's closing line as though it were a column's continuation —
`}).onDelete("restrict"),` in six places, and the bare `}),` on the one foreign key declared without
an `onDelete` — so it removed all seven from BOTH sides and never compared them at all — the same
shape as #397's duplicate-key defect, a checker whose total quietly hides what it skipped. Re-run
with a filter that swallows only a column declaration's own continuation lines, the comparison
covers 189 lines and still reports them identical, and the seven foreign-key lines are now among
them. `CLAUDE.md` §7 says it directly: a count is a receipt that goes stale, so describe the
property.

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace, which is what covers
the sibling packages that read these tables) and `pnpm --filter @waitron/payments test:coverage`
(exit 0, 32 files, 414 tests, no test edited, all five schema files 100%).

**And the same report for `packages/fiscal-verifactu`.** Its six table files hold 67 columns across
seven tables — 5 in `acks.ts`, 5 in `cadenas.ts`, 3 in `envio-flujo.ts`, 11 in `envios.ts`, 33 in
`registros.ts` and 7 + 3 in `sif.ts` — and every builder they used had a helper: `uuid`, `text`,
`integer`, `date`, `jsonb`, `boolean` and `timestamp`. There is no `pgEnum` in the package, no array
column (`grep -rn '\.array()' packages/fiscal-verifactu/src` exits 1), and no `time`, `smallint`,
`bigint`, `bytea` or `numeric` column on either side of the diff.

**Every timestamp here is the BARE `{ withTimezone: true }` with no mode, so every one becomes
`ts`.** That is the spelling #394 measured as identical to `mode: "date"` — same `columnType`, same
SQL type, same read and write mapping — with `mode: "string"` as the negative control that separates
them. The converted files hold no `tsString` call at all.

**This is the first package in the rollout that deliberately keeps a column builder imported straight
from drizzle.** `registros_facturacion`'s `cuota_total` and `importe_total` stay `text(...)`, for the
reason the paragraphs above step 3 give, so `registros.ts` still carries
`import { check, index, text, uniqueIndex } from "drizzle-orm/pg-core"`. Step 5's guard predicate, as
drafted, would report that file as an offender: it flags any file containing `table(` that imports
`text` from `drizzle-orm/pg-core`. **The final pull request has to allow `text` IN THAT FILE — not the file, and not
`text` everywhere.** _Done 2026-09-18 in the final pull request, and the shipped guard differs from
the draft described here: it matches the import SPECIFIER rather than a `table(` call, and the
allowance is the single entry in `ALLOWED` in `scripts/column-vocabulary.test.ts`, scoped to `text`
exactly as this paragraph asks. A control at the end of that file proves that a different builder in
the same file is still reported._ A whole-file allowance would blind the guard to every other direct builder
import in the repository's most fiscally sensitive schema file: a `numeric("cuota_total")` added there
later would pass the guard that exists to catch exactly that. And dropping `text` from the predicate
would blind it everywhere, which #397's reviewer already measured (a draft without `text` passed a
file declaring `kind: text("kind")`).

Two things the conversion did not absorb, and this package met TWO shapes no earlier one had.

The first is the seven text columns carrying a hand-written `check()`. Five of them —
`acks.state`, `envios.estado`, `registros_facturacion`'s `tipo_registro`, `tipo_rectificativa` and
`entorno` — are the shape the rollout keeps meeting: their constraints already carry the `", "`
spacing `enumCheck` emits, so substituting is schema-silent (measured on `acks_state_ck` — the pair
substituted, the step 4 probe printed `No schema changes, nothing to migrate`, exit 0, `diff -r`
silent). **And here the caller-narrowing reason comes back negative for four of the five, with the
fifth being a column the typechecker cannot see at all.** All five narrowed to
`enumText(..., as const)` with their correct value sets left `pnpm -r typecheck` at exit 0. Two
controls say what that is worth, and they disagree with each other, which is the useful part:

- Narrowing `entorno` to `["production"] as const` while the code still writes `preproduction`
  failed with `TS2322` at `packages/fiscal-verifactu/src/registro-row.ts:145` and `:174` — the two
  `return {` object literals in `toRegistroRow`, whose value reaches
  `tx.insert(registrosFacturacion).values(row)` at `chain.ts:244`. So the three `registros.ts`
  columns are covered by a typed write and the green run means something for them.
- Narrowing `acks.state` and `envios.estado` together to `["nonsense"] as const` — a set the code
  never writes — gave exit 2 with four errors, but every one of them is about `envios.estado`
  (`submission-alerts.ts:28` and `:46`, plus the column's own `.default("pendiente")`). Narrowing
  `acks.state` ALONE to that same wrong set left `pnpm -r typecheck` at **exit 0**. `acks` rows are
  written only through raw SQL (`packages/fiscal-verifactu/src/acks.ts:71-80`, a `tx.execute`), so no
  typed write reaches that column and the typechecker cannot report a narrowing on it either way.

So: four columns measured caller-safe, one unmeasurable, and all five stay `label()` on the scope
decision alone — rewriting a constraint is outside this conversion. **The first version of this
paragraph claimed all five, "because the write path already hands each column its exact union".**
That was a conclusion the experiment did not carry, and the convention reviewer found it by tracing
each column's writers; `CLAUDE.md` §1's both-answers-look-alike, for the second time in this one
report.

The other two are shapes the rollout had not met, and they are NOT the same kind of reason — an
earlier draft of this paragraph filed both under "no value list can stand in for these at all",
which is false for the first of them:

- **A constraint written as an EQUALITY**, `registros_tipo_huella_ck` = `${t.tipoHuella} = '01'`,
  quoted from the file. A singleton list expresses exactly the same predicate: the run-it reviewer
  ran `(v = '01')` against `(v in ('01'))` in PGlite for `'01'`, `'02'`, `''` and NULL and got the
  same answer every time. **So this is the DDL reason the rollout already records, not a new kind of
  reason** — substituting `enumText("tipo_huella", ["01"])` plus `enumCheck` made the step 4 probe
  write `0002_probe.sql` containing exactly
  `ALTER TABLE "registros_facturacion" DROP CONSTRAINT "registros_tipo_huella_ck"` followed by an ADD
  with `CHECK (… in ('01'))`. What is new is only the shape the reason turned up in: a body that is
  not an `in (…)` list.
- **A constraint that is a PATTERN rather than a set**, `registros_huella_ck`'s
  `${t.huella} ~ '^[0-9A-F]{64}$'`. This one is read off `enumText`'s signature and NOT measured:
  the helper takes a list of values, and a 64-character hex pattern has no list to hand it. Stated
  as what the helper takes rather than as an impossibility proof — #398's correction is the reason
  for that care, and saying "not measured" out loud is the rest of it.

**An incomplete claim in `columns.ts` was found while taking that narrowing measurement, and it is
corrected in this pull request. It took THREE attempts to state, and the two failed attempts are the
useful part.** The paragraph beside `enumText` said flatly that the pair narrows what a caller may
write, citing #397's `tsc` run, with no condition at all.

Attempt one said the condition is `as const`. The run-it reviewer falsified it: an ordinary type
annotation and an explicit type argument narrow too. Attempt two said the condition is that the values
"keep their literal types", which is wrong in the UNSAFE direction — it tells a converter that a bare
array literal is not a narrowing form, when on a NOT NULL column it is. The scoped re-read of the fix
wave caught that, and the measurement below is the third taking.

Measured 2026-09-18 in the catalogue package, every spelling crossed with nullability in ONE file,
printing each column's INSERT type by assigning it to `never`, with a control
(`const control: number = "a string"`) that fired on every run:

```
                                     nullable column               .notNull() column
enumText(n, ["a", "b"])              string | null | undefined     "a" | "b"
enumText(n, ["a", "b"] as const)     "a" | "b" | null | undefined  "a" | "b"
enumText(n, VALUES)                  string | null | undefined     string
```

`VALUES` is a `const VALUES = ["a", "b"]` declared above the tables. So:

- `as const` is the only spelling that narrows in every case;
- a bare array literal narrows on a NOT NULL column and loses it on a nullable one;
- a variable holding the array never narrows, nullable or not.

_Dated note, 2026-09-18: the FIRST TWO of those three no longer hold, because the owner took the
`const` type parameter described at the end of this step. A bare array literal now narrows in both
nullabilities, so it no longer loses the narrowing on a nullable column (bullet two) and `as const`
at the call site is no longer the only spelling that works (bullet one). The third bullet is
untouched, and is the whole of the remaining trap — with one qualification it never stated: what
loses the values is an UNANNOTATED variable declaration, so a declaration written `as const`, or
annotated `("a" | "b")[]`, narrows. The table as it reads today, every cell pinned by a compile-time
case in `packages/db/src/schema/columns.test.ts`, is in `enumText`'s own note in
`packages/db/src/schema/columns.ts`; read that rather than this one, which is the reading taken
before the change._

**And the type parameter is not what widens.** On the builder itself, before a table wraps it,
`enumText(n, ["a", "b"])._.data` is already `"a" | "b"`. Attempt two's mechanism sentence — "`T` is
inferred as `string`" — was therefore false, and the convention reviewer who traced TypeScript's own
`isLiteralOfContextualType` and said `T` must narrow was right about that, while being wrong that the
whole correction was unnecessary. The widening happens later, on the nullable path.

**The two readings reconcile, and attempt two's "cannot be reconciled" was an impossibility asserted
where the missing variable was findable** — `CLAUDE.md` §1, in the correction of a correction, which
is exactly where that section says to expect it. #397's quoted message ends `| null | undefined`, so
its probe was on a NULLABLE column, and `units.hardware_unit` is nullable; the table above reproduces
that column's union exactly in the nullable/`as const` cell. Its probe used a narrowing spelling on a
nullable column and got the union. Nothing was ever wrong with the run — only with the sentence
written from it.

**What this costs a converter, and why it was worth three attempts.** Of the columns this note
governs, `acks.state` (`acks.ts:21`), `envios.estado` (`envios.ts:29`) and
`registros_facturacion.tipo_registro` (`registros.ts:41`) are `.notNull()`, as is
`payment_policy.offline_mode`. Under attempt two's rule a converter would write the values inline,
read "not a narrowing form", and conclude the substitution was caller-safe — changing the write type
on all four. The rule that survives is procedural rather than syntactic: **never conclude from the
spelling that a substitution is caller-safe.** Take a control that reaches the column, and if the
control passes, the typechecker cannot see that column and you have measured nothing.

The repository has ONE production `enumText` call, `drawer-opens.ts:44`, and it passes its values
`as const` — so no production column has ever lost its narrowing. (Counted 2026-09-18 with
`grep -rn "enumText(" packages apps scripts --include="*.ts"`: twelve calls, eleven of them probe
tables in `columns.test.ts`, four of those deliberately written without `as const` because they are
what pins the wide cells of the table.) What was wrong was
only the sentence — and this plan, `docs/backlog.md` and two sibling schema comments had inherited it.

A one-word change, a `const` type parameter (`<const T extends string>`), closes the bare-literal
nullable case but NOT the variable case, which stays `string` either way — measured by the re-read
seat. So it narrows the gap rather than removing it. It is not taken here, because this pull request
is a package conversion and that is a change to the shared vocabulary's types; it is written up in
`~/waitron-campaign/questions.md` for its own change.

_Dated note, 2026-09-18: the owner chose to take it, and it landed in its own pull request once the
P1b rollout was complete. Both halves of the paragraph above were reproduced on the tree before the
change: the bare-literal nullable cell was the ONLY one of the six that moved, and the two variable
cells read the same before and after. It is a type-level change and nothing else — `drizzle-kit
generate` reported "No schema changes, nothing to migrate", and the JavaScript `tsc` emits for
`columns.ts` is byte-for-byte identical with and without the `const`. What it retires above — the first two bullets under the table above, and the closing half of
the paragraph below them, "the widening happens later, on the nullable path", which is the path this
change removed. That paragraph's OTHER half, that the type parameter is not what widens, still
stands: in the surviving case an unannotated `const VALUES = ["a", "b"]` is already `string[]`
before `enumText` is called, so `T` has no literal types left to infer. The declaration is the
cause, the type parameter the carrier._

Verified on 2026-09-18, each with a control. The step 4 probe was run BEFORE any edit as a baseline
(`No schema changes, nothing to migrate`, exit 0, `diff -r` silent) and again after (the same), and
the NEGATIVE CONTROL was taken in the same worktree before converting anything: `tiempo_espera_seg`
moved from `integer` to `smallint` made the same command write `0002_probe.sql` and add a journal
entry. A column-by-column comparison against the base commit, built on drizzle's `getTableConfig` —
SQL type, `columnType`, nullability, primary key, defaults, enum values, uniqueness and the read
mapping, keyed by TABLE as well as column name — reported **67 columns, 0 mismatches**, cross-checked
against the probe's own per-table counts, which print 5/5/3/3/11/7/33 and sum to the same 67.

**That comparison was proved by a mutation the probe is blind to.** `registros_facturacion.creado_en`
was moved from `ts` to `tsString`: the comparison reported exactly that column,
`PgTimestamp` → `PgTimestampString`, with the read mapping going from a `Date` to the driver's
string, while the step 4 probe on the same mutated tree printed `No schema changes, nothing to
migrate` at exit 0 with a silent `diff -r`. The same blindness #398 measured, re-measured on the
table where it would matter most.

A line-by-line classification of the diff then established the property: **every changed line is an
import line, a column declaration or one of its continuation lines, the one `pgTable(` → `table(`
rename per table, or the carve-out comment this change adds to `registros.ts`.** No `check()` body,
index, unique index, foreign key, primary key or existing comment differs. Proved by mutation, in the
other direction: changing `acks_state_ck`'s spacing and reversing `envios_drenaje_idx`'s column order
made the classifier report exactly those four lines as unclassified. Two lines it does report are
that same property and not an exception — `.notNull()` and `.defaultNow()` in `envios.ts` stopped
being separate lines because `ts("proximo_intento_en")` is short enough for prettier to fit the whole
declaration on one.

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace) and
`pnpm --filter @waitron/fiscal-verifactu test:coverage` (exit 0, 42 files, 403 tests, no test edited,
including `inmutabilidad` and `monetary-columns`). The root guard project was run too, because this
change touches `packages/db`: `npx vitest run` at the root, 42 files, 3036 tests, exit 0. One
per-file coverage row is worth naming so nobody reads it as new: `src/schema/acks.ts` sits at 77.27%
statements (17 of 22, from the package's own `coverage-summary.json`), its extra-config callback
uncovered on lines 25-29. Two explanations for that were offered and both were wrong. It is not the
missing `/* v8 ignore */` marker, because `envio-flujo.ts` carries none either and reads 100%. It is
not that something walks one table's metadata and not the other's, because `registros.ts:120-125`
records with its receipt that NO extra-config callback runs inside this package's test process. What
is left is line layout: `acks.ts` writes its callback body across lines 25-29, which v8 reports
separately, while `envio-flujo.ts` puts its whole callback on one line that also carries the counted
arrow expression. `acks.ts` had no markers at the base commit either
(`git show HEAD:…/acks.ts | grep -c "v8 ignore"` returns 0), so the row is not new; adding markers was
left out of this conversion's scope.

**And the same report for `packages/identity`, which met no new shape and one new ANSWER.** Its
eight table files declare nine tables holding 67 columns — 7 in `google-oidc-states.ts`, 11 in
`management-account-actions.ts`, 5 in `management-sessions.ts`, 17 in `persons.ts`, 5 in
`recovery-codes.ts`, 5 in `sessions.ts`, 5 in `totp-enrollments.ts` and 12 across `webauthn.ts`'s
two tables. The column builders they used were `uuid`, `text`, `timestamp` in string mode, `integer` and
`bigint` in number mode, every one of which has a vocabulary equivalent. `persons.ts` also declares
two `pgEnum` columns, which have no equivalent and are the first of the two things this conversion
did not absorb, below.

Two separate readings of the base tree, both run rather than assumed, and the base commit is named
because `HEAD` stops meaning the base tree the moment this lands. First, the builders that are
ABSENT: `git grep -c '\b<builder>(' 2661178c -- packages/identity/src/schema` returns nothing for
`date`, `time`, `smallint`, `numeric`, `jsonb`, `boolean` or `bytea`, and
`git grep -n '\.array()' 2661178c -- packages/identity/src` exits 1, so there is no array
column either. Second,
the one builder that is PRESENT and easy to miss: the same command returns a single hit for
`bigint`, in `webauthn.ts`.

All nineteen timestamp columns are string mode, read off each line being replaced: over the eight
files at the base commit `grep -c 'mode: "string"'` returns 19 (1 + 4 + 3 + 3 + 2 + 2 + 2 + 2, in
the order this paragraph lists the files) and `grep -c 'mode: "date"'` returns 0, and the converted
files hold exactly 19 `tsString` calls and no bare `ts(` call at all. The one `bigint` is
`webauthn_credentials.counter` in `{ mode: "number" }`, which is what `bigCount` emits.

Two things the conversion did not absorb, and the second one is where this package differs from
every earlier one.

The first is the two `pgEnum` columns, `persons.role` and `persons.status`, on the `person_role` and
`person_status` types declared in the same file. `enumText` emits `text`, so pointing it at a
database enum is a real schema change; `persons.ts` keeps importing `pgEnum` from
`drizzle-orm/pg-core`.

The second is the two checked text columns — `google_oidc_states.mode` beside
`google_oidc_states_mode_ck`, and `management_account_actions.purpose` beside
`management_account_actions_purpose_ck`. Both became plain `label()` columns beside untouched
constraints, and **neither of the two reasons `columns.ts` records refuses the substitution here.**
Scope alone is not a new reason — `columns.ts` already records it for five `packages/db` columns.
What is new is that this is the first package where both reasons were MEASURED away for every
checked text column it has, so scope is all that is left: rewriting an existing constraint is
outside a conversion pull request.

- **The DDL-spacing reason does not apply**, and it was measured rather than read off the spacing.
  The substitution was made in full — both columns moved to `enumText` with their real value sets
  and both constraint bodies replaced by `enumCheck(t.<column>)` — and the step 4 probe over that
  tree printed `No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`. So the
  generated text is unchanged, and the tree was then restored from a saved copy.
- **No CURRENT caller of either column would break**, measured with a control that fired FIRST.
  That is the checkable sentence, and it is narrower than "the narrowing reason does not apply":
  both columns are `.notNull()`, and on a NOT NULL column a bare value list DOES narrow the insert
  type, so the narrowing itself still happens. (That property was measured on the
  `packages/fiscal-verifactu` branch, whose `columns.ts` note carries the full spelling-by-
  nullability table; until that pull request lands, this sentence is the only statement of it on
  `main`.) _Dated note, 2026-09-18: the conclusion stands, its REASON is retired. The `const` type
  parameter taken later that day made a bare value list narrow whatever the nullability, so
  `.notNull()` is no longer what does it, and the table in `columns.ts` is now keyed on where the
  values come from rather than on the column._ What was measured HERE is only that nothing in the tree today writes either column
  through a wider type. Narrowing
  each column to a set the code does not write — `mode` to `["login"]`, dropping `link`, and
  `purpose` to `["invitation", "password_reset"]`, dropping `email_change` — made
  `pnpm -r typecheck` exit 2 naming four call sites: `src/google-oidc.ts(49,37)` for the first and
  `src/account-action.ts(91,9)`, `(108,6)` and `(155,9)` for the second. That is the control, and it
  is what makes the next line mean anything: with the real value sets in place the same command
  exited 0 across the whole workspace, so no caller of either column would break.

**Each of those two columns now carries a short comment saying so, which is why the line
classification below has an exception.** Both merged sibling conversions do the same —
`units.hardware_unit` in `packages/catalogue` and `payment_policy.offline_mode` and
`payments.card_entry_mode` in `packages/payments` each carry three or four lines above the column
naming the reason. The first version of this pull request left both columns bare, and the
convention reviewer's point was that the reason matters MORE here than in the siblings: there,
a reader can look up one of the two recorded reasons; here neither applies, so without the comment
the only record is this plan.

`packages/db/src/schema/columns.ts` is edited here, and the first version of this pull request
argued for leaving it alone. That argument was wrong and the review said so. The sentence there
names `google-oidc-states.ts` as "still unconverted on that date", and the date in it is
2026-09-18 — the same date the same paragraph uses two names earlier to mean CONVERTED. A reading
at that granularity cannot separate the two, so the sentence tells a reader something untrue about
a file this change converts.

**What that costs, priced properly rather than waved through.** The parked
`packages/fiscal-verifactu` pull request (#399) touches three of the files this one does —
`packages/db/src/schema/columns.ts`, `docs/backlog.md` and this plan — and in the backlog the two
branches replace the SAME sentence. So this is a three-file conflict for whoever rebases #399, not
a one-line one. It is still the cheaper side: #399 rewrites those `columns.ts` lines KEEPING
identity in the unconverted list, so `main` would carry the untrue sentence whichever order the two
land in, and a conflict a person resolves once beats a false claim nobody notices.

**The rollout order was departed from, and neither list says so.** Step 2 above orders the packages
`… payments, fiscal-verifactu, identity, …`, and `fiscal-verifactu` was converted but PARKED as an
open pull request rather than landed, because it edits the column declarations of the immutable
`registros_facturacion`. Identity was taken next rather than waiting on a person. Nothing about the
two packages is coupled in CODE — a conversion adds no migration and the two touch no schema file
in common — so the departure costs nothing at the database. What it does cost is the three-file
prose conflict priced in the paragraph above.

Verified on 2026-09-18, each with a control. The step 4 probe was run BEFORE any edit as a baseline
(silent, `No schema changes, nothing to migrate`, exit 0, `diff -r` silent) and after (the same),
and the NEGATIVE CONTROL was taken in the same worktree between them: moving
`management_account_actions.code_attempts` from `integer` to `smallint` made the same command write
`0002_probe.sql` and add a journal entry. A column-by-column comparison against the base commit,
built on drizzle's own `getTableConfig` — comparing SQL type, `columnType`, nullability, primary
key, defaults, enum values, uniqueness and the read mapping, keyed by TABLE as well as column name —
reported **67 columns, 0 mismatches**, cross-checked against the probe's own per-table counts, which
print 7/11/5/17/5/5/5/4/8 and sum to the same 67. It was proved by a mutation the probe is blind to:
`sessions.ended_at` moved from `tsString` to `ts`, which the comparison named
(`PgTimestampString` → `PgTimestamp`, the read mapping going from the driver's string to a `Date`)
while the probe, run on the same mutated tree, printed `No schema changes, nothing to migrate` with
a silent `diff -r`.

A line classification then established the property the counts cannot: **every line this branch
changes in the eight files is an import line, a column declaration or one of its continuation lines,
or the one `pgTable(` → `table(` rename on each table-opening line, or one of the two new comments
described above.** Everything else — every other comment, `check()` body, index, unique, foreign
key and blank line — is byte-identical on both sides, and the count of column DECLARATIONS is 67 on
both sides even though the conversion shortens multi-line declarations onto one line. Proved by
mutation twice over: removing the `", "` spacing from `google_oidc_states_mode_ck`'s body and
reversing the column order of `management_account_actions_person_idx` were both reported, and both
files were then restored from saved copies rather than with `git checkout`.

_Stated as a property because the first version of this paragraph stated it as a count, and the
count was wrong in the way the `packages/payments` report directly above predicts._ It said "the 266
lines that are none of those are byte-identical". The comparator's bucket does hold 266 lines, but
9 of them are the table-opening lines, which the comparator NORMALISES (`pgTable(` rewritten to
`table(`) before comparing — so they are not byte-identical, and a reader re-counting gets 257. The
run-it reviewer reached 257 by parsing the files with TypeScript's own syntax tree, the convention
reviewer reached it by classifying lines by hand, and the fix-wave reader reached it a third way,
which is why the property rather than the comparator is what this paragraph now states. The
comparator itself is a scratch script and is not in the tree; the two mutations that prove it were
run BEFORE the two carve-out comments were added, and it was re-run afterwards, reporting those two
comment blocks and nothing else.

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace) and
`pnpm --filter @waitron/identity test:coverage` (exit 0, 28 files, 228 tests, no test edited). The
package's `src/schema` folder reads 80.65% statements after the conversion and 81.20% before it,
measured by stashing the eight files and re-running the same suite. That IS a fall, and the earlier
wording denying it was contradicted by the numbers beside it. What the measurement shows is that
nothing became uncovered: the same four files are partially covered before and after, for the same
reason (nothing in this package's tests walks those tables' extra-config callbacks), and the
percentage falls because the conversion deletes covered continuation lines from the denominator.
The whole package moves 94.99% to 94.97% the same way, and the thresholds (90/90/85/85) are met
either way.

**And the same report for `packages/workforce`, the first package in the rollout with no VALUE-SET
check constraint anywhere in it.** Its nine table files declare nine tables holding 86 columns — 10 in
`absences.ts`, 8 in `availability.ts`, 8 in `employments.ts`, 8 in `roster-versions.ts`, 9 in
`shift-swaps.ts`, 8 in `shift-templates.ts`, 10 in `shifts.ts`, 18 in `time-entries.ts` and 7 in
`workforce-chains.ts`. The column builders they used were `uuid`, `text`, `integer`, `smallint`,
`boolean`, `date`, the two-decimal `numeric` and `timestamp`, every one of which has a vocabulary
equivalent. There is no array column — `git grep -n '\.array()' 7ea9e9dd -- packages/workforce/src` exits 1 —
and no `time`, `bigint`, `jsonb` or `bytea` column on either side of the diff:
`for b in time bigint jsonb bytea; do git grep -c "\b$b(" 7ea9e9dd -- packages/workforce/src/schema;
done` exits 1 on every one of the four, printing nothing. The base commit is named rather than written `HEAD`, because `HEAD` stops meaning the base
tree the moment this lands.

**This package uses BOTH timestamp modes, so the mode really does have to be read off each line.**
It has sixteen timestamp columns; fifteen are string mode and one is not.
`workforce_chains.updated_at` is written `timestamp("updated_at", { withTimezone: true })` with no
mode at all, and drizzle's default for a timestamp is DATE mode, so it converts to `ts` while the
other fifteen convert to `tsString`. It is the second mixed-mode package, `packages/db` being the
first — its converted table files use both helpers, neither of them rarely. Both superlatives in
this report were checked against the PARKED `packages/fiscal-verifactu` conversion as well as the
landed ones, since that branch is converted even though it has not merged: it has value-set
constraints, so workforce is still the first package with none of those, and all twelve of its
timestamps are date mode, so it is uniform and workforce is still the second mixed one. _Stated as a property
because the count was wrong the first time: this sentence said 37 `tsString` and 21 `ts`, counted
with a glob that swept in `columns.test.ts`, which holds one call of each as a fixture. The run-it
reviewer re-counted with the test files excluded and got 36 and 20._

A package-wide assumption about the mode is what would get this wrong, and the step 4 probe could
not catch it: the `ts`/`tsString` pair emits the same SQL type. The parity comparison below is what
carries it, and the mutation that proves that comparison is exactly this substitution made in the
wrong place.

One thing the conversion did not absorb, and one carve-out that does not arise here at all.

The thing it did not absorb is the six `pgEnum` columns — `absences.kind` and `absences.status`, `shift_swaps.status`,
`roster_versions.status`, and `time_entries.entry_kind` and `time_entries.correction_status`, on six
enum types declared in the same four files. `enumText` emits `text`, so pointing it at a database
enum is a real schema change; those four files keep importing `pgEnum` from `drizzle-orm/pg-core`.

The carve-out that does not arise is **the enum-shaped checked text column**, which is new: not one
`check()` constraint in this package is a value set. The package DOES have two text columns whose own value a
`check()` constrains — `time_entries.entry_hash` beside a hex pattern and `shift_templates.label`
beside a `length(...) > 0` — and both stay bare `label()` with no comment, which is what
`packages/payments` and `packages/identity` already do with the same shape. What the package does
not have is the shape the `enumText`/`enumCheck` pair competes with.
_An earlier version of this report said "no checked text column at all", which is a wider sentence
than the experiment supports and than its own constraint list eight lines down; the convention
reviewer caught it._ `git grep -n ' in (' 7ea9e9dd -- packages/workforce/src/schema`
returns a single hit, and that hit is a line of prose in a comment in `shifts.ts`, not a constraint
body. The constraints are range checks
(`between 0 and 6`, `between -840 and 840`), ordering checks (`ends_on >= starts_on`), null-shape
checks of the `(a is null) = (b is null)` family, a `length(...) > 0`, two `date_trunc('second', …)`
whole-second checks and one hex pattern (`time_entries_entry_hash_ck`, `~ '^[0-9A-F]{64}$'`). None of
them is a shape `enumCheck` could produce, so no `enumText`/`enumCheck` decision was available to
make and none was made.

**This package holds a hash chain, and that is the reason this report says more than the arithmetic.**
`time_entries` is append-only and chained, `workforce_chains` is its head, and the chain is the
working-time record — a legal duty, and NOT reset by a cold restore the way the fiscal chain is
(`CLAUDE.md` §5). It is nevertheless not the FISCAL chain. That one is
`registros_facturacion` and its head `cadenas`, whose table definitions are in
`packages/fiscal-verifactu/src/schema/` — the package whose conversion was left open for the owner
rather than landed — while the fingerprint over them, `computeHuella`, is in `packages/verifactu`
(`packages/verifactu/src/huella.ts:99`), which is not on step 2's rollout list at all. _An earlier
version of this sentence put all five of the fiscal core's pieces in `packages/fiscal-verifactu`;
three of them are not there, and it was written by paraphrasing a rule rather than by following the
call chain._ The workforce chain is a separate, generic one in a different package again, and step
2's list above carries `workforce` with no carve-out. Two properties make the
conversion safe to land rather than park, and both are checkable rather than argued:

- **No column here is a number held as text.** That is the trap `packages/fiscal-verifactu` carries —
  `cuota_total` and `importe_total` are `text` because the fiscal fingerprint hashes the stored bytes,
  so `money()` would change what is hashed. Workforce's three text-typed hash columns
  (`time_entries.entry_hash`, `time_entries.prev_entry_hash`, `workforce_chains.last_entry_hash`) hold
  uppercase hex digests, and `label()` emits `text`, so they are text before and text after.
- **The digest does not read stored bytes at all.** `packages/workforce/src/chain-hash.ts` builds its
  canonical string from typed values, and hashes the two instants as epoch milliseconds —
  `["EventAtMs", String(Date.parse(input.eventAt))]` at `chain-hash.ts:109` and the matching
  `RecordedAtMs` at `:111`, with the comment on `eventAt` saying so. The parity comparison below shows
  no column's read mapping moved at all, and **the wrong mode on the hashed column is caught loudly
  rather than silently**: measured 2026-09-18 by making exactly that mistake, `event_at` pointed at
  `ts` instead of `tsString` fails 33 of the 47 tests in `chain.test.ts`, `clocking.test.ts` and
  `corrections.test.ts` with `TypeError: value.toISOString is not a function` — the date-mode write
  mapper handed a string. The control is the same three suites plus `index.test.ts` on the converted
  tree, 57 passing. So this is a measurement, not a claim of impossibility.

Verified on 2026-09-18, each with a control. The step 4 probe ran BEFORE any edit as a baseline
(`No schema changes, nothing to migrate`, exit 0, `diff -r` silent) and after the conversion (the
same), and the NEGATIVE CONTROL was taken in the same worktree between them: moving
`employments.contracted_minutes_per_week` from `integer` to `smallint` made the same command write
`0002_probe.sql` and add a journal entry. A column-by-column comparison against the base commit,
built on drizzle's own `getTableConfig` — comparing SQL type, `columnType`, nullability, primary key,
defaults, enum values, uniqueness and the read mapping, keyed by TABLE as well as column name —
reported **86 columns, 0 mismatches**, cross-checked against the probe's own per-table counts, which
print 10/8/8/8/9/8/10/18/7 and sum to the same 86. It was proved by a mutation the probe is blind to,
and the column chosen was the one that matters most here: `time_entries.event_at` moved from
`tsString` to `ts`. The comparison named it (`PgTimestampString` → `PgTimestamp`, the read mapping
going from the driver's string to a `Date`) while the probe, run on the same mutated tree, printed
`No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`. So on the one column the
chain hashes, the acceptance check this plan prescribes would not have noticed the wrong helper.

A line classification then established the property the counts cannot: **every line this branch
changes in the nine files is an import line, a column declaration or one of its continuation lines,
the one `pgTable(` → `table(` rename on each table-opening line, or one of the two comments the
review rewrote or added.** Everything else — every other comment, `pgEnum` declaration, `check()` body, index,
unique, foreign key, primary key and blank line — is byte-identical on both sides, with the one
stated normalisation that `pgTable(` is rewritten to `table(` before comparing. The count of column
DECLARATIONS is the same on both sides file by file (10/8/8/8/9/8/10/18/7, the third independent
reading of the same 86), even though the conversion shortens multi-line declarations onto one line.
Proved by mutation twice: respacing `employments_contracted_minutes_ck`'s body and reversing the
column order of `shifts_person_starts_idx` were each reported as an unclassified difference, and
each file was then restored from a saved copy rather than with `git checkout`. The classification was run again after
the review's comments were added, against the base commit rather than the branch tip, and reported
exactly those comment blocks and nothing else.

**The two comments are the review's doing, and each replaces something worse.** In
`time-entries.ts` the comment above `event_at` still explained the column in terms of
`mode: "string"`, which the conversion had just deleted from the line below it — a receipt that
outlived the code it described, which is this repository's dominant defect. It now names `tsString`.
In `workforce-chains.ts` the one date-mode column gained a comment saying so, because the gap there
is real and measured: swapping `updated_at` for `tsString` leaves the chain, clocking, corrections
and index suites at 57 passing, so nothing in the tree catches that mistake at all — nothing reads
or writes the column from JavaScript. The same swap on `event_at` fails 33 tests. That measurement
stays HERE and not in the comment, which carries only the invariant.

**Two MORE comments were added and then removed again, and the removal is the finding.** The first
fix wave put a line above `time_entries.entry_hash` and `shift_templates.label` — this package's two
text columns whose own value a `check()` constrains — saying they stay plain `label()` because the
check is a pattern or a length rather than a value set, on the reasoning that every earlier
conversion annotates a checked text column it leaves alone. The scoped re-read of that wave
falsified the reasoning: the earlier conversions annotate only VALUE-SET columns, and a text column
with a pattern or length check has been left bare all along — `payments.card_last4` is one
(`packages/payments/src/schema/payments.ts`, its `length(...) = 4` check in the same file), and
`packages/identity/src/schema/persons.ts` holds eight more. So the comments were not following a
convention, they were extending one to a new class in a single package while leaving the same shape
bare in two others. They went. What stayed is the narrowing of `columns.ts`'s own sentence, which
had claimed EVERY checked text column stays `label()` for one of the two reasons it records: it now
says value-set checks are the group, and names the pattern/length columns as the ones outside it
carrying no comment. _The first version of that narrowing also called `packages/workforce` "the
first package made entirely of those", which the same re-read falsified in three separate ways; a
correction is a new claim and this one was wrong on its first attempt._ The `columns.ts` edit is a
one-paragraph addition to the three-file conflict the identity conversion already priced for whoever
rebases the parked fiscal branch.

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace, which is what covers
the sibling packages that read these tables) and `pnpm --filter @waitron/workforce test:coverage`
(exit 0, 22 files, 303 tests, no test edited). That suite is where the chain's own behaviour is
checked — `chain.test.ts`, `chain.concurrency.test.ts`, `corrections.test.ts`, `immutability.test.ts`
and the real-PostgreSQL `restore-continuation.pg.test.ts` all ran unedited. The package's `src/schema`
folder reads 100% on every measure after the conversion, and the package as a whole 99.88% statements
/ 99.45% branches / 100% functions / 99.88% lines against thresholds of 90/90/85/85
(`packages/workforce/vitest.config.ts:44`).

**And the same report for `packages/workforce-es`.** One table file, one table, 20 columns —
`convenio_config`, the Spain-specific configuration surface that supplies the overtime rule and the
working-time guardrails as data. The builders it used were `uuid`, `integer`, `numeric` in two
shapes (`numeric(5, 2)` and `numeric(12, 2)` — the same scale, different precisions), `boolean` and
`timestamp` in string mode, every one of which has a vocabulary equivalent. _Two superlatives were cut from this
paragraph in review._ It is not "the smallest conversion in the rollout", and it is false in both
directions: four packages still unconverted are smaller, `packages/credentials` being one table of
six columns, and behind it P1b's third pull request (#396) converted a single column. And it is not
"the first in a country module" either: `packages/fiscal-verifactu` was converted first, in the
parked #399, and the repository's own prose calls that one Spain-specific too. "Country module" was
a coined phrase besides, and it collides with `CLAUDE.md` §3's country PACK, which is deliberately
not a module. The base
commit is named rather than written `HEAD`, because `HEAD` stops meaning the base tree the moment
this lands: `git grep -c "\b<builder>(" 034a701f -- packages/workforce-es/src/schema` returns
nothing for `date`, `time`, `smallint`, `bigint`, `jsonb`, `bytea` or `customType`, and
`git grep -n '\.array()' 034a701f -- packages/workforce-es/src` exits 1, so there is no array
column either. The package is exempt from the english-only guard, because `convenio` is a declared
Spanish labour token; `scripts/english-only.test.ts` pins the two vocabulary OWNERS as exactly
`workforce-es` and `fiscal-verifactu` — which is a narrower thing than "the Spanish-by-design
packages", the same file naming `verifactu`, `reporting`, `country-es` and `country-gb` as Spanish by
nature and unscanned. The exemption never comes into play here, since a conversion renames nothing.

**It is the first package in the rollout with no `text` column at all.** The same command
returns nothing for `text` at the base commit, and the converted file calls `label()` nowhere. What
that does NOT make it is the first package to escape the `enumText`/`enumCheck` question:
`packages/workforce`, directly above, escaped it too, and the paragraph here first claimed otherwise
while the paragraph above it said the opposite — a twin the convention reviewer caught. So this is
the second conversion in a row with no such decision to make, and the reason has moved rather than
repeated. Workforce has text columns but no VALUE-SET check over one; this package has no text
column for a check to constrain. Its one `check()` constraint is a range check
(`working_days_per_week between 1 and 7`).

The single timestamp column is string mode, read off the line being replaced: at the base commit
`grep -c 'mode: "string"'` over the file returns 1 and `grep -c 'mode: "date"'` returns 0, and the
converted file holds exactly one `tsString` call and no bare `ts(` call.

One thing the conversion did not absorb: the one `pgEnum` column, `convenio_config.overtime_model`,
on the `overtime_model` type declared in the same file. `enumText` emits `text`, so pointing it at a
database enum is a real schema change; the file keeps importing `pgEnum` from `drizzle-orm/pg-core`,
which is again why the step 5 guard can never prove a package "fully converted".

**The answer this package adds is about `rate()`, and it is an open question rather than a change.**
`night_premium_pct` is `numeric(5, 2)`, so `rate()` is its exact equivalent and the substitution is
silent in the schema, in the read mapping and in the caller-facing type — the comparison below covers
all three. What the conversion surfaced is that the tree says two different things about the column's UNIT and
no code settles which. Two comments say a fraction: the column's own ("plus de nocturnidad as a fraction (e.g. 0.25)") and
its paraphrase on `WorkTimeRuleset.nightPremiumPct` in `packages/workforce/src/ruleset.ts`. The
column's NAME says the opposite — `night_premium_pct` — and the 2026-07-22 workforce design writes it
"nocturnidad %" (`docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md`). And no
code arbitrates them: reading every site rather than counting them, `nightPremiumPct` is declared in
the schema and in that ruleset type, aliased and passed through by the resolver in
`packages/workforce-es/src/convenio.ts`, and given a value by three fixtures — the package's own
`convenio.test.ts` and `migrations.test.ts` and `packages/workforce/test/fixtures.ts`. No site
multiplies, divides or compares it. _The first version of this paragraph offered the package's own test as a third witness
for the fraction reading; it is not one._ `packages/workforce-es/src/convenio.test.ts` inserts a
value and expects the same one back, a round trip that passes whichever unit the column is in — §1's
measurement taken where both answers look alike.

Every other `rate()` COLUMN in the schema holds a percentage-style number: `vat_rate` in
`packages/db/src/schema/sales.ts` and `orders.ts`, whose fixtures write `"21.00"`, and `rate` and
`deductible_proportion` in `packages/db/src/schema/purchase-invoices.ts`, whose default is the
literal `"100.00"`. (The fifth `rate()` call in the tree is a fixture in
`packages/db/src/schema/columns.test.ts` holding no domain value — named because the workforce report
was corrected for letting exactly that file into a count.) The helper's own comment reads "A
percentage rate: two decimal places, e.g. a 21.00 VAT rate", so if this column is a fraction it is
the one site reading the helper differently. Nothing was changed in `columns.ts` for it, which is
one of the three files the parked `fiscal-verifactu` branch has to rebase over; what the column
gained instead is a short comment block saying its unit is undecided. _Priced honestly rather than
waved through:_ the comment itself costs #399 nothing, because that branch does not touch
`convenio-config.ts` — but this pull request still edits `docs/backlog.md` and this plan, two of the
same three files, so it adds to that conflict exactly as the identity and workforce conversions did.
The comment's SHAPE departs from the five sibling carve-out comments, which are `//` lines above the
column; this one is inside the column's existing `/** */`, so it is what a reader sees on hover. That
was chosen rather than overlooked: the sentence is about what the column MEANS, which is what the
rest of that block already carries, and splitting it across two comment styles would separate the two
halves of one statement.

**The question this leaves for the owner, and it comes before the rounding one.** Is
`night_premium_pct` a fraction or a percentage? Under the comments' reading a 25% premium is stored
`0.25`; under the name's it is `25.00`. Nothing in the code tells them apart, because nothing
computes with the value yet — which is also what makes it cheap to settle now and expensive once a
venue has written a row. Only if it is a FRACTION does the second question arise: two decimal places
on a fraction means the column can express a premium only in whole percentage points. Measured
2026-09-18 against PGlite, inserting `0.25`, `0.125` and `0.005` into a `numeric(5, 2)` column stores
`0.25`, `0.13` and `0.01`, so a 12.5% night premium would not be representable; read as a percentage,
`12.50` is exact and the question does not arise at all. Both the scale and the name are
pre-existing — the scale is in `packages/workforce-es/drizzle/0000_workforce-es_baseline.sql` — and
this conversion moves neither. Whether a night premium is ever a half-point figure is a question for
the labour advisor, which is the class of question the table's own header says it defers to a row
rather than to code.

**Resolved 2026-09-18 (owner): it is a PERCENTAGE** — `25.00` is 25%. The column NAME and the
2026-07-22 design were the correct witnesses; the two fraction comments are wrong and are corrected
in `packages/workforce-es/src/schema/convenio-config.ts` and `packages/workforce/src/ruleset.ts`. No
schema change follows: `numeric(5, 2)` holds `12.50` exactly, so the rounding worry above only ever
applied to the retired fraction reading.

Verified on 2026-09-18, each with a control. The step 4 probe ran BEFORE any edit as a baseline
(`1 tables / convenio_config 20 columns`, `No schema changes, nothing to migrate`, exit 0, `diff -r`
silent) and after the conversion (the same), and the NEGATIVE CONTROL was taken in the same worktree
between them: moving `working_days_per_week` from `integer` to `smallint` made the same command write
`0002_probe.sql` and add a journal entry. A column-by-column comparison against the base commit,
built on drizzle's own `getTableConfig` — comparing SQL type, `columnType`, nullability, primary key,
defaults, enum values, uniqueness and the read mapping, keyed by TABLE as well as column name —
reported **20 columns, 0 mismatches**, cross-checked against the probe's own per-table count, which
prints the same 20. It was proved by the mutation the probe is blind to: `created_at` moved from
`tsString` to `ts`, which the comparison named (`PgTimestampString` → `PgTimestamp`, the read mapping
going from the driver's string to a `Date`) while the probe, run on the same mutated tree, printed
`No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`.

A line classification then established the property the counts cannot: **every line this branch
changes is an import line, a column declaration or one of its continuation lines, or the one
`pgTable(` → `table(` rename on the table-opening line.** Everything else — every comment, the
`pgEnum` declaration, the `check()` body, the unique and the foreign key — is byte-identical on both
sides, with the one stated normalisation that `pgTable(` is rewritten to `table(` before comparing.
The count of column DECLARATIONS is 20 on both sides, the third independent reading of the same 20,
even though the conversion shortens the one multi-line declaration onto a single line. Proved by
mutation twice: respacing the `convenio_config_working_days_ck` body and changing the foreign key's
`onDelete("restrict")` to `cascade` were each reported as an unclassified difference, and the file
was restored from a saved copy rather than with `git checkout` between them. The second of those
mutations is worth naming, because the foreign-key line is exactly the class of line #398's first
comparator silently skipped.

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace, which is what covers
`packages/workforce` and the rest of the Spain lane's readers) and
`pnpm --filter @waitron/workforce-es test:coverage` (exit 0, 7 files, 27 tests, no test edited). The
package reads 100% on every measure against thresholds of 90/90/85/85
(`packages/workforce-es/vitest.config.ts`), and it read 100% before the conversion too — measured by
putting the base commit's file back and re-running the same suite. _The denominator DID move, and the
first version of this sentence said it had not._ Read off `coverage-summary.json` rather than off the
percentage: `convenio-config.ts` goes from 40 covered statements out of 40 to 38 out of 38, and the
package from 181 to 179, because the conversion collapses the one multi-line column declaration onto
a single line. That is the same mechanism as `packages/identity`'s fall; what differs is that nothing
here became partially covered, so the percentage stays at 100. The run-it reviewer had marked the
original sentence UNVERIFIED on the ground that equal percentages do not establish equal
denominators, which was right, and measuring it showed the claim was not merely unproven but
backwards.

**And the same report for `packages/bookings`, whose new answer is about the PROBE rather than the
package.** One table file, one table, 13 columns. The builders it used were `uuid`, `date`, `time`,
`integer`, `text` and `timestamp` in string mode, every one of which has a vocabulary equivalent. The
file still imports `pgEnum` from `drizzle-orm/pg-core` alongside `check`, `foreignKey` and `index`,
and `status` is still built from it — which is again why the step 5 guard can never prove a package
"fully converted". Its one timestamp column is string mode, read off the line being replaced: at the
base commit `git grep -c 'mode: "string"' 633086c1 -- packages/bookings/src/schema/bookings.ts`
reports a count of 1, and the same command for `mode: "date"` exits 1, and the converted file holds one
`tsString` call and no `ts` call. There is no array column and none of the six builders this package
never had: `git grep -nE '\.array\(\)|\b(numeric|jsonb|boolean|smallint|bigint|bytea)\(' 633086c1 --
packages/bookings/src` exits 1, and the same command over the converted tree exits 1 too; the path is
the whole of `src`, not the one table file, because the sentence is about the package. The base
commit is named rather than written `HEAD`, because `HEAD` stops meaning the base tree the moment
this lands — and it is PASSED to `git grep` rather than asserted beside a working-tree `grep`, which
is what the payments, identity and workforce-es reports above do. Theirs are true; the difference is
in the receipt's shape, not in the fact.

`booking_time` is worth one line: it is the second `timeOfDay` column in a TABLE FILE and the first
outside `packages/db` — `tenants.day_cutover` is the other. Two things that sentence is deliberately
not saying, both read on 2026-09-18: there is a third call in a test fixture
(`packages/db/src/schema/columns.test.ts`), and `packages/venue-service` still holds two unconverted
`time()` columns, so this is a count of a rollout in progress rather than of the repository's
eventual shape.

One thing the conversion did not absorb, and it is the one every package meets: the `status` column
is a database enum (`booking_status`, five values), so it stays. There was no `enumText`/`enumCheck`
decision available here at all, for the same reason as `packages/workforce`: the package has no
value-set check constraint anywhere in it. Its one `check()` is a range over an integer
(`bookings_party_size_ck`, `party_size > 0`), which neither helper has anything to say about.

**This is the first package in the rollout whose drizzle schema entry point is not
`./src/schema/index.ts`** — `packages/bookings/drizzle.config.ts` points `--schema` at
`./src/schema/bookings.ts` — so step 4's warning about that flag was exercised for the first time,
and measuring it corrected ONE CLAUSE of it. Step 4 said a pasted `--schema ./src/schema/index.ts`
makes drizzle-kit write nothing, "so the `diff -r` is silent and looks like a pass". Run in
`packages/bookings` on 2026-09-18 with the wrong path, drizzle-kit exits **1** and prints

```text
Error  No schema files found for path config ['./src/schema/index.ts']
Error  If path represents a file - please make sure to use .ts or other extension in the path
```

and the `diff -r` that follows is indeed silent at exit 0 — which is the same observation as
"nothing is written", not a second one. So step 4 is right that nothing is written, right that the
diff is silent, and right in its instruction, which is to read the exit status AND the
`No schema changes, nothing to migrate` line and never the silent diff on its own: an exit of 1
refuses this mistake at the first of those. The clause that is wrong is "and looks like a pass", said
of the RUN: the run looks like an error. That is worth one sentence rather than a shrug, because a
reader who took the warning at face value would think the step's own remedy was not enough for this
mistake. The
control is the same command with the correct `--schema`, which exits 0 and prints
`No schema changes, nothing to migrate`. Step 4's text is corrected in place, not only here.

The scope of that correction, stated rather than assumed: it was measured where no
`src/schema/index.ts` exists at all, and the two other rollout packages with an odd path are the same
— `ls packages/media/src/schema packages/venue-service/src/schema` on 2026-09-18 shows `images.ts`,
and `service.ts` with its test, and no `index.ts` in either. A package that HAS an `index.ts` which
simply exports no table would be a different case, and nothing here measures it; no package on the
rollout list is in that shape.

Verified on 2026-09-18, each with a control. The step 4 probe was run BEFORE any edit as a baseline
(`No schema changes, nothing to migrate`, exit 0, `diff -r` silent) and again after the conversion
(the same), and the negative control was taken in the same worktree in between: `party_size` moved
from `integer` to `smallint` made the same command write `drizzle-probe-tmp/0002_probe.sql` and add a
journal entry, so the silent runs mean something. A column-by-column comparison against the base
commit, built on drizzle's `getTableConfig` — SQL type, `columnType`, nullability, primary key,
defaults, enum values, uniqueness and the read mapping, keyed by table as well as column name —
reported **13 columns, 0 mismatches**, cross-checked against drizzle-kit's own count, which prints
`bookings 13 columns 2 indexes 1 fks`.

**That comparison was proved by the mutation the probe is blind to.** `created_at` was moved from
`tsString` to `ts` — the same SQL type, a different read mapping. The comparison named exactly that
column, `PgTimestampString` → `PgTimestamp`, with the read of `2026-09-16 10:00:00+00` going from a
string to a `Date`; the drizzle probe, run on the same mutated tree, printed
`No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`.

A line-by-line comparison then established what the count cannot: **every line this branch changes is
an import line, a column declaration, the one `pgTable(` → `table(` rename on the table-opening line,
or one of TWO comment edits, named below.** The base file has 70 lines that are neither an import nor
a column declaration: the `pgEnum` declaration, the comment blocks, the `check()` body, both indexes,
the foreign key, every blank line, the table-opening line, and the table's remaining structural lines
— its name, its braces, and the `(t) => [` that opens the extra config. **Sixty-five of them are
byte-identical**, the table-opening line is identical once `pgTable(` is read as `table(`, and the
four that remain are the two comments that named `date` and `time`, the words this change removed
from the code below them. Both now name the helper as well as
the type it emits: the table's header sentence about `booking_date` and `booking_time`, and the
one-line comment above those two columns. Neither sentence was false before — the SQL types do not
move — but a reader chasing `date` or `time` through the file would have found neither word, and the
`packages/workforce` conversion rewrote the same shape (`time-entries.ts`, where a comment naming
`mode: "string"` became one naming `tsString`). The comparison was itself proved by two mutations,
each caught and named: respacing the check body to `sql\`${t.partySize}>0\``, and moving the foreign
key's `onDelete` from `restrict` to `cascade`.

The comparison also caught one edit of mine that did NOT survive, which is the more useful half. A
comment sits above the `@waitron/db` import — the one explaining that the foreign-key targets are
core tables — and the conversion merges the vocabulary into that same import line, so the first
version of this branch extended the comment to mention the vocabulary. It was reverted because the
sentence it replaced is still exactly true of the foreign-key targets it names, and the addition
stated only what the import line already shows. Note what that reason is NOT: it is not a sibling
precedent. No converted TABLE file in `packages/db`, `catalogue`, `payments`, `identity`,
`workforce` or `workforce-es` carries a comment directly above an import, so there is no earlier
conversion that left one alone. (Several test files beside them do — `packages/db/src/schema/sales.test.ts`
is one — which is why the sentence is about table files rather than about the directory.)

Behaviour was carried by `pnpm -r typecheck` (exit 0 for the whole workspace) and
`pnpm --filter @waitron/bookings test:coverage` (exit 0, 14 files, 132 tests, no test edited —
this is a browser-mode package, so those 14 include the four real-Chromium dashboard files as well as
the real-PostgreSQL schema suite). `src/schema/bookings.ts` reads 100% on every measure before and
after, against thresholds of 90/90/85/85 (`packages/bookings/vitest.config.ts`). The denominator
moved, read off `coverage-summary.json` rather than off the percentage, and quoted as
covered-of-total pairs because the two runs share a number and a bare figure could come from either:
the file goes from **45 of 45** covered statements to **43 of 43**, and the package from **1031 of
1033** to **1029 of 1031**. The before reading was taken by writing the base commit's file over the
working copy with `git show`, re-running the suite, and putting the converted file back; both
readings were confirmed to belong to the tree they claim by checking whether the run's rendered
source in `coverage/src/schema/bookings.ts.html` contains `pgTable` or `timeOfDay`. The two lines
come from the one multi-line column declaration — `createdAt`'s `timestamp(...)` with its
`.notNull()` and `.defaultNow()` on their own lines — collapsing onto a single line; nothing became
partially covered, so no percentage moves. Same mechanism as `packages/workforce-es`.

**And the same report for `packages/scheduler`.** One table file, one table, 14 columns, no schema
change. Its shapes were all shapes the rollout had met: no `pgEnum`, no array column, no binary
column, no `date`, `time`, `smallint` or `bigint`, and every timestamp in string mode, so the
`ts`/`tsString` trap has one answer here and `tsString` is it.

**The one genuinely new answer is about `scheduled_runs.state`.** It is a checked text column over a
value set, so it is the `enumText`/`enumCheck` decision again — and here every COST `columns.ts`
records for that substitution was measured and none of them lands, which is a first for the rollout.
What keeps the column plain is the other thing `columns.ts` records, scope, which that file itself
calls a decision rather than a measurement. Each of the three costs was run:

- the spacing: substituting both (`enumText("state", runState)` and
  `check("scheduled_runs_state_ck", enumCheck(t.state))`) left the step 4 probe silent at exit 0 with
  a silent `diff -r`, so the generated schema does not change;
- the narrowing, and this is the part `packages/identity` could not say: it is ALREADY IN FORCE. The
  column is declared `.$type<RunState>()`, so a plain string is refused today — `tsc --noEmit` gave
  `Type 'string' is not assignable to type '"failed" | "pending" | "running" | "succeeded" | "parked"'`
  on an `InferInsertModel` assignment, with a `"pending"` control on the same line compiling. In
  identity the narrowing was a live new consequence hidden behind "no caller breaks today"; here
  there is no caller-facing change for `enumText` to make;
- and the branding, the reason `columns.ts` records for `incidents.severity`: that `enumText` would
  replace a branded exported type with a union derived from the values array. Here the two are the
  SAME type, because `RunState` is itself `(typeof runState)[number]`. Proved with a type-identity
  assertion and its control: the assertion that what `enumText` derives equals `RunState` compiled,
  while the control asserting a bare `label()` equals `RunState` failed with
  `Type 'false' does not satisfy the constraint 'true'`.

Two things NOT to read into that. The three costs are NAMED rather than counted because the counts
drifted while this pull request was being written: `columns.ts` records four considerations in all —
the spacing and scope as its "two reasons", the branding for `incidents.severity`, the narrowing for
`units.hardware_unit` — and earlier drafts of this report, of `docs/backlog.md` and of the column's
own comment each totalled them differently. And the branding is only measured here in the sense that
nobody had occasion to measure it before: identity had no branded type to lose, so it never arose.

So what keeps it a plain `label()` is SCOPE — rewriting a constraint is not a conversion's job — and
the column's comment says exactly that rather than borrowing a reason it does not have. The
costs-versus-decision split is what makes that sentence safe: two earlier drafts of the comment said
"neither reason in columns.ts holds" and then "nothing columns.ts records applies", and both were
falsified by their own next sentence, because scope is one of the things `columns.ts` records and
scope is what keeps this column plain. A future pass that decides to rewrite these constraints
should start here — nothing measured stands
against rewriting this one, which is more than can be said of any instance measured so far. The
alternatives (the five scope-only columns in `packages/db`, the parked `registros.ts`, and whatever
`venue-service`, `credentials` and `media` hold) have not been measured for narrowing or branding at
all, so this is not a claim about the cheapest instance in the tree.

**A trap this package paid for, which is about the acceptance method and not about columns.** The
before/after coverage comparison this rollout quotes is CORRUPTIBLE by its own scratch — measured
here; the ten earlier reports' figures were not re-checked. Vitest's coverage excludes carry
`coverage/**` and `**/[.]**`, so a run given its own `--coverage.reportsDirectory` under a non-dot
name inside the package leaves a directory the NEXT package run measures as source: the HTML
reporter's `sorter.js` (192 statements), `block-navigation.js` (73) and `prettify.js` (2), 267 in
total, named in the polluted run's own `coverage-summary.json`. One leftover directory reported
59.91% against this package's 90 threshold. It does not look like tooling; it looks like a coverage
regression. The NAME qualifier was measured on 2026-09-18:
`--coverage.reportsDirectory=.coverage-review` does NOT contaminate, the next run reading 402/404 at
exit 0. The PACKAGE qualifier is a reading, not a
run: the root Vitest project sets its own `coverage.include`, which replaces rather than merges and
names nothing under `packages/`, so a stray directory in a package should be invisible there —
untested.

It also put two false claims into a COMMITTED draft of this report, which the review wave caught and
removed; the shape of both is worth more than the trap. The first: four successive runs here read
407, 674, 938 and 1205 statements, and the draft quoted "+267 each time". The differences are 267,
264, 267, because those readings are not one
sequence but two — the first two on a tree whose clean total is 407 and the last two on one whose
clean total is 404 (407, 407+267; then 404+2x267, 404+3x267). A paragraph whose whole point is that a
coverage reading can belong to a tree other than the one it claims had made exactly that mistake.
The second: "the readings repeat exactly" is false. Statement readings do — 405/407 and 402/404,
reproduced independently by the run-it reviewer — but two clean runs of the BASE tree gave 98/101 and
99/102 branches, so a before/after branch comparison across runs measures nothing, and this report
quotes no branch delta. What the conversion moves is the statement pair, 405/407 to 402/404, covered
and total falling by the same 3 as the multi-line timestamp declarations collapse, leaving 99.5%
unchanged. Each reading's provenance was checked the way the bookings report asks — the rendered
`coverage/src/schema/scheduled-runs.ts.html` contains `tsString` for the converted artifact and
`pgTable` for the base one. The lesson is now a line in `CLAUDE.md` §4, a paragraph in
`docs/developers/testing-guide.md` and a sentence in step 4 below, because the existing rule named
the second report directory without saying where to put it — and its own cited receipt had already
used a `/tmp` path.

**Verification, each with a control.** Step 4 probe silent at exit 0 before any edit and after, with
the negative control taken between them (`generation` integer->smallint wrote `0002_probe.sql` and a
journal entry). `getTableConfig` parity comparison against the base commit: 14 columns, 0 mismatches,
cross-checked against the probe's own `scheduled_runs 14 columns 1 indexes 0 fks` — PROVED BY
MUTATION with `created_at` `tsString`->`ts`, which the comparison named
(`PgTimestampString`->`PgTimestamp`, read `String`->`Date`) and which the drizzle probe, on the same
tree, could not see at all. Line classification PROVED BY MUTATION twice (respacing a check body,
reversing the unique index's column order — each reported). `pnpm -r typecheck` 0; `pnpm lint` 0;
`pnpm format:check` 0; the root guard project 42 files / 3036 tests;
`pnpm --filter @waitron/scheduler test:coverage` 0 with 9 files and 85 tests, no test edited,
`src/schema` 100%. The run-it reviewer re-ran the step 4 probe with its own negative control, its
own column comparison with its own timestamp-mode mutation, the `enumText` substitution, both typecheck
controls, the two line mutations, the coverage experiments, the workspace typecheck, lint and
format checks, the root guard project and the package coverage run — and reported no correctness
defect at any severity.

**What every changed line is**, stated as a property rather than a count: an import, a column
declaration, the `pgTable(`→`table(` rename, or the carve-out comment added above `state`. Said
once so the two numbers cannot be read as a contradiction: the classifier reports ZERO unclassified
differences for the conversion itself, and ONE once the carve-out comment is in the file — that
comment being a deliberate addition, not a line the conversion moved.

**And the same report for `packages/venue-service`.** One table file (`src/schema/service.ts`),
eight tables, 52 columns, no schema change. The builders it used were `uuid`, `text`, `boolean`,
`integer`, `time`, `jsonb` and `timestamp` in string mode, every one of which has a helper, so no
column builder is left coming from `drizzle-orm/pg-core`; the file's remaining import from there is
`check`, `foreignKey`, `index`, `primaryKey` and `unique`, which the vocabulary does not cover. Its
one `timestamp` column is string mode, read off the line being replaced (`mode: "string"` appears
once in the base file and `mode: "date"` not at all, and the converted file holds one `tsString` call
and no `ts` call). There is no `pgEnum` and no `.array()` column anywhere in the package
(`grep -rn "pgEnum\|\.array()" packages/venue-service/src --include='*.ts'` exits 1), and no `date`,
`smallint`, `bigint`, `numeric` or `bytea` column on either side of the diff. The two `time` columns
are not a first for the rollout — `timeOfDay` was already in use in `packages/bookings` and in
`packages/db`'s `tenants.ts` when this was written.

**The one thing the conversion did not absorb is the check-constraint carve-out, and here it is one
reason rather than a mixture.** Five text columns carry a `check()` listing their permitted values —
`departments.default_service_mode`, `zone_service_policies.service_mode`,
`order_service_contexts.service_mode`, `working_line_contexts.hardware_unit` and
`working_line_contexts.vat_class` — and every one of them is written WITHOUT the `", "` spacing
`enumCheck` emits, so the first of the two reasons `columns.ts` records covers all five. Read that
sentence with its hedge attached: the spelling was read off the source for all five, but the DDL
CONSEQUENCE was measured on TWO of them, chosen to cover both shapes the file holds. That is also a
statement about this package only — the earlier packages' checked columns were not re-surveyed to
rank it.

The reason was measured here rather than carried over from `option_groups.type`. Note what that is
NOT: `columns.ts`'s "measure it on the column in front of you" is scoped to the NARROWING question,
which this conversion does not measure at all. Measuring the SPACING reason per package is a choice
made here, not an instruction followed. Two of the five were
substituted for `enumText` + `enumCheck` on 2026-09-18 — `departments.default_service_mode`, which is
`NOT NULL` with a plain `in (…)`, and `working_line_contexts.hardware_unit`, which is nullable and
composes a null arm around the helper — and the step 4 probe then generated a migration whose whole
content is those two constraints dropped and re-added:

```
ALTER TABLE "departments" DROP CONSTRAINT "departments_service_mode_ck";
ALTER TABLE "working_line_contexts" DROP CONSTRAINT "working_line_contexts_hardware_unit_ck";
ALTER TABLE "departments" ADD CONSTRAINT "departments_service_mode_ck" CHECK ("departments"."default_service_mode" in ('table_tab', 'prepay', 'invoice_first', 'ticket_then_pay'));
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_hardware_unit_ck" CHECK ("working_line_contexts"."hardware_unit" is null or "working_line_contexts"."hardware_unit" in ('kg', 'g', 'mg'));
```

Only the spacing moves. The nullable half also exercises the composition note in `columns.ts` — that
a null arm is written AROUND `enumCheck` and the values stay inline through the nesting — through
drizzle-kit's own `generate` path for the first time: the emitted MIGRATION carries
`in ('kg', 'g', 'mg')` as literals, not `in ($1, $2, $3)`. _A first draft of this sentence claimed the
first REAL DDL from a REAL table, and the convention reviewer falsified it from this same plan: the
`packages/payments` report above records the run-it reviewer executing the composed form against
PGlite and getting a `23514` on an invalid value, which is a constraint that had to exist on a table
to raise it. The narrower claim — drizzle-kit's generator, into a migration file — is the one that
survives._ So the note holds, and the reason for leaving the column alone is the generated text, not
the null.

**This is the second package in the rollout the step 4 `--schema` warning applies to**, after
`packages/bookings` measured it: `packages/venue-service/drizzle.config.ts` points `--schema` at
`./src/schema/service.ts`, and the package has no `src/schema/index.ts` at all. Every probe run below
passed that path, read off `drizzle.config.ts` with `grep schema: drizzle.config.ts` before the first
run rather than pasted, and each run's EXIT STATUS was read rather than the diff alone.

Verified on 2026-09-18, each with a control. The step 4 probe was run BEFORE any edit as a baseline
(`No schema changes, nothing to migrate`, exit 0, `diff -r` silent and zero bytes) and again after
the conversion (the same), with the NEGATIVE CONTROL taken between them in the same worktree:
`department_hours.weekday` moved from `integer` to `smallint` made the same command write
`0002_probe.sql` and add a journal entry, so the silent runs mean something. A column-by-column
comparison against the base commit `23ce395b`, built on drizzle's own `getTableConfig` rather than on
text and keyed by TABLE as well as column name, reported **52 columns, 0 mismatches**, cross-checked
against drizzle-kit's own per-table counts, which print 5/8/2/5/7/16/3/6 and sum to the same 52.

**That comparison was proved by a mutation the probe is blind to**: `departments.created_at` moved
from `tsString` to `ts`. The comparison named it — `PgTimestampString` against `PgTimestamp`, and a
read mapping returning `[object String]` against `[object Date]` — and the step 4 probe run on that
SAME tree printed `No schema changes, nothing to migrate` at exit 0 with a silent `diff -r`. That
pairing is the point of having both checks, and it is why neither on its own is the acceptance check.

**A blind spot in the line classifier, found because its total disagreed with the probe's.** The
classifier is a throwaway script that lives in `/tmp` and is in no file in this repository, so this
paragraph is the only record of it — read it as a description, not as something you can re-run. It
walks each table file with a small state machine, and INSIDE the column object it picks out
declarations with `^\s+[A-Za-z_$][\w$]*: `, a space after the colon required. That predicate quoted
on its own is not the instrument: run over the WHOLE file it matches 111 lines rather than 51,
because `columns:`, `foreignColumns:` and `name:` inside every `foreignKey({…})` block match it too
— 20 such blocks, three lines each, is the whole of the 60-line difference. It is the state
machine's scoping that makes the quoted regex mean what it says, and a first draft of this paragraph
left that out, which the convention reviewer caught by running the quoted predicate on its own and
getting a number nothing here mentions. _A second draft then blamed `primaryKey({…})` blocks as
well; all five in this file are written on ONE line, so they contribute nothing, and 60 + 51 is
already the 111._

What the space requirement misses is a declaration whose value prettier has pushed entirely onto the
NEXT line, leaving a bare `allergens:`. _A draft of this sentence blamed prettier's `printWidth` in
general and offered "a long method chain" as another way in. That is FALSE and the tree refutes it:
a chain that overruns the limit breaks at the `.` and keeps the value's head on the name line —
`packages/db/src/schema/join-requests.ts:25` reads `locationId: id("location_id")` with `.notNull()`
below it, and dozens more do the same. The correction was wider than the thing it corrected, which
is the shape this repository's §1 warns about._ What this file actually meets is a value whose FIRST
token is itself too long to share the line — a generic argument spanning most of the width. How
general that shape is, this branch does not establish; what it measured is that exactly ONE
declaration in the tree's schema files has it. That column was filed under "everything that is not a
column", where its conversion then showed up as an unclassified difference that looks like a real
finding. What caught it was the cross-check rather than the report: the classifier said 51
column declarations and the parity probe said 52. With the space made optional the two agree at 52,
and the classifier reports **0 unclassified differences**. This is the catalogue report's lesson
arriving a second time — a checker that reports a total is itself a claim — with the difference that
this time the number was checked against another instrument.

**The earlier reports rest on that same instrument, so they were checked rather than left standing.**
A defect found in a shared instrument retires every receipt taken with it until somebody looks. The
reading, taken at the PARENT commit of each of the ten earlier conversion commits:

```
git grep -nE '^[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*:$' <parent> -- 'packages/*/src/schema/*.ts'
```

returns exactly ONE line at every one of them, and it is the same line each time —
`packages/venue-service/src/schema/service.ts:255:    allergens:`, this package's own column, which
predates the whole rollout. _An earlier draft of this paragraph said the reading returned NO match,
which is false; it was written from a summary rather than from the command's output, in the paragraph
whose subject is not letting a receipt stand unchecked._ The conclusion the reading supports is
unchanged and is the one that matters: no package converted BEFORE this one held a declaration the
broken predicate could miss, so their "every changed line is…" properties are unaffected. Eight
reports state such a property — catalogue, payments, fiscal-verifactu, identity, workforce,
workforce-es, bookings and scheduler. `packages/db`'s does not: that conversion, the largest in the
rollout, was never line-classified at all, so there is no receipt of this kind to retire there and
none to reinstate.

The classifier was then proved by two mutations in the region it is responsible for, each caught and
each reverted: the spacing inside `working_line_contexts_hardware_unit_ck`'s body, and the column
order of `zone_menus_order_idx`.

Behaviour, which no probe reaches, was carried by `pnpm -r typecheck` (exit 0 for the whole
workspace), `pnpm lint` 0, `pnpm format:check` 0, the root guard project (42 files, 3036 tests) and
`pnpm --filter @waitron/venue-service test:coverage` (exit 0, 13 files, 84 tests, no test edited,
`src/schema` 100%).

**What every changed line is**, as a property rather than a count: an import, a column declaration,
the `pgTable(`→`table(` rename, or one of the five carve-out comments added above the checked text
columns. No `check()` body, index, unique, foreign key, primary key or blank line differs from the
base commit. Said once so two readings cannot look like a contradiction: run on the conversion alone
the classifier prints `UNCLASSIFIED DIFFERENCES: 0`, and run on the file as it now stands it prints
`1` — that one difference being a single hunk list holding exactly the five comment blocks and
nothing else. They are a deliberate addition, not a line the conversion moved. Quoted as the two
runs printed them rather than explained, because the script is not in the tree and a claim about how
it counts is one nobody can re-run.

**The comments were added because every sibling that has such a column carries one and this package
did not**, which the convention reviewer found. Taken on `main` at `23ce395b`,
`grep -rn "NOT the enumText/enumCheck pair" packages` returned six: `packages/catalogue`,
`packages/payments` (twice), `packages/identity` (twice) and `packages/scheduler`. Read "every
sibling" with its exception attached — `packages/db` has eight such columns and leaves them BARE,
recording their reason in `columns.ts` instead; `workforce`, `workforce-es` and `bookings` have no
value-set checked text column at all, so they are not evidence either way. One departure from the siblings, taken deliberately and stated here because
nothing else records it: this is the first package to hold SEVERAL value-set checked text columns in
one file, all of them held by the SAME single reason, so the reason is written out once above
`departments.default_service_mode` and the other four carry a one-line pointer to it. _Not "the
first whose checked columns are all in one file" — catalogue's one and scheduler's one are each in
one file too; it is the plurality that is new._ Five copies of one seven-line paragraph in a file of
290 lines is the comment bloat `CLAUDE.md` §1 measures the cost of.
`packages/db`'s own eight checked columns are the other precedent — bare, with their reason recorded
in `columns.ts` instead — so the convention a converter should read off the tree is that the reason
is recorded SOMEWHERE a reader of the column will reach, not that it is repeated per column.

**And the same report for `packages/credentials`.** One table file, one table, six columns, no
schema change, and the second conversion in the rollout to change what a CALLER is handed rather
than only what the schema says — `print_jobs.payload` was the first. **The receipt for that second
part, stated as what was actually run:** `git show --name-only` over the nine conversion pull
requests between the two (`36c7f703 7ec41496 23ce395b 4eaaa94f 8a08446c 837c443e be866e7c 3ffc7fa4
26619964`), keeping `.ts` paths and dropping those under any `src/schema/`, leaves exactly ONE file
in the whole set: `bench/sqlite-failover/src/model.ts` in `23ce395b`, whose change is a line-number
pointer inside a SQL comment. _An earlier draft of this receipt said the filtered list was empty for
every one of the nine; it is not, and the draft also said "their OWN `src/schema/`" where seven of
the nine edit `packages/db/src/schema/columns.ts` and one edits two other packages' table files. The
conclusion survived the re-run; the sentence describing it did not._

Its builders at the base commit were `text`, `integer`, `timestamp` in string mode and a hand-rolled
`bytea` custom type used three times; every one has a vocabulary equivalent, so nothing is left
coming from `drizzle-orm/pg-core` but `check` and `primaryKey`. There is no `pgEnum`, no `.array()`
column and no value-set `in (...)` constraint anywhere in the package's schema —
`git grep -nE '\b(date|time|smallint|bigint|numeric|jsonb|boolean|uuid|pgEnum)\(' 7267f832 -- packages/credentials/src/schema`
and the same grep for `\.array\(\)|\bin \(` both exit 1 — so the enumText/enumCheck question this
rollout keeps meeting does not arise here at all. The table's four checks are a range
(`key_version >= 1`), two byte-length checks and a non-empty check, none of them a value set.

**What the conversion cost outside the table file: one function's parameter type and one new
interface, both inside this package.** The old block declared
`customType<{ data: Buffer; driverData: Buffer }>`, so `ciphertext`, `iv` and `auth_tag` were typed
`Buffer` and `store.ts` handed them straight to `open` in `cipher.ts`, whose `Sealed` parameter said
`Buffer` too. The shared `binary` helper hands a reader a `Uint8Array`. `pnpm -r typecheck` is what
found the blast radius, as it did for `print_jobs.payload`: it exited 2 naming `src/store.ts(63,5)`,
`(64,5)` and `(65,5)` — the three properties of that one `open` call — and nothing else in the
workspace, then exited 0 once `open` took the wider type. `cipher.ts` now declares two interfaces
where it declared one: `Sealed` stays `Buffer`-typed and `open` takes a new `SealedRow` typed
`Uint8Array`. **That pair is measured, not preferred.** Widening the single `Sealed` instead gave
`tsc --noEmit` two `TS2339`s — `Property 'equals' does not exist on type 'Uint8Array'` at
`cipher.test.ts(21,17)` and `(22,25)`, where the test calls `Buffer`'s own `.equals()` on a `seal()`
result — so one interface costs two test edits and this rollout does not edit tests to pass. A
`Sealed` satisfies `SealedRow` and not the reverse, so every existing caller compiles unchanged.

**Where the failing test had to go, and why the obvious place was the wrong one.** This package has
FIVE test files that touch a database and they do not share a target: `store.test.ts`,
`rotate.test.ts`, `cli.test.ts` and `migrations.test.ts` are PGlite, and `credentials.test.ts` is
real PostgreSQL through a non-superuser LOGIN (`useTemplateDb({ template: "core_credentials" })`;
`packages/credentials/vitest.config.ts` names the split). The runtime assertion
`print_jobs.payload` used — read a row back and assert `Buffer.isBuffer(...)` is false — was tried
first in the PGlite suite, where it PASSED against the UNCONVERTED tree (1 passed, 130 skipped).
That is `CLAUDE.md` §1's measurement taken where both answers look alike: PGlite's own bytea parser
returns a `Uint8Array` and drizzle passes it straight through when a custom type declares no
`fromDriver`, which is what the old block was, so the reading was about the DRIVER and not the
column. _An earlier draft of this report concluded from that single reading that no runtime
assertion in this package could tell the two declarations apart, and said so three times. Both
the Codex run-it seat and the convention seat falsified it independently, on the same day and from
different evidence._ Moved to `credentials.test.ts`, the same assertion goes
red for exactly the right reason: `expected true to be false`, with the other four cases in that
file still green — the control that says the round trip itself works either way. The compile-time
case in `index.test.ts` stays as well, because the two fail for different reasons: it goes red if a
column stops DECLARING `Uint8Array`, and the real-PostgreSQL one goes red if the value a read hands
back stops BEING one. That is measured, not argued: deleting `fromDriver` from the `bytea` custom
type behind `binary` left the compile-time case green (tsc clean) and turned the real-PostgreSQL one
red with `expected true to be false`, its four neighbours in that file still passing. What
`packages/db/src/schema/columns.test.ts` records is the other half — that deleting BOTH mapping
functions is invisible under PGlite.

Verified three ways, each with a control. The step 4 probe ran silent at exit 0 with
`No schema changes, nothing to migrate` and a silent `diff -r` before any edit and again after the
conversion, and a negative control between them — `key_version` `integer` → `smallint` — made the
same command write `0002_probe.sql` and a journal entry. A `getTableConfig` comparison against the
file at the base commit reported 6 columns in 1 table and exactly THREE mismatches: `ciphertext`,
`iv` and `auth_tag`, each differing in one field, the read mapping, and in nothing else — same
`sqlType` (`bytea`), same `columnType` (`PgCustomColumn`), same nullability, same defaults. That
comparison's own control was `updated_at` `tsString` → `ts`, which took it to four mismatches
(`PgTimestampString` → `PgTimestamp`, a read of `[object String]` → `[object Date]`) while the
drizzle-kit probe stayed silent at exit 0 on the same tree — the mode trap, caught by the instrument
that can see it and invisible to the one that cannot. **One thing to know before reusing that
comparison on a binary column:** its object-tag half cannot tell a `Buffer` from a `Uint8Array`,
because `Object.prototype.toString.call(Buffer.from([1,2,3]))` is `[object Uint8Array]` as well. It
is the `String(...)` half that discriminates — a `Buffer` stringifies as its utf-8 decoding
(`\u0001\u0002\u0003`) and a `Uint8Array` as a comma-joined list (`1,2,3`). Behaviour was carried
by `pnpm -r typecheck` (exit 0 for the whole workspace) and
`pnpm --filter @waitron/credentials test:coverage` (exit 0, 11 files, 132 tests, 100% of statements,
branches, functions and lines), with no existing test edited.

The diff is small enough to read whole rather than classify by script: in the table file every
changed line is the import block, the deleted `bytea` block, the table-opening line (`pgTable(`
becomes `table(`), or one of the six column declarations.

**What `packages/media` added, as the FOURTEENTH pull request and the last hand-rolled `bytea` block
in the tree.** One table file, two tables, nine columns, no schema change and — unlike
`packages/credentials`, the other binary conversion — no change to what any caller is handed. That
last part is measured rather than assumed: at the base commit `71bd7aa9`, `sed -n '16,20p'` of this
package's block and `sed -n '274,278p'` of `columns.ts`'s were written to two files and `diff`ed,
exit 0, so the two declarations are identical body for body. **Both ranges are as of `71bd7aa9`.**
Media's block only exists there, and `columns.ts`'s moves whenever anything above it is edited —
including in the commit this paragraph is part of — so on a later tree find it with
`grep -n 'const bytea = customType' packages/db/src/schema/columns.ts` rather than by line number.
An earlier draft of this sentence predicted what the stale range would return, and was wrong by the
time it was committed, for exactly that reason. Both hand a reader a
`Uint8Array` and bind a node `Buffer`, so deleting one for the other moves nothing across the
boundary, and `pnpm -r typecheck` exiting 0 for the whole workspace is the second reading of the
same fact.

**The instrument needed its own control here, because zero mismatches was the expected result.** A
`getTableConfig` comparison against the file at the base commit reported 9 columns in 2 tables
(`media_images` 7, `media_image_data` 2, matching drizzle-kit's own per-table counts) and zero
mismatches — which on its own is exactly what a broken comparison would print too. Two mutations
were run against it. `created_at` `ts` → `tsString` took it to one mismatch
(`PgTimestamp` → `PgTimestampString`, a read of `[object Date]` → `[object String]`) while the
drizzle-kit probe stayed silent at exit 0 on the same tree. And, specifically for the column this
package exists to convert, replacing `binary("bytes")` with a locally declared `customType` that
omits `fromDriver` took it to one mismatch on `media_image_data.bytes`, printing
`[object Uint8Array]:1,2,3` against `[object Uint8Array]:\u0001\u0002\u0003` — the object tag
identical on both sides, the `String(...)` half the only thing that separates them. That reproduces,
on this package's own column, the warning the `packages/credentials` report above records, and it is
what makes the zero-mismatch reading mean something.

**The step 4 probe ran three times, in this order**, which is what makes the third run mean
something. Before any edit: `No schema changes, nothing to migrate`, exit 0, `diff -r` silent —
so the migration folder was not already out of date. Then the negative control, `created_at`'s
`withTimezone` flipped from `true` to `false`: the same command wrote `0002_probe.sql`, a snapshot
and a journal entry, and `diff -r` exited 1. Then, after the conversion: silent again at exit 0.

**The carve-out is the array column**, `images.labels`, and it is the last of the five the
`packages/catalogue` report counted. It converts to `label("labels").array()`, which is the shape
the four sibling array columns already use (`content_languages.languages`,
`join_requests.decoy_numbers`, and `invoice_locales` in both `sales` and `tenants`): the column
builder is vocabulary and `.array()` is a drizzle call reached off it. Nothing in this rollout
absorbs `.array()`, and F1 handles arrays on its own row of the spec's flip table whatever the
vocabulary does.

None of the earlier packages' decisions arose here. There is no `pgEnum`, and no `date`, `time`,
`smallint`, `bigint` or `numeric` column. **There is no checked text column in the sense that
decision was about** — the `enumText`/`enumCheck` question, which only comes up when a check
enumerates a value SET. This package has two checks and neither does: `media_images_filename_ck` is
a regular expression over `filename`, and `media_images_names_ck` is a pair of `jsonb_typeof` tests.
Both are left exactly as they were.

Coverage moved and the reason is arithmetic rather than behaviour: `src/schema/images.ts` reads
67.39% at the base commit and 64.28% converted, with the SAME 15 uncovered lines on both sides —
the two `(t) => [...]` constraint callbacks, which no test invokes either way. The file lost four
measured lines when the `bytea` block went, so the denominator shrank. The package as a whole reads
94.15% at the base commit and 94.13% converted. Its bars are four separate numbers, not one:
`packages/media/vitest.config.ts` sets statements 90, lines 90, functions 85 and branches 85, and
the converted run reports 94.13 statements, 94.13 lines, 96.22 functions and 92.48 branches. That
before-and-after comparison was taken with `--coverage.reportsDirectory=/tmp/...`, outside the
package, per the rule the `packages/scheduler` report paid for.

`pnpm --filter @waitron/media test:coverage` exits 0 with 11 files and 105 tests across all three of
its vitest projects — node, real PostgreSQL and real headless Chromium — with no existing test
edited.

- [x] **Step 4: Prove nothing changed** — done 2026-09-18 with `packages/media`, the last package on step 2's list with anything to convert.

The generate-into-a-copy probe from P1a step 6 — **not `drizzle-kit check`, which cannot see the
schema source at all**. Run it from the package directory:

```bash
cp -R drizzle drizzle-probe-tmp
grep schema: drizzle.config.ts          # this package's own schema entry point
pnpm exec drizzle-kit generate --dialect postgresql --schema ./src/schema/index.ts --out ./drizzle-probe-tmp --name probe
diff -r drizzle drizzle-probe-tmp
rm -rf drizzle-probe-tmp
```

**`--schema` is per package — change it.** All three flags are required (P1a step 6 has the measured
refusal), and four packages do not keep their schema at `./src/schema/index.ts`: read from each
`drizzle.config.ts` on 2026-09-17, `packages/media` uses `./src/schema/images.ts`,
`packages/bookings` uses `./src/schema/bookings.ts`, `packages/venue-service` uses
`./src/schema/service.ts`, and `packages/fiscal-none` uses `./src/index.ts`. A pasted
`--schema ./src/schema/index.ts` points those four at a file they do not have. Drizzle-kit then
writes nothing AND refuses loudly — exit 1, `No schema files found for path config` — so it is the
`diff -r` taken afterwards on its own that is silent and looks like a pass, never the run itself.
**Read the exit status and the `No schema changes, nothing to migrate` line, never the silent diff on
its own.** That was measured in `packages/bookings` on 2026-09-18, the first package in the rollout
this warning applied to; the receipt is in that package's report under step 3.

Those four are a different set from step 2's rollout list, and the overlap is only three.
`packages/fiscal-none` is not on step 2's list and declares no `pgTable` anywhere (checked
2026-09-17), so this step never runs there; it is named above because the warning is about
drizzle-kit's `--schema` flag across the repository, not about the rollout. Reaching for it as "the
fourth package to convert" would be reading the wrong list.

Four packages on step 2's list have no schema at all — `packages/purchasing`, `packages/recipes`,
`packages/layouts` and `packages/reporting` each have no `drizzle.config.ts`, no `drizzle/` folder
and no `pgTable(` anywhere in `src` (checked 2026-09-17). There is nothing for this step to run in
them and nothing for step 3 to convert; skip them here. Two of the four, `recipes` and `layouts`,
have since been removed from the list altogether — the decision paragraph below is the one to read,
and it supersedes their mention here.

Two of the four are picked up later in this plan and two are not. Grepped over this plan file on
2026-09-17: `@waitron/reporting` and `@waitron/purchasing` both appear in P5's step 8 test list, and
`@waitron/purchasing` again in P6, so the money and quantity work does reach them.

**Decision (owner, 2026-09-17): `packages/recipes` and `packages/layouts` are removed from step 2's
list above, and nothing is lost by removing them.** Their tables are not missing — they belong to
`packages/db`, which is the FIRST pull request in this rollout, so converting it already covers
them. Measured on 2026-09-17: `pgTable(` appears nowhere in either package's `src`; their only
drizzle import is `drizzle-orm` itself, for query helpers rather than table declarations; and the
tables they read live in `packages/db/src/schema/` as `recipes.ts`, `canvases.ts`,
`device-profiles.ts`, `tenant-themes.ts` and `tenant-receipts.ts`, every one of which the
`packages/db` pull request converts. So a pull request of their own would have nothing to convert.
Do not open one for either package, and do not read their absence from the list as a gap.

The same two warnings as in P1a: `--out` is relative to the working directory, so run this from the
package directory and never give it an absolute path; and the scratch folder is created inside the
package, so a run that stops part-way leaves `drizzle-probe-tmp` in `git status` — delete it.

A third, of the same shape, measured in `packages/scheduler` on 2026-09-18 and now also a rule in
`CLAUDE.md` §4: if you take a coverage reading into its own `--coverage.reportsDirectory` to compare
before against after, put that directory OUTSIDE the package. A dot-prefixed name inside it measured
safe too (`.coverage-review`), but the rule is the outside path, because a name is easier to get
wrong than a location. Left inside under a
non-dot name it is measured as SOURCE by the next package run — the HTML reporter's own assets add
267 statements — and the run reports a coverage regression that has nothing to do with the code. The
report under step 3 carries the receipt.

Expected: `No schema changes, nothing to migrate` with exit 0, and `diff -r` silent. Then:

```bash
pnpm --filter <package> test:coverage
```

- [x] **Step 5: Guard the rule so it does not rot** — done 2026-09-18, in the final P1b pull request.

The guard is `scripts/column-vocabulary.test.ts`, a ROOT-project guard, and the house rule it
enforces went into `CLAUDE.md` §3 with its receipt in `docs/developers/conventions-data.md` in the
same change.

**It did NOT go into `packages/db/src/schema/columns.test.ts`, which is where this step said to put
it**, and the reason is a measurement rather than a preference. CI runs a package's suite only when
the scoping selects it, and the expansion is to a changed package's DEPENDENTS: `pnpm --filter
"...@waitron/bookings" ls --depth -1 --json`, run on 2026-09-18, lists seven packages and
`@waitron/db` is not among them. A check living in `packages/db`'s suite therefore would not run on a
pull request that adds a table file in `packages/bookings` — the change it exists to catch. Root
`CLAUDE.md` §4 already states the rule ("a guard that reads the whole tree belongs in the ROOT Vitest
project"), and the root `vitest.config.ts` header carries the 2026-08-01 measurements from when the
repo-wide guards were moved out of `packages/db` for exactly this.

**The draft predicate in this step was replaced, not copied.** Two things were wrong with it and one
was decided:

- It imported `sourceFilesIn` from `scripts/source-files.js`, which does not exist. The function of
  that name lives in `packages/db/src/english-only.ts` (see its signature there), takes ONE package
  NAME rather than a list of roots, walks `packages/<name>/src` only — so it never reaches `apps/` —
  and is deliberately not re-exported from that package's barrel (the reason is in
  `packages/db/src/index.ts`). The guard walks the two roots itself, the way
  `scripts/no-tenant-column.test.ts` does, including that file's `isFile()` check against a browser
  test's screenshot directory.
- It matched a builder's CALL with a regex over a hand-written list of names. The guard matches the
  IMPORT SPECIFIER instead, and derives the forbidden set from the vocabulary's own `pg-core` import
  block — so the list this step warned would go stale does not exist. Measured while writing it:
  across `packages/` and `apps/`, exactly one file outside the vocabulary imports a column builder
  from `drizzle-orm/pg-core`, and it is `registros.ts`'s `text`. Everything else importing from that
  module takes constraint, index and enum builders (`check`, `index`, `foreignKey`, `primaryKey`,
  `unique`, `uniqueIndex`, `pgEnum`), drizzle's `alias`, the two client types
  `packages/db/src/client.ts` takes (`PgDatabase`, `PgQueryResultHKT`), or test-only helpers and
  types (`getTableConfig`, `PgTable`, `PgDialect`) — none of which the vocabulary owns.
- `customType` is IN the forbidden set, which is the explicit decision this step asked for. All three
  hand-rolled `bytea` blocks the `binary` helper replaced were written with it, so a table file
  calling `customType(` is doing the thing the guard exists to stop.

Proven by mutation, every one restored afterwards: a planted table file importing `uuid` was reported
by name (`packages/db/src/schema/probe-offender.ts imports uuid`) and the suite went red; a second
planted file whose import hid the builder behind a comment and used single quotes was reported the
same way; dropping the `registros.ts` allowance reported that file; and blinding the import parser
failed 15 of the suite's 22 cases, so the controls bite rather than decorate. Two review seats broke
the parser in turn — a comment inside the braces, then a BRACE inside that comment — and each shape
is now a control; the numbers here are as of the branch's final state. The known gap — a namespace import is invisible — is
pinned as a control rather than only claimed, and stated in `CLAUDE.md` in the same line as the guard.

- [x] **Step 6: Commit each package separately** — done 2026-09-18 with `packages/media`, the last package on step 2's list with anything to convert.

```bash
git commit -s -m "Use the shared column types in <package>

No schema change: generating this package's migrations into a copy of its
migration folder and diffing that against the real one found no difference."
```

---

## Task P2: One test-database helper

**Runner:** autonomous. **Depends on:** nothing.

Most suites pick a database by naming the driver themselves, through `usePgliteDb`,
`useRealPostgres` or `describeEachTarget`. Put one helper in front of them so the flip changes one
function body.

**The count in this paragraph used to read "211 files", and a count is a receipt that goes stale
(CLAUDE.md §7). Measured 2026-09-18 on the tree at `b9bbe1d7`**, with the command, because the answer
depends entirely on the scope you count over:

```bash
# files that call usePgliteDb, excluding the file that defines it
grep -rlE "\busePgliteDb\(" --include="*.ts" packages apps | grep -v "src/testing/lifecycle.ts" | wc -l   # 209
# files that call any of the three named above
grep -rlE "\b(usePgliteDb|useRealPostgres|describeEachTarget)\(" --include="*.ts" packages apps | grep -v "src/testing/lifecycle.ts" | wc -l   # 219
```

The run-it reviewer counted 205 for the first of those, over `*.test.ts` only — the same property,
a narrower scope.

Do not treat any of these numbers as a completion target. **The property this task can actually
reach is: no TEST SUITE calls `usePgliteDb` directly — only `venue-db.ts` does.** It is deliberately
narrower than "no file names the PGlite driver", which was the first attempt at stating it and is
unsatisfiable: measured the same day, `grep -rln "createPgliteDb" --include="*.ts" packages apps`
outside `packages/db/src/testing/` returns 27 files, among them `packages/db/src/client.ts`, which
is where the driver is named ON PURPOSE (it is the only file importing `@electric-sql/pglite`),
`packages/db/src/index.ts` which re-exports it, and several `apps/server/scripts/*-demo.ts`. Step 5
converts none of those and is not meant to.

**Files:**

- Create: `packages/db/src/testing/venue-db.ts`
- Create: `packages/db/src/testing/venue-db.test.ts`
- Modify: `packages/db/package.json` — add `"./testing/venue-db.js"` to the `exports` map. **Corrected
  2026-09-18 while building it:** this plan said `packages/db/src/testing/index.ts`, and there is no
  such file. The `exports` map is enumerated deliberately (CLAUDE.md §3), so a new testing entry point
  is a new line in it, exactly like `./testing/lifecycle.js` beside it. Receipt that the entry works:
  `createRequire` rooted at `packages/catalogue/package.json` resolves
  `@waitron/db/testing/venue-db.js` to `packages/db/src/testing/venue-db.ts`.
- Modify: the files that call the three existing helpers — one pull request per package. (No count here on purpose; the paragraph above gives the commands and the scopes they measure.)

**Interfaces:**

- Consumes: `usePgliteDb(options: PgliteSuiteOptions): PgliteSuite` from `packages/db/src/testing/lifecycle.ts`
- Produces, consumed by F1: `useVenueDb(options: VenueDbOptions): VenueDb`, where `VenueDb` has a readonly `db: Database`.

- [x] **Step 1: Write the failing test** — done 2026-09-18, in the pull request that adds the helper: three cases, the third of them the one that discriminates.

Create `packages/db/src/testing/venue-db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";

describe("useVenueDb", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("gives a migrated database", async () => {
    const result = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: expect.any(Number) });
  });

  it("empties data between tests", async () => {
    await suite.db.execute(
      sql`insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', 'B00000000', 'Probe')`,
    );
    const before = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(before.rows[0]).toEqual({ n: 1 });
  });

  it("really did empty it — the row from the previous test is gone", async () => {
    const after = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(after.rows[0]).toEqual({ n: 0 });
  });
});
```

The third case is the one that matters. A reset helper that silently stopped resetting would pass the first two.

**Corrections made while building it, 2026-09-18.** The migration set is exported as
`CORE_MIGRATIONS`, not `coreMigrations`. `tenants.country` and `tenants.tax_id` are both `notNull`
(`packages/db/src/schema/tenants.ts:70-71`), so the two-column insert this sketch first carried
could not have run at all. And the first case's assertion is `{ n: 0 }` rather than the sketch's
`{ n: expect.any(Number) }`, matching `lifecycle.test.ts`'s own convention — `expect.any(Number)`
would accept a database that had not been emptied.

**A correction written here was itself false, and the run-it reviewer falsified it by running it**
— which is CLAUDE.md §1's "the correction is where the false claim is born", so it is recorded
rather than quietly fixed. This paragraph first said the two-column insert would make the THIRD case
fail for a not-null violation. It does not. Restoring that insert and running the suite fails the
SECOND case with SQLSTATE `23502`, naming the missing column; the first and third cases both pass,
because no row was ever written for the third to find. So the sketch as written would have reported
a reset that never happened as a pass.

**The control was run** (CLAUDE.md §4, prove by deletion): with the helper changed to
`usePgliteDb({ ...options, resetPerTest: false })`, exactly the third case fails
(`expected { n: 1 } to deeply equal { n: 0 }`) and the first two stay green — which is this
paragraph's claim, measured rather than asserted.

- [x] **Step 2: Run it and watch it fail** — done 2026-09-18: `Cannot find module './venue-db.js'`.

```bash
pnpm --filter @waitron/db test -- venue-db.test.ts
```

Expected: FAIL — `Cannot find module './venue-db.js'`.

- [x] **Step 3: Write the helper** — done 2026-09-18: `packages/db/src/testing/venue-db.ts`.

Create `packages/db/src/testing/venue-db.ts`:

```ts
import { usePgliteDb, type PgliteSuiteOptions, type PgliteSuite } from "./lifecycle.js";

export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

/**
 * The seam a PGlite suite asks for its database through, so that the storage switch changes one
 * function body rather than every call site.
 *
 * (The doc comment sits on the FUNCTION, not above the type aliases — every sibling helper in this
 * directory documents the function. And it does not say this is "the one way" a suite asks: that
 * sentence was in this sketch, and it is false until step 5's conversions land. The shipped
 * wording is in `packages/db/src/testing/venue-db.ts`; read that rather than this sketch.)
 */
export function useVenueDb(options: VenueDbOptions): VenueDb {
  return usePgliteDb(options);
}
```

- [x] **Step 4: Run the test and watch it pass** — done 2026-09-18: 3 passed.

```bash
pnpm --filter @waitron/db test -- venue-db.test.ts
```

Expected: PASS, all three.

- [ ] **Step 5: Convert package by package**

One pull request per package. Replace `usePgliteDb(` with `useVenueDb(` and fix the import. **Leave `useRealPostgres` and `describeEachTarget` alone** — and note, corrected twice on 2026-09-18 by following the call chain into `packages/db/src/testing/harness.ts` rather than reading this line, that the two are not alike and that neither correction licenses moving `describeEachTarget`.

`useRealPostgres` names a real container deliberately. `describeEachTarget` is NOT a real-container helper: it registers BOTH targets (`const allTargets: Target[] = [pgliteTarget, postgresTarget()]`) and, on the default path, skips the postgres half when Docker is absent — with `REQUIRE_DOCKER=1` set it throws instead (`resolveTargets`).

But its PGlite half is still not a candidate for this helper, and the first correction said it was. `pgliteTarget.create()` boots a FRESH WASM cluster PER TEST, called from each test's own `beforeEach`; `usePgliteDb` hands out ONE database per SUITE with a per-test TRUNCATE. Those are different isolation contracts, and `Target`'s own doc comment argues for the per-test one at length — including that there is deliberately no `target.db` accessor. Routing that half through here would change what the harness guarantees, so it is F1's question, as part of the 66-test disposition (task F1 step 24), not a mechanical conversion.

- [ ] **Step 6: Verify each package**

```bash
pnpm --filter <package> test:coverage
```

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Ask for a test database through one helper in <package>

Same PGlite database as before. The SQLite switch replaces the helper's body
rather than every call site."
```

---

## Task P3: The change log replaces the database's notifications

**Runner:** autonomous. **Depends on:** nothing.

`LISTEN`/`NOTIFY` goes. The triggers that compute what changed stay; instead of signalling out of the database, they write a row, and the transaction publishes those rows after it commits.

This shape is deliberate. Having write paths publish their own events would touch hundreds of call sites and would drift the moment one forgot. Keeping the trigger and changing only where it puts its output keeps the existing contract and lands green on PostgreSQL today.

**Files:**

- Create: `packages/db/src/change-log.ts`
- Create: `packages/db/src/change-log.test.ts`
- Modify: `packages/db/src/change-feed.ts` (the trigger writes a row instead of calling `pg_notify`)
- Modify: `packages/db/src/tenancy.ts` (publish after commit)
- Modify: `apps/server/src/boot.ts` (subscribe in process instead of starting a listener)
- Delete: `packages/db/src/change-listener.ts` and its test

**Interfaces:**

- Produces, consumed by F1 and by `apps/server`:
  - `createChangePublisher(): ChangePublisher` with `subscribe(fn: (change: ResourceChange) => void): () => void` and `publishPending(tx: Transaction): Promise<void>`
- Consumes: `ResourceChange` from `@waitron/shared`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/change-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";
import { createChangePublisher } from "./change-log.js";
import { CORE_MIGRATIONS } from "./migrations.js";

describe("the change log", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("publishes a change only after the transaction commits", async () => {
    const publisher = createChangePublisher();
    const seen: string[] = [];
    publisher.subscribe((change) => seen.push(change.resource));

    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`insert into dining_tables (id, label) values (gen_random_uuid(), 'T1')`);
      // Nothing may have been published yet: the transaction is still open.
      expect(seen).toEqual([]);
    });

    expect(seen).toEqual(["dining_tables"]);
  });

  it("publishes nothing when the transaction rolls back", async () => {
    const publisher = createChangePublisher();
    const seen: string[] = [];
    publisher.subscribe((change) => seen.push(change.resource));

    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.execute(sql`insert into dining_tables (id, label) values (gen_random_uuid(), 'T2')`);
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    expect(seen).toEqual([]);
  });
});
```

The second case is the control. A publisher that fired inside the transaction would pass the first case and fail this one.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- change-log.test.ts
```

Expected: FAIL — `Cannot find module './change-log.js'`.

- [ ] **Step 3: Add the change-log table to the core migration set**

In `packages/db/src/schema/`, add:

```ts
import { sql } from "drizzle-orm";
import { bigserial } from "drizzle-orm/pg-core";
import { json, label, table, ts } from "./columns.js";
import type { ResourceChange } from "@waitron/shared";

/**
 * What changed, written by the change trigger and drained by the transaction that caused it.
 *
 * Classified `local`: it is this node's outbound signal to its own dashboard, not venue data, and it
 * must never travel in a backup or a stream. Rows are deleted as they are published.
 */
export const changeLog = table("change_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  resource: label("resource").notNull(),
  payload: json<ResourceChange>("payload").notNull(),
  writtenAt: ts("written_at").notNull().defaultNow(),
});
```

Classify it in the core classification list as `local` (`CLAUDE.md` §3 requires every new table be classified; `scripts/classification-complete.test.ts` fails otherwise).

- [ ] **Step 4: Change the trigger to write a row**

In `packages/db/src/change-feed.ts`, replace the `pg_notify(...)` call in `waitron_notify_change()` with an insert into `change_log`. Leave everything the function computes exactly as it is — the payload shape is what `apps/server`'s live API already understands, and changing it here would break subscriptions for a reason unrelated to this task.

- [ ] **Step 5: Write the publisher**

Create `packages/db/src/change-log.ts`:

```ts
import { sql } from "drizzle-orm";
import type { ResourceChange } from "@waitron/shared";
import type { Transaction } from "./client.js";

export interface ChangePublisher {
  /** Registers a listener. Returns a function that removes it. */
  subscribe(fn: (change: ResourceChange) => void): () => void;
  /**
   * Drains the rows this transaction wrote and hands them to every listener.
   *
   * Called by `withTransaction` AFTER the commit succeeds. Before the commit the rows may still be
   * rolled away, and a listener that already saw them would be reporting a change that never
   * happened — which is what the rollback test asserts cannot occur.
   */
  publishPending(tx: Transaction): Promise<void>;
}

export function createChangePublisher(): ChangePublisher {
  const listeners = new Set<(change: ResourceChange) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async publishPending(tx) {
      const drained = await tx.execute<{ payload: ResourceChange }>(
        sql`delete from change_log returning payload`,
      );
      for (const row of drained.rows) for (const fn of listeners) fn(row.payload);
    },
  };
}
```

- [ ] **Step 6: Drain after the commit**

`withTransaction` must read the rows inside the transaction (so the delete is atomic with the write) but hand them to listeners only once the commit has returned. Change `packages/db/src/tenancy.ts`:

```ts
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let pending: ResourceChange[] = [];
  const result = await db.transaction(async (tx) => {
    const value = await fn(tx);
    pending = await drainChangeLog(tx);
    return value;
  });
  publisher.deliver(pending);
  return result;
}
```

Split `publishPending` into `drainChangeLog(tx)` (inside) and `deliver(changes)` (after) so the ordering is visible in the code rather than held in a comment.

- [ ] **Step 7: Run the tests and watch them pass**

```bash
pnpm --filter @waitron/db test -- change-log.test.ts
```

Expected: PASS, both cases.

- [ ] **Step 8: Rewire the server and delete the listener**

In `apps/server/src/boot.ts`, replace the `startChangeListener` block with a subscription to the publisher. Delete `packages/db/src/change-listener.ts` and `change-listener.test.ts`, and remove their exports from `packages/db/src/index.ts`.

- [ ] **Step 9: Record the behaviour change**

Add one line to `docs/developers/workflow-guide.md` in the dev-stack section: a script that writes the database directly no longer shows up on a running dashboard, because the signal now comes from the process that did the write. Development only.

- [ ] **Step 10: Run the affected suites**

```bash
pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/server test -- live
```

- [ ] **Step 11: Commit**

```bash
git commit -s -m "Signal dashboard changes through a table instead of the database's notifications

The trigger that works out what changed stays exactly as it was; it now writes
a row instead of signalling out of the database, and the transaction hands
those rows to listeners once it has committed. Two tests pin the ordering: a
change is published after the commit, and a rolled-back transaction publishes
nothing.

This works because a venue runs one server process against one database. A
development script that writes the database directly no longer appears on a
running dashboard, which is noted in the workflow guide."
```

---

## Task P4a: Claim jobs by update — printing, payments, the read-only gate

**Runner:** autonomous. **Depends on:** nothing.

`FOR UPDATE SKIP LOCKED` goes. The job rows stay in the database, so a crash still loses nothing; only the locking changes.

**Files:**

- Create: `packages/db/src/job-claim.ts`
- Create: `packages/db/src/job-claim.test.ts`
- Modify: `packages/printing/src/runtime.ts`, `packages/payments/src/store.ts`, `apps/server/src/read-only-gate.ts`

**Interfaces:**

- Produces, consumed by P4b and F1: `claimRows<T>(tx, spec: ClaimSpec): Promise<T[]>` where `ClaimSpec` names the table, the predicate selecting claimable rows, the columns to stamp on claim, and a limit.
- Consumes: `Transaction` from `packages/db/src/client.js`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/job-claim.test.ts`. The case that matters is that two claimers never get the same row:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";
import { claimRows } from "./job-claim.js";
import { CORE_MIGRATIONS } from "./migrations.js";

describe("claimRows", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  const seed = async () => {
    await suite.db.execute(sql`create table if not exists probe_jobs (
      id serial primary key, status text not null, claimed_at timestamptz)`);
    await suite.db.execute(sql`truncate probe_jobs`);
    await suite.db.execute(sql`insert into probe_jobs (status) select 'pending' from generate_series(1, 4)`);
  };

  it("claims at most the limit, and stamps them", async () => {
    await seed();
    const claimed = await withTransaction(suite.db, (tx) =>
      claimRows<{ id: number }>(tx, {
        table: "probe_jobs",
        claimable: sql`status = 'pending'`,
        set: sql`status = 'running', claimed_at = now()`,
        limit: 2,
      }),
    );
    expect(claimed).toHaveLength(2);
    const left = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from probe_jobs where status = 'pending'`,
    );
    expect(left.rows[0]?.n).toBe(2);
  });

  it("never hands the same row to two claimers", async () => {
    await seed();
    const both = await Promise.all([
      withTransaction(suite.db, (tx) =>
        claimRows<{ id: number }>(tx, { table: "probe_jobs", claimable: sql`status = 'pending'`, set: sql`status = 'a'`, limit: 4 }),
      ),
      withTransaction(suite.db, (tx) =>
        claimRows<{ id: number }>(tx, { table: "probe_jobs", claimable: sql`status = 'pending'`, set: sql`status = 'b'`, limit: 4 }),
      ),
    ]);
    const ids = both.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- job-claim.test.ts
```

Expected: FAIL — `Cannot find module './job-claim.js'`.

- [ ] **Step 3: Write the helper**

Create `packages/db/src/job-claim.ts`:

```ts
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "./client.js";

export interface ClaimSpec {
  /** The job table's name. A literal in the caller's own source, never user input. */
  readonly table: string;
  /** Which rows may be claimed. */
  readonly claimable: SQL;
  /** What claiming stamps on them. */
  readonly set: SQL;
  readonly limit: number;
}

/**
 * Claims up to `limit` rows by updating them, and returns the rows it claimed.
 *
 * One statement, so the select and the stamp cannot be separated by another claimer. This replaces
 * `FOR UPDATE SKIP LOCKED`: under SQLite there is one writer at a time, so skipping locked rows has
 * nothing to skip, and a conditional update is the whole mechanism.
 */
export async function claimRows<T>(tx: Transaction, spec: ClaimSpec): Promise<T[]> {
  const claimed = await tx.execute<T>(sql`
    update ${sql.identifier(spec.table)} set ${spec.set}
    where ctid in (
      select ctid from ${sql.identifier(spec.table)}
      where ${spec.claimable}
      order by ctid
      limit ${spec.limit}
      for update skip locked
    )
    returning *
  `);
  return claimed.rows;
}
```

Note in the comment that `for update skip locked` survives inside the subquery **for now**, because on PostgreSQL it is what makes the second test pass; F1 removes it along with `ctid`, which SQLite does not have. This is the one place a prepare item knowingly carries PostgreSQL-only SQL, and it is confined to one function instead of four.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @waitron/db test -- job-claim.test.ts
```

Expected: PASS, both.

- [ ] **Step 5: Move the three callers onto it**

`packages/printing/src/runtime.ts`, `packages/payments/src/store.ts` and `apps/server/src/read-only-gate.ts`. Keep each caller's existing predicate and stamped columns exactly — including the printing runtime's claim lease, whose reclaim predicate is behaviour this task must not change.

- [ ] **Step 6: Run the affected suites, including their concurrency tests**

```bash
pnpm --filter @waitron/printing test:coverage && \
pnpm --filter @waitron/payments test:coverage && \
pnpm --filter @waitron/server test -- read-only-gate
```

`packages/payments/src/forward.concurrency.test.ts` and `packages/printing/src/runtime.reclaim.test.ts` are the ones that matter. If either needs changing to pass, stop: a concurrency test rewritten to match new code hides the regression it exists to catch (`CLAUDE.md`, workflow preferences).

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Claim jobs with one conditional update

Printing, payments and the read-only gate claimed jobs by selecting them with
SKIP LOCKED and then updating them. They now do it in one statement through a
shared helper, which is the whole mechanism once the engine allows a single
writer at a time.

Behaviour is unchanged on PostgreSQL, including the printing claim lease: both
packages' concurrency tests pass unmodified."
```

---

## Task P4b: Claim jobs by update — the fiscal drain

**Runner: owner review.** **Depends on:** P4a.

The same change for `packages/fiscal-verifactu/src/drain.ts`. Separate because a mistake here delays or duplicates a filing to the tax agency.

**Files:**

- Modify: `packages/fiscal-verifactu/src/drain.ts`
- Test: `packages/fiscal-verifactu/src/drain.concurrency.test.ts` (must pass unmodified)

**Interfaces:**

- Consumes: `claimRows` from P4a.
- Produces: nothing new.

- [ ] **Step 1: Read the drain and its containment test first**

```bash
sed -n '1,120p' packages/fiscal-verifactu/src/drain.ts
cat packages/fiscal-verifactu/src/drain.containment.test.ts
```

`claimBatch` is node-filterless by design (recorded in the topology design's Fable review). Do not add a node filter while you are in here.

- [ ] **Step 2: Run the concurrency test and record that it passes now**

```bash
pnpm --filter @waitron/fiscal-verifactu test -- drain.concurrency
```

Expected: PASS. This is the before-reading; without it a pass afterwards proves nothing.

- [ ] **Step 3: Move `claimBatch` onto `claimRows`**

Keep the predicate, the stamped columns and the batch limit exactly as they are.

- [ ] **Step 4: Run the concurrency and containment tests unmodified**

```bash
pnpm --filter @waitron/fiscal-verifactu test -- drain
```

Expected: PASS, with no test file modified. If a test needs changing, stop and report why.

- [ ] **Step 5: Run the package suite**

```bash
pnpm --filter @waitron/fiscal-verifactu test:coverage
```

- [ ] **Step 6: Commit and open the pull request — do not land it**

```bash
git commit -s -m "Claim fiscal records for sending with one conditional update

The same change printing and payments took, applied to the drain that sends
records to the tax agency. The predicate, the stamped columns and the batch
limit are unchanged, and the drain's concurrency and containment tests pass
without being edited."
```

Leave the pull request open for the owner.

---

## Task P5: Money becomes whole cents

**Runner: owner review.** **Depends on:** P1.

23 columns at precision 12, scale 2 become integers counting cents. This is the change the topology design gates with a byte-identical hash comparison, because the arithmetic that feeds the tax record's formatted amounts changes even though the stored fields do not.

**Files:**

- Modify: `packages/db/src/schema/columns.ts` (the `money` helper)
- Modify: every schema file declaring a money column, via the helper — no per-column edits needed if P1 landed correctly
- Create: `packages/fiscal-verifactu/src/money-conversion.huella.test.ts`
- Modify: the read and write paths that do arithmetic on money
- Migration: a new generated migration per affected package

**Interfaces:**

- Consumes: `money(name)` from P1.
- Produces: money values are `number` in cents everywhere. A value that was `"12.34"` is now `1234`.

- [ ] **Step 1: Write the failing test — the one that catches a rounding drift**

Create `packages/fiscal-verifactu/src/money-conversion.huella.test.ts`. It records what the current code produces, then asserts the converted code produces exactly the same bytes. Capture the expected values by running the current code once and pasting them in — a test that computes the expected value the same way as the code under test proves nothing.

```ts
import { describe, expect, it } from "vitest";
import { computeHuella } from "@waitron/verifactu";
import { buildAltaFromSale } from "./alta.js";
import { SHARED_ALTA_FIXTURE } from "./testing/fixtures.js";

/**
 * The money conversion changes the arithmetic that produces these strings, not the columns that
 * store them — those are already text. A rounding difference is therefore the whole risk, and it
 * shows up here as a different byte, nowhere else.
 *
 * The expected values below were produced by the code BEFORE the conversion and pasted in. They are
 * deliberately literals: computing them would run the same arithmetic the test is checking.
 */
describe("the money conversion does not move a single byte of a fiscal record", () => {
  it("produces the same CuotaTotal, ImporteTotal and huella", () => {
    const alta = buildAltaFromSale(SHARED_ALTA_FIXTURE);
    expect(alta.CuotaTotal).toBe("21.00");
    expect(alta.ImporteTotal).toBe("121.00");
    expect(computeHuella(alta)).toBe("PASTE THE HASH FROM THE PRE-CONVERSION RUN");
  });
});
```

- [ ] **Step 2: Fill in the expected values from the current code**

```bash
pnpm --filter @waitron/fiscal-verifactu test -- money-conversion.huella
```

It fails and prints what the current code actually produced. Paste those three values in. **Run it again and watch it pass on the unconverted code** — that is what makes it a real before-reading rather than a guess.

- [ ] **Step 3: Change the helper**

In `packages/db/src/schema/columns.ts`:

```ts
/**
 * A monetary amount, in whole cents.
 *
 * Integer cents rather than a decimal type: SQLite has no exact decimal, and a float cannot
 * represent a cent exactly. The name says cents so a caller cannot read it as units.
 */
export const money = (name: string) => integer(name);
```

- [ ] **Step 4: Find every place that reads or writes a money value**

```bash
grep -rn "\bmoney(" packages apps --include='*.ts' | grep -v node_modules | grep -v '.test.ts'
```

For each column the helper declares, follow its reads and writes. A value that arrived as a string like `"12.34"` now arrives as `1234`. Convert at the edges — the wire types and the formatting that produces a receipt or a fiscal amount — never in the middle, or two representations will circulate.

- [ ] **Step 5: Run the byte-identical test and watch it pass**

```bash
pnpm --filter @waitron/fiscal-verifactu test -- money-conversion.huella
```

Expected: PASS, against the literals captured before the conversion. **A failure here is a real rounding difference; do not update the literals.**

- [ ] **Step 6: Re-run the shared fixture against the real fiscal check**

`CLAUDE.md` §4: a fixture no check reads is unverified data.

```bash
pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/verifactu test:coverage
```

- [ ] **Step 7: Generate the migrations**

```bash
pnpm --filter <package> exec drizzle-kit generate --name money_in_cents
```

One per affected package. Pre-production, so the migration drops and recreates the column type; no data migration.

- [ ] **Step 8: Run the packages that do money arithmetic**

```bash
pnpm --filter @waitron/core test:coverage && \
pnpm --filter @waitron/payments test:coverage && \
pnpm --filter @waitron/reporting test:coverage && \
pnpm --filter @waitron/purchasing test:coverage && \
pnpm --filter @waitron/server test:coverage
```

- [ ] **Step 9: Commit and open the pull request — do not land it**

```bash
git commit -s -m "Hold money as whole cents

SQLite has no exact decimal type and a float cannot hold a cent exactly, so the
23 money columns become integers counting cents. The columns that store the tax
record's amounts are text and do not change; what changes is the arithmetic
that produces those strings, so a rounding difference is the whole risk.

A new test pins it: the shared sale fixture must produce byte-identical
CuotaTotal, ImporteTotal and huella. The expected values were captured from the
code before this change and pasted in as literals, so the test is comparing
against the old behaviour rather than recomputing it."
```

---

## Task P6: Quantities and rates get their own scales

**Runner: owner review.** **Depends on:** P1.

Two quantity columns at scale 3 become whole thousandths; five rate columns at scale 2 become whole basis points. Separate from P5 because the scales differ and a single blanket conversion would silently truncate them — the trap the topology design's Fable review named.

**Files:**

- Modify: `packages/db/src/schema/columns.ts` (`quantity` and `rate`)
- Create: `packages/db/src/schema/columns.scale.test.ts`
- Modify: the read and write paths that do arithmetic on quantities and rates

**Interfaces:**

- Consumes: `quantity(name)`, `rate(name)` from P1.
- Produces: a quantity is a `number` of thousandths (1.5 kg is `1500`); a rate is a `number` of basis points (21% is `2100`).

**`convenio_config.night_premium_pct` is a PERCENTAGE** (owner decision 2026-09-18, settled while
P1b's `packages/workforce-es` report above flagged that the tree said it two ways). So it converts to
basis points exactly like the four VAT-style rate columns — `25.00`% becomes `2500` — with no special
handling. One consequence for the Files list above: this fifth column is declared in
`packages/workforce-es/src/schema/convenio-config.ts` and lives in that package's own migration set,
so P6 reaches past `packages/db`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/columns.scale.test.ts`. The case that matters is the one a blanket conversion gets wrong:

```ts
import { describe, expect, it } from "vitest";
import { fromThousandths, toThousandths, fromBasisPoints, toBasisPoints } from "./columns.js";

describe("quantity and rate keep their own scales", () => {
  it("holds three decimal places of quantity without loss", () => {
    expect(toThousandths("0.005")).toBe(5);
    expect(fromThousandths(5)).toBe("0.005");
    // The failure a cents-shaped conversion produces: 0.005 truncated to 0.00.
    expect(toThousandths("0.005")).not.toBe(0);
  });

  it("holds two decimal places of a rate without loss", () => {
    expect(toBasisPoints("21.00")).toBe(2100);
    expect(toBasisPoints("10.50")).toBe(1050);
    expect(fromBasisPoints(1050)).toBe("10.50");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- columns.scale
```

Expected: FAIL — the four conversion functions do not exist.

- [ ] **Step 3: Change the helpers and add the conversions**

```ts
/** A quantity, in whole thousandths. 1.5 kg is 1500. */
export const quantity = (name: string) => integer(name);

/** A percentage rate, in whole basis points. 21% is 2100. */
export const rate = (name: string) => integer(name);

export const toThousandths = (value: string): number => Math.round(Number(value) * 1000);
export const fromThousandths = (value: number): string => (value / 1000).toFixed(3);
export const toBasisPoints = (value: string): number => Math.round(Number(value) * 100);
export const fromBasisPoints = (value: number): string => (value / 100).toFixed(2);
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @waitron/db test -- columns.scale
```

- [ ] **Step 5: Convert the callers**

The two quantity columns and five rate columns (`vat_rate` twice, `deductible_proportion`, `night_premium_pct`, `rate`). `vat_rate` feeds the tax record, so run the byte-identical test from P5 again afterwards:

```bash
pnpm --filter @waitron/fiscal-verifactu test -- money-conversion.huella
```

Expected: PASS, against the same literals. A failure means a rate rounding changed a filed amount.

- [ ] **Step 6: Generate the migrations and run the suites**

```bash
pnpm --filter <package> exec drizzle-kit generate --name scaled_integers
pnpm --filter @waitron/catalogue test:coverage && \
pnpm --filter @waitron/workforce test:coverage && \
pnpm --filter @waitron/workforce-es test:coverage && \
pnpm --filter @waitron/purchasing test:coverage
```

- [ ] **Step 7: Commit and open the pull request — do not land it**

```bash
git commit -s -m "Hold quantities in thousandths and rates in basis points

Quantities carry three decimal places and rates carry two, so neither can
become cents: a blanket conversion would turn 0.005 kg into nothing. Each keeps
its own scale as a whole number, with conversions named after the scale so a
caller cannot mix them up.

One rate feeds the tax record, so the byte-identical fixture test from the money
change is re-run here and passes against the same recorded values."
```

---

## Task P7: No foreign key may cross between the two files

**Runner:** autonomous. **Depends on:** nothing.

`venue.db` holds everything classified `ledger` or `state`; `node.db` holds everything classified `local`. Two files can only be backed up independently if no foreign key points across. Enumerate the crossings, resolve each, and guard the rule.

**Files:**

- Create: `scripts/two-file-foreign-keys.test.ts`
- Modify: whichever schema files hold a crossing edge

**Interfaces:**

- Consumes: the classification lists each module contributes.
- Produces: the guarantee F1's two-file split depends on.

- [ ] **Step 1: Enumerate the crossings before writing any code**

The spec's §11 requires this list to exist before anything is changed.

```bash
grep -rn "references(" packages apps --include='*.ts' | grep -v node_modules | grep -v '.test.ts'
```

For each foreign key, look up both tables' classifications. Write the crossing edges into the pull request description — table, referenced table, both classifications, and the resolution chosen.

- [ ] **Step 2: Write the failing guard**

Create `scripts/two-file-foreign-keys.test.ts`. It belongs in the ROOT Vitest project, which the ungated lint job and the hook run on every non-docs push (`CLAUDE.md` §4).

```ts
import { describe, expect, it } from "vitest";
import { fileOfClass, classificationOf, allForeignKeys } from "./classification-helpers.js";

/**
 * Two files, and nothing joining them at the database level.
 *
 * `venue.db` holds `ledger` and `state`; `node.db` holds `local`. A foreign key across the two
 * would make it impossible to back up or restore either on its own, which is the whole point of
 * splitting them.
 *
 * This guard reads the schema's declared foreign keys. A foreign key written by hand in a custom
 * migration is invisible to it — several tables carry those deliberately (`drawer_opens.till_id`,
 * for one), so a crossing edge added that way passes. That is a real gap, not a rounding of one.
 */
describe("the two database files are independent", () => {
  it("has no foreign key crossing between them", () => {
    const crossings = allForeignKeys()
      .map((fk) => ({ ...fk, from: fileOfClass(classificationOf(fk.table)), to: fileOfClass(classificationOf(fk.references)) }))
      .filter((fk) => fk.from !== fk.to);
    expect(crossings).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail with the real list**

```bash
pnpm vitest run scripts/two-file-foreign-keys.test.ts
```

Expected: FAIL, naming the crossings found in step 1. If it passes on the first run, the guard is not reading what you think — check it against a deliberately added crossing before believing it.

- [ ] **Step 4: Prove the guard by deletion**

Add a temporary crossing foreign key, confirm the guard fails, remove it. `CLAUDE.md` §4: prove a guard by deletion, and confirm the negative control fails for the reason you think.

- [ ] **Step 5: Resolve each crossing**

Per the topology design's §2.1, resolve by moving the column or denormalising — not by weakening the classification. A `local` session row that needs a `state` config value carries a copy of the value, not a reference to it.

- [ ] **Step 6: Run the guard and the full root project**

```bash
pnpm vitest run scripts/two-file-foreign-keys.test.ts && pnpm test:coverage
```

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Stop foreign keys crossing between the two database files

The SQLite switch puts this node's own identity in one file and the venue in
another, so that a follower can hold an exact copy of the venue without
overwriting who it is. That only works if neither file's rows point into the
other's.

A guard in the root project now fails on a crossing foreign key, proven by
adding one and watching it fail. It reads the schema's declared foreign keys,
so one written by hand in a custom migration is invisible to it."
```

---

## Task P8: Delete the failover code that is shaped around PostgreSQL

**Runner:** autonomous. **Depends on:** nothing.

`packages/sync` and the routes built on publications, subscriptions and write-position fences go. Slices 3–4 rebuild failover on the new mechanism. Everything engine-agnostic stays.

**Files:**

- Delete: `packages/sync` entirely
- Delete: the `apps/server/src` routes and their tests that depend on replication — determined in step 1, not guessed
- Keep: `packages/membership` entirely, enrolment, enrolment rate limiting, node retirement
- Modify: `packages/composition`, `apps/server/src/boot.ts`, and any package manifest depending on `@waitron/sync`
- Modify: `docs/backlog.md`

**Interfaces:**

- Produces: a tree with no logical-replication code.
- Consumes: nothing.

- [ ] **Step 1: Separate engine-agnostic from PostgreSQL-shaped, and write the list down**

```bash
grep -rln "@waitron/sync\|publication\|subscription\|fenceLsn\|FenceLsn\|pg_current_wal" packages apps --include='*.ts' | grep -v node_modules
```

For each file, decide: does it depend on how PostgreSQL replicates, or only on membership documents and trust? Put the two lists in the pull request description. **Deleting something engine-agnostic is the failure mode here** — `packages/membership`'s signing and canonicalisation are needed unchanged by slices 3–5.

- [ ] **Step 2: Record what this removes, before removing it**

Add a dated note to `docs/backlog.md` under the failover work: from this change until slice 3, a venue has one node and no failover, and the MVP requirement is met by slices 3–5. `CLAUDE.md` §6 requires the backlog be updated in the same change that makes it stale.

- [ ] **Step 3: Delete, and let the compiler find the callers**

```bash
rm -rf packages/sync
pnpm -r typecheck
```

Work through what breaks. Each break is either a caller to delete or an engine-agnostic use that needs its dependency moved.

- [ ] **Step 4: Delete the tests whose subject no longer exists**

`packages/replication-tests` exists because a test-only dependency closed a workspace dependency loop. If nothing is left for it to test, delete the package and note it; if something is, leave it.

- [ ] **Step 5: Check the guards that referenced the deleted code**

```bash
pnpm vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/live-subscriptions.test.ts
```

`scripts/module-seams.test.ts`'s allowlist may shrink — shrink it, never grow it (`CLAUDE.md` §3).

- [ ] **Step 6: Run the workspace typecheck and the root project**

```bash
pnpm -r typecheck && pnpm test:coverage
```

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Remove the failover code built on PostgreSQL replication

Failover is being rebuilt on a different mechanism in slices 3 and 4, and none
of the publication, subscription and write-position machinery survives that
change. Keeping it compiling in the meantime would mean carrying code that does
nothing for several slices.

What stays is everything that does not depend on how PostgreSQL replicates:
membership documents and their signing, trust sets, enrolment, enrolment rate
limiting and node retirement. From here until slice 3 a venue has one node and
no failover, which the backlog now records."
```

---

## Task P9: A guard for what grants stop enforcing

**Runner:** autonomous. **Depends on:** nothing.

Today PostgreSQL refuses a request path that inserts into `tenants`, because every request transaction assumes a role that lacks the privilege. After the flip nothing refuses it. Write the guard now, while the grants still exist to check it against.

**Files:**

- Create: `scripts/write-path-tables.test.ts`
- Create: `scripts/write-path-tables.json` (the declared allowances)

**Interfaces:**

- Produces: a guard that fails when a write path touches a table it has no business writing.
- Consumes: the existing grant definitions, as the source of truth for what the allowances should be.

- [ ] **Step 1: Read what the grants actually say**

```bash
grep -rn "grant \|revoke " packages/db/drizzle/*.sql packages/*/drizzle/*.sql | grep -iv "^.*--"
```

Write the list of tables `app_user` may not write into the pull request description. This list is the evidence; after the flip it is gone.

- [ ] **Step 2: Write the failing guard**

Create `scripts/write-path-tables.test.ts` in the root project:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sourceFilesIn } from "./source-files.js";

/**
 * What grants enforce today, enforced by reading the source instead.
 *
 * Every request transaction currently assumes a role that cannot, for instance, insert into
 * `tenants`, so PostgreSQL refuses the write. SQLite has no roles, so after the storage switch
 * nothing refuses it. This guard is the replacement.
 *
 * It reads TEXT: a write assembled from a variable table name, or reached through a helper this
 * guard does not follow, is invisible to it. It is therefore weaker than "no write path touches a
 * forbidden table" — it catches the written-down case, which is the case that has actually occurred.
 */
const FORBIDDEN: Record<string, readonly string[]> = JSON.parse(
  await readFile(new URL("./write-path-tables.json", import.meta.url), "utf8"),
);

describe("request paths do not write tables they have no business writing", () => {
  it("finds no forbidden write", async () => {
    const offenders: string[] = [];
    for (const file of sourceFilesIn(["apps/server/src", "packages"])) {
      const text = await readFile(file, "utf8");
      for (const [table, allowed] of Object.entries(FORBIDDEN)) {
        if (allowed.some((a) => file.endsWith(a))) continue;
        const writes = new RegExp(`(insert\\s+into\\s+${table}\\b|\\.insert\\(${table}\\b|\\.update\\(${table}\\b|\\.delete\\(${table}\\b)`, "i");
        if (writes.test(text)) offenders.push(`${file} writes ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the allowances from the grants, not from what compiles**

`scripts/write-path-tables.json` maps each table to the files legitimately allowed to write it — the provisioner, a migration runner. Derive it from step 1's grant list. **If a request-path file needs adding to make the guard pass, stop:** either the grant is being violated today and you have found a real defect, or the guard's pattern is wrong. Establish which before adding an allowance (`CLAUDE.md` §3: never widen a grant to make a test pass).

- [ ] **Step 4: Prove the guard by deletion**

Add a deliberate `insert into tenants` to a request-path file, run the guard, confirm it fails naming that file, then remove it.

```bash
pnpm vitest run scripts/write-path-tables.test.ts
```

- [ ] **Step 5: Check it agrees with the database**

The point of writing it now. Pick one forbidden table and confirm the database refuses the write today:

```bash
pnpm --filter @waitron/db test -- grants
```

Record in the pull request which grant assertion you read, and that the guard's list matches it.

- [ ] **Step 6: Run the root project**

```bash
pnpm test:coverage
```

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Guard the writes that grants currently refuse

Every request transaction assumes a database role that cannot write certain
tables, so PostgreSQL refuses those writes today. SQLite has no roles, so after
the storage switch nothing would.

This guard reads the source and fails when a write path touches a table it has
no business writing. Its list comes from the grants themselves, checked against
them while they still exist, and it was proven by adding a forbidden write and
watching it fail. It reads text, so a write assembled from a variable table
name is invisible to it."
```

---

## Task P10: Ask which columns a refusal names, not which constraint

**Runner: owner review.** **Depends on:** nothing.

Write paths translate a database refusal into a domain error by matching the **name** of the violated constraint. SQLite does not report a constraint name — it reports the table and columns. Change what the callers ask now, answered from PostgreSQL today and from the message after the flip.

**Files:**

- Create: `packages/db/src/constraint-target.ts`
- Create: `packages/db/src/constraint-target.test.ts`
- Modify: `packages/db/src/unique-violation.ts`
- Modify: the 23 non-test files that call the four helpers
- Modify: `packages/fiscal-verifactu/src/chain.ts` and `packages/workforce/src/chain.ts` (each carries its own copy of the cause-chain walk)

**Interfaces:**

- Produces, consumed by F1:
  - `constraintTarget(error: unknown): { table: string; columns: readonly string[] } | undefined`
  - `isUniqueViolation(error: unknown): boolean` — kept, its body re-expressed
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/constraint-target.test.ts`. Drive it through a real refusal, not a hand-built error object — a fake error proves only that the parser reads the fake.

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./testing/venue-db.js";
import { constraintTarget, isUniqueViolation } from "./constraint-target.js";
import { CORE_MIGRATIONS } from "./migrations.js";

describe("constraintTarget", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  const violate = async (statements: string[]): Promise<unknown> => {
    try {
      for (const s of statements) await suite.db.execute(sql.raw(s));
      throw new Error("expected a refusal");
    } catch (error) {
      return error;
    }
  };

  it("names the table and column of a unique violation", async () => {
    const error = await violate([
      `create table if not exists probe_people (id int primary key, email text,
         constraint probe_people_email_key unique (email))`,
      `delete from probe_people`,
      `insert into probe_people values (1, 'a@x')`,
      `insert into probe_people values (2, 'a@x')`,
    ]);
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({ table: "probe_people", columns: ["email"] });
  });

  it("names both columns of a multi-column unique constraint", async () => {
    const error = await violate([
      `create table if not exists probe_pairs (a int, b int,
         constraint probe_pairs_ab_key unique (a, b))`,
      `delete from probe_pairs`,
      `insert into probe_pairs values (1, 2)`,
      `insert into probe_pairs values (1, 2)`,
    ]);
    expect(constraintTarget(error)).toEqual({ table: "probe_pairs", columns: ["a", "b"] });
  });

  it("returns undefined for an error that is not a constraint violation", async () => {
    const error = await violate([`select * from a_table_that_does_not_exist`]);
    expect(constraintTarget(error)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- constraint-target
```

Expected: FAIL — `Cannot find module './constraint-target.js'`.

- [ ] **Step 3: Write it against what PostgreSQL reports today**

PostgreSQL gives the constraint name on `.constraint` and the columns in `.detail`, as `Key (email)=(a@x) already exists.` Parse the columns from `detail`; fall back to looking the constraint name up if `detail` is absent, which PGlite sometimes makes it.

```ts
/**
 * Which table and columns did this refusal name?
 *
 * Callers used to match the constraint's NAME. SQLite does not report one — it reports
 * `UNIQUE constraint failed: people.email` and nothing else, even for an explicitly named
 * constraint — so the question every caller asks has to change before the engine does.
 *
 * Walks the cause chain because Drizzle wraps every failed query, and the driver's error is
 * underneath. Stops at a fixed depth so a self-referential cause cannot spin.
 */
export function constraintTarget(
  error: unknown,
): { table: string; columns: readonly string[] } | undefined {
  // ...walk, then parse `detail` for "Key (a, b)=..." and take `.table` from the error
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @waitron/db test -- constraint-target
```

Expected: PASS, all three.

- [ ] **Step 5: Move the callers**

Each caller that matched a constraint name now matches a table and column list. Work through them package by package; the full list is:

```bash
grep -rln "uniqueViolationConstraint(\|pgErrorConstraint(" packages apps --include='*.ts' | grep -v node_modules
```

The two chain retries — `packages/fiscal-verifactu/src/chain.ts` and `packages/workforce/src/chain.ts` — each carry their own copy of the cause-chain walk. Consolidate them onto the shared helper here, which is the follow-up `unique-violation.ts`'s own comment names.

- [ ] **Step 6: Run every affected package**

```bash
pnpm --filter @waitron/identity test:coverage && \
pnpm --filter @waitron/core test:coverage && \
pnpm --filter @waitron/fiscal-verifactu test:coverage && \
pnpm --filter @waitron/workforce test:coverage && \
pnpm --filter @waitron/printing test:coverage && \
pnpm --filter @waitron/server test:coverage
```

The chain-append race tests are the ones to watch. If one needs editing to pass, stop and report.

- [ ] **Step 7: Commit and open the pull request — do not land it**

```bash
git commit -s -m "Match a database refusal by its table and columns, not the constraint's name

Several write paths turn a refusal into a proper domain error by matching the
name of the constraint that was violated, so each translates only its own and
re-throws the rest. SQLite does not report a constraint name at all: it reports
the table and column, and it does so even when the constraint was named.

So the question changes now, while PostgreSQL can still answer it both ways.
The chain retries in the fiscal and working-time packages each carried their own
copy of the error walk; both now use the shared one. Their race tests pass
unedited."
```

---

## Task F1: The flip

**Runner: owner review.** **Depends on:** every prepare item.

One pull request. Everything in it has to change at once, because a table defined with Drizzle's PostgreSQL builder and one defined with its SQLite builder cannot share a schema.

It is still built in order, with a commit and a passing check at each step. Work top to bottom; do not start a step while the one above it is red.

**Files:**

- Create: `packages/store/` — `index.ts`, `node-sqlite-adapter.ts`, `write-queue.ts`, `append-only.ts`, `archive.ts`, and a test beside each
- Modify: `packages/db/src/schema/columns.ts`, `packages/db/src/client.ts`, `packages/db/src/tenancy.ts`, `packages/db/src/testing/venue-db.ts`, `packages/db/src/job-claim.ts`, `packages/db/src/constraint-target.ts`
- Regenerate: all twelve migration sets
- Delete: `apps/server/src/pg-restore.ts`, the PostgreSQL test harness files, `scripts/append-only-enable-always.test.ts`

**Interfaces:**

- Consumes: everything the prepare phase produced.
- Produces: `openVenueStore(config): VenueStore` with `venue: Database`, `node: Database`, `close(): Promise<void>`; `withWriteLock<T>(fn: () => Promise<T>): Promise<T>`; `archiveTo(path: string): Promise<void>`.

### Step group 1 — the adapter

- [ ] **Step 1: Write the failing test**

Create `packages/store/src/node-sqlite-adapter.test.ts`. Cover each thing the spec says the adapter must do, because each was a separate discovery:

```ts
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, integer, text, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { adaptNodeSqlite } from "./node-sqlite-adapter.js";

const t = sqliteTable("t", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  doc: blob("doc", { mode: "json" }),
});

const open = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("create table t (id integer primary key, name text not null, doc blob)");
  return { raw, db: drizzle(adaptNodeSqlite(raw)) };
};

describe("the node:sqlite adapter", () => {
  it("reads back what it writes", () => {
    const { db } = open();
    db.insert(t).values({ id: 1, name: "a", doc: { k: 1 } }).run();
    expect(db.select().from(t).all()).toEqual([{ id: 1, name: "a", doc: { k: 1 } }]);
    expect(db.select().from(t).get()).toEqual({ id: 1, name: "a", doc: { k: 1 } });
  });

  it("supplies the raw-array mode Drizzle asks for", () => {
    const { db } = open();
    db.insert(t).values({ id: 1, name: "a" }).run();
    // Drizzle uses this path for joins and relational reads; without it, columns come back undefined.
    expect(db.all(sql`select id, name from t`)).toEqual([{ id: 1, name: "a" }]);
  });

  it("supplies the transaction method the migration runner calls", () => {
    const { raw } = open();
    const client = adaptNodeSqlite(raw);
    const wrapped = client.transaction(() => {
      client.exec("insert into t (id, name) values (9, 'x')");
      return "done";
    });
    expect(wrapped()).toBe("done");
    expect(raw.prepare("select count(*) as n from t").get().n).toBe(1);
  });

  it("rolls back when the wrapped function throws", () => {
    const { raw } = open();
    const client = adaptNodeSqlite(raw);
    const wrapped = client.transaction(() => {
      client.exec("insert into t (id, name) values (9, 'x')");
      throw new Error("deliberate");
    });
    expect(() => wrapped()).toThrow("deliberate");
    expect(raw.prepare("select count(*) as n from t").get().n).toBe(0);
  });
});
```

The last case is the control: a transaction wrapper that never rolls back passes the third case and fails this one.

- [ ] **Step 2: Run it and watch it fail, then write the adapter**

```bash
pnpm --filter @waitron/store test -- node-sqlite-adapter
```

```ts
import type { DatabaseSync } from "node:sqlite";

/**
 * Lets Drizzle's `better-sqlite3` driver drive Node's own SQLite.
 *
 * Drizzle publishes no driver for `node:sqlite` (checked against the installed and the newest
 * published version, 0.45.2 in both cases), and `better-sqlite3` would add a compiled module to the
 * box image for an engine Node already contains. The two APIs differ in exactly two places, both
 * covered here: Drizzle toggles a raw-array result mode through `raw()`, which maps onto
 * `setReturnArrays`; and Drizzle's migration runner calls `transaction(fn)` on the client, which
 * `node:sqlite` does not provide.
 */
export function adaptNodeSqlite(db: DatabaseSync) {
  const client = {
    prepare(query: string) {
      const stmt = db.prepare(query);
      let rawMode = false;
      const api = {
        run: (...p: unknown[]) => stmt.run(...p),
        all: (...p: unknown[]) => { stmt.setReturnArrays(rawMode); return stmt.all(...p); },
        get: (...p: unknown[]) => { stmt.setReturnArrays(rawMode); return stmt.get(...p); },
        values: (...p: unknown[]) => {
          stmt.setReturnArrays(true);
          const rows = stmt.all(...p);
          stmt.setReturnArrays(rawMode);
          return rows;
        },
        raw(on = true) { rawMode = on; return api; },
      };
      return api;
    },
    exec: (query: string) => db.exec(query),
    close: () => db.close(),
    transaction<A extends unknown[], R>(fn: (...args: A) => R) {
      return (...args: A): R => {
        client.exec("begin");
        try {
          const result = fn(...args);
          client.exec("commit");
          return result;
        } catch (error) {
          client.exec("rollback");
          throw error;
        }
      };
    },
  };
  return client;
}
```

- [ ] **Step 3: Watch the tests pass, then commit**

```bash
pnpm --filter @waitron/store test -- node-sqlite-adapter
git commit -s -m "Let Drizzle drive Node's own SQLite"
```

### Step group 2 — the write queue

- [ ] **Step 4: Write the failing test — the one the spec's probe became**

Create `packages/store/src/write-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createWriteQueue } from "./write-queue.js";

describe("the write queue", () => {
  it("does not let one transaction's rollback take another's row", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t (id integer primary key, who text)");
    const queue = createWriteQueue(db);

    const txn = async (who: string, fail: boolean) =>
      queue.run(async () => {
        db.prepare("insert into t (who) values (?)").run(who);
        await new Promise((r) => setImmediate(r));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([txn("A", true), txn("B", false)]);

    // Without the queue: B cannot even begin, and A's rollback destroys B's row.
    expect(db.prepare("select who from t").all()).toEqual([{ who: "B" }]);
  });

  it("runs queued work in the order it arrived", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t (id integer primary key, who text)");
    const queue = createWriteQueue(db);
    await Promise.all(["A", "B", "C"].map((who) =>
      queue.run(async () => { db.prepare("insert into t (who) values (?)").run(who); })));
    expect(db.prepare("select who from t order by id").all().map((r) => r.who)).toEqual(["A", "B", "C"]);
  });
});
```

- [ ] **Step 5: Run it, watch it fail, and write the queue**

```bash
pnpm --filter @waitron/store test -- write-queue
```

```ts
/**
 * One write transaction at a time.
 *
 * SQLite permits a single writer whatever we do, so this matches the engine rather than working
 * around it. It is required, not prudent: two request-shaped transactions started without waiting
 * for each other on one connection collide — the second cannot begin, and the first one's rollback
 * destroys the row the second already inserted. The first test above is that failure, and it passes
 * only because of this queue.
 *
 * `begin immediate` rather than `begin`: it takes the write lock up front, so a transaction cannot
 * get partway through and then fail to upgrade.
 */
export function createWriteQueue(db: DatabaseSync) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const mine = tail.then(async () => {
        db.exec("begin immediate");
        try {
          const result = await fn();
          db.exec("commit");
          return result;
        } catch (error) {
          db.exec("rollback");
          throw error;
        }
      });
      tail = mine.catch(() => undefined);
      return mine;
    },
  };
}
```

- [ ] **Step 6: Watch both pass, then prove the queue by deletion**

Replace `queue.run(fn)` with a direct call for one run and confirm the first test fails. Restore it.

```bash
pnpm --filter @waitron/store test -- write-queue
git commit -s -m "Serialise write transactions, because SQLite has one writer"
```

### Step group 3 — the store

- [ ] **Step 7: Write the failing test for the two files**

```ts
it("keeps this node's identity out of the venue file", async () => {
  const store = await openVenueStore({ directory: tmp });
  await store.venue.execute(sql`select 1`);
  await store.node.execute(sql`select 1`);
  // The venue file must not contain a local table, and vice versa.
  const venueTables = await store.venue.all<{ name: string }>(sql`select name from sqlite_master where type='table'`);
  expect(venueTables.map((t) => t.name)).not.toContain("sessions");
});
```

- [ ] **Step 8: Write `openVenueStore`**

Two Drizzle instances, one per file — a Drizzle table cannot name a table in an attached file, which was read off the SQL it emits. `ATTACH` stays available on the write connection for hand-written cross-file SQL.

Pragmas: write-ahead mode, `busy_timeout = 5000`, `foreign_keys = ON`. **Leave automatic checkpointing at SQLite's default.** The topology design sets it to zero, which is right only once Litestream does the checkpointing instead; that arrives in slice 2. Put that reason in a comment, because the next reader will otherwise "fix" it to match the design.

- [ ] **Step 9: Wire the new package into the guards that read members by name**

`packages/store` is a new workspace member, and three root guards fail until it is wired in — see
Global Constraints for the measurement. Three things to add:

- `packages/store/vitest.config.ts`, carrying the coverage bar this package is assigned.
  `scripts/coverage-thresholds.test.ts` pins which bar; `packages/store` holds fiscal-adjacent
  machinery — the write queue and the append-only triggers — so it takes the higher `98/98/98/95`
  bar, not the general floor. Say so in the pull request rather than leaving it to be inferred.
- The shard lists in `scripts/changed-scope.mjs`.
- The corresponding subtraction in `.github/workflows/ci.yml`.

Do **not** add it to `PACKAGES_WITHOUT_TESTS` — that list is for members declaring no `test:coverage`
script at all, and this one has tests.

- [ ] **Step 10: Run the root guards, then commit**

```bash
npx vitest run
pnpm --filter @waitron/store test:coverage
```

Expected: all root guard files pass. Then:

```bash
git commit -s -m "Open the venue and node databases, with the settings the engine needs"
```

### Step group 4 — the schema

- [ ] **Step 11: Switch the vocabulary to SQLite**

`packages/db/src/schema/columns.ts` is the only file whose column types change.

**The rule, which matters more than the sketch below: this step rewrites EVERY helper the vocabulary
exports, and the list of them is read off `columns.ts` on the day the flip runs — never off this
plan.** A helper added to the vocabulary between now and the flip has to be added here in the same
change, because a helper left behind still emits a PostgreSQL type and nothing in this step group
would say so. To read the current list: `grep -n '^export const' packages/db/src/schema/columns.ts`,
or the hand-listed re-export block at `packages/db/src/index.ts:6-27`, which the guard
`packages/db/src/schema/columns.test.ts` keeps in step with the module.

The sketch the spec gives, from its §5.1 table:

```ts
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const id = (name: string) => text(name);
export const ts = (name: string) => text(name);            // ISO-8601
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
export const money = (name: string) => integer(name);       // whole cents (P5)
export const quantity = (name: string) => integer(name);    // whole thousandths (P6)
export const rate = (name: string) => integer(name);        // whole basis points (P6)
export const enumText = <T extends string>(name: string, _values: readonly T[]) => text(name).$type<T>();
export const flag = (name: string) => integer(name, { mode: "boolean" });
export const count = (name: string) => integer(name);
export const label = (name: string) => text(name);
export const table = sqliteTable;
```

**That sketch is now short of the module, and the gap is not small.** The vocabulary has grown twice
since the sketch was written — P1a added `tsString`, and P1b step 1 added five more — and the sketch
was never brought along. Read on 2026-09-17, `columns.ts` exports eighteen names and the sketch gives
a body for eleven of them. The seven with no body here, and what each one needs deciding before F1
can write it:

- `tsString` — a timestamp read back as the driver's string rather than as a `Date`. The spec's table
  has one row for both timestamp helpers (“ISO-8601 text”), so on SQLite the two would emit the same
  thing; what F1 has to settle is whether the pair still needs to be two helpers once the stored type
  is text, and if they collapse into one, every call site of the one that goes has to move.
- `day` — a calendar day. Today it reads back as a string (`PgDateString`).
- `timeOfDay` — a time of day with no date and no zone. Today it reads back as a string.
- `smallCount` and `bigCount` — the two integer widths. Today `bigCount` reads back as a JavaScript
  number, not a `bigint`. SQLite has one integer storage class, so the width distinction that
  separates these from `count` may have nothing to land on; decide whether all three collapse, and if
  they do, say so here rather than leaving three helpers that are the same body.
- `enumCheck` — the `in (...)` constraint body for an `enumText` column. Unlike every other name
  here it builds a constraint rather than a column, and its imports come from `drizzle-orm` rather
  than `drizzle-orm/pg-core` (`packages/db/src/schema/columns.ts:1`), so it may survive the flip
  untouched — but that is a thing to CHECK against the SQLite dialect, not to assume. Step 12 below
  already moves `check()` itself to `drizzle-orm/sqlite-core`.
- `binary` — **the one with no obvious answer, flagged here so F1 meets the question early rather
  than late.** SQLite has a BLOB storage class, so there is somewhere to put the bytes; what is
  undecided is what a caller should be handed on the way out and what the SQLite driver actually
  returns on a read. The PostgreSQL helper hands callers a `Uint8Array` and binds a node `Buffer`
  (the private `bytea` custom type in `packages/db/src/schema/columns.ts`), and by then there will
  be real call sites depending
  on that — P1b step 3 converted the tree's hand-rolled `bytea` columns onto it, FIVE of them across
  three files, and all five are converted (`print_jobs.payload`, `tenant_credentials`'s
  `ciphertext`, `iv` and `auth_tag`, and `media_image_data.bytes`).
  **Do not invent this
  answer while writing the other bodies: settle it against the driver, with a round trip, before F1
  starts.**

For each helper that is rewritten, the thing to preserve is the READ MAPPING, not just the storage
type — the trap P1a and P1b both paid for is two spellings that emit the same type and differ only
in what a read returns. `packages/db/src/schema/columns.test.ts` pins today's mappings; whatever it
has to become on SQLite, it should still pin them one by one.

If P1a's report said the enum could not be hidden, apply that report's resolution here rather than inventing a new one.

- [ ] **Step 12: Fix what the vocabulary could not cover**

`check()`, `index()`, `unique()`, `foreignKey()` and `primaryKey()` come from `drizzle-orm/sqlite-core` now. `defaultRandom()` and `defaultNow()` have no SQLite equivalent — supply them in the vocabulary as `$defaultFn(() => crypto.randomUUID())` and `$defaultFn(() => new Date().toISOString())` so the call sites keep their shape.

- [ ] **Step 13: Regenerate every migration set as one baseline**

Pre-production: schema changes drop and recreate, so there is no history to keep. For each of the twelve sets:

```bash
rm -rf packages/<pkg>/drizzle
pnpm --filter <pkg> exec drizzle-kit generate --name baseline
```

Core's 38 files become one. Then:

```bash
pnpm vitest run scripts/journal-monotonic.test.ts
```

- [ ] **Step 14: Commit**

```bash
git commit -s -m "Define every table on SQLite, and regenerate the migrations as one baseline each"
```

### Step group 5 — the transaction helper, the claim, the errors

- [ ] **Step 15: Point `withTransaction` at the write queue**

Its signature does not change. Its body takes the write lock, begins, runs the body, commits or rolls back, releases — and still drains the change log after the commit, as P3 established.

- [ ] **Step 16: Remove the PostgreSQL-only SQL from `claimRows`**

`ctid` and `for update skip locked` go; under the write queue the conditional update is the whole mechanism. P4a's two tests must pass unmodified.

- [ ] **Step 17: Answer `constraintTarget` from SQLite's message**

`UNIQUE constraint failed: people.email` — the table and columns, parsed. `node:sqlite` reports the kind of constraint only as a number, so map them: 2067 unique, 1555 primary key, 1299 not null. P10's three tests must pass unmodified.

- [ ] **Step 18: Run all three packages' tests, then commit**

```bash
pnpm --filter @waitron/db test:coverage
git commit -s -m "Run transactions, job claims and error matching on SQLite"
```

### Step group 6 — append-only, and the archive

- [ ] **Step 19: Write the failing test for the append-only trigger**

```ts
it("refuses an update to a ledger table", async () => {
  await expect(store.venue.execute(sql`update registros_facturacion set huella = 'x'`))
    .rejects.toThrow(/append-only/);
});

it("refuses a delete from a ledger table", async () => {
  await expect(store.venue.execute(sql`delete from registros_facturacion`))
    .rejects.toThrow(/append-only/);
});
```

- [ ] **Step 20: Install `RAISE(ABORT)` triggers on every `ledger` table — and turn on recursive triggers**

`PRAGMA recursive_triggers = ON` goes in `packages/store` beside `foreign_keys = ON`, and it is not
optional. Measured on 2026-09-16 against a ledger table carrying both triggers, with a control:

```
recursive_triggers = OFF (SQLite's default)  INSERT OR REPLACE: SUCCEEDED, row's payload AND huella rewritten
recursive_triggers = ON                      INSERT OR REPLACE: refused (records is append-only)
```

`INSERT OR REPLACE` deletes the conflicting row internally, and with the default that internal delete
does not fire `BEFORE DELETE`. Plain `UPDATE`, plain `DELETE` and `ON CONFLICT … DO UPDATE` are
refused either way; `INSERT … ON CONFLICT DO NOTHING` works either way. Write the test for the
`INSERT OR REPLACE` case specifically — the other three pass without the pragma, so a test that omits
it passes while the hole is open.

Driven from the classification lists, not a hand-written list — a new ledger table must get its triggers without anyone remembering. Add a guard asserting every `ledger` table carries them, and prove it by deleting one trigger.

- [ ] **Step 21: Replace the `pg_dump` path with `VACUUM INTO`**

`apps/server/src/pg-restore.ts` goes. The archive path must work in this same pull request, or `main` lands with no way to copy a venue. A test takes an archive, opens it, and reads a row from it.

- [ ] **Step 22: Delete `scripts/append-only-enable-always.test.ts`**

Its subject is PostgreSQL's replication apply worker skipping ordinary triggers, which no longer exists. Note the deletion and the reason in the commit.

- [ ] **Step 23: Commit**

```bash
git commit -s -m "Keep ledger tables append-only, and archive with the engine's own copy statement"
```

### Step group 7 — the tests

- [ ] **Step 24: Switch the test helper's body**

`packages/db/src/testing/venue-db.ts` opens a real temporary file, not an in-memory database, so write-ahead behaviour, file locking and the two-file split are the real ones. Its three tests from P2 must pass unmodified.

**One thing this step inherits, raised by P2's convention reviewer and deliberately left to here.**
The accessor's "read before the hook ran" error is thrown by `usePgliteDb` and says
`usePgliteDb: database not started` (`packages/db/src/testing/lifecycle.ts`, and every sibling
accessor names itself the same way). A suite converted by P2 never calls that function, so the name
in the message is already not one its file contains — and after this step it names a driver that no
longer exists, which is the opposite of what that loud throw is for. P2 did not fix it because the
cheapest fix is to stop naming a function at all — `"test database not started: the accessor was
read before beforeAll ran"` at `lifecycle.ts`'s throw site changes no signature, wraps nothing and
leaves the handle identical. (The note first claimed the only two fixes were changing
`usePgliteDb`'s signature or wrapping the handle. That was an impossibility claim with a
counterexample, found by the fix wave's own reviewer; CLAUDE.md §1.) P2 left it because the message
belongs to `usePgliteDb`, not to the seam, and this step replaces that body anyway.
`lifecycle.test.ts` matches only `/not started/i` — three occurrences, checked — so its cases stay
green under any of these wordings.

- [ ] **Step 25: Work through the 66 PostgreSQL-only tests, one at a time**

```bash
find packages apps -name "*.pg.test.ts" -not -path "*/node_modules/*" | sort
```

For each, decide and record in a table in the pull request description: **converted** (and to what), or **deleted** (and why). Three shapes recur:

- A **contention** test becomes a test that the write queue serialises writers. `packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts` is deleted: it exists to record that PGlite could not test contention, and with one writer the thing it warns about does not arise.
- A **trigger-runs-as-the-deployment-role** test becomes a test of the abort trigger.
- A test of publications, subscriptions or write-position fences is deleted; P8 already removed most of these.

Nothing is deleted silently, and nothing is kept in a form that passes without asserting anything.

- [ ] **Step 26: Make `asAppUser` a no-op**

Not deleted — reduced to a function that does nothing, so the flip does not also edit 266 files. T1 deletes the call sites afterwards. Leave a comment saying it is inert and which task removes it.

- [ ] **Step 27: Delete the PostgreSQL test harness**

`packages/db/src/testing/postgres.ts`, `shared-container.ts`, `two-node.ts`, `two-node-wireguard.ts`, `networked-postgres.ts`, and `describeEachTarget` in `harness.ts`.

- [ ] **Step 28: Commit**

```bash
git commit -s -m "Run every test against SQLite, and account for every PostgreSQL-only test"
```

### Step group 8 — finish

- [ ] **Step 29: Run the whole workspace once**

This is the one place in this plan a whole-workspace run is justified: the engine changed under everything.

```bash
pnpm -r typecheck && pnpm -r test:coverage
```

- [ ] **Step 30: Do not lower a coverage threshold to make this pass**

If a bar is missed, either the deletions moved it — which T3 handles afterwards, with the reason recorded — or coverage genuinely dropped. Establish which. `scripts/coverage-thresholds.test.ts` pins the bars the owner set.

- [ ] **Step 31: Open the pull request — do not land it**

The description carries: the 66-test disposition table, the list of what the vocabulary could not hide, and the `VACUUM INTO` archive check. Leave it open for the owner.

---

## Task T1: Delete the role-assumption call

**Runner:** autonomous. **Depends on:** F1.

`asAppUser` is inert after the flip. Remove its 1,285 call sites across 266 files, then the function.

- [ ] **Step 1: Confirm it is genuinely inert**

```bash
sed -n '1,40p' packages/db/src/index.ts | grep -n "asAppUser" -A10
```

- [ ] **Step 2: Remove the calls, package by package**

One pull request per package. `await asAppUser(tx);` lines go; nothing else changes.

- [ ] **Step 3: Delete the function and its export, in the last pull request**

- [ ] **Step 4: Verify**

```bash
grep -rn "asAppUser" packages apps --include='*.ts' | grep -v node_modules | wc -l
```

Expected: 0. Then `pnpm -r typecheck`.

- [ ] **Step 5: Commit**

```bash
git commit -s -m "Remove the role-assumption call, which does nothing now

Every request transaction used to assume a database role before touching data.
SQLite has no roles, so the call was reduced to doing nothing when the engine
changed; this removes it. What it used to enforce is now a guard that reads the
source."
```

---

## Task T2: Drop PostgreSQL from the dependencies and the dev stack

**Runner:** autonomous. **Depends on:** F1.

- [ ] **Step 1: Remove the `db` service from `deploy/compose.yml`** and the dev-stack wiring that starts it.

- [ ] **Step 2: Remove `pg`, `@types/pg` and `@electric-sql/pglite` from every manifest**

```bash
grep -rn '"pg"\|"@types/pg"\|"@electric-sql/pglite"\|"testcontainers"' packages/*/package.json apps/*/package.json package.json
```

- [ ] **Step 3: Remove `TESTCONTAINERS_RYUK_DISABLED` and the reaper from the docs and scripts** where it exists only for the PostgreSQL containers. `pnpm reap` also sweeps orphaned vitest workers — keep that half.

- [ ] **Step 4: Update the documents that describe the old engine**

`CLAUDE.md` §2 and §4, `docs/developers/ci-and-gates.md`, `docs/developers/testing-guide.md`, `docs/developers/conventions-data.md`, `docs/developers/workflow-guide.md`. A behaviour change retires every receipt about the old behaviour: read every claim stated in prose across the whole base-to-tip range, not just the lines a diff shows.

- [ ] **Step 5: Verify and commit**

```bash
pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm test:coverage
```

---

## Task T3: Revisit the coverage bars

**Runner:** autonomous. **Depends on:** F1, T1, T2.

- [ ] **Step 1: Read the per-file coverage table, not the exit code**

```bash
pnpm -r test:coverage
```

- [ ] **Step 2: For each package that moved, say why**

A bar that is now easily exceeded because a package shrank is raised. A bar that is missed is investigated before it is touched — the split bars were an owner decision on 2026-09-05 and `scripts/coverage-thresholds.test.ts` pins which package holds which.

- [ ] **Step 3: Commit, naming each change and its reason**

---

## P1a findings

Written by task P1a. The report itself is inside Task P1, under "### P1a findings" — it sits beside
the steps it came from rather than at the end of the file.

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: §3.1 the driver → F1 group 1; §3.2 two files → P7 and F1 group 3; §3.3 settings → F1 step 8, including the checkpointing correction; §4 the transaction helper → F1 group 2 and step 15; §5.1 the vocabulary → P1, F1 step 11; §5.2 migrations → F1 step 13; §5.3 the fiscal check → P5 steps 1–5; §6.1 the change feed → P3; §6.2 job claiming → P4a and P4b; §6.3 grants → P9 and F1 group 6; §6.4 driver errors → P10 and F1 step 17; §6.5 archiving → F1 step 21; §7.1 one target → F1 step 24; §7.2 the role call → F1 step 26 and T1; §7.3 the 66 tests → F1 step 25; §7.4 coverage → F1 step 30 and T3; §8 deletions → P8, F1 groups 6–7, T2. The new-package wiring the root guards need is F1 steps 9–10 and a Global Constraint.

**Two things this plan adds that the spec did not spell out.** The change feed's replacement is a table the trigger writes and the transaction drains after committing, rather than write paths publishing their own events — that keeps the existing payload contract and lands green on PostgreSQL. And `claimRows` knowingly carries `ctid` and `for update skip locked` inside one function through the prepare phase, so the PostgreSQL-only SQL sits in one place instead of four until F1 removes it.

**Type consistency.** `useVenueDb`/`VenueDb` (P2) are used in P3, P4a and P10. `claimRows`/`ClaimSpec` (P4a) are used in P4b and F1. `constraintTarget` (P10) is used in F1. `money`/`quantity`/`rate` (P1) are changed by P5 and P6 and again by F1. `adaptNodeSqlite`, `createWriteQueue` and `openVenueStore` are defined and used only within F1.

**The one place this plan cannot be followed blindly.** F1 step 25 asks for a disposition per test across 66 files. That work cannot be pre-written here without reading each one; what is pre-written is the rule for deciding, and the requirement that every deletion appear with its reason.
