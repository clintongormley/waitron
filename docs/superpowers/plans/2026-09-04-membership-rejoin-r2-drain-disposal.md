# Membership Rejoin — Slice 6 R2 (Drain-as-source + Disposal guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A returned/fenced (`sell-only`) node serves its own-origin `sync_log` tail so the current serving-primary (the "carrier") can drain it, and it proves LOCALLY — via a producer-side disposal guard surfaced on box-status — whether that tail has fully drained, so no box is retired while it still holds records no surviving node has (parent design §5.1; rejoin §6 step 3).

**Architecture:** Three changes, all on the returned node; the carrier needs **no** new code. (1) **Drain-as-source** — a fenced node currently serves NO sync source (`mountSyncApi` gates on `isSingletonPrimary`, false after R1's demote); R2 mounts a narrow **own-origin-only** variant so the carrier's existing pull loop drains `originId=<returned>` the moment the source comes up. (2) **Disposal guard** — a producer-side reader compares this node's own-origin high-water `seq` per lane against the carrier's reported `sync_cursor`, giving a `drained` verdict. (3) **box-status surface** — the returned node shows the at-risk / drained state continuously. The `sell-only`→`evicted` transition, the retire action, and the wipe-and-restore are all **R3** — R2 leaves the node `sell-only` and never mints a membership document.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle, Hono, Vitest. Packages: `@waitron/membership` (pure leaf), `@waitron/sync`, `@waitron/db` (unchanged — reused), `apps/server`.

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` (§6 rejoin step 3 — drain-as-source; §5 distribution); parent `docs/superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md` (§5.1 disposal guard + the **2026-09-04 note** tightening "any survivor" to **the carrier**). No separate R2 refinement spec (owner decision, 2026-09-04, per the R1 precedent — the design is settled in the spec and folded into this plan's Architecture/Context + the notes below).

## Design decisions folded in (owner-approved 2026-09-04)

- **Scope stops at drain + guard + surface.** R2 mounts the drain source, builds the guard, surfaces it. The node stays `sell-only`. Producing `evicted`, the retire action, and wipe-and-restore are R3 (gated on the backup regime). The guard is a **reader consumed by box-status, not a gate that changes behaviour** — so R2's only behaviour change is mounting the narrow source.
- **Own-origin-only source (deliberate reversal, narrow).** `boot.ts:1262-1266` deliberately states "a sell-only local secondary must not duplicate the primary's source." R2 reverses this ONLY for a fenced node and ONLY for its own origin: the drain source forces `originId = self`, so a fenced node can never relay another origin or act as a general primary source. `isSingletonPrimary` stays false — submitter/reconciler/config-writer stay suppressed, retention stays off, the read-only gate still blocks tenant/fiscal writes. The fence stays fully intact; the node just becomes drainable.
- **No carrier-side code (static mutual peers).** The two on-prem boxes are peers of each other at setup (active-active, `boot.ts:1239`). Once the returned node mounts its own-origin source and has the carrier enrolled in its `sync_peers`, the carrier's existing pull loop drains it. R2 builds no enrolment flow; the boot test seeds the prerequisite (`enrolPeer`) and pins that the source serves under a peer token.
- **Read-only-gate exemption for the peer-sync surface.** The carrier learns how far it has drained by POSTing `/sync-api/cursor` (the guard's only input). But R1's read-only gate blocks every non-GET verb — and a fenced node is the FIRST read-only node to also serve a source, so the two have never coexisted. R2 exempts the `/sync-api/` prefix from the read-only gate: it is peer-Bearer-authenticated machine-to-machine sync writing only `sync_cursor` (whole-DB operational state, no `tenant_id`, no RLS — `0000_sync_outbox.sql:95-99`), never a client tenant/fiscal write, which is what the fence exists to stop.
- **Tail-preservation safety (no new code).** The returned node must not prune its own outbox before the carrier drains it. Retention is already gated off on a fenced node (`isSingletonPrimary` false, `boot.ts:1383`), so the tail is preserved. Pinned as a property in Task 6.
- **The carrier is the `serving-primary` in the held document** (§5.1 note: "the node that will carry the partition forward — the promoted successor for a primary disposal"). A cloud-as-carrier case is out of scope (the cloud is a sink not a relay — the relay-vs-sink open item, parent §9).

## Global Constraints

- **Gate before push:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; CI shards run `test:coverage` — run `pnpm --filter <pkg> test:coverage` per touched package before claiming green (CLAUDE.md §2). Run `apps/server` UNFILTERED so cross-cutting guard suites load.
- **Coverage thresholds:** `@waitron/membership` and `@waitron/sync` = 98/98/98/95; `apps/server` = 95/95/90/88.
- **Every commit `-s`** (DCO). Branch `feat/membership-rejoin-r2-drain` in a worktree (already created).
- **No backwards-compat / no data migration** — nothing is deployed (CLAUDE.md §3). **This slice adds NO migration** — it reads/serves existing `sync_log` + `sync_cursor` + `node_membership`; no schema change, so no RLS / `inmutabilidad` / FORCE-RLS / `english-only` concern (all standing values are already English).
- **`@waitron/membership` is a pure leaf** (deps: `@waitron/shared` only) — the new helper stays pure (no db/crypto/side-effects), 100%-covered.
- **Never build SQL by concatenation** (CLAUDE.md §3) — every interpolated value binds via the `sql` template; `in ${array}` is drizzle's array-expansion shape (see `source.ts`), never `= any(...)`.
- **Fiscal-adjacent → owner sign-off before land** (backlog). Do NOT self-land. Run `finish-branch`; hold at land for owner review.

---

### Task 1: Pure carrier helper `servingPrimaryNodeId` in `@waitron/membership`

The disposal guard needs the carrier's node id — the node holding `serving-primary` in the held document. A pure lookup, beside the existing `standingOf` / `isFencedStanding` (all read standings, distinct from `standings.ts` which produces them).

**Files:**
- Modify: `packages/membership/src/fence.ts` (add one export)
- Modify: `packages/membership/src/index.ts` (add one export)
- Test: `packages/membership/src/fence.test.ts` (extend)

**Interfaces:**
- Consumes: `SignedMembershipDocument` from `./types.js`.
- Produces: `servingPrimaryNodeId(document: SignedMembershipDocument): string | undefined`

- [ ] **Step 1: Write the failing test** — append to `packages/membership/src/fence.test.ts` (the `node`/`doc` helpers already exist at the top of that file):

```typescript
import { isFencedStanding, servingPrimaryNodeId, standingOf } from "./fence.js";
// ... existing imports/helpers ...

describe("servingPrimaryNodeId", () => {
  it("returns the node holding serving-primary", () => {
    expect(
      servingPrimaryNodeId(doc([node("n1", "sell-only"), node("n2", "serving-primary")])),
    ).toBe("n2");
  });
  it("returns undefined when no node serves as primary", () => {
    expect(
      servingPrimaryNodeId(doc([node("n1", "sell-only"), node("n2", "serving-secondary")])),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/membership test fence`
Expected: FAIL — `servingPrimaryNodeId` is not exported.

- [ ] **Step 3: Add the helper** — append to `packages/membership/src/fence.ts`:

```typescript
/**
 * The nodeId of the node holding `serving-primary` in a document — the current primary, i.e. the
 * CARRIER a returned/fenced node drains its tail onto (parent design §5.1's "the node that will carry
 * the partition forward", 2026-09-04 note). `undefined` when no node serves as primary (an incomplete
 * or all-fenced chart). At most one node holds serving-primary (the singleton), so the first match is
 * it. A pure lookup over `document.body.nodes` — no verification: the held document was verified when
 * adopted (membership-adopt.ts) or self-signed at promotion.
 */
export function servingPrimaryNodeId(document: SignedMembershipDocument): string | undefined {
  return document.body.nodes.find((n) => n.standing === "serving-primary")?.nodeId;
}
```

- [ ] **Step 4: Add the export** — `packages/membership/src/index.ts`, on the existing fence line:

```typescript
export { standingOf, isFencedStanding, servingPrimaryNodeId } from "./fence.js";
```

- [ ] **Step 5: Run test + coverage to verify pass**

Run: `pnpm --filter @waitron/membership test:coverage`
Expected: PASS; `fence.ts` at 100%.

- [ ] **Step 6: Commit**

```bash
git add packages/membership/src/fence.ts packages/membership/src/fence.test.ts packages/membership/src/index.ts
git commit -s -m "feat(membership): servingPrimaryNodeId — the carrier a fenced node drains onto"
```

---

### Task 2: `SYNC_LANES` + `readDrainProgress` disposal reader in `@waitron/sync`

The producer-side guard. A new leaf reader (beside `source.ts` / `retention.ts` / `cursor-report.ts`) computes, per lane, this node's own-origin high-water `seq` versus the carrier's reported cursor, and collapses to a `drained` verdict plus the two numbers box-status surfaces. `SYNC_LANES` lets it iterate lanes so a future lane (e.g. H2's fiscal lane) slots in without changing the guard.

**Files:**
- Modify: `packages/sync/src/registry.ts` (add `SYNC_LANES` near `SyncLane`)
- Create: `packages/sync/src/disposal.ts`
- Modify: `packages/sync/src/index.ts` (add exports)
- Test: `packages/sync/src/disposal.rls.test.ts` (real Postgres via `useTemplateDb`)

**Interfaces:**
- Consumes: `SYNC_LANES`, `tablesForLane` from `./registry.js`; `Database`/`Transaction` from `@waitron/db`.
- Produces:
  - `SYNC_LANES: readonly SyncLane[]` (`["ordered", "fast"]`)
  - `readDrainProgress(db: Database | Transaction, args: { selfNodeId: string; carrierNodeId: string }): Promise<DrainProgress>`
  - `interface DrainProgress { drained: boolean; ownTailSeq: bigint | null; carrierAppliedSeq: bigint | null }`

- [ ] **Step 1: Add `SYNC_LANES`** — `packages/sync/src/registry.ts`, immediately after `export type SyncLane = "ordered" | "fast";`:

```typescript
/** Every sync lane, for callers that must act ACROSS all lanes — e.g. the disposal guard, which reads
 * an origin's whole tail: `seq` is a single global identity, but each lane's cursor advances only over
 * its own tables, so "fully drained" is a per-lane question answered for every lane. */
export const SYNC_LANES = ["ordered", "fast"] as const satisfies readonly SyncLane[];
```

- [ ] **Step 2: Write the failing test** — `packages/sync/src/disposal.rls.test.ts`. Real Postgres, seeding as the OWNER (RLS-bypass sufficient for the arithmetic; the `sync_tailer`-under-`withTenant` path is proven in the apps/server wiring tests — same split `box-status.replication.test.ts` documents). Pick real lane table names dynamically via `tablesForLane` so the test never hardcodes the registry:

```typescript
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { readDrainProgress, tablesForLane } from "@waitron/sync";

const postgres = useTemplateDb({ template: "manifest" });

const SELF = "11111111-1111-4111-8111-111111111111"; // the returned/fenced node's own origin
const CARRIER = "carrier-node"; // the current serving-primary (subscriber_id is text)
const TENANT = "22222222-2222-4222-8222-222222222222";
const ORDERED_TABLE = tablesForLane("ordered")[0]; // a real ordered-lane table (e.g. products)
const FAST_TABLE = tablesForLane("fast")[0]; // a real fast-lane table

// Each test seeds a fresh slice of sync_log/sync_cursor and clears it after, so the shared container
// stays order-independent (CLAUDE.md §4 — clean up in a finally / afterEach).
afterEach(async () => {
  await postgres.admin.execute(sql`delete from sync_log where origin_id = ${SELF}::uuid`);
  await postgres.admin.execute(sql`delete from sync_cursor where origin_id = ${SELF}::uuid`);
});

async function seedOwnRow(seq: number, table: string): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (${seq}, ${SELF}::uuid, ${table}, 'insert', ${TENANT}::uuid, '{}'::jsonb)`,
  );
}
async function seedCarrierCursor(lane: string, seq: number): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq, alive)
        values (${CARRIER}, ${SELF}::uuid, ${lane}, ${seq}, true)`,
  );
}

describe("readDrainProgress", () => {
  it("is drained with a null tail when this node has produced no own-origin rows", async () => {
    const p = await readDrainProgress(postgres.admin, { selfNodeId: SELF, carrierNodeId: CARRIER });
    expect(p).toEqual({ drained: true, ownTailSeq: null, carrierAppliedSeq: null });
  });

  it("is NOT drained when the carrier has never reported a cursor for a lane that has own rows", async () => {
    await seedOwnRow(100, ORDERED_TABLE);
    const p = await readDrainProgress(postgres.admin, { selfNodeId: SELF, carrierNodeId: CARRIER });
    expect(p.drained).toBe(false);
    expect(p.ownTailSeq).toBe(100n);
    expect(p.carrierAppliedSeq).toBe(0n); // no cursor row → treated as applied-nothing
  });

  it("is NOT drained when the carrier's cursor lags this node's own tail on a lane", async () => {
    await seedOwnRow(100, ORDERED_TABLE);
    await seedCarrierCursor("ordered", 50);
    const p = await readDrainProgress(postgres.admin, { selfNodeId: SELF, carrierNodeId: CARRIER });
    expect(p.drained).toBe(false);
    expect(p.ownTailSeq).toBe(100n);
  });

  it("is drained when the carrier has caught up to the own tail on every lane", async () => {
    await seedOwnRow(50, ORDERED_TABLE);
    await seedOwnRow(120, FAST_TABLE);
    await seedCarrierCursor("ordered", 50);
    await seedCarrierCursor("fast", 120);
    const p = await readDrainProgress(postgres.admin, { selfNodeId: SELF, carrierNodeId: CARRIER });
    expect(p.drained).toBe(true);
    expect(p.ownTailSeq).toBe(120n);
    expect(p.carrierAppliedSeq).toBe(50n); // the binding (min) constraint across own-carrying lanes
  });

  it("is NOT drained when only ONE of two own-carrying lanes has caught up", async () => {
    await seedOwnRow(50, ORDERED_TABLE); // ordered drained
    await seedOwnRow(120, FAST_TABLE); // fast behind
    await seedCarrierCursor("ordered", 50);
    await seedCarrierCursor("fast", 90);
    const p = await readDrainProgress(postgres.admin, { selfNodeId: SELF, carrierNodeId: CARRIER });
    expect(p.drained).toBe(false); // the fast lane is not drained even though ordered is
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test disposal`
Expected: FAIL — `readDrainProgress` is not exported.

- [ ] **Step 4: Write the reader** — `packages/sync/src/disposal.ts`:

```typescript
// The producer-side disposal guard (parent design §5.1; rejoin §6 step 3). A returned/fenced node
// proves LOCALLY whether its own-origin sync_log tail has fully drained onto the CARRIER (the current
// serving-primary): its own latest seq per lane versus the carrier's reported sync_cursor for that
// lane. A non-empty tail on ANY lane means "not safely disposable". `seq` is a single global identity,
// but each lane's cursor advances only over its own tables (tablesForLane), so "drained" is answered
// per lane and ANDed. Runs the way the box-status lag reader does: a sync_tailer member INSIDE
// withTenant(tenantId), so the sync_log_tenant_isolation RLS policy scopes the own-origin max to this
// venue; sync_cursor carries no RLS. Reads only (no write), so it composes with the fenced read-only
// posture. Values bind as parameters (CLAUDE.md §3); `in ${tables}` is drizzle's array-expansion shape
// (source.ts), never `= any(...)`.
import { sql } from "drizzle-orm";
import { type Database, type Transaction } from "@waitron/db";
import { SYNC_LANES, tablesForLane } from "./registry.js";

export interface DrainProgress {
  /** True iff the carrier has applied this node's entire own-origin tail on EVERY lane. A node that
   * has produced no own-origin rows is trivially drained. */
  drained: boolean;
  /** This node's own-origin high-water seq across all lanes; `null` iff it has captured nothing. */
  ownTailSeq: bigint | null;
  /** The carrier's applied position — the MIN, across lanes that carry own-origin rows, of its
   * reported cursor (a lane with own rows but no cursor counts as 0). The binding constraint; `null`
   * iff `ownTailSeq` is `null` (nothing to drain). */
  carrierAppliedSeq: bigint | null;
}

export interface DrainProgressArgs {
  /** This node's own origin id (config.till.nodeId) — the `origin_id = self` tail it must ship. */
  selfNodeId: string;
  /** The carrier's node id — the `subscriber_id` half of the cursor it reports as it drains. */
  carrierNodeId: string;
}

export async function readDrainProgress(
  db: Database | Transaction,
  args: DrainProgressArgs,
): Promise<DrainProgress> {
  let ownTailSeq: bigint | null = null;
  let carrierAppliedSeq: bigint | null = null;
  let drained = true;
  for (const lane of SYNC_LANES) {
    const tables = tablesForLane(lane);
    // This lane's own-origin high-water. `select max(seq)` always returns one row (max_seq null when
    // there are no matching rows). An empty lane can't occur — every SYNC_LANES entry has tables — but
    // the `length === 0 → and false` guard mirrors readSyncLogSince.
    const ownRes = await db.execute<{ max_seq: string | null }>(sql`
      select max(seq)::text as max_seq
      from sync_log
      where origin_id = ${args.selfNodeId}::uuid
        ${tables.length === 0 ? sql`and false` : sql`and table_name in ${tables}`}
    `);
    const ownMaxRaw = ownRes.rows[0]?.max_seq ?? null;
    if (ownMaxRaw === null) continue; // no own rows on this lane — nothing to drain here
    const laneOwnMax = BigInt(ownMaxRaw);
    // The carrier's reported cursor for (subscriber=carrier, origin=self, lane); absent → 0 (the
    // carrier has drained nothing on this lane), which fails the drained test below.
    const curRes = await db.execute<{ last_applied_seq: string }>(sql`
      select last_applied_seq::text as last_applied_seq
      from sync_cursor
      where subscriber_id = ${args.carrierNodeId}
        and origin_id = ${args.selfNodeId}::uuid
        and lane = ${lane}
    `);
    const curRaw = curRes.rows[0]?.last_applied_seq;
    const laneCarrier = curRaw === undefined ? 0n : BigInt(curRaw);
    if (laneCarrier < laneOwnMax) drained = false;
    ownTailSeq = ownTailSeq === null || laneOwnMax > ownTailSeq ? laneOwnMax : ownTailSeq;
    carrierAppliedSeq =
      carrierAppliedSeq === null || laneCarrier < carrierAppliedSeq ? laneCarrier : carrierAppliedSeq;
  }
  return { drained, ownTailSeq, carrierAppliedSeq };
}
```

- [ ] **Step 5: Add the exports** — `packages/sync/src/index.ts`. Add `SYNC_LANES` to the existing registry re-export line (or add a line) and export the disposal reader + type:

```typescript
export { SYNC_LANES } from "./registry.js";
export { readDrainProgress } from "./disposal.js";
export type { DrainProgress, DrainProgressArgs } from "./disposal.js";
```

(Place these beside the existing `readSyncLogSince` / `recordSubscriberCursor` / `tablesForLane` exports; match the file's ordering convention.)

- [ ] **Step 6: Run test + coverage to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage disposal`
Expected: PASS (all five cases); `disposal.ts` fully covered. Prove-by-deletion (CLAUDE.md §4): flip `if (laneCarrier < laneOwnMax) drained = false;` to a no-op and confirm the "NOT drained when the carrier's cursor lags" case fails, then restore.

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/registry.ts packages/sync/src/disposal.ts packages/sync/src/disposal.rls.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): SYNC_LANES + readDrainProgress producer-side disposal guard"
```

---

### Task 3: `ownOriginOnly` restriction on `mountSyncApi` (the drain source)

A fenced node serves its own tail and nothing else. Add an `ownOriginOnly` flag to `mountSyncApi`; when set, `/sync-api/log` forces `originId = deps.nodeId` (a peer-supplied `?originId=` is ignored), so the source can never relay another origin. `/hello` and `/cursor` are unchanged. Behavior-preserving for the existing full-source call (flag absent → today's behavior).

**Files:**
- Modify: `apps/server/src/sync-api.ts` (add the flag to `SyncApiDeps`; one branch in `/sync-api/log`)
- Test: `apps/server/src/sync-api.rls.test.ts` (extend — real Postgres, peer auth)

**Interfaces:**
- Produces: `SyncApiDeps.ownOriginOnly?: boolean` (default/absent = full source — every origin).

- [ ] **Step 1: Write the failing test** — add a case to `apps/server/src/sync-api.rls.test.ts`, mirroring the existing `/sync-api/log streams the tenant's captured rows` test (which seeds captured rows through an `app_login` pool, enrols a peer, and reads with `decodeBatch`). Seed rows under TWO origins — this node's own `nodeId` and a foreign origin — then assert an `ownOriginOnly` source, even when asked for the foreign origin, returns only own-origin rows:

```typescript
it("ownOriginOnly restricts /sync-api/log to this node's own origin, ignoring a foreign ?originId", async () => {
  // Seed one own-origin row and one foreign-origin row into sync_log (capture via an app_login pool
  // with app.node_id set to each origin, as the existing /log test does — reuse its seeding helper).
  // NODE_A is deps.nodeId here; FOREIGN is another origin the node happens to hold.
  const FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  // ... seed an own-origin (NODE_A) 'products' row AND a FOREIGN 'products' row (mirror the seeding in
  // the existing "/sync-api/log streams ..." test: connectAs app_login, set app.tenant_id + app.node_id,
  // insert through the captured table) ...
  const reader = await postgres.pg.connectAs("sync_reader", "rp");
  try {
    const peer = await enrolPeer(postgres.admin, { subscriberId: "drainPeer", name: "drain" });
    const app = new Hono();
    mountSyncApi(
      app,
      { db: reader, tenantId, nodeId: NODE_A, environment: "production", ownOriginOnly: true },
      log,
    );
    const auth = { Authorization: `Bearer ${peer.token}` };
    // Even explicitly asking for the FOREIGN origin, an own-origin-only source serves only NODE_A rows.
    const res = await app.request(`/sync-api/log?originId=${FOREIGN}&after=0&limit=100`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const rows = decodeBatch(await res.text());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.originId === NODE_A)).toBe(true);
  } finally {
    await reader.close();
  }
});
```

(Concrete seeding: copy the `connectAs("app_login", ...)` + `set_config('app.tenant_id'/'app.node_id')` + insert-through-captured-table pattern already in this file's `/sync-api/log streams …` test — seed once with `app.node_id = NODE_A` and once with `app.node_id = FOREIGN`. The suite already owns a provisioned tenant/`tenantId`; reuse it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api`
Expected: FAIL — `ownOriginOnly` is not a known dep; the foreign-origin request returns FOREIGN rows.

- [ ] **Step 3: Add the flag + branch** — `apps/server/src/sync-api.ts`. In `SyncApiDeps` add:

```typescript
  /** When true, `/sync-api/log` serves ONLY this node's own origin (`deps.nodeId`), ignoring a
   * peer-supplied `?originId=`. The membership-rejoin R2 DRAIN source: a fenced (sell-only) node serves
   * its own tail so the carrier can drain it, and must NOT relay any other origin (design §6 step 3).
   * Absent/false = the full primary source (every origin). */
  ownOriginOnly?: boolean;
```

and in the `/sync-api/log` handler replace the `originId` read:

```typescript
      // A drain source (ownOriginOnly) forces our own origin, ignoring any peer-supplied ?originId — a
      // fenced node serves only its own tail (R2). The full primary source honours the query.
      const originId = deps.ownOriginOnly === true ? deps.nodeId : c.req.query("originId");
```

(The downstream `...(originId === undefined ? {} : { originId })` spread is unchanged: `deps.nodeId` is always a string, so an ownOriginOnly source always passes an `originId`.)

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api && pnpm --filter @waitron/server typecheck`
Expected: PASS. The existing full-source cases (flag absent) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync-api.ts apps/server/src/sync-api.rls.test.ts
git commit -s -m "feat(server): ownOriginOnly drain source — a fenced node serves only its own tail"
```

---

### Task 4: Read-only-gate exemption for the peer-sync surface

The carrier's cursor report (`POST /sync-api/cursor`) — the disposal guard's only input — must reach a fenced node despite the read-only gate. Add an optional path predicate; the gate passes exempt requests through. Behavior-preserving for the existing call (no predicate → today's behavior); the fence term is unchanged.

**Files:**
- Modify: `apps/server/src/read-only-gate.ts` (add the optional predicate + a `Context` import)
- Modify: `apps/server/src/boot.ts` (the single call site at ~925)
- Test: `apps/server/src/read-only-gate.test.ts` (extend)

**Interfaces:**
- Produces: `readOnlyGate(isReadOnly: () => boolean, isExempt?: (c: Context) => boolean): MiddlewareHandler` — a request matching `isExempt` passes through even when read-only; otherwise unchanged (safe verbs pass, write verbs 403 when read-only).

- [ ] **Step 1: Write the failing test** — extend `apps/server/src/read-only-gate.test.ts`. Keep every existing verb-matrix assertion; add:

```typescript
it("passes an exempt path through even on a write verb when read-only", async () => {
  const gate = readOnlyGate(
    () => true,
    (c) => c.req.path.startsWith("/sync-api/"),
  );
  const app = new Hono();
  app.use("*", gate);
  app.post("/sync-api/cursor", (c) => c.body(null, 200));
  app.post("/api/sales", (c) => c.body(null, 200));
  // Exempt: the peer-sync cursor report is allowed through the fence.
  expect((await app.request("/sync-api/cursor", { method: "POST" })).status).toBe(200);
  // Non-exempt: an ordinary client write is still refused.
  const refused = await app.request("/api/sales", { method: "POST" });
  expect(refused.status).toBe(403);
  expect((await refused.json()).error.code).toBe("node.read_only");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test read-only-gate`
Expected: FAIL — `readOnlyGate` takes one argument; the exempt POST is 403.

- [ ] **Step 3: Add the predicate** — `apps/server/src/read-only-gate.ts`. Add `import type { Context } from "hono";` (beside the existing `MiddlewareHandler` import), extend the `readOnlyGate` doc block with the exemption rationale, and change the signature/body:

```typescript
export function readOnlyGate(
  isReadOnly: () => boolean,
  isExempt?: (c: Context) => boolean,
): MiddlewareHandler {
  return async (c, next) => {
    // The peer-sync source (membership rejoin R2) is the one write surface a read-only node legitimately
    // serves: the carrier POSTs `/sync-api/cursor` to report how far it has drained a fenced node's
    // tail — the disposal guard's only input. That surface is peer-Bearer-authenticated machine-to-
    // machine sync writing only `sync_cursor` (whole-DB operational state, no tenant_id, no RLS), never
    // a client tenant/fiscal write, which is what this fence exists to stop. `isExempt` lets boot pass
    // it through; absent, the gate is unchanged.
    if (isExempt?.(c) === true) return next();
    if (isReadOnly() && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
```

- [ ] **Step 4: Pass the exemption at the call site** — `apps/server/src/boot.ts:925`:

```typescript
      readOnlyGate(
        () => holders.mode.current === "mirror" || fenced,
        // Let the peer-authenticated sync source through the fence: a fenced node serves its own-origin
        // drain source (R2), and the carrier's cursor report (POST /sync-api/cursor) is how the disposal
        // guard learns its progress. A mirror mounts no /sync-api, so this is a no-op there.
        (c) => c.req.path.startsWith("/sync-api/"),
      ),
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `pnpm --filter @waitron/server test read-only-gate && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/read-only-gate.ts apps/server/src/read-only-gate.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): exempt the peer-sync surface from the read-only fence (drain cursor report)"
```

---

### Task 5: box-status `disposal` field + reader

Surface the at-risk / drained state so no box is junked blind (§5.1). Add a `disposal` field to `BoxStatus` and a `readDisposal` reader to `BoxStatusDeps`/`BoxStatusReaders`, collapsed by `collectBoxStatus`. `applicable:false` when the node is not fenced / no carrier (a serving node has no disposal state); `applicable:true` with the carrier id, the `drained` verdict, and the two seqs (bigint→string on the wire, per the `replication` precedent).

**Files:**
- Modify: `apps/server/src/box-status.ts` (wire shape + reader type + `collectBoxStatus` branch)
- Test: `apps/server/src/box-status.disposal.test.ts` (new — real Postgres, mirroring `box-status.replication.test.ts`)

**Interfaces:**
- Consumes: `DrainProgress` from `@waitron/sync` (Task 2).
- Produces:
  - `BoxStatus.disposal: { applicable: false } | { applicable: true; carrierNodeId: string; drained: boolean; ownTailSeq: string | null; carrierAppliedSeq: string | null }`
  - `type DisposalStatus = { carrierNodeId: string } & DrainProgress`
  - `BoxStatusReaders.disposal: (() => Promise<DisposalStatus>) | undefined`
  - `BoxStatusDeps.readDisposal: (() => Promise<DisposalStatus>) | undefined`

- [ ] **Step 1: Write the failing test** — `apps/server/src/box-status.disposal.test.ts`. Mirror `box-status.replication.test.ts` (provision a tenant + manager, log in, hit `GET /api/box/status`). Two cases: a wired `readDisposal` surfaces `applicable:true` with the verdict; an absent reader yields `applicable:false`. Reuse the login/build helpers' shape from the sibling suite.

```typescript
// Case A — a wired readDisposal (node fenced, carrier known) surfaces the drain state:
//   readDisposal: async () => ({ carrierNodeId: "carrier", drained: false, ownTailSeq: 100n, carrierAppliedSeq: 40n })
//   → status.disposal deep-equals
//     { applicable: true, carrierNodeId: "carrier", drained: false, ownTailSeq: "100", carrierAppliedSeq: "40" }
//   (bigint → string on the wire; a null seq stays null).
//
// Case B — no readDisposal (a serving, unfenced node) → status.disposal === { applicable: false }.
//
// Drive both through the real GET /api/box/status route so the collapse in collectBoxStatus is exercised
// (not collectBoxStatus directly), matching how box-status.replication.test.ts drives its assertions.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status.disposal`
Expected: FAIL — `disposal` is not on `BoxStatus`; `readDisposal` is not a dep.

- [ ] **Step 3: Add the wire shape + reader** — `apps/server/src/box-status.ts`.

Add the import (beside `SubscriberLag`):

```typescript
import type { DrainProgress, SubscriberLag } from "@waitron/sync";
```

Add the surfaced type (near the top-level types):

```typescript
/** The carrier a fenced node drains onto, plus its drain progress (membership rejoin R2). Only present
 * when the node is fenced and a carrier is known; a serving node reports `disposal.applicable:false`. */
export type DisposalStatus = { carrierNodeId: string } & DrainProgress;
```

Extend `BoxStatus` with a `disposal` member:

```typescript
  disposal:
    | { applicable: false }
    | {
        applicable: true;
        carrierNodeId: string;
        drained: boolean;
        ownTailSeq: string | null;
        carrierAppliedSeq: string | null;
      };
```

Add the reader to `BoxStatusReaders`:

```typescript
  disposal: (() => Promise<DisposalStatus>) | undefined;
```

Collapse it in `collectBoxStatus` (beside the `replication` block; bigint→string on the wire, `applicable:false` when the reader is absent):

```typescript
  let disposal: BoxStatus["disposal"] = { applicable: false };
  if (readers.disposal !== undefined) {
    const d = await readers.disposal();
    disposal = {
      applicable: true,
      carrierNodeId: d.carrierNodeId,
      drained: d.drained,
      ownTailSeq: d.ownTailSeq === null ? null : d.ownTailSeq.toString(),
      carrierAppliedSeq: d.carrierAppliedSeq === null ? null : d.carrierAppliedSeq.toString(),
    };
  }
```

Add `disposal` to the returned object, and to `BoxStatusDeps`:

```typescript
  readDisposal: (() => Promise<DisposalStatus>) | undefined;
```

Thread it in `mountBoxStatusApi`'s `collectBoxStatus({ ... })` call:

```typescript
        disposal: deps.readDisposal,
```

- [ ] **Step 4: Run test + coverage to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage box-status.disposal && pnpm --filter @waitron/server typecheck`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/box-status.ts apps/server/src/box-status.disposal.test.ts
git commit -s -m "feat(server): surface the disposal drain state on box-status"
```

---

### Task 6: Boot — mount the drain source on a fenced node + wire `readDisposal`

Tie it together. When the node is `fenced` (and sync is configured), mount the own-origin drain source instead of the full primary source, and wire the box-status `readDisposal` reader against the carrier named in the held membership document. The read-only-gate exemption (Task 4) is already in place, so the carrier's cursor report reaches the drain source.

**Files:**
- Modify: `apps/server/src/boot.ts` — the source-mount block (~1267) and the box-status wiring (~1498-1531); add imports `readDrainProgress` from `@waitron/sync` and `servingPrimaryNodeId` from `@waitron/membership`.
- Test: `apps/server/src/boot.fence.test.ts` (extend — real Postgres, the R1 fence harness with `enrolPeer`).

**Interfaces:**
- Consumes: `mountSyncApi(..., { ownOriginOnly: true })` (Task 3); `readDrainProgress` (Task 2); `servingPrimaryNodeId(heldMembership)` (Task 1); the boot-scope `fenced` const + `heldMembership` (R1, boot.ts:842-843); `lagPool` / `withTenant` (existing).

- [ ] **Step 1: Write the failing test** — extend `apps/server/src/boot.fence.test.ts`. Reuse its Case-A fenced boot (a held `sell-only` document for this node). Add:

```typescript
// Case D — a fenced node serves an own-origin drain source and surfaces disposal on box-status:
//   1. Provision a primary; seed a node_membership document that lists THIS node 'sell-only' and a
//      SECOND node 'serving-primary' (the carrier) — so boot fences AND servingPrimaryNodeId resolves.
//   2. enrolPeer a peer (the carrier) in this node's sync_peers so its Bearer authenticates.
//   3. Boot the fenced server.
//   4. GET /sync-api/hello with the carrier's Bearer → 200 (the drain source is mounted on a fenced
//      node, which R1 alone did not do). GET /sync-api/log?originId=<self>&after=0 → 200.
//   5. POST /sync-api/cursor with the carrier's Bearer + a body → 200, NOT 403 — the read-only-gate
//      exemption (Task 4) lets the drain cursor report through the fence.
//   6. Seed an own-origin sync_log row and the carrier's matching sync_cursor, then GET /api/box/status
//      (as a logged-in manager) and assert `disposal.applicable === true`, `disposal.carrierNodeId`
//      is the carrier, and `disposal.drained` reflects the seeded cursor.
//   Negative control (extend Case B, the unfenced serving node): assert `disposal.applicable === false`
//   and that POST /sync-api/cursor is NOT specially exempt-relevant (an unfenced node has no fence).
```

Prove-by-deletion (CLAUDE.md §4), two guards: (a) remove the `else if (fenced) mountSyncApi(...)` branch → Case D step 4 (`/sync-api/hello` 200) fails; restore. (b) remove the `readDisposal` wiring → Case D step 6 (`disposal.applicable === true`) fails; restore.

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.fence`
Expected: FAIL — a fenced node mounts no source (`/sync-api/hello` 404), and box-status has no `disposal.applicable:true`.

- [ ] **Step 3: Add imports** — `apps/server/src/boot.ts`. Extend the `@waitron/sync` import with `readDrainProgress`, and the `@waitron/membership` import with `servingPrimaryNodeId` (the block already imports `shouldFenceRestart` from `./membership-fence.js` and membership types).

- [ ] **Step 4: Mount the drain source when fenced** — `apps/server/src/boot.ts`, extend the source-mount block at ~1267:

```typescript
    if (isSingletonPrimary) {
      mountSyncApi(
        app,
        { db: syncDb, tenantId: till.tenantId, nodeId: till.nodeId, environment: config.environment },
        log,
      );
    } else if (fenced) {
      // Membership rejoin R2 (design §6 step 3): a fenced (sell-only) node serves its OWN-ORIGIN tail so
      // the carrier can drain it, then wipe-and-restore in R3. `ownOriginOnly` forces originId=self, so a
      // fenced node can never relay another origin or act as a general source — the narrow reversal of
      // "a sell-only secondary must not source" above. It stays fully fenced otherwise: isSingletonPrimary
      // is false (submitter/reconciler/config-writer + retention stay off), and the read-only gate still
      // blocks tenant/fiscal writes (its /sync-api/ exemption lets only the peer cursor report through).
      mountSyncApi(
        app,
        {
          db: syncDb,
          tenantId: till.tenantId,
          nodeId: till.nodeId,
          environment: config.environment,
          ownOriginOnly: true,
        },
        log,
      );
    }
```

- [ ] **Step 5: Wire `readDisposal`** — `apps/server/src/boot.ts`, in the `mountBoxStatusApi({ ... })` deps (~1498-1531), after `readReplicationLag`:

```typescript
      // The producer-side disposal guard (membership rejoin R2, design §5.1): present only on a FENCED
      // node whose held document names a carrier (the serving-primary). Reads own-origin tail vs the
      // carrier's reported cursor on the SAME sync_tailer pool under withTenant the lag reader uses.
      // Absent (undefined) on a serving node → box-status reports disposal.applicable:false.
      readDisposal:
        lagPool !== undefined && fenced
          ? (() => {
              const carrierNodeId =
                heldMembership === null ? undefined : servingPrimaryNodeId(heldMembership);
              if (carrierNodeId === undefined) return undefined;
              return async () => ({
                carrierNodeId,
                ...(await withTenant(lagPool, till.tenantId, (tx) =>
                  readDrainProgress(tx, { selfNodeId: till.nodeId, carrierNodeId }),
                )),
              });
            })()
          : undefined,
```

(`heldMembership` is the R1 boot-scope const from `readNodeMembership(db)` at boot.ts:842. The IIFE resolves the carrier once at boot — the fence is boot-captured, so the carrier is stable for the process; a new document restarts the box, R1.)

- [ ] **Step 6: Run test + coverage to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage boot.fence && pnpm --filter @waitron/server typecheck`
Expected: PASS (Cases A–D + control). Do BOTH prove-by-deletion checks from Step 1, then restore.

- [ ] **Step 7: Confirm the tail-preservation property + fiscal guard, then commit**

- Confirm retention stays off on a fenced node (no code change — `isSingletonPrimary` false at boot.ts:1383 already skips the sweep). If the fence harness makes it cheap, add one assertion that a fenced boot does not start the retention sweep (e.g. no `sync.retention_unconfigured` warn AND no prune) — otherwise record it as an existing property in the commit body.
- No new table → `inmutabilidad` / FORCE-RLS unaffected, but run the guard per CLAUDE.md §3: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (expected: unchanged green).

```bash
git add apps/server/src/boot.ts apps/server/src/boot.fence.test.ts
git commit -s -m "feat(server): fenced node serves its own-origin drain source + surfaces disposal"
```

---

### Task 7: Backlog update + whole-workspace verification

**Files:**
- Modify: `docs/backlog.md` (the membership arc — mark Slice 6 R2 landed/in-flight, record R3 + Slice 7 residuals).

- [ ] **Step 1: Run the full gate over every touched package**

```bash
pnpm --filter @waitron/membership test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: all green. `apps/server` UNFILTERED (not name-filtered) so cross-cutting guard suites load (CLAUDE.md §2). Also run the whole workspace's suites once (`TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test:coverage` or via the pre-push hook) — Task 2 adds `SYNC_LANES`, and a hardcoded lane list elsewhere would only surface unfiltered (CLAUDE.md §2 "hardcoded cross-package list").

- [ ] **Step 2: Update the backlog** — `docs/backlog.md`, the membership arc (Slice 6): mark **R2 (drain-as-source + disposal guard) LANDED** with what shipped, and record the residuals:
  - **R3 (wipe-and-restore, spec §6 step 4)** — GATED on the backup regime (`pg_restore` consumer + `sync_log`-in-backup); unbuilt. Also carries the `evicted` producer (the `sell-only`→`evicted` membership edit + retire action) — R2 leaves the node `sell-only` and mints no document.
  - **Slice 7 (conflict surface)** — ops conflict-log + primary-wins config; not started.
  - Note the R2 mechanism: own-origin drain source (`ownOriginOnly` on `mountSyncApi`); producer-side `readDrainProgress` guard (own tail vs the carrier's reported `sync_cursor`, per lane); box-status `disposal` field; the read-only-gate `/sync-api/` exemption; carrier = the `serving-primary` in the held doc.
  - Cloud-as-carrier remains out of scope (relay-vs-sink open item, parent §9).

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): membership rejoin Slice 6 R2 (drain + disposal guard) landed; R3 residuals"
```

---

## Self-Review

**Spec coverage (rejoin §6 step 3 + §5.1 disposal):**
- §6 step 3 "the current primary pulls `originId = Server 1` … until the tail is fully drained" → Task 3 (own-origin drain source) + Task 6 (mount it on a fenced node) + Task 4 (cursor report reaches it through the fence); the carrier's pull loop is unchanged (decision 3). ✓
- §5.1 disposal guard "the node proves this locally (its replication cursor vs its own latest `sync_log.seq`)" + the 2026-09-04 "carrier, not any survivor" tightening → Task 2 (`readDrainProgress`, per-lane, against the carrier's reported cursor) + Task 1 (carrier = the `serving-primary` in the held doc). ✓
- §5.1 "the ops surface shows the at-risk state continuously so no box is junked blind" → Task 5 (box-status `disposal`) + Task 6 (wired only when fenced). ✓
- Out of scope, recorded (Task 7): R3 wipe-and-restore, the `evicted` producer + retire action (node stays `sell-only`), Slice 7 conflict surface, cloud-as-carrier. ✓

**Placeholder scan:** No TBD/TODO. Every code step carries real code. The two intentionally-descriptive spots — Task 3's seeding "copy the existing `/log` test's `connectAs`/`set_config` pattern" and Tasks 5/6's case pseudocode — point at a concrete sibling test to copy verbatim (`sync-api.rls.test.ts`'s `/log` seeding; `box-status.replication.test.ts`'s login/build/seed), matching the repo's own test-harness reuse.

**Type consistency:** `servingPrimaryNodeId` (Task 1) → boot's `carrierNodeId` (Task 6). `SYNC_LANES`/`readDrainProgress`/`DrainProgress` (Task 2) → box-status `DisposalStatus = { carrierNodeId } & DrainProgress` (Task 5) → boot's `readDisposal` closure returning exactly that shape (Task 6). `SyncApiDeps.ownOriginOnly?: boolean` (Task 3) → boot's fenced mount (Task 6). `readOnlyGate(isReadOnly, isExempt?)` (Task 4) → boot's two-arg call (Task 4 step 4). `readDrainProgress` runs under `withTenant` on `lagPool` (`sync_tailer`), which holds SELECT on `sync_log` + `sync_cursor` (`0000_sync_outbox.sql:92,109`) — the same pool/context `lagFor` uses, so no new grant.

**No migration / fiscal guards:** confirmed no schema change — serves/reads existing `sync_log`/`sync_cursor`/`node_membership`; `inmutabilidad`/FORCE-RLS/`english-only` unaffected (all standings already English). Fiscal-adjacent → owner sign-off before land (do not self-land).
