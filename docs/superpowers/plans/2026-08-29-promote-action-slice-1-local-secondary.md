# Promote action — Slice 1 (local secondary → primary, live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live in-process promote mechanism for the least-gated target — a local secondary
(`mode='primary'`, `singleton_role='secondary'`) claiming the venue singleton duties — so the fiscal
drain/reconcile pass starts on the next tick with **no process restart and no sale-path interruption**.

**Architecture:** A local secondary is already `mode='primary'` and already selling, so every mode-gated
worker is already running; the only state that moves is `singleton_role: secondary → primary`, and the
only worker gated on it — the fiscal pass — already reads its role through a per-pass holder
([singleton-pass.ts](../../../apps/server/src/singleton-pass.ts), wired at
[boot.ts:1096](../../../apps/server/src/boot.ts#L1096)). Promotion therefore reduces to: (1) refuse
without an operator fence attestation (spec §6), (2) write `singleton_role='primary'` on an owner
connection (spec §2 — an owner-role write; `app_user` holds no UPDATE on `deployment`), (3) refresh the
in-process holder so the running pass flips from the empty pass to the real drain on its next tick
(spec §3b/§3c). No routes are re-mounted (spec §3a — every route is already up). The mechanism is a pure,
injected-dependency function; boot exposes it as an **in-process method** on `StartedServer` (not a
network route — that, with its break-glass auth, is Slice 2).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Hono, Drizzle, Vitest. Postgres via
Testcontainers for the booted e2e; PGlite (`createPgliteDb` + `runMigrations`) for the pure-logic unit
tests. `@waitron/db` accessors (`readDeploymentMode`, `readSingletonRole`, `setSingletonRole`,
`stampDeployment`, `createPostgresDb`); `@waitron/shared` `AppError`.

**Spec:** [docs/superpowers/specs/2026-08-29-promotion-runbook-design.md](../specs/2026-08-29-promotion-runbook-design.md)
(APPROVED, landed 2026-08-29). This plan implements **only the local-secondary→primary target (spec
§5a)** and the mechanism it rests on (§3a–§3c, §6). The other three targets are gated on unbuilt
foundations and are recorded under **Deferred slices** at the end — each gets its own spec→plan when its
foundation lands.

## Global Constraints

- **Fiscal core — some mistakes are unrecoverable.** `singleton_role='primary'` makes this node the AEAT
  submitter; the point-of-no-return is claiming the submitter (spec §5a step 3 / §7). Everything before it
  (fence check) must abort with **zero lasting effect**.
- **The write is OWNER-role.** `setSingletonRole` runs on the provisioning/owner connection; `app_user`
  holds no UPDATE on `deployment` ([deployment.ts:90-95](../../../packages/db/src/deployment.ts#L90)). The
  app pool (`db`) is used only for the holder-refresh READ (`app_user` holds SELECT on `deployment`,
  granted by migration 0010).
- **`(mirror, primary)` is invalid** and rejected at the write boundary by `deployment_role_valid_ck`
  (migration 0071). This flow refuses a `mirror` node with a clean domain code *before* the write; the
  CHECK is the backstop.
- **Error codes name the DOMAIN CONCEPT, never the throwing package**, are lowercase dot-namespaced, and
  are **never renamed once shipped** ([errors.ts design note](../../../apps/server/src/errors.ts#L6);
  CLAUDE.md §3). New codes here are `promotion.*` (a new family; grep confirmed none exists).
- **No backfill / no bwc** (CLAUDE.md §3, pre-production). The `deployment` singleton row is inserted at
  runtime by `stampDeployment`, empty at migration time.
- **Prove every guard by deletion** (CLAUDE.md §4): remove the check, watch the test fail, restore.
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus
  `pnpm --filter @waitron/server test:coverage` (CI runs `test:coverage`, not `test` — CLAUDE.md §2).
  Coverage floor for `apps/server` is 95/95/90/88.
- **Testcontainers:** run the booted e2e with `TESTCONTAINERS_RYUK_DISABLED=true` (CLAUDE.md §4).

---

## Known limitations carried to Slice 2 (state them, do not paper over)

These are **deliberately out of scope** for Slice 1 and belong to the next slice. Do not build around
them or claim them done.

1. **No network endpoint, no break-glass auth.** Promotion is an in-process `StartedServer` method only,
   reachable by the process's own boot caller (`bin.ts`, tests) — never over the network, so there is no
   unauthenticated "become the submitter" surface. The authenticated endpoint + the break-glass
   secret that both authorizes it and unseals the cert key ring (spec §4) is Slice 2, gated on the
   break-glass mint (C2b/hosting wizard).
2. **The owner write uses `config.migrationsDatabaseUrl`.** That URL is the superuser in dev/CI (correct
   here) but **defaults to the app-role `databaseUrl`** when `WAITRON_MIGRATIONS_DATABASE_URL` is unset
   ([config.ts:596](../../../apps/server/src/config.ts#L596)), and [boot.ts:529](../../../apps/server/src/boot.ts#L529)
   already records that the *real* runtime admin connection "must be that admin, not
   `migrationsDatabaseUrl`; wiring it is deferred with the instance provisioning." Slice 1 uses it
   because the booted e2e runs with a superuser migrations URL and it matches the existing stamp-probe
   pattern ([boot.ts:431](../../../apps/server/src/boot.ts#L431)); wiring the real runtime admin
   connection is Slice 2.
3. **The key-ring unseal (spec §5a step 2) is not performed.** A local secondary today boots with the
   credential key ring already loaded (`loadKeyRing`), so a flip to `primary` submits with the
   already-available cert. Sealing the submitter cert until promote-time (so a secondary cannot hold an
   unsealed cert) is a hardening that rides with the break-glass work (Slice 2).

---

## File Structure

- **Create** `apps/server/src/deployment-holders.ts` — the typed refreshable-holder struct + the refresh
  primitive. One responsibility: hold and re-read the two `deployment` axes the running process gates on.
- **Create** `apps/server/src/deployment-holders.test.ts` — PGlite unit test of the refresh.
- **Create** `apps/server/src/promote.ts` — the fence gate + the idempotent local-secondary promote flow.
  One responsibility: the promote mechanism as pure, injected-dependency functions.
- **Create** `apps/server/src/promote.test.ts` — PGlite unit tests of fence/idempotency/mirror-guard/flip.
- **Create** `apps/server/src/boot.promote.test.ts` — the real-PG booted e2e (the spec §8 headline).
- **Modify** `apps/server/src/errors.ts` — register `promotion.fence_not_attested` and
  `promotion.not_a_local_secondary`.
- **Modify** `apps/server/src/boot.ts` — adopt the typed holders (Task 1); expose the promote method on
  `StartedServer` (Task 3).

---

## Task 1: Typed deployment holders + refresh primitive

Replace boot's two inline `{ current }` holders with one named, typed struct and a refresh function, so
the "designed for, not built" refresh seam ([boot.ts:640-646](../../../apps/server/src/boot.ts#L640))
lives in one testable place. Behaviour-preserving: the boot mirror suite must stay green.

**Files:**
- Create: `apps/server/src/deployment-holders.ts`
- Create: `apps/server/src/deployment-holders.test.ts`
- Modify: `apps/server/src/boot.ts:640-647` (holder creation) and its three read sites
  ([660](../../../apps/server/src/boot.ts#L660), [670](../../../apps/server/src/boot.ts#L670),
  [1097](../../../apps/server/src/boot.ts#L1097))

**Interfaces:**
- Consumes: `readDeploymentMode`, `readSingletonRole`, `DeploymentMode`, `SingletonRole`, `Database` from
  `@waitron/db`.
- Produces:
  - `interface DeploymentHolders { readonly mode: { current: DeploymentMode }; readonly singletonRole: { current: SingletonRole } }`
  - `function createDeploymentHolders(mode: DeploymentMode, singletonRole: SingletonRole): DeploymentHolders`
  - `function refreshDeploymentHolders(db: Database, holders: DeploymentHolders): Promise<void>`

- [ ] **Step 1: Write the failing test** — `apps/server/src/deployment-holders.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createPgliteDb,
  runMigrations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
} from "@waitron/db";
import { createDeploymentHolders, refreshDeploymentHolders } from "./deployment-holders.js";

// PGlite is sufficient here (CLAUDE.md §4): the refresh READS deployment (app_user holds SELECT — no
// role/RLS behaviour under test), and there is no concurrency. The owner-vs-app WRITE distinction is
// exercised by the real-PG booted e2e (Task 4), where it actually matters.
describe("refreshDeploymentHolders", () => {
  it("re-reads both axes from the database into the holder", async () => {
    const db = await createPgliteDb();
    await runMigrations(db);
    await stampDeployment(db, "preproduction"); // inserts the (primary, primary) singleton row
    await setSingletonRole(db, "secondary"); // a local secondary: (primary, secondary)

    // A holder built from a STALE snapshot...
    const holders = createDeploymentHolders("mirror", "primary");
    expect(holders.mode.current).toBe("mirror");
    expect(holders.singletonRole.current).toBe("primary");

    await refreshDeploymentHolders(db, holders);
    expect(holders.mode.current).toBe("primary");
    expect(holders.singletonRole.current).toBe("secondary");

    // ...and it tracks a subsequent write.
    await setSingletonRole(db, "primary");
    await refreshDeploymentHolders(db, holders);
    expect(holders.singletonRole.current).toBe("primary");

    await db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test deployment-holders -- --run`
Expected: FAIL — `Cannot find module './deployment-holders.js'` (or "createDeploymentHolders is not a function").

- [ ] **Step 3: Write the minimal implementation** — `apps/server/src/deployment-holders.ts`

```ts
import {
  readDeploymentMode,
  readSingletonRole,
  type Database,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";

/**
 * The two orthogonal `deployment` axes the running process gates on, each in a one-field cell read live
 * per request / per pass so a promotion is a genuine flag-flip with no restart (promotion runbook design
 * §3b). `mode` fronts the read-only gate + ambient viewer; `singletonRole` gates the fiscal drain/reconcile
 * pass (see `singletonPass`). Held together so the promote action refreshes both in one call.
 */
export interface DeploymentHolders {
  readonly mode: { current: DeploymentMode };
  readonly singletonRole: { current: SingletonRole };
}

/** Builds the holders from values already read at boot — no I/O. */
export function createDeploymentHolders(
  mode: DeploymentMode,
  singletonRole: SingletonRole,
): DeploymentHolders {
  return { mode: { current: mode }, singletonRole: { current: singletonRole } };
}

/**
 * Re-reads both axes from the database into the holders. The read runs on the app pool (`app_user` holds
 * SELECT on `deployment`, migration 0010); the promote action calls this AFTER its owner-role write so the
 * running gates and the fiscal pass observe the new state on their next tick (promotion runbook design §3b).
 */
export async function refreshDeploymentHolders(
  db: Database,
  holders: DeploymentHolders,
): Promise<void> {
  holders.mode.current = await readDeploymentMode(db);
  holders.singletonRole.current = await readSingletonRole(db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test deployment-holders -- --run`
Expected: PASS.

- [ ] **Step 5: Adopt the struct in boot.ts (behaviour-preserving refactor)**

In `apps/server/src/boot.ts`, add `createDeploymentHolders` to the `./deployment-holders.js` import, then
replace the two inline holders at [boot.ts:640-647](../../../apps/server/src/boot.ts#L640):

```ts
// was: const modeHolder = { current: await readDeploymentMode(db) };
//      const singletonRoleHolder = { current: await readSingletonRole(db) };
const holders = createDeploymentHolders(
  await readDeploymentMode(db),
  await readSingletonRole(db),
);
const isMirror = holders.mode.current === "mirror";
```

Then update the three read sites, keeping the existing comments:
- [boot.ts:660](../../../apps/server/src/boot.ts#L660): `readOnlyGate(() => holders.mode.current)`
- [boot.ts:670](../../../apps/server/src/boot.ts#L670): `mirrorSession(db, config.till.tenantId, config.tls !== undefined, () => holders.mode.current)`
- [boot.ts:1097](../../../apps/server/src/boot.ts#L1097): `singletonPass(() => holders.singletonRole.current, (at) => ...)`

- [ ] **Step 6: Verify the refactor is behaviour-preserving**

Run: `pnpm --filter @waitron/server test boot.mirror -- --run`
(Requires Docker + `TESTCONTAINERS_RYUK_DISABLED=true`.)
Expected: PASS — the mirror read-only gate, ambient viewer, and singleton-gated pass all still behave as
before. Also run `pnpm --filter @waitron/server typecheck`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/deployment-holders.ts apps/server/src/deployment-holders.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): typed deployment holders + refresh primitive"
```

---

## Task 2: The fence gate + local-secondary promote flow (+ error codes)

The mechanism as pure functions: refuse without a fence attestation (spec §6), then — idempotently and
only for a local secondary — write `singleton_role='primary'` on the owner connection and refresh the
holder (spec §5a steps 3-4). A mirror is refused with a clean domain code before any write.

**Files:**
- Modify: `apps/server/src/errors.ts` (register two `promotion.*` codes)
- Create: `apps/server/src/promote.ts`
- Create: `apps/server/src/promote.test.ts`

**Interfaces:**
- Consumes: `DeploymentHolders`, `refreshDeploymentHolders` (Task 1); `setSingletonRole`, `Database` from
  `@waitron/db`; `AppError` from `@waitron/shared`; `Logger` from `./logger.js`; `DRAIN_DUTY` from
  `./pass.js` and `singletonPass` from `./singleton-pass.js` (test only).
- Produces:
  - `interface FenceAttestation { readonly oldNodeNeutralised: boolean }`
  - `interface PromotionResult { readonly alreadyPrimary: boolean }`
  - `interface PromoteDeps { readonly appDb: Database; readonly ownerDb: Database; readonly holders: DeploymentHolders; readonly log: Logger }`
  - `function assertFenced(attestation: FenceAttestation): void`
  - `function promoteLocalSecondaryToPrimary(deps: PromoteDeps, attestation: FenceAttestation): Promise<PromotionResult>`

- [ ] **Step 1: Register the error codes** — add to `apps/server/src/errors.ts` inside the
  `declare module "@waitron/shared" { interface ErrorParams { ... } }` block:

```ts
    /**
     * A promote was requested without an operator attestation that the OLD node is physically
     * neutralised (promotion runbook design §6). Software cannot verify a partitioned peer, so the promote
     * action REFUSES to claim the singleton duties — two submitters under one NIF would race the AEAT
     * flow-control budget (#33 §6). Thrown BEFORE any state change (before the point-of-no-return), so the
     * node is left exactly as it was. No params: the refusal names nothing, and there is nothing non-secret
     * to carry. `promotion.*` names the DOMAIN CONCEPT (a node promotion), never the throwing package —
     * the rule `tenant.not_found`'s note above gives; `server.*` is reserved for facts about the process.
     * Never renamed once shipped.
     */
    "promotion.fence_not_attested": Record<string, never>;
    /**
     * A local-secondary promote (promotion runbook design §5a) was called on a node that is a read-only
     * MIRROR (`deployment.mode='mirror'`). A mirror holds no SIF and cannot become the submitter by a bare
     * `singleton_role` flip — it needs the mirror→primary path (fresh-SIF mint from the pre-reserved
     * identity, §5b), a later slice. Refused with THIS code BEFORE the write, giving a clean domain error
     * rather than the raw `deployment_role_valid_ck` CHECK violation the `(mirror, primary)` write would
     * otherwise raise (the CHECK is the backstop). `mode` is the node's own configured role, already in its
     * config and not a secret — echoing it is what tells the operator which path to use, the same shape
     * `deployment.environment_mismatch` follows. `promotion.*`, not `server.*`, for the reason
     * `promotion.fence_not_attested` gives. Never renamed once shipped.
     */
    "promotion.not_a_local_secondary": { mode: string };
```

- [ ] **Step 2: Write the failing test** — `apps/server/src/promote.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  captureError,
  createPgliteDb,
  runMigrations,
  stampDeployment,
  setSingletonRole,
  setDeploymentMode,
  readSingletonRole,
  type Database,
} from "@waitron/db";
import { createDeploymentHolders } from "./deployment-holders.js";
import { singletonPass } from "./singleton-pass.js";
import { DRAIN_DUTY } from "./pass.js";
import { promoteLocalSecondaryToPrimary, type PromoteDeps } from "./promote.js";

// PGlite is sufficient for the promote LOGIC (fence, idempotency, mirror-guard, the holder flip): none of
// these has an RLS / privilege / concurrency dependency, and the read/write both succeed as the PGlite
// superuser (CLAUDE.md §4 — pick the lighter target when the heavier one's justification does not apply).
// `appDb` and `ownerDb` are the same handle here; the owner-vs-app distinction is a Task 4 concern.
async function localSecondary(): Promise<{ db: Database; deps: (log: PromoteDeps["log"]) => PromoteDeps }> {
  const db = await createPgliteDb();
  await runMigrations(db);
  await stampDeployment(db, "preproduction");
  await setSingletonRole(db, "secondary"); // (primary, secondary) — a local secondary
  const holders = createDeploymentHolders("primary", "secondary");
  return { db, deps: (log) => ({ appDb: db, ownerDb: db, holders, log }) };
}

const noopLog: PromoteDeps["log"] = () => {};

describe("promoteLocalSecondaryToPrimary", () => {
  it("refuses without a fence attestation and leaves state unchanged", async () => {
    const { db, deps } = await localSecondary();
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(deps(noopLog), { oldNodeNeutralised: false }),
    );
    expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");
    expect(await readSingletonRole(db)).toBe("secondary"); // no write happened
    await db.close();
  });

  it("claims the singletons and flips the holder so the fiscal pass starts", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);

    // The SAME pass function, built once over the holder, must flip empty -> real on promotion (no restart).
    const pass = singletonPass(
      () => d.holders.singletonRole.current,
      async () => ({ nextDueAt: null, duties: [DRAIN_DUTY] }),
    );
    expect(await pass(new Date())).toEqual({ nextDueAt: null, duties: [] }); // secondary: empty pass

    const result = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(result).toEqual({ alreadyPrimary: false });
    expect(await readSingletonRole(db)).toBe("primary");
    expect(d.holders.singletonRole.current).toBe("primary");
    expect((await pass(new Date())).duties).toContain(DRAIN_DUTY); // primary: real pass runs
    await db.close();
  });

  it("is idempotent — a second promote on an already-primary node is a no-op", async () => {
    const { db, deps } = await localSecondary();
    const d = deps(noopLog);
    await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    const second = await promoteLocalSecondaryToPrimary(d, { oldNodeNeutralised: true });
    expect(second).toEqual({ alreadyPrimary: true });
    expect(await readSingletonRole(db)).toBe("primary");
    await db.close();
  });

  it("refuses a mirror with promotion.not_a_local_secondary before any write", async () => {
    const db = await createPgliteDb();
    await runMigrations(db);
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "mirror"); // (mirror, secondary)
    const holders = createDeploymentHolders("mirror", "secondary");
    const error = await captureError(() =>
      promoteLocalSecondaryToPrimary(
        { appDb: db, ownerDb: db, holders, log: noopLog },
        { oldNodeNeutralised: true },
      ),
    );
    expect(isAppError(error) && error.code).toBe("promotion.not_a_local_secondary");
    expect(await readSingletonRole(db)).toBe("secondary"); // never written
    await db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test promote.test -- --run`
Expected: FAIL — `Cannot find module './promote.js'`.

- [ ] **Step 4: Write the implementation** — `apps/server/src/promote.ts`

```ts
import "./errors.js"; // register promotion.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import { setSingletonRole, type Database } from "@waitron/db";
import { refreshDeploymentHolders, type DeploymentHolders } from "./deployment-holders.js";
import type { Logger } from "./logger.js";

/**
 * The operator's attestation that the OLD node is physically neutralised (promotion runbook design §6) —
 * powered off, or demoted to sell-only at the box. A required human input because software cannot verify a
 * partitioned peer; without it, two submitters under one NIF could coexist.
 */
export interface FenceAttestation {
  readonly oldNodeNeutralised: boolean;
}

/** Whether the node already held the singletons — a `true` here means the promote was an idempotent no-op. */
export interface PromotionResult {
  readonly alreadyPrimary: boolean;
}

export interface PromoteDeps {
  /** The app pool — used only for the holder-refresh READ (`app_user` holds SELECT on `deployment`). */
  readonly appDb: Database;
  /** The owner/provisioning pool — the `singleton_role` write is owner-role (`app_user` has no UPDATE). */
  readonly ownerDb: Database;
  readonly holders: DeploymentHolders;
  readonly log: Logger;
}

/**
 * Refuses to proceed without a fence attestation (promotion runbook design §6). A plain throw BEFORE any
 * state change, so a refused promote leaves the node exactly as it was (abort before the point-of-no-return,
 * §7). Extracted so the guard can be proven by deletion (CLAUDE.md §4).
 */
export function assertFenced(attestation: FenceAttestation): void {
  if (attestation.oldNodeNeutralised !== true) {
    throw new AppError("promotion.fence_not_attested", {});
  }
}

/**
 * Local secondary → primary (promotion runbook design §5a). The node already sells (`mode='primary'`); this
 * claims the singleton duties only. Idempotent and checkpointed (§3e): a fence refusal aborts with no
 * effect; an already-primary node is a no-op; a mirror is refused (it needs the SIF-mint path, §5b, a later
 * slice). The single write — `setSingletonRole('primary')` — is the point-of-no-return (§7): it makes this
 * node the AEAT submitter. The subsequent holder refresh flips the running fiscal pass from the empty pass
 * to the real drain on its next tick, with no restart (§3b/§3c).
 */
export async function promoteLocalSecondaryToPrimary(
  deps: PromoteDeps,
  attestation: FenceAttestation,
): Promise<PromotionResult> {
  assertFenced(attestation); // before PONR: abortable, zero lasting effect

  // Read the freshest state before deciding — a concurrent write, or a prior half-completed promote, is
  // reflected here, which is what makes the flow idempotent on re-run (§3e).
  await refreshDeploymentHolders(deps.appDb, deps.holders);

  if (deps.holders.mode.current === "mirror") {
    // A mirror cannot become the submitter by a bare role flip; refuse with a clean code before the write
    // (the (mirror, primary) CHECK is the backstop, not the primary guard).
    throw new AppError("promotion.not_a_local_secondary", { mode: deps.holders.mode.current });
  }
  if (deps.holders.singletonRole.current === "primary") {
    return { alreadyPrimary: true }; // already the singleton holder — idempotent no-op
  }

  await setSingletonRole(deps.ownerDb, "primary"); // PONR: claims the submitter (§7)
  await refreshDeploymentHolders(deps.appDb, deps.holders); // flip the running pass on its next tick

  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test promote.test -- --run`
Expected: PASS (all four cases).

- [ ] **Step 6: Prove the fence guard by deletion**

Temporarily comment out the body of `assertFenced` (leave it a no-op), then run
`pnpm --filter @waitron/server test promote.test -- --run`.
Expected: the "refuses without a fence attestation" case FAILS (the promote now writes `primary`).
Restore `assertFenced`, re-run, confirm green. (Do not commit the deletion.)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/errors.ts apps/server/src/promote.ts apps/server/src/promote.test.ts
git commit -s -m "feat(server): fence gate + local-secondary promote mechanism"
```

---

## Task 3: Expose the promote method on StartedServer

Wire the mechanism into boot as an in-process `StartedServer` method (trading mode only). The method opens
a short-lived owner pool from `config.migrationsDatabaseUrl` (matching the boot stamp-probe pattern,
[boot.ts:431](../../../apps/server/src/boot.ts#L431)), runs the flow against the running holders, and
closes the pool. No test here — it is covered by the booted e2e in Task 4.

**Files:**
- Modify: `apps/server/src/boot.ts` — the `StartedServer` interface
  ([boot.ts:93](../../../apps/server/src/boot.ts#L93)), `makeStartedServer`
  ([boot.ts:319-367](../../../apps/server/src/boot.ts#L319), literal at
  [boot.ts:335](../../../apps/server/src/boot.ts#L335)), and the trading-mode call site
  ([boot.ts:1179](../../../apps/server/src/boot.ts#L1179)).

**Interfaces:**
- Consumes: `promoteLocalSecondaryToPrimary`, `FenceAttestation`, `PromotionResult` (Task 2); `holders`
  (Task 1, in scope in the trading branch); `config.migrationsDatabaseUrl`, `db`, `log`, `createPostgresDb`.
- Produces: `StartedServer.promoteLocalSecondaryToPrimary?: (attestation: FenceAttestation) => Promise<PromotionResult>`
  (optional — a setup-mode box holds no `deployment` state and omits it).

- [ ] **Step 1: Extend the `StartedServer` interface** ([boot.ts:93](../../../apps/server/src/boot.ts#L93))

```ts
export interface StartedServer {
  health: HealthState;
  /**
   * Promote a local secondary to primary in-process (promotion runbook design §5a) — flips
   * `singleton_role` to 'primary' and refreshes the fiscal-pass holder with no restart. Present only in
   * trading mode; a setup box omits it. IN-PROCESS ONLY: no network endpoint / break-glass auth yet (Slice
   * 2). Requires a fence attestation or it refuses (`promotion.fence_not_attested`).
   */
  promoteLocalSecondaryToPrimary?: (attestation: FenceAttestation) => Promise<PromotionResult>;
  /** Resolves when the loop has stopped, the listener is closed and the pool is drained. */
  close(): Promise<void>;
}
```

- [ ] **Step 2: Thread the method through `makeStartedServer`**

Add a parameter to `makeStartedServer` ([boot.ts:319](../../../apps/server/src/boot.ts#L319)):
`promote?: (attestation: FenceAttestation) => Promise<PromotionResult>`, and include it in the returned
literal ([boot.ts:335](../../../apps/server/src/boot.ts#L335)):

```ts
return {
  health,
  ...(promote === undefined ? {} : { promoteLocalSecondaryToPrimary: promote }),
  close: async () => { /* unchanged */ },
};
```

The setup-mode call site ([boot.ts:572](../../../apps/server/src/boot.ts#L572)) passes no `promote`
argument (a setup box cannot promote — it holds no `deployment` singleton). Leave it unchanged apart from
the new trailing optional argument being absent.

- [ ] **Step 3: Build and pass the promote closure at the trading call site**
  ([boot.ts:1179](../../../apps/server/src/boot.ts#L1179))

```ts
return makeStartedServer(server, health, log, { stopWork, closePools }, mdns, async (attestation) => {
  // Owner-role write: open a short-lived owner pool from the migrations URL (the stamp-probe pattern,
  // boot.ts:431) rather than holding one open — a trading box keeps only the app pool. See the plan's
  // "Known limitations" #2: the REAL runtime admin connection is deferred with instance provisioning
  // (boot.ts:529); this URL is the superuser in dev/CI where the promote is exercised.
  const ownerDb = await createPostgresDb(config.migrationsDatabaseUrl);
  try {
    return await promoteLocalSecondaryToPrimary({ appDb: db, ownerDb, holders, log }, attestation);
  } finally {
    await ownerDb.close();
  }
});
```

Add the imports at the top of `boot.ts`:
`import { promoteLocalSecondaryToPrimary } from "./promote.js";` and
`import type { FenceAttestation, PromotionResult } from "./promote.js";`.

- [ ] **Step 4: Typecheck + confirm the mirror suite still boots**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test boot.mirror -- --run`
Expected: PASS (the new optional param does not change existing boots).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.ts
git commit -s -m "feat(server): expose in-process promoteLocalSecondaryToPrimary on StartedServer"
```

---

## Task 4: Real-PG booted e2e — the live flip (spec §8 headline)

Prove the whole thing end to end on real Postgres: a booted local secondary does not file; promotion flips
it live; it begins filing on the next tick; and the till surface answers throughout (no restart). Real
Postgres is mandatory here (CLAUDE.md §4): it exercises the workers, the owner-role write, RLS-served till
routes, and the live wall-clock loop — all false passes on PGlite.

**Files:**
- Create: `apps/server/src/boot.promote.test.ts`

**Interfaces:**
- Consumes: `startServer` and `StartedServer.promoteLocalSecondaryToPrimary` (Task 3); the boot real-PG
  harness idioms from [boot.mirror.rls.test.ts](../../../apps/server/src/boot.mirror.rls.test.ts) and
  [boot.test.ts](../../../apps/server/src/boot.test.ts); `seedPendingEnvios` from
  `@waitron/fiscal-verifactu/test/drain-fixtures.js`; `setSingletonRole`, `readSingletonRole`,
  `stampDeployment` from `@waitron/db`.

- [ ] **Step 1: Write the failing test — harness + Phase A (secondary does not file)**

Model the harness on `boot.test.ts`'s drain e2e (the `seedPendingEnvios` + `undici` mock section around
[boot.test.ts:1780-1920](../../../apps/server/src/boot.test.ts#L1780)) and `boot.mirror.rls.test.ts`'s
`useTemplateDb` + `freePort` + `WAITRON_MIGRATIONS_DATABASE_URL` (superuser) setup. Key facts to reuse
verbatim:

- Module-mock `undici`'s `fetch` to REJECT (so any AEAT submit fails fast → the envios row transitions to
  an observable "attempted" state; [boot.test.ts:41-56](../../../apps/server/src/boot.test.ts#L41)):
  ```ts
  vi.mock("undici", async (importOriginal) => {
    const actual = await importOriginal<typeof import("undici")>();
    return { ...actual, fetch: vi.fn(() => Promise.reject(new Error("undici disabled in test"))) };
  });
  ```
- Seed one due registro against the SUPERUSER connection, with a sealed `fiscal.aeat` credential and
  `WAITRON_ENV="production"` so drain ATTEMPTS (not skips): `entorno` defaults to `"production"` in
  `seedPendingEnvios`, so it must agree with the host env. Follow
  [boot.test.ts:1786-1900](../../../apps/server/src/boot.test.ts#L1786) for the exact `putCredential`
  (certKind `"representante"`) + seed shape:
  ```ts
  const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
  ```
- Put the deployment into a local-secondary state on the superuser connection BEFORE boot:
  ```ts
  await stampDeployment(suite.admin, "production");
  await setSingletonRole(suite.admin, "secondary"); // (primary, secondary)
  ```
  (`stampDeployment` is idempotent when the env already matches, so ordering vs. the harness's own stamp is
  safe; assert `readDeploymentMode`/`readSingletonRole` = `(primary, secondary)` after setup.)
- Boot with `WAITRON_MIGRATIONS_DATABASE_URL` = the superuser URI (so the promote's owner pool can write),
  `DATABASE_URL` = the app-role URI (`roleUrl(...)` for `app_login`, as the mirror suite does), the five
  `WAITRON_TILL_*_ID` matching the seeded identity, `KEY_ENV`, and a `freePort()` as `WAITRON_HTTP_PORT`.
- **Set SHORT tick values** — e.g. `WAITRON_MIN_TICK_MS="250"`, `WAITRON_MAX_TICK_MS="1000"`,
  `WAITRON_SKIP_RETRY_MS="250"`. An idle secondary's empty pass returns `nextDueAt: null`, so the loop
  sleeps `maxTickMs` between passes ([loop.ts:19](../../../apps/server/src/loop.ts#L19)); with a large
  `maxTickMs` the post-promote drain pass would not arrive within the poll budget. Short ticks make both
  the Phase A pass and the post-flip drain pass land quickly.

A helper to read the seeded envios row's observable columns (via `suite.admin`):
```ts
async function envio(): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await suite.admin.execute<{ estado: string; intentos: number; incidencia: boolean }>(
    sql`select estado, intentos, incidencia from envios where registro_id = ${seeded.registroIds[0]}`,
  );
  return rows.rows[0]!;
}
```

Phase A assertions (secondary — the empty pass never touches the row):
```ts
// A pass has run (proof the loop is live) but the fiscal pass is empty for a secondary.
await waitForPass(server.health); // poll server.health.lastPassAt, per boot.test.ts's waitForPass
const before = await envio();
expect(before).toEqual({ estado: "pendiente", intentos: 0, incidencia: false });

// The sale path answers.
const staffA = await fetch(`http://127.0.0.1:${port}/api/staff`);
expect(staffA.status).toBe(200);
expect(await staffA.json()).toEqual([]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.promote -- --run`
Expected: FAIL — either the file/method does not exist yet, or (once Tasks 1-3 are in) it fails at the
Phase B assertions added next. Confirm Phase A itself passes before proceeding (it exercises no new code).

- [ ] **Step 3: Add Phase B — promote live, then the row is attempted, tills still answer**

```ts
// Promote the running secondary in-process. No restart.
const result = await server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: true });
expect(result).toEqual({ alreadyPrimary: false });
expect(await readSingletonRole(suite.admin)).toBe("primary");

// The fiscal pass now drains: the seeded row is ATTEMPTED (undici rejects → backoffBatch), so intentos
// increments to 1 and incidencia flips true. Poll — the wall-clock loop is not injectable at boot level.
await poll(async () => ((await envio()).intentos >= 1 ? true : undefined));
const after = await envio();
expect(after.intentos).toBe(1);
expect(after.incidencia).toBe(true);
expect(after.estado).toBe("pendiente"); // backoff re-queues it for a later retry

// The sale path STILL answers across the live flip — the "no restart" claim, hit not asserted.
const staffB = await fetch(`http://127.0.0.1:${port}/api/staff`);
expect(staffB.status).toBe(200);
expect(await staffB.json()).toEqual([]);
```

(`poll` is the boot-test polling helper — a bounded retry loop, ~200 × 50ms; copy the shape from
[boot.test.ts:329-344](../../../apps/server/src/boot.test.ts#L329). Do not hand-roll a fixed sleep.)

- [ ] **Step 4: Add the fence-refusal case (separate boot, state unchanged)**

```ts
it("refuses an unattested promote and keeps filing off", async () => {
  // Boot a fresh (primary, secondary) server (own port/seed), then (captureError + isAppError is the
  // repo idiom for asserting a thrown AppError code — `toSatisfy` is not available here):
  const error = await captureError(() =>
    server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: false }),
  );
  expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");
  expect(await readSingletonRole(suite.admin)).toBe("secondary");
  const row = await envio();
  expect(row).toEqual({ estado: "pendiente", intentos: 0, incidencia: false }); // still untouched
});
```

- [ ] **Step 5: Clean up fiscal fixtures in a `finally`**

Delete the seeded sidecar rows so the shared template DB is order-independent (CLAUDE.md §4), following
[boot.test.ts:1843](../../../apps/server/src/boot.test.ts#L1843):
```ts
await suite.admin.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
await suite.admin.execute(sql`delete from incidents where registro_id in ${seeded.registroIds}`);
```
and `await server.close();` for every booted server (idempotent; guard with the `if (server !== undefined)`
shape if a raw `beforeAll`/`afterAll` is used — prefer the lifecycle helpers where they fit).

- [ ] **Step 6: Run the full suite + coverage**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.promote -- --run`
then `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS, coverage ≥ 95/95/90/88.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/boot.promote.test.ts
git commit -s -m "test(server): real-PG e2e — live local-secondary promotion flips filing on, tills unaffected"
```

---

## Final gate (before opening the PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check`
- [ ] `pnpm --filter @waitron/server test:coverage` (CI runs `test:coverage`, not `test`)
- [ ] `TESTCONTAINERS_RYUK_DISABLED=true` for the container suites; `pnpm reap` after any interrupted run.
- [ ] `pnpm install` and commit the lockfile if any manifest changed (none expected).
- [ ] Update `docs/backlog.md`: mark "the promote **action** itself + starting the primary-only workers on
      promotion" (SIF-topology follow-ups + C2a deferred item 3) as **Slice 1 (local-secondary,
      in-process) landed**, and record the deferred slices below as the remaining promotion work.

---

## Deferred slices — recorded so they are not dropped (each its own spec→plan)

Each is gated on a foundation that does not exist yet; bite-sizing them now would be speculative. When a
gate lands, that slice gets its own spec→plan→build.

- **Slice 2 — authenticated promote endpoint + break-glass + runtime admin connection (spec §4, §5a step 2).**
  A method-gate-exempt promote endpoint (the one hole in the read-only gate), authorized AND key-ring-unsealed
  by the single break-glass secret, plus the real runtime owner/admin DB connection (replacing Known
  Limitation #2). **Gated on:** the break-glass secret mint (C2b / hosting wizard) and the runtime admin
  connection deferred at [boot.ts:529](../../../apps/server/src/boot.ts#L529).

- **Slice 3 — passive cloud mirror → primary (spec §5b).** Mount `mountSyncApi` always + request-time gate
  (§3a), a worker-lifecycle manager that STARTS the mode-gated workers live (§3c — the mirror runs none
  today), flip both axes, mint a fresh SIF from the pre-reserved identity, start selling + the sync source.
  **Gated on:** the pre-reserved SIF identity staging (§3f.1 — installation number + disjoint series, staged
  while the link is up; nothing in the tree). Also owes the §9 receipts: capture triggers fire on a promoted
  mirror, and the operational write-GET tables are provisioned on an ex-mirror before the gate lifts (§3f.2).

- **Slice 4 — cold restore → primary (spec §5d).** Restore base backup + WAL, environment handshake, mint a
  fresh SIF/new chain, go live immediately, month-end `consultar` reconciliation. **Gated on:** the backup
  regime (WAL archiving + base backups to object storage, lifecycle §6.1) and the reporting/close
  subsystem's `consultar` reconciliation — most likely built with provisioning and reporting, not this action.

- **Slice 5 — rejoin old primary → secondary (spec §5c)** and **the continuous conflict-detection watcher
  (§9.6).** The inverse transition (relinquish singletons, stay a replication source, catch up, request
  re-admission) and the always-on watcher that auto-demotes a mis-promoted loser. **Gated on:** the
  membership-list wire-protocol / re-admission format (lifecycle §9.1), left open by the spec.
