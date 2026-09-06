# Membership Rejoin — Slice 6 R3 (wipe-and-restore) Implementation Plan

> **2026-09-06 (SP-3d):** The `skipSecrets` contract quoted below now also skips setting aside the
> current identity and running module restore hooks. Rejoin still restores DB and media and now
> migrates the restored database before returning. See the [SP-3d
> design](../specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md) §3.3 and §5.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator-run CLI that lets a fenced, fully-drained returned ex-primary discard its diverged database, restore the current primary's baseline (keeping its own identity), and come back up still fenced but streaming the primary's log as a clean subscriber.

**Architecture:** A guard ladder (`rejoin.not_fenced` → `rejoin.no_carrier` → `rejoin.not_drained`) reusing R1's fence predicates and R2's lane-agnostic disposal guard, then a destructive composition: `dropAndCreateDatabase` (the BR-3 wipe carry-forward) followed by BR-3's `restoreFromArtifact` run with a new `skipSecrets:true` flag (restore DB+media, keep own identity). Invoked by a new `waitron-rejoin` CLI sibling to `waitron-restore`; secrets/URLs come from the environment, never argv.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle, Vitest, Testcontainers (real Postgres). Package: `apps/server`. Reuses `@waitron/membership`, `@waitron/sync`, `@waitron/db`, `@waitron/provisioning` (identifiers), and BR-3's `restore.ts`.

**Spec:** `docs/superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md` (this plan argues from it; executors read both).

## Global Constraints

- **Gate before push:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; CI shards run `test:coverage` — run `pnpm --filter @waitron/server test:coverage` before claiming green (CLAUDE.md §2). Also run the **full `apps/server` suite unfiltered** (a wire/boot change is invisible to a name-filtered run — CLAUDE.md §2/§4).
- **Coverage thresholds:** `apps/server` = 95/95/90/88.
- **Every commit `-s`** (DCO). Work happens in the existing worktree `waitron-feat-membership-rejoin-r3-wipe-restore` on branch `feat/membership-rejoin-r3-wipe-restore`.
- **No migration** — this slice reads existing `node_membership`/`sync_log`/`sync_cursor` and composes existing restore steps; it adds NO schema, so no RLS/FORCE-RLS/`inmutabilidad`/`english-only` surface. All `rejoin.*` codes and standing values are English.
- **No backwards-compat / no data migration** — nothing is deployed (CLAUDE.md §3).
- **Error codes name the DOMAIN CONCEPT** (`rejoin.*`), never the package (CLAUDE.md §3). Every file that throws a code does `import "./errors.js"`.
- **Utility statements take no placeholders** — `DROP`/`CREATE DATABASE` interpolate via `quoteIdent`, never a bind param (CLAUDE.md §3).
- **Secrets never in argv** — recovery key and connection URLs read from `env`; fail CLOSED on empty via `isUnset` (an empty connection string is a valid connection string — CLAUDE.md §3).
- **Real Postgres for privilege/DDL behaviour** — `dropAndCreateDatabase` and the e2e restore run on Testcontainers, not PGlite (a single-superuser backend cannot `DROP DATABASE` the connected DB). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally; `pnpm reap` if a run is interrupted (CLAUDE.md §4).
- **Model:** implementation subagents use Opus 5 (per user preference); planning/orchestration Opus 4.8.
- **Fiscal-adjacent → owner sign-off before land.** Do NOT self-land.

---

### Task 1: `skipSecrets` flag on `restoreFromArtifact` (BR-3 extension)

The one-field extension the spec §4.4 calls for: R3 restores DB+media but must keep its own identity, so it skips the secrets write while reusing BR-3's whole up-front pass (decrypt/unpack/compatibility-gate/traversal-guard — the security-critical code that must not be duplicated).

**Files:**
- Modify: `apps/server/src/restore.ts` (add field to `RestoreDeps`; guard the `restoreSecrets` call at `restore.ts:163`)
- Test: `apps/server/src/restore.test.ts` (add a case in the existing `describe("restoreFromArtifact")` block — it already has `buildArtifact`, `deps({...})`, temp dirs, and a `vi.fn` `runRestore`)

**Interfaces:**
- Consumes: existing `RestoreDeps`, `restoreFromArtifact`, the test's `buildArtifact`/`deps`/`ENTRIES` (`media/abc123.jpg`, `secrets/secrets.env`).
- Produces: `RestoreDeps.skipSecrets?: boolean` (default `false`). When `true`, `restoreFromArtifact` restores DB + media + hooks but does NOT write secrets.

- [ ] **Step 1: Write the failing test**

```typescript
it("skips secrets when skipSecrets is true (keeps own identity), still restores db+media", async () => {
  await restoreFromArtifact(deps({ skipSecrets: true }));
  // db restored (pg_restore fake called) and media restored …
  expect(runRestore).toHaveBeenCalledTimes(1);
  expect(await readFile(join(mediaDir, "abc123.jpg"))).toEqual(MEDIA);
  // … but the secret was NOT written — the node keeps its own identity
  await expect(stat(join(stateDir, "secrets.env"))).rejects.toMatchObject({ code: "ENOENT" });
  // staging still cleaned
  await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test restore -- -t "skips secrets"`
Expected: FAIL — `skipSecrets` is not on `RestoreDeps` (TS error) or the secret file IS written (`readFile` succeeds, `stat` resolves).

- [ ] **Step 3: Add the field and guard the call**

In `RestoreDeps` (after `runRestore?`):

```typescript
  /**
   * Skip restoring `secrets/*` into `stateDir`. Default `false` (the disaster-recovery CLI restores
   * everything). R3 rejoin sets `true`: a returning node keeps its OWN identity (its identity keypair
   * / box key in `stateDir`), so it restores the primary's DB and media but NOT the primary's secrets
   * (spec §4.4). The whole up-front pass — decrypt, unpack, compatibility gate, traversal guard — still
   * runs; only the `restoreSecrets` write is elided, keeping that gate+guard a single source of truth.
   */
  readonly skipSecrets?: boolean;
```

Guard the existing call (currently `await restoreSecrets(...)` at `restore.ts:163`):

```typescript
    if (!deps.skipSecrets) {
      await restoreSecrets({ entries: secretEntries, stateDir: deps.stateDir, log });
    }
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @waitron/server test restore -- -t "skips secrets"` → PASS. Re-run the whole `restore.test.ts` to confirm the default path (`skipSecrets` absent) still writes secrets: `pnpm --filter @waitron/server test restore` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/restore.ts apps/server/src/restore.test.ts
git commit -s -m "feat(server): skipSecrets flag on restoreFromArtifact (R3 keeps own identity)"
```

---

### Task 2: `dropAndCreateDatabase` — the wipe primitive

The BR-3 carry-forward: discard the diverged DB and hand BR-3 the fresh DB it expects. Its own small unit (single responsibility), mirroring `instance-apply.ts`'s `create database ${quoteIdent(...)}` pattern.

**Files:**
- Create: `apps/server/src/db-wipe.ts`
- Test: `apps/server/src/db-wipe.rls.test.ts` (real Postgres — the `.rls` suffix is the repo's convention for Testcontainer suites in `apps/server`)

**Interfaces:**
- Consumes: `Database` (`@waitron/db`), `quoteIdent` (`@waitron/provisioning`), Drizzle `sql`.
- Produces: `dropAndCreateDatabase(args: { admin: Database; database: string }): Promise<void>` — `admin` is a connection to a MAINTENANCE database (e.g. `postgres`), NOT to `database` itself; runs `DROP DATABASE <database> WITH (FORCE)` then `CREATE DATABASE <database>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPostgresDb, type Database } from "@waitron/db";
import { startPostgresContainer } from "@waitron/db/testing/postgres.js"; // real-container helper
import { quoteIdent } from "@waitron/provisioning";
import { dropAndCreateDatabase } from "./db-wipe.js";

describe("dropAndCreateDatabase (real Postgres)", () => {
  let admin: Database;
  let adminUrl: string; // connection to the maintenance db (postgres)
  // (beforeAll: start container as a privileged role; connect `admin` to the `postgres` db.)

  it("drops a database with data and recreates it empty and usable", async () => {
    const name = "rejoin_wipe_probe";
    await admin.execute(sql.raw(`create database ${quoteIdent(name)}`));
    const target = await createPostgresDb(urlForDb(adminUrl, name));
    await target.execute(sql.raw(`create table t (x int)`));
    await target.execute(sql.raw(`insert into t values (1)`));
    await target.driver.end(); // close before the FORCE drop terminates it

    await dropAndCreateDatabase({ admin, database: name });

    const fresh = await createPostgresDb(urlForDb(adminUrl, name));
    const rows = await fresh.execute<{ present: boolean }>(
      sql`select exists (select 1 from information_schema.tables where table_name = 't') as present`,
    );
    expect(rows[0]?.present).toBe(false); // recreated empty
    await fresh.driver.end();
  });

  it("terminates a live backend on the target (WITH FORCE)", async () => {
    const name = "rejoin_wipe_force";
    await admin.execute(sql.raw(`create database ${quoteIdent(name)}`));
    const lingering = await createPostgresDb(urlForDb(adminUrl, name)); // stays open
    await expect(dropAndCreateDatabase({ admin, database: name })).resolves.toBeUndefined();
    // the lingering connection is now dead; recreate proved by the call resolving
    await lingering.driver.end().catch(() => {});
  });
});
```

(Model the container/URL plumbing — `startPostgresContainer`, `urlForDb`, closing `admin` in `afterAll` guarded `if (admin !== undefined)` — on an existing `apps/server/src/*.rls.test.ts`; do NOT hand-roll a teardown that a helper can own, CLAUDE.md §4.)

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @waitron/server test db-wipe` → FAIL (`dropAndCreateDatabase` not defined).

- [ ] **Step 3: Write the implementation**

```typescript
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { quoteIdent } from "@waitron/provisioning";

/**
 * Discard a database and recreate it empty — the wipe half of R3 rejoin (spec §4.4), the primitive
 * BR-3 left as a carry-forward (its restore targets a FRESH db and does not create one). `admin` must
 * be connected to a DIFFERENT (maintenance) database — Postgres refuses to drop the database a session
 * is connected to. `WITH (FORCE)` terminates any lingering backend on the target (a stopped-but-
 * -reconnecting server, a leftover pool) so the drop cannot hang on an open connection.
 *
 * Utility statements take no placeholders (CLAUDE.md §3), so the name reaches each statement as text,
 * escaped by `quoteIdent` — the same defence `instance-apply.ts` uses for `create database`.
 * NOT a transaction (CREATE/DROP DATABASE cannot run in one — `instance-apply.ts:52`); the two
 * statements run autocommit in order. A crash between them leaves the db dropped-not-created. NOTE
 * (superseded during implementation — see the shipped `db-wipe.ts` header + design §4): a bare re-run
 * of the R3 flow does NOT self-recover, because the R3 guards read `node_membership` from the very db
 * this wipes, so a re-run fails at connect or at `rejoin.not_fenced`. No data is lost (the drained
 * tail is on the carrier; the artifact is unchanged) — the box needs operator recovery.
 */
export async function dropAndCreateDatabase(args: {
  admin: Database;
  database: string;
}): Promise<void> {
  const name = quoteIdent(args.database);
  await args.admin.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await args.admin.execute(sql.raw(`create database ${name}`));
}
```

- [ ] **Step 4: Run test to verify it passes** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test db-wipe` → PASS.

- [ ] **Step 5: Prove the guard by mutation** — temporarily change `drop database if exists` to `drop database` (no `if exists`) and confirm nothing about the happy path changes (the db always exists there); then change the `admin` connection in the test to point AT the target db and confirm Postgres refuses ("cannot drop the currently open database"), documenting WHY `admin` must be a maintenance connection. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db-wipe.ts apps/server/src/db-wipe.rls.test.ts
git commit -s -m "feat(server): dropAndCreateDatabase wipe primitive (R3 carry-forward from BR-3)"
```

---

### Task 3: `rejoinAsSecondary` — guard ladder + destructive composition

The core. Mirrors `retire.ts`'s "refuse loud before anything irreversible" shape, minus the `carrier_changed` guard (unreachable in a one-shot read — spec §4). Reads the held membership from the app DB for the fence/carrier-presence guards; takes the drain reader, the wipe, and the restore as injected functions so it is unit-testable without a container.

**Files:**
- Create: `apps/server/src/rejoin.ts`
- Modify: `apps/server/src/errors.ts` (register `rejoin.not_fenced` / `rejoin.no_carrier` / `rejoin.not_drained`)
- Test: `apps/server/src/rejoin.test.ts`

**Interfaces:**
- Consumes: `readNodeMembership` (`@waitron/db`), `standingOf`/`isFencedStanding`/`servingPrimaryNodeId` (`@waitron/membership`), `DrainProgress` (`@waitron/sync`), `Database`, `Logger`.
- Produces:
  - `interface RejoinDeps { appDb: Database; nodeId: string; readDrainProgress: (() => Promise<DrainProgress>) | undefined; closePreWipe: () => Promise<void>; wipeDatabase: () => Promise<void>; restore: () => Promise<void>; log: Logger; }`
  - `interface RejoinResult { restored: true; carrierNodeId: string; }`
  - `rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult>`
  - `closePreWipe` closes the pre-wipe pools (`appDb` + the sync pool the drain reader uses) — it runs AFTER the last guard and BEFORE `wipeDatabase`, because the FORCE drop terminates any connection still on the target db. The command supplies the real close; the unit test a `vi.fn`.

- [ ] **Step 1: Add the error codes**

In `apps/server/src/errors.ts`, beside the `node.retire_*` family, register (copy a sibling's doc-comment shape; `node.*` vs `rejoin.*` — these are facts about a REJOIN action, a domain concept, not the process, so `rejoin.*` not `server.*`):

```typescript
    "rejoin.not_fenced": {}, // this node is not fenced (sell-only/evicted) — a serving node must never be wiped
    "rejoin.no_carrier": {},  // the held chart names no serving-primary to have drained to
    "rejoin.not_drained": {}, // the carrier has not caught up on this node's own-origin tail on every lane
```

(Match the exact registration syntax `retire.ts`'s codes use in `errors.ts` — params object shape and the doc comment style; grep `node.retire_not_drained` for the template.)

- [ ] **Step 2: Write the failing tests (each guard, proven by construction; happy path)**

```typescript
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";
// a tiny fake Database whose readNodeMembership return is controlled per test (mock @waitron/db's
// readNodeMembership with vi.mock, or inject a held-doc reader — follow retire.test.ts's approach).

const SELF = "node-self";
const fenceDoc = (standing: string, carrier: string | null) => ({
  body: { term: 3, nodes: [
    ...(carrier ? [{ nodeId: carrier, contactUrl: "https://c", standing: "serving-primary" }] : []),
    { nodeId: SELF, contactUrl: "", standing },
  ] },
  /* signature fields as SignedMembershipDocument requires — reuse membership/document-fixtures */
});

const deps = (over: Partial<RejoinDeps> & { held: unknown }): RejoinDeps => ({
  appDb: fakeDbReturning(over.held) as never,
  nodeId: SELF,
  readDrainProgress: vi.fn(async () => ({ drained: true, ownTailSeq: 5n, carrierAppliedSeq: 5n })),
  closePreWipe: vi.fn(async () => {}),
  wipeDatabase: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
  log: () => {},
  ...over,
});

it("refuses when the node is not fenced", async () => {
  const d = deps({ held: fenceDoc("serving-secondary", "node-carrier") });
  await expect(rejoinAsSecondary(d)).rejects.toMatchObject({ code: "rejoin.not_fenced" });
  expect(d.wipeDatabase).not.toHaveBeenCalled();
});

it("refuses when the held chart names no carrier", async () => {
  const d = deps({ held: fenceDoc("sell-only", null), readDrainProgress: undefined });
  await expect(rejoinAsSecondary(d)).rejects.toMatchObject({ code: "rejoin.no_carrier" });
  expect(d.wipeDatabase).not.toHaveBeenCalled();
});

it("refuses when the tail has not fully drained", async () => {
  const d = deps({
    held: fenceDoc("sell-only", "node-carrier"),
    readDrainProgress: vi.fn(async () => ({ drained: false, ownTailSeq: 9n, carrierAppliedSeq: 4n })),
  });
  await expect(rejoinAsSecondary(d)).rejects.toMatchObject({ code: "rejoin.not_drained" });
  expect(d.wipeDatabase).not.toHaveBeenCalled();
});

it("closes pre-wipe pools, then wipes, then restores, in that order (returns the carrier)", async () => {
  const calls: string[] = [];
  const d = deps({
    held: fenceDoc("sell-only", "node-carrier"),
    closePreWipe: vi.fn(async () => { calls.push("close"); }),
    wipeDatabase: vi.fn(async () => { calls.push("wipe"); }),
    restore: vi.fn(async () => { calls.push("restore"); }),
  });
  await expect(rejoinAsSecondary(d)).resolves.toEqual({ restored: true, carrierNodeId: "node-carrier" });
  expect(calls).toEqual(["close", "wipe", "restore"]); // never wipe before closing our conns, never restore before wipe
});

it("does NOT close pools or wipe when a guard rejects", async () => {
  const d = deps({ held: fenceDoc("serving-secondary", "node-carrier") });
  await expect(rejoinAsSecondary(d)).rejects.toMatchObject({ code: "rejoin.not_fenced" });
  expect(d.closePreWipe).not.toHaveBeenCalled();
  expect(d.wipeDatabase).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail** — `pnpm --filter @waitron/server test rejoin.test` → FAIL (`rejoinAsSecondary` not defined).

- [ ] **Step 4: Write the implementation**

```typescript
import "./errors.js"; // register rejoin.* (reachability convention)
import { AppError } from "@waitron/shared";
import { readNodeMembership, type Database } from "@waitron/db";
import { isFencedStanding, servingPrimaryNodeId, standingOf } from "@waitron/membership";
import type { DrainProgress } from "@waitron/sync";
import type { Logger } from "./logger.js";

export interface RejoinDeps {
  /** App-DB connection for the PRE-WIPE reads (node_membership). Must be closed by the caller BEFORE
   * the wipe runs (the FORCE drop terminates any connection still on the target db). */
  readonly appDb: Database;
  /** THIS node's own id (config.till.nodeId) — the standing to check and the drain source origin. */
  readonly nodeId: string;
  /** The carrier-keyed drain reader (caller assembles `withTenant(syncDb, tenantId, tx =>
   * readDrainProgress(tx, { selfNodeId, carrierNodeId, enrolments: ALL_SYNC_ENROLMENTS }))`), or
   * `undefined` when the held document names no carrier → `rejoin.no_carrier`. */
  readonly readDrainProgress: (() => Promise<DrainProgress>) | undefined;
  /** Close the pre-wipe pools (`appDb` + the sync pool the drain reader used). Called AFTER the last
   * guard and BEFORE `wipeDatabase` — the FORCE drop terminates any connection still on the target db,
   * so ours must be gone first. */
  readonly closePreWipe: () => Promise<void>;
  /** Discard + recreate the target db (Task 2, bound to the maintenance conn + db name). */
  readonly wipeDatabase: () => Promise<void>;
  /** Restore the baseline with `skipSecrets:true` (BR-3 `restoreFromArtifact`, Task 1). */
  readonly restore: () => Promise<void>;
  readonly log: Logger;
}

export interface RejoinResult {
  readonly restored: true;
  readonly carrierNodeId: string;
}

/**
 * Rejoin a fenced, fully-drained returned ex-primary as a clean secondary (spec §4). Ordered guards —
 * `not_fenced` → `no_carrier` → `not_drained` — refuse LOUD before the irreversible wipe, the same
 * discipline `retire.ts` uses. There is deliberately NO `carrier_changed` guard: unlike retire's
 * boot-bound reader, this reads the held document once and the caller keys `readDrainProgress` on a
 * carrier from that SAME read, so no stale-carrier gap exists (spec §4). On success: wipe, then
 * restore (never the reverse), then return the carrier the node will stream from.
 */
export async function rejoinAsSecondary(deps: RejoinDeps): Promise<RejoinResult> {
  const held = await readNodeMembership(deps.appDb);
  const standing = held === null ? undefined : standingOf(held, deps.nodeId);
  if (!isFencedStanding(standing)) {
    throw new AppError("rejoin.not_fenced", {});
  }
  // held is non-null here: a null held gives standing `undefined`, which is not fenced → thrown above.
  const carrier = servingPrimaryNodeId(held!);
  if (carrier === undefined || deps.readDrainProgress === undefined) {
    throw new AppError("rejoin.no_carrier", {});
  }
  const progress = await deps.readDrainProgress();
  if (!progress.drained) {
    throw new AppError("rejoin.not_drained", {});
  }
  deps.log("info", "rejoin.drained", { carrierNodeId: carrier });
  // Close our own connections to the target db BEFORE the FORCE drop (which would otherwise terminate
  // them out from under us). Everything the guards needed has been read by now.
  await deps.closePreWipe();
  await deps.wipeDatabase();
  deps.log("info", "rejoin.wiped", {});
  await deps.restore();
  deps.log("info", "rejoin.restored", { carrierNodeId: carrier });
  return { restored: true, carrierNodeId: carrier };
}
```

- [ ] **Step 5: Run tests to verify they pass** — `pnpm --filter @waitron/server test rejoin.test` → PASS.

- [ ] **Step 6: Prove each guard by deletion** — for each of the three guards, temporarily delete the `throw` and confirm its test fails (the destructive `wipeDatabase` would be reached), then restore. This is the CLAUDE.md §4 "prove a guard by deletion" step.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/rejoin.ts apps/server/src/rejoin.test.ts apps/server/src/errors.ts
git commit -s -m "feat(server): rejoinAsSecondary guard ladder + wipe/restore composition (R3)"
```

---

### Task 4: `rejoin-command.ts` + `bin-rejoin.ts` — the operator CLI

Assembles the real deps (pre-wipe pools, drain reader, wipe bound to a maintenance conn, restore with `skipSecrets`) and drives `rejoinAsSecondary`. Models `restore-command.ts` closely — env-only secrets, fail-closed on empty, never echo a raw error message (`bin-rejoin.ts` has no `.catch`).

**Files:**
- Create: `apps/server/src/rejoin-command.ts` (exports `runRejoin`)
- Create: `apps/server/src/bin-rejoin.ts` (thin `process.argv`/`env` wrapper, `/* v8 ignore */` like `bin-restore.ts`/`bin-sync-evict.ts`)
- Modify: `apps/server/package.json` (add the `waitron-rejoin` bin entry beside `waitron-restore`)
- Test: `apps/server/src/rejoin-command.test.ts`

**Interfaces:**
- Consumes: `rejoinAsSecondary`/`RejoinResult` (Task 3), `dropAndCreateDatabase` (Task 2), `restoreFromArtifact` (Task 1 with `skipSecrets`), `readDrainProgress`/`DrainProgress` + `withTenant` + `ALL_SYNC_ENROLMENTS`, `readNodeMembership` + `servingPrimaryNodeId`, `createPostgresDb`, `tryLoadTillConfig`, `isUnset`/`resolveConfigDir`/`DEFAULT_*_ROOT`/`deploymentEnvironment`/`createLogger`/`ALL_MODULES`.
- Produces: `runRejoin(deps: { argv: string[]; env: Env; out: (line: string) => void; rejoin?: (d: RejoinDeps) => Promise<RejoinResult> }): Promise<number>` — exit `0` success, `1` expected DR failure (bad env, unreadable artifact, a `rejoin.*`/`restore.*`/`recovery.*`/`backup.*` code, or ANY other error reported generically), `2` usage.

**Env contract (documented in the function's doc-comment):**
- `DATABASE_URL` — app pool, pre-wipe `node_membership` read (closed before the wipe).
- `WAITRON_SYNC_DATABASE_URL` — sync pool, the drain read (`withTenant` + `readDrainProgress`; holds the sync_tailer membership's SELECT on `sync_log`/`sync_cursor`), closed before the wipe.
- `WAITRON_MAINTENANCE_DATABASE_URL` — **new** — privileged connection to a MAINTENANCE db (e.g. `postgres`) for `dropAndCreateDatabase`. Fail-closed on empty.
- `WAITRON_RESTORE_DATABASE_URL` — privileged connection to the (freshly created) target db for `pg_restore` (reused from BR-3). The target db NAME is parsed from this URL's path (single source of truth; refuse if it is a socket/opaque form with no db name).
- `WAITRON_BACKUP_RECOVERY_KEY` — the artifact's recovery key (reused from BR-3).
- `WAITRON_TILL_*_ID` — via `tryLoadTillConfig(env)` → `nodeId` + `tenantId`. Refuse if absent (`rejoin` on an unprovisioned box is a misuse).
- `WAITRON_MEDIA_DIR`/`WAITRON_STATE_DIR`/`WAITRON_MIGRATIONS_DIR`/`WAITRON_ENV` — resolved exactly as `restore-command.ts` does.

- [ ] **Step 1: Write the failing tests** (usage, each missing-env refusal, and the happy path with an injected `rejoin` fake — no container)

```typescript
import { describe, expect, it, vi } from "vitest";
import { runRejoin } from "./rejoin-command.js";

const base = { /* every required env var set to a dummy non-empty value; WAITRON_TILL_*_ID present */ };
const run = (over: Record<string, string | undefined>, rejoin = vi.fn(async () => ({ restored: true as const, carrierNodeId: "c" }))) => {
  const out: string[] = [];
  return runRejoin({ argv: ["rejoin", "/tmp/a.backup.enc"], env: { ...base, ...over }, out: (l) => out.push(l), rejoin })
    .then((code) => ({ code, out }));
};

it("usage error without the subcommand", async () => {
  const { code } = await run({}, undefined as never);
  // call with argv=[] — expect 2 (adjust the run helper to pass argv through)
});
it("refuses an empty WAITRON_MAINTENANCE_DATABASE_URL (fail closed)", async () => {
  const { code, out } = await run({ WAITRON_MAINTENANCE_DATABASE_URL: "" });
  expect(code).toBe(1);
  expect(out.join("\n")).toMatch(/WAITRON_MAINTENANCE_DATABASE_URL/);
});
it("refuses when WAITRON_TILL_*_ID are absent (unprovisioned box)", async () => { /* … code 1 */ });
it("reports a rejoin.* code without echoing a raw message", async () => {
  const rejoin = vi.fn(async () => { throw new AppError("rejoin.not_drained", {}); });
  const { code, out } = await run({}, rejoin);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("rejoin.not_drained");
});
it("returns 0 and reports the carrier on success", async () => {
  const { code, out } = await run({});
  expect(code).toBe(0);
  expect(out.join("\n")).toMatch(/restored/);
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/server test rejoin-command` → FAIL (not defined).

- [ ] **Step 3: Implement `runRejoin`** — structure mirrors `runRestore` (`restore-command.ts`):
  1. Parse `argv` → require `rejoin <artifact-path>`, else usage (return 2).
  2. Read + `isUnset`-guard each env var above (each its own message, return 1); `tryLoadTillConfig(env)` inside try/catch (its `server.config_invalid` reported by code); refuse `undefined` (no till) with a clear message.
  3. `readFile(artifactPath)` in try/catch → "cannot read artifact file: <path>" (return 1).
  4. Resolve `environment` via `deploymentEnvironment(env)` in try/catch (report code, return 1) — the `restore-command.ts` fix (never let it reject raw).
  5. Parse the target db name from `WAITRON_RESTORE_DATABASE_URL` (`new URL(url).pathname.replace(/^\//, "")`); refuse with a clear message if empty (socket/opaque form).
  6. Open `appDb = createPostgresDb(DATABASE_URL)` and `syncDb = createPostgresDb(WAITRON_SYNC_DATABASE_URL)`. Read `held = readNodeMembership(appDb)`; `carrier = held && servingPrimaryNodeId(held)`. Build `readDrainProgress` = `carrier === undefined ? undefined : () => withTenant(syncDb, till.tenantId, (tx) => readDrainProgressSync(tx, { selfNodeId: till.nodeId, carrierNodeId: carrier, enrolments: ALL_SYNC_ENROLMENTS }))`.
  7. Build `wipeDatabase = () => { const admin = await createPostgresDb(WAITRON_MAINTENANCE_DATABASE_URL); try { await dropAndCreateDatabase({ admin, database: dbName }); } finally { await admin.driver.end(); } }`.
  8. Build `restore = () => restoreFromArtifact({ artifact, recoveryKey, databaseUrl: WAITRON_RESTORE_DATABASE_URL, mediaDir, stateDir, stagingDir, migrationsRoot, modules: ALL_MODULES, environment, skipSecrets: true, log })` (resolve the dirs exactly as `restore-command.ts`).
  9. Keep `appDb` and `syncDb` open through the guard phase (`rejoinAsSecondary` reads `node_membership` from `appDb` and the drain snapshot from `syncDb`), and supply `closePreWipe = () => Promise.all([appDb.driver.end(), syncDb.driver.end()]).then(() => {})` — the orchestrator (Task 3) awaits it after the last guard and before `wipeDatabase`, so our connections are gone before the FORCE drop. Do NOT close them in a `finally` that races the wipe; the orchestrator owns the ordering.
  10. Report the orchestrator's error by the same namespaced-code logic `runRestore` uses (add `rejoin.` to the recognised prefixes alongside `restore.`/`recovery.`/`backup.`), never echoing `.message`; success prints `restored <path> (streaming from <carrier>)` and returns 0.

- [ ] **Step 4: Run to verify they pass** — `pnpm --filter @waitron/server test rejoin-command rejoin.test` → PASS.

- [ ] **Step 5: Add the bin + package.json entry** — `bin-rejoin.ts` mirrors `bin-restore.ts` (`/* v8 ignore */`, `runRejoin(...).then((c) => process.exit(c))`); add `"waitron-rejoin": "./dist/bin-rejoin.js"` to `apps/server/package.json`'s `bin` map beside `waitron-restore`. Run `pnpm --filter @waitron/server build` (or `typecheck`) to confirm wiring.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/rejoin-command.ts apps/server/src/bin-rejoin.ts apps/server/src/rejoin.ts apps/server/src/rejoin.test.ts apps/server/src/rejoin-command.test.ts apps/server/package.json
git commit -s -m "feat(server): waitron-rejoin CLI (wipe-and-restore rejoin-as-secondary)"
```

---

### Task 5: End-to-end real-Postgres integration

Prove the whole flow on a real container: a "diverged" DB + a baseline artifact → the DB matches the baseline, media restored, **own-identity secrets untouched**, staging cleaned, **fiscal immutability survives** (the BR-3 receipt shape, re-pinned).

**Files:**
- Test: `apps/server/src/rejoin-e2e.rls.test.ts`

**Interfaces:**
- Consumes: `runRejoin` (Task 4) OR `rejoinAsSecondary` wired to the real `dropAndCreateDatabase`+`restoreFromArtifact`; BR-3's artifact-building helpers (`packArchive`/`encryptArtifact`/`buildManifest`); `createPostgresDb`; the fiscal schema migrations.

- [ ] **Step 1: Write the failing e2e test**

```typescript
describe("R3 rejoin-as-secondary (real Postgres, end to end)", () => {
  it("wipes the diverged db, restores the baseline (skipping secrets), and preserves fiscal immutability", async () => {
    // ARRANGE
    //  - a maintenance conn (postgres db) + a privileged role
    //  - a "baseline" db: migrate it, insert a registros_facturacion row (the primary's chain),
    //    pg_dump it, pack {manifest.json, db.dump, media/<sha>.jpg, secrets/secrets.env}, encrypt → artifact
    //  - a "diverged" target db: migrate it, insert DIFFERENT rows; write a KNOWN identity secret into stateDir
    //  - a held node_membership marking SELF sell-only under a serving-primary carrier; a drained sync_cursor
    // ACT: run the rejoin flow (env pointed at the maintenance/target/sync/app URLs; skipSecrets path)
    // ASSERT:
    expect(/* target now has the baseline's registros row, NOT the diverged rows */).toBe(true);
    expect(await readFile(join(mediaDir, "<sha>.jpg"))).toEqual(BASELINE_MEDIA);
    expect(await readFile(join(stateDir, "identity.key"), "utf8")).toBe(OWN_IDENTITY); // untouched
    await expect(stat(join(stagingDir, "db.dump"))).rejects.toMatchObject({ code: "ENOENT" });
    // fiscal immutability restored active: a post-restore UPDATE is rejected
    const fresh = await createPostgresDb(targetUrl);
    await expect(fresh.execute(sql`update registros_facturacion set huella = 'x'`))
      .rejects.toMatchObject({ code: "WT001" }); // the inmutabilidad trigger
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then iterate the ARRANGE plumbing until the ASSERTs are the only failures, then confirm the flow makes them pass. `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test rejoin.e2e` → PASS.

- [ ] **Step 3: Negative control** — run the same flow against a diverged DB that is NOT drained (`sync_cursor` behind the tail) and confirm it refuses `rejoin.not_drained` and the target db is UNTOUCHED (the diverged rows are still there — the wipe never ran). Prove the guard actually protects data end to end.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/rejoin-e2e.rls.test.ts
git commit -s -m "test(server): R3 rejoin end-to-end — restore baseline, keep identity, fiscal immutability holds"
```

---

### Task 6: Docs — backlog + spec pointers (land-time)

**Files:**
- Modify: `docs/backlog.md` (Slice 6 row + backup-regime row: mark wipe-and-restore LANDED, note the fiscal-lane seam)
- Modify: `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` (dated pointer at §6 step 4: "mechanism supplied by the R3 wipe-and-restore slice")

- [ ] **Step 1** Add the dated pointer to the wire-protocol §6 step 4 and update the two backlog rows (this is part of the landing change, per CLAUDE.md §6 — "update the backlog in the same change that makes it stale"). Do NOT self-land; hand to the owner for sign-off.

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md
git commit -s -m "docs: R3 wipe-and-restore mechanism pointer + backlog"
```

---

## Self-Review

**Spec coverage:**
- §2 end-state (restored + still fenced) — Task 3 returns without un-fencing; Task 5 asserts the restored state; the reboot-into-fence is R1 (#214), unchanged.
- §3.1 end state / §3.2 operator CLI / §3.3 wipe DROP+CREATE / §3.4 fiscal-via-drain — Tasks 3/4/2 and the `not_drained` guard (Task 3) + e2e negative control (Task 5).
- §4 guard ladder (no `carrier_changed`) — Task 3 (three guards, proven by deletion).
- §4.4 `skipSecrets` reuse of the up-front pass — Task 1.
- §5 fiscal safety = drain guarantee, lane-agnostic — Task 3 uses `readDrainProgress` unchanged; e2e negative control proves refusal; the fiscal-lane seam needs no R3 code (noted, Task 6).
- §6 components — Tasks 1–4 create exactly the named files; reused modules imported, not modified (except restore.ts's one field).
- §7 testing — Tasks 2/5 real-PG, guards proven by deletion, fiscal-immutability re-pinned, full `apps/server` suite unfiltered in the gate.
- §8 no migration — confirmed; nothing in the plan touches `drizzle/`.

**Placeholder scan:** the ARRANGE plumbing in Task 5 is described procedurally rather than as literal code because it composes many existing helpers (container start, migrate, dump, pack, encrypt) whose signatures live in BR-3's tests; the implementer copies them from `restore.test.ts`/`backup-sweep` tests. Every other step carries real code.

**Type consistency:** `RejoinDeps`/`RejoinResult`/`rejoinAsSecondary` names match across Tasks 3–5; Task 4 step 9 explicitly amends `RejoinDeps` (adds `closePreWipe`) with its own test — flagged so the two tasks stay consistent. `dropAndCreateDatabase({ admin, database })`, `restoreFromArtifact({ …, skipSecrets })`, `readDrainProgress(db, { selfNodeId, carrierNodeId, enrolments })` match their source signatures verified against the tree.
