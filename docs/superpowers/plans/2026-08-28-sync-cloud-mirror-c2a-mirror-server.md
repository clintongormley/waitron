# Sync cloud-mirror C2a — the mirror-mode server (the mechanism) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/server` a third boot path — `deployment.mode = 'mirror'` — that pulls the 17 commercial tables from a primary through B's tunnel, applies them into its own Postgres, and serves the dashboard read-only (every write refused at runtime), while running none of the primary-only workers.

**Architecture:** A new `deployment.mode` column (`primary`|`mirror`), read once at boot into a refreshable holder. In mirror mode, boot installs two middlewares in front of the reused user-facing route surface — a method-based read-only gate (non-GET → `node.read_only` 403) and an ambient read-only viewer session (so the existing session gates pass with no login) — runs `runSyncPull` with `tunnelHttpClient` instead of `fetchHttpClient`, and skips the sync source, retention sweep, tunnel client, and the fiscal drain/reconcile loop.

**Tech Stack:** TypeScript, Hono, Drizzle, `pg`, PostgreSQL 18 (Testcontainers for real-PG suites; PGlite for role-free unit suites), Vitest, `@waitron/sync` (`runSyncPull`), `@waitron/tunnel` (`runTunnelClient` + relay stand-in), `apps/server/src/tunnel-http.ts` (`tunnelHttpClient`).

**Spec:** `docs/superpowers/specs/2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **Pre-production, no backfill / no back-compat** (CLAUDE.md §3): schema changes drop/recreate; the new column defaults so existing deployments are unchanged. No data migration.
- **Real Postgres, not PGlite, for anything touching roles/RLS/apply-under-FORCE-RLS** (CLAUDE.md §4): the `app_user`/`sync_tailer` split and the ambient viewer seed under RLS need real PG. `TESTCONTAINERS_RYUK_DISABLED=true` locally. A role-free unit suite (the gate middleware, the config loader) may use the lighter target with a comment saying why.
- **No new grant, no new role** (spec §9): the mirror's pool is the existing `app_user`+`sync_tailer` member; `deployment` read is the existing table-wide `GRANT SELECT ON deployment TO app_user`. Every `GRANT` claim is verified by reading the ACL back, both directions (CLAUDE.md §3) — `app_user` must NOT hold INSERT/UPDATE on `deployment`.
- **Error codes name the domain concept and are never renamed once shipped** (CLAUDE.md §3): the write-gate code is `node.read_only` (the `node.*` family — sibling `node.not_found`; `server.*` is process facts). Grep the `node.` siblings before adding it.
- **No SQL by string concatenation** (CLAUDE.md §3): every `sql` template binds its values; the one migration is static literals over fixed identifiers.
- **A claim of necessity carries a receipt** (CLAUDE.md §1): every "must"/"cannot" in a comment cites a `file:line` or a run.
- **Coverage:** `apps/server` and `@waitron/db` keep 98/98/98/95; run `pnpm --filter <pkg> test:coverage` (CI runs coverage, not plain `test`) AND the whole `apps/server` + `@waitron/db` suites **unfiltered** (cross-cutting guards do not load under a name filter).
- **Commit every step with `-s`** (CLAUDE.md §6).
- **Next `packages/db` migration number is `0067`** (0064/0065/0066 are the current highest). Renumber if a sibling branch takes it first.

---

### Task 1: `deployment.mode` — column, migration, accessors, grant read-back

**Files:**
- Modify: `packages/db/src/schema/deployment.ts` — add the `mode` column + CHECK.
- Create: `packages/db/drizzle/0067_deployment_mode.sql` — the ALTER (hand-written custom, like 0010).
- Modify: `packages/db/src/deployment.ts` — add `DeploymentMode`, `readDeploymentMode`, `setDeploymentMode`.
- Test: `packages/db/src/deployment.test.ts` — accessor + CHECK + grant read-back (extend the existing file).

**Interfaces:**
- Produces:
  - `type DeploymentMode = "primary" | "mirror"` (in `packages/db/src/deployment.ts`, re-exported from the package barrel `packages/db/src/index.ts` beside `DeploymentEnvironment`/`readDeploymentEnvironment`).
  - `readDeploymentMode(db: Database): Promise<DeploymentMode>` — `"primary"` when the table/row is absent (an unstamped DB is a primary).
  - `setDeploymentMode(db: Database, mode: DeploymentMode): Promise<void>` — a plain `UPDATE deployment SET mode WHERE id = 1`; owner-role write (app_user holds no UPDATE). Mutable by design (promotion), so NO "already stamped" guard, unlike `stampDeployment`.

- [ ] **Step 1: Write the failing accessor test**

Add to `packages/db/src/deployment.test.ts` (it already boots a real-PG database and runs migrations — follow its existing `describe`/setup). Use the SAME harness the file uses for `readDeploymentEnvironment`:

```ts
it("readDeploymentMode returns 'primary' by default and 'mirror' after setDeploymentMode", async () => {
  // Fresh migrated DB, unstamped: an unstamped database is a primary.
  expect(await readDeploymentMode(db)).toBe("primary");
  await stampDeployment(db, "preproduction"); // creates the id=1 row
  expect(await readDeploymentMode(db)).toBe("primary"); // default on the new row
  await setDeploymentMode(db, "mirror");
  expect(await readDeploymentMode(db)).toBe("mirror");
  await setDeploymentMode(db, "primary"); // promotion is a legitimate reverse
  expect(await readDeploymentMode(db)).toBe("primary");
});

it("the mode CHECK rejects any value outside primary/mirror", async () => {
  await stampDeployment(db, "preproduction");
  await expect(
    db.execute(sql`update deployment set mode = 'bogus' where id = 1`),
  ).rejects.toThrow(/deployment_mode_ck|23514/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/db test deployment`
Expected: FAIL — `readDeploymentMode`/`setDeploymentMode` are not exported; the CHECK does not exist.

- [ ] **Step 3: Add the column to the schema object**

In `packages/db/src/schema/deployment.ts`, add `mode` and its CHECK (keep the "not in the barrel" doc comment intact):

```ts
export const deployment = pgTable(
  "deployment",
  {
    id: integer("id").primaryKey(),
    environment: text("environment").notNull(),
    // Which role this database plays in the cloud-mirror topology (C2a design §3): a `primary`
    // writes and originates; a `mirror` pulls + applies and serves read-only. Read at runtime so a
    // later promotion needs no restart. Default 'primary' so every existing deployment is unchanged.
    mode: text("mode").notNull().default("primary"),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deployment_singleton_ck", sql`${t.id} = 1`),
    check("deployment_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
  ],
);
```

- [ ] **Step 4: Write the migration**

Create `packages/db/drizzle/0067_deployment_mode.sql`:

```sql
-- Which ROLE this database plays in the cloud-mirror topology (C2a design §3). A `primary` writes and
-- originates; a `mirror` pulls + applies a primary's rows and serves read-only (writes refused at the
-- HTTP layer; deployment.mode read at runtime so a later promotion needs no restart). One row, ever
-- (0010's singleton CHECK). Default 'primary' so every existing deployment is unchanged — pre-production,
-- no backfill (CLAUDE.md §3). Read by app_user through the table-wide SELECT 0010 already granted (a
-- table-level GRANT covers future columns); the WRITE (stamp-mirror, promote) is an OWNER-role write —
-- app_user holds no INSERT/UPDATE on deployment, which the grant read-back test asserts. No new grant.
ALTER TABLE "deployment" ADD COLUMN "mode" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_mode_ck" CHECK ("deployment"."mode" in ('primary', 'mirror'));
```

Note: the `db` migration set globs its directory (the C1 slice added `packages/sync/drizzle/0006` with no manifest edit); a new numbered file is auto-included. Verify by running the migrations below — do NOT edit `migrations.manifest.json` unless the run says the file was skipped.

- [ ] **Step 5: Add the accessors**

In `packages/db/src/deployment.ts`, below `stampDeployment`:

```ts
/** Which role this database plays — a `primary` writes and originates; a `mirror` pulls + applies and
 * serves read-only (C2a design §3). Narrowed to the two-value union for the same reason
 * `DeploymentEnvironment` is: an unrepresentable value is a `tsc` error, not a runtime CHECK violation. */
export type DeploymentMode = "primary" | "mirror";

/** The role this database plays, or `"primary"` when nothing has been stamped — an unstamped database
 * is a primary. Same `to_regclass` probe (not a caught undefined-table error) `readDeploymentEnvironment`
 * uses and for the same reason: a failed statement would poison the caller's transaction. */
export async function readDeploymentMode(db: Database): Promise<DeploymentMode> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return "primary";
  const rows = await db.execute<{ mode: DeploymentMode }>(
    sql`select mode from deployment where id = 1`,
  );
  return rows.rows[0]?.mode ?? "primary";
}

/** Sets this database's role. Mutable by design — a mirror is PROMOTED to a primary (design §10) — so,
 * unlike `stampDeployment`'s immutable environment, there is no "already stamped" guard. An OWNER-role
 * write: `app_user` holds no UPDATE on `deployment` (the grant read-back asserts it), so this runs on the
 * provisioning/owner connection, never the app pool. Requires the singleton row (stamp the environment
 * first) — a 0-row UPDATE is a silent no-op on an unstamped DB, which never happens for a real mirror. */
export async function setDeploymentMode(db: Database, mode: DeploymentMode): Promise<void> {
  await db.execute(sql`update deployment set mode = ${mode} where id = 1`);
}
```

Add `readDeploymentMode`, `setDeploymentMode`, and `type DeploymentMode` to `packages/db/src/index.ts`'s exports beside the existing deployment exports.

- [ ] **Step 6: Run the accessor + CHECK tests**

Run: `pnpm --filter @waitron/db test deployment`
Expected: PASS.

- [ ] **Step 7: Write the grant read-back test (proven both directions)**

Add to `packages/db/src/deployment.test.ts`. Model the ACL read-back on the existing sync grant tests (`packages/sync/src/peers.grants.test.ts`) — connect as (or query for) `app_user` and assert `has_table_privilege`:

```ts
it("app_user may SELECT deployment but may NOT write it (the mode write is owner-only)", async () => {
  const rows = await db.execute<{ sel: boolean; ins: boolean; upd: boolean }>(sql`
    select
      has_table_privilege('app_user', 'deployment', 'SELECT') as sel,
      has_table_privilege('app_user', 'deployment', 'INSERT') as ins,
      has_table_privilege('app_user', 'deployment', 'UPDATE') as upd
  `);
  expect(rows.rows[0]).toEqual({ sel: true, ins: false, upd: false });
});
```

- [ ] **Step 8: Run it and prove the guard by deletion**

Run: `pnpm --filter @waitron/db test deployment`
Expected: PASS. Then, to prove the negative bites: temporarily add `GRANT UPDATE ON "deployment" TO app_user;` to the migration, re-run — the `upd: false` assertion FAILS — then remove it and confirm green.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/deployment.ts packages/db/drizzle/0067_deployment_mode.sql packages/db/src/deployment.ts packages/db/src/index.ts packages/db/src/deployment.test.ts
git commit -s -m "feat(db): deployment.mode (primary|mirror) + accessors for the cloud mirror"
```

---

### Task 2: `node.read_only` + the read-only write gate middleware

**Files:**
- Modify: `apps/server/src/errors.ts` — register `node.read_only`.
- Create: `apps/server/src/read-only-gate.ts` — the middleware + `SAFE_METHODS`.
- Test: `apps/server/src/read-only-gate.test.ts` — a Hono app with the gate (no DB — Hono unit test).

**Interfaces:**
- Consumes: `DeploymentMode` (Task 1).
- Produces: `readOnlyGate(getMode: () => DeploymentMode): MiddlewareHandler` — refuses any non-GET/HEAD/OPTIONS with a `node.read_only` 403 (the error-boundary response shape `{ error: { code, params } }`) when `getMode() === "mirror"`; otherwise calls `next()`. Reads `getMode()` per request (the promotion seam).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/read-only-gate.test.ts`:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readOnlyGate } from "./read-only-gate.js";
import type { DeploymentMode } from "@waitron/db";

function appWith(mode: () => DeploymentMode): Hono {
  const app = new Hono();
  app.use("*", readOnlyGate(mode));
  app.get("/thing", (c) => c.json({ ok: true }));
  app.post("/thing", (c) => c.json({ wrote: true }));
  return app;
}

describe("readOnlyGate", () => {
  it("refuses a non-GET with node.read_only 403 when the node is a mirror", async () => {
    const res = await appWith(() => "mirror").request("/thing", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });

  it("lets a GET through on a mirror", async () => {
    const res = await appWith(() => "mirror").request("/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets every method through on a primary", async () => {
    const res = await appWith(() => "primary").request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrote: true });
  });

  it("reads the mode per request (the promotion seam)", async () => {
    const holder = { current: "mirror" as DeploymentMode };
    const app = appWith(() => holder.current);
    expect((await app.request("/thing", { method: "POST" })).status).toBe(403);
    holder.current = "primary"; // promote — no re-mount
    expect((await app.request("/thing", { method: "POST" })).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test read-only-gate`
Expected: FAIL — `./read-only-gate.js` does not exist.

- [ ] **Step 3: Register the error code**

In `apps/server/src/errors.ts`, add to the `node.*` region of the type map (beside `node.not_found`), with a doc comment in the house style:

```ts
    /**
     * A write reached a node running as a read-only MIRROR. The mirror serves the dashboard read-only
     * and pulls + applies a primary's rows; it refuses every non-GET at the HTTP layer (the read-only
     * gate, `read-only-gate.ts`), because `deployment.mode = 'mirror'`. `node.*`, not `server.*`: it is a
     * fact about the node's role in the topology, not about the process. No params — the refusal names no
     * row, so a log line leaks nothing (the `sync.*`/`tunnel.*` discipline). Cleared by promotion
     * (`deployment.mode = 'primary'`), read live so no restart is needed.
     */
    "node.read_only": Record<string, never>;
```

- [ ] **Step 4: Write the middleware**

Create `apps/server/src/read-only-gate.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import type { DeploymentMode } from "@waitron/db";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/** GET/HEAD/OPTIONS are the read verbs the dashboard uses; everything else is a write on this surface
 * (a method survey across report-api/me-api/catalogue-api/schedule-api found no read behind a non-GET
 * verb — C2a design §5). OPTIONS is a CORS preflight and carries no body. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses every write when this node is a read-only mirror. `getMode` is read PER REQUEST (not captured
 * once) so a later promotion — `deployment.mode = 'primary'` + a refresh of the holder boot passes in —
 * opens every write route live, no restart (design §10). On a primary it is a pure pass-through.
 *
 * Returns the error-boundary response shape directly (`{ error: { code, params } }`, `error-boundary.ts`)
 * rather than throwing, because a Hono middleware is not inside a route's `createErrorBoundary` wrapper —
 * the code is built through `AppError` so `tsc` checks it is a real code and `import "./errors.js"` keeps
 * it reachable.
 */
export function readOnlyGate(getMode: () => DeploymentMode): MiddlewareHandler {
  return async (c, next) => {
    if (getMode() === "mirror" && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
```

- [ ] **Step 5: Run the tests + prove by deletion**

Run: `pnpm --filter @waitron/server test read-only-gate`
Expected: PASS. Then delete the `!SAFE_METHODS.has(...)` clause (refuse nothing) — the "refuses a non-GET" test FAILS — restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/errors.ts apps/server/src/read-only-gate.ts apps/server/src/read-only-gate.test.ts
git commit -s -m "feat(server): node.read_only write gate for mirror mode"
```

---

### Task 3: The ambient read-only viewer session (seed + middleware)

**Files:**
- Create: `apps/server/src/mirror-session.ts` — the viewer/session ensure + the cookie middleware.
- Test: `apps/server/src/mirror-session.rls.test.ts` — real-PG (persons/management_sessions under RLS as `app_user`).

**Interfaces:**
- Consumes: `withTenant` (`@waitron/db`), `setManagementCookie`/`MANAGEMENT_COOKIE`/`readManagementSessionId` (`./management-session.js`), `resolveManagementSession` (`@waitron/identity`, for the test).
- Produces:
  - `MIRROR_VIEWER_PERSON_ID`, `MIRROR_VIEWER_SESSION_ID: string` (fixed UUID constants).
  - `ensureMirrorViewer(db: Database, tenantId: string): Promise<void>` — idempotent seed of the viewer person (role `admin`, unusable pin hash) + a live ambient management session.
  - `mirrorSession(db: Database, tenantId: string, secure: boolean): MiddlewareHandler` — per request: keep the ambient session live (upsert `last_seen_at = now()`, `ended_at = null`) and set the management cookie to `MIRROR_VIEWER_SESSION_ID` when the request carries none.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/mirror-session.rls.test.ts`. Use the real-PG lifecycle helper the sibling RLS suites use (`useRealPostgres` / the app pool as an `app_user` member; see `apps/server/src/me-api.rls.test.ts` for the exact harness + how it seeds a tenant). Seed a tenant first (the viewer's FK), then:

```ts
it("ensureMirrorViewer seeds an admin viewer + a live session that resolves", async () => {
  await ensureMirrorViewer(db, tenantId);
  const person = await withTenant(db, tenantId, (tx) =>
    tx.execute(sql`select role, display_name, length(pin_hash) > 0 as has_pin
                   from persons where id = ${MIRROR_VIEWER_PERSON_ID}`),
  );
  expect(person.rows[0]).toMatchObject({ role: "admin", display_name: "mirror viewer", has_pin: true });

  const resolved = await withTenant(db, tenantId, (tx) =>
    resolveManagementSession(tx, MIRROR_VIEWER_SESSION_ID),
  );
  expect(resolved).toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID, role: "admin" });
});

it("ensureMirrorViewer is idempotent (a second call does not throw or duplicate)", async () => {
  await ensureMirrorViewer(db, tenantId);
  await ensureMirrorViewer(db, tenantId);
  const n = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ c: string }>(sql`select count(*)::text as c from persons where id = ${MIRROR_VIEWER_PERSON_ID}`),
  );
  expect(n.rows[0]?.c).toBe("1");
});

it("mirrorSession keeps the session live: a keepalive refreshes last_seen_at", async () => {
  await ensureMirrorViewer(db, tenantId);
  const before = await readLastSeen(); // helper: select last_seen_at where id = MIRROR_VIEWER_SESSION_ID
  await new Promise((r) => setTimeout(r, 15));
  // Drive the middleware once against a bare Hono context (see me-api.test.ts for building a test Context),
  // OR call the exported keepalive it wraps; assert last_seen_at advanced and the cookie was set.
  const res = await appWithMirrorSession().request("/thing"); // GET
  expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
  const after = await readLastSeen();
  expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test mirror-session`
Expected: FAIL — `./mirror-session.js` does not exist.

- [ ] **Step 3: Write the module**

Create `apps/server/src/mirror-session.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import { withTenant, type Database } from "@waitron/db";
import { MANAGEMENT_COOKIE, readManagementSessionId, setManagementCookie } from "./management-session.js";

/** Fixed, stable ids so the seed is idempotent (upsert on a known PK) and the middleware can name the
 * ambient session without a lookup. Valid v4-shaped UUIDs; arbitrary but MUST never change (the seed
 * keys on them). Distinct high bytes so they are recognizable as the mirror viewer in a `persons` /
 * `management_sessions` dump. */
export const MIRROR_VIEWER_PERSON_ID = "acce55ed-0000-4000-8000-000000000001";
export const MIRROR_VIEWER_SESSION_ID = "acce55ed-0000-4000-8000-000000000002";

/** A pin hash that no PIN can ever verify against (scrypt parse fails → `false`). The viewer never logs
 * in — the mirror gates every login POST shut (§5) — but `persons.pin_hash` is NOT NULL with a length>0
 * CHECK, so it needs a non-empty, deliberately-unusable value. */
const UNUSABLE_PIN_HASH = "mirror-viewer-never-logs-in";

/**
 * Ensures the mirror's ambient read-only viewer exists: one `admin` person (every permission, so every
 * gated dashboard read passes `authorizeManager` — the §5 gate is what enforces read-only, not this
 * role) and one live management session for it. Idempotent — safe to call on every boot. Runs under the
 * mirror's tenant as `app_user` (which already holds INSERT/UPDATE on both tables; no new grant).
 */
export async function ensureMirrorViewer(db: Database, tenantId: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into persons (id, tenant_id, display_name, pin_hash, role, status)
      values (${MIRROR_VIEWER_PERSON_ID}, ${tenantId}, 'mirror viewer', ${UNUSABLE_PIN_HASH}, 'admin', 'active')
      on conflict (id) do nothing
    `);
    await tx.execute(sql`
      insert into management_sessions (id, tenant_id, person_id)
      values (${MIRROR_VIEWER_SESSION_ID}, ${tenantId}, ${MIRROR_VIEWER_PERSON_ID})
      on conflict (id) do update set last_seen_at = now(), ended_at = null
    `);
  });
}

/**
 * Per-request ambient auth for the mirror's dashboard. Keeps the ambient session live (so
 * `resolveManagementSession`'s sliding-window expiry never turns an idle mirror's first request into a
 * 401) and, when the request carries no management cookie, sets it to the ambient session — so the
 * browser never sees a login screen and the existing `requireManagementSession` gates resolve a real,
 * live session. The keepalive is an internal SQL write inside the request; it is NOT an HTTP write, so the
 * read-only gate (which gates the HTTP verb) does not block it — the reason a read-only DB role was
 * rejected (§3).
 */
export function mirrorSession(db: Database, tenantId: string, secure: boolean): MiddlewareHandler {
  return async (c, next) => {
    await withTenant(db, tenantId, (tx) =>
      tx.execute(sql`update management_sessions set last_seen_at = now(), ended_at = null
                     where id = ${MIRROR_VIEWER_SESSION_ID}`),
    );
    if (readManagementSessionId(c) === null) {
      setManagementCookie(c, MIRROR_VIEWER_SESSION_ID, secure);
    }
    return next();
  };
}
```

- [ ] **Step 4: Run the tests + prove by deletion**

Run: `pnpm --filter @waitron/server test mirror-session`
Expected: PASS. Then delete the keepalive `update` in `mirrorSession` — the "keeps the session live" test FAILS (last_seen_at does not advance) — restore and confirm green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mirror-session.ts apps/server/src/mirror-session.rls.test.ts
git commit -s -m "feat(server): ambient read-only viewer session for the mirror dashboard"
```

---

### Task 4: The mirror connection config loader

**Files:**
- Modify: `apps/server/src/config.ts` — add `MirrorConfig` + `loadMirrorConfig`.
- Test: `apps/server/src/config.test.ts` — extend (follow the existing `loadTunnelConfig` tests' shape).

**Interfaces:**
- Produces:
  - `interface MirrorConfig { ca: string; servername: string }` — the two `tunnelHttpClient` inputs (§7). `ca` is the box's CA cert PEM (read from a file); `servername` is the box hostname the cert is validated against.
  - `loadMirrorConfig(env: Env): MirrorConfig | undefined` — `undefined` when neither var is set; a partial set is a loud `server.config_invalid`; an empty value is refused (the empty-string trap, CLAUDE.md §3). The pull PEERS come from the existing `loadSyncConfig` (`WAITRON_SYNC_PEERS`, `url` = the relay, `token` = the per-peer sync token).

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/config.test.ts` (write a temp CA file with `mkdtempSync` + `writeFileSync`; see how the file already sets up env objects for `loadTunnelConfig`):

```ts
it("loadMirrorConfig reads the box CA file + hostname when both are set", () => {
  const dir = mkdtempSync(join(tmpdir(), "mirror-ca-"));
  const caPath = join(dir, "box-ca.pem");
  writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n");
  const cfg = loadMirrorConfig({
    WAITRON_MIRROR_BOX_CA_FILE: caPath,
    WAITRON_MIRROR_BOX_HOSTNAME: "box.test",
  });
  expect(cfg).toEqual({ ca: expect.stringContaining("BEGIN CERTIFICATE"), servername: "box.test" });
});

it("loadMirrorConfig is undefined when neither var is set", () => {
  expect(loadMirrorConfig({})).toBeUndefined();
});

it("loadMirrorConfig fails closed on a partial set", () => {
  expect(() => loadMirrorConfig({ WAITRON_MIRROR_BOX_HOSTNAME: "box.test" })).toThrow(
    /server\.config_invalid|WAITRON_MIRROR_BOX_CA_FILE/,
  );
});

it("loadMirrorConfig refuses an empty hostname", () => {
  const dir = mkdtempSync(join(tmpdir(), "mirror-ca-"));
  const caPath = join(dir, "box-ca.pem");
  writeFileSync(caPath, "x");
  expect(() =>
    loadMirrorConfig({ WAITRON_MIRROR_BOX_CA_FILE: caPath, WAITRON_MIRROR_BOX_HOSTNAME: "" }),
  ).toThrow(/server\.config_invalid/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test config`
Expected: FAIL — `loadMirrorConfig` is not exported.

- [ ] **Step 3: Implement `loadMirrorConfig`**

In `apps/server/src/config.ts`, beside `loadTunnelConfig`, using the same `isUnset`/`required` helpers and `readFileSync` (already imported in this file's ecosystem; import from `node:fs` if not present):

```ts
export interface MirrorConfig {
  /** The box's CA certificate PEM — the trust anchor `tunnelHttpClient` validates the box's TLS leaf
   * against (`tunnel-http.ts`). Read from WAITRON_MIRROR_BOX_CA_FILE. */
  ca: string;
  /** The box hostname the cert is checked against (SNI + `checkServerIdentity`) — WAITRON_MIRROR_BOX_HOSTNAME. */
  servername: string;
}

/**
 * The mirror's link to its primary through B's tunnel: the box CA + box hostname `tunnelHttpClient`
 * needs (§7). The pull PEERS (relay address + per-peer token) come from `loadSyncConfig`
 * (WAITRON_SYNC_PEERS) — a mirror sets `url` to the RELAY and `token` to the sync peer token. Both
 * vars required together (fail-closed, the `loadTunnelConfig`/`loadSyncConfig` posture); an empty value
 * is refused — the empty-string trap (CLAUDE.md §3). Absent → `undefined` (a non-mirror sets neither).
 * NOTE: this is C2a's ENV config; C2b moves it to DB-stored, wizard-entered config.
 */
export function loadMirrorConfig(env: Env): MirrorConfig | undefined {
  const caFile = env.WAITRON_MIRROR_BOX_CA_FILE;
  const hostname = env.WAITRON_MIRROR_BOX_HOSTNAME;
  if (isUnset(caFile) && isUnset(hostname)) return undefined;
  if (isUnset(caFile)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MIRROR_BOX_CA_FILE",
      reason: "required_with_mirror_hostname",
    });
  }
  if (isUnset(hostname)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MIRROR_BOX_HOSTNAME",
      reason: "required_with_mirror_ca",
    });
  }
  return { ca: readFileSync(caFile, "utf8"), servername: hostname };
}
```

(Confirm `readFileSync` is imported at the top of `config.ts`; if not, add `import { readFileSync } from "node:fs";`. Confirm the `server.config_invalid` param shape `{ variable, reason }` matches its `errors.ts` declaration — it does, per `loadSyncConfig` above it.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): loadMirrorConfig (box CA + hostname) for mirror pull"
```

---

### Task 5: Boot — the mirror fork (serve read-only, skip primary workers)

**Files:**
- Modify: `apps/server/src/boot.ts` — the TRADING branch (from ~588): read the mode, install the two middlewares, branch the sync/tunnel/loop wiring.
- Test: `apps/server/src/boot.mirror.rls.test.ts` — real-PG boot in mirror mode (pull pointed at an unreachable dummy so it backs off; the SERVING + gate + worker-absence are what this task proves; the real tunnel pull is Task 6).

**Interfaces:**
- Consumes: `readDeploymentMode` (Task 1), `readOnlyGate` (Task 2), `ensureMirrorViewer`/`mirrorSession` (Task 3), `loadMirrorConfig` (Task 4), `tunnelHttpClient` (`./tunnel-http.js`), the existing `runSyncPull`/`fetchHttpClient`/`mountSyncApi`/`runTunnelClient`/`runRetentionSweep`.
- Produces: no new exported symbol — boot behaviour only.

Implement these fork points inside the trading branch (line numbers are the current tree; anchor by the quoted code, not the number):

- [ ] **Step 1: Write the failing boot test**

Create `apps/server/src/boot.mirror.rls.test.ts`. Model setup on `apps/server/src/sync-e2e.rls.test.ts` + `boot.test.ts`: a real-PG database migrated, **seeded with matching identity** (a `tenants`/`locations`/`nodes`/`tills`/`invoice_series` row set — reuse the seed helpers those suites use), `stampDeployment(owner, "preproduction")` then `setDeploymentMode(owner, "mirror")`, and `WAITRON_TILL_*_ID` env pointing at the seeded ids. Point `WAITRON_SYNC_PEERS` at an unreachable URL (the pull backs off; boot still serves) and set `WAITRON_MIRROR_BOX_CA_FILE`/`WAITRON_MIRROR_BOX_HOSTNAME` to a throwaway CA + hostname. Boot, then:

```ts
it("mirror boot serves a dashboard GET unauthenticated and refuses a POST", async () => {
  const started = await startServer(mirrorEnv, ...); // the file's boot harness
  // A gated read works with NO login cookie (the ambient viewer):
  const read = await fetch(`${base}/management-api/...GET-report-route...`);
  expect(read.status).toBe(200);
  // A write is refused by the gate:
  const write = await fetch(`${base}/management-api/...POST-mutation...`, { method: "POST", body: "{}" });
  expect(write.status).toBe(403);
  expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  await started.close();
});

it("mirror boot does not mount the sync source route", async () => {
  const started = await startServer(mirrorEnv, ...);
  const res = await fetch(`${base}/sync-api/hello`, { method: "GET" }); // source route
  expect(res.status).toBe(404); // not mounted on a mirror
  await started.close();
});
```

(Pick the concrete GET-report and POST-mutation routes from `report-api.ts` / `catalogue-api.ts` when writing the test; the ambient viewer is `admin` so any gated read resolves.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test boot.mirror`
Expected: FAIL — mirror mode is not wired; the GET 401s (no ambient session) or the POST is not gated, and `/sync-api/hello` may be mounted.

- [ ] **Step 3: Read the mode + build the refreshable holder**

In the trading branch, right after the `ring` load (after the `loadKeyRing` try/catch, ~line 617), add:

```ts
// Which role this database plays (C2a design §4). A mirror pulls + applies and serves read-only; a
// primary is today's flow. Read ONCE here into a refreshable holder so a later promotion
// (deployment.mode='primary') flips the read-only gate live, no restart (design §10). The pool is
// already open, so this DB read is free.
const modeHolder = { current: await readDeploymentMode(db) };
const isMirror = modeHolder.current === "mirror";
```

- [ ] **Step 4: Install the mirror middlewares before the mounts**

Immediately after Step 3 (still before `mountWebhook` at ~643), add:

```ts
// On a mirror, front the whole user-facing surface with the read-only gate (non-GET → node.read_only
// 403) and the ambient viewer session (so the existing management-session gates pass with no login).
// Registered BEFORE the mounts below so Hono wraps them; `/health` (registered before this branch) is
// deliberately not wrapped — it is a GET and must answer in every mode. A primary installs neither.
if (isMirror) {
  app.use("*", readOnlyGate(() => modeHolder.current));
  await ensureMirrorViewer(db, config.till.tenantId);
  app.use("*", mirrorSession(db, config.till.tenantId, config.tls !== undefined));
}
```

- [ ] **Step 5: Branch the sync block (skip source + retention; tunnel http on a mirror)**

In the sync block (~814): load `loadMirrorConfig(env)` beside `loadSyncConfig(env)`; a mirror REQUIRES it (loud if absent). Then:
- guard `mountSyncApi(...)` with `if (!isMirror)` — a mirror is a subscriber, not a source (§8).
- choose the pull HTTP client: `const syncHttp = isMirror && mirrorConfig !== undefined ? tunnelHttpClient({ ca: mirrorConfig.ca, servername: mirrorConfig.servername }) : fetchHttpClient;` and pass `http: syncHttp` into `runLane`'s `runSyncPull`.
- guard the whole retention block with `if (!isMirror && syncConfig.retentionDatabaseUrl !== undefined)` (a mirror holds no `sync_log`, so it prunes nothing — §8); keep the `else` `sync.retention_unconfigured` warn for a primary only.

```ts
const mirrorConfig = loadMirrorConfig(env);
if (isMirror && mirrorConfig === undefined) {
  await db.close();
  throw new AppError("server.config_invalid", {
    variable: "WAITRON_MIRROR_BOX_CA_FILE",
    reason: "mirror_requires_box_ca_and_hostname",
  });
}
// ...inside the `if (syncConfig !== undefined)` block:
if (!isMirror) {
  mountSyncApi(app, { db: syncDb, tenantId: till.tenantId, nodeId: till.nodeId, environment: config.environment }, log);
}
const syncHttp = isMirror && mirrorConfig !== undefined
  ? tunnelHttpClient({ ca: mirrorConfig.ca, servername: mirrorConfig.servername })
  : fetchHttpClient;
// runLane: pass `http: syncHttp` where it currently passes `http: fetchHttpClient`.
```

Note: a mirror still needs `WAITRON_SYNC_PEERS` set (its one peer = the primary via the relay), so `syncConfig !== undefined` on a mirror; the plan's test sets it. If a mirror somehow has no `syncConfig`, it serves but never pulls — acceptable (loud pull-off is a primary concern); do not add a second gate here.

- [ ] **Step 6: Skip the tunnel client on a mirror**

The tunnel CLIENT dials OUT from the box (§8) — a mirror never does. Guard the tunnel block (~936): `if (!isMirror && tunnelConfig !== undefined) { tunnelWorker = runTunnelClient(...) }`. Leave the `else` `tunnel.disabled` log for a primary; a mirror logs nothing here (it is not a tunnel-client host).

- [ ] **Step 7: Replace the fiscal loop with a health-only pass on a mirror**

The main loop (~983) runs the AEAT `drain` + Stripe `reconcile` duties — a mirror files and settles nothing (§8), and running them would contact AEAT/Stripe. Keep the loop (so `close()`'s `await loop` and health `recordPass` are unchanged) but give a mirror a trivial healthy pass:

```ts
const loop = runLoop({
  pass: isMirror
    // A mirror runs no fiscal/settlement duties; a trivial empty pass keeps /health advancing
    // (lastPassAt) and stopWork's `await loop` identical. Its "work" is the pull worker (§7).
    ? async () => ({ nextDueAt: null, duties: [] })
    : (at) => runPass({ /* the existing drain/reconcile PassDeps, unchanged */ }, at),
  now, sleep: realSleep, signal: controller.signal,
  minTickMs: config.minTickMs, maxTickMs: config.maxTickMs, log,
  onPass: (report, at) => logDegradedDuties(log, recordPass(health, report, at)),
});
```

(Confirm `PassReport` accepts `nextDueAt: null` — `pass.ts:68`; `recordPass` iterates `report.duties`, so an empty array records a clean pass. If `nextDueAt` must be a `Date`, use a far-future `new Date(now().getTime() + config.maxTickMs)`.)

- [ ] **Step 8: Run the boot test + the worker-absence controls**

Run: `pnpm --filter @waitron/server test boot.mirror`
Expected: PASS — GET read 200 (ambient), POST 403, `/sync-api/hello` 404. Add/confirm an assertion that a `primary` boot of the same tree DOES mount `/sync-api/hello` (the control that the guard is real, not vacuous — prove-by-deletion: flip `isMirror` off and the source-absence test fails).

- [ ] **Step 9: Full server suite (unfiltered) + commit**

Run: `pnpm --filter @waitron/server test:coverage` then the unfiltered `pnpm --filter @waitron/server test` (cross-cutting guards). Fix any boot.test.ts drift (a primary boot must be byte-unchanged — the guards on today's wiring must still pass).

```bash
git add apps/server/src/boot.ts apps/server/src/boot.mirror.rls.test.ts
git commit -s -m "feat(server): mirror boot path — read-only serve, tunnel pull, no primary workers"
```

---

### Task 6: Headline tunnel e2e — the mirror pulls, applies, serves read-only (proven by deletion)

**Files:**
- Create: `apps/server/src/mirror-e2e.rls.test.ts` — real-PG × 2 (primary source + mirror) + the B relay stand-in.

**Interfaces:**
- Consumes everything above plus B's `createRelayStandin` (`@waitron/tunnel/testing/relay.js`), `runTunnelClient` (`@waitron/tunnel`), `tunnelHttpClient`, and the source-side `mountSyncApi` + HTTPS serve (`tls.ts`). Model the composition on `apps/server/src/tunnel-e2e.test.ts` (which already stands up the relay + client + a box HTTPS `sync-api` and drives `runSyncPull` through `tunnelHttpClient`) and `apps/server/src/sync-e2e.rls.test.ts` (the two-DB pull+apply harness).

- [ ] **Step 1: Write the headline e2e**

The faithful end-to-end (design §12). Reuse `tunnel-e2e.test.ts`'s relay/box scaffolding verbatim where possible:

```ts
it("a mirror pulls the primary's sync_log through the tunnel, applies it, and serves it read-only", async () => {
  // PRIMARY: a real-PG source with seeded config identity + seeded sync_log rows (a catalogue/product,
  // say), its HTTPS sync-api behind runTunnelClient + the relay stand-in (tunnel-e2e.test.ts shape).
  // MIRROR: a second real-PG DB, migrated, seeded with the SAME tenant/location/node/till/series ids,
  // stampDeployment(owner,"preproduction") + setDeploymentMode(owner,"mirror"); booted in mirror mode
  // with WAITRON_SYNC_PEERS=[{nodeId: primaryNodeId, url: relayClientUrl, token: peerToken}] and
  // WAITRON_MIRROR_BOX_CA_FILE/HOSTNAME = the box CA + "box.test".

  // 1. The mirror pulls + applies:
  await waitFor(async () => (await mirrorRowCount("products")) === seededProducts.length);
  // 2. The cursor advanced:
  expect(await mirrorCursor()).toBeGreaterThan(0n);
  // 3. A dashboard GET returns the applied data with NO login (the ambient viewer):
  const read = await fetch(`${mirrorBase}/management-api/...products GET...`);
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ /* the applied products */ });
  // 4. A write is refused:
  const write = await fetch(`${mirrorBase}/management-api/...products POST...`, { method: "POST", body: "{}" });
  expect(write.status).toBe(403);
});
```

- [ ] **Step 2: Run to verify it passes (Tasks 1-5 make it green)**

Run: `pnpm --filter @waitron/server test mirror-e2e`
Expected: PASS.

- [ ] **Step 3: Add the three proven-by-deletion controls**

Each control mutates one line, asserts the failure, restores (CLAUDE.md §4). Encode as separate `it`s that programmatically vary the boot (e.g. a `bootMirror({ withGate, withAmbient, mode })` helper), OR document the manual deletion in the test header and add the positive assertions:

1. **Gate:** boot with the read-only gate NOT installed → the `POST` reaches the handler (not 403). (The gate is what makes the node read-only.)
2. **Ambient session:** boot with `mirrorSession` NOT installed → the `GET` returns `management_session.required` 401 instead of data. (The ambient session is what makes it unauthenticated-yet-gated.)
3. **Mode flag:** set `deployment.mode = 'primary'` on the mirror's DB and boot → the `POST` succeeds and `/sync-api/hello` is mounted. (The flag is the switch, and the promotion-readiness receipt.)

- [ ] **Step 4: Run the whole e2e + commit**

Run: `pnpm --filter @waitron/server test mirror-e2e`
Expected: PASS (all controls).

```bash
git add apps/server/src/mirror-e2e.rls.test.ts
git commit -s -m "test(server): mirror-mode headline e2e — pull through tunnel, apply, read-only serve"
```

---

### Task 7: Prose/comment cleanup + full verification

**Files:**
- Modify: `apps/server/src/boot.ts` (fork comments), `packages/db/src/deployment.ts` + `packages/db/drizzle/0010_deployment_stamp.sql` header (mode note), `packages/db/src/schema/nodes.ts` (dated pointer that mirror-vs-primary landed on `deployment.mode`, NOT `nodes.role`), `apps/server/src/config.ts` (mirror env docs).
- Backlog + memory are updated at LAND (per `/land-branch`), not here.

**Interfaces:** none — comments + verification only.

- [ ] **Step 1: Retire/augment the prose the behaviour change touches** (CLAUDE.md §1/§3)

- `nodes.ts:6-8` ("active-active/failover — a `role` column — are later specs"): add a dated pointer — mirror-vs-primary landed on `deployment.mode` (2026-08-28, C2a), so a future reader does not add a second `nodes.role` flag for the same concept.
- `deployment.ts` doc + `0010_deployment_stamp.sql` header: note the singleton now also carries `mode` (mutable, unlike `environment`).
- The boot sync/tunnel/loop comments: state the mirror fork in the same idiom the surrounding comments use.
- Grep the tree for any comment asserting "one node per venue"/"boot serves till + dashboard" that the mirror path now qualifies; add a pointer rather than rewriting history.

- [ ] **Step 2: Run the full local gate**

```bash
pnpm --filter @waitron/db test:coverage
pnpm --filter @waitron/server test:coverage
pnpm --filter @waitron/db test          # unfiltered — teardown/english-only/errors-reachable guards
pnpm --filter @waitron/server test      # unfiltered
pnpm --filter @waitron/fiscal-verifactu test inmutabilidad   # touched no tenant-scoped table, but re-run per CLAUDE.md §3
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: all green. `deployment` has no `tenant_id`, so `inmutabilidad` is unaffected — confirm, don't assume.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -s -m "docs(server,db): mirror-mode comments + prose the change retires"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- §3 `deployment.mode` → Task 1. §4 boot fork → Task 5. §5 write gate → Task 2. §6 ambient session → Task 3. §7 pull-through-tunnel → Tasks 5 (wiring) + 6 (e2e). §8 workers-not-run → Task 5 (skips) + 6 (source-absence control). §9 grants → Task 1 (read-back). §10 promotion-readiness → Task 2 (refreshable holder) + Task 6 control 3. §12 testing → Tasks 1-6. §13 security → the gate matrix (2), grant read-back (1), ambient containment (3). §14 docs → Task 7.
- Connection config (§7, C2a env) → Task 4.

**2. Placeholder scan** — the ONE deliberate placeholder is the two UUID constants in Task 3 Step 3, flagged in-line with an implementer NOTE to paste real literals (they must be stable forever). Migration number `0067` is the verified next number (renumber on collision, noted). No "TBD"/"handle edge cases"/"similar to Task N".

**3. Type consistency** — `DeploymentMode` (Task 1) is the type the gate (2), the boot holder (5), and the accessors consume. `readOnlyGate(getMode)` / `mirrorSession(db, tenantId, secure)` / `ensureMirrorViewer(db, tenantId)` / `loadMirrorConfig(env) → MirrorConfig | undefined` signatures are used identically in Task 5's wiring. `node.read_only` params `Record<string, never>` match the errors.ts registration and the `{ error: { code, params: {} } }` response asserted in Tasks 2/5/6.

**Open items the implementer resolves by TDD (named, not hand-waved):** the exact ambient-session keepalive (upsert vs bump — the plan pins upsert; a test proves it survives the sliding-window expiry); the concrete GET-report / POST-mutation routes chosen for the gate tests; and whether `PassReport.nextDueAt` accepts `null` (Task 5 Step 7 — use a far-future `Date` if not).
