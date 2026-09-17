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
- Modify (P1b): the remaining 71 files that call `pgTable(`
- Modify (P1b, its first step): `packages/db/src/index.ts` (export the vocabulary)

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
the probe worth stating carefully: when drizzle-kit refuses it writes nothing at all, so `diff -r`
is silent — which is exactly what a PASS looks like. A silent diff on its own is not evidence. The
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

**One thing the guard in P1b step 5 will not see.** It reads TEXT, so a file that keeps importing
`pgEnum` (every file declaring one must) still has a `drizzle-orm/pg-core` import line; the guard's
second half looks for the column-builder names specifically, so an enum-declaring file passes. That
is correct, but it means the guard proves "no raw column builder", never "fully converted".

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
`packages/db/src/schema/daily-closes.ts:66` is date mode and `packages/db/src/schema/sale-voids.ts:30`
is string mode, in the same package. Those numbers are a dated measurement, not the finding; the
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
| `bigint(…, { mode: "number" })`  | 3                   | `packages/db/src/schema/catalogue.ts:32`, `packages/db/src/schema/node-membership.ts:33`, `packages/identity/src/schema/webauthn.ts:34`                         |
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
shape, not the `Buffer`-both-ways shape — in the private custom type at
`packages/db/src/schema/columns.ts:167-171`. Why that side was picked, and which call sites it
moves, is in P1b step 1 below; that is where the detail lives now. **The callers on the other side
have NOT been changed yet.** All three hand-rolled blocks named above are still in the tree —
`packages/db/src/schema/print-jobs.ts:26` and
`packages/credentials/src/schema/tenant-credentials.ts:15` still declare
`customType<{ data: Buffer; driverData: Buffer }>`, and `packages/media/src/schema/images.ts:16`
still declares its own `customType<{ data: Uint8Array; driverData: Buffer }>`. Read on 2026-09-17
with `grep -n customType packages/db/src/schema/print-jobs.ts \
packages/credentials/src/schema/tenant-credentials.ts packages/media/src/schema/images.ts`, which
printed all three declarations. Replacing them is step 3's work, not step 1's.

**One `text` column that must never become `label()`.**
`packages/fiscal-verifactu/src/schema/registros.ts:86-94` stores `cuota_total` and `importe_total` as
`text` deliberately, and the comment above them says why: `packages/verifactu/src/huella.ts` hashes
those stored values verbatim as strings, so the bytes stored have to be the bytes hashed, which only
`text` guarantees; `numeric(12,2)` re-renders on read and is additionally too narrow for the format's
twelve integer digits. Under a mechanical conversion those two lines look exactly like free text and
`label()` is the obvious substitution.

It must not be made, and nothing in P1b would report it. `label()` emits `text` today, so the step 4
probe stays silent; the break arrives at the flip, when every `label()` body changes at once. The
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
directly.

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
the tree are not counts of anything: `packages/workforce/src/schema/availability.ts:32` is
`weekday: smallint("weekday").notNull()`, a day of the week, and
`packages/db/src/schema/dining-tables.ts:59-62` hold `pos_x`, `pos_y` and `rotation` — a position on
a floor plan and an angle. The `bigint` columns are no more alike than that:
`packages/db/src/schema/catalogue.ts:32` is a catalogue version,
`packages/db/src/schema/node-membership.ts:33` is a membership term and
`packages/identity/src/schema/webauthn.ts:34` is a WebAuthn signature counter. Every line named here
was opened and read on 2026-09-17. So the helper names the width and the call site keeps the meaning.

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
`bytea` blocks disagree with each other, and step 1 converted none of them — all three are still in
the tree, checked on 2026-09-17. `packages/db/src/schema/print-jobs.ts:26` and
`packages/credentials/src/schema/tenant-credentials.ts:15` hand callers a node `Buffer`;
`packages/media/src/schema/images.ts:16` hands them a `Uint8Array`. The vocabulary took the
`Uint8Array` shape, read off the callers rather than argued: `packages/printing/src/outbox.ts:26`
already accepts a `Uint8Array` (`payload: Uint8Array,`) and calls `Buffer.from` at line 55 only
because the column demands a `Buffer`, and `packages/printing/src/runtime.ts:288-291` copies a
read-back payload straight back into a `Uint8Array`. So the conversions will delete those hand
conversions rather than add any.

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
  `new Uint8Array(value)` — the private `bytea` custom type at
  `packages/db/src/schema/columns.ts:167-171`, whose `fromDriver` is line 170, opened and read on
  2026-09-17. (Lines 180-184, which an earlier draft of this bullet cited, are now prose inside the
  doc comment: the custom type was moved above that comment while step 1 was being written.)
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

- [ ] **Step 2: Split the work by package**

One pull request per package, in this order, so a conflict is confined: `packages/db`, then `catalogue`, `payments`, `fiscal-verifactu`, `identity`, `workforce`, `workforce-es`, `bookings`, `scheduler`, `venue-service`, `credentials`, `media`, `purchasing`, `reporting`.

- [ ] **Step 3: For each package, convert every table file**

Replace `pgTable` with `table`, and each column builder with its vocabulary equivalent. Leave `check()`, `index()`, `unique()`, `foreignKey()` and `primaryKey()` imports coming from `drizzle-orm/pg-core` — the vocabulary covers columns and the table builder only.

Three things this step is not allowed to do mechanically, each from the P1a findings above: a
`timestamp` keeps the mode it already has, read off the line being replaced; a builder with no
vocabulary equivalent waits for the helper rather than borrowing a near-enough one; and
`registros_facturacion`'s `cuota_total` and `importe_total` stay as they are — they are `text`
because the fiscal fingerprint hashes the stored bytes, and `label()` is not a synonym for that.

- [ ] **Step 4: Prove nothing changed**

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
`--schema ./src/schema/index.ts` points those four at a file they do not have — and drizzle-kit then
writes nothing, so the `diff -r` is silent and looks like a pass. **Read the exit status and the
`No schema changes, nothing to migrate` line, never the silent diff on its own.**

Those four are a different set from step 2's rollout list, and the overlap is only three.
`packages/fiscal-none` is not on step 2's list and declares no `pgTable` anywhere (checked
2026-09-17), so this step never runs there; it is named above because the warning is about
drizzle-kit's `--schema` flag across the repository, not about the rollout. Reaching for it as "the
fourth package to convert" would be reading the wrong list.

Four packages on step 2's list have no schema at all — `packages/purchasing`, `packages/recipes`,
`packages/layouts` and `packages/reporting` each have no `drizzle.config.ts`, no `drizzle/` folder
and no `pgTable(` anywhere in `src` (checked 2026-09-17). There is nothing for this step to run in
them and nothing for step 3 to convert; skip them here.

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

Expected: `No schema changes, nothing to migrate` with exit 0, and `diff -r` silent. Then:

```bash
pnpm --filter <package> test:coverage
```

- [ ] **Step 5: Guard the rule so it does not rot**

In the final P1b pull request, add to `packages/db/src/schema/columns.test.ts`:

```ts
it("no table file imports a column builder directly from drizzle", async () => {
  const { sourceFilesIn } = await import("../../../../scripts/source-files.js");
  const offenders: string[] = [];
  for (const file of sourceFilesIn(["packages", "apps"])) {
    const text = await readFile(file, "utf8");
    if (!text.includes("pgTable(") && !text.includes("table(")) continue;
    // The vocabulary module itself is the one place these may be imported.
    if (file.endsWith("schema/columns.ts")) continue;
    const bad = /from "drizzle-orm\/pg-core"/.test(text) &&
      /\b(uuid|timestamp|date|time|jsonb|numeric|text|boolean|smallint|integer|bigint)\(/.test(text);
    if (bad) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
```

The list of builder names has to match what the vocabulary covers — every COLUMN builder
`packages/db/src/schema/columns.ts` imports from `drizzle-orm/pg-core`, and no fewer. **That import
block is the rule; the list in the draft above is not.** Open the file, read its import block, and
take the column-builder names from it — the list grows every time step 1 adds a helper, so a list
written down here is stale the moment one is added. This paragraph has already been wrong once for
exactly that reason.

As a dated reading of that import block on 2026-09-17, after step 1 landed its five helpers: eleven
of the names it imports are column builders — `uuid`, `timestamp`, `date`, `time`, `jsonb`,
`numeric`, `text`, `boolean`, `smallint`, `integer`, `bigint` — and that is what the regex above now
lists. Before step 1 the draft carried seven. Treat both numbers as receipts for when they were
taken, not as the thing to check the regex against.

Two names in that import block are NOT column builders and are left out for their own reasons.
`pgTable` is the table builder, and it is already what the line above the regex uses to pick which
files to look at. `customType` is a builder FACTORY, and it **deserves a decision rather than a
silent omission**: the three hand-rolled `bytea` blocks that step 1's `binary` helper exists to
replace are each built with `customType`, so a table file calling `customType(` is doing the very
thing this guard exists to stop, and leaving it out means the guard cannot see the next one. Decide
when writing the guard; if it is left out, say so in the comment beside it.

`text` was missing from an earlier draft of this predicate, and a reviewer ran that draft on
2026-09-17 against a file holding `import { text } from "drizzle-orm/pg-core";` and
`table("x", { kind: text("kind") })`: it returned false, so the file passed. That is the shape of
the failure a short list produces — silence, not an error.

Note in a comment that this guard reads TEXT, so a builder reached through an alias is invisible to it — the hedge `CLAUDE.md` §7 requires for a guard weaker than its name.

- [ ] **Step 6: Commit each package separately**

```bash
git commit -s -m "Use the shared column types in <package>

No schema change: generating this package's migrations into a copy of its
migration folder and diffing that against the real one found no difference."
```

---

## Task P2: One test-database helper

**Runner:** autonomous. **Depends on:** nothing.

211 files pick a database through `usePgliteDb`, `useRealPostgres` or `describeEachTarget`. Put one helper in front of them so the flip changes one function body.

**Files:**

- Create: `packages/db/src/testing/venue-db.ts`
- Create: `packages/db/src/testing/venue-db.test.ts`
- Modify: `packages/db/src/testing/index.ts` (export it)
- Modify: the 211 files that call the three existing helpers — one pull request per package

**Interfaces:**

- Consumes: `usePgliteDb(options: PgliteSuiteOptions): PgliteSuite` from `packages/db/src/testing/lifecycle.ts`
- Produces, consumed by F1: `useVenueDb(options: VenueDbOptions): VenueDb`, where `VenueDb` has a readonly `db: Database`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/testing/venue-db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./venue-db.js";
import { coreMigrations } from "../migrations.js";

describe("useVenueDb", () => {
  const suite = useVenueDb({ migrations: [coreMigrations] });

  it("gives a migrated database", async () => {
    const result = await suite.db.execute(sql`select count(*)::int as n from tenants`);
    expect(result.rows[0]).toEqual({ n: expect.any(Number) });
  });

  it("empties data between tests", async () => {
    await suite.db.execute(sql`insert into tenants (id, legal_name) values (1, 'probe')`);
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

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @waitron/db test -- venue-db.test.ts
```

Expected: FAIL — `Cannot find module './venue-db.js'`.

- [ ] **Step 3: Write the helper**

Create `packages/db/src/testing/venue-db.ts`:

```ts
import { usePgliteDb, type PgliteSuiteOptions, type PgliteSuite } from "./lifecycle.js";

/**
 * The one way a suite asks for a venue database.
 *
 * Today it is PGlite. The SQLite switch replaces this body and nothing else, which is why every
 * suite goes through it rather than naming a driver.
 */
export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

export function useVenueDb(options: VenueDbOptions): VenueDb {
  return usePgliteDb(options);
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
pnpm --filter @waitron/db test -- venue-db.test.ts
```

Expected: PASS, all three.

- [ ] **Step 5: Convert package by package**

One pull request per package. Replace `usePgliteDb(` with `useVenueDb(` and fix the import. **Leave `useRealPostgres` and `describeEachTarget` alone** — those name a real container deliberately, and F1 decides each one's fate as part of the 66-test disposition (task F1 step 24).

- [ ] **Step 6: Verify each package**

```bash
pnpm --filter <package> test:coverage
```

- [ ] **Step 7: Commit**

```bash
git commit -s -m "Ask for a test database through one helper in <package>

Same PGlite database as before. The SQLite switch replaces the helper's body
rather than 211 call sites."
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
import { coreMigrations } from "./migrations.js";

describe("the change log", () => {
  const suite = useVenueDb({ migrations: [coreMigrations] });

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
import { coreMigrations } from "./migrations.js";

describe("claimRows", () => {
  const suite = useVenueDb({ migrations: [coreMigrations] });

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
import { coreMigrations } from "./migrations.js";

describe("constraintTarget", () => {
  const suite = useVenueDb({ migrations: [coreMigrations] });

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
  (`packages/db/src/schema/columns.ts:167-171`), and by then there will be real call sites depending
  on that — P1b step 3 converts three hand-rolled `bytea` columns onto it. **Do not invent this
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
