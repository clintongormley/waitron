# Core migration set — upgrade repair

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box on a released core schema can upgrade to HEAD. Today none can.

**Architecture:** One SQL change to an already-landed migration, plus two static guards in the root
Vitest project so neither defect shape can return.

**Tech Stack:** drizzle-orm 0.45.2, PostgreSQL 18, Vitest, Testcontainers.

**Spec:** none. This is a defect found while running the §6 experiment of
`docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md`; that spec's addendum,
written on the diagnosability branch, records it. The evidence is below and every number in it was
measured, not reasoned.

## What is broken, measured

Two independent defects in `packages/db/drizzle`, both invisible to CI because CI only ever migrates
a **fresh** database.

**Defect A — an enum value used in the transaction that added it.** `0013_central_printer_provisioning.sql`
runs `ALTER TYPE "public"."print_transport" ADD VALUE 'bluetooth'`, and
`0014_central_printer_provisioning_sql.sql` then names `'bluetooth'` in a `CHECK` constraint. Drizzle
applies every *pending* migration of a set in ONE transaction
(`drizzle-orm@0.45.2/pg-core/dialect.js:60`), and PostgreSQL refuses to use a new enum value in the
transaction that added it unless the type was created there too:

```
ERROR:  55P04: unsafe use of new value "bluetooth" of enum type print_transport
HINT:  New enum values must be committed before they can be used.
```

A fresh database creates `print_transport` in that same batch, so it is allowed — hence green CI. An
existing box aborts and applies nothing, which is exactly what the owner verified on the first real
box on 2026-09-10: `printers` still carried `:main`'s columns.

**Defect B — a non-monotonic journal.** `packages/db/drizzle/meta/_journal.json` entries 2–6 carry
`when` values BELOW entry 1's:

```
0 1788785854711  0000_db_baseline
1 1788785861913  0001_db_baseline_sql
2 1788769912531  0002_device_profile_form_factor        <-- below entry 1
…
6 1788775712562  0006_tills_name_unique_sql             <-- below entry 1
7 1788799627575  0007_break_glass_verifier_sql
```

Drizzle's watermark is `max(created_at)` and it applies a migration only when
`watermark < migration.folderMillis` (`dialect.js:56-62`). A database whose highest recorded
`created_at` is entry 1's therefore SKIPS entries 2–6 — silently, with no error. This one predates
the printer work; Defect A merely hides it behind a throw.

Measured on PostgreSQL 18, one database per release point, migrating with today's files to entry `k`
and then to HEAD:

| box at core entry | today | after this branch |
| --- | --- | --- |
| 0 (fresh) | complete 15/15 | complete 15/15 |
| 1 | throws | **skips 5 — loud, see below** |
| 2 | throws | skips 5 — loud |
| 3–6 | throws | skips 4…1 — loud |
| 7–14 | throws | complete 15/15 |

**Defect B cannot be fixed by editing the journal, and this was measured rather than assumed.**
Raising entries 2–6 above entry 1 makes points 1–2 clean but breaks points 3–7, which then RE-APPLY
`0002_device_profile_form_factor` and fail with "type already exists" — a database has already
recorded the old watermark, so no assignment of `when` values satisfies both directions. Lowering
entries 0–1 instead changes nothing, because the database stored the old value, not the file's.

So this branch fixes Defect A, which is where every real box actually sits (the incident box was at
the entry-12/13 era), and guards both shapes. Making the residual entry-1-to-6 skip LOUD instead of
silent is a runtime check that belongs with the boot-failure diagnosability work
(`docs/superpowers/plans/2026-09-10-boot-failure-diagnosability.md`), not here — it changes
`applyMigrations`, which every host calls.

## Global Constraints

- **Editing an already-landed migration is deliberate here** and allowed because nothing is in
  production (CLAUDE.md §3). It is NOT the rebase-collision hand-edit that rule forbids; say so in
  the commit.
- **Editing `0014` changes its drizzle hash** (`sha256` of the file text). Any database that already
  applied today's `0014` — every dev and demo database provisioned since #304 landed on 2026-09-09 —
  now carries a hash this image does not ship. Nothing detects that yet, so nothing breaks today; the
  diagnosability branch adds a check that WILL refuse to boot such a database. The remedy there and
  here is `wa-wt reset demo`. Note it in the commit so the next reader is not surprised.
- **Do not touch `meta/_journal.json`, any `meta/*_snapshot.json`, or `0013`.**
- **Coverage thresholds are unchanged.** `packages/db` sits at `98/98/98/95`.
- **Every commit is `git commit -s`.**

---

### Task 1: Let an existing database upgrade past the enum add

**Files:**
- Create: `packages/db/src/migrate-upgrade.pg.test.ts`
- Modify: `packages/db/drizzle/0014_central_printer_provisioning_sql.sql`

**Interfaces:**
- Consumes: `databaseUrl`, `startPostgresContainer`, `StartedContainer` from `./testing/postgres.js`.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrate-upgrade.pg.test.ts`:

```ts
// Real PostgreSQL, never PGlite: the defect is PostgreSQL's own enum-safety rule inside drizzle's
// single migrate transaction, and the watermark arithmetic under test is drizzle's against real
// Postgres (CLAUDE.md §4).
//
// It boots its OWN container rather than cloning the package's shared template, because every case
// needs a database at a DIFFERENT migration point — which is the one thing a template of the
// finished schema cannot provide.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { databaseUrl, startPostgresContainer, type StartedContainer } from "./testing/postgres.js";

const CORE_DRIZZLE = fileURLToPath(new URL("../drizzle", import.meta.url));
const JOURNAL_TABLE = "__drizzle_migrations_db";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal = JSON.parse(readFileSync(join(CORE_DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
} & Record<string, unknown>;

/** Every temp folder this suite makes, so `afterAll` can remove them. */
const scratch: string[] = [];

/** A migrations folder carrying only the first `n` journal entries — the shape an older image ships. */
function folderWithFirst(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-upgrade-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  const entries = journal.entries.slice(0, n);
  for (const entry of entries) {
    copyFileSync(join(CORE_DRIZZLE, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  return dir;
}

/**
 * The release points this suite requires to upgrade completely.
 *
 * NOT every point, and the exclusion is the honest part: entries 1–6 sit above a non-monotonic
 * region of `meta/_journal.json` (entries 2–6 carry `when` values below entry 1's), so drizzle's
 * `max(created_at)` watermark skips them. That is unfixable by editing the journal — measured: every
 * candidate repair makes some OTHER release point re-apply a migration it already ran — and is
 * therefore a documented limit of this set, not something this test can assert away. The residual
 * skip is made LOUD at runtime by the boot-failure diagnosability branch. Shrink this list, never
 * grow it: a NEW set must never join it, which `scripts/journal-monotonic.test.ts` enforces.
 */
const NON_MONOTONIC_POINTS = [1, 2, 3, 4, 5, 6];

describe("the core migration set upgrades an existing database", () => {
  let container: StartedContainer;

  beforeAll(async () => {
    container = await startPostgresContainer();
  }, 180_000);

  afterAll(async () => {
    // Guarded: `startPostgresContainer` may have thrown, leaving `container` unassigned.
    if (container !== undefined) await container.stop();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** Migrate a new database to entry `at`, then to HEAD. Returns the journal row count, or throws. */
  async function upgradeFrom(at: number, databaseName: string): Promise<number> {
    const admin = new pg.Client({ connectionString: container.uri });
    await admin.connect();
    try {
      await admin.query(`create database "${databaseName}"`);
    } finally {
      await admin.end();
    }
    const client = new pg.Client({ connectionString: databaseUrl(container.uri, databaseName) });
    await client.connect();
    try {
      const db = drizzle(client);
      const options = { migrationsSchema: "public", migrationsTable: JOURNAL_TABLE };
      if (at > 0) await migrate(db, { ...options, migrationsFolder: folderWithFirst(at) });
      await migrate(db, { ...options, migrationsFolder: folderWithFirst(journal.entries.length) });
      const counted = await client.query<{ n: number }>(
        `select count(*)::int as n from "${JOURNAL_TABLE}"`,
      );
      return counted.rows[0]!.n;
    } finally {
      await client.end();
    }
  }

  it("applies every shipped migration, from every release point the journal allows", async () => {
    // The assertion is the ROW COUNT, not "it did not throw": the failure this set is capable of is
    // a SILENT skip, which a no-throw assertion passes (measured — a candidate fix left 10 of 15
    // migrations unapplied and raised nothing).
    const total = journal.entries.length;
    const points = Array.from({ length: total }, (_, at) => at).filter(
      (at) => !NON_MONOTONIC_POINTS.includes(at),
    );
    for (const at of points) {
      expect([at, await upgradeFrom(at, `wt_upgrade_${at}`)]).toEqual([at, total]);
    }
  }, 300_000);

  it("still migrates a virgin database — the control, and the only shape CI exercises", async () => {
    expect(await upgradeFrom(0, "wt_upgrade_virgin")).toBe(journal.entries.length);
  }, 180_000);
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-fix-core-migration-upgrade
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec vitest run src/migrate-upgrade.pg.test.ts
```

Expected: the first test FAILS, its message naming the `printers_transport_fields_ck` statement. The
virgin control PASSES. That contrast is the point — the defect is in the upgrade, not the migration.

- [ ] **Step 3: Fix the migration**

In `packages/db/drizzle/0014_central_printer_provisioning_sql.sql`, replace the
`printers_transport_fields_ck` statement and the comment above it with exactly this. Every other
statement in the file stays byte-identical.

```sql
-- Which connection field a transport requires, keyed on the device now (no agent_id): usb and
-- bluetooth need local_key, network_tcp needs host, cloud_poll needs poll_id.
--
-- The column is cast to text rather than compared to a bare enum literal. 0013 adds the bluetooth
-- label to print_transport, and drizzle applies every pending migration of a set in ONE transaction
-- (drizzle-orm@0.45.2/pg-core/dialect.js:60); PostgreSQL refuses to USE a label added in the
-- transaction that added it unless the type was created there too. Naming the label here therefore
-- migrates a virgin database, where 0000 creates the type in the same batch, and aborts every
-- upgrade of an existing one with 55P04. Comparing text is the same predicate: an enum's text form
-- is its label. Proven both ways by packages/db/src/migrate-upgrade.pg.test.ts.
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_transport_fields_ck" CHECK (
    (transport::text = 'usb'         AND local_key IS NOT NULL)
    OR (transport::text = 'bluetooth'   AND local_key IS NOT NULL)
    OR (transport::text = 'network_tcp' AND host      IS NOT NULL)
    OR (transport::text = 'cloud_poll'  AND poll_id   IS NOT NULL)
  );
```

Note the comment says "the bluetooth label", not `'bluetooth'` in single quotes. Task 2's guard reads
raw SQL text, and a quoted literal in a comment is indistinguishable from one in a predicate.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec vitest run src/migrate-upgrade.pg.test.ts
```
Expected: both PASS.

Then confirm the constraint still REJECTS what it is there to reject — the cast could have quietly
widened it:

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec vitest run src/schema/printing.test.ts
```
Expected: PASS, including the cases asserting SQLSTATE `23514`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0014_central_printer_provisioning_sql.sql packages/db/src/migrate-upgrade.pg.test.ts
git commit -s -m "fix(db): let an existing database upgrade past the print_transport enum add

Drizzle applies a set's pending migrations in one transaction, and PostgreSQL refuses to use an enum
label added in that same transaction unless the type was created there too. A virgin database
creates print_transport in the same batch, so CI passed; every existing box aborted with 55P04 and
applied nothing — which is why the first real box's printers table still carried main's columns.

Editing a landed migration is deliberate and allowed pre-production (CLAUDE.md section 3); this is
not the rebase-collision hand-edit that rule forbids. It does change the file's drizzle hash, so a
database that already applied the old 0014 carries a hash this image no longer ships. Nothing
detects that today; the boot-failure diagnosability branch adds a check that will, and the remedy
for a dev database is wa-wt reset demo."
```

---

### Task 2: Guard the enum shape

**Files:**
- Create: `scripts/enum-add-value-safety.test.ts`

**Interfaces:** none. A root-project guard, so it runs on CI's ungated `lint` job and on every
non-docs push (CLAUDE.md §4).

- [ ] **Step 1: Write the guard**

Create `scripts/enum-add-value-safety.test.ts`:

```ts
// A guard that reads the whole tree, so it lives in the ROOT Vitest project: a package-resident copy
// would only run when its own package is in scope, and most pushes never reach packages/db.
//
// It reads TEXT and says so. A migration that builds a predicate dynamically, or names a label
// through a variable, is not seen. SQL comments ARE stripped first — without that, the very comment
// explaining a fix would trip the guard the fix exists to satisfy.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

const ADD_VALUE = /ALTER\s+TYPE\s+(?:"?public"?\.)?"?\w+"?\s+ADD\s+VALUE\s+'([^']+)'/gi;

/** `--` to end of line. Drizzle's own `--> statement-breakpoint` markers go the same way. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function migrationsOf(from: string): { tag: string; sql: string }[] {
  const folder = resolve(join(ROOT, "packages/migrations"), from);
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: withoutComments(readFileSync(join(folder, `${entry.tag}.sql`), "utf8")),
  }));
}

describe("no migration names an enum label added in the same pending batch", () => {
  // Drizzle applies every PENDING migration of a set in one transaction
  // (drizzle-orm@0.45.2/pg-core/dialect.js:60), and PostgreSQL refuses to use an enum label in the
  // transaction that added it unless the type was created there too. A virgin database creates the
  // type in that same batch, so this defect passes CI and breaks only real upgrades — which is why
  // it is caught statically here rather than left to a fresh-database test.
  // Receipt: packages/db/drizzle/0013 + 0014 broke every core upgrade point, measured 2026-09-10.
  for (const set of MANIFEST) {
    it(`is safe in the ${set.name} set`, () => {
      const migrations = migrationsOf(set.from);
      const offences: string[] = [];
      migrations.forEach((migration, index) => {
        for (const match of migration.sql.matchAll(ADD_VALUE)) {
          const quoted = `'${match[1]!}'`;
          const after = migration.sql.slice(match.index! + match[0].length);
          // The adding file below its own ADD VALUE, and every later file: all one transaction.
          const named = [
            ...(after.includes(quoted) ? [migration.tag] : []),
            ...migrations
              .slice(index + 1)
              .filter((later) => later.sql.includes(quoted))
              .map((later) => later.tag),
          ];
          if (named.length > 0) {
            offences.push(
              `${migration.tag} adds enum label ${quoted}, named again in ${named.join(", ")} — ` +
                `compare the column as ::text instead`,
            );
          }
        }
      });
      expect(offences).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Prove the guard by deletion, in both directions**

```bash
pnpm vitest run scripts/enum-add-value-safety.test.ts
```
Expected: every set PASSES (Task 1 already fixed the one offender).

Now the deletion. Temporarily revert Task 1's cast — `git stash` is not enough, edit the file to put
the four bare literals back — and re-run. Expected: the `core` case FAILS, naming
`0013_central_printer_provisioning` and `0014_central_printer_provisioning_sql`. Restore with
`git checkout -- packages/db/drizzle/` and re-run: every set PASSES.

Then prove the comment-stripping matters, which is a separate guard inside the guard: temporarily
change `withoutComments` to `return sql;` and re-run. Expected: `core` FAILS, because Task 1's own
explanatory comment mentions the label. Restore it.

**Report all three outcomes.** A guard seen only to pass proves nothing, and a guard whose two
directions give the same answer measures nothing (CLAUDE.md §1).

- [ ] **Step 3: Commit**

```bash
git add scripts/enum-add-value-safety.test.ts
git commit -s -m "test(root): guard against naming an enum label added in the same migration batch"
```

---

### Task 3: Guard the journal-ordering shape

**Files:**
- Create: `scripts/journal-monotonic.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the guard, with the one existing violation allowlisted and explained**

Create `scripts/journal-monotonic.test.ts`:

```ts
// Root project, same reasoning as scripts/enum-add-value-safety.test.ts: it reads the whole tree.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "packages/migrations/migrations.manifest.json"), "utf8"),
) as { name: string; table: string; from: string }[];

/**
 * Sets whose journal is already out of order, with the reason each is still here.
 *
 * SHRINK THIS LIST, NEVER GROW IT. An entry is not a licence: it records a defect that cannot be
 * repaired, only contained.
 *
 * `core` — entries 2 to 6 carry `when` values below entry 1's, so drizzle's `max(created_at)`
 * watermark (drizzle-orm@0.45.2/pg-core/dialect.js:56-62) SKIPS them for a database whose highest
 * recorded value is entry 1's. Measured 2026-09-10: a database at entry 1 upgrading to HEAD applies
 * 10 of 15 migrations and raises nothing. It cannot be fixed by editing the journal — raising the
 * out-of-order entries makes points 3 to 7 RE-APPLY a migration they already ran and fail, and
 * lowering the earlier ones changes nothing because the database stored the old value, not the
 * file's. The residual skip is made loud at runtime instead, by the boot-failure diagnosability
 * work. Fixing it properly means a squashed baseline, which is a separate decision.
 */
const KNOWN_NON_MONOTONIC = ["core"];

describe("every migration set's journal is strictly increasing", () => {
  // Drizzle decides what to apply from `max(created_at)` alone, never from a journal index, so a
  // `when` value below one already recorded is a migration that will never run — with no error.
  for (const set of MANIFEST) {
    it(`holds for the ${set.name} set`, () => {
      const folder = resolve(join(ROOT, "packages/migrations"), set.from);
      const journalPath = join(folder, "meta", "_journal.json");
      if (!existsSync(journalPath)) return;
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { when: number; tag: string }[];
      };
      const outOfOrder: string[] = [];
      let highest = Number.NEGATIVE_INFINITY;
      for (const entry of journal.entries) {
        if (entry.when <= highest) outOfOrder.push(`${entry.tag} (when ${entry.when})`);
        highest = Math.max(highest, entry.when);
      }
      if (KNOWN_NON_MONOTONIC.includes(set.name)) {
        // The allowlist is asserted, not merely skipped: if this set is ever repaired, this fails and
        // tells whoever repaired it to delete the entry.
        expect(outOfOrder.length, `${set.name} is repaired — remove it from KNOWN_NON_MONOTONIC`)
          .toBeGreaterThan(0);
        return;
      }
      expect(outOfOrder).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it, and prove it by deletion**

```bash
pnpm vitest run scripts/journal-monotonic.test.ts
```
Expected: every set PASSES — the non-core sets because they are in order, `core` because its
allowlist branch asserts it is still out of order.

Deletion proof: temporarily remove `"core"` from `KNOWN_NON_MONOTONIC` and re-run. Expected: `core`
FAILS, listing entries `0002` through `0006`. Restore it. **Report both outcomes.**

- [ ] **Step 3: Commit**

```bash
git add scripts/journal-monotonic.test.ts
git commit -s -m "test(root): guard a migration journal against a when value that can never apply"
```

---

## Final gate before the PR

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm vitest run scripts/
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
```

This branch changes a migration, so the whole workspace runs too:

```bash
memory_pressure | grep free          # scale concurrency to measured headroom, never a count
TESTCONTAINERS_RYUK_DISABLED=true pnpm test
pnpm reap
```

Then `/finish-branch`. **Risk trigger: a migration.** The FULL review ceremony applies, and the
Codex run-it seat's brief should ask it to reproduce an upgrade from a mid-history release point
rather than only reading the diff.
