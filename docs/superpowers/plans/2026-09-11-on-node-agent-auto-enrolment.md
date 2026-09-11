# On-node print-agent auto-enrolment (primary box) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A print agent running on the primary box enrols itself silently over loopback — no pairing window, no verification number, no human accept — while a print agent on a separate device keeps today's knock-and-accept unchanged.

**Architecture:** A new loopback-only route `POST /api/node/enrol-self`, mounted beside the always-mounted `GET /api/node`, enrols the caller as a `print_agent` keyed to this node when (a) the connection arrives over loopback and (b) this node is the primary. The agent tries this route against its own `127.0.0.1` before falling back to the existing knock. A revoked on-node agent is refused re-enrolment, so a new "allow again" management action ships alongside to keep that from being a one-way trap.

**Tech Stack:** TypeScript, Hono + `@hono/node-server` (`getConnInfo` for the peer address), Drizzle ORM over PostgreSQL, Vitest (PGlite + real-Postgres Testcontainers), Lit (dashboard).

**Spec:** [docs/superpowers/specs/2026-09-11-on-node-agent-auto-enrolment-design.md](../specs/2026-09-11-on-node-agent-auto-enrolment-design.md)

> **Revised 2026-09-11 after a fresh-context plan-vs-spec review** (7 findings applied): Task 1 retargeted to `printing.test.ts` (no `print-agents.test.ts` exists) using its `asApp`/`seedAgent`/`captureError` harness; Task 3's non-existent status-map step removed (statuses live in each route's local `STATUS`); Task 4 imports corrected to `@waitron/server-kit` (no `./http.js`) and the phantom `shared.invalid_body` replaced with the real `management.request_invalid`; Task 6 given its own status handling (the shared `foldFetch` cannot emit `refused`); Task 7's self-enrol moved ahead of the `anyAccepting` gate so it is independent of the configured server; and a bounded-race note added to `selfEnrolNodeAgent`.

## Global Constraints

- **Built scope is the primary box only.** The mirror half (the vouch, cross-box CA trust) is designed in spec §7 but is NOT built here. Do not add signing, endorsement, nonce, or multi-CA code.
- **Error codes name the domain concept and are never renamed once shipped.** New codes: `node.enrol_not_local`, `node.enrol_unavailable` (in `apps/server/src/errors.ts`, the `node.*` family), `device.join_revoked` (same file, the `device.*` cross-surface join family). Every file that throws a code imports its registry (`import "./errors.js"`).
- **A print-agent bearer token is `${agentId}.${secret}`** where `agentId` is the `print_agents.id` UUID and `secret` is a `randomBytes(32).toString("base64url")` string; `token_hash = hashSecret(secret)` (`@waitron/identity`), verified by `authenticateAgent` (`packages/printing/src/agent.ts`) with an `active = true` revocation filter. Self-enrol MUST mint exactly this shape.
- **A by-id read still needs its own tenant predicate** (CLAUDE.md §3): every query carries `eq(table.tenantId, cfg.tenantId)`. One-tenant-per-database is not the query's isolation boundary.
- **No SQL by string concatenation** — Drizzle parameterises; utility statements (none here) would escape/validate.
- **Verification WEIGHT: FULL.** This diff touches a trust boundary (enrolment), tenant-scoped by-id reads, a core migration, and a cross-package contract (the agent wire). Per-task reviews run, and `/finish-branch` runs the full wave. The run-it seat and the fresh-context plan-vs-spec read are mandatory.
- **The one thing measured on the box, not reasoned about:** that the server sees `127.0.0.1` (or `::1` / `::ffff:127.0.0.1`) as the on-box caller's remote address under `network_mode: host` + TLS, and a *different* address for a LAN caller (Task 9). If it cannot be read reliably, the route refuses (falls back to the manual path).
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Per task, run the changed package's `test:coverage` plus direct dependents; run the whole workspace only for a value more than one package asserts.

---

### Task 1: `print_agents` learns its node

**Files:**
- Modify: `packages/db/src/schema/print-agents.ts` (add `node_id` column + composite unique)
- Create: `packages/db/drizzle/00NN_print_agent_node_id.sql` (generated — exact number assigned by `db:generate`)
- Test: `packages/db/src/schema/printing.test.ts` (extend — this is where the `print_agents` schema tests actually live; there is NO `print-agents.test.ts`)

**Interfaces:**
- Produces: `printAgents.nodeId` (`uuid`, nullable) on the exported `printAgents` table; a composite `unique("print_agents_tenant_node_key").on(tenantId, nodeId)`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/schema/printing.test.ts`, inside the existing `describe`. That file is ALREADY real Postgres (`useTemplateDb({ template: "core" })`) and drives every write as the non-owner `app_user` through its `asApp(tenant, tx => …)` helper, with `TENANT_A`/`LOCATION_A` fixtures, a `seedAgent(tenant, name)` helper (inserts a `print_agents` row with `node_id` NULL), and `captureError`/`pgErrorCode` from `../testing/errors.js`. Use that harness — do NOT introduce a `pg()`/`db.insert` accessor:

```ts
it("allows many NULL node_id agents but at most one per (tenant, node_id)", async () => {
  // Two manual agents (node_id NULL) coexist — NULLS DISTINCT is the Postgres default.
  await seedAgent(TENANT_A, "till A");
  await seedAgent(TENANT_A, "till B");

  const node = "cccccccc-0000-4000-8000-000000000001";
  await asApp(TENANT_A, (tx) =>
    tx.execute(
      sql`insert into print_agents (tenant_id, location_id, name, token_hash, node_id)
          values (${TENANT_A}, ${LOCATION_A}, 'box', ${TOKEN_HASH}, ${node})`,
    ),
  );
  const err = await captureError(() =>
    asApp(TENANT_A, (tx) =>
      tx.execute(
        sql`insert into print_agents (tenant_id, location_id, name, token_hash, node_id)
            values (${TENANT_A}, ${LOCATION_A}, 'box dup', ${TOKEN_HASH}, ${node})`,
      ),
    ),
  );
  expect(pgErrorCode(err)).toBe("23505"); // unique_violation on print_agents_tenant_node_key
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/db test -- printing`
Expected: FAIL — `node_id` is not a column / no such constraint.

- [ ] **Step 3: Add the column and the constraint**

In `packages/db/src/schema/print-agents.ts`, add the column beside `name` and the constraint beside `print_agents_tenant_id_key`:

```ts
    // The node that enrolled this agent over loopback (on-node auto-enrolment design §3), or NULL when
    // a human enrolled it through knock-and-accept (a till, a Pi). NO FK to `nodes`: the primary holds
    // no `nodes` row for a mirror (it endorses the mirror's key and stores nothing — mirror-bundle.ts),
    // so a FK would reject the very mirror self-enrol the follow-up (spec §7) exists to serve. Bare
    // column, reason recorded here per CLAUDE.md §3.
    nodeId: uuid("node_id"),
```

```ts
    // At most one self-enrolled agent per node. Postgres treats NULLs as DISTINCT by default, so the
    // many manual (NULL) agents are unconstrained; only non-NULL node_ids are deduplicated.
    unique("print_agents_tenant_node_key").on(t.tenantId, t.nodeId),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate --name print_agent_node_id`
This is a plain `ALTER TABLE … ADD COLUMN` + `ADD CONSTRAINT`. Table-level grants cover the new column (no custom grant migration needed — `app_user` already holds SELECT/INSERT/UPDATE on `print_agents` at table level). Read the generated SQL and confirm it is only the ADD COLUMN + the UNIQUE; no unexpected drops.

- [ ] **Step 5: Run the db package gate**

Run: `pnpm --filter @waitron/db test:coverage`
Expected: PASS, including the new case, `privileges.test.ts` (grants unchanged), and `migrate-upgrade.pg.test.ts` (a column add is a safe forward migration — not an enum add-value).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/print-agents.ts packages/db/src/schema/print-agents.test.ts packages/db/drizzle/
git commit -s -m "feat(db): print_agents.node_id — one self-enrolled agent per node

Nullable node_id, unique per (tenant, node_id). No FK to nodes: the
primary holds no nodes row for a mirror, so a FK would reject mirror
self-enrol (spec §7). NULLs distinct, so manual agents are unconstrained."
```

---

### Task 2: the self-enrol verb

**Files:**
- Modify: `apps/server/src/join-requests.ts` (add `selfEnrolNodeAgent`, beside `acceptPrintAgentJoinRequest`)
- Test: `apps/server/src/join-requests.test.ts` (real Postgres — the write, the role, and token authentication all matter)

**Interfaces:**
- Consumes: `printAgents`, `hashSecret` (`@waitron/identity`), `randomUUID`/`randomBytes` (`node:crypto`), `TillConfig`, `AppError`.
- Produces: `export async function selfEnrolNodeAgent(tx: Transaction, cfg: TillConfig, input: { nodeId: string; name: string }): Promise<{ agentId: string; token: string }>`.

- [ ] **Step 1: Write the failing tests** (real Postgres)

Add to `apps/server/src/join-requests.test.ts` (reuse the file's tenant/location seeding and its real-PG accessor; import `authenticateAgent` from `@waitron/printing` to prove the minted token works):

```ts
describe("selfEnrolNodeAgent", () => {
  it("mints one agent per node whose token authenticates", async () => {
    const { agentId, token } = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return selfEnrolNodeAgent(tx, cfg, { nodeId, name: "box" });
    });
    // The token is the accept-shape ${id}.${secret} and authenticates as this agent.
    const auth = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return authenticateAgent(tx, { tenantId: cfg.tenantId }, token);
    });
    expect(auth.agentId).toBe(agentId);
  });

  it("is idempotent per node: a second call refreshes the token, keeps one row and the same id", async () => {
    const first = await run(() => selfEnrolNodeAgent(/* …, nodeId, name: "box" */));
    const second = await run(() => selfEnrolNodeAgent(/* …, nodeId, name: "box again" */));
    expect(second.agentId).toBe(first.agentId); // stable id → printer bindings survive
    expect(second.token).not.toBe(first.token); // fresh secret
    const rows = await countAgentsForNode(nodeId);
    expect(rows).toBe(1);
    // The old token no longer authenticates; the new one does.
    await expect(authWith(first.token)).rejects.toThrow(/unauthorized/);
    expect((await authWith(second.token)).agentId).toBe(first.agentId);
  });

  it("refuses a revoked node's re-enrol with device.join_revoked and does NOT reactivate it", async () => {
    const { agentId } = await run(() => selfEnrolNodeAgent(/* …, nodeId */));
    await revoke(agentId); // active := false
    await expect(run(() => selfEnrolNodeAgent(/* …, nodeId */))).rejects.toMatchObject({
      code: "device.join_revoked",
    });
    expect(await isActive(agentId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: FAIL — `selfEnrolNodeAgent` is not exported.

- [ ] **Step 3: Implement the verb**

Add to `apps/server/src/join-requests.ts` (imports `randomUUID` alongside the existing `randomBytes`; `hashSecret` is already imported):

```ts
/**
 * Enrol THIS node's own print agent (on-node auto-enrolment design §1.1, §3). Idempotent per node: a
 * node that has lost its token (a wiped volume, a reinstall) re-asks, and this refreshes the existing
 * row's token rather than inserting a second — so the agent id is stable and its printer bindings
 * survive. A row that has been REVOKED (`active = false`) is NOT silently reactivated: self-enrol
 * refuses with `device.join_revoked` so a deliberate revoke sticks (spec §4); an admin's "allow again"
 * is the only way back. The returned token is the accept-shape `${agentId}.${secret}` so it
 * authenticates through `authenticateAgent` exactly like a knock-and-accept token. By-id/by-node reads
 * carry the tenant predicate (CLAUDE.md §3).
 */
export async function selfEnrolNodeAgent(
  tx: Transaction,
  cfg: TillConfig,
  input: { nodeId: string; name: string },
): Promise<{ agentId: string; token: string }> {
  const secret = randomBytes(32).toString("base64url");
  const tokenHash = hashSecret(secret);

  const [existing] = await tx
    .select({ id: printAgents.id, active: printAgents.active })
    .from(printAgents)
    .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.nodeId, input.nodeId)));

  if (existing !== undefined) {
    if (!existing.active) throw new AppError("device.join_revoked", {});
    await tx
      .update(printAgents)
      .set({ tokenHash })
      .where(and(eq(printAgents.tenantId, cfg.tenantId), eq(printAgents.id, existing.id)));
    return { agentId: existing.id, token: `${existing.id}.${secret}` };
  }

  // First enrol for this node. No advisory lock (unlike createJoinRequest): exactly one agent process
  // runs per box, so two concurrent first-time enrols for the SAME node are not a real shape. If they
  // ever raced, the loser hits the `(tenant, node_id)` unique index as a 23505 and its agent simply
  // re-asks next tick, finding the row and refreshing — no wrong row, no duplicate. That backstop, not
  // a lock, is what keeps the invariant.
  const agentId = randomUUID();
  await tx.insert(printAgents).values({
    id: agentId,
    tenantId: cfg.tenantId,
    locationId: cfg.locationId,
    nodeId: input.nodeId,
    name: input.name,
    tokenHash,
    active: true,
  });
  return { agentId, token: `${agentId}.${secret}` };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/server test -- join-requests`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/join-requests.ts apps/server/src/join-requests.test.ts
git commit -s -m "feat(server): selfEnrolNodeAgent — idempotent per-node enrol, sticking revoke"
```

---

### Task 3: the error codes

**Files:**
- Modify: `apps/server/src/errors.ts` (three codes + status mappings)
- Test: covered by `scripts/errors-reachable.test.ts` (root project) once thrown; typecheck proves the union.

**Interfaces:**
- Produces: codes `node.enrol_not_local`, `node.enrol_unavailable`, `device.join_revoked` on the server error registry.

- [ ] **Step 1: Add the code declarations**

In `apps/server/src/errors.ts`, beside the existing `node.*` entries add:

```ts
    /** `POST /api/node/enrol-self` reached from a non-loopback address. On-node self-enrol is a
     * loopback-only trust gate (design §1.1): anything that can reach the box's loopback can already
     * read its vault, so enrolling a loopback caller grants nothing new; a LAN caller must not. */
    "node.enrol_not_local": Record<string, never>;
    /** This node cannot self-enrol a print agent because it is not the primary — only the primary can
     * write `print_agents` (a mirror's DB is a read-only subscriber). The mirror-today case (spec §7). */
    "node.enrol_unavailable": Record<string, never>;
```

Beside the existing `device.*` join codes add:

```ts
    /** A node's own print agent was revoked; self-enrol refuses to bring it back until an admin's
     * "allow again". Keeps a deliberate revoke from being undone by the agent's next poll (design §4). */
    "device.join_revoked": Record<string, never>;
```

> **No status-map step.** `apps/server/src/errors.ts` only DECLARES codes (declaration merging); it holds no code→HTTP map — every doc comment there says "Mapped to HTTP NNN by `<route>`'s local `STATUS` map, not here". The three new codes' statuses live in `node-enrol-api.ts`'s own `STATUS` object (Task 4). `device.join_revoked` is thrown only by `selfEnrolNodeAgent`, reached only through the enrol route, so no other route's `STATUS` needs it.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @waitron/server typecheck`
Expected: PASS — the three codes are now part of the union the routes will throw.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/errors.ts
git commit -s -m "feat(server): error codes for on-node self-enrol (not_local, unavailable, join_revoked)"
```

---

### Task 4: the loopback self-enrol route + boot mount

**Files:**
- Create: `apps/server/src/node-enrol-api.ts` (`mountNodeEnrolApi`)
- Create: `apps/server/src/node-enrol-api.pg.test.ts`
- Modify: `apps/server/src/boot.ts` (mount beside `mountNodeApi`, outside the `!fencedOrMirror` guard)

**Interfaces:**
- Consumes: `selfEnrolNodeAgent` (Task 2); `getConnInfo` (`@hono/node-server/conninfo`); `withTenant`, `asAppUser`, `Database`; `TillConfig`; `createEnrolRateLimiter` (the same limiter the knock uses); `createErrorBoundary` (`@waitron/server-kit`).
- Produces: `export interface NodeEnrolApiDeps { db: Database; cfg: TillConfig; nodeId: string; isPrimary: boolean; enrolRateLimiter?: EnrolRateLimiter }` and `export function mountNodeEnrolApi(app: Hono, deps: NodeEnrolApiDeps, log: Logger): void` mounting `POST /api/node/enrol-self`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/node-enrol-api.pg.test.ts` (real Postgres — the enrol writes a row; follow `print-agent-e2e.test.ts` / `join-api.pg.test.ts` for app construction and a real request. Drive the peer address by injecting a socket on the request env the way `getConnInfo` reads it — `c.env.incoming.socket.remoteAddress`; the test harness for Hono+node-server sets this, mirror how existing pg tests issue requests):

```ts
it("enrols the caller as a print agent over loopback on the primary", async () => {
  const res = await post("/api/node/enrol-self", { name: "box" }, { remoteAddress: "127.0.0.1" });
  expect(res.status).toBe(201);
  const { token } = await res.json();
  // The token authenticates as a real agent.
  const auth = await authenticate(token);
  expect(auth.agentId).toBeDefined();
});

it("refuses a non-loopback caller with node.enrol_not_local", async () => {
  const res = await post("/api/node/enrol-self", { name: "x" }, { remoteAddress: "192.168.1.50" });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe("node.enrol_not_local");
});

it("accepts IPv6 loopback forms", async () => {
  for (const addr of ["::1", "::ffff:127.0.0.1"]) {
    const res = await post("/api/node/enrol-self", { name: "box" }, { remoteAddress: addr });
    expect(res.status).toBe(201);
  }
});

it("refuses on a non-primary node with node.enrol_unavailable", async () => {
  const res = await post("/api/node/enrol-self", { name: "x" }, { remoteAddress: "127.0.0.1" }, { isPrimary: false });
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe("node.enrol_unavailable");
});

it("rate-limits a flood before touching the DB", async () => {
  // Inject a limiter that throws on the 2nd call; the 2nd request is 429, no row written.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server test -- node-enrol-api`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/server/src/node-enrol-api.ts`:

```ts
import "./errors.js";
import type { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createErrorBoundary, readJsonBody, requireString } from "@waitron/server-kit";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/** The loopback forms a same-host connection presents (design §2). `::ffff:127.0.0.1` is IPv4 mapped
 * into IPv6, which a dual-stack listener reports for a v4 loopback client. Anything else is off-box. */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface NodeEnrolApiDeps {
  db: Database;
  cfg: TillConfig;
  nodeId: string;
  /** Boot-captured `isSingletonPrimary && !fencedOrMirror` (the `acceptingSales` predicate). Only the
   * primary can write `print_agents`; a mirror/fenced node refuses `node.enrol_unavailable`. */
  isPrimary: boolean;
  enrolRateLimiter?: EnrolRateLimiter;
}

const STATUS = {
  "node.enrol_not_local": 403,
  "node.enrol_unavailable": 409,
  "device.join_revoked": 403,
  "device.join_rate_limited": 429,
  // `requireString(body.name, "name")` throws this (server-kit request-screens.ts), not
  // `shared.invalid_body`; `readJsonBody` coerces a malformed body to `{}` and never throws.
  "management.request_invalid": 400,
} as const;

/**
 * `POST /api/node/enrol-self` (design §1.1) — the loopback-only self-enrol a print agent running on
 * THIS box calls before it falls back to knock-and-accept. Mounted on every trading boot beside
 * `GET /api/node`, so a mirror/fenced node has the route too — but there the read-only gate
 * (`read-only-gate.ts`) refuses the POST with `node.read_only` BEFORE this route's `isPrimary` check
 * runs. The `isPrimary`->`node.enrol_unavailable` check is the defensive refusal for a non-primary node
 * the read-only gate does not cover; either refusal makes the agent fall back to the manual knock.
 * Order: rate-limit, then the loopback gate, then the primary gate, then the write — the two gates run
 * before any DB work so a flood or an off-box caller draws no connection from the pool.
 */
export function mountNodeEnrolApi(app: Hono, deps: NodeEnrolApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "node.failed");
  const limiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  app.post("/api/node/enrol-self", (c) =>
    run(c, log, async () => {
      limiter.check(); // throws device.join_rate_limited (429)
      const address = getConnInfo(c).remote.address;
      if (address === undefined || !LOOPBACK.has(address)) {
        throw new AppError("node.enrol_not_local", {});
      }
      if (!deps.isPrimary) throw new AppError("node.enrol_unavailable", {});
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const { token } = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return selfEnrolNodeAgent(tx, deps.cfg, { nodeId: deps.nodeId, name });
      });
      return c.json({ token }, 201);
    }),
  );
}
```

(Verified against `print-api.ts`: `readJsonBody`, `requireString`, `requireUuidParam`, `requireManagementSession` and `createErrorBoundary` all come from `@waitron/server-kit`; `createEnrolRateLimiter`/`EnrolRateLimiter` from `./enrol-rate-limit.js`. There is no `./http.js`.)

- [ ] **Step 4: Mount it in boot**

In `apps/server/src/boot.ts`, immediately after the `mountNodeApi(app, { … }, log)` call (which is OUTSIDE the `if (!fencedOrMirror)` block), add:

```ts
  // On-node print-agent self-enrol (design §1.1). Mounted on EVERY trading boot beside the probe —
  // deliberately OUTSIDE the `!fencedOrMirror` block, so a mirror/fenced node carries the route too. On
  // such a node the read-only gate refuses the POST with `node.read_only` BEFORE the route's `isPrimary`
  // check runs; `isPrimary` (false here) is the defensive `node.enrol_unavailable` refusal for a
  // non-primary node the read-only gate does not cover. Either refusal makes the agent fall back to the
  // manual path (spec §2). Loopback-gated inside; `isPrimary` is the probe's `acceptingSales` predicate.
  mountNodeEnrolApi(
    app,
    { db, cfg: till, nodeId: till.nodeId, isPrimary: isSingletonPrimary && !fencedOrMirror },
    log,
  );
```

Add the import at the top: `import { mountNodeEnrolApi } from "./node-enrol-api.js";`

- [ ] **Step 5: Run the tests + typecheck**

Run: `pnpm --filter @waitron/server test -- node-enrol-api && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/node-enrol-api.ts apps/server/src/node-enrol-api.pg.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): POST /api/node/enrol-self — loopback-only on-node self-enrol"
```

---

### Task 5: revoke "allow again" + list provenance

**Files:**
- Modify: `apps/server/src/print-api.ts` (add the allow route; add `nodeId` to the list select)
- Test: `apps/server/src/print-api.pg.test.ts` (extend)

**Interfaces:**
- Consumes: `printAgents`, the `gated`/`requireManagementSession`/`requireUuidParam` helpers already in `print-api.ts`.
- Produces: `POST /management-api/print-agents/:id/allow` (204); the list at `GET /management-api/print-agents` now returns `nodeId` per row.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/print-api.pg.test.ts`:

```ts
it("allow-again reactivates a revoked agent (printer.manage)", async () => {
  const id = await seedAgent({ active: false, nodeId: someNode });
  const res = await managementPost(`/management-api/print-agents/${id}/allow`);
  expect(res.status).toBe(204);
  expect(await isActive(id)).toBe(true);
});

it("allow-again on an unknown id is agent.not_found", async () => {
  const res = await managementPost(`/management-api/print-agents/${randomUUID()}/allow`);
  expect(res.status).toBe(404);
  expect((await res.json()).code).toBe("agent.not_found");
});

it("the agents list carries node provenance", async () => {
  const id = await seedAgent({ active: true, nodeId: someNode });
  const rows = await (await managementGet("/management-api/print-agents")).json();
  expect(rows.find((r) => r.id === id).nodeId).toBe(someNode);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server test -- print-api`
Expected: FAIL — route 404s / `nodeId` absent.

- [ ] **Step 3: Implement**

In `apps/server/src/print-api.ts`, add `nodeId: printAgents.nodeId` to the `GET /management-api/print-agents` select. Add, next to the revoke route:

```ts
  // ── Allow a revoked print agent again (printer.manage) ──────────────────────────────────────────
  // The reverse of revoke: `active := true`. Revoke stopped being reversible by re-enrol once an
  // on-node agent refuses to auto-re-enrol while revoked (design §4) — without this action a mistaken
  // revoke of the box's own agent would permanently kill printing. 0 rows (unknown id) → agent.not_found.
  app.post("/management-api/print-agents/:id/allow", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(printAgents)
          .set({ active: true })
          .where(and(eq(printAgents.tenantId, deps.cfg.tenantId), eq(printAgents.id, id)))
          .returning({ id: printAgents.id }),
      );
      if (updated.length === 0) throw new AppError("agent.not_found", { id });
      return c.body(null, 204);
    }),
  );
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/server test:coverage -- print-api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/print-api.ts apps/server/src/print-api.pg.test.ts
git commit -s -m "feat(server): print-agent allow-again action + node provenance in the list"
```

---

### Task 6: the agent client `enrolSelf`

**Files:**
- Modify: `packages/print-agent/src/client.ts` (add `enrolSelf`)
- Modify: `packages/print-agent/src/agent.ts` (the `AgentClient` interface gains `enrolSelf`)
- Test: `packages/print-agent/src/client.test.ts`

**Interfaces:**
- Produces: `enrolSelf(url: string, name: string): Promise<Result<{ token: string }>>` on `AgentClient` and `createClient`, POSTing `{ name }` to `${url}/api/node/enrol-self`, reading `{ token }` from a 201, folding a 403/409/429 into a typed refusal and a network error into a `Failure`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/print-agent/src/client.test.ts` (mirror the existing `join` tests — a stub `fetch`):

```ts
it("enrolSelf returns the token on 201", async () => {
  const client = createClient({ fetch: stub(201, { token: "id.secret" }) });
  const r = await client.enrolSelf("https://127.0.0.1", "box");
  expect(r).toEqual({ ok: true, value: { token: "id.secret" } });
});

it("enrolSelf folds any non-2xx into a refusal, not a throw", async () => {
  for (const [status, code] of [[409, "node.enrol_unavailable"], [403, "node.enrol_not_local"]] as const) {
    const client = createClient({ fetch: stub(status, { code }) });
    const r = await client.enrolSelf("https://127.0.0.1", "box");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe("refused"); // the loop only checks r.ok; kind is diagnostic
  }
});

it("enrolSelf folds a network error into a Failure", async () => {
  const client = createClient({ fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
  const r = await client.enrolSelf("https://127.0.0.1", "box");
  expect(r.ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/print-agent test -- client`
Expected: FAIL — `enrolSelf` is not a function.

- [ ] **Step 3: Implement**

Add `enrolSelf(url: string, name: string): Promise<Result<{ token: string }>>;` to the `AgentClient` interface in `agent.ts`, and add a new `"refused"` member to the `Failure` union (client.ts has no such kind today).

`enrolSelf` does NOT reuse the shared `foldFetch`. That helper decides the failure kind from the HTTP status alone, BEFORE the body — `403 → pairing_closed`, `409 → bad_reply`, `429 → rate_limited` — and runs `parseOk` only on 2xx, so it can never emit `refused` and would mislabel a self-enrol refusal as a pairing event. Give `enrolSelf` its own small handler with the same timeout/abort wrapper as `join`:
- **201** → read `{ token }` → `{ ok: true, value: { token } }`.
- **any other status** → `{ ok: false, failure: { kind: "refused" } }` (a 403/409/429 all mean "this box will not self-enrol me"; the body `code` may be logged but is not needed to decide).
- **a transport throw / abort** → `{ ok: false, failure: { kind: "unreachable" } }` (nothing was listening on the box's own loopback — a device).

The loop (Task 7) branches only on `self.ok`, so `refused` vs `unreachable` is diagnostic; the distinct kind keeps the status page honest ("not on a node" vs "no local server answered").

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/print-agent test -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/print-agent/src/client.ts packages/print-agent/src/agent.ts packages/print-agent/src/client.test.ts
git commit -s -m "feat(print-agent): client.enrolSelf — POST /api/node/enrol-self"
```

---

### Task 7: the agent loop tries self-enrol first

**Files:**
- Modify: `packages/print-agent/src/agent.ts` (early in `tick()`, before the router probe)
- Test: `packages/print-agent/src/agent.test.ts`

**Interfaces:**
- Consumes: `client.enrolSelf` (Task 6), `host.saveToken`, `config.serverUrl`.
- Produces: no new exports; the loop behaviour changes — on a tick with no token it self-enrols against loopback before knocking.

- [ ] **Step 1: Write the failing tests**

Add to `packages/print-agent/src/agent.test.ts` (reuse the file's fake host/client):

```ts
it("on the primary box: self-enrol succeeds, no knock, token stored", async () => {
  client.enrolSelf = async () => ({ ok: true, value: { token: "id.secret" } });
  const knock = vi.spyOn(client, "join");
  await agent.runOnce();
  expect(host.savedToken).toBe("id.secret");
  expect(knock).not.toHaveBeenCalled(); // never falls through to the manual path
});

it("on a device: self-enrol refused → falls through to the existing knock", async () => {
  client.enrolSelf = async () => ({ ok: false, failure: { kind: "refused" } });
  const knock = vi.spyOn(client, "join").mockResolvedValue({ ok: true, value: { token: "t", verificationNumber: "42" } });
  await agent.runOnce();
  expect(knock).toHaveBeenCalled();
});

it("self-enrol runs even when the configured server reports no accepting primary", async () => {
  // The on-box agent must enrol independently of config.serverUrl's probe (spec §2): a self-enrol that
  // only ran after `anyAccepting` would be coupled to the configured server being up.
  probe.mockResolvedValue({ anyAccepting: false }); // configured server not accepting
  client.enrolSelf = async () => ({ ok: true, value: { token: "id.secret" } });
  await agent.runOnce();
  expect(host.savedToken).toBe("id.secret");
});

it("self-enrol probes a LITERAL loopback origin, not the configured primary URL", async () => {
  // config.serverUrl = "https://primary.lan"; the enrolSelf call must target 127.0.0.1 on the same port.
  let seen = "";
  client.enrolSelf = async (url) => { seen = url; return { ok: false, failure: { kind: "refused" } }; };
  await agent.runOnce();
  expect(new URL(seen).hostname).toBe("127.0.0.1");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/print-agent test -- agent`
Expected: FAIL — no self-enrol attempt happens.

- [ ] **Step 3: Implement**

In `agent.ts`, place the self-enrol attempt EARLY in `tick()` — after the `config === null` and `halted` guards, and BEFORE `const r = routerFor(config)` / `r.probe()` / the `if (!round.anyAccepting)` gate. Placing it there (not inside the later `if (token === null)` branch, which sits after `anyAccepting`) decouples it from the configured server's probe, per spec §2 — an on-box agent enrols even if its configured server is momentarily not accepting:

```ts
    // Before probing the configured server, ask our OWN box to enrol us (design §1.1/§2): a print
    // agent on the primary box is inside the node's trust boundary and enrols silently. A LITERAL
    // loopback origin — NOT config.serverUrl, which on a till is the primary's LAN address — with the
    // configured port/protocol preserved. On the primary box this succeeds; on a device nothing is on
    // its own loopback, so `enrolSelf` is `unreachable` and we fall through to the probe + knock below;
    // on a mirror the local server's read-only gate refuses (`node.read_only` → `refused`), same fall-through.
    if ((await host.token()) === null) {
      const loopback = new URL(config.serverUrl);
      loopback.hostname = "127.0.0.1";
      const self = await client.enrolSelf(loopback.origin, config.name);
      if (self.ok) {
        await host.saveToken(self.value.token);
        approved = true; // skip the join-status poll next tick; go straight to work
        report({ phase: "running", serverUrl: config.serverUrl, current: loopback.origin });
        return false;
      }
    }
```

The existing `const r = routerFor(config)` … `if (token === null) { client.join(...) }` block then runs UNCHANGED as the fallback: on the next tick `host.token()` is non-null, so this self-enrol block is skipped and the loop pulls jobs with the stored token.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/print-agent test:coverage`
Expected: PASS (whole package, to catch the loop's other branches).

- [ ] **Step 5: Commit**

```bash
git add packages/print-agent/src/agent.ts packages/print-agent/src/agent.test.ts
git commit -s -m "feat(print-agent): try loopback self-enrol before the manual knock"
```

---

### Task 8: dashboard — provenance + allow-again

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (add `allowAgent`; surface `nodeId` on the agents list type)
- Modify: `apps/dashboard/src/screens/printers-screen.ts` (a provenance indicator; an "allow again" action for a revoked agent)
- Test: `apps/dashboard/src/screens/printers-screen.test.ts` (+ `.a11y.test.ts` if the control is interactive)

**Interfaces:**
- Consumes: `GET /management-api/print-agents` (now with `nodeId`), `POST /management-api/print-agents/:id/allow`.
- Produces: `client.allowAgent(id)`; a rendered "self-enrolled" marker; an allow-again button on revoked rows.

- [ ] **Step 1: Write the failing tests**

Add to `printers-screen.test.ts` (mirror the existing revoke tests):

```ts
it("marks a self-enrolled agent (node_id present)", async () => {
  renderWithAgents([{ id: "a", name: "box", active: true, nodeId: "n1", lastSeenAt: null, enrolledAt: iso }]);
  expect(screen.getByText(/on this box|self-enrolled/i)).toBeInTheDocument();
});

it("shows allow-again on a revoked agent and calls the endpoint", async () => {
  const allow = vi.spyOn(client, "allowAgent").mockResolvedValue(undefined);
  renderWithAgents([{ id: "a", name: "box", active: false, nodeId: "n1", lastSeenAt: null, enrolledAt: iso }]);
  await userClicks(/allow again/i); // behind the same two-step confirm as revoke, if the file uses one
  expect(allow).toHaveBeenCalledWith("a");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/dashboard test -- printers-screen`
Expected: FAIL.

- [ ] **Step 3: Implement**

- In `apps/dashboard/src/api/client.ts`: add `nodeId: string | null` to the agents-list row type; add `allowAgent(id: string): Promise<void>` POSTing to `/management-api/print-agents/${id}/allow` (model on the existing `revokeAgent`).
- In `printers-screen.ts`: render a small marker when `nodeId !== null` ("On this box" / "Self-enrolled"); when a row is `active === false`, render an "Allow again" action beside the revoked state that calls `allowAgent` (reuse the two-step confirm pattern the revoke uses — `printers-screen.ts:80-81` documents it — so an accidental single click cannot fire it). Follow the shared UI form/action conventions (design-system.md → Forms) for labels.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/dashboard test:coverage -- printers-screen` then the package's a11y test if touched.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/screens/printers-screen.test.ts
git commit -s -m "feat(dashboard): print-agent provenance marker + allow-again action"
```

---

### Task 9: measure the loopback address on the real box

This is a **verification task, not a code task** — it cannot run in CI, and it gates the feature's real-world correctness (Global Constraints; spec §9). Do it on the real box during `/finish-branch`'s live-test window, and record the result in the PR thread and the backlog.

- [ ] **Step 1: Deploy the branch image to the box** (the `deploy/try-branch.sh` flow used for #308; refresh the box's `compose.yml` first if it was prepared from older `main` — backlog op note).

- [ ] **Step 2: Measure the on-box agent's peer address.** With the box's own print agent running, confirm `POST /api/node/enrol-self` succeeds and the server logged the caller's `remote.address` as a loopback form (`127.0.0.1` / `::1` / `::ffff:127.0.0.1`) under `network_mode: host` + TLS. Add a temporary `log.info("enrol peer", { address })` if needed and remove it before merge.

- [ ] **Step 3: The control in the other direction.** From a LAN host (a laptop on the venue network), `POST https://<box-lan-ip>/api/node/enrol-self` and confirm the server reads a **non-loopback** address and returns `node.enrol_not_local` (403). A reading where both look alike proves nothing (CLAUDE.md §1) — this control is what makes Step 2 evidence.

- [ ] **Step 4: Record the outcome.** If loopback is read reliably: note it (address form seen, TLS + host-networking confirmed) in the PR and backlog, and the feature stands. If it is NOT reliable: the route already fails closed to the manual path (a non-loopback read refuses), so nothing is broken — record the finding and open a follow-up for how the box should signal "same host" instead (spec §7's shared-secret alternative is the fallback).

---

## Self-Review

**Spec coverage:**
- §1.1 loopback route, loopback gate, primary gate, no window/number → Task 4. ✓
- §2 agent decides by asking; literal loopback; fallback on refuse/unreachable → Tasks 6–7. ✓
- §3 `node_id`, no FK, idempotent refresh-not-duplicate → Tasks 1–2. ✓
- §4 sticking revoke + allow-again (shipped together) → Tasks 2 (refusal), 5 (allow), 8 (UI). ✓
- §5 provenance in the list → Tasks 5, 8. ✓
- §6 the three error codes → Task 3, thrown in Tasks 2/4. ✓
- §8 dev mode: no dev-specific code (self-enrol path holds in dev) → no task needed; verified by the primary-path tests running under the standard harness. ✓
- §9 the must-measure box probe + LAN control → Task 9. ✓
- §7 mirror half → explicitly OUT (Global Constraints); no task, by design. ✓

**Placeholder scan:** test bodies use `/* … */` only for repo-specific seeding the executor copies from the neighbouring cases in the same file (named explicitly: tenant/location seeding, the file's real-PG accessor); all implementation code is complete. Acceptable — these are "use this file's existing fixture", not "figure out the logic".

**Type consistency:** `selfEnrolNodeAgent` returns `{ agentId, token }` (Task 2), consumed by the route which returns only `{ token }` (Task 4) — consistent. Token shape `${agentId}.${secret}` matches `authenticateAgent`'s split (Global Constraints). `enrolSelf` returns `Result<{ token }>` (Task 6), consumed in the loop as `self.value.token` (Task 7) — consistent. `nodeId` is `uuid` nullable in the schema (Task 1), `string | null` on the dashboard row (Task 8) — consistent.

**Ordering note for the executor:** Tasks 1→2→3→4 are a hard chain (schema → verb → codes → route). Task 5 depends on Task 1 (the `nodeId` column) and Task 3 (no — it reuses `agent.not_found`). Tasks 6→7 are a chain and depend on Task 4 existing (the route they call). Task 8 depends on Tasks 4–5 (the endpoints). Task 9 is last, on the box.
</content>
