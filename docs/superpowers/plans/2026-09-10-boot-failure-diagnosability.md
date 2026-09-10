# Boot-failure diagnosability — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box that will not boot tells its operator, on the unauthenticated recovery page, what is
wrong and what to do about it — and the schema defect that actually bricked the first real box is
fixed at the root.

**Architecture:** A pure `classifyBootFailure` sits between `runEntry`'s catch and the recovery
state, turning a raw driver failure into a named code. An explicit journal-hash comparison, run
after `ensureInstance`, names a database migrated by a different image. The recovery page renders
fixed operator text keyed by that code and never the caught error's own words; the scrubbed real
error goes to `docker logs` for whoever installed the box.

**Tech Stack:** TypeScript (NodeNext ESM), Hono, drizzle-orm 0.45.2, node-postgres, Vitest,
Testcontainers (PostgreSQL 18).

**Spec:** `docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md` — read it
first; every task below argues from it.

---

## What the spec's §6 experiment settled

The spec left one question open (§8): *"the artefact that actually broke the boot … was **not
confirmed**"*. It was run on 2026-09-10 against PostgreSQL 18 — the box's own version
(`deploy/compose.yml`) — before this plan was written. Three findings, each with the control that
makes it a measurement rather than a guess.

**Finding 1 — the incident was not an "ahead" database.** It was a migration pair that cannot be
applied to any existing database: `packages/db/drizzle/0013` adds an enum label and `0014` names it
inside drizzle's single migrate transaction, which PostgreSQL refuses with `55P04`. A fresh database
creates the type in that same batch and is allowed, which is why CI is green. **That defect and its
guards are NOT in this plan** — they are a separate branch, `fix/core-migration-upgrade`
(`docs/superpowers/plans/2026-09-10-core-migration-upgrade.md`), because they block every box upgrade
today and should not wait behind a web surface and two barrel changes.

**Finding 2 — a second, silent defect sits underneath it, and that half IS this plan's business.**
`packages/db/drizzle/meta/_journal.json` is non-monotonic: entries 2–6 carry `when` values below
entry 1's. Drizzle applies a migration only when `max(created_at) < migration.folderMillis`
(`drizzle-orm@0.45.2/pg-core/dialect.js:56-62`), so those entries are skipped — with **no error**.
Measured, with the enum defect fixed so it could be seen at all:

| box at core entry | migrations applied |
| --- | --- |
| 0 (fresh) | 15 of 15 |
| 1, 2 | 10 of 15 |
| 3, 4, 5, 6 | 11, 12, 13, 14 of 15 |
| 7 – 14 | 15 of 15 |

It cannot be repaired by editing the journal, and that was measured rather than assumed: raising the
out-of-order entries makes points 3–7 re-apply a migration they already ran and fail with "type
already exists"; lowering the earlier ones changes nothing, because a database recorded the old
value, not the file's. So the fix is to stop the skip being SILENT — Task 1 — which is squarely this
spec's subject: a wrong state that says nothing is exactly the defect class §1 of the spec describes.

**Finding 3 — §4.2's ahead check stands, and its mechanism is confirmed.** With a journal watermark
ahead of every shipped migration's `when`, drizzle's migrate **applies nothing and throws nothing**;
the database's extra hash is the only evidence. The control, a database migrated by this image alone,
reports none:

```
STEP 3: DB hashes with no file in this image (AHEAD evidence): [ { id: 2, hash: "515d38af…" } ]
STEP 4: negative control — control unknown-hash count: 0 (expected 0)
```

Two mechanical facts fall out and are load-bearing below. The journal table is
`(id serial, hash text not null, created_at bigint)`, and drizzle's `hash` is
`sha256(<tag>.sql file text)` (`drizzle-orm/migrator.js`). Comparing **hashes** therefore catches both
an extra migration and an edited one, and avoids `created_at` entirely — which matters, because
`bigint` reaches JavaScript as a **string** (measured: `created_at JS type: string`).

**Finding 4 — §4.1's schema-mismatch table gains `55P04`**, written from the experiment as §6
requires: it is the SQLSTATE the first real box actually produced.

## Global Constraints

- **Error codes are never renamed once shipped.** `provisioning.database_unreachable` **already
  exists**, declared in `apps/server/src/errors.ts:219` as `{ attempts: number }`. Do **not**
  re-declare it, move it, or change its params — a second `declare module` entry for the same key is
  a TypeScript duplicate-property error. The two genuinely new codes are
  `provisioning.database_ahead` and `provisioning.schema_mismatch`, declared in
  `packages/provisioning/src/errors.ts`.
- **`classifyBootFailure(error: unknown): string` returns a bare code string**, per spec §4.1. It
  constructs no `AppError`, so the spec's `{ code }` / `{ sqlState }` notation describes the family,
  not a params object the classifier builds. The detail reaches the installer through the scrubbed
  stdout of Task 7, never through the page.
- **The recovery page renders only: the level, the failure count, the escaped code, the escaped log
  tail, and fixed strings chosen by code.** No caught error's `message`, `stack`, `cause` or params
  may reach it. This is spec §5 and is pinned by a test with a control.
- **Every new `provisioning.*` code is declared in `packages/provisioning/src/errors.ts`** and stays
  reachable from that package's barrel (`packages/provisioning/src/index.ts` already ends with
  `import "./errors.js";`).
- **A journal table name reaches SQL as text, never a placeholder.** Reuse the existing guard
  `const DRIZZLE_MIGRATIONS_TABLE = /^__drizzle_migrations_[a-z_]+$/;` and the classified
  `migrations.invalid_table` throw, exactly as `packages/migrations/src/schema-version.ts:54-56`
  does.
- **Real Postgres, never PGlite, for anything about migrations, journals or grants** (CLAUDE.md §4).
  PGlite connections are superusers and the journal semantics under test are drizzle's against real
  Postgres.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally**, and `pnpm reap` after any interrupted
  run.
- **Coverage thresholds are unchanged**: `apps/server`, `packages/migrations` and
  `packages/provisioning` all sit at the floor `90/90/85/85`. Do not edit any `vitest.config.ts`
  thresholds; `scripts/coverage-thresholds.test.ts` pins them.
- **This branch depends on `fix/core-migration-upgrade`.** Rebase onto it once it lands. That branch
  edits `packages/db/drizzle/0014_central_printer_provisioning_sql.sql`, which changes the file's
  drizzle hash — so **every database that already applied the old `0014`** (every dev and demo
  database provisioned since #304 landed on 2026-09-09) carries a hash the image no longer ships, and
  **Task 5's check will refuse to boot it** with `provisioning.database_ahead`. That is the check
  working, not a bug: the database really was migrated by a different image. The remedy is
  `wa-wt reset demo`. Say so in the PR description and in Task 10's spec addendum, because the first
  developer to hit it will otherwise read the recovery page's "restore from a backup" and reach for
  one that does not exist.
- **Every commit is `git commit -s`.**

## File structure

**Created**

| file | responsibility |
| --- | --- |
| `apps/server/src/redact-secrets.ts` | `redactSecrets(text)` — masks URL-embedded credentials. Nothing else. |
| `apps/server/src/redact-secrets.test.ts` | Its suite, with two controls. |
| `apps/server/src/boot-failure.ts` | `classifyBootFailure(error)` plus the three pinned tables. |
| `apps/server/src/boot-failure.test.ts` | Its suite, incl. the exhaustiveness walks and the `EPIPE` negative control. |
| `packages/migrations/src/journal-hashes.ts` | `journalHashes` (database side) and `imageMigrationHashes` (file side). Reading only, no policy. |
| `packages/migrations/src/journal-hashes.test.ts` | Unit suite for the file side and the table-name guard. |
| `packages/provisioning/src/schema-ahead.ts` | `unknownHashes` (pure), `findAheadSets`, `assertNotAhead` (throws `provisioning.database_ahead`). |
| `packages/provisioning/src/schema-ahead.test.ts` | Unit suite over injected reads. |
| `packages/provisioning/src/schema-ahead.pg.test.ts` | The spec §6 run-it proof, with its negative control and prove-by-deletion. |
| `packages/migrations/src/apply-complete.pg.test.ts` | Proof that a silently short migration now throws, with an idempotent-re-run control. |

**Modified**

| file | change |
| --- | --- |
| `packages/migrations/src/apply.ts` | Counts what applied against what shipped, and throws when they differ. |
| `packages/migrations/src/errors.ts` | Declares `migrations.incomplete`. |
| `packages/provisioning/src/errors.ts` | Declares `provisioning.database_ahead` and `provisioning.schema_mismatch`. |
| `packages/provisioning/src/index.ts` | Exports the schema-ahead surface. |
| `packages/migrations/src/index.ts` | Exports `journalHashes`, `imageMigrationHashes`. |
| `apps/server/src/node-entry.ts` | Classifier at the catch; scrubbed reporter; the ahead check between `ensureInstance` and `startServer`. |
| `apps/server/src/node-entry.test.ts` | Tests for the three wirings. |
| `apps/server/src/recovery-surface.ts` | `renderPage` gains the code→text table. |
| `apps/server/src/recovery-surface.test.ts` | Curated-text tests and the §5 leak probe with its control. |
| `deploy/try-branch.sh`, `deploy/README.md` | The one-way-migration warning. |
| `docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md` | A dated addendum recording the confirmed artefact. |
| `docs/backlog.md` | Track P status. |

---

### Task 1: Make an incomplete migration loud

The measured residual from the migration branch: a database whose journal watermark sits above a
later migration's `when` SKIPS that migration — no error, a wrong schema, and the next symptom is an
unclassified driver failure somewhere else entirely. `applyMigrations` is the one place every host
migrates through, so the check belongs there.

**Files:**
- Modify: `packages/migrations/src/apply.ts`, `packages/migrations/src/errors.ts`
- Create: `packages/migrations/src/apply-complete.pg.test.ts`

**Interfaces:**
- Consumes: `appliedSchemaVersion`, `expectedSchemaVersion` (`./schema-version.js`, both already
  exported from the barrel).
- Produces: the code `migrations.incomplete`, and the unchanged `applyMigrations` signature —
  `applyMigrations(connectionString: string, options: readonly MigrationOptions[]): Promise<void>`.
  It gains a throw, not a parameter.

- [ ] **Step 1: Write the failing test**

Create `packages/migrations/src/apply-complete.pg.test.ts`:

```ts
// Real PostgreSQL: the behaviour under test is drizzle's watermark arithmetic against a real
// journal table, and PGlite would be a false pass twice over (CLAUDE.md §4).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { databaseUrl, startPostgresContainer, type StartedContainer } from "@waitron/db/testing/postgres.js";
import { applyMigrations } from "./apply.js";

const CORE_DRIZZLE = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const TABLE = "__drizzle_migrations_db";
const scratch: string[] = [];

const journal = JSON.parse(readFileSync(join(CORE_DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: { when: number; tag: string }[];
} & Record<string, unknown>;

/** A migrations folder carrying the given entries, with `when` values as supplied. */
function folderOf(entries: { when: number; tag: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-complete-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  for (const entry of entries) {
    copyFileSync(join(CORE_DRIZZLE, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  return dir;
}

describe("applyMigrations refuses to report success on an incomplete set", () => {
  let container: StartedContainer;

  beforeAll(async () => {
    container = await startPostgresContainer();
  }, 180_000);

  afterAll(async () => {
    // Guarded: `startPostgresContainer` may have thrown, leaving `container` unassigned.
    if (container !== undefined) await container.stop();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  async function freshDatabase(name: string): Promise<string> {
    const admin = new pg.Client({ connectionString: container.uri });
    await admin.connect();
    try {
      await admin.query(`create database "${name}"`);
    } finally {
      await admin.end();
    }
    return databaseUrl(container.uri, name);
  }

  it("throws migrations.incomplete when drizzle's watermark skipped a migration", async () => {
    const uri = await freshDatabase("wt_incomplete");
    const first = journal.entries[0]!;
    const second = journal.entries[1]!;
    // A database migrated by a folder whose ONE entry carries a HIGH `when` …
    await applyMigrations(uri, [
      { migrationsFolder: folderOf([{ ...first, when: 9_000_000_000_000 }]), migrationsTable: TABLE },
    ]);
    // … then handed a folder whose second entry sits BELOW that watermark. Drizzle applies nothing
    // and raises nothing; this is exactly the shape that skipped five core migrations in silence.
    await expect(
      applyMigrations(uri, [
        {
          migrationsFolder: folderOf([{ ...first, when: 9_000_000_000_000 }, { ...second, when: 1 }]),
          migrationsTable: TABLE,
        },
      ]),
    ).rejects.toMatchObject({ code: "migrations.incomplete" });
  }, 180_000);

  it("resolves for a set that applied completely — the control", async () => {
    const uri = await freshDatabase("wt_complete");
    const folder = folderOf(journal.entries.slice(0, 2));
    await expect(
      applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    // And again, idempotently: a re-run applies nothing and must still be complete, or every second
    // boot of a healthy box would throw.
    await expect(
      applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
  }, 180_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-feat-boot-failure-diagnosability
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations exec vitest run src/apply-complete.pg.test.ts
```
Expected: the first test FAILS because `applyMigrations` resolves instead of throwing. The control
PASSES. Both halves matter — a first test that failed because the fixture is broken would fail the
control too.

- [ ] **Step 3: Declare the code**

Add to the `interface ErrorParams` block in `packages/migrations/src/errors.ts`:

```ts
    /**
     * A migration set reported success with fewer migrations applied than the image ships.
     *
     * Drizzle decides what to apply from `max(created_at)` alone — never a journal index or a hash
     * (`drizzle-orm@0.45.2/pg-core/dialect.js:56-62`) — so a migration whose `when` sits below a
     * value the database already recorded is never applied, and nothing is raised. Measured
     * 2026-09-10: a database at the core set's entry 1 upgraded to HEAD with 10 of 15 migrations
     * applied and no error. The wrong schema then surfaces as an unclassified driver failure in
     * whatever query first touches it, which is the diagnosability defect this branch exists to
     * remove.
     *
     * Both counts are journal lengths — public facts about a build artefact, never data.
     */
    "migrations.incomplete": { set: string; applied: number; expected: number };
```

- [ ] **Step 4: Write the implementation**

In `packages/migrations/src/apply.ts`, extend the imports:

```ts
import { AppError } from "@waitron/shared";
import { appliedSchemaVersion, expectedSchemaVersion } from "./schema-version.js";
import "./errors.js";
```

`MigrationOptions` carries no set NAME, only a folder and a table, so derive the two versions from
what this function already has. Replace the migrate loop (currently
`for (const set of options) await runMigrations(migrationDb, set);`) with:

```ts
        // Ordering is the runtime's responsibility and nothing enforces it — core carries `tenants`,
        // which every other set has a foreign key to. The manifest states that order out loud.
        for (const set of options) {
          await runMigrations(migrationDb, set);
          // Drizzle can apply NOTHING and raise nothing: it compares only `max(created_at)` against
          // each shipped migration's `when`, so an entry whose `when` sits below a value the
          // database already recorded is skipped in silence. Counting is the only way to notice,
          // and a host that boots on a half-migrated schema fails later, somewhere unrelated.
          const applied = await appliedSchemaVersion(migrationDb, {
            name: set.migrationsTable,
            table: set.migrationsTable,
            from: set.migrationsFolder,
          });
          const expected = expectedSchemaVersion(
            { name: set.migrationsTable, table: set.migrationsTable, from: set.migrationsFolder },
            null,
          );
          if (applied !== expected) {
            throw new AppError("migrations.incomplete", {
              set: set.migrationsTable,
              applied,
              expected,
            });
          }
        }
```

`expectedSchemaVersion` resolves `from` against `packages/migrations` when `root` is null, which is
wrong for an absolute folder — check `resolveMigrationsFolder` in `manifest.ts` before writing this,
and if it does not handle an absolute `from`, read the journal length directly here instead:

```ts
          const journalPath = join(set.migrationsFolder, "meta", "_journal.json");
          const expected = (
            JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] }
          ).entries.length;
```

Use whichever is correct and say in your report which you used and why. Add
`import { readFileSync } from "node:fs";` and `import { join } from "node:path";` if you take the
second form.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations exec vitest run src/apply-complete.pg.test.ts
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test:coverage
```
Expected: PASS.

Then the blast check, because this adds a throw to the function every host migrates through:

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
```
Expected: PASS. If a suite migrates a partial set deliberately, it will now throw — report it rather
than weakening the check.

- [ ] **Step 6: Commit**

```bash
git add packages/migrations/src/apply.ts packages/migrations/src/errors.ts packages/migrations/src/apply-complete.pg.test.ts
git commit -s -m "feat(migrations): refuse to report success when a set applied incompletely"
```

---

### Task 2: `redactSecrets`

**Files:**
- Create: `apps/server/src/redact-secrets.ts`, `apps/server/src/redact-secrets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function redactSecrets(text: string): string` — used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/redact-secrets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact-secrets.js";

describe("redactSecrets", () => {
  it("masks the password in a postgres URL", () => {
    expect(redactSecrets("connect failed: postgres://waitron:hunter2@db:5432/waitron")).toBe(
      "connect failed: postgres://waitron:***@db:5432/waitron",
    );
  });

  // Control: a URL with no credentials must come back byte-identical, or the "masks a password"
  // case above would also pass with a function that mangles every URL.
  it("leaves a URL with no credentials alone", () => {
    const text = "GET https://waitron.example/health returned 503";
    expect(redactSecrets(text)).toBe(text);
  });

  // Control: an ordinary message must be untouched.
  it("leaves an ordinary message alone", () => {
    const text = "TypeError: Cannot read properties of undefined (reading 'query')";
    expect(redactSecrets(text)).toBe(text);
  });

  it("masks every occurrence across a multi-line stack", () => {
    const stack = [
      "Error: connect ECONNREFUSED postgres://a:one@h/d",
      "    at Client (postgres://b:two@h2/d2)",
      "    at runEntry (/app/node-entry.js:1:1)",
    ].join("\n");
    expect(redactSecrets(stack)).toBe(
      [
        "Error: connect ECONNREFUSED postgres://a:***@h/d",
        "    at Client (postgres://b:***@h2/d2)",
        "    at runEntry (/app/node-entry.js:1:1)",
      ].join("\n"),
    );
  });

  it("masks an empty password, which is still a credential position", () => {
    expect(redactSecrets("postgres://user:@host/db")).toBe("postgres://user:***@host/db");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @waitron/server exec vitest run src/redact-secrets.test.ts
```
Expected: FAIL — `Failed to load .../redact-secrets.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/redact-secrets.ts`:

```ts
/**
 * Credentials embedded in a URL, masked: `scheme://user:secret@host` → `scheme://user:***@host`.
 *
 * DELIBERATELY NARROW. It masks the one leak the entrypoint's existing comments name — a `pg`
 * connection failure whose message carries the connection string it was built from
 * (`node-entry.ts`'s `waitForPostgres`) — and it makes no claim to scrub anything else. It is not a
 * general secret scrubber and must not be described as one: the text it protects goes to the
 * container's stdout (`docker logs`), which is the installer's channel, never the unauthenticated
 * recovery page. The page's protection is structural — it renders fixed strings chosen by code
 * (`recovery-surface.ts`), not this function's output.
 *
 * The user-info half is left visible: a role name is already in the box's own configuration and
 * naming it is what makes the line diagnosable, while the secret half is what must never be read
 * off a terminal someone is screen-sharing.
 */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/?#@]+):[^\s@/]*@/g;

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1:***@");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/server exec vitest run src/redact-secrets.test.ts
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/redact-secrets.ts apps/server/src/redact-secrets.test.ts
git commit -s -m "feat(server): mask URL-embedded credentials for the installer's log channel"
```

---

### Task 3: `classifyBootFailure`

**Files:**
- Create: `apps/server/src/boot-failure.ts`, `apps/server/src/boot-failure.test.ts`

**Interfaces:**
- Consumes: `sqlStateOf` from `@waitron/shared`; `isAppError` from `@waitron/shared`.
- Produces:
  - `export function classifyBootFailure(error: unknown): string`
  - `export const UNREACHABLE_SOCKET_CODES: readonly string[]`
  - `export const UNREACHABLE_SQL_STATES: readonly string[]`
  - `export const SCHEMA_MISMATCH_SQL_STATES: readonly string[]`

  Task 7 calls `classifyBootFailure`; Task 8 keys the page's table on the codes it can return.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/boot-failure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  SCHEMA_MISMATCH_SQL_STATES,
  UNREACHABLE_SOCKET_CODES,
  UNREACHABLE_SQL_STATES,
  classifyBootFailure,
} from "./boot-failure.js";

/** The shape drizzle produces: the driver's error one level down under `cause`. */
function wrapped(code: string): Error {
  return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) });
}

describe("classifyBootFailure", () => {
  it("keeps an AppError's own code — the existing classification is unchanged", () => {
    expect(classifyBootFailure(new AppError("server.config_missing", { variable: "X" }))).toBe(
      "server.config_missing",
    );
  });

  it("names every pinned socket code as an unreachable database", () => {
    // Walks the pinned list: a code added to the table without a mapping fails here.
    for (const code of UNREACHABLE_SOCKET_CODES) {
      expect(classifyBootFailure(Object.assign(new Error("connect"), { code }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(code))).toBe("provisioning.database_unreachable");
    }
  });

  it("names every pinned connection SQLSTATE as an unreachable database", () => {
    for (const state of UNREACHABLE_SQL_STATES) {
      expect(classifyBootFailure(Object.assign(new Error("pg"), { code: state }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(state))).toBe("provisioning.database_unreachable");
    }
  });

  it("names every pinned schema SQLSTATE as a schema mismatch", () => {
    for (const state of SCHEMA_MISMATCH_SQL_STATES) {
      expect(classifyBootFailure(Object.assign(new Error("pg"), { code: state }))).toBe(
        "provisioning.schema_mismatch",
      );
      expect(classifyBootFailure(wrapped(state))).toBe("provisioning.schema_mismatch");
    }
  });

  it("leaves a TypeError unknown", () => {
    expect(classifyBootFailure(new TypeError("x is not a function"))).toBe("unknown");
  });

  // The negative control the spec requires. `EPIPE` is five upper-case characters, so it passes
  // `sqlStateOf`'s SHAPE filter and arrives looking exactly like a SQLSTATE. It is not one, and it
  // must not be classified as a database failure — the tables are membership lists, not patterns.
  it("does not treat EPIPE as a database error, though it passes the SQLSTATE shape filter", () => {
    expect(classifyBootFailure(Object.assign(new Error("write"), { code: "EPIPE" }))).toBe("unknown");
  });

  it("classifies a non-error value as unknown rather than throwing", () => {
    expect(classifyBootFailure("boom")).toBe("unknown");
    expect(classifyBootFailure(undefined)).toBe("unknown");
  });

  // The same two guards `sql-state.test.ts` pins on its own walk, for the same reason: each is a
  // branch that only a deliberately adversarial input reaches.
  it("stops at the walk-depth bound rather than spinning down an unbounded chain", () => {
    let deep: Error = Object.assign(new Error("bottom"), { code: "ECONNREFUSED" });
    for (let i = 0; i < 8; i += 1) deep = new Error("wrap", { cause: deep });
    expect(classifyBootFailure(deep)).toBe("unknown");
  });

  it("stops rather than spinning on a self-referential cause", () => {
    const looped: { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(classifyBootFailure(looped)).toBe("unknown");
  });

  it("keeps the two SQLSTATE tables disjoint", () => {
    const overlap = UNREACHABLE_SQL_STATES.filter((state) =>
      SCHEMA_MISMATCH_SQL_STATES.includes(state),
    );
    expect(overlap).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @waitron/server exec vitest run src/boot-failure.test.ts
```
Expected: FAIL — cannot resolve `./boot-failure.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/boot-failure.ts`:

```ts
import { isAppError, sqlStateOf } from "@waitron/shared";
import "./errors.js";

/** The same bound `sqlStateOf` uses, and for the same reason: a self-referential `cause` must not spin. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Node socket-level failures. A refused connection is NOT a SQLSTATE — `sqlStateOf` returns null for
 * every one of these, because they are not five `[0-9A-Z]` characters — so this branch tests the
 * Node `code` itself. `waitForPostgres` already retries a refused connection for up to sixty
 * seconds, so reaching here means the failure outlasted that wait.
 */
export const UNREACHABLE_SOCKET_CODES: readonly string[] = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
];

/** Driver-level refusals to connect: bad password, no such database, cluster not accepting yet. */
export const UNREACHABLE_SQL_STATES: readonly string[] = ["28P01", "3D000", "57P03"];

/**
 * The database does not carry the schema this image expects. Written from the run-it experiment, not
 * before it (spec §6): `55P04` is the one the first real box actually produced — drizzle applies a
 * set's pending migrations in one transaction and PostgreSQL refuses to use an enum value added
 * inside it, so an upgrade aborts there. `22P02` is the same enum mismatch seen from the query side
 * once the value never committed.
 */
export const SCHEMA_MISMATCH_SQL_STATES: readonly string[] = [
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object
  "22P02", // invalid_text_representation — an enum label this image does not have
  "55P04", // object_not_in_prerequisite_state — unsafe use of a new enum value
];

const SOCKET = new Set(UNREACHABLE_SOCKET_CODES);
const UNREACHABLE = new Set(UNREACHABLE_SQL_STATES);
const MISMATCH = new Set(SCHEMA_MISMATCH_SQL_STATES);

/** The first `code` in the cause chain that names a socket failure we classify, or null. */
function socketCodeOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === "string" && SOCKET.has(code)) return code;
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === current) return null;
    current = cause;
  }
  return null;
}

/**
 * The best code the entrypoint can name for a boot failure, sitting between `runEntry`'s catch and
 * the recovery state — so the unauthenticated page shows a classification rather than the single
 * word `unknown` that told the first real box's operator nothing.
 *
 * Both tables are EXHAUSTIVE BY CONSTRUCTION — membership in a pinned list, never a pattern — which
 * is what keeps `EPIPE` out: it is five upper-case characters and therefore passes `sqlStateOf`'s
 * shape filter, but it is in neither list, so it stays `unknown`. `boot-failure.test.ts` walks each
 * list and pins that control.
 *
 * `unknown` is the rare fallback now, and on the page it means "the installer can read the reason on
 * the box" — which is true, because `runEntry` writes the scrubbed error to stdout for every
 * failure.
 */
export function classifyBootFailure(error: unknown): string {
  if (isAppError(error)) return error.code;
  if (socketCodeOf(error) !== null) return "provisioning.database_unreachable";
  const sqlState = sqlStateOf(error);
  if (sqlState !== null) {
    if (UNREACHABLE.has(sqlState)) return "provisioning.database_unreachable";
    if (MISMATCH.has(sqlState)) return "provisioning.schema_mismatch";
  }
  return "unknown";
}
```

Note: `import "./errors.js"` keeps this file's use of `provisioning.*` codes beside the registry the
rest of `apps/server` imports, matching the rule in `apps/server/src/errors.ts`'s header. The two new
codes themselves are declared in Task 5, in `packages/provisioning/src/errors.ts`; until that task
lands, this file compiles because it returns bare strings, not `AppError`s.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/server exec vitest run src/boot-failure.test.ts
```
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot-failure.ts apps/server/src/boot-failure.test.ts
git commit -s -m "feat(server): classify a boot failure instead of reporting unknown"
```

---

### Task 4: Read journal hashes, both sides

**Files:**
- Create: `packages/migrations/src/journal-hashes.ts`, `packages/migrations/src/journal-hashes.test.ts`
- Modify: `packages/migrations/src/index.ts`

**Interfaces:**
- Consumes: `MigrationSet`, `resolveExistingMigrationsFolder` (`./manifest.js`); `pgErrorCode`,
  `Database` (`@waitron/db`); `AppError` (`@waitron/shared`).
- Produces:
  - `export function imageMigrationHashes(set: MigrationSet, root: string | null): string[]`
  - `export async function journalHashes(db: Pick<Database, "execute">, set: MigrationSet): Promise<string[] | null>`

  Task 5 consumes both. `journalHashes` returns `null` — not `[]` — when the journal table is absent,
  because "this set was never migrated" and "this set is migrated and empty" must not collapse.

- [ ] **Step 1: Write the failing test**

Create `packages/migrations/src/journal-hashes.test.ts`:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { manifestSets } from "./manifest.js";
import { imageMigrationHashes, journalHashes } from "./journal-hashes.js";

const core = manifestSets().find((set) => set.name === "core")!;

describe("imageMigrationHashes", () => {
  it("returns one hash per journal entry, in journal order", () => {
    const folder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const hashes = imageMigrationHashes(core, null);
    expect(hashes).toHaveLength(journal.entries.length);
    // Pins the hash RULE against drizzle's own, rather than restating it: sha256 of the whole .sql
    // file text. If drizzle ever changes it, this fails instead of the ahead check silently
    // reporting every migration as unknown.
    const first = createHash("sha256")
      .update(readFileSync(join(folder, `${journal.entries[0]!.tag}.sql`), "utf8"))
      .digest("hex");
    expect(hashes[0]).toBe(first);
  });

  it("throws the classified migrations.set_missing for a set with no journal", () => {
    const missing = { name: "nope", table: "__drizzle_migrations_nope", from: "../nope/drizzle" };
    const thrown = (() => {
      try {
        imageMigrationHashes(missing, null);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isAppError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe("migrations.set_missing");
  });
});

describe("journalHashes", () => {
  it("refuses a table name that is not a drizzle journal table", async () => {
    const db = { execute: () => Promise.reject(new Error("must not be reached")) };
    const bad = { name: "x", table: 'evil"; drop table tenants; --', from: "../db/drizzle" };
    await expect(journalHashes(db as never, bad)).rejects.toMatchObject({
      code: "migrations.invalid_table",
    });
  });

  it("returns null when the journal table does not exist", async () => {
    const db = {
      execute: () => Promise.reject(Object.assign(new Error("undefined_table"), { code: "42P01" })),
    };
    expect(await journalHashes(db as never, core)).toBeNull();
  });

  it("rethrows any other driver error rather than reporting an unmigrated set", async () => {
    const db = {
      execute: () => Promise.reject(Object.assign(new Error("no connection"), { code: "08006" })),
    };
    await expect(journalHashes(db as never, core)).rejects.toMatchObject({ code: "08006" });
  });

  it("returns the hashes the journal carries, in application order", async () => {
    const db = {
      execute: () => Promise.resolve({ rows: [{ hash: "aa" }, { hash: "bb" }] }),
    };
    expect(await journalHashes(db as never, core)).toEqual(["aa", "bb"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @waitron/migrations exec vitest run src/journal-hashes.test.ts
```
Expected: FAIL — cannot resolve `./journal-hashes.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/migrations/src/journal-hashes.ts`:

```ts
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql } from "drizzle-orm";
import { type Database, pgErrorCode } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { type MigrationSet, resolveExistingMigrationsFolder } from "./manifest.js";
import "./errors.js";

/** The same guard `appliedSchemaVersion` uses: the table name reaches SQL as TEXT, never a placeholder. */
const DRIZZLE_MIGRATIONS_TABLE = /^__drizzle_migrations_[a-z_]+$/;

/**
 * The migration hashes THIS IMAGE ships for a set, in journal order.
 *
 * Computed by drizzle's own `readMigrationFiles`, never by a local sha256 of our own: the value has
 * to equal what drizzle WROTE into the journal table for the comparison in
 * `@waitron/provisioning`'s schema-ahead check to mean anything, and a second copy of the rule is a
 * second thing to keep in step. (The rule today is sha256 of the whole `.sql` file text —
 * `drizzle-orm@0.45.2/migrator.js` — and `journal-hashes.test.ts` pins that against a hand-computed
 * digest so a change in drizzle fails loudly rather than reporting every migration as unknown.)
 */
export function imageMigrationHashes(set: MigrationSet, root: string | null): string[] {
  const folder = resolveExistingMigrationsFolder(set, root);
  return readMigrationFiles({ migrationsFolder: folder }).map((migration) => migration.hash);
}

/**
 * The migration hashes a DATABASE carries for a set, in application order — or `null` when the set's
 * journal table does not exist.
 *
 * `null`, not `[]`: "never migrated" and "migrated, nothing recorded" are different facts, and a
 * caller comparing against the image's files must not read an absent table as "the database has no
 * migration this image lacks". Any other driver error is rethrown, never swallowed, for the reason
 * `appliedSchemaVersion` gives: a connection failure reported as "no journal" would let a caller
 * conclude a fully-migrated database is virgin.
 *
 * Only `hash` is read. `created_at` is deliberately untouched: it is a `bigint`, which
 * `node-postgres` hands back as a STRING, and drizzle compares only that column when it decides what
 * to apply — so a hash comparison is both the safer arithmetic and the stricter check, catching an
 * EDITED migration file that keeps its `when`.
 */
export async function journalHashes(
  db: Pick<Database, "execute">,
  set: MigrationSet,
): Promise<string[] | null> {
  if (!DRIZZLE_MIGRATIONS_TABLE.test(set.table)) {
    throw new AppError("migrations.invalid_table", { table: set.table });
  }
  try {
    const result = await db.execute<{ hash: string }>(
      sql.raw(`select "hash" from "${set.table}" order by "id"`),
    );
    return result.rows.map((row) => row.hash);
  } catch (error) {
    if (pgErrorCode(error) === "42P01") return null;
    throw error;
  }
}
```

Modify `packages/migrations/src/index.ts` — add one line after the `schema-version.js` export:

```ts
export { imageMigrationHashes, journalHashes } from "./journal-hashes.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/migrations exec vitest run src/journal-hashes.test.ts
pnpm --filter @waitron/migrations test:coverage
```
Expected: PASS, thresholds met.

- [ ] **Step 5: Commit**

```bash
git add packages/migrations/src/journal-hashes.ts packages/migrations/src/journal-hashes.test.ts packages/migrations/src/index.ts
git commit -s -m "feat(migrations): read a set's migration hashes from the image and the database"
```

---

### Task 5: The ahead-of-image check and its two new codes

**Files:**
- Create: `packages/provisioning/src/schema-ahead.ts`, `packages/provisioning/src/schema-ahead.test.ts`
- Modify: `packages/provisioning/src/errors.ts`, `packages/provisioning/src/index.ts`

**Interfaces:**
- Consumes: `journalHashes`, `imageMigrationHashes`, `manifestSets`, `MigrationSet` (`@waitron/migrations`).
- Produces:
  - `export interface AheadSet { set: string; unknownMigrations: string[] }`
  - `export function unknownHashes(inDatabase: readonly string[], inImage: readonly string[]): string[]`
  - `export async function findAheadSets(db: Pick<Database, "execute">, sets: readonly MigrationSet[], root: string | null): Promise<AheadSet[]>`
  - `export async function assertNotAhead(db: Pick<Database, "execute">, sets: readonly MigrationSet[], root: string | null): Promise<void>`

  Task 7 calls `assertNotAhead`.

- [ ] **Step 1: Write the failing test**

Create `packages/provisioning/src/schema-ahead.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { imageMigrationHashes, manifestSets, type MigrationSet } from "@waitron/migrations";
import { assertNotAhead, findAheadSets, unknownHashes } from "./schema-ahead.js";

const CORE: MigrationSet = manifestSets().find((set) => set.name === "core")!;
/** What this image really ships for `core` — read from disk, so nothing here restates drizzle's hash rule. */
const SHIPPED = imageMigrationHashes(CORE, null);

/** A database stub that answers the one `select "hash" from …` this module makes. */
function dbWith(hashes: readonly string[]) {
  return { execute: () => Promise.resolve({ rows: hashes.map((hash) => ({ hash })) }) } as never;
}

/** A database whose journal table does not exist — SQLSTATE 42P01, the never-migrated set. */
const dbWithoutJournal = {
  execute: () => Promise.reject(Object.assign(new Error("undefined_table"), { code: "42P01" })),
} as never;

describe("unknownHashes", () => {
  it("returns the database hashes the image has no file for", () => {
    expect(unknownHashes(["a", "b", "c"], ["a", "b"])).toEqual(["c"]);
  });

  // Control: a database BEHIND the image is not ahead. Only the ahead direction is a failure — a
  // behind database is an ordinary upgrade, and `ensureInstance` has already migrated it forward by
  // the time this runs.
  it("reports nothing for a database behind the image", () => {
    expect(unknownHashes(["a"], ["a", "b", "c"])).toEqual([]);
  });

  it("reports nothing when the two agree exactly", () => {
    expect(unknownHashes(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("reports an EDITED migration, whose hash changed although the count did not", () => {
    expect(unknownHashes(["a", "edited"], ["a", "b"])).toEqual(["edited"]);
  });
});

describe("findAheadSets", () => {
  it("skips a set whose journal table does not exist", async () => {
    expect(await findAheadSets(dbWithoutJournal, [CORE], null)).toEqual([]);
  });

  it("reports nothing for a database carrying exactly what this image ships", async () => {
    expect(await findAheadSets(dbWith(SHIPPED), [CORE], null)).toEqual([]);
  });

  it("reports nothing for a database behind this image", async () => {
    expect(await findAheadSets(dbWith(SHIPPED.slice(0, 1)), [CORE], null)).toEqual([]);
  });

  it("names the set and the unknown hashes when the database is ahead", async () => {
    const unknown = "f".repeat(64);
    expect(await findAheadSets(dbWith([...SHIPPED, unknown]), [CORE], null)).toEqual([
      { set: "core", unknownMigrations: [unknown] },
    ]);
  });
});

describe("assertNotAhead", () => {
  it("throws provisioning.database_ahead naming the set and the unknown migrations", async () => {
    const unknown = "f".repeat(64);
    await expect(
      assertNotAhead(dbWith([...SHIPPED, unknown]), [CORE], null),
    ).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core", unknownMigrations: [unknown] },
    });
  });

  it("resolves for a database this image can serve", async () => {
    await expect(assertNotAhead(dbWith(SHIPPED), [CORE], null)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @waitron/provisioning exec vitest run src/schema-ahead.test.ts
```
Expected: FAIL — cannot resolve `./schema-ahead.js`.

- [ ] **Step 3: Declare the two new codes**

Append to the `interface ErrorParams` block in `packages/provisioning/src/errors.ts`, beside
`provisioning.database_not_owned`:

```ts
    /**
     * This deployment's database carries a migration the installed image has no file for — it was
     * migrated by a NEWER or DIFFERENT image. Detected explicitly, because drizzle cannot: it
     * compares only `max(created_at)` against each shipped migration's `when`
     * (`drizzle-orm@0.45.2/pg-core/dialect.js:56-62`) and never a hash, so it applies nothing,
     * throws nothing, and the mismatch surfaces later as an unclassified driver error in whatever
     * query first touches the changed schema. Measured with a control, 2026-09-10.
     *
     * `unknownMigrations` carries drizzle's own sha256 digests of migration FILES — public build
     * artefacts of this repository, not secrets — and they are what an installer greps for to find
     * which image did it. The operator never sees them: the recovery page renders fixed text keyed
     * on the code alone.
     *
     * There is no backward migration by decision (CLAUDE.md §3), so the action is restore or
     * reinstall, never an automatic repair.
     */
    "provisioning.database_ahead": { set: string; unknownMigrations: string[] };
    /**
     * A driver failure whose SQLSTATE says the database does not carry the schema this image
     * expects — an undefined table, column or object, or an enum label the image does not have.
     * Produced by `classifyBootFailure` (`apps/server/src/boot-failure.ts`) as a CLASSIFICATION of
     * an already-thrown driver error, so nothing constructs it with params today; `sqlState` is
     * declared because it is the one fact a future thrower would carry, and the params of a shipped
     * code cannot be widened later without changing a contract.
     */
    "provisioning.schema_mismatch": { sqlState: string };
```

- [ ] **Step 4: Write the implementation**

Create `packages/provisioning/src/schema-ahead.ts`:

```ts
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { imageMigrationHashes, journalHashes, type MigrationSet } from "@waitron/migrations";
import "./errors.js";

export interface AheadSet {
  set: string;
  /** Drizzle hashes present in the database's journal that this image ships no file for. */
  unknownMigrations: string[];
}

/**
 * The database hashes this image has no file for. Set difference in ONE direction only: a database
 * BEHIND the image is an ordinary upgrade, which `ensureInstance` has already migrated forward by
 * the time this runs, and only the ahead direction is unrecoverable.
 */
export function unknownHashes(
  inDatabase: readonly string[],
  inImage: readonly string[],
): string[] {
  const shipped = new Set(inImage);
  return inDatabase.filter((hash) => !shipped.has(hash));
}

/**
 * Every migration set whose database journal carries a migration this image cannot account for.
 *
 * A set with no journal table is skipped rather than reported: it has simply never been migrated
 * here, which is the normal state of a module this deployment does not enable. The image's files are
 * not even read for such a set — cheaper, and it keeps a packaging fault in an unused module's
 * folder from failing a boot that never needed it.
 */
export async function findAheadSets(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSet[],
  root: string | null,
): Promise<AheadSet[]> {
  const ahead: AheadSet[] = [];
  for (const set of sets) {
    const inDatabase = await journalHashes(db, set);
    if (inDatabase === null) continue;
    const unknownMigrations = unknownHashes(inDatabase, imageMigrationHashes(set, root));
    if (unknownMigrations.length > 0) ahead.push({ set: set.name, unknownMigrations });
  }
  return ahead;
}

/**
 * Refuse to boot against a database a different image migrated.
 *
 * Runs AFTER `ensureInstance` so a legitimately behind database has already been brought forward,
 * and BEFORE `startServer` so the failure is named here rather than surfacing as an unclassified
 * driver error in whatever query first touches the changed schema. Reports the FIRST ahead set: one
 * named set with its unknown hashes is what an installer acts on, and every set after it tells the
 * same story.
 */
export async function assertNotAhead(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSet[],
  root: string | null,
): Promise<void> {
  const ahead = await findAheadSets(db, sets, root);
  const first = ahead[0];
  if (first !== undefined) throw new AppError("provisioning.database_ahead", first);
}
```

Add to `packages/provisioning/src/index.ts`, before the trailing `import "./errors.js";`:

```ts
export { assertNotAhead, findAheadSets, unknownHashes } from "./schema-ahead.js";
export type { AheadSet } from "./schema-ahead.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/provisioning exec vitest run src/schema-ahead.test.ts
pnpm --filter @waitron/provisioning typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/provisioning/src/schema-ahead.ts packages/provisioning/src/schema-ahead.test.ts packages/provisioning/src/errors.ts packages/provisioning/src/index.ts
git commit -s -m "feat(provisioning): refuse to boot against a database a different image migrated"
```

---

### Task 6: The run-it proof for the ahead check

The spec's §6 experiment, as a committed regression test. PGlite is a false pass here.

**Files:**
- Create: `packages/provisioning/src/schema-ahead.pg.test.ts`

**Interfaces:**
- Consumes: `assertNotAhead`, `findAheadSets` (Task 5); `startBarePostgres`, `roleUrl` (`./testing/postgres.js`).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/provisioning/src/schema-ahead.pg.test.ts`:

```ts
// Real PostgreSQL. PGlite is a false pass here twice over: every connection is a superuser, and the
// journal semantics under test are drizzle's against real Postgres (CLAUDE.md §4).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withDatabase } from "./instance-apply.js";
import { assertNotAhead, findAheadSets } from "./schema-ahead.js";
import { startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_ahead_suite";
const CORE = manifestSets().find((set) => set.name === "core")!;

describe("an ahead database", () => {
  let pg: RealPostgres;
  let admin: Database;
  let target: Database;

  beforeAll(async () => {
    pg = await startBarePostgres();
    admin = await createPostgresDb(pg.uri);
    await admin.execute(sql.raw(`create database "${DATABASE}"`));
    const uri = withDatabase(pg.uri, DATABASE);
    await applyMigrations(uri, migrationOptionsFor(manifestSets(), null));
    target = await createPostgresDb(uri);
  }, 180_000);

  afterAll(async () => {
    // Guarded: an earlier step may have thrown before the handle was assigned.
    if (target !== undefined) await target.close();
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  // The NEGATIVE CONTROL runs first, and it is what makes the next test a probe rather than a
  // measurement where both answers look alike: a freshly migrated database must be accepted.
  it("is not reported for a database this image migrated itself", async () => {
    expect(await findAheadSets(target, manifestSets(), null)).toEqual([]);
    await expect(assertNotAhead(target, manifestSets(), null)).resolves.toBeUndefined();
  });

  it("is named, with its set and the unknown hash, once a newer image's migration is recorded", async () => {
    // The shape a branch image leaves behind: a journal row whose hash this image ships no file for.
    // Written directly rather than by running a synthetic migration, because the row IS the artefact
    // the check reads — and drizzle records nothing else about a migration.
    const unknown = "f".repeat(64);
    // The table name reaches SQL as an identifier (Postgres binds no placeholder for one), but the
    // VALUES are bound — CLAUDE.md §3 forbids concatenating them and explicitly rejects "the callers
    // only pass safe values" as a defence.
    await target.execute(
      sql`insert into ${sql.identifier(CORE.table)} ("hash", "created_at")
          values (${unknown}, ${9_999_999_999_999})`,
    );

    expect(await findAheadSets(target, manifestSets(), null)).toEqual([
      { set: "core", unknownMigrations: [unknown] },
    ]);
    await expect(assertNotAhead(target, manifestSets(), null)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core", unknownMigrations: [unknown] },
    });
  });

  it("is still ahead after a re-migrate, because drizzle applies and reports nothing", async () => {
    // The mechanism the check exists for, run rather than argued: with a journal watermark ahead of
    // every shipped migration's `when`, drizzle's migrate resolves silently and changes nothing —
    // so a boot that relied on migrate to notice would sail past the mismatch.
    await expect(
      applyMigrations(withDatabase(pg.uri, DATABASE), migrationOptionsFor(manifestSets(), null)),
    ).resolves.toBeUndefined();
    expect(await findAheadSets(target, manifestSets(), null)).not.toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then passes**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning exec vitest run src/schema-ahead.pg.test.ts
```

If Task 5 is already committed this passes immediately. That is the wrong signal for a new test, so
**prove it by deletion before moving on**, which is also the spec §6 "prove the guard by deletion"
step:

1. Comment out the `if (unknownMigrations.length > 0) ahead.push(...)` line in `schema-ahead.ts`.
2. Re-run. Expected: the second and third tests FAIL — the ahead database is no longer reported.
3. Restore the line and re-run. Expected: all three PASS.

**Report both outcomes in your task summary.**

- [ ] **Step 3: Record what an unguarded ahead database actually does**

The spec's §6 sketch expected an unguarded ahead database to fall through to a raw pg error. **It
does not, and saying so without running it would be the §1 defect this repo is worst at.** The third
test above measures the truth: with a journal row ahead of every shipped `when`, drizzle applies
nothing and raises nothing, so a boot with the check removed proceeds *cleanly* — the mismatch only
bites later, in whatever query first touches a schema that is not there.

That makes this check the ONLY thing that names the case, which is a stronger claim than the spec
made, not a weaker one. Write that sentence into your task report; Task 10's spec addendum carries
it into the spec.

- [ ] **Step 4: Commit**

```bash
git add packages/provisioning/src/schema-ahead.pg.test.ts
git commit -s -m "test(provisioning): prove the ahead-database check against real Postgres, with a control"
```

---

### Task 7: Wire the entrypoint — classify, report, refuse

**Files:**
- Modify: `apps/server/src/node-entry.ts`, `apps/server/src/node-entry.test.ts`

**Interfaces:**
- Consumes: `classifyBootFailure` (Task 3), `redactSecrets` (Task 2), `assertNotAhead` (Task 5).
- Produces: two new `EntryDeps` fields, both optional so every existing test fixture still compiles:
  - `assertNotAhead?: (databaseUrl: string) => Promise<void>`
  - `reportFailure?: (text: string) => void` — the installer's stdout sink.

- [ ] **Step 1: Write the failing tests**

Add `RecoveryState` to the existing `./recovery-state.js` type import at the top of
`apps/server/src/node-entry.test.ts`, then add these inside the existing `describe("runEntry")`
block:

```ts
  it("persists the classified code, not `unknown`, for a raw driver failure", async () => {
    // Typed, not a bare `vi.fn(() => …)`: an untyped mock's `mock.calls` entries are a zero-length
    // tuple, so `[1]` is a typecheck error rather than the state we want to read.
    const writeRecoveryState =
      vi.fn((_stateDir: string, _next: RecoveryState) => Promise.resolve());
    await expect(
      runEntry(
        deps({
          writeRecoveryState,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(
              new Error("Failed query", {
                cause: Object.assign(new Error("driver"), { code: "42703" }),
              }),
            ),
          ),
        }),
      ),
    ).rejects.toThrow();
    // The second write is the failure path's; the first is the pre-boot counter.
    const persisted = writeRecoveryState.mock.calls.at(-1)![1];
    expect(persisted.lastErrorCode).toBe("provisioning.schema_mismatch");
  });

  it("writes the scrubbed error to the installer's channel, with URL credentials masked", async () => {
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(new Error("connect failed: postgres://waitron:hunter2@db:5432/waitron")),
          ),
        }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    // The control and the probe in one assertion pair: the message must arrive, minus the secret.
    expect(reported).toContain("postgres://waitron:***@db:5432/waitron");
    expect(reported).not.toContain("hunter2");
  });

  // The spec §5 probe, and the only place it can honestly live: the poisoned message has to be
  // INJECTED as a real boot failure and then followed to BOTH channels. A test that renders a page
  // the message never reached would pass against an implementation that leaks everywhere.
  it("keeps a leaked connection string off the page while the installer's channel carries it", async () => {
    const message = "connect failed: postgres://waitron:hunter2@db:5432/waitron";
    const reportFailure = vi.fn();
    const writeRecoveryState =
      vi.fn((_stateDir: string, _next: RecoveryState) => Promise.resolve());
    await expect(
      runEntry(
        deps({
          reportFailure,
          writeRecoveryState,
          startServer: vi.fn<StartServer>(() => Promise.reject(new Error(message))),
        }),
      ),
    ).rejects.toThrow();

    // The PROBE: the state the page will render, rendered.
    const persisted = writeRecoveryState.mock.calls.at(-1)![1];
    const body = await (
      await recoveryApp({ state: persisted, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("postgres://");

    // The CONTROL, in the other direction: the same failure DOES reach the installer, scrubbed.
    // Without it, a page that rendered nothing at all would pass the assertions above.
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("postgres://waitron:***@db:5432/waitron");
    expect(reported).not.toContain("hunter2");
  });

  it("refuses to start the server when the database is ahead of this image", async () => {
    const startServer = vi.fn<StartServer>(() => Promise.resolve({ close: () => Promise.resolve() }));
    const assertAhead = vi.fn(() =>
      Promise.reject(
        new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["ff"] }),
      ),
    );
    await expect(
      runEntry(deps({ assertNotAhead: assertAhead, startServer })),
    ).rejects.toMatchObject({ code: "provisioning.database_ahead" });
    expect(startServer).not.toHaveBeenCalled();
  });

  it("checks for an ahead database after ensureInstance, never before", async () => {
    const order: string[] = [];
    await runEntry(
      deps({
        ensureInstance: vi.fn(() => {
          order.push("ensureInstance");
          return Promise.resolve({
            databaseUrl: "postgres://app",
            migrationsDatabaseUrl: "postgres://migrator",
            replicationPassword: "r",
          });
        }),
        assertNotAhead: vi.fn(() => {
          order.push("assertNotAhead");
          return Promise.resolve();
        }),
        startServer: vi.fn<StartServer>(() => {
          order.push("startServer");
          return Promise.resolve({ close: () => Promise.resolve() });
        }),
      }),
    );
    // A legitimately BEHIND database must be migrated forward before it is judged.
    expect(order).toEqual(["ensureInstance", "assertNotAhead", "startServer"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts
```
Expected: the four new tests FAIL. The first fails with `lastErrorCode` `"unknown"`; the others
because the deps do not exist yet.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/node-entry.ts`:

1. Add the imports beside the existing ones:

```ts
// Aliased: `EntryDeps` has a field of the same name, and an unaliased import beside it reads as
// though the object literal below were calling itself.
import { assertNotAhead as assertDatabaseNotAhead } from "@waitron/provisioning";
import { manifestSets } from "@waitron/migrations";
import { createPostgresDb } from "@waitron/db";
import { classifyBootFailure } from "./boot-failure.js";
import { redactSecrets } from "./redact-secrets.js";
```

2. Add two fields to `EntryDeps`, after `runStagedRestore`:

```ts
  /** Refuses a database migrated by a different image. Injected so `runEntry` stays unit-testable;
   *  the real one opens its own connection (see the wiring at the bottom of this file). */
  assertNotAhead?: (migrationsDatabaseUrl: string) => Promise<void>;
  /**
   * The INSTALLER's channel — the container's stdout, which is `docker logs`, never the
   * `waitron.log` the recovery page tails. It is the one place the caught error's own words may
   * appear, and only after `redactSecrets`. Injected so the failure path is unit-covered; a test
   * that omits it gets the no-op below and asserts nothing about it.
   */
  reportFailure?: (text: string) => void;
```

3. Replace the body of `runEntry`'s `catch` (currently `node-entry.ts:394-399`) with:

```ts
  } catch (error) {
    // The installer's channel first, so the real reason survives even if the state write fails.
    // Name, message and stack — scrubbed — because `codeOf` alone is what left the first real box's
    // operator and its developer with the single word "unknown" (spec §1).
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}`
        : `non-error thrown: ${String(error)}`;
    (deps.reportFailure ?? (() => {}))(redactSecrets(detail));
    // Same count as the pre-boot write — one attempt is one failure, not two — now carrying the
    // classified code for the page. Rethrown so the process exits non-zero and Docker restarts.
    await persistState(deps, afterFailure(state, classifyBootFailure(error), new Date()));
    throw error;
  }
```

4. Insert the ahead check between `runStagedRestore` and `loadBoxEnv`, immediately after the
   `runStagedRestore` await (`node-entry.ts:371-377`):

```ts
    // AFTER `ensureInstance` has migrated a legitimately BEHIND database forward, and BEFORE the
    // server opens a pool: only the ahead direction is unrecoverable, and naming it here is the
    // whole point — drizzle applies and reports nothing for an ahead journal, so the mismatch would
    // otherwise surface as an unclassified driver error in whatever query first touched the changed
    // schema (spec §4.2, proven in `schema-ahead.pg.test.ts`).
    await (deps.assertNotAhead ?? (() => Promise.resolve()))(urls.migrationsDatabaseUrl);
```

5. In `bootThisProcess`, add the two real bindings inside the `runEntry({ … })` object, after
   `runStagedRestore,`:

```ts
    assertNotAhead: async (migrationsDatabaseUrl) => {
      const db = await createPostgresDb(migrationsDatabaseUrl);
      try {
        await assertDatabaseNotAhead(db, manifestSets(), migrationsRoot);
      } finally {
        await db.close();
      }
    },
    reportFailure: (text) => void process.stdout.write(`${text}\n`),
```

   The `migrationsRoot` it names is the expression already inlined in the `runEntry` call — extract
   it to a local above that call so the entrypoint's own check and the server it starts can never
   read two different folders:

```ts
  const migrationsRoot = isUnset(env.WAITRON_MIGRATIONS_DIR)
    ? DEFAULT_MIGRATIONS_ROOT
    : env.WAITRON_MIGRATIONS_DIR;
```

   and pass `migrationsRoot` for both the `migrationsRoot` field and the `assertNotAhead` root
   argument. This whole block sits inside the existing `/* v8 ignore start */` region.

6. Change the top-level catch's log line (`node-entry.ts:459-463`) to use the classifier, so the
   structured stream carries the same classification the page does:

```ts
  }).catch((error: unknown) => {
    // `classifyBootFailure`, never the caught value: a `pg` failure's message can embed the
    // connection string, and an unhandled rejection would print the whole stack. The scrubbed text
    // has already gone to stdout from `runEntry`'s catch; this line stays structured.
    log("error", "server.boot_failed", { errorCode: classifyBootFailure(error) });
    process.exit(1);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts
```
Expected: all PASS, including every pre-existing test — the two new deps are optional precisely so
the existing `deps()` fixture keeps compiling.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/node-entry.ts apps/server/src/node-entry.test.ts
git commit -s -m "feat(server): classify, report and refuse an unbootable database at the entrypoint"
```

---

### Task 8: The recovery page renders curated operator text

**Files:**
- Modify: `apps/server/src/recovery-surface.ts`, `apps/server/src/recovery-surface.test.ts`

**Interfaces:**
- Consumes: nothing new at runtime; the codes Task 3 and Task 5 can produce.
- Produces: nothing importable beyond the unchanged `recoveryApp`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/recovery-surface.test.ts`:

Extend the file's EXISTING `recovery-surface.js` import rather than adding a second one (eslint's
`no-duplicate-imports` rejects two imports from one module). The §5 leak probe is NOT here — it lives
in Task 7, where a boot failure can actually be injected:

```ts
import { GENERIC_TEXT, OPERATOR_TEXT, recoveryApp } from "./recovery-surface.js";

function pageFor(lastErrorCode: string | null): Promise<string> {
  const app = recoveryApp({
    state: { failures: 3, level: "recovery", lastErrorCode, lastFailureAt: new Date().toISOString() },
    logDir: "/nonexistent",
    onRetry: vi.fn(),
  });
  return app.request("/").then((res) => res.text());
}

describe("curated operator text", () => {
  it("renders the title and action for every code in the table", async () => {
    for (const [code, text] of Object.entries(OPERATOR_TEXT)) {
      const body = await pageFor(code);
      expect(body).toContain(text.title);
      expect(body).toContain(text.action);
    }
  });

  it("tells the operator of an ahead database to restore or reinstall — never to wipe", async () => {
    const body = await pageFor("provisioning.database_ahead");
    expect(body).toMatch(/restore it from a backup, or reinstall/i);
    expect(body).not.toMatch(/\bwipe\b|\berase\b|\bdelete the database\b/i);
  });

  // The CONVERSE of the test above, and the one that matters: every code the entrypoint can
  // actually persist must have an entry. Without it the table can rot into uselessness one new code
  // at a time, each falling silently to the generic line — which is what `unknown` did to the first
  // real box's operator.
  it("has an entry for every code the entrypoint can classify or throw", async () => {
    const classified = [
      "provisioning.database_unreachable",
      "provisioning.schema_mismatch",
      "unknown",
    ];
    const thrownByRunEntry = [
      "server.config_missing",
      "provisioning.admin_uri_not_a_url",
      "provisioning.database_ahead",
      "migrations.set_missing",
      "migrations.incomplete",
      "server.boot_incomplete",
    ];
    const missing = [...classified, ...thrownByRunEntry].filter(
      (code) => code !== "unknown" && !(code in OPERATOR_TEXT),
    );
    expect(missing).toEqual([]);
  });

  it("renders the generic line for a code it does not know, without throwing", async () => {
    const body = await pageFor("some.code.invented.later");
    expect(body).toContain(GENERIC_TEXT.title);
    expect(body).toContain(GENERIC_TEXT.action);
  });

  it("renders the generic line when no failure has been recorded at all", async () => {
    const body = await pageFor(null);
    expect(body).toContain(GENERIC_TEXT.title);
  });
});

```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts
```
Expected: FAIL — `OPERATOR_TEXT` and `GENERIC_TEXT` are not exported.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/recovery-surface.ts`, add `import type { ErrorCode } from "@waitron/shared";`
to the imports, then add above `renderPage`:

```ts
// `ErrorCode` is the registry's own union, so a typo here is a typecheck failure rather than a page
// that silently renders the generic line. `Partial`, because most codes in the registry never reach
// a boot failure.
export interface OperatorText {
  /** What is wrong, in the operator's terms. */
  title: string;
  /** What they should do about it. */
  action: string;
}

/**
 * What the page says, keyed by error code.
 *
 * EVERY string here is fixed and chosen by code. This page is served over the venue's LAN with no
 * login, so nothing the box caught — no message, no stack, no params — may reach it (spec §5); the
 * only values interpolated from outside the image are the error CODE and the log TAIL, both escaped
 * and both treated as attacker-influenceable. The real error goes to the container's stdout,
 * scrubbed, which is the installer's channel.
 *
 * The wording never suggests wiping or resetting anything: a real venue's database holds fiscal
 * records that cannot be re-created, so the action is always restore or reinstall (owner decision,
 * 2026-09-10).
 */
export const OPERATOR_TEXT: Readonly<Partial<Record<ErrorCode, OperatorText>>> = {
  "provisioning.database_ahead": {
    title: "This box's database was set up by a different version of Waitron than the one installed.",
    action: "Restore it from a backup, or reinstall.",
  },
  "provisioning.schema_mismatch": {
    title: "The box's database does not match the installed software.",
    action: "Restore it from a backup, or reinstall.",
  },
  "provisioning.database_unreachable": {
    title: "The box's database is not responding.",
    action: "Wait a minute and press Retry. If it keeps failing, restart the box.",
  },
  "provisioning.database_not_owned": {
    title: "The box's database belongs to another program.",
    action: "Restore it from a backup, or reinstall.",
  },
  "provisioning.admin_uri_not_a_url": {
    title: "The box's database address is not a valid address.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "migrations.incomplete": {
    title: "The box's database was only partly updated.",
    action: "Restore it from a backup, or reinstall.",
  },
  "server.config_missing": {
    title: "The box's configuration is incomplete.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "server.config_invalid": {
    title: "The box's configuration is invalid.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "server.boot_incomplete": {
    title: "Waitron did not finish starting.",
    action: "Press Retry. If it keeps failing, ask whoever installed this box to look at it.",
  },
  "migrations.set_missing": {
    title: "The installed software is incomplete.",
    action: "Reinstall Waitron on this box.",
  },
};

/**
 * The fallback, and what `unknown` now means: the classifier could not name this one, but
 * `runEntry` wrote the real reason to the container's stdout, so the sentence below is true rather
 * than a shrug. An unrecognised code renders this and never throws — a box that failed before it
 * ever wrote a log still has to serve this page.
 */
export const GENERIC_TEXT: OperatorText = {
  title: "Waitron could not start.",
  action: "Whoever installed this box can read the reason from it.",
};

function operatorText(lastErrorCode: string | null): OperatorText {
  if (lastErrorCode === null) return GENERIC_TEXT;
  return OPERATOR_TEXT[lastErrorCode] ?? GENERIC_TEXT;
}
```

Then change `renderPage` to render it. Replace the `<h1>` and the two `<p>` lines with:

```ts
function renderPage(state: RecoveryState, logLines: string[]): string {
  const errorCode = state.lastErrorCode === null ? "none" : escapeHtml(state.lastErrorCode);
  const failureAt = state.lastFailureAt === null ? "never" : escapeHtml(state.lastFailureAt);
  const text = operatorText(state.lastErrorCode);
  const tail =
    logLines.length === 0 ? "(no log yet)" : logLines.map((line) => escapeHtml(line)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waitron did not start</title>
</head>
<body>
<h1>Waitron did not start</h1>
<p>${escapeHtml(text.title)}</p>
<p>${escapeHtml(text.action)}</p>
<form method="post" action="/recovery-api/retry">
<button type="submit">Retry a normal boot</button>
</form>
<h2>For whoever installed this box</h2>
<p>Level: ${escapeHtml(state.level)}. Failed ${state.failures} times.</p>
<p>Last error: ${errorCode} at ${failureAt}</p>
<h2>Log tail</h2>
<pre>${tail}</pre>
</body>
</html>
`;
}
```

`escapeHtml` is applied to the curated strings too. They are fixed and safe, but routing every
interpolation through the one escape keeps the rule "never a raw template literal" true without an
exception a reader has to check.

The retry form moves ABOVE the installer detail: the operator's action is the point of the page, and
the diagnostic block below it is for someone else.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts
```
Expected: all PASS, including the pre-existing escaping and JSON tests — `/recovery-api/status`
still returns exactly the four `RecoveryState` fields and no curated text.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts
git commit -s -m "feat(server): render curated operator text on the recovery page"
```

---

### Task 9: `try-branch.sh` warns where it can bite

**Files:**
- Modify: `deploy/try-branch.sh`, `deploy/README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the warning to the script**

In `deploy/try-branch.sh`, immediately after the `TAG=` assignment and before the `docker build`
line, insert:

```bash
# It cannot tell whether this ref carries a migration — the branch's files are not on the box until
# the build fetches them — so it warns every time. A migration-carrying branch migrates the box's
# live database ONE WAY: there is no backward migration, and a plain `docker compose up -d` back to
# :main afterwards may then fail to boot with `provisioning.database_ahead`, whose only fix is a
# restore from backup or a reinstall. A demo box's data is disposable; a real venue's is not.
cat >&2 <<'WARNING'
try-branch.sh: this migrates the box's live database ONE WAY.

  If this branch carries a database migration, running it changes the box's database in a way
  that going back to the published image cannot undo. The box may then refuse to boot, and the
  only fix is restoring from a backup or reinstalling.

  Safe on a demo box. On a box holding a real venue's records, take a backup first.

WARNING
```

Keep it unconditional and on stderr, so a piped `curl … | sudo bash` still shows it.

- [ ] **Step 2: Add the same fact to the README**

In `deploy/README.md`, in the "Trying a branch before it merges" section, add after the paragraph
that begins "It tags the image after the ref":

```markdown
**It migrates the box's database one way.** If the branch carries a database migration, running it
changes the box's database, and there is no backward migration — a plain `docker compose up -d` back
to `:main` afterwards can fail to boot with `provisioning.database_ahead`, whose only fix is
restoring from a backup or reinstalling. The script cannot tell whether a given ref carries one (the
branch's files are not on the box until the build fetches them), so it warns every time. Safe on a
demo box; take a backup first on a box holding a real venue's records.
```

- [ ] **Step 3: Verify the script still parses and the docs still format**

```bash
bash -n deploy/try-branch.sh
pnpm format:check
pnpm vitest run scripts/deploy-image-env.test.ts
```
Expected: all clean. (`deploy-image-env.test.ts` is the root guard that reads `deploy/`; run it so a
change to the script is checked by whatever it pins.)

- [ ] **Step 4: Commit**

```bash
git add deploy/try-branch.sh deploy/README.md
git commit -s -m "docs(deploy): warn that try-branch migrates the box's database one way"
```

---

### Task 10: Record what the experiment settled

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md`, `docs/backlog.md`

**Interfaces:** none.

- [ ] **Step 1: Add the addendum to the spec**

Append to the spec, as a new final section. The spec's §8 says the artefact "was not confirmed"; a
behaviour change retires every receipt about the old behaviour, and leaving that sentence unqualified
would send the next reader looking for an open question that is closed.

```markdown
## 9. Addendum — what the §6 experiment settled (2026-09-10)

Run against PostgreSQL 18 (the box's own version, `deploy/compose.yml`) before the plan was written.
§8's open question is closed. Two of the four findings changed the work.

- **The bricking was NOT an ahead database.** `packages/db/drizzle/0013` adds the enum label
  `bluetooth` to `print_transport` and `0014` names it in a `CHECK` constraint. Drizzle applies a
  set's pending migrations in ONE transaction, and PostgreSQL refuses to use a label added in that
  transaction unless the type was created there too: `55P04, unsafe use of new value`. A virgin
  database creates the type in the same batch, so CI passed; an existing box aborted and applied
  nothing — which is exactly why `printers` still carried `:main`'s columns. Fixed on its own branch,
  `fix/core-migration-upgrade`, because it blocked every box upgrade.
- **A second defect sat underneath it, silent.** `packages/db/drizzle/meta/_journal.json` is
  non-monotonic — entries 2–6 carry `when` values below entry 1's — and drizzle applies a migration
  only when `max(created_at) < its when`, so those entries are SKIPPED with no error. Measured, with
  the enum defect fixed so it could be seen: a database at entry 1 upgrades with 10 of 15 migrations
  applied and raises nothing. It cannot be repaired by editing the journal, and that was measured,
  not assumed: raising the out-of-order entries makes release points 3–7 re-apply a migration they
  already ran and fail; lowering the earlier ones changes nothing, because a database recorded the
  old value rather than the file's. The remedy is therefore to make the skip LOUD —
  `migrations.incomplete`, thrown by `applyMigrations` — which is this spec's own subject: a wrong
  state that says nothing.
- **§4.2's ahead check stands, and its mechanism is confirmed — but §6's sketch of the
  proof-by-deletion was wrong.** With a journal watermark ahead of every shipped migration's `when`,
  drizzle applies nothing and throws nothing, so a boot with the check REMOVED proceeds *cleanly*
  rather than falling through to a raw pg error. The mismatch bites later, in whatever query first
  touches a schema that is not there. That makes this check the only thing that names the case — a
  stronger claim than §6 made, and pinned by `schema-ahead.pg.test.ts`'s third test. `created_at` is
  a `bigint` and reaches JavaScript as a STRING, which is a second reason the check compares hashes.
- **§4.1's schema-mismatch table gained `55P04`**, written from the experiment as §6 requires.

- [ ] **Step 2: Update the backlog**

In `docs/backlog.md`, Track P:

1. Change `**boot-failure diagnosability — spec WRITTEN 2026-09-10, plan + implementation next**` to
   `**boot-failure diagnosability — plan WRITTEN, in flight**`. Do NOT write "LANDED" — `/land-branch`
   owns that transition, and a branch that claims to have landed itself is wrong until it merges.
2. Retire the stale claim in the same paragraph. It currently reads that the 2026-09-10 bricking's
   "exact schema artefact was never confirmed because the box was reset". The experiment confirmed
   it, so that sentence is a receipt for behaviour that no longer holds (CLAUDE.md §1). Replace it
   with one sentence naming the enum-in-one-transaction cause and pointing at
   `fix/core-migration-upgrade`.

- [ ] **Step 3: Verify formatting**

```bash
pnpm format:check
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md docs/backlog.md
git commit -s -m "docs: record what the boot-failure experiment settled"
```

---

## The one decision spec §6 leaves to this plan

**The container smoke (`deploy/`, CI's `image / smoke`) is unchanged.** It boots a real image on
blank volumes, and an ahead database is by definition not a blank volume — reproducing one there
would mean migrating the container's database with a second, synthetic image inside the smoke job,
which is a second image build on the critical path of every push for a case the real-Postgres suite
already runs directly against the code (`schema-ahead.pg.test.ts`, with its control and its
proof-by-deletion). The smoke's job is "the built image starts"; keep it that.

What the smoke does gain, for free, is the curated page: a box that fails to boot in the smoke now
serves operator text instead of `unknown`, and the existing smoke assertions do not read the page
body, so nothing there needs changing. If a later change makes the smoke assert on the page, assert
on `GENERIC_TEXT.title`, never on a code.

---

## Final gate before the PR

Run from the worktree root. The scoped commands first, the whole workspace last.

```bash
pnpm lint && pnpm typecheck && pnpm format:check
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm vitest run scripts/
```

Then the whole workspace, because this branch changes a migration file and a value more than one
package asserts:

```bash
memory_pressure | grep free          # scale concurrency to measured headroom, never a count
TESTCONTAINERS_RYUK_DISABLED=true pnpm test
pnpm reap
```

Then `/finish-branch`.

**A note on shard load.** `@waitron/migrations` and `@waitron/provisioning` are both in
`LIGHT_A_PACKAGES` (`scripts/changed-scope.mjs`), and this branch adds two container-booting suites
to that bin. CLAUDE.md §4 records four `test-light-a` hangs that took about six hours each. Watch
that shard's duration on the first CI run and say what it was; if it climbs, the fix is to give one
of these suites its own shard, never a retry.

**Risk triggers this diff touches** (so the FULL review ceremony applies, not the light path):
a migration, a cross-package contract (`@waitron/migrations` and `@waitron/provisioning` barrels),
and a security boundary (the unauthenticated recovery page). Keep the per-task reviews, the simplify
lenses, the fresh-context plan-vs-spec read and the Codex run-it seat.
