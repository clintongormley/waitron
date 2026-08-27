# Sync cloud-mirror — sub-project A: per-peer identity & auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each sync subscriber its own identity (a DB-backed `sync_peers` registry + bearer token) so the source derives a caller's `subscriberId` from its token instead of trusting the request body — closing the `/sync-api/cursor` forge gap that lets any shared-token holder advance any subscriber's cursor into silent, unrecoverable retention data loss.

**Architecture:** A node-level `sync_peers` table (no `tenant_id`, no RLS — operational identity like `sync_cursor`), an enrolment core in `packages/sync` reusing the identity scrypt (`hashSecret`/`verifySecret`) and the `${id}.${secret}` bearer shape that `print_agents` already uses, a `waitron-sync-peer` CLI (the `waitron-sync-evict` shape), and a `sync-api.ts` rewrite that authenticates every route against the registry and derives `subscriberId` from the authenticated peer. The shared `WAITRON_SYNC_NODE_TOKEN` is retired (nothing is deployed, so no back-compat is owed).

**Tech Stack:** TypeScript, Drizzle (`sql` template — parameterised), `node:crypto` scrypt via `@waitron/identity`, Hono (sync-api), Vitest with the shared-container real-Postgres tier (`useTemplateDb` + `connectAs`).

**Spec:** `docs/superpowers/specs/2026-08-27-sync-cloud-mirror-peer-identity-design.md` — read it alongside this plan.

## Global Constraints

- **Coverage thresholds:** `statements 98 / lines 98 / functions 98 / branches 95` for both `apps/server` and `packages/sync`. Run `pnpm --filter <pkg> test:coverage` (CI shards run coverage, not plain `test`), and run each package's suite **unfiltered** before believing a pass (cross-cutting guards do not load under a name-filter).
- **Real Postgres, not PGlite, for anything touching roles/grants** — PGlite connects as a superuser and cannot show the `sync_tailer`-vs-`sync_retention` grant split or a column-level grant. The `@waitron/sync` and `apps/server` real-PG tiers use `const postgres = useTemplateDb({ template: "manifest" })` and connect role-scoped via `postgres.pg.connectAs("<login>", "<pw>")`. Existing login roles: `app_login/app_pw` (app_user), `sync_reader/rp` (sync_tailer), `sync_applier/ap` (app_user+sync_tailer), `sync_pruner/pp` (sync_retention), `tailer_login/tp` (sync_tailer). `sync_pruner`/`tailer_login` exist in `packages/sync` global-setup only; `apps/server` global-setup has `app_login`/`sync_reader`/`sync_applier`. `postgres.admin` is the superuser seeding connection.
- **Write no crypto** — reuse `hashSecret`/`verifySecret` from `@waitron/identity`.
- **Never build SQL by concatenation** — every interpolated value binds via the `sql` template (CLAUDE.md §3).
- **No new error code** — reuse the existing `sync.node_unauthorized` (params `Record<string, never>`, mapped to 401 by the sync-api boundary) for every auth failure. Every code-throwing file does `import "./errors.js"` (the tree-wide reachability guard).
- **English fixtures only** in `packages/sync/src` and `apps/server` test data (the english-only guard).
- **`TESTCONTAINERS_RYUK_DISABLED=true`** must be set locally or real-PG suites hang to the 180s timeout (CLAUDE.md §4).
- **Every commit `git commit -s`.**

---

### Task 1: The `sync_peers` migration (table + grants)

**Files:**
- Create: `packages/sync/drizzle/0005_sync_peers.sql`
- Modify: `packages/sync/drizzle/meta/_journal.json` (add the idx-5 entry)
- Create: `packages/sync/drizzle/meta/0005_snapshot.json` (a byte copy of `0004_snapshot.json` — a raw-SQL table drizzle-kit cannot diff, the 0001-copies-0000 convention)
- Test: `packages/sync/src/peers.grants.test.ts`

**Interfaces:**
- Produces: a `sync_peers` table (`id uuid PK`, `subscriber_id text`, `name text`, `token_hash text`, `active boolean`, `last_seen_at timestamptz`, `enrolled_at timestamptz`) with grants: `sync_tailer` → `SELECT`, `UPDATE (last_seen_at)`; `sync_retention` → `SELECT, INSERT, UPDATE`. No `tenant_id`, no RLS. Consumed by Tasks 2/3 (the core) and 5 (the endpoint).

- [ ] **Step 1: Write the failing grant test**

`packages/sync/src/peers.grants.test.ts` — connect role-scoped and assert each grant, with negative controls. Follow `capture.gate.test.ts` for the `useTemplateDb`/`connectAs` boilerplate.

```typescript
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

const postgres = useTemplateDb({ template: "manifest" });

describe("sync_peers grants", () => {
  it("sync_retention can INSERT/SELECT/UPDATE but NOT DELETE", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      const ins = await pruner.execute<{ id: string }>(
        sql`insert into sync_peers (subscriber_id, name, token_hash)
            values ('peerA', 'Peer A', 'scrypt$aa$bb') returning id`,
      );
      const id = ins.rows[0]!.id;
      await pruner.execute(sql`update sync_peers set active = false where id = ${id}::uuid`);
      const sel = await pruner.execute(sql`select 1 from sync_peers where id = ${id}::uuid`);
      expect(sel.rows.length).toBe(1);
      await expect(
        pruner.execute(sql`delete from sync_peers where id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await pruner.close();
    }
  });

  it("sync_tailer can SELECT and UPDATE(last_seen_at) but NOT flip active, INSERT or DELETE", async () => {
    // Seed a row as admin (superuser bypasses grants for setup).
    const seeded = await postgres.admin.execute<{ id: string }>(
      sql`insert into sync_peers (subscriber_id, name, token_hash)
          values ('peerB', 'Peer B', 'scrypt$aa$bb') returning id`,
    );
    const id = seeded.rows[0]!.id;
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const sel = await tailer.execute(sql`select 1 from sync_peers where id = ${id}::uuid`);
      expect(sel.rows.length).toBe(1);
      // last_seen_at write is allowed (column grant)
      await tailer.execute(sql`update sync_peers set last_seen_at = now() where id = ${id}::uuid`);
      // flipping active is refused (column grant does not cover it)
      await expect(
        tailer.execute(sql`update sync_peers set active = false where id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        tailer.execute(
          sql`insert into sync_peers (subscriber_id, name, token_hash) values ('x','x','x')`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        tailer.execute(sql`delete from sync_peers where id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await tailer.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.grants`
Expected: FAIL — `relation "sync_peers" does not exist`.

- [ ] **Step 3: Write the migration**

`packages/sync/drizzle/0005_sync_peers.sql`:

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles or
-- grants, so none of this survives a later `generate`; 0005_snapshot.json is a byte copy of 0004's
-- (a raw-SQL table drizzle-kit cannot diff, the 0001-copies-0000 convention). Runs in
-- migrations.manifest.json's `sync` set after 0000-0004, so sync_tailer (0000) and sync_retention
-- (0001) already exist.
--
-- WHAT THIS BUILDS. Per-peer subscriber identity for the sync source (spec
-- docs/superpowers/specs/2026-08-27-sync-cloud-mirror-peer-identity-design.md §4/§5). One node-level
-- table binding each subscriber's bearer token to a fixed subscriber_id, so the source derives
-- identity from the token, never from the request body. NO tenant_id and NO RLS: peer identity is
-- whole-DB operational state like sync_cursor (0000_sync_outbox.sql:95-99), which also keeps it out
-- of the fiscal inmutabilidad FORCE-RLS scan by construction (that scan keys on a tenant_id column).
CREATE TABLE sync_peers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id text        NOT NULL,
  name          text        NOT NULL,
  token_hash    text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  enrolled_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- The auth path (the sync-api pool, a sync_tailer member) reads sync_peers. SELECT for the token
-- lookup; a COLUMN-level UPDATE(last_seen_at) for the sighting write ONLY, so the hot auth path can
-- never flip `active` (the revocation control). Deliberately narrower than app_user's full UPDATE on
-- print_agents — least privilege on a distrusting-peer boundary (spec §5).
GRANT SELECT ON sync_peers TO sync_tailer;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON sync_peers TO sync_tailer;
--> statement-breakpoint

-- The operator/CLI path (waitron-sync-peer) connects as a sync_retention member — the role
-- waitron-sync-evict already uses. SELECT/INSERT/UPDATE for enrol/revoke/list. NO DELETE: a peer is
-- deactivated (active := false), never hard-deleted, matching print_agents and the sync_log/sync_cursor
-- grant discipline (0001/0003).
GRANT SELECT, INSERT, UPDATE ON sync_peers TO sync_retention;
```

Then append to `packages/sync/drizzle/meta/_journal.json`'s `entries` array:

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1786492800005,
      "tag": "0005_sync_peers",
      "breakpoints": true
    }
```

And `cp packages/sync/drizzle/meta/0004_snapshot.json packages/sync/drizzle/meta/0005_snapshot.json`.

- [ ] **Step 4: Run the grant test + the migrations manifest test to verify green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.grants` → PASS.
Run: `pnpm --filter @waitron/migrations test` → PASS (the journal/manifest stays consistent; if a journal-vs-sql-files test exists it now agrees).

- [ ] **Step 5: Commit**

```bash
git add packages/sync/drizzle/0005_sync_peers.sql packages/sync/drizzle/meta/ packages/sync/src/peers.grants.test.ts
git commit -s -m "feat(sync): sync_peers table + least-privilege grants (cloud-mirror A)"
```

---

### Task 2: Enrolment core — `enrolPeer` + `authenticatePeer`

**Files:**
- Create: `packages/sync/src/peers.ts`
- Modify: `packages/sync/src/index.ts` (export the verbs)
- Test: `packages/sync/src/peers.test.ts`

**Interfaces:**
- Consumes: the `sync_peers` table (Task 1); `hashSecret`/`verifySecret` from `@waitron/identity`.
- Produces:
  - `enrolPeer(db: Database, input: { subscriberId: string; name: string }): Promise<{ peerId: string; token: string }>` — `token` is `${peerId}.${secret}`.
  - `authenticatePeer(db: Database, token: string): Promise<{ subscriberId: string }>` — throws `AppError("sync.node_unauthorized", {})` on any failure.

- [ ] **Step 1: Write the failing tests**

`packages/sync/src/peers.test.ts` (real-PG; `connectAs("sync_pruner","pp")` for enrol, `connectAs("tailer_login","tp")` for authenticate):

```typescript
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { authenticatePeer, enrolPeer } from "./peers.js";

const postgres = useTemplateDb({ template: "manifest" });

describe("enrolPeer + authenticatePeer", () => {
  it("mints a token that authenticates to its subscriberId", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "DR mirror" });
      expect(token.startsWith(`${peerId}.`)).toBe(true);
      const { subscriberId } = await authenticatePeer(tailer, token);
      expect(subscriberId).toBe("cloud");
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("folds every bad token into one sync.node_unauthorized (no oracle)", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      const bad = [
        "", "no-dot", ".", `${peerId}.`, "not-a-uuid.secret",
        `${peerId}.wrongsecret`,
        "11111111-1111-4111-8111-111111111111.x", // unknown peer, valid uuid
        `${token.slice(0, token.indexOf("."))}.${"a".repeat(43)}`, // right selector, wrong secret
      ];
      for (const t of bad) {
        await expect(authenticatePeer(tailer, t)).rejects.toMatchObject({
          code: "sync.node_unauthorized",
        });
      }
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("refuses a revoked peer instantly", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      await pruner.execute(sql`update sync_peers set active = false where id = ${peerId}::uuid`);
      await expect(authenticatePeer(tailer, token)).rejects.toBeInstanceOf(AppError);
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("records last_seen_at on first auth", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const { peerId, token } = await enrolPeer(pruner, { subscriberId: "cloud", name: "m" });
      await authenticatePeer(tailer, token);
      const r = await pruner.execute<{ last_seen_at: string | null }>(
        sql`select last_seen_at from sync_peers where id = ${peerId}::uuid`,
      );
      expect(r.rows[0]!.last_seen_at).not.toBeNull();
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.test`
Expected: FAIL — `./peers.js` has no export `enrolPeer`.

- [ ] **Step 3: Write `packages/sync/src/peers.ts`**

```typescript
// The per-peer subscriber-identity core for the sync source (spec §6). Reuses the identity scrypt
// (hashSecret/verifySecret) and the ${id}.${secret} bearer shape print-agents use — no crypto is
// written here. Runs directly on the pool: sync_peers has no RLS, so no withTenant, like
// recordSubscriberCursor (cursor-report.ts). Every auth failure folds into one sync.node_unauthorized
// (oracle-free — the response confirms neither a peer's existence nor its revocation state).
import "./errors.js";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { type Database } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";

/** Bytes of entropy in the token's secret half — 256 bits, base64url (the device/print-agent width). */
const TOKEN_BYTES = 32;

/** Anchored UUID shape check for the selector half. A non-uuid selector against the `uuid` column
 * would raise 22P02 -> an opaque 500; a forged bearer must stay a clean sync.node_unauthorized.
 * Re-declared here (not imported) — @waitron/shared's validator is unexported, the agent.ts reason. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnrolPeerInput {
  subscriberId: string;
  name: string;
}

/** Mint a peer's bearer token, store its scrypt hash, return the plaintext ONCE. The token is
 * `${peerId}.${secret}`: a SELECTOR (the row id, needed to fetch the per-row scrypt salt) + a
 * VALIDATOR (the secret authenticatePeer checks). The plaintext leaves this module only here. */
export async function enrolPeer(
  db: Database,
  input: EnrolPeerInput,
): Promise<{ peerId: string; token: string }> {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const res = await db.execute<{ id: string }>(
    sql`insert into sync_peers (subscriber_id, name, token_hash)
        values (${input.subscriberId}, ${input.name}, ${hashSecret(secret)})
        returning id`,
  );
  const peerId = res.rows[0]!.id;
  return { peerId, token: `${peerId}.${secret}` };
}

/** Resolve a presented bearer token to its subscriber_id, or throw sync.node_unauthorized. The
 * `active = true` filter is the revocation control (a revoked peer is simply not found -> instant
 * revoke). verifySecret is constant-time; the secret is never compared with ===. */
export async function authenticatePeer(
  db: Database,
  token: string,
): Promise<{ subscriberId: string }> {
  // Split on the FIRST dot: reject a missing separator, empty selector, or empty secret.
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("sync.node_unauthorized", {});
  const peerId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(peerId)) throw new AppError("sync.node_unauthorized", {});

  const res = await db.execute<{ token_hash: string; subscriber_id: string }>(
    sql`select token_hash, subscriber_id from sync_peers
        where id = ${peerId}::uuid and active = true`,
  );
  const row = res.rows[0];
  if (row === undefined) throw new AppError("sync.node_unauthorized", {});
  if (!verifySecret(secret, row.token_hash)) throw new AppError("sync.node_unauthorized", {});

  // Gated sighting write — skip if already seen within the last minute (the print-agent gate). Only
  // last_seen_at is written, the one column the auth-path role holds UPDATE on.
  await db.execute(
    sql`update sync_peers set last_seen_at = now()
        where id = ${peerId}::uuid
          and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`,
  );
  return { subscriberId: row.subscriber_id };
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/sync/src/index.ts`:

```typescript
// Per-peer subscriber identity for the sync source: mint a peer's bearer token and resolve a
// presented token to its subscriber_id (spec docs/.../2026-08-27-sync-cloud-mirror-peer-identity-design.md).
export { authenticatePeer, enrolPeer } from "./peers.js";
export type { EnrolPeerInput } from "./peers.js";
```

- [ ] **Step 5: Run to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sync/src/peers.ts packages/sync/src/peers.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): enrolPeer + authenticatePeer core (cloud-mirror A)"
```

---

### Task 3: `revokePeer` + `listPeers`

**Files:**
- Modify: `packages/sync/src/peers.ts`
- Modify: `packages/sync/src/index.ts`
- Modify: `packages/sync/src/peers.test.ts`

**Interfaces:**
- Produces:
  - `revokePeer(db: Database, peerId: string): Promise<{ revoked: boolean }>` — `revoked` is whether a row moved from active to inactive (unknown/already-revoked → `false`, never a throw).
  - `listPeers(db: Database): Promise<PeerSummary[]>` where `PeerSummary = { peerId: string; subscriberId: string; name: string; active: boolean; lastSeenAt: string | null; enrolledAt: string }`. Never returns `token_hash`.

- [ ] **Step 1: Write the failing tests** (append to `peers.test.ts`)

```typescript
describe("revokePeer + listPeers + rotation", () => {
  it("revoke flips active and is idempotent; rotation keeps a second token working", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const a = await enrolPeer(pruner, { subscriberId: "cloud", name: "token-1" });
      const b = await enrolPeer(pruner, { subscriberId: "cloud", name: "token-2" }); // rotation overlap
      const first = await revokePeer(pruner, a.peerId);
      expect(first.revoked).toBe(true);
      const again = await revokePeer(pruner, a.peerId);
      expect(again.revoked).toBe(false); // already revoked
      const unknown = await revokePeer(pruner, "11111111-1111-4111-8111-111111111111");
      expect(unknown.revoked).toBe(false);
      // the revoked token is refused, the rotated-in one still authenticates
      await expect(authenticatePeer(tailer, a.token)).rejects.toMatchObject({
        code: "sync.node_unauthorized",
      });
      expect((await authenticatePeer(tailer, b.token)).subscriberId).toBe("cloud");
    } finally {
      await pruner.close();
      await tailer.close();
    }
  });

  it("listPeers reports summaries without the hash", async () => {
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      const { peerId } = await enrolPeer(pruner, { subscriberId: "cloud", name: "DR" });
      const peers = await listPeers(pruner);
      const found = peers.find((p) => p.peerId === peerId);
      expect(found).toMatchObject({ subscriberId: "cloud", name: "DR", active: true });
      expect(JSON.stringify(peers)).not.toMatch(/token_hash|tokenHash/);
    } finally {
      await pruner.close();
    }
  });
});
```

Add `import { authenticatePeer, enrolPeer, listPeers, revokePeer } from "./peers.js";` (extend the existing import).

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.test`
Expected: FAIL — no export `revokePeer`.

- [ ] **Step 3: Implement** (append to `peers.ts`)

```typescript
/** Revoke a peer: active := false. `revoked` is whether a row actually moved (unknown or
 * already-revoked -> false, not an error), so the CLI reports the truth without an exception. A
 * non-uuid id short-circuits to false (it can match nothing). */
export async function revokePeer(db: Database, peerId: string): Promise<{ revoked: boolean }> {
  if (!UUID_RE.test(peerId)) return { revoked: false };
  const res = await db.execute<{ id: string }>(
    sql`update sync_peers set active = false
        where id = ${peerId}::uuid and active = true
        returning id`,
  );
  return { revoked: res.rows.length > 0 };
}

export interface PeerSummary {
  peerId: string;
  subscriberId: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
}

/** All peers, oldest first, for the CLI (and later C's dashboard). Never selects token_hash. */
export async function listPeers(db: Database): Promise<PeerSummary[]> {
  const res = await db.execute<{
    id: string;
    subscriber_id: string;
    name: string;
    active: boolean;
    last_seen_at: string | null;
    enrolled_at: string;
  }>(
    sql`select id, subscriber_id, name, active, last_seen_at, enrolled_at
        from sync_peers order by enrolled_at`,
  );
  return res.rows.map((r) => ({
    peerId: r.id,
    subscriberId: r.subscriber_id,
    name: r.name,
    active: r.active,
    lastSeenAt: r.last_seen_at,
    enrolledAt: r.enrolled_at,
  }));
}
```

Add to `index.ts`: extend the peers export to `export { authenticatePeer, enrolPeer, listPeers, revokePeer } from "./peers.js";` and `export type { EnrolPeerInput, PeerSummary } from "./peers.js";`.

- [ ] **Step 4: Run to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test peers.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sync/src/peers.ts packages/sync/src/peers.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): revokePeer + listPeers (cloud-mirror A)"
```

---

### Task 4: The `waitron-sync-peer` CLI

**Files:**
- Create: `apps/server/src/sync-peer-command.ts`
- Create: `apps/server/src/bin-sync-peer.ts`
- Modify: `apps/server/package.json` (`bin` map + `build` esbuild line)
- Test: `apps/server/src/sync-peer-command.test.ts`

**Interfaces:**
- Consumes: `enrolPeer`/`revokePeer`/`listPeers` from `@waitron/sync` (Tasks 2/3).
- Produces: `syncPeerCommand(deps: { argv: string[]; env: Record<string,string|undefined>; connect: (url: string) => Promise<Database>; out: (line: string) => void }): Promise<number>` — the `evictSubscriberCommand` shape.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/sync-peer-command.test.ts` — hermetic, using a fake `connect`/`out` (the `sync-evict.test.ts` shape; no real DB):

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { syncPeerCommand } from "./sync-peer-command.js";

const RETENTION = { WAITRON_SYNC_RETENTION_DATABASE_URL: "postgres://x" };

describe("syncPeerCommand", () => {
  it("requires WAITRON_SYNC_RETENTION_DATABASE_URL", async () => {
    const code = await syncPeerCommand({
      argv: ["list"], env: {}, connect: async () => ({}) as Database, out: () => {},
    });
    expect(code).toBe(2);
  });

  it("enrol prints the token exactly once and closes the pool", async () => {
    const close = vi.fn(async () => {});
    const execute = vi.fn(async () => ({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }));
    const db = { execute, close } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["enrol", "cloud", "DR", "mirror"],
      env: RETENTION, connect: async () => db, out: (l) => out.push(l),
    });
    expect(code).toBe(0);
    const joined = out.join("\n");
    // the token is <peerId>.<secret>; it appears on exactly one line
    const tokenLines = out.filter((l) => /^11111111-1111-4111-8111-111111111111\.[A-Za-z0-9_-]+$/.test(l));
    expect(tokenLines).toHaveLength(1);
    expect(joined).toMatch(/cloud/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("enrol requires a subscriberId and a name", async () => {
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["enrol", "cloud"], env: RETENTION, connect: async () => ({}) as Database, out: (l) => out.push(l),
    });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/usage/i);
  });

  it("revoke reports false with exit 1 for an unknown peer", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })), close: vi.fn(async () => {}) } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["revoke", "22222222-2222-4222-8222-222222222222"],
      env: RETENTION, connect: async () => db, out: (l) => out.push(l),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no active peer/i);
  });

  it("list prints a placeholder when empty", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })), close: vi.fn(async () => {}) } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({ argv: ["list"], env: RETENTION, connect: async () => db, out: (l) => out.push(l) });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/no peers/i);
  });

  it("an unknown subcommand prints usage and exits 2", async () => {
    const out: string[] = [];
    const code = await syncPeerCommand({ argv: ["frobnicate"], env: RETENTION, connect: async () => ({}) as Database, out: (l) => out.push(l) });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/usage/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test sync-peer-command`
Expected: FAIL — `./sync-peer-command.js` not found.

- [ ] **Step 3: Implement `sync-peer-command.ts`**

```typescript
import { enrolPeer, listPeers, revokePeer } from "@waitron/sync";
import { type Database } from "@waitron/db";

type Env = Record<string, string | undefined>;

/**
 * The operator-run peer registry CLI (spec §7). A human runs this locally against the source node to
 * enrol a subscriber (minting its bearer token, printed ONCE), revoke one (instant — active := false),
 * or list them. Connects as the sync_retention member (WAITRON_SYNC_RETENTION_DATABASE_URL), the role
 * waitron-sync-evict uses. The evictSubscriberCommand shape: pure deps for the process wrapper to fill.
 */
export async function syncPeerCommand(deps: {
  argv: string[];
  env: Env;
  connect: (url: string) => Promise<Database>;
  out: (line: string) => void;
}): Promise<number> {
  const url = deps.env.WAITRON_SYNC_RETENTION_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    deps.out("WAITRON_SYNC_RETENTION_DATABASE_URL is not set");
    return 2;
  }
  const [cmd, ...rest] = deps.argv;

  if (cmd === "enrol") {
    const subscriberId = rest[0];
    const name = rest.slice(1).join(" ");
    if (subscriberId === undefined || subscriberId.length === 0 || name.length === 0) {
      deps.out("usage: waitron-sync-peer enrol <subscriberId> <name>");
      return 2;
    }
    const db = await deps.connect(url);
    try {
      const { peerId, token } = await enrolPeer(db, { subscriberId, name });
      deps.out(`enrolled peer ${peerId} for subscriber ${subscriberId}`);
      deps.out("token (shown once — copy it into the peer's WAITRON_SYNC_PEERS now):");
      deps.out(token);
      return 0;
    } finally {
      await db.close();
    }
  }

  if (cmd === "revoke") {
    const peerId = rest[0];
    if (peerId === undefined || peerId.length === 0) {
      deps.out("usage: waitron-sync-peer revoke <peerId>");
      return 2;
    }
    const db = await deps.connect(url);
    try {
      const { revoked } = await revokePeer(db, peerId);
      deps.out(revoked ? `revoked peer ${peerId}` : `no active peer ${peerId}`);
      return revoked ? 0 : 1;
    } finally {
      await db.close();
    }
  }

  if (cmd === "list") {
    const db = await deps.connect(url);
    try {
      const peers = await listPeers(db);
      if (peers.length === 0) {
        deps.out("no peers enrolled");
        return 0;
      }
      for (const p of peers) {
        deps.out(
          `${p.peerId}  ${p.subscriberId}  ${p.active ? "active" : "revoked"}  ` +
            `last-seen ${p.lastSeenAt ?? "never"}  ${p.name}`,
        );
      }
      return 0;
    } finally {
      await db.close();
    }
  }

  deps.out("usage: waitron-sync-peer <enrol <subscriberId> <name> | revoke <peerId> | list>");
  return 2;
}
```

- [ ] **Step 4: Add the process wrapper + wire the bin**

`apps/server/src/bin-sync-peer.ts`:

```typescript
#!/usr/bin/env node
import { createPostgresDb } from "@waitron/db";
import { syncPeerCommand } from "./sync-peer-command.js";

/* v8 ignore start -- process wiring, exercised by an operator not a unit test */
syncPeerCommand({
  argv: process.argv.slice(2),
  env: process.env,
  connect: createPostgresDb,
  out: (line) => process.stdout.write(`${line}\n`),
}).then((code) => process.exit(code));
/* v8 ignore stop */
```

In `apps/server/package.json`, add to the `bin` map (beside `waitron-sync-evict`):

```json
"waitron-sync-peer": "./dist/bin-sync-peer.js"
```

and append to the `build` script's esbuild chain (mirroring the `bin-sync-evict.ts` line):

```
&& esbuild src/bin-sync-peer.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/bin-sync-peer.js --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @waitron/server test sync-peer-command` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sync-peer-command.ts apps/server/src/bin-sync-peer.ts apps/server/src/sync-peer-command.test.ts apps/server/package.json
git commit -s -m "feat(server): waitron-sync-peer enrol/revoke/list CLI (cloud-mirror A)"
```

---

### Task 5: sync-api rewrite — derive `subscriberId` from the peer, drop the body field

**Files:**
- Modify: `apps/server/src/sync-api.ts`
- Modify: `apps/server/src/boot.ts` (drop `nodeTokens` from the `mountSyncApi` deps)
- Modify: `apps/server/src/sync-api.rls.test.ts` (+ any sync-api auth test) to the peer-token model
- Test: `apps/server/src/sync-api.rls.test.ts` (add the forge-gap regression)

**Interfaces:**
- Consumes: `authenticatePeer`, `enrolPeer` from `@waitron/sync`; the `sync_peers` table + grants.
- Produces: `SyncApiDeps` **without** `nodeTokens`; `POST /sync-api/cursor` that ignores any body `subscriberId` and uses the authenticated peer's.

- [ ] **Step 1: Write the failing forge-gap regression test**

Add to `apps/server/src/sync-api.rls.test.ts` (the suite already has `const postgres = useTemplateDb({ template: "manifest" })`; import `enrolPeer` from `@waitron/sync` and `seedTenant`):

```typescript
it("a peer can advance ONLY its own cursor — the body cannot name another subscriber (forge gap closed)", async () => {
  const tenantId = await seedTenant(postgres.admin);
  // Enrol two peers as admin (setup bypasses grants).
  const x = await enrolPeer(postgres.admin, { subscriberId: "peerX", name: "X" });
  await enrolPeer(postgres.admin, { subscriberId: "peerY", name: "Y" });

  const pool = await postgres.pg.connectAs("sync_reader", "rp"); // a sync_tailer member
  try {
    const app = new Hono();
    mountSyncApi(app, { db: pool, tenantId, nodeId: NODE_A, environment: "production" }, log);

    // peerX presents its token but tries to move peerY's cursor via the (removed) body field.
    const res = await app.request("/sync-api/cursor", {
      method: "POST",
      headers: { Authorization: `Bearer ${x.token}`, "content-type": "application/json" },
      body: JSON.stringify({ subscriberId: "peerY", lane: "ordered", lastAppliedSeq: "999" }),
    });
    expect(res.status).toBe(200);

    // peerY's cursor was NEVER created; peerX's advanced to 999.
    const y = await postgres.admin.execute(
      sql`select 1 from sync_cursor where subscriber_id = 'peerY' and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
    );
    expect(y.rows.length).toBe(0);
    const xc = await postgres.admin.execute<{ s: string }>(
      sql`select last_applied_seq::text as s from sync_cursor where subscriber_id = 'peerX' and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
    );
    expect(xc.rows[0]!.s).toBe("999");
  } finally {
    await pool.close();
  }
});
```

Also update the existing node-token auth test (`"refuses a missing, blank or wrong Bearer token with 401"`) to reflect that `deps` no longer carries `nodeTokens`: keep the throwing-db 401 cases (no token / blank Bearer / non-Bearer scheme still fail before any DB work), and drop the `{ Authorization: "Bearer wrong" }` case from the throwing-db block (a wrong-but-present token now needs a DB lookup) — move a "wrong token → 401" assertion into a DB-backed case that enrols a peer and presents a garbage token.

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api`
Expected: FAIL — `mountSyncApi` still reads `nodeTokens`/the body `subscriberId`; `deps` type still requires `nodeTokens`.

- [ ] **Step 3: Rewrite `sync-api.ts`**

Replace `requireNodeTokens` with `requirePeer`, drop `nodeTokens` from `SyncApiDeps`, import `authenticatePeer`, and change the three routes. Key edits:

```typescript
import { authenticatePeer, encodeBatch, readSyncLogSince, recordSubscriberCursor, tablesForLane, type SyncLane } from "@waitron/sync";

export interface SyncApiDeps {
  db: Database; // a sync_tailer-member pool: reads sync_peers/sync_log and writes sync_cursor
  tenantId: string;
  nodeId: string;
  environment: string;
}

/** Bearer guard: resolve the caller to its enrolled peer, or 401. A missing/blank Bearer fails closed
 * BEFORE any DB work (the empty-secret posture); every other failure folds into sync.node_unauthorized
 * inside authenticatePeer, so a revoked peer fails instantly with no oracle. */
async function requirePeer(db: Database, c: Context): Promise<{ subscriberId: string }> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (token.length === 0) throw new AppError("sync.node_unauthorized", {});
  return authenticatePeer(db, token);
}
```

`/sync-api/hello` and `/sync-api/log`: replace `requireNodeTokens(c, deps.nodeTokens);` with `await requirePeer(deps.db, c);` (they need only that the caller is a valid peer). `/sync-api/cursor` becomes:

```typescript
app.post("/sync-api/cursor", (c) =>
  run(c, log, async () => {
    const { subscriberId } = await requirePeer(deps.db, c);
    const body = (await c.req.json().catch(() => ({}))) as {
      lane?: unknown;
      lastAppliedSeq?: unknown;
    };
    await recordSubscriberCursor(deps.db, {
      subscriberId, // derived from the authenticated token — NEVER the body (spec §2/§8)
      originId: deps.nodeId, // stamp OUR origin; never trust a peer-supplied one
      lane: laneParam(typeof body.lane === "string" ? body.lane : undefined),
      lastAppliedSeq: afterSeq(typeof body.lastAppliedSeq === "string" ? body.lastAppliedSeq : undefined),
    });
    return c.body(null, 200);
  }),
);
```

Delete `requireNodeTokens` and its doc block. Update the `mountSyncApi` header comment (it no longer speaks of a node-token set). Keep the error boundary `run = createErrorBoundary({ "sync.node_unauthorized": 401 }, "sync-api")` unchanged.

In `boot.ts`, drop `nodeTokens: syncConfig.nodeTokens,` from the `mountSyncApi` deps object (leave `syncConfig.nodeTokens` in place for now — Task 6 removes it from config). Update the boot sync-wiring comment that mentions "node-token-authenticated".

- [ ] **Step 4: Run to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api` → PASS.
Prove-by-deletion (do NOT commit): temporarily set `subscriberId` in the `/cursor` route back to the body value — the forge-gap test must FAIL (peerY's cursor created at 999). Restore.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync-api.ts apps/server/src/boot.ts apps/server/src/sync-api.rls.test.ts
git commit -s -m "feat(server): derive sync subscriberId from the peer token, drop the cursor body field (cloud-mirror A)

Closes the /sync-api/cursor forge gap: a peer can now advance only its own
cursor, so a distrusting subscriber cannot drag retention pruning across
another subscriber's unapplied rows."
```

---

### Task 6: Retire `WAITRON_SYNC_NODE_TOKEN` / `nodeTokens` and the stale docs

**Files:**
- Modify: `apps/server/src/config.ts` (remove `tokenSet`, the `nodeTokens` field, the `WAITRON_SYNC_NODE_TOKEN` read)
- Modify: `apps/server/src/config.test.ts` (drop the token-set tests)
- Modify: any remaining reference (`sync-http.ts`/`sync-http.test.ts`, boot tests) surfaced by grep
- Modify: `docs/backlog.md` (the "Cloud-mirror peer" thread — A is landing)

**Interfaces:**
- Consumes: nothing new. Produces: a `SyncTransportConfig` with no `nodeTokens`; a tree with no `WAITRON_SYNC_NODE_TOKEN`.

- [ ] **Step 1: Find every reference (the receipt before the edit)**

Run and record the hits:
```bash
grep -rn "WAITRON_SYNC_NODE_TOKEN\|nodeTokens\|tokenSet\|requireNodeTokens" apps packages docs --include="*.ts" --include="*.md"
```
Expected after this task: only historical/dated doc mentions remain (a spec that records what was true when written keeps its history — CLAUDE.md §6); no live code reference.

- [ ] **Step 2: Update `config.test.ts` first (red)**

Remove the tests that assert `WAITRON_SYNC_NODE_TOKEN`/`tokenSet` behaviour (the blank-member `config_invalid`, the required-when-peers-set assertions). Adjust any `loadSyncConfig` happy-path test that asserts `nodeTokens` in the returned object to no longer expect it, and drop `WAITRON_SYNC_NODE_TOKEN` from the env those tests set. Run:
```bash
pnpm --filter @waitron/server test config
```
Expected: FAIL to compile/typecheck until Step 3 removes the field.

- [ ] **Step 3: Remove from `config.ts`**

Delete the `tokenSet` function; remove `nodeTokens: string[];` from `SyncTransportConfig` (and its doc paragraph); remove the `nodeTokens: tokenSet(env, "WAITRON_SYNC_NODE_TOKEN"),` line from `loadSyncConfig`. Update `loadSyncConfig`'s header comment: the source now authenticates peers against the `sync_peers` registry, and `WAITRON_SYNC_PEERS[].token` (the subscriber side) is unchanged — a token a `waitron-sync-peer enrol` minted on the source it dials.

- [ ] **Step 4: Sweep remaining references**

Re-run the Step-1 grep; fix any live hit (e.g. `sync-http.ts`/boot tests that set `WAITRON_SYNC_NODE_TOKEN` in a fixture env, or a boot comment naming the node-token). Update `docs/backlog.md`'s "Cloud-mirror peer" bullet to note sub-project A (per-peer identity + auth) is landing on `feat/sync-peer-identity`, with B (tunnel) and C (read-mirror) still ahead.

- [ ] **Step 5: Run the full gate for the touched packages**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage
pnpm lint && pnpm typecheck && pnpm format:check
```
Expected: all green; coverage ≥ thresholds; grep clean of live references.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts apps/server/src/sync-http.ts docs/backlog.md
git commit -s -m "refactor(server): retire WAITRON_SYNC_NODE_TOKEN — the sync source authenticates peers against sync_peers (cloud-mirror A)"
```

---

## Self-Review

**Spec coverage:**
- §2 forge gap → Task 5 (regression test proves it closed).
- §4 data model → Task 1.
- §5 grants/roles (incl. the read-back with negative controls) → Task 1 test.
- §6 enrolment core → Tasks 2 (enrol/authenticate) + 3 (revoke/list).
- §7 CLI → Task 4.
- §8 sync-api rewrite → Task 5.
- §9 config → Task 6.
- §10 out of scope (tunnel, read-serving, dining_tables, multi-tenant) → not built here, by design.
- §11 testing (real-PG, prove-by-deletion, negative controls, rotation, CLI, coverage) → distributed across tasks; prove-by-deletion in Task 5 Step 4.
- §12 security review → run at finish (a review pass on the branch), not a plan task.
- §13 doc retirement → Task 5 (comments on files touched) + Task 6 (config/boot/backlog + grep clean).

**Placeholder scan:** none — every step carries real SQL/TS/test code.

**Type consistency:** `enrolPeer → { peerId, token }`, `authenticatePeer → { subscriberId }`, `revokePeer → { revoked }`, `listPeers → PeerSummary[]` (`{ peerId, subscriberId, name, active, lastSeenAt, enrolledAt }`) — used identically in the CLI (Task 4), the endpoint (Task 5), and the tests. `sync.node_unauthorized` (existing code) is the only thrown code. `SyncApiDeps` loses `nodeTokens` in Task 5; Task 6 removes the now-dead `nodeTokens`/`tokenSet`/`WAITRON_SYNC_NODE_TOKEN` from config, so no consumer references a removed name across the task boundary.
