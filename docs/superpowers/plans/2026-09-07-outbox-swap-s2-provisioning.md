# Outbox → native replication, S2: replication provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the native-logical-replication PROVISIONING capability — the two publications, the subscription verbs, the `waitron_repl` superuser bootstrap, the readiness check, the three instance settings, and the WireGuard-key bundle field — proven against the two-node fixture and provisioning unit tests, WITHOUT touching the live `adoptFromPrimary`/promote/return/box-status paths (they stay on the outbox until step 4).

**Architecture:** `packages/sync` gains the decoupled thin native layer (`publications.ts`, `subscriptions.ts`): pure SQL builders + creation given a ready cluster and an injected connection — no role names, so `publications.ts`/`subscriptions.ts` import only `@waitron/db` + `@waitron/shared`. `packages/provisioning` gains the role/settings vocabulary it owns: `REPLICATION_ROLE`, a superuser bootstrap SQL emitter (`replication-bootstrap.ts`), and a readiness check (`replication-readiness.ts`, `provisioning.replication_not_ready`) — the app provisioner stays superuser-free and *verifies + refuses*; the box-image/operator runs the bootstrap, and the fixture's container-superuser stands in for it. Two real-PG suites in `packages/sync` (dev-depending on `@waitron/provisioning`, which does NOT depend on sync — acyclic) prove it on real Postgres: the owner creates the publications, `waitron_repl` replicates a row A→B, a later-migrated table is covered by `ALTER DEFAULT PRIVILEGES` (§13.3), and a wrong-environment publication name yields no rows.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle (`sql.raw` for utility DDL Postgres will not bind), PostgreSQL 18 (`postgres:18-alpine`), Testcontainers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` (slice **S2** — §2.2, §2.3, §2.4, §3, §11, §13) and `docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` (§3 **step 3** = swap S2). Empirical basis: `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`.

## Global Constraints

- **Branch:** `feat/outbox-swap-s2-provisioning` in the worktree already created via `worktree.py`. Every commit `git commit -s`. No attribution lines in commit messages.
- **Scope is capability + fixture ONLY (owner decision 2026-09-07).** DO NOT modify `apps/server/src/adopt.ts`'s pull/mirror wiring, `boot.ts`, `promote`/`rejoin`/`retire`/`box-status`, or any live sync path. The outbox (`sync_log`, `enrol()`, the pull/retention workers, `assembleMirrorBundle`'s `syncToken`) keeps running unchanged until step 4. Nothing here is consumed by the live sale/adopt/promote path at runtime. The ONLY `apps/server` edit is the additive `wireguardPublicKey` bundle field (Task 5).
- **Fixture scope is provisioning-correctness ONLY (owner decision 2026-09-07).** S2's suites prove: the owner creates the two publications, `waitron_repl` can SELECT, `ALTER DEFAULT PRIVILEGES` covers a later table (§13.3), a `state` row copies A→B by the real roles, and a wrong-environment publication name copies nothing. The fiscal-fidelity + full-copy suites (a fiscal record byte-identical, a replicated UPDATE refused by `ENABLE ALWAYS`, WAL-overflow slot invalidation, publisher-ahead column-add stall, and the §11 every-table copy matrix) are DEFERRED to the signed step-4 PR (spec §12) — do NOT build them here.
- **`packages/sync`'s RUNTIME code stays decoupled from role vocabulary and from `@waitron/provisioning`.** `publications.ts`/`subscriptions.ts` import only `@waitron/db` + `@waitron/shared`, take table names / a publication/subscription name / an injected connection — never a role name. The integration suites (Tasks 6–7) add `@waitron/provisioning` as a sync **devDependency**; that direction is acyclic (provisioning's `package.json` does NOT list `@waitron/sync`). Do NOT add `@waitron/composition` as a sync dep — it lists `@waitron/sync` in its runtime `dependencies`, so a sync→composition edge would be a package cycle; the fixtures publish a small explicit list of real migrated tables instead of importing `ALL_MODULES` (the full derived-list publishability is part of the deferred §11 matrix / step 4).
- **Never build SQL by string concatenation without escaping or validating** (CLAUDE.md §3). `CREATE PUBLICATION`/`CREATE SUBSCRIPTION`/`ALTER SUBSCRIPTION`/`CREATE ROLE`/`ALTER SYSTEM` are utility statements Postgres will not bind, so: identifiers are validated (`^[a-z_][a-z0-9_]*$`) then double-quoted; string literals (the replication password, the CONNECTION conninfo) go through a hardened literal-escaper (the `E'…'` form when a backslash is present — `standard_conforming_strings` is per-session, so the plain-double-quote form is unsafe for a backslash-bearing literal); and any statement that embeds a secret (the subscription's conninfo, the bootstrap's `CREATE ROLE … PASSWORD`) is NEVER logged and its failure throws only a SQLSTATE, never the statement or its `cause` — mirror `instance-apply.ts`'s `create-role` catch exactly.
- **Error codes name the DOMAIN CONCEPT, never the throwing package, and are never renamed** (CLAUDE.md §3). This slice adds `sync.subscription_failed` and `provisioning.replication_not_ready`.
- **The owner owns the tables.** Native replication requires the role that creates the publications to OWN the published tables (prototype: `run_as_owner=false` works only because the apply/publish role is the table owner). The fixtures provision this shape (`CREATE DATABASE … OWNER waitron_migrator`, migrate as `waitron_migrator`) and assert it; the live-provisioning ownership question is flagged for step 4 (Task 8).
- **Gate before PR:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; then `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/provisioning test:coverage`, `pnpm --filter @waitron/shared test:coverage` (all HIGH bar 98/98/98/95 except shared — check its threshold and keep it green) and `pnpm --filter @waitron/server test:coverage`. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; check memory headroom (CLAUDE.md §2/§4) before the two-node suite. `packages/sync` is NOT a browser package, so no Chromium coordination is needed.

---

## The publication set (derived, but do not import composition in tests)

The two publication table-lists are derived at the composition root: `apps/server/src/modules.ts` exports `LEDGER_PUBLICATION_TABLES` / `STATE_PUBLICATION_TABLES` (from `tablesForPublication(ALL_CLASSIFICATIONS, …)`, S1). `publications.ts` accepts these lists as parameters at RUNTIME — the real caller (step 4) passes the derived lists. The S2 test suites do NOT import `ALL_MODULES` (that would create a sync→composition package cycle); they publish a small explicit list of REAL migrated tables (`sales`, `tenders` as ledger; `tenants`, `locations` as state — all created by the core baseline, all classified in S1) to prove `createPublications` produces a valid publication and the owner owns them. Publications are named `waitron_<environment>_ledger` / `waitron_<environment>_state`.

---

## Task 1: publication builders + creation (`@waitron/sync`)

**Files:**
- Create: `packages/sync/src/publications.ts`
- Create: `packages/sync/src/publications.test.ts`
- Modify: `packages/sync/src/index.ts` (export the new surface)

**Interfaces:**
- Produces:
  - `type PublicationClass = "ledger" | "state"`
  - `function publicationName(environment: "production" | "preproduction", cls: PublicationClass): string`
  - `function createPublicationStatement(environment, cls, tables: readonly string[]): string`
  - `function createPublications(db: Database, opts: { environment: "production" | "preproduction"; ledgerTables: readonly string[]; stateTables: readonly string[] }): Promise<void>`

- [ ] **Step 1: Write the failing test** — `packages/sync/src/publications.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createPublicationStatement, publicationName } from "./publications.js";

describe("publicationName", () => {
  it("carries the environment and class", () => {
    expect(publicationName("production", "ledger")).toBe("waitron_production_ledger");
    expect(publicationName("preproduction", "state")).toBe("waitron_preproduction_state");
  });
});

describe("createPublicationStatement", () => {
  it("names the publication and double-quotes every table", () => {
    expect(createPublicationStatement("production", "ledger", ["sales", "tenders"])).toBe(
      'CREATE PUBLICATION "waitron_production_ledger" FOR TABLE "sales", "tenders"',
    );
  });
  it("refuses an empty table list (a wiring bug, never a valid publication here)", () => {
    expect(() => createPublicationStatement("production", "ledger", [])).toThrow();
  });
  it("refuses a table name that is not a bare lowercase identifier", () => {
    expect(() => createPublicationStatement("production", "ledger", ['sales"; drop'])).toThrow();
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/sync test publications` → FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/sync/src/publications.ts`

```ts
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** The two publications a node holds (swap spec §2.1): `ledger` (what happened, drained back) and
 * `state` (configuration + live service, copied only). `local` tables are in neither. */
export type PublicationClass = "ledger" | "state";

// A physical table / publication name. The classification's table names are `[a-z_]+` (guard-
// enforced, S1) and publication names are derived below, so this is validate-and-throw, not an
// escaper: a name outside the set is a wiring bug, refused loudly, never quoted around.
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`unsafe replication identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** `waitron_<environment>_<ledger|state>` — the name carries the environment, half of the isolation
 * in spec §2.4 (a production subscriber naming `waitron_production_*` finds nothing on a
 * preproduction publisher; the copy simply never happens — Task 7 proves this). */
export function publicationName(
  environment: "production" | "preproduction",
  cls: PublicationClass,
): string {
  return `waitron_${environment}_${cls}`;
}

/** The `CREATE PUBLICATION … FOR TABLE …` for one class, from the derived table list. Utility DDL
 * Postgres will not bind, so every identifier is validated then double-quoted (CLAUDE.md §3). An
 * empty list is refused: `ledger` and `state` always carry tables. */
export function createPublicationStatement(
  environment: "production" | "preproduction",
  cls: PublicationClass,
  tables: readonly string[],
): string {
  if (tables.length === 0) throw new Error(`the ${cls} publication has no tables`);
  const list = tables.map(quoted).join(", ");
  return `CREATE PUBLICATION ${quoted(publicationName(environment, cls))} FOR TABLE ${list}`;
}

/** Create both of a node's publications as the OWNER connection (the migrator owns every table, so a
 * non-superuser owner can `CREATE PUBLICATION … FOR TABLE <list>`; `FOR ALL TABLES` is superuser-only
 * — prototype finding 1). The table lists come from `apps/server/src/modules.ts`'s derived
 * `LEDGER_PUBLICATION_TABLES` / `STATE_PUBLICATION_TABLES` (passed in by the step-4 caller). */
export async function createPublications(
  db: Database,
  opts: {
    environment: "production" | "preproduction";
    ledgerTables: readonly string[];
    stateTables: readonly string[];
  },
): Promise<void> {
  await db.execute(sql.raw(createPublicationStatement(opts.environment, "ledger", opts.ledgerTables)));
  await db.execute(sql.raw(createPublicationStatement(opts.environment, "state", opts.stateTables)));
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/sync/src/index.ts` (near the classification re-export):

```ts
// Native logical replication (swap S2): build and create a node's two publications from the derived
// table lists. Utility DDL, created by the non-superuser table OWNER; not wired into the live adopt
// path until step 4.
export { createPublications, createPublicationStatement, publicationName } from "./publications.js";
export type { PublicationClass } from "./publications.js";
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @waitron/sync test publications` → PASS; `pnpm --filter @waitron/sync typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(sync): publication builders + creation (swap S2)"`

---

## Task 2: move `sqlStateOf` to `@waitron/shared`, subscription verbs, `sync.subscription_failed` (`@waitron/sync`)

Two things S2 needs share one root: a `sqlStateOf` walker (to withhold a secret-bearing statement from a thrown error) that already exists in `packages/provisioning/src/sql-state.ts` — whose own header states its safety argument "must not be maintained in two copies". So move the implementation to `@waitron/shared` (both packages already depend on it at runtime), leave a one-line re-export in provisioning so its callers are untouched, and import it in sync.

**Files:**
- Create: `packages/shared/src/sql-state.ts`
- Create: `packages/shared/src/sql-state.test.ts`
- Modify: `packages/shared/src/index.ts` (export `sqlStateOf`)
- Modify: `packages/provisioning/src/sql-state.ts` (make it a one-line re-export from `@waitron/shared`, keeping the detailed rationale as a pointer)
- Create: `packages/sync/src/subscriptions.ts`
- Create: `packages/sync/src/subscriptions.test.ts`
- Modify: `packages/sync/src/errors.ts` (add `sync.subscription_failed`)
- Modify: `packages/sync/src/index.ts` (export the new surface)

**Interfaces:**
- Produces (shared): `function sqlStateOf(error: unknown): string | null`
- Produces (sync):
  - `interface ReplicationConnection { host: string; port: number; database: string; user: string; password: string }`
  - `function buildConninfo(c: ReplicationConnection): string` (libpq keyword/value; carries the password)
  - `function createSubscriptionStatement(opts): string`, `function createSubscription(db, opts): Promise<void>`
  - `function enableSubscriptionStatement(name): string` / `disableSubscriptionStatement` / `dropSubscriptionStatement` / `setSubscriptionPublicationsStatement(name, pubs)` / `skipSubscriptionStatement(name, lsn)` — pure builders
  - `function enableSubscription(db, name): Promise<void>` / `disableSubscription` / `dropSubscription` / `setSubscriptionPublications(db, name, pubs)` / `skipSubscription(db, name, lsn)`

- [ ] **Step 1: Move `sqlStateOf` to shared.** Read `packages/provisioning/src/sql-state.ts` first. Create `packages/shared/src/sql-state.ts` with the same behaviour (walk the `cause` chain up to a small depth, return the first `[0-9A-Z]{5}` `code`, else `null`), carrying the original's rationale comment. Write `packages/shared/src/sql-state.test.ts` covering ALL branches: (a) code at depth 0; (b) code nested under `.cause`; (c) no SQLSTATE anywhere → `null`; (d) a non-SQLSTATE `code` (e.g. `"ENOENT"`) → `null`. Export from `packages/shared/src/index.ts`. Then replace `packages/provisioning/src/sql-state.ts`'s body with `export { sqlStateOf } from "@waitron/shared";` plus a one-line comment pointing at the shared home (keep the file so `instance-apply.ts`/`cli.ts` imports of `./sql-state.js` are unchanged). Run `pnpm --filter @waitron/shared test` and `pnpm --filter @waitron/provisioning test` → both PASS (behaviour-preserving move).

- [ ] **Step 2: Write the failing subscription test** — `packages/sync/src/subscriptions.test.ts`. Every exported function is exercised (sync's 98% functions bar), and the secret-safety assertions are the point. A fake `db` records the raw SQL so the verbs are covered without a container.

```ts
import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  buildConninfo,
  createSubscription,
  createSubscriptionStatement,
  disableSubscription,
  dropSubscription,
  enableSubscription,
  setSubscriptionPublications,
  skipSubscription,
} from "./subscriptions.js";

const CONN = { host: "node-a", port: 5432, database: "waitron", user: "waitron_repl", password: "p'a\\ss" };
function fakeDb() {
  const calls: string[] = [];
  const db = { execute: vi.fn(async (q: { sql?: string }) => { calls.push(String(q?.sql ?? q)); }) };
  return { db: db as never, calls, execute: db.execute };
}

describe("buildConninfo", () => {
  it("single-quotes and backslash-escapes each value (libpq)", () => {
    expect(buildConninfo(CONN)).toBe(
      "host='node-a' port='5432' dbname='waitron' user='waitron_repl' password='p\\'a\\\\ss'",
    );
  });
});

describe("createSubscriptionStatement", () => {
  it("names it, escapes the conninfo (E-string for the backslash), sets origin=none", () => {
    const stmt = createSubscriptionStatement({
      name: "waitron_sub_a",
      conninfo: "host='h' password='a\\b'",
      publications: ["waitron_production_ledger", "waitron_production_state"],
      copyData: true,
      enabled: true,
    });
    // The conninfo carries a backslash, so the outer literal is E'…' with doubled backslashes and
    // doubled single quotes.
    expect(stmt).toContain("CONNECTION E'host=''h'' password=''a\\\\b'''");
    expect(stmt).toContain('PUBLICATION "waitron_production_ledger", "waitron_production_state"');
    expect(stmt).toContain("origin = none");
    expect(stmt).toContain("copy_data = true");
    expect(stmt).toContain("enabled = true");
  });
});

describe("the maintenance verbs run the right ALTER/DROP", () => {
  it("enable/disable/drop/setPublications/skip", async () => {
    const { db, calls } = fakeDb();
    await enableSubscription(db, "waitron_sub_a");
    await disableSubscription(db, "waitron_sub_a");
    await dropSubscription(db, "waitron_sub_a");
    await setSubscriptionPublications(db, "waitron_sub_a", ["waitron_production_ledger"]);
    await skipSubscription(db, "waitron_sub_a", "0/328F738");
    expect(calls[0]).toBe('ALTER SUBSCRIPTION "waitron_sub_a" ENABLE');
    expect(calls[1]).toBe('ALTER SUBSCRIPTION "waitron_sub_a" DISABLE');
    expect(calls[2]).toBe('DROP SUBSCRIPTION IF EXISTS "waitron_sub_a"');
    expect(calls[3]).toBe('ALTER SUBSCRIPTION "waitron_sub_a" SET PUBLICATION "waitron_production_ledger"');
    expect(calls[4]).toBe("ALTER SUBSCRIPTION \"waitron_sub_a\" SKIP (lsn = '0/328F738')");
  });
  it("refuses a bad subscription name and a bad LSN", async () => {
    const { db } = fakeDb();
    await expect(enableSubscription(db, 'bad"; drop')).rejects.toThrow();
    await expect(skipSubscription(db, "waitron_sub_a", "not-an-lsn")).rejects.toThrow();
  });
});

describe("createSubscription failure", () => {
  it("throws sync.subscription_failed with only a SQLSTATE — never the conninfo/password", async () => {
    const password = "unmistakable-password-marker";
    const cause = Object.assign(new Error("boom"), { code: "42710" });
    const db = { execute: async () => { throw cause; } } as never;
    let thrown: unknown;
    try {
      await createSubscription(db, {
        name: "waitron_sub_a",
        conninfo: buildConninfo({ ...CONN, password }),
        publications: ["waitron_production_ledger"],
        copyData: true,
        enabled: true,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("sync.subscription_failed");
    expect(thrown.params).toEqual({ sqlState: "42710" });
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(password);
    expect((thrown as Error).cause).toBeUndefined();
  });
});
```

- [ ] **Step 3: Add the error code** — in `packages/sync/src/errors.ts`, add to `ErrorParams` (follow the file's header rule — no param carries row content or a secret):

```ts
    /** `CREATE SUBSCRIPTION` failed. `sqlState` ONLY — never the statement or its `cause`: the
     * statement embeds the CONNECTION conninfo, which carries the `waitron_repl` password, and both
     * Drizzle's wrapper and Postgres's own message quote it back verbatim (the discipline
     * `provisioning.role_creation_failed` keeps for `CREATE ROLE`). Five `[0-9A-Z]` cannot be the
     * password. */
    "sync.subscription_failed": { sqlState: string | null };
```

- [ ] **Step 4: Implement** — `packages/sync/src/subscriptions.ts`

```ts
import { sql } from "drizzle-orm";
import { AppError, sqlStateOf } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`unsafe replication identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** A SQL string literal for the CONNECTION conninfo (which carries the password — the result is
 * secret, never logged). Mirrors `packages/provisioning/src/identifiers.ts`'s `quoteLiteral`: when a
 * backslash is present it emits the `E'…'` form with doubled backslashes, because
 * `standard_conforming_strings` is per-session and the plain form would corrupt a backslash-bearing
 * literal. Single quotes are always doubled. */
function sqlLiteral(value: string): string {
  const doubledQuotes = value.replace(/'/g, "''");
  if (value.includes("\\")) return `E'${doubledQuotes.replace(/\\/g, "\\\\")}'`;
  return `'${doubledQuotes}'`;
}

/** The replication login and the peer to reach it. Secret in whole. */
export interface ReplicationConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// libpq keyword/value: each value single-quoted, `\` and `'` backslash-escaped INSIDE the libpq
// quotes. The outer SQL-literal escaping is applied separately by `sqlLiteral` at CREATE time.
function libpqValue(value: string): string {
  return `'${value.replace(/([\\'])/g, "\\$1")}'`;
}

/** The libpq conninfo for a subscription's CONNECTION. Carries the password — never log it. */
export function buildConninfo(c: ReplicationConnection): string {
  return [
    `host=${libpqValue(c.host)}`,
    `port=${libpqValue(String(c.port))}`,
    `dbname=${libpqValue(c.database)}`,
    `user=${libpqValue(c.user)}`,
    `password=${libpqValue(c.password)}`,
  ].join(" ");
}

/** `CREATE SUBSCRIPTION` for one peer direction. `origin = none` is the whole echo defence
 * (prototype (a)/finding 3). The standby's is created enabled naming both publications; the
 * primary's is created disabled and re-enabled only for the drain window (spec §2.2) — the caller
 * chooses. The returned string embeds the conninfo literal and is SECRET; do not log it. */
export function createSubscriptionStatement(opts: {
  name: string;
  conninfo: string;
  publications: readonly string[];
  copyData: boolean;
  enabled: boolean;
}): string {
  const pubs = opts.publications.map(quoted).join(", ");
  return (
    `CREATE SUBSCRIPTION ${quoted(opts.name)} CONNECTION ${sqlLiteral(opts.conninfo)} ` +
    `PUBLICATION ${pubs} ` +
    `WITH (copy_data = ${opts.copyData ? "true" : "false"}, origin = none, enabled = ${opts.enabled ? "true" : "false"})`
  );
}

export async function createSubscription(
  db: Database,
  opts: { name: string; conninfo: string; publications: readonly string[]; copyData: boolean; enabled: boolean },
): Promise<void> {
  try {
    await db.execute(sql.raw(createSubscriptionStatement(opts)));
  } catch (error) {
    // Only the SQLSTATE. The statement carries the conninfo password; the raw error (and its
    // `cause`) quotes it back — mirror `instance-apply.ts`'s `create-role` catch.
    throw new AppError("sync.subscription_failed", { sqlState: sqlStateOf(error) });
  }
}

// The maintenance verbs embed NO secret (only the subscription name / publication names / an LSN), so
// each is a pure statement builder (unit-testable string) plus a thin exec.
export function enableSubscriptionStatement(name: string): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} ENABLE`;
}
export function disableSubscriptionStatement(name: string): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} DISABLE`;
}
export function dropSubscriptionStatement(name: string): string {
  return `DROP SUBSCRIPTION IF EXISTS ${quoted(name)}`;
}
export function setSubscriptionPublicationsStatement(name: string, publications: readonly string[]): string {
  return `ALTER SUBSCRIPTION ${quoted(name)} SET PUBLICATION ${publications.map(quoted).join(", ")}`;
}
export function skipSubscriptionStatement(name: string, lsn: string): string {
  if (!/^[0-9A-F]+\/[0-9A-F]+$/i.test(lsn)) throw new Error(`not an LSN: ${JSON.stringify(lsn)}`);
  return `ALTER SUBSCRIPTION ${quoted(name)} SKIP (lsn = '${lsn}')`;
}
export async function enableSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(enableSubscriptionStatement(name)));
}
export async function disableSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(disableSubscriptionStatement(name)));
}
export async function dropSubscription(db: Database, name: string): Promise<void> {
  await db.execute(sql.raw(dropSubscriptionStatement(name)));
}
/** Narrow (or widen) which publications a subscription names — the drain-window
 * `SET PUBLICATION waitron_<env>_ledger` in spec §4.2, built here and called in step 4. */
export async function setSubscriptionPublications(db: Database, name: string, publications: readonly string[]): Promise<void> {
  await db.execute(sql.raw(setSubscriptionPublicationsStatement(name, publications)));
}
/** The operator SKIP over a refused transaction (spec §6). `lsn` is validated to the LSN shape. */
export async function skipSubscription(db: Database, name: string, lsn: string): Promise<void> {
  await db.execute(sql.raw(skipSubscriptionStatement(name, lsn)));
}
```

Note on the fake-`db` test: `sql.raw(x)` produces a Drizzle SQL object; assert against the string you build, or (simpler) unit-test the `*Statement` builders directly and drive the exec wrappers through the fake `db`, asserting `execute` was called once each. Adjust the `fakeDb` capture to however `sql.raw`'s object exposes its text in this Drizzle version — if awkward, assert on `execute` call COUNT + test the pure builders for the exact strings. The point is every exported function runs and every throw branch is hit.

- [ ] **Step 5: Export from the barrel** — add to `packages/sync/src/index.ts`:

```ts
// Native logical replication (swap S2): subscription verbs — create (origin=none, per-direction
// enable/copy_data, spec §2.2), enable/disable, narrow (SET PUBLICATION, the drain window §4.2),
// SKIP (§6), drop; pure statement builders beside each. The conninfo carries the waitron_repl
// password; a create failure throws only a SQLSTATE. Not wired into the live adopt path until step 4.
export {
  buildConninfo,
  createSubscription,
  createSubscriptionStatement,
  disableSubscription,
  disableSubscriptionStatement,
  dropSubscription,
  dropSubscriptionStatement,
  enableSubscription,
  enableSubscriptionStatement,
  setSubscriptionPublications,
  setSubscriptionPublicationsStatement,
  skipSubscription,
  skipSubscriptionStatement,
} from "./subscriptions.js";
export type { ReplicationConnection } from "./subscriptions.js";
```

- [ ] **Step 6: Run + typecheck + reachability** — `pnpm --filter @waitron/sync test subscriptions` → PASS; `pnpm --filter @waitron/sync typecheck`; run the whole sync suite once so the errors-reachability guard sees `sync.subscription_failed` reachable from the barrel. Confirm `sqlStateOf` is exported from `@waitron/shared`'s barrel (the sync import resolves).

- [ ] **Step 7: Commit** — `git commit -s -m "refactor(shared): home sqlStateOf; feat(sync): subscription verbs + sync.subscription_failed (swap S2)"`

---

## Task 3: `REPLICATION_ROLE` + the superuser bootstrap emitter (`@waitron/provisioning`)

**Files:**
- Create: `packages/provisioning/src/replication-bootstrap.ts`
- Create: `packages/provisioning/src/replication-bootstrap.test.ts`
- Modify: `packages/provisioning/src/index.ts` (export the new surface)

**Interfaces:**
- Consumes: `quoteIdent`, `quoteLiteral` from `./identifiers.js`; `INSTANCE_ROLES` from `./instance-state.js`.
- Produces: `const REPLICATION_ROLE = "waitron_repl"`; `function replicationBootstrapStatements(password: string): string[]`.

The emitter takes exactly the one input a caller varies — the password. The role names (`waitron_repl`, the migrator) and `max_slot_wal_keep_size = '4GB'` (spec §6) are fixed for the deployment; no override params (YAGNI — S2 has no caller that varies them, and unused optional branches would be uncovered against the 95% branch bar).

- [ ] **Step 1: Write the failing test** — `packages/provisioning/src/replication-bootstrap.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { REPLICATION_ROLE, replicationBootstrapStatements } from "./replication-bootstrap.js";

describe("replicationBootstrapStatements", () => {
  const stmts = replicationBootstrapStatements("s3cr'et");
  it("creates the replication login with REPLICATION and an escaped password literal", () => {
    expect(stmts[0]).toBe(`create role "waitron_repl" login replication password 's3cr''et'`);
  });
  it("grants pg_create_subscription to the migrator", () => {
    expect(stmts).toContain(`grant pg_create_subscription to "waitron_migrator"`);
  });
  it("grants SELECT now and by default for the migrator's future tables (§13.3)", () => {
    expect(stmts).toContain(`grant select on all tables in schema public to "waitron_repl"`);
    expect(stmts).toContain(
      `alter default privileges for role "waitron_migrator" in schema public grant select on tables to "waitron_repl"`,
    );
  });
  it("bounds the WAL retained for a dead standby and reloads (spec §6)", () => {
    expect(stmts).toContain(`alter system set max_slot_wal_keep_size = '4GB'`);
    expect(stmts).toContain(`select pg_reload_conf()`);
  });
  it("exports the replication role name for the readiness check to verify", () => {
    expect(REPLICATION_ROLE).toBe("waitron_repl");
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement** — `packages/provisioning/src/replication-bootstrap.ts`

```ts
import { quoteIdent, quoteLiteral } from "./identifiers.js";
import { INSTANCE_ROLES } from "./instance-state.js";

/** The replication LOGIN role. Distinct from `INSTANCE_ROLES` deliberately: those drive the app
 * provisioner's `create-role` plan, and `waitron_repl` cannot be created there — a `CREATEROLE`
 * non-superuser cannot create a `REPLICATION` role (`permission denied to create role`, prototype
 * finding 7). Created by the SUPERUSER bootstrap below; the app provisioner only verifies it. */
export const REPLICATION_ROLE = "waitron_repl";

/** The one superuser step native replication needs, as SQL for the box image / operator to run once
 * (the fixture's container-superuser stands in). It creates the replication login, grants the
 * migrator (`INSTANCE_ROLES[0]`, `waitron_migrator`) `pg_create_subscription`, gives `waitron_repl`
 * SELECT on today's tables AND on the migrator's future ones (`ALTER DEFAULT PRIVILEGES` — spec
 * §13.3), and bounds the WAL a dead standby retains (spec §6). It does NOT set `wal_level = logical`
 * or `track_commit_timestamp = on`: both are `PGC_POSTMASTER` (a RESTART), so they live in the box
 * image's `postgresql.conf`; the readiness check verifies all three regardless of who set them.
 *
 * Statement 0 embeds the replication PASSWORD. The whole array is SECRET: run it over a superuser
 * connection, never log it — as `instance-apply.ts` treats `CREATE ROLE`. */
export function replicationBootstrapStatements(password: string): string[] {
  const repl = quoteIdent(REPLICATION_ROLE);
  const migrator = quoteIdent(INSTANCE_ROLES[0]);
  return [
    `create role ${repl} login replication password ${quoteLiteral(password)}`,
    `grant pg_create_subscription to ${migrator}`,
    `grant select on all tables in schema public to ${repl}`,
    `alter default privileges for role ${migrator} in schema public grant select on tables to ${repl}`,
    `alter system set max_slot_wal_keep_size = ${quoteLiteral("4GB")}`,
    `select pg_reload_conf()`,
  ];
}
```

- [ ] **Step 4: Export** — add to `packages/provisioning/src/index.ts`: `export { REPLICATION_ROLE, replicationBootstrapStatements } from "./replication-bootstrap.js";`

- [ ] **Step 5: Run + typecheck** — `pnpm --filter @waitron/provisioning test replication-bootstrap` → PASS; `pnpm --filter @waitron/provisioning typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(provisioning): waitron_repl bootstrap emitter (swap S2)"`

---

## Task 4: readiness check + `provisioning.replication_not_ready` (`@waitron/provisioning`)

Fully unit-covered with a fake `db` — no container here (the real SQL is validated end-to-end in Task 6 against a live logical node). This keeps provisioning's own coverage self-contained and avoids the "which role is the superuser" container trap.

**Files:**
- Create: `packages/provisioning/src/replication-readiness.ts`
- Create: `packages/provisioning/src/replication-readiness.test.ts`
- Modify: `packages/provisioning/src/errors.ts` (add `provisioning.replication_not_ready`)
- Modify: `packages/provisioning/src/index.ts` (export the new surface)

**Interfaces:**
- Produces:
  - `interface ReplicationReadiness { walLevel: string; trackCommitTimestamp: boolean; maxSlotWalKeepSizeBounded: boolean; replicationRolePresent: boolean; migratorCanCreateSubscription: boolean }`
  - `function replicationReadinessGaps(r: ReplicationReadiness): string[]`
  - `function readReplicationReadiness(db: Database): Promise<ReplicationReadiness>`
  - `function assertReplicationReady(db: Database): Promise<void>`

- [ ] **Step 1: Write the failing test** — `packages/provisioning/src/replication-readiness.test.ts`. Covers the pure gaps (both branch sides of each), the read mapping (fake `db`), and both `assertReplicationReady` branches (resolve + throw).

```ts
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertReplicationReady,
  readReplicationReadiness,
  replicationReadinessGaps,
  type ReplicationReadiness,
} from "./replication-readiness.js";

const READY: ReplicationReadiness = {
  walLevel: "logical",
  trackCommitTimestamp: true,
  maxSlotWalKeepSizeBounded: true,
  replicationRolePresent: true,
  migratorCanCreateSubscription: true,
};
const READY_ROW = {
  wal_level: "logical", track: "on", slot_bounded: true, repl_present: true, migrator_can_subscribe: true,
};
function fakeDb(row: Record<string, unknown>) {
  return { execute: async () => ({ rows: [row] }) } as never;
}

describe("replicationReadinessGaps", () => {
  it("reports no gaps when everything is in place", () => {
    expect(replicationReadinessGaps(READY)).toEqual([]);
  });
  it("names each missing precondition (labels only)", () => {
    expect(replicationReadinessGaps({ ...READY, walLevel: "replica" })).toContain("wal_level is not logical");
    expect(replicationReadinessGaps({ ...READY, trackCommitTimestamp: false })).toContain("track_commit_timestamp is off");
    expect(replicationReadinessGaps({ ...READY, maxSlotWalKeepSizeBounded: false })).toContain("max_slot_wal_keep_size is unbounded");
    expect(replicationReadinessGaps({ ...READY, replicationRolePresent: false })).toContain("replication role missing");
    expect(replicationReadinessGaps({ ...READY, migratorCanCreateSubscription: false })).toContain("migrator lacks pg_create_subscription");
  });
});

describe("readReplicationReadiness maps the row", () => {
  it("reads the five facts", async () => {
    expect(await readReplicationReadiness(fakeDb(READY_ROW))).toEqual(READY);
    expect(await readReplicationReadiness(fakeDb({ ...READY_ROW, track: "off", slot_bounded: false }))).toMatchObject({
      trackCommitTimestamp: false, maxSlotWalKeepSizeBounded: false,
    });
  });
});

describe("assertReplicationReady", () => {
  it("resolves when ready", async () => {
    await expect(assertReplicationReady(fakeDb(READY_ROW))).resolves.toBeUndefined();
  });
  it("throws provisioning.replication_not_ready listing the gaps", async () => {
    let thrown: unknown;
    try {
      await assertReplicationReady(fakeDb({ ...READY_ROW, wal_level: "replica", repl_present: false }));
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.replication_not_ready");
    expect(thrown.params.missing).toContain("wal_level is not logical");
    expect(thrown.params.missing).toContain("replication role missing");
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Add the error code** — in `packages/provisioning/src/errors.ts`:

```ts
    /** The instance is not set up for native logical replication. `missing` lists each unmet
     * precondition in words (`wal_level is not logical`, `replication role missing`,
     * `migrator lacks pg_create_subscription`, …) — the box image / operator runs the bootstrap
     * (`replication-bootstrap.ts`), and this refusal says what it has not yet done. `provisioning.*`
     * because it is a fact about standing a deployment up; labels only, never a secret. */
    "provisioning.replication_not_ready": { missing: string[] };
```

- [ ] **Step 4: Implement** — `packages/provisioning/src/replication-readiness.ts`

```ts
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { INSTANCE_ROLES } from "./instance-state.js";
import { REPLICATION_ROLE } from "./replication-bootstrap.js";
import "./errors.js";

/** The instance facts native replication needs (swap spec §3, prototype §Setup). `walLevel` and
 * `trackCommitTimestamp` are `PGC_POSTMASTER` (read, never set here — the box image owns them).
 * `maxSlotWalKeepSizeBounded` is `false` at the default `-1` (unlimited), the one that would fill a
 * primary's disk with a dead standby (spec §6). */
export interface ReplicationReadiness {
  walLevel: string;
  trackCommitTimestamp: boolean;
  maxSlotWalKeepSizeBounded: boolean;
  replicationRolePresent: boolean;
  migratorCanCreateSubscription: boolean;
}

/** Pure: the unmet preconditions, as operator-readable labels (no secrets). Separate from the read
 * so every branch is unit-testable. */
export function replicationReadinessGaps(r: ReplicationReadiness): string[] {
  const gaps: string[] = [];
  if (r.walLevel !== "logical") gaps.push("wal_level is not logical");
  if (!r.trackCommitTimestamp) gaps.push("track_commit_timestamp is off");
  if (!r.maxSlotWalKeepSizeBounded) gaps.push("max_slot_wal_keep_size is unbounded");
  if (!r.replicationRolePresent) gaps.push("replication role missing");
  if (!r.migratorCanCreateSubscription) gaps.push("migrator lacks pg_create_subscription");
  return gaps;
}

/** Read the five facts. `pg_create_subscription` is a predefined role (PostgreSQL 16+); the default
 * `max_slot_wal_keep_size` reads back exactly `-1` (unlimited), any bound reads back non-`-1`. */
export async function readReplicationReadiness(db: Database): Promise<ReplicationReadiness> {
  const rows = await db.execute<{
    wal_level: string; track: string; slot_bounded: boolean; repl_present: boolean; migrator_can_subscribe: boolean;
  }>(sql`
    select
      current_setting('wal_level') as wal_level,
      current_setting('track_commit_timestamp') as track,
      current_setting('max_slot_wal_keep_size') <> '-1' as slot_bounded,
      exists (select 1 from pg_roles where rolname = ${REPLICATION_ROLE} and rolcanlogin and rolreplication) as repl_present,
      exists (
        select 1 from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        join pg_roles r on r.oid = m.member
        where r.rolname = ${INSTANCE_ROLES[0]} and g.rolname = 'pg_create_subscription'
      ) as migrator_can_subscribe
  `);
  const row = rows.rows[0];
  return {
    walLevel: row?.wal_level ?? "",
    trackCommitTimestamp: row?.track === "on",
    maxSlotWalKeepSizeBounded: row?.slot_bounded === true,
    replicationRolePresent: row?.repl_present === true,
    migratorCanCreateSubscription: row?.migrator_can_subscribe === true,
  };
}

/** Refuse unless the instance is replication-ready. Called by the replication-setup path (the fixture
 * in S2; the real adopt/promote flow in step 4) BEFORE any publication/subscription — the app
 * provisioner never performs the superuser bootstrap, only verifies it. */
export async function assertReplicationReady(db: Database): Promise<void> {
  const gaps = replicationReadinessGaps(await readReplicationReadiness(db));
  if (gaps.length > 0) throw new AppError("provisioning.replication_not_ready", { missing: gaps });
}
```

- [ ] **Step 5: Export** — add to `packages/provisioning/src/index.ts`:

```ts
export { assertReplicationReady, readReplicationReadiness, replicationReadinessGaps } from "./replication-readiness.js";
export type { ReplicationReadiness } from "./replication-readiness.js";
```

- [ ] **Step 6: Run + coverage + typecheck** — `pnpm --filter @waitron/provisioning test replication-readiness` → PASS; `pnpm --filter @waitron/provisioning test:coverage` (98/98/98/95 — the fake-`db` tests cover every line/branch of readiness); once, the whole provisioning suite so the errors-reachability guard sees the new code; `pnpm --filter @waitron/provisioning typecheck`.

- [ ] **Step 7: Commit** — `git commit -s -m "feat(provisioning): replication readiness check + refusal (swap S2)"`

---

## Task 5: the WireGuard-key bundle field (`apps/server`)

**Files:**
- Modify: `apps/server/src/mirror-bundle.ts` (add the field to `MirrorBundle` + `AssembleDeps`, populate it)
- Modify: the nearest existing assemble test (grep for one covering `assembleMirrorBundle`; assert the field round-trips)

**Why minimal and additive (capability-only):** the live outbox path keeps its `syncToken`; the WireGuard key has no live consumer until S7 configures the tunnel and Track B item 2 proves it. S2 only establishes the bundle CONTRACT so those later slices need no bundle-type change. The real keypair generation + interface config are S7 — here the field is populated from an injected value and defaults to absent.

- [ ] **Step 1: Write the failing test** — add to the assemble test:

```ts
it("carries a WireGuard public key when one is provided, and omits it otherwise (swap S2)", async () => {
  const withKey = await assembleMirrorBundle({ ...deps, wireguardPublicKey: "PUBKEY==" });
  expect(withKey.wireguardPublicKey).toBe("PUBKEY==");
  expect(withKey.syncToken).not.toBe(""); // the token still travels until step 4
  const withoutKey = await assembleMirrorBundle(deps);
  expect(withoutKey.wireguardPublicKey).toBeUndefined();
});
```

(Reuse the test's existing `deps`/fakes — do NOT invent a harness.)

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement** — in `apps/server/src/mirror-bundle.ts`:
  - Add to `MirrorBundle` (below `moduleOverrides`): `wireguardPublicKey?: string;` with a doc comment (spec §2.3, "the token goes, the key comes"; additive + optional; the live path still uses `syncToken`, removed step 4; no consumer until S7 / Track B item 2).
  - Add `wireguardPublicKey?: string;` to `AssembleDeps` (the box image supplies it in S7; absent in dev/fixture).
  - In the returned object add `wireguardPublicKey: deps.wireguardPublicKey,` (absent dep → `undefined`, which JSON omits).
  - Update the file-header summary to mention the additive key. Do NOT touch `mirror-bundle-fetch.ts` (it parses `as MirrorBundle`, the optional field flows through) or `adopt.ts`.

- [ ] **Step 4: Run + typecheck** — `pnpm --filter @waitron/server test mirror-bundle` → PASS; `pnpm --filter @waitron/server typecheck`.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): mirror bundle carries an optional WireGuard key (swap S2)"`

---

## Task 6: single-node replication-provisioning suite (`@waitron/sync`, real PG)

The first honest proof: provision ONE node the prototype's way (`waitron_migrator` OWNS the tables), run the bootstrap as the container-superuser, verify readiness, create the two publications as the owner, and prove §13.3.

**Files:**
- Create: `packages/sync/src/testing/replication-node.ts` (a small helper both suites reuse)
- Create: `packages/sync/src/replication-provision.pg.test.ts`
- Modify: `packages/sync/package.json` (add `"@waitron/provisioning": "workspace:*"` to **devDependencies**; `@waitron/migrations` is already a devDep; run `pnpm install`)

**Read first:** `packages/provisioning/src/instance-apply.pg.test.ts` (the real-PG shape — `startBarePostgres`, `createPostgresDb`, `roleUrl`, `withDatabase`, `applyMigrations`) and `packages/db/src/testing/two-node.ts` (`LOGICAL_REPLICATION_COMMAND`, the container labels, the alias/uri model).

**The node-setup helper (`replication-node.ts`)** — the one genuinely Docker-dependent sequence; iterate it against Docker until `select tableowner from pg_tables` shows `waitron_migrator` owning the tables. It must:
1. Boot ONE `postgres:18-alpine` with `-c wal_level=logical -c track_commit_timestamp=on -c max_slot_wal_keep_size=4GB` (extend `two-node.ts`'s `LOGICAL_REPLICATION_COMMAND` with the third setting so readiness's bound is satisfied at boot — no `pg_reload_conf` timing to race), labelled `com.waitron.reapable`. Expose the container superuser URI, the network alias (for Task 7), and a `stop()`.
2. As the container-superuser: `create role waitron_migrator login createrole password '<pw>'` — a PLAIN login role, NOT `in role app_user` (app_user is created BY the core migration). Then `create database <db> owner waitron_migrator` — ownership is what lets the migrator create tables in `public` under PG15+ (a `CREATEROLE` role that does not own the database cannot `CREATE` in `public`) AND makes it own every migrated table.
3. `applyMigrations(roleUrl(withDatabase(superuserUri, <db>) → as waitron_migrator), migrationOptionsFor(manifestSets(), null))` — i.e. migrate over a connection string authenticated AS `waitron_migrator` (use `roleUrl`/`withDatabase` from provisioning's testing helpers or compose the URL). This reproduces the prototype's "applied N migration files as waitron_migrator … owns every table" shape.
4. Return: the superuser `Database` (for the bootstrap + reads), an owner `Database` opened via `createPostgresDb(roleUrl(...waitron_migrator...))` (for publications/§13.3), the node's network alias + db name + the migrator password (Task 7 builds the conninfo from these).

**Interfaces:**
- Consumes: `createPublications` (Task 1), `assertReplicationReady`, `replicationBootstrapStatements`, `REPLICATION_ROLE` (Tasks 3–4, via `@waitron/provisioning`).

- [ ] **Step 1: Write the helper + suite.** Gate on Docker like the harness. Use a small explicit real-table list (NOT `ALL_MODULES` — that would cycle sync→composition): `LEDGER = ["sales", "tenders"]`, `STATE = ["tenants", "locations"]` (all created by the core baseline, all classified in S1).

Assertions (each proven, not implied):
1. **The owner owns the published tables.** `select tableowner from pg_tables where tablename = any(array['sales','tenders','tenants','locations'])` → every row `'waitron_migrator'`. (Documents the shape native replication requires; a non-migrator owner fails loudly — the live-provisioning gap of Task 8.)
2. **Readiness refuses before the bootstrap** — `assertReplicationReady(ownerDb)` throws `provisioning.replication_not_ready`, `missing` including `replication role missing` and `migrator lacks pg_create_subscription` (NOT `wal_level`/`max_slot_wal_keep_size` — the node booted with those set).
3. **Readiness passes after the bootstrap** — run each of `replicationBootstrapStatements("<repl-pw>")` as the container-SUPERUSER; then `assertReplicationReady(ownerDb)` resolves.
4. **The owner creates both publications** — `createPublications(ownerDb, { environment: "preproduction", ledgerTables: LEDGER, stateTables: STATE })` resolves; assert both `waitron_preproduction_ledger`/`_state` exist in `pg_publication` and each names its tables (`pg_publication_tables`).
5. **§13.3 — default privileges cover a later table.** As `waitron_migrator` (ownerDb): `create table repl_later_probe (id int primary key)` AFTER the bootstrap; assert `has_table_privilege('waitron_repl','repl_later_probe','SELECT')` is true WITHOUT an explicit grant; `drop table repl_later_probe`. This is §13 verification #3, RUN.

- [ ] **Step 2: Add the devDep** — `packages/sync/package.json` devDependencies: `@waitron/provisioning` (`workspace:*`). `pnpm install`. Confirm acyclic: `packages/provisioning/package.json` does NOT list `@waitron/sync` (grep it). Do NOT add `@waitron/composition`.

- [ ] **Step 3: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test replication-provision` → PASS. Check memory headroom first (CLAUDE.md §2/§4).

- [ ] **Step 4: Prove by deletion** — temporarily remove the `alter default privileges` line from `replicationBootstrapStatements` → assertion 5 (§13.3) FAILS (the later table is not covered). Restore. Record the failure in the commit message (the §13.3 receipt).

- [ ] **Step 5: Coverage + typecheck** — `pnpm --filter @waitron/sync test:coverage` (98/98/98/95 — this suite covers `createPublications`' execution). `pnpm --filter @waitron/sync typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "test(sync): single-node replication provisioning + §13.3 default-privileges (swap S2)"`

---

## Task 7: two-node subscription suite (`@waitron/sync`, real PG)

Builds on the S1 two-node fixture: the standby subscribes to the primary as `waitron_repl`, a `state` row copies A→B via the real roles, and a wrong-environment publication name copies nothing.

**Files:**
- Modify: `packages/db/src/testing/two-node.ts` (add `max_slot_wal_keep_size=4GB` to `LOGICAL_REPLICATION_COMMAND` so both nodes boot the bounded slot; the S1 smoke test still passes — it only asserts `wal_level`. Track A owns this fixture.)
- Create: `packages/sync/src/replication-subscribe.pg.test.ts`

**Interfaces:**
- Consumes: `startTwoNodeCluster` from `@waitron/db/testing/two-node.js` (S1); `createSubscription`, `buildConninfo`, `createPublications`, `enableSubscription`/`disableSubscription`/`dropSubscription`; `REPLICATION_ROLE`, `replicationBootstrapStatements`, `assertReplicationReady` (via `@waitron/provisioning`); the node-setup helper from Task 6.

**Setup:** the two-node fixture's `migrate(uri)` runs as the container superuser; reuse Task 6's helper logic to make `waitron_migrator` own the tables on each node and bootstrap each (container-superuser). Open an owner `Database` per node for publications, and build the subscriber's conninfo from node A's network alias + db + `waitron_repl` password.

- [ ] **Step 1: Verify the environment-refusal mechanism EMPIRICALLY before asserting it (CLAUDE.md §1).** Run, once, against the fixture: `CREATE SUBSCRIPTION … PUBLICATION "waitron_production_ledger" WITH (connect=true, copy_data=true, enabled=true)` where the publisher only has `waitron_preproduction_*`. Observe whether it THROWS or merely WARNS ("publication does not exist"). Since PostgreSQL 16 `check_publications` emits a WARNING and the subscription is CREATED (the failure is asynchronous), so do NOT assert a throw — assert that **no rows arrive** (below). Record what you observed in the commit message.

- [ ] **Step 2: Write the suite.** Assertions:

1. **A `state` row copies A→B via the real roles.** Provision + bootstrap both nodes (owner-owned tables). Create publications on A as preproduction (`createPublications(aOwnerDb, { environment: "preproduction", ledgerTables: ["sales","tenders"], stateTables: ["tenants","locations"] })`). On B, `createSubscription(bOwnerDb, { name: "waitron_sub_from_a", conninfo: buildConninfo({ host: cluster.nodeA.networkHost, port: 5432, database: <db>, user: REPLICATION_ROLE, password: <repl-pw> }), publications: ["waitron_preproduction_ledger", "waitron_preproduction_state"], copyData: true, enabled: true })`. Insert one `locations` row on A (the prototype's own probe table; a `tenants` parent must exist first — seed the minimal FK parents, or use `tenants` as the copied row and insert it first). `expect.poll` until it appears on B (timeout 30s). Then exercise `disableSubscription`/`enableSubscription`/`dropSubscription` on B (real ALTER/DROP execution — completes their coverage) with light assertions (e.g. after `dropSubscription`, `pg_subscription` has no such row).
2. **A wrong-environment publication name copies nothing (spec §2.4, name-carried half).** On B create a second subscription naming `waitron_production_ledger`/`_state` (which A, a preproduction publisher, does not have). Assert it copies NOTHING: after a bounded wait, `pg_subscription_rel` for that subscription is empty and the probe row's production-only marker never arrives on B. State in a comment that the HARD refusal (the adoption code reading `deployment.environment` and refusing, spec §2.4) is step-4 / the live path, not S2; S2 shows only that the environment-carrying name means a cross-environment attach transfers nothing.

- [ ] **Step 3: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test replication-subscribe` → PASS. Two containers — check memory headroom; do not run beside another session's browser/real-PG load (CLAUDE.md §2/§4).

- [ ] **Step 4: Run the S1 fixture's own smoke test** to confirm the `LOGICAL_REPLICATION_COMMAND` change did not break it — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test two-node`.

- [ ] **Step 5: Coverage + typecheck** — `pnpm --filter @waitron/sync test:coverage`; `pnpm --filter @waitron/sync typecheck`; `pnpm --filter @waitron/db test:coverage` (the fixture change).

- [ ] **Step 6: Commit** — `git commit -s -m "test(sync): two-node subscription + environment name isolation (swap S2)"`

---

## Task 8: docs — spec pointers, backlog, CLAUDE.md, the flagged gap

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md`
- Modify: `docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md`
- Modify: `docs/backlog.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Swap spec pointers** — dated `> **2026-09-07 — S2 built.**` on §14's S2 bullet and §3: capability + fixture only (live adopt/promote/return untouched, flip in step 4); `publications.ts`/`subscriptions.ts` in `@waitron/sync` (runtime-decoupled), `REPLICATION_ROLE` + bootstrap emitter + readiness check in `@waitron/provisioning` (bootstrap-and-verify); `wal_level`/`track_commit_timestamp` image-level (restart), `max_slot_wal_keep_size` set by the bootstrap and by the fixture boot command; §13 verification #3 RUN; `sqlStateOf` homed in `@waitron/shared`; fiscal-fidelity + full-copy suites deferred to signed step 4.
- [ ] **Step 2: Correct §2.4's wording** — it says a cross-environment attach "fails with 'publication does not exist'". Add a dated note: measured, `CREATE SUBSCRIPTION` with `connect=true` WARNS and still creates the subscription (PG16 `check_publications`); the name-carried isolation manifests as NO ROWS copied, and the HARD refusal is the adoption code's `deployment.environment` check (step 4 / live path), not a synchronous CREATE error.
- [ ] **Step 3: Record the ownership gap** — under §13, dated finding: the prototype's "the shape `waitron-provision instance` produces" (migrator owns every table) is UNVERIFIED against the built CLI — `instance-apply.ts:172` migrates as `deps.adminUri` (the bootstrap admin owns the baseline tables), with `waitron_migrator` created afterward as a separate role. Native replication requires the publication-creating role to own the tables; the S2 fixture provisions and ASSERTS that shape, but the live cutover (step 4) must make `waitron-provision instance` leave `waitron_migrator` owning every table (candidates: `CREATE DATABASE … OWNER waitron_migrator` + migrate as it, or `REASSIGN OWNED … TO waitron_migrator`). Step-4 prerequisite, not S2.
- [ ] **Step 4: Chain spec pointer** — `> **2026-09-07 — step 3 built.**` on drop-rls §3 step 3, same summary + the ownership gap carried to step 4.
- [ ] **Step 5: backlog** — under Track A item 3, mark step 3 (swap S2) LANDED/in-PR: provisioning capability (repl bootstrap, publications/subscriptions, readiness, WireGuard-key bundle field), proven against the two-node fixture; fiscal-fidelity + live-path flip deferred to step 4; the ownership gap flagged. One line, no receipt paragraph.
- [ ] **Step 6: CLAUDE.md §3** — a native-replication provisioning bullet (rule + pointer, no narrative): a node's two publications (`waitron_<env>_ledger`/`_state`) are created by the table OWNER (`waitron_migrator`) from the module classification; `waitron_repl` `LOGIN REPLICATION` + `pg_create_subscription` + `wal_level=logical`/`track_commit_timestamp=on` are a SUPERUSER/box-image bootstrap the app provisioner VERIFIES (`assertReplicationReady`, `provisioning.replication_not_ready`) and never performs; a subscription's CONNECTION conninfo carries the `waitron_repl` password, so its statement is never logged and its failure throws only a SQLSTATE (`sync.subscription_failed`), like `CREATE ROLE`; `sqlStateOf` lives in `@waitron/shared` (single source). Pointer: this plan + swap spec §2.2/§3.
- [ ] **Step 7: Commit** — `git commit -s -m "docs: replication provisioning capability landed; ownership gap flagged (swap S2)"`

---

## Self-review checklist (run before dispatching implementers)

1. **Spec coverage (S2):** superuser step (Task 3); publications by the owner (Task 1); subscription verbs + origin/enable rules §2.2 (Task 2); environment name isolation §2.4 — measured as no-rows, hard refusal deferred (Task 7); the three settings — two image-level + the fixture boot command, one in the bootstrap §3/§6 (Tasks 3,6,7); WireGuard-key bundle field §2.3 (Task 5); proven against the fixture §11 subset (Tasks 6–7); §13 verification #3 (Task 6). Deferred by owner decision: the live adopt/promote flip, the fiscal-fidelity suites, and the §11 every-table copy matrix (step 4) — flagged, not built.
2. **Coverage self-containment:** every new function is exercised in ITS OWN package's coverage run — sync's subscription verbs + throw branches by the fake-`db` unit tests (Task 2), provisioning's readiness (all branches, resolve + throw) by the fake-`db` unit tests (Task 4), the bootstrap emitter by the string unit test (Task 3), `createPublications` by the real node (Task 6), `sqlStateOf` by shared's own test (Task 2). No function is covered only cross-package.
3. **Decoupling:** `publications.ts`/`subscriptions.ts` import only `@waitron/db` + `@waitron/shared` at runtime; `@waitron/provisioning` is a sync DEV dep only (acyclic — provisioning does not import sync); `@waitron/composition` is NOT added (would cycle); the fixtures use an explicit real-table list.
4. **Secrets:** every secret-bearing statement (subscription conninfo, bootstrap `CREATE ROLE`) is never logged and throws only a SQLSTATE; unit tests assert the password never reaches the thrown error (Task 2) and the bootstrap escapes the password literal (Task 3); `sqlLiteral` uses the `E'…'` form for a backslash-bearing conninfo.
5. **Name/type consistency:** `publicationName`/`createPublications`/`PublicationClass`; `createSubscription`/`buildConninfo`/`ReplicationConnection`/`*Statement` builders; `REPLICATION_ROLE`/`replicationBootstrapStatements`; `readReplicationReadiness`/`assertReplicationReady`/`replicationReadinessGaps`/`ReplicationReadiness`; `sync.subscription_failed`/`provisioning.replication_not_ready` — consistent across tasks.

## Open items to surface in the PR (owner reviews at land)

- **The ownership gap (Task 8 step 3):** whether `waitron-provision instance` leaves `waitron_migrator` owning every table is unverified and is a step-4 prerequisite; the S2 fixture asserts the required shape.
- **Capability-only:** nothing runs in the live adopt/promote/return path; the two-node fixture is the whole proof (real-machine proof is Track B item 2).
- **Environment isolation in S2 is name-carried (no rows), not a hard refusal** — the hard refusal is the step-4 adoption `deployment.environment` check; spec §2.4 wording corrected accordingly.
- **The WireGuard field is plumbing only** — populated from an injected value, no keypair generation, no consumer (S7 / step 4).
- **`sqlStateOf` moved to `@waitron/shared`** — a behaviour-preserving consolidation the original's own header demanded; provisioning re-exports it so its callers are unchanged.
