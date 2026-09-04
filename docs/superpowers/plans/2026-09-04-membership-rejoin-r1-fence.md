# Membership Rejoin — Slice 6 R1 (Fence-on-rejoin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A returned/superseded node that holds (or adopts) a membership document marking it `sell-only`/`evicted` stops acting as primary — it relinquishes the singleton duties and goes fully read-only (no sales, no filing, no config writes) — closing the split-brain / partitioned-not-dead fiscal danger before the box is later drained (R2) and wiped-and-restored (R3).

**Architecture:** The fence signal is **membership-standing-driven**, not axis-driven — because `mode=mirror` hard-requires a `mirror_config` (boot.ts:867) and `singleton_role=secondary` is already an *active-selling* local secondary (Slice 5), neither can represent "fenced". At boot the node reads its held `node_membership` document, computes `fenced = own standing ∈ {sell-only, evicted}`, and if fenced **reconciles the deployment axes** (demote-only: `singleton_role → secondary`, so the existing `isSingletonPrimary` worker gates naturally suppress the submitter/reconciler/config-writer) and **mounts the read-only gate**. When the superseding document instead arrives via gossip *while the node runs as primary*, the `adoptMembership` callback triggers **restart-into-fenced** — the same next-tick `SIGTERM` R3b promotion uses — and the boot path fences on reboot.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle, Hono, Vitest. Packages: `@waitron/membership` (pure leaf), `@waitron/db`, `apps/server`.

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` (§6 rejoin steps 1–2, §7 config gate); parent `docs/superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md` (§5.1, §8.4). No separate R1 refinement spec was written (owner decision, 2026-09-04 — the design was settled in the brainstorm and folded into this plan's Architecture/Context).

## Global Constraints

- **Gate before push:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; CI shards run `test:coverage` — run `pnpm --filter <pkg> test:coverage` per touched package before claiming green (CLAUDE.md §2).
- **Coverage thresholds:** `@waitron/membership` and `@waitron/db` = 98/98/98/95; `apps/server` = 95/95/90/88.
- **Every commit `-s`** (DCO). Branch off `main`; feature work in a worktree.
- **No backwards-compat / no data migration** — nothing is deployed (CLAUDE.md §3). **This slice adds NO migration** — it reads existing `node_membership` + `deployment`; no schema change, so no RLS/`inmutabilidad`/FORCE-RLS concern.
- **Identifiers English; Spanish only as fiscal vocabulary** (english-only guard). All standing values are already English.
- **`@waitron/membership` is a pure leaf** (deps: `@waitron/shared` only) — the fence predicates must stay pure (no db/crypto/side-effects) and 100%-covered.
- **Owner-role writes:** `deployment` UPDATEs run on the owner pool (`createPostgresDb(config.migrationsDatabaseUrl)`), never `app_user` — the same dev-correct pattern R3b promote uses (`withOwnerDb`, boot.ts:1632); the real runtime-admin connection is deferred with break-glass, unchanged by this slice.
- **Fiscal-adjacent → owner sign-off before land** (backlog). Do not self-land.

---

### Task 1: Pure fence predicates in `@waitron/membership`

Two pure lookups over a held document. `standingOf` returns a node's standing; `isFencedStanding` classifies a standing as fenced. Kept in their own file (single responsibility: *reading* standings, distinct from `standings.ts` which *produces* them).

**Files:**
- Create: `packages/membership/src/fence.ts`
- Modify: `packages/membership/src/index.ts` (add two exports)
- Test: `packages/membership/src/fence.test.ts`

**Interfaces:**
- Consumes: `NodeStanding`, `SignedMembershipDocument` from `./types.js`.
- Produces:
  - `standingOf(document: SignedMembershipDocument, nodeId: string): NodeStanding | undefined`
  - `isFencedStanding(standing: NodeStanding | undefined): boolean`

- [ ] **Step 1: Write the failing test** — `packages/membership/src/fence.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { isFencedStanding, standingOf } from "./fence.js";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "./types.js";

const doc = (nodes: readonly MembershipNode[]): SignedMembershipDocument => ({
  body: { term: 1, nodes },
  signerNodeId: "n1",
  signature: "sig",
  endorsements: [],
});
const node = (nodeId: string, standing: NodeStanding): MembershipNode => ({
  nodeId,
  contactUrl: "",
  standing,
});

describe("standingOf", () => {
  it("returns the node's standing when present", () => {
    expect(standingOf(doc([node("n1", "sell-only")]), "n1")).toBe("sell-only");
  });
  it("returns undefined when the node is absent from the chart", () => {
    expect(standingOf(doc([node("n2", "serving-primary")]), "n1")).toBeUndefined();
  });
});

describe("isFencedStanding", () => {
  it("fences sell-only and evicted", () => {
    expect(isFencedStanding("sell-only")).toBe(true);
    expect(isFencedStanding("evicted")).toBe(true);
  });
  it("does not fence serving roles or an absent node", () => {
    expect(isFencedStanding("serving-primary")).toBe(false);
    expect(isFencedStanding("serving-secondary")).toBe(false);
    expect(isFencedStanding(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/membership test fence`
Expected: FAIL — `Cannot find module './fence.js'`.

- [ ] **Step 3: Write minimal implementation** — `packages/membership/src/fence.ts`

```typescript
import type { NodeStanding, SignedMembershipDocument } from "./types.js";

/**
 * This node's standing in a held document, or `undefined` when the node is absent from the chart
 * (design §3). A pure lookup over `document.body.nodes` — no verification: the held document was
 * verified when it was adopted (membership-adopt.ts) or self-signed at promotion, so reading it back
 * for a role decision is reading our own authoritative state, exactly as the deployment axes are.
 */
export function standingOf(
  document: SignedMembershipDocument,
  nodeId: string,
): NodeStanding | undefined {
  return document.body.nodes.find((n) => n.nodeId === nodeId)?.standing;
}

/**
 * Whether a standing fences a node OUT OF SERVING (design §3): `sell-only` (fenced, still a
 * replication source until its tail drains) and `evicted` (drained, retired) are fenced;
 * `serving-primary` and `serving-secondary` both serve (a serving-secondary sells, holds no
 * singletons). An `undefined` standing — a node ABSENT from the chart — is NOT fenced: promotion's
 * `nextStandings` preserves every node and demotes the outgoing primary to `sell-only` rather than
 * dropping it (standings.ts), so a node that was ever in the chart stays in it; fencing an unnamed
 * node on an incomplete chart would be the wrong direction. R1 recognises `evicted` defensively
 * though nothing produces it yet — eviction is a later round.
 */
export function isFencedStanding(standing: NodeStanding | undefined): boolean {
  return standing === "sell-only" || standing === "evicted";
}
```

- [ ] **Step 4: Add the two exports** — `packages/membership/src/index.ts`, immediately after the `export { nextStandings } from "./standings.js";` line:

```typescript
export { standingOf, isFencedStanding } from "./fence.js";
```

- [ ] **Step 5: Run test + coverage to verify pass**

Run: `pnpm --filter @waitron/membership test:coverage`
Expected: PASS; `fence.ts` at 100% (leaf package threshold 98/98/98/95).

- [ ] **Step 6: Commit**

```bash
git add packages/membership/src/fence.ts packages/membership/src/fence.test.ts packages/membership/src/index.ts
git commit -s -m "feat(membership): pure fence predicates (standingOf, isFencedStanding)"
```

---

### Task 2: Generalize `readOnlyGate` to a boolean predicate (behavior-preserving)

The gate currently keys on `getMode() === "mirror"`. A fenced ex-primary keeps `mode=primary`, so the gate must fire on a general "is this node read-only right now?" predicate. This task changes only the signature and the existing call site — behavior is identical (the mirror still gates); the fence term is added in Task 4.

**Files:**
- Modify: `apps/server/src/read-only-gate.ts` (signature + check + drop the `DeploymentMode` import + the doc comment on `readOnlyGate`)
- Modify: `apps/server/src/boot.ts:826` (call site)
- Test: `apps/server/src/read-only-gate.test.ts`

**Interfaces:**
- Produces: `readOnlyGate(isReadOnly: () => boolean): MiddlewareHandler` — returns 403 `node.read_only` on any non-`GET/HEAD/OPTIONS` verb when `isReadOnly()` is true; pass-through otherwise.

- [ ] **Step 1: Update the existing test to the new signature** — `apps/server/src/read-only-gate.test.ts`. Wherever the tests build the gate as `readOnlyGate(() => "mirror")` / `readOnlyGate(() => "primary")`, change them to a boolean predicate, and keep every behavioral assertion:

```typescript
// read-only (was: () => "mirror")
const gate = readOnlyGate(() => true);
// pass-through (was: () => "primary")
const gate = readOnlyGate(() => false);
```

Add one assertion pinning the generalization — a POST is refused when the predicate is true and allowed when false (mirroring the existing mirror/primary cases). Do not delete the existing verb-matrix assertions (GET/HEAD/OPTIONS pass, POST/PUT/PATCH/DELETE 403) — they are the behavioral contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test read-only-gate`
Expected: FAIL — the gate still expects a `DeploymentMode`-returning function / type error.

- [ ] **Step 3: Update the implementation** — `apps/server/src/read-only-gate.ts`. Remove `import type { DeploymentMode } from "@waitron/db";`, and change the exported function (keep the file's long altitude comment; update only the `readOnlyGate` doc block and body):

```typescript
/**
 * Refuses every write verb when `isReadOnly()` is true. Read PER REQUEST (not captured once) so a
 * live mirror→primary promotion — `deployment.mode = 'primary'` + a refresh of the holder boot passes
 * in — opens every write route without a restart (design §10). Boot builds the predicate; today it is
 * `() => holders.mode.current === "mirror" || fenced` — a read-only MIRROR, or a FENCED returned
 * ex-primary that adopted a superseding sell-only/evicted document (membership rejoin R1, design §6).
 * On an unfenced primary it is a pure pass-through.
 *
 * Returns the error-boundary response shape directly (`{ error: { code, params } }`) rather than
 * throwing: a Hono middleware is not inside a route's `createErrorBoundary` wrapper; the code is built
 * through `AppError` so `tsc` checks it and `import "./errors.js"` keeps it reachable.
 */
export function readOnlyGate(isReadOnly: () => boolean): MiddlewareHandler {
  return async (c, next) => {
    if (isReadOnly() && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
```

- [ ] **Step 4: Update the call site** — `apps/server/src/boot.ts:826`, behavior-preserving for now:

```typescript
      readOnlyGate(() => holders.mode.current === "mirror"),
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `pnpm --filter @waitron/server test read-only-gate && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/read-only-gate.ts apps/server/src/read-only-gate.test.ts apps/server/src/boot.ts
git commit -s -m "refactor(server): readOnlyGate takes a boolean predicate, not a mode getter"
```

---

### Task 3: App-level fence decision helpers

Two thin, pure helpers over an already-read document: `isFenced` (the boot fence signal, null-safe) and `shouldFenceRestart` (the runtime restart decision). Both live in `apps/server` because they compose the `@waitron/membership` predicates with app-side null handling and the boot/runtime distinction.

**Files:**
- Create: `apps/server/src/membership-fence.ts`
- Test: `apps/server/src/membership-fence.test.ts`

**Interfaces:**
- Consumes: `isFencedStanding`, `standingOf`, `SignedMembershipDocument` from `@waitron/membership` (Task 1).
- Produces:
  - `isFenced(held: SignedMembershipDocument | null, nodeId: string): boolean`
  - `shouldFenceRestart(bootFenced: boolean, document: SignedMembershipDocument, nodeId: string): boolean`

- [ ] **Step 1: Write the failing test** — `apps/server/src/membership-fence.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import { isFenced, shouldFenceRestart } from "./membership-fence.js";

const node = (nodeId: string, standing: NodeStanding): MembershipNode => ({
  nodeId,
  contactUrl: "",
  standing,
});
const doc = (nodes: readonly MembershipNode[]): SignedMembershipDocument => ({
  body: { term: 2, nodes },
  signerNodeId: "n2",
  signature: "sig",
  endorsements: [],
});

describe("isFenced", () => {
  it("is false when no document is held", () => {
    expect(isFenced(null, "n1")).toBe(false);
  });
  it("is true when this node's standing is sell-only", () => {
    expect(isFenced(doc([node("n1", "sell-only"), node("n2", "serving-primary")]), "n1")).toBe(true);
  });
  it("is false when this node still serves", () => {
    expect(isFenced(doc([node("n1", "serving-primary")]), "n1")).toBe(false);
  });
});

describe("shouldFenceRestart", () => {
  it("restarts when an unfenced node adopts a document that fences it", () => {
    expect(shouldFenceRestart(false, doc([node("n1", "sell-only")]), "n1")).toBe(true);
  });
  it("does not restart when the adopted document does not fence this node", () => {
    expect(shouldFenceRestart(false, doc([node("n1", "serving-primary")]), "n1")).toBe(false);
  });
  it("does not restart a node already fenced at boot", () => {
    expect(shouldFenceRestart(true, doc([node("n1", "sell-only")]), "n1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test membership-fence`
Expected: FAIL — `Cannot find module './membership-fence.js'`.

- [ ] **Step 3: Write minimal implementation** — `apps/server/src/membership-fence.ts`

```typescript
import {
  isFencedStanding,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";

/**
 * Whether THIS node is fenced (sell-only/evicted) by the currently-held membership document
 * (design §6). A `null` document — a node that has never adopted one — is not fenced. Pure over an
 * already-read document; the boot path reads `node_membership` (`readNodeMembership`) and passes the
 * blob here.
 */
export function isFenced(held: SignedMembershipDocument | null, nodeId: string): boolean {
  if (held === null) return false;
  return isFencedStanding(standingOf(held, nodeId));
}

/**
 * Whether adopting `document` at runtime should trigger a restart-into-fenced (design §6 step 2):
 * true iff this node was NOT already fenced at boot and the newly-adopted document now fences it. A
 * node already fenced at boot is running fenced, so re-adopting a fencing document changes nothing.
 */
export function shouldFenceRestart(
  bootFenced: boolean,
  document: SignedMembershipDocument,
  nodeId: string,
): boolean {
  return !bootFenced && isFenced(document, nodeId);
}
```

- [ ] **Step 4: Run test + coverage to verify pass**

Run: `pnpm --filter @waitron/server test:coverage membership-fence`
Expected: PASS; both helpers fully covered.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/membership-fence.ts apps/server/src/membership-fence.test.ts
git commit -s -m "feat(server): isFenced + shouldFenceRestart membership decision helpers"
```

---

### Task 4: Boot — reconcile axes to a held fence + mount the read-only gate

At boot, after reading the deployment axes, read the held membership document, compute `fenced`, reconcile the axes (demote-only) when a fenced node still shows `singleton_role='primary'`, and mount the read-only gate when `isMirror || fenced` — decoupled from the mirror-only `ensureMirrorViewer`/`mirrorSession` block.

**Files:**
- Modify: `apps/server/src/boot.ts` — the axes/holders block (≈782–800) and the read-only-gate mount block (≈823–838); add imports `readNodeMembership`, `setSingletonRole` from `@waitron/db` and `isFenced` from `./membership-fence.js`.
- Test: `apps/server/src/boot.fence.test.ts` (new, real-Postgres — deployment axes owner write + `node_membership` require a real backend; PGlite is a superuser and cannot show the owner/app split — CLAUDE.md §4). Mirror the harness of `boot.promote.test.ts`.

**Interfaces:**
- Consumes: `isFenced` (Task 3); `readNodeMembership(db)`, `setSingletonRole(ownerDb, "secondary")`, `readDeploymentAxes(db)`, `createDeploymentHolders(mode, role)` (existing); `readOnlyGate(() => boolean)` (Task 2); `createPostgresDb` (existing).
- Produces: `fenced: boolean` boot-scope const, in scope from the axes block through the mount block and the Task 5 `adoptMembership` callback.

- [ ] **Step 1: Write the failing test** — `apps/server/src/boot.fence.test.ts`. Two cases against a real Postgres container. Use the existing boot test harness (import the same helpers `boot.promote.test.ts` uses to start a server, seed a tenant/till, and stamp deployment). Pseudocode-precise:

```typescript
// Case A — a held sell-only document for THIS node fences it at boot:
//   1. Provision a primary (deployment stamped, singleton_role='primary'), seed a `node_membership`
//      row whose document lists this node's id with standing 'sell-only' (self-signed via the
//      membership build/sign test helpers, or write the blob directly — the fence read is unverified).
//   2. Boot the server.
//   3. Assert `readDeploymentAxes(db)` now returns singletonRole === 'secondary' (reconciled).
//   4. Assert a write verb is refused: POST to any mutating route returns 403 `node.read_only`.
//   5. Assert the singleton source is NOT mounted: GET /sync-api/log returns 404 (mountSyncApi gates
//      on isSingletonPrimary, now false) — the workers are suppressed by the reconciled axis.

// Case B — a held serving-primary document does NOT fence:
//   1. Same provision, but the seeded document lists this node as 'serving-primary'.
//   2. Boot.
//   3. Assert singletonRole stays 'primary', a POST write is NOT 403 (routes open), and
//      GET /sync-api/log is mounted (200/valid) — the unfenced control.
```

Prove the guard by deletion (CLAUDE.md §4): after Case A is green, temporarily remove the reconciliation write and confirm Case A's assertion 3 (singletonRole==='secondary') fails, then restore.

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.fence`
Expected: FAIL — no reconciliation happens; singleton_role stays 'primary' and writes are not gated.

- [ ] **Step 3: Add imports** — `apps/server/src/boot.ts`. Extend the existing `@waitron/db` import block (the one already bringing in `readDeploymentAxes`, `readMembershipTrustSet`) with `readNodeMembership` and `setSingletonRole`, and add near the other `./`-local imports:

```typescript
import { isFenced } from "./membership-fence.js";
```

- [ ] **Step 4: Reconcile the axes** — replace the axes/holders block at `apps/server/src/boot.ts:782-784`:

```typescript
  const axes = await readDeploymentAxes(db);
  const holders = createDeploymentHolders(axes.mode, axes.singletonRole);
  const isMirror = holders.mode.current === "mirror";
```

with:

```typescript
  // Membership rejoin R1 (design §6): a returned ex-primary that holds a superseding document marking
  // it sell-only/evicted must come up FENCED, not as the primary its saved axes still claim. The held
  // document is authority above the persisted axes (wire-protocol §8), and the reconciliation is
  // DEMOTE-ONLY — it can never self-promote. Read UNVERIFIED: the row was verified when adopted
  // (membership-adopt.ts) or self-signed at promotion, so reading our own authoritative state back
  // needs no re-verify, exactly as the deployment axes are trusted.
  const heldMembership = await readNodeMembership(db);
  const fenced = isFenced(heldMembership, config.till.nodeId);
  let axes = await readDeploymentAxes(db);
  if (fenced && axes.singletonRole === "primary") {
    // Demote the singleton axis on the OWNER pool (app_user holds no UPDATE on deployment) — the same
    // dev-correct migrationsDatabaseUrl owner-write R3b promote uses (withOwnerDb). Idempotent: a
    // second fenced boot already reads 'secondary' and skips. mode stays 'primary' — the (primary,
    // secondary) pair is valid (deployment_role_valid_ck); the read-only gate below, not the mode,
    // enforces the fence. This stops the submitter/reconciler/config-writer via their existing
    // isSingletonPrimary gates with no worker-gating code change.
    const ownerDb = await createPostgresDb(config.migrationsDatabaseUrl);
    try {
      await setSingletonRole(ownerDb, "secondary");
    } finally {
      await ownerDb.close();
    }
    axes = await readDeploymentAxes(db);
  }
  const holders = createDeploymentHolders(axes.mode, axes.singletonRole);
  const isMirror = holders.mode.current === "mirror";
```

(Note: `axes` becomes a `let` because the fenced path re-reads it. `heldMembership` is reused by Task 5's callback if convenient, but the callback recomputes off the freshly-adopted document, so it does not depend on this binding.)

- [ ] **Step 5: Mount the read-only gate on `isMirror || fenced`** — restructure `apps/server/src/boot.ts:823-838`. Change the guard so the gate mounts for a fenced primary too, while the mirror-only viewer/session stay under `isMirror`:

```typescript
  if (isMirror || fenced) {
    app.use(
      "*",
      // A mirror gates by mode (per-request, so a live promotion lifts it, design §10); a fenced
      // returned ex-primary (membership rejoin R1) gates on the boot-captured `fenced` — it leaves the
      // fence only by the wipe-and-restore of a later round, which is a fresh boot anyway.
      readOnlyGate(() => holders.mode.current === "mirror" || fenced),
    );
  }
  if (isMirror) {
    try {
      await ensureMirrorViewer(db, config.till.tenantId);
    } catch (error) {
      await db.close();
      throw error;
    }
    app.use(
      "*",
      mirrorSession(db, config.till.tenantId, config.tls !== undefined, () => holders.mode.current),
    );
  }
```

- [ ] **Step 6: Run test + typecheck to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.fence && pnpm --filter @waitron/server typecheck`
Expected: PASS (both cases). Do the prove-by-deletion check from Step 1, then restore.

- [ ] **Step 7: Run the fiscal-isolation guard is untouched (no new table), then commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.fence.test.ts
git commit -s -m "feat(server): fence a returned node at boot from a held sell-only membership doc"
```

---

### Task 5: Boot — restart-into-fenced when a superseding document arrives via gossip

When the node is running unfenced (was serving-primary this boot) and the pull worker adopts a strictly-newer document that fences it, schedule a next-tick `SIGTERM` so the box reboots into the fenced posture (Task 4 fences on reboot). Same restart mechanism as R3b promotion (boot.ts:1743).

**Files:**
- Modify: `apps/server/src/boot.ts` — the `adoptMembership` callback (≈1200–1209); add `shouldFenceRestart` to the `./membership-fence.js` import.
- Test: `apps/server/src/boot.fence.test.ts` (extend) — spy `process.kill` via the existing `withMockedKill` pattern (boot.test.ts:438) so no real SIGTERM fires (CLAUDE.md §4).

**Interfaces:**
- Consumes: `shouldFenceRestart(bootFenced, document, nodeId)` (Task 3); the boot-scope `fenced` const (Task 4); `config.till.nodeId`; the `outcome.document` from `adoptMembershipDocument`.

- [ ] **Step 1: Write the failing test** — extend `apps/server/src/boot.fence.test.ts` with a runtime case:

```typescript
// Case C — an unfenced running primary adopts a superseding sell-only document → schedules a restart:
//   1. Provision a primary; seed a held document listing this node 'serving-primary' (so boot's
//      `fenced` is false and the node runs as primary).
//   2. Configure WAITRON_SYNC_PEERS with a stub peer whose /sync-api/hello advertises a strictly-newer
//      document (higher term) marking this node 'sell-only', signed by a key in the node's trust set
//      (reuse the membership document/e2e fixtures — see membership-gossip.e2e.test.ts).
//   3. Spy process.kill (withMockedKill). Boot; drive one pull tick.
//   4. Assert the adopt persisted (node_membership term bumped) AND process.kill was called with
//      (process.pid, "SIGTERM") — the scheduled next-tick restart-into-fenced.
//   Negative control: when the advertised document keeps this node 'serving-primary', assert
//   process.kill was NOT called.
```

If wiring a full stub-peer pull tick is heavy in this suite, the branch logic is already unit-proven by `shouldFenceRestart` (Task 3); still add at least the positive Case C so the `process.kill` line itself is executed (coverage), mirroring `boot.promote.test.ts`'s killSpy assertion (boot.promote.test.ts:507-509).

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.fence`
Expected: FAIL — no restart is scheduled on a fencing adopt.

- [ ] **Step 3: Extend the import** — `apps/server/src/boot.ts`:

```typescript
import { isFenced, shouldFenceRestart } from "./membership-fence.js";
```

- [ ] **Step 4: Wire the restart** — `apps/server/src/boot.ts`, in the `adoptMembership` callback, replace the accept log at 1208:

```typescript
      if (outcome.accepted) {
        log("info", "membership.adopted", { term: outcome.document.body.term });
        // Membership rejoin R1 (design §6 step 2): if this document fences THIS node while it is
        // running unfenced (was serving-primary this boot), restart into the fenced posture — the boot
        // path (reconcile axes + mount the read-only gate) applies on reboot. Same next-tick SIGTERM
        // R3b promotion uses (boot.ts): fire on the NEXT tick so the pull loop's tick returns first;
        // the supervisor reboots the box. `requestRestart` is only wired in the setup branch, so the
        // inline process.kill form is used here, as the mirror promote does.
        if (shouldFenceRestart(fenced, outcome.document, config.till.nodeId)) {
          log("info", "membership.fenced_restart", { term: outcome.document.body.term });
          setTimeout(() => process.kill(process.pid, "SIGTERM"), 0);
        }
      }
```

- [ ] **Step 5: Run test + coverage to verify pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage boot.fence`
Expected: PASS; the restart branch executed under the kill spy.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.fence.test.ts
git commit -s -m "feat(server): restart-into-fenced when a superseding membership doc arrives via gossip"
```

---

### Task 6: Backlog update + whole-package verification

**Files:**
- Modify: `docs/backlog.md` (the membership arc — mark Slice 6 R1 landed, record R2/R3 residuals).

- [ ] **Step 1: Run the full gate over every touched package**

```bash
pnpm --filter @waitron/membership test:coverage
pnpm --filter @waitron/db test:coverage        # exports touched? (no code change — sanity only)
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: all green. `apps/server` unfiltered (not name-filtered) so cross-cutting guard suites load (CLAUDE.md §2).

- [ ] **Step 2: Update the backlog** — in `docs/backlog.md`, the membership arc (around line 584): mark **Slice 6 R1 (fence-on-rejoin) LANDED**, and record the carry-forwards for later rounds:
  - **R2 (drain-as-source + disposal guard)** — enrol the returned node as a peer the primary pulls with `originId=<returned>`; build the producer-side disposal guard (own `origin_id=self` tail drained onto the node that carries the partition forward — spec §5.1 note settles "the carrier", not "any survivor"); surface on box-status.
  - **R3 (wipe-and-restore, spec §6 step 4)** — GATED on the backup regime (`pg_restore` consumer + `sync_log`-in-backup); unbuilt.
  - **Slice 7 (conflict surface)** — ops conflict-log + primary-wins config; not started.
  - **Bounded residual (accepted, §8.4):** on the first boot after returning, the node runs as its stale-held-doc primary until the pull delivers the superseding doc and restarts it (≈ one pull interval). Deliberately not boot-into-read-only-until-confirmed — that would black out a genuinely isolated returning node with no reachable peer (§5.1).
  - **`nextStandings` still never emits `evicted`** — R1 only reacts to `sell-only`; the eviction producer lands with R2/R3.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): membership rejoin Slice 6 R1 (fence-on-rejoin) landed; R2/R3 residuals"
```

---

## Self-Review

**Spec coverage (design §6 steps 1–2, §7 config gate):**
- §6 step 1 "boot & re-resolve" → Task 4 (read held doc, reconcile axes). ✓
- §6 step 2 "learn superseded → relinquish singletons, never file/config-write while superseded" → Task 4 (demote → `isSingletonPrimary` false suppresses submitter/reconciler/config-writer) + read-only gate blocks config-write verbs; Task 5 (runtime restart-into-fenced). ✓
- §7 "config-class writes never accepted on a non-primary" enforcement escape-window → Task 4 read-only gate (blocks *all* write verbs on a fenced node, a superset of config). ✓ (The ops conflict *surface* is Slice 7, explicitly deferred — Task 6.)
- §6 steps 3–4 (drain, wipe-restore) → out of scope (R2/R3), recorded in Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code. The one intentionally-light spot is Task 5's stub-peer pull wiring (heavy harness) — mitigated by the `shouldFenceRestart` unit proof (Task 3) plus a positive Case C that executes the `process.kill` line under a spy; this matches the repo's accepted treatment of the `adoptMembership` wrapper (#202 follow-up d) and R3b's killSpy restart test.

**Type consistency:** `standingOf`/`isFencedStanding` (Task 1) ↔ `isFenced`/`shouldFenceRestart` (Task 3) ↔ boot `fenced` const + callback (Tasks 4/5). `readOnlyGate(() => boolean)` (Task 2) matches both call sites. `setSingletonRole(ownerDb, "secondary")` and `readNodeMembership(db)` are the real `@waitron/db` barrel signatures (verified). `deployment_role_valid_ck` permits `(primary, secondary)` (0071), so the reconciliation write is legal.

**No migration / fiscal guards:** confirmed no schema change — `inmutabilidad`/FORCE-RLS/`english-only` unaffected (all standings already English).
