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
- Modify: `packages/db/src/index.ts` (export the vocabulary)

**Interfaces:**

- Produces, consumed by P5, P6 and F1:
  - `id(name: string)` — a uuid primary-key-shaped column
  - `ts(name: string)` — a timestamptz column in `date` mode
  - `json<T>(name: string)` — a jsonb column typed `T`
  - `money(name: string)` — a monetary amount
  - `quantity(name: string)` — a quantity with three decimal places
  - `rate(name: string)` — a percentage rate with two decimal places
  - `enumText<T extends string>(name: string, values: readonly T[])` — a closed vocabulary
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
    // mode: "date" is what every existing caller uses; string mode would change
    // what every read returns without changing the column type, so the type
    // assertion above cannot catch it.
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

```ts
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

/** A moment on the server clock, read back as a `Date`. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A structured document. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

/** A monetary amount: two decimal places. */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** A quantity: three decimal places, so 0.005 kg is representable. */
export const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** A percentage rate: two decimal places, e.g. a 21.00 VAT rate. */
export const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * A closed vocabulary. Text plus a check constraint rather than a database enum type, which is
 * already the house preference for a vocabulary that may widen (`drawer_opens.reason`,
 * `invoice_series.purpose`): widening costs a one-line migration instead of an `ALTER TYPE`.
 *
 * The caller still writes the `check()` on the table; this helper supplies the column and its
 * TypeScript type so the two cannot drift apart.
 */
export const enumText = <T extends string>(name: string, _values: readonly T[]) => text(name).$type<T>();

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

Rewrite `packages/db/src/schema/drawer-opens.ts` to import from `./columns.js`. The check constraint stays exactly where it is; only the column builders move.

```ts
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { enumText, flag, id, table, ts } from "./columns.js";

export type DrawerOpenReason = "cash_sale" | "manual";

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
  (t) => [check("drawer_opens_reason_ck", sql`${t.reason} in ('cash_sale', 'manual')`)],
);
```

Keep the existing explanatory comments — thin them where they narrate history, per `CLAUDE.md` §1, but do not delete the ones stating why `till_id` and `sale_id` carry hand-written foreign keys.

- [ ] **Step 6: Prove nothing changed, by regenerating**

This is the acceptance check for the whole task, and it must be run, not reasoned about.

```bash
git stash && pnpm --filter @waitron/db exec drizzle-kit generate --name probe_before && git stash pop
```

Then regenerate with the change in place and compare. Simpler and less error-prone:

```bash
pnpm --filter @waitron/db exec drizzle-kit check
```

Expected: no pending changes reported — the schema the vocabulary produces is the schema already in the snapshots. **If `drizzle-kit` reports a difference, the vocabulary is wrong**, not the snapshot; fix the helper rather than regenerating.

- [ ] **Step 7: Run the package suite**

```bash
pnpm --filter @waitron/db test:coverage
```

Expected: PASS.

- [ ] **Step 8: Write the report**

Append a short section to the plan file itself (this file), under "P1a findings", stating for each helper whether it hid the difference cleanly and naming anything it could not. Specifically answer: does any table use a real `pgEnum` that `enumText` cannot express, and how many?

```bash
grep -rn 'pgEnum(' packages apps --include='*.ts' | grep -v node_modules | grep -v '.test.ts' | wc -l
```

- [ ] **Step 9: Commit and open the pull request**

```bash
git add packages/db/src/schema/columns.ts packages/db/src/schema/columns.test.ts \
        packages/db/src/schema/drawer-opens.ts docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md
git commit -s -m "Put the database column types in one module, and use it for one table

The SQLite switch has to change 795 column definitions across 72 files. Routing
them through one module first means the switch changes this file instead.

The helpers emit exactly the PostgreSQL types they replace, which drizzle-kit
confirms by reporting no pending schema change. One table, drawer_opens, now
uses them. The report of what the vocabulary could not hide is in the plan."
```

Then `/finish-branch`.

### P1b — roll the vocabulary out

- [ ] **Step 1: Split the work by package**

One pull request per package, in this order, so a conflict is confined: `packages/db`, then `catalogue`, `payments`, `fiscal-verifactu`, `identity`, `workforce`, `workforce-es`, `bookings`, `scheduler`, `venue-service`, `credentials`, `media`, `purchasing`, `recipes`, `layouts`, `reporting`.

- [ ] **Step 2: For each package, convert every table file**

Replace `pgTable` with `table`, and each column builder with its vocabulary equivalent. Leave `check()`, `index()`, `unique()`, `foreignKey()` and `primaryKey()` imports coming from `drizzle-orm/pg-core` — the vocabulary covers columns and the table builder only.

- [ ] **Step 3: Prove nothing changed**

```bash
pnpm --filter <package> exec drizzle-kit check
```

Expected: no pending changes. Then:

```bash
pnpm --filter <package> test:coverage
```

- [ ] **Step 4: Guard the rule so it does not rot**

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
      /\b(uuid|timestamp|jsonb|numeric|boolean|integer)\(/.test(text);
    if (bad) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
```

Note in a comment that this guard reads TEXT, so a builder reached through an alias is invisible to it — the hedge `CLAUDE.md` §7 requires for a guard weaker than its name.

- [ ] **Step 5: Commit each package separately**

```bash
git commit -s -m "Use the shared column types in <package>

No schema change: drizzle-kit reports nothing pending."
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

`packages/db/src/schema/columns.ts` is the only file whose column types change. Per the spec's §5.1:

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

- [ ] **Step 20: Install `RAISE(ABORT)` triggers on every `ledger` table**

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

_Filled in by task P1a, step 8. Until then this section is empty by design._

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: §3.1 the driver → F1 group 1; §3.2 two files → P7 and F1 group 3; §3.3 settings → F1 step 8, including the checkpointing correction; §4 the transaction helper → F1 group 2 and step 15; §5.1 the vocabulary → P1, F1 step 11; §5.2 migrations → F1 step 13; §5.3 the fiscal check → P5 steps 1–5; §6.1 the change feed → P3; §6.2 job claiming → P4a and P4b; §6.3 grants → P9 and F1 group 6; §6.4 driver errors → P10 and F1 step 17; §6.5 archiving → F1 step 21; §7.1 one target → F1 step 24; §7.2 the role call → F1 step 26 and T1; §7.3 the 66 tests → F1 step 25; §7.4 coverage → F1 step 30 and T3; §8 deletions → P8, F1 groups 6–7, T2. The new-package wiring the root guards need is F1 steps 9–10 and a Global Constraint.

**Two things this plan adds that the spec did not spell out.** The change feed's replacement is a table the trigger writes and the transaction drains after committing, rather than write paths publishing their own events — that keeps the existing payload contract and lands green on PostgreSQL. And `claimRows` knowingly carries `ctid` and `for update skip locked` inside one function through the prepare phase, so the PostgreSQL-only SQL sits in one place instead of four until F1 removes it.

**Type consistency.** `useVenueDb`/`VenueDb` (P2) are used in P3, P4a and P10. `claimRows`/`ClaimSpec` (P4a) are used in P4b and F1. `constraintTarget` (P10) is used in F1. `money`/`quantity`/`rate` (P1) are changed by P5 and P6 and again by F1. `adaptNodeSqlite`, `createWriteQueue` and `openVenueStore` are defined and used only within F1.

**The one place this plan cannot be followed blindly.** F1 step 25 asks for a disposition per test across 66 files. That work cannot be pre-written here without reading each one; what is pre-written is the rule for deciding, and the requirement that every deletion appear with its reason.
