# Promotion foundation: the `singleton_role` axis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the second deployment-state axis — `deployment.singleton_role` (`primary`|`secondary`) — and gate the AEAT-submitter/reconciler fiscal pass on it, so a future active-active local *secondary* (read-write, sells) never runs the singleton duties, while today's single-node primary and C2a mirror behave byte-identically.

**Architecture:** C2a's `deployment.mode` is the *read/write* axis (`mirror` = read-only). This plan adds the orthogonal *singleton-ownership* axis on the same `deployment` singleton row (per `packages/db/src/schema/nodes.ts:7-16`, which deferred it and said it belongs on `deployment`, not `nodes`). A DB CHECK forbids the invalid `(mirror, primary)` pair; `setDeploymentMode('mirror')` co-sets `singleton_role='secondary'` in one UPDATE so the pair is never even transiently written. Boot reads the role into a refreshable holder and selects the fiscal pass through a pure `singletonPass` helper read *per pass*, so a later promotion (a separate slice) that flips the holder starts the duties on the next tick with no restart.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18 (Testcontainers) + PGlite, Vitest, pnpm workspace.

**Spec:** [docs/superpowers/specs/2026-08-29-promotion-runbook-design.md](../specs/2026-08-29-promotion-runbook-design.md) — this plan implements the **foundation slice** of §2 (the two-axis state) and §3c (gating the singleton workers on `singleton_role`). It deliberately does **not** build: the promote endpoint/auth, the break-glass secret, mount-and-gate of the sync source, live start of the *mode*-gated workers (source/retention/tunnel), fresh-SIF minting, or the fence attestation — those are later slices that depend on unbuilt foundations (spec §3f, §9).

## Global Constraints

- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Before claiming a package green run its coverage suite: `pnpm --filter @waitron/db test:coverage` and `pnpm --filter @waitron/server test:coverage` (CI runs `test:coverage`, not `test` — CLAUDE.md §2).
- **Real Postgres for role/grant/CHECK behaviour, PGlite only where a superuser can't hide a FORCE-RLS/grant fact** (CLAUDE.md §4). The `deployment` accessor suite uses `describeEachTarget` (both targets) plus one bare-PGlite pre-migration case, matching the existing tests.
- **Container tests need `TESTCONTAINERS_RYUK_DISABLED=true`** locally or they hang at 180s (CLAUDE.md §4).
- **No new error code** — `setSingletonRole` reuses the existing `deployment.not_stamped` (0-row update). Do not add a `deployment.*` code; grep `packages/db/src/errors.ts` before inventing one (CLAUDE.md §3).
- **No backfill / no bwc** — pre-production; the column takes a `DEFAULT 'primary'` so existing single-node deployments are unchanged (CLAUDE.md §5).
- **English identifiers only** — `singleton_role`, `primary`, `secondary` are English; nothing here touches `SPANISH_WORDS`.
- **Coverage thresholds:** `@waitron/db` and `apps/server` both carry `98/98/98/95` (statements/lines/functions/branches) — the new code must be covered to those.
- **After the DB migration, run the tenant-scoped fiscal guard** even though this table is not tenant-scoped: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` must still pass (it scans every `tenant_id`-bearing table; `deployment` has none, so it must stay green — confirm no regression).

---

### Task 1: The `singleton_role` state layer (`packages/db`)

**Files:**
- Create: `packages/db/drizzle/0071_deployment_singleton_role.sql` (via `drizzle-kit generate --custom`, then hand-write the SQL — `deployment` is not in the schema barrel, so generation emits an empty stub + a journal entry, exactly as `0069`/`0010` were made)
- Modify: `packages/db/drizzle/meta/_journal.json` (written by the `--custom` generate above — do not hand-edit if generate did it)
- Modify: `packages/db/src/schema/deployment.ts` (add the column + two CHECKs to the Drizzle object so it matches the real table)
- Modify: `packages/db/src/deployment.ts` (add `SingletonRole`, `readSingletonRole`, `setSingletonRole`; make `setDeploymentMode` co-set `singleton_role='secondary'` on `'mirror'`)
- Test: `packages/db/src/deployment.test.ts` (extend)

**Interfaces:**
- Produces:
  - `type SingletonRole = "primary" | "secondary"`
  - `readSingletonRole(db: Database): Promise<SingletonRole>` — `"primary"` when the table/row is absent
  - `setSingletonRole(db: Database, role: SingletonRole): Promise<void>` — owner-role write; throws `AppError("deployment.not_stamped", {})` on a 0-row update; a `'primary'` write against a `mode='mirror'` row is refused by `deployment_role_valid_ck` (SQLSTATE 23514)
  - `setDeploymentMode(db, "mirror")` now also sets `singleton_role='secondary'` (same UPDATE); `setDeploymentMode(db, "primary")` leaves `singleton_role` untouched
- Consumes: nothing from other tasks.

- [ ] **Step 1: Generate the empty custom migration + journal entry**

Run: `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name deployment_singleton_role`
Expected: creates `packages/db/drizzle/0071_deployment_singleton_role.sql` (empty) and adds its entry to `drizzle/meta/_journal.json`.

- [ ] **Step 2: Write the migration SQL**

Replace the empty `0071_deployment_singleton_role.sql` with:

```sql
-- The SINGLETON-OWNERSHIP axis (promotion runbook design §2), orthogonal to `mode` (0069). `mode` says
-- read-write (`primary`) vs read-only (`mirror`); `singleton_role` says whether THIS database holds the
-- venue's singleton duties — the AEAT submitter + payment reconciler (#33 §7): `primary` holds them,
-- `secondary` is sell-only. Two axes are needed because a local secondary in active-active is
-- read-WRITE (it sells) yet holds no singletons — a state `mode` alone cannot express. Default 'primary'
-- so every existing single-node deployment (mode='primary') stays a singleton-holder, unchanged —
-- pre-production, no backfill (CLAUDE.md §3/§5). Read by app_user through the table-wide SELECT 0010
-- already granted; the WRITE (demote-to-mirror, promote) is an OWNER-role write, no new grant (as `mode`).
-- Selling never reads it (#33 — selling needs no role); only the fiscal pass does.
ALTER TABLE "deployment" ADD COLUMN "singleton_role" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_singleton_role_ck" CHECK ("deployment"."singleton_role" in ('primary', 'secondary'));
--> statement-breakpoint
-- A read-only mirror cannot hold singleton duties: the (mirror, primary) pair is rejected at the write
-- boundary (design §2). setDeploymentMode('mirror') co-sets singleton_role='secondary' in one UPDATE so
-- the pair is never even transiently written; this CHECK is the backstop.
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_role_valid_ck" CHECK (NOT ("deployment"."mode" = 'mirror' AND "deployment"."singleton_role" = 'primary'));
```

- [ ] **Step 3: Update the Drizzle table object**

In `packages/db/src/schema/deployment.ts`, add the column after `mode` and the two checks in the constraints array:

```ts
    mode: text("mode").notNull().default("primary"),
    // The singleton-ownership axis (promotion runbook design §2), orthogonal to `mode`: `primary` holds
    // the venue's singleton duties (AEAT submitter + reconciler), `secondary` is sell-only. Default
    // 'primary' so an existing single-node deployment stays a singleton-holder. Read at runtime so a
    // later promotion needs no restart.
    singletonRole: text("singleton_role").notNull().default("primary"),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deployment_singleton_ck", sql`${t.id} = 1`),
    check("deployment_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("deployment_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check(
      "deployment_role_valid_ck",
      sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`,
    ),
  ],
```

- [ ] **Step 4: Write the failing accessor tests**

In `packages/db/src/deployment.test.ts`: (a) extend the bare-PGlite unstamped test with a `readSingletonRole` line, and (b) add these inside `describeEachTarget("the deployment stamp", (target) => { … })`. Import `readSingletonRole`, `setSingletonRole` at the top and `pgErrorCode` is already imported.

```ts
// (a) inside the existing bare-createPgliteDb unstamped test, after the readDeploymentMode assertion:
expect(await readSingletonRole(bare)).toBe("primary");
```

```ts
// (b) new cases inside describeEachTarget:
it("reads singleton_role as 'primary' on a freshly stamped database", async () => {
  await stampDeployment(db, "preproduction");
  expect(await readSingletonRole(db)).toBe("primary");
});

it("reads back a singleton_role that was set to 'secondary'", async () => {
  await stampDeployment(db, "preproduction");
  await setSingletonRole(db, "secondary");
  expect(await readSingletonRole(db)).toBe("secondary");
});

it("demoting to mirror co-sets singleton_role to 'secondary'", async () => {
  await stampDeployment(db, "preproduction");
  await setDeploymentMode(db, "mirror");
  expect(await readDeploymentMode(db)).toBe("mirror");
  expect(await readSingletonRole(db)).toBe("secondary");
});

it("refuses singleton_role='primary' on a mirror (deployment_role_valid_ck)", async () => {
  await stampDeployment(db, "preproduction");
  await setDeploymentMode(db, "mirror");
  const error = await captureError(() => setSingletonRole(db, "primary"));
  expect(pgErrorCode(error)).toBe("23514"); // check_violation
});

it("setSingletonRole fails loudly on an unstamped database", async () => {
  const error = await captureError(() => setSingletonRole(db, "secondary"));
  expect(isAppError(error) && error.code).toBe("deployment.not_stamped");
});
```

(`captureError`, `pgErrorCode` are already imported in this file; add `isAppError` from `@waitron/shared` to the imports if absent — check the top of the file first.)

- [ ] **Step 5: Run the tests to verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test deployment`
Expected: FAIL — `readSingletonRole`/`setSingletonRole` are not exported yet.

- [ ] **Step 6: Add the accessors and the `setDeploymentMode` co-set**

In `packages/db/src/deployment.ts`, after `setDeploymentMode`, add:

```ts
/** The singleton-ownership axis (promotion runbook design §2), orthogonal to `mode`: a `primary` holds
 * the venue's singleton duties (the AEAT submitter + payment reconciler — #33 §7); a `secondary` sells
 * but holds none. Narrowed to the two-value union for the same reason `DeploymentMode` is: an
 * unrepresentable value is a `tsc` error, not a runtime CHECK violation. */
export type SingletonRole = "primary" | "secondary";

/** Whether this database holds the singleton duties, or `"primary"` when nothing has been stamped — an
 * unstamped database is a sole primary. Same `to_regclass` probe (not a caught undefined-table error)
 * `readDeploymentMode` uses, for the same transaction-poisoning reason. */
export async function readSingletonRole(db: Database): Promise<SingletonRole> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return "primary";
  const rows = await db.execute<{ singleton_role: SingletonRole }>(
    sql`select singleton_role from deployment where id = 1`,
  );
  return rows.rows[0]?.singleton_role ?? "primary";
}

/** Sets this database's singleton-ownership role. An OWNER-role write (app_user holds no UPDATE on
 * deployment), like `setDeploymentMode`; fail-loud on a 0-row update (stamp the environment first).
 * Setting `'primary'` on a `mode='mirror'` database is refused by `deployment_role_valid_ck` — a
 * read-only mirror cannot hold singletons; a promotion flips the mode first (the promote action's job). */
export async function setSingletonRole(db: Database, role: SingletonRole): Promise<void> {
  const result = await db.execute<{ id: number }>(
    sql`update deployment set singleton_role = ${role} where id = 1 returning id`,
  );
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}
```

Then replace the body of `setDeploymentMode` with the co-setting version:

```ts
export async function setDeploymentMode(db: Database, mode: DeploymentMode): Promise<void> {
  // A read-only mirror holds no singleton duties, so flipping mode to 'mirror' co-sets
  // singleton_role='secondary' in the SAME update — the (mirror, primary) pair deployment_role_valid_ck
  // forbids is never even transiently written. Flipping mode to 'primary' leaves singleton_role
  // untouched: a primary may be the singleton-holder OR a sell-only local secondary (design §2), and
  // which one is the promote action's call, not this setter's.
  const result =
    mode === "mirror"
      ? await db.execute<{ id: number }>(
          sql`update deployment set mode = ${mode}, singleton_role = 'secondary' where id = 1 returning id`,
        )
      : await db.execute<{ id: number }>(
          sql`update deployment set mode = ${mode} where id = 1 returning id`,
        );
  // Fail loud on a 0-row update: the singleton must already exist (stamp first). A silent no-op here
  // would let a mis-sequenced promotion "succeed" while leaving the database in the wrong mode.
  if (result.rows.length === 0) {
    throw new AppError("deployment.not_stamped", {});
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test deployment`
Expected: PASS (all deployment cases, both targets + the bare-PGlite case).

- [ ] **Step 8: Prove the combo guard by deletion**

Temporarily delete the `deployment_role_valid_ck` line from `0071_deployment_singleton_role.sql`, re-run the migration on a fresh DB, and run the suite. Expected: the "refuses singleton_role='primary' on a mirror" test now FAILS (no 23514). Restore the line, re-run: PASS. (CLAUDE.md §4 — prove a guard by deletion.)

- [ ] **Step 9: Verify the wider `@waitron/db` suite and the fiscal guard are green**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`
Then: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: both PASS — the new column is not tenant-scoped, so the `inmutabilidad` scan is unaffected; coverage stays ≥ 98/98/98/95.

- [ ] **Step 10: Commit**

```bash
git add packages/db/drizzle/0071_deployment_singleton_role.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema/deployment.ts packages/db/src/deployment.ts packages/db/src/deployment.test.ts
git commit -s -m "feat(db): add deployment.singleton_role axis + accessors

The singleton-ownership axis (promotion runbook design §2), orthogonal to
deployment.mode: primary holds the AEAT-submitter/reconciler singletons,
secondary is sell-only. A CHECK forbids the invalid (mirror, primary) pair;
setDeploymentMode('mirror') co-sets singleton_role='secondary'. Default
'primary' leaves every existing single-node deployment unchanged."
```

---

### Task 2: Gate the fiscal pass on `singleton_role` (`apps/server`)

**Files:**
- Create: `apps/server/src/singleton-pass.ts`
- Create: `apps/server/src/singleton-pass.test.ts`
- Modify: `apps/server/src/boot.ts` (add the `singletonRoleHolder`; replace the `isMirror ? empty : runPass` ternary in the `runLoop` call with `singletonPass(...)`; add imports)

**Interfaces:**
- Consumes: `SingletonRole`, `readSingletonRole` from `@waitron/db` (Task 1); `PassReport` from `./pass.js`.
- Produces: `singletonPass(getRole: () => SingletonRole, runPrimaryPass: (now: Date) => Promise<PassReport>): (now: Date) => Promise<PassReport>` — returns a pass that runs `runPrimaryPass` iff `getRole() === "primary"`, else a trivial empty pass; `getRole` is read on every call.

- [ ] **Step 1: Write the failing helper test**

Create `apps/server/src/singleton-pass.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SingletonRole } from "@waitron/db";
import type { PassReport } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const PRIMARY_REPORT: PassReport = { nextDueAt: NOW, duties: [] };

describe("singletonPass", () => {
  it("runs the primary pass when the node holds the singletons", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    const pass = singletonPass(() => "primary", runPrimary);
    expect(await pass(NOW)).toBe(PRIMARY_REPORT);
    expect(runPrimary).toHaveBeenCalledOnce();
  });

  it("returns an empty pass and never runs the primary pass for a secondary", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    const pass = singletonPass(() => "secondary", runPrimary);
    expect(await pass(NOW)).toEqual({ nextDueAt: null, duties: [] });
    expect(runPrimary).not.toHaveBeenCalled();
  });

  it("reads the role PER PASS, so a promotion mid-run starts the duties on the next tick", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    let role: SingletonRole = "secondary";
    const pass = singletonPass(() => role, runPrimary);
    expect(await pass(NOW)).toEqual({ nextDueAt: null, duties: [] });
    expect(runPrimary).not.toHaveBeenCalled();
    role = "primary"; // a promotion flips the holder
    expect(await pass(NOW)).toBe(PRIMARY_REPORT);
    expect(runPrimary).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/server test singleton-pass`
Expected: FAIL — `./singleton-pass.js` does not exist.

- [ ] **Step 3: Write the helper**

Create `apps/server/src/singleton-pass.ts`:

```ts
import type { SingletonRole } from "@waitron/db";
import type { PassReport } from "./pass.js";

/** Wraps the fiscal/settlement pass so it runs ONLY when this node holds the singleton duties
 * (deployment.singleton_role = 'primary'). A mirror or a sell-only local secondary returns a trivial
 * empty pass — running drain/reconcile there would submit to AEAT / settle for a host that must not
 * (promotion runbook design §2/§3c; #33 §7). `getRole` is read PER PASS (not captured once), so a later
 * promotion that flips the holder starts the duties on the next tick, no restart. */
export function singletonPass(
  getRole: () => SingletonRole,
  runPrimaryPass: (now: Date) => Promise<PassReport>,
): (now: Date) => Promise<PassReport> {
  return (now) =>
    getRole() === "primary"
      ? runPrimaryPass(now)
      : Promise.resolve({ nextDueAt: null, duties: [] });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/server test singleton-pass`
Expected: PASS.

- [ ] **Step 5: Wire it into boot**

In `apps/server/src/boot.ts`:

1. Add to the `@waitron/db` import and `./singleton-pass.js` import at the top: `readSingletonRole` (from `@waitron/db`) and `singletonPass` (from `./singleton-pass.js`).
2. Just after `const modeHolder = { current: await readDeploymentMode(db) };` (the read-once holder), add:

```ts
  // The singleton-ownership axis (promotion runbook design §2), read into its own refreshable holder
  // beside modeHolder: a 'secondary' node (a mirror OR a sell-only local secondary) runs no fiscal
  // duties; only a 'primary' drains/reconciles. Read PER PASS below, so a later promotion that flips
  // this holder starts the duties on the next tick, no restart.
  const singletonRoleHolder = { current: await readSingletonRole(db) };
```

3. In the `runLoop({ ... })` call, replace the current `pass:` property —

```ts
    pass: isMirror
      ? () => Promise.resolve({ nextDueAt: null, duties: [] })
      : (at) =>
          runPass(
            { /* … existing drain/reconcile/monotonicMs/log … */ },
            at,
          ),
```

— with the `singletonPass`-wrapped form, keeping the existing `runPass({...}, at)` body verbatim:

```ts
    pass: singletonPass(
      () => singletonRoleHolder.current,
      (at) =>
        runPass(
          { /* … the SAME existing drain/reconcile/monotonicMs/log object, unchanged … */ },
          at,
        ),
    ),
```

Leave the `const isMirror = …` line and every other `isMirror` use (the read-only gate, `mountSyncApi`, retention, tunnel) exactly as they are — those are correctly gated on *mode*, not the singleton role; only the fiscal pass moves to `singleton_role`.

- [ ] **Step 6: Run the affected server suites to verify no regression**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot`
Expected: PASS — `boot.mirror.rls.test.ts` still passes because `setDeploymentMode('mirror')` now yields `(mirror, secondary)` → `singletonPass` returns the empty pass (same behaviour as the old `isMirror` branch), and the default-primary `boot.test.ts` boot is `(primary, primary)` → `runPass` (unchanged).

- [ ] **Step 7: Full server coverage + typecheck**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/server typecheck`
Expected: PASS, coverage ≥ 95/95/90/88 (apps/server's documented threshold).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/singleton-pass.ts apps/server/src/singleton-pass.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): gate the fiscal pass on deployment.singleton_role

A mirror or a sell-only local secondary runs no drain/reconcile; only a
singleton-holder (singleton_role='primary') does. Read per pass via
singletonPass, so a later promotion that flips the holder starts the duties
on the next tick with no restart. Corrects the old isMirror gate, which
would have run the AEAT submitter on an active-active local secondary."
```

---

## Self-Review

**Spec coverage:** §2 (the `singleton_role` axis, the invalid-combo rejection, "set explicitly not defaulted", "selling never reads it") → Task 1. §3c (gate the singleton workers on `singleton_role`, read per-pass for a live flip) → Task 2. §3b's refreshable holder → Task 2 step 5. Everything else in the spec (mount-and-gate, live start of mode-gated workers, promote endpoint, break-glass, fresh-SIF, fence, cold restore) is out of this slice by design (spec §3f/§9) and named in the plan header.

**Placeholder scan:** none — every step carries real SQL/TS/test code. The single `/* … */` marker in Task 2 step 5 is a "keep this existing block verbatim" instruction, not new code to invent.

**Type consistency:** `SingletonRole` / `readSingletonRole` / `setSingletonRole` are defined in Task 1 and consumed by Task 2's `singletonPass` and boot wiring with the same signatures. `PassReport` (`{ nextDueAt: Date | null; duties: [...] }`) matches the empty-pass literal the existing boot already used. `deployment.not_stamped` is an existing code (reused, not added).

## Execution Handoff

Two execution options once approved:
1. **Subagent-Driven (recommended)** — a fresh subagent per task with review between; matches this repo's default.
2. **Inline Execution** — batch with checkpoints.
