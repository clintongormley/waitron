# Promote endpoint — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing in-process `promoteMirrorToPrimary` an authenticated network trigger — a `POST /management-api/promote` endpoint reachable on a warm-standby mirror, guarded by a manager login or an offline break-glass secret, using a real admin DB connection for the owner write.

**Architecture:** A thin HTTP endpoint that authenticates (two paths) then delegates to the **boot-wired promote closure** already built in `boot.ts` (which runs `promoteMirrorToPrimary` and triggers the restart-into-primary). Adds: a `node.promote` permission, a `deployment.break_glass_verifier` column + scrypt mint/verify, a `WAITRON_ADMIN_DATABASE_URL` config that both `withOwnerDb` callers fall back through, and an explicit "awaiting fiscal certificate" state so a promoted cloud that sells-but-cannot-file is never silent.

**Tech Stack:** TypeScript, Hono, Drizzle, PostgreSQL (real-PG via Testcontainers + PGlite), Vitest, pnpm workspaces.

**Spec:** [`docs/superpowers/specs/2026-09-07-promote-endpoint-slice-2-design.md`](../specs/2026-09-07-promote-endpoint-slice-2-design.md) — read it alongside this plan; every task argues from it.

## Global Constraints

- **Target: mirror → primary ONLY.** The endpoint mounts on `isMirror` nodes; `promoteLocalSecondaryToPrimary` stays unwired (shelved active-active — spec §2). Do not add a target parameter.
- **Sell now, file later (explicit).** A promoted cloud sells + chains locally; it does NOT file until a separate cert-distribution slice. The not-filing state MUST be surfaced (log + box-status), never silent (spec §4.3).
- **Error codes name the domain concept, never the throwing package**, and are never renamed once shipped (`CLAUDE.md` §3). New code: `promotion.break_glass_invalid` (the `promotion.*` family).
- **The owner write needs the owner/admin connection** — `app_user` holds no `UPDATE` on `deployment`; it fails closed with `42501`, never a silent no-op (spec §5).
- **KDF is scrypt via `packages/identity/src/secret-hash.ts` (`hashSecret`/`verifySecret`)** — the repo deliberately avoids argon2/bcrypt native modules. Do NOT add a hashing dependency.
- **Never build SQL by string concatenation** except utility DDL, which uses `quoteIdent`/`quoteLiteral` or validate-and-throw (`CLAUDE.md` §3).
- **`deployment` is a hand-written custom migration** (`packages/db/drizzle/0001_db_baseline_sql.sql`, not in the drizzle barrel) — a new column is a `db:generate:custom` migration + the `pgTable` definition in `schema/deployment.ts` (`CLAUDE.md` §3 rebase rule for migration numbers).
- **Real Postgres for anything about roles, the read-only gate, or the owner connection** (`CLAUDE.md` §4); `TESTCONTAINERS_RYUK_DISABLED=true` locally; run `pnpm reap` if a run is interrupted.
- **The gate before a PR:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then per-package `pnpm --filter <pkg> test:coverage` (CI runs coverage, not `test`).
- **`git commit -s`** on every commit; feature work in the worktree, never on `main`.

---

### Task 1: The `node.promote` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts` (the `PERMISSIONS` array, ~line 86 where `mirror.create` sits, and the role→permission mapping in the same file)
- Test: `packages/identity/src/permissions.test.ts` (or the existing permissions test — grep for where `mirror.create` is asserted)

**Interfaces:**
- Produces: `"node.promote"` as a member of the `Permission` union (`export type Permission = (typeof PERMISSIONS)[number]`), granted to the same admin/manager role(s) that hold `mirror.create`.

- [ ] **Step 1: Read the siblings.** Open `packages/identity/src/permissions.ts` and find how `mirror.create` is (a) listed in `PERMISSIONS` and (b) mapped to a role in `roleHasPermission`'s backing table. Match that shape exactly — `node.promote` is an admin-only, operator-triggered action like `mirror.create`.

- [ ] **Step 2: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "./permissions.js";

describe("node.promote permission", () => {
  it("is a registered permission", () => {
    expect(PERMISSIONS).toContain("node.promote");
  });
  it("is held by the same role that holds mirror.create", () => {
    // Pick the admin role constant this file uses for mirror.create (grep it in step 1).
    expect(roleHasPermission("owner", "node.promote")).toBe(true);
    expect(roleHasPermission("owner", "mirror.create")).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, watch it fail.** Run: `pnpm --filter @waitron/identity test permissions` — Expected: FAIL (`node.promote` not in `PERMISSIONS`).

- [ ] **Step 4: Add the permission.** Add `"node.promote"` to the `PERMISSIONS` array beside `mirror.create`, and add it to the role's permission set exactly as `mirror.create` is.

- [ ] **Step 5: Run it, watch it pass.** Run: `pnpm --filter @waitron/identity test permissions` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): add node.promote permission"
```

---

### Task 2: The `deployment.break_glass_verifier` column + accessors

**Files:**
- Modify: `packages/db/src/schema/deployment.ts` (add the column to the `pgTable`)
- Create: `packages/db/drizzle/00NN_break_glass_verifier_sql.sql` (custom migration — `db:generate:custom`)
- Modify: `packages/db/src/deployment.ts` (the accessors module — grep for `setSingletonRoleTx`/`readDeploymentAxes` to confirm the file)
- Modify: `packages/db/src/index.ts` (export the new accessors)
- Test: `packages/db/src/deployment.break-glass.test.ts` (new; real-PG via `describeEachTarget` — reads/writes across PGlite + real Postgres)

**Interfaces:**
- Produces:
  - `readBreakGlassVerifier(db: Database | Transaction): Promise<string | null>` — the stored scrypt verifier, or `null` if unset.
  - `setBreakGlassVerifierTx(tx: Transaction, verifier: string): Promise<void>` — owner-role write of the verifier onto the singleton `deployment` row.

- [ ] **Step 1: Write the failing accessor test.**

```ts
// Follow the existing deployment.test.ts harness (describeEachTarget + runMigrations).
it("round-trips the break-glass verifier; app_user can read, owner writes", async () => {
  const db = getDb();
  expect(await readBreakGlassVerifier(db)).toBeNull();
  await db.transaction((tx) => setBreakGlassVerifierTx(tx, "scrypt$aa$bb"));
  expect(await readBreakGlassVerifier(db)).toBe("scrypt$aa$bb");
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/db test deployment.break-glass` — Expected: FAIL (accessors + column absent).

- [ ] **Step 3: Add the column to the schema.** In `packages/db/src/schema/deployment.ts` add `breakGlassVerifier: text("break_glass_verifier")` (nullable — a node minted before this column, and the primary which is never promoted, both hold `null`).

- [ ] **Step 4: Generate the custom migration.** From the repo root:

```bash
pnpm --filter @waitron/db db:generate:custom --name break_glass_verifier
```

Then edit the emitted SQL to exactly: `ALTER TABLE "deployment" ADD COLUMN "break_glass_verifier" text;` — no grant needed (the existing table-level `SELECT` to `app_user` covers reads; the owner writes it). If a migration-number collision appears on rebase, follow `CLAUDE.md` §3's regenerate-never-hand-edit rule.

- [ ] **Step 5: Write the accessors.** In `packages/db/src/deployment.ts`:

```ts
export async function readBreakGlassVerifier(
  db: Database | Transaction,
): Promise<string | null> {
  const [row] = await db.select({ v: deployment.breakGlassVerifier }).from(deployment).limit(1);
  return row?.v ?? null;
}

export async function setBreakGlassVerifierTx(tx: Transaction, verifier: string): Promise<void> {
  await tx.update(deployment).set({ breakGlassVerifier: verifier });
}
```

Export both from `packages/db/src/index.ts`.

- [ ] **Step 6: Run it, watch it pass.** Run: `pnpm --filter @waitron/db test deployment.break-glass` — Expected: PASS on both targets.

- [ ] **Step 7: Confirm the grant shape on real PG (receipt, spec §9.3).** Add an assertion (or a step in the same suite, real-PG only) that `app_user` can `SELECT` the column but a plain `app_user` `UPDATE` of it is refused `42501`. Prove it, don't assume it.

- [ ] **Step 8: Commit.**

```bash
git add packages/db/src/schema/deployment.ts packages/db/drizzle packages/db/src/deployment.ts packages/db/src/index.ts packages/db/src/deployment.break-glass.test.ts
git commit -s -m "feat(db): deployment.break_glass_verifier column + accessors"
```

---

### Task 3: The `promotion.break_glass_invalid` error code

**Files:**
- Modify: `apps/server/src/errors.ts` (the `promotion.*` block, ~line 1344–1392)
- Test: covered by `scripts/errors-reachable.test.ts` (root project) once a thrower imports `./errors.js` — no separate test needed here; the endpoint task exercises it.

**Interfaces:**
- Produces: registered `"promotion.break_glass_invalid": Record<string, never>` (no params — a wrong credential carries no enumerable detail, like `password.invalid`).

- [ ] **Step 1: Add the code.** In `apps/server/src/errors.ts`, beside `promotion.node_fenced`, add `"promotion.break_glass_invalid": Record<string, never>;` with a one-line comment: the offline break-glass fallback was presented wrong/absent; refused before any state change; `promotion.*` names the domain concept, never renamed once shipped.

- [ ] **Step 2: Typecheck.** Run: `pnpm --filter @waitron/server typecheck` — Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/server/src/errors.ts
git commit -s -m "feat(server): register promotion.break_glass_invalid"
```

---

### Task 4: Break-glass mint + verify module

**Files:**
- Create: `apps/server/src/break-glass.ts`
- Test: `apps/server/src/break-glass.test.ts` (real-PG — it reads/writes `deployment` via the owner + app pools)

**Interfaces:**
- Consumes: `generatePassword` (`@waitron/provisioning` — grep the export; it produces 192-bit base64url), `hashSecret`/`verifySecret` (`@waitron/identity`), `readBreakGlassVerifier`/`setBreakGlassVerifierTx` (Task 2).
- Produces:
  - `mintBreakGlassSecret(ownerDb: Database): Promise<string>` — generates a secret, writes its scrypt verifier via the owner pool, returns the RAW secret exactly once (caller surfaces it; never logs it).
  - `verifyBreakGlass(appDb: Database, secret: string): Promise<boolean>` — reads the verifier via the app pool, returns `verifySecret(secret, verifier)`; `false` when no verifier is set.

- [ ] **Step 1: Confirm `generatePassword`'s export path.** Grep `generatePassword` in `packages/provisioning/src` and confirm it's re-exported from `@waitron/provisioning`'s barrel; if not, use `@waitron/provisioning`'s public identifier helper. (It is used by `instance-plan.ts` for role passwords.)

- [ ] **Step 2: Write the failing test.**

```ts
it("mints a secret, stores only a verifier, and verifies it", async () => {
  const secret = await mintBreakGlassSecret(ownerDb);
  expect(secret).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, high-entropy
  const stored = await readBreakGlassVerifier(appDb);
  expect(stored).not.toBeNull();
  expect(stored).not.toContain(secret); // the raw secret is NEVER stored
  expect(stored!.startsWith("scrypt$")).toBe(true);
  expect(await verifyBreakGlass(appDb, secret)).toBe(true);
  expect(await verifyBreakGlass(appDb, "wrong")).toBe(false);
});

it("re-minting invalidates the previous secret", async () => {
  const first = await mintBreakGlassSecret(ownerDb);
  const second = await mintBreakGlassSecret(ownerDb);
  expect(await verifyBreakGlass(appDb, first)).toBe(false);
  expect(await verifyBreakGlass(appDb, second)).toBe(true);
});

it("verify returns false when no verifier is set", async () => {
  expect(await verifyBreakGlass(appDb, "anything")).toBe(false);
});
```

- [ ] **Step 3: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test break-glass` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement.**

```ts
import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecret } from "@waitron/identity";
import { readBreakGlassVerifier, setBreakGlassVerifierTx, type Database } from "@waitron/db";

export async function mintBreakGlassSecret(ownerDb: Database): Promise<string> {
  const secret = generatePassword();
  const verifier = hashSecret(secret);
  await ownerDb.transaction((tx) => setBreakGlassVerifierTx(tx, verifier));
  return secret; // returned once; never logged
}

export async function verifyBreakGlass(appDb: Database, secret: string): Promise<boolean> {
  const verifier = await readBreakGlassVerifier(appDb);
  return verifier !== null && verifySecret(secret, verifier);
}
```

- [ ] **Step 5: Run it, watch it pass.** Run: `pnpm --filter @waitron/server test break-glass` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/break-glass.ts apps/server/src/break-glass.test.ts
git commit -s -m "feat(server): break-glass secret mint + scrypt verify"
```

---

### Task 5: The admin DB connection config, with fail-closed fallback

**Files:**
- Modify: `apps/server/src/config.ts` (add `adminDatabaseUrl` to the trading `Config` type ~line 20–32, and parse `WAITRON_ADMIN_DATABASE_URL` ~line 698–740, defaulting to `migrationsDatabaseUrl`)
- Modify: `apps/server/src/boot.ts` (`withOwnerDb`, ~line 1982 — open the pool from `config.adminDatabaseUrl`; the boot-time fenced-demote at ~line 919–929 shares `withOwnerDb`/the owner pool, so it inherits the change)
- Test: `apps/server/src/config.test.ts` (the fallback); the `42501` fail-closed is proven in the Task 10 e2e.

**Interfaces:**
- Produces: `config.adminDatabaseUrl: string` — the table-owner connection; `= WAITRON_ADMIN_DATABASE_URL` when set, else `migrationsDatabaseUrl` (which itself falls back to `databaseUrl`). It is env/config ONLY — NOT written into `trading.env` (the promote rewrites `trading.env` from a fixed field set and would drop it — spec §5).

- [ ] **Step 1: Write the failing config test.**

```ts
it("adminDatabaseUrl defaults to migrationsDatabaseUrl when unset", () => {
  const cfg = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://app", WAITRON_MIGRATIONS_DATABASE_URL: "postgres://mig" });
  expect(cfg.adminDatabaseUrl).toBe("postgres://mig");
});
it("adminDatabaseUrl uses WAITRON_ADMIN_DATABASE_URL when set", () => {
  const cfg = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://app", WAITRON_ADMIN_DATABASE_URL: "postgres://owner" });
  expect(cfg.adminDatabaseUrl).toBe("postgres://owner");
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test config` — Expected: FAIL (`adminDatabaseUrl` undefined).

- [ ] **Step 3: Add the field + parse.** Add `adminDatabaseUrl: string;` to the trading `Config` type with a comment (the table-owner connection the owner write needs; env-only, never in trading.env). In the parser (~line 739): `adminDatabaseUrl: isUnset(env.WAITRON_ADMIN_DATABASE_URL) ? migrationsDatabaseUrl : env.WAITRON_ADMIN_DATABASE_URL,`.

- [ ] **Step 4: Route `withOwnerDb` through it.** In `boot.ts` change `createPostgresDb(config.migrationsDatabaseUrl)` (~line 1983) to `createPostgresDb(config.adminDatabaseUrl)`, and update the comment: the owner write uses the table-owner admin connection; unset → migrations URL → app URL, so a misconfigured role-split appliance fails closed `42501`, never a silent no-op. Confirm the boot-time fenced-demote (~line 929) uses the same owner pool/helper so it inherits the fallback (if it opens its own pool from `migrationsDatabaseUrl`, switch it to `adminDatabaseUrl` too).

- [ ] **Step 5: Run it, watch it pass; typecheck.** Run: `pnpm --filter @waitron/server test config && pnpm --filter @waitron/server typecheck` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/config.ts apps/server/src/boot.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): WAITRON_ADMIN_DATABASE_URL for the promote owner write (fail-closed fallback)"
```

---

### Task 6: The promote endpoint module

**Files:**
- Create: `apps/server/src/promote-api.ts`
- Test: `apps/server/src/promote-api.test.ts` (unit — a stub `run`, an in-memory Hono app; follows `mirror-bundle-api.test.ts`)

**Interfaces:**
- Consumes: `loginManagerById`/`authorizeManager`/`endManagementSession` (`@waitron/identity`), `withTenant`/`asAppUser`/`Database` (`@waitron/db`), `verifyBreakGlass` (Task 4), `createErrorBoundary`, `readJsonBody`, `isUuid`, `FenceAttestation`/`MirrorPromotionResult` (`./promote.js`).
- Produces: `mountPromoteApi(app: Hono, deps: PromoteApiDeps, log?: Logger): void` mounting `POST /management-api/promote`, where
  `PromoteApiDeps = { appDb: Database; tenantId: string; run: (a: FenceAttestation) => Promise<MirrorPromotionResult> }`.

Body shape: `{ oldNodeNeutralised: boolean } &` either `{ personId, password, totp? }` (manager path) or `{ breakGlass: string }` (fallback). Success → `200 { promoted: boolean, seriesId: string }` (`promoted = !alreadyPrimary`).

- [ ] **Step 1: Write the failing tests.**

```ts
// A stub run() that records the attestation and returns a MirrorPromotionResult.
function appWith(run = vi.fn(async () => ({ alreadyPrimary: false, seriesId: "s1" }))) {
  const app = new Hono();
  mountPromoteApi(app, { appDb: fakeDb, tenantId: TENANT, run });
  return { app, run };
}

it("manager login with node.promote authorizes and promotes", async () => {
  const { app, run } = appWith();
  // fakeDb wired so loginManagerById + authorizeManager('node.promote') succeed (mirror the
  // mirror-bundle-api.test.ts auth-double pattern).
  const res = await app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify({ oldNodeNeutralised: true, personId: PERSON, password: "pw" }),
  });
  expect(res.status).toBe(200);
  expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
  expect(await res.json()).toEqual({ promoted: true, seriesId: "s1" });
});

it("break-glass secret authorizes and promotes", async () => {
  // verifyBreakGlass stubbed true for GOOD_SECRET
  const res = await app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify({ oldNodeNeutralised: true, breakGlass: GOOD_SECRET }),
  });
  expect(res.status).toBe(200);
});

it("a wrong break-glass secret is refused 401 and never calls run", async () => {
  const { app, run } = appWith();
  const res = await app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify({ oldNodeNeutralised: true, breakGlass: "wrong" }),
  });
  expect(res.status).toBe(401); // promotion.break_glass_invalid
  expect(run).not.toHaveBeenCalled();
});

it("no credential is refused 401 and never calls run", async () => { /* body: { oldNodeNeutralised: true } → 401 */ });
it("missing attestation surfaces run's promotion.fence_not_attested (400)", async () => {
  // run = vi.fn().mockRejectedValue(new AppError("promotion.fence_not_attested", {}))
  // body carries valid creds but oldNodeNeutralised:false → 400 fence_not_attested
});
it("run's promotion.node_fenced maps to 409", async () => { /* run rejects node_fenced */ });
```

- [ ] **Step 2: Run them, watch them fail.** Run: `pnpm --filter @waitron/server test promote-api` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement, mirroring `mirror-bundle-api.ts`.**

```ts
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import type { FenceAttestation, MirrorPromotionResult } from "./promote.js";
import { verifyBreakGlass } from "./break-glass.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

export interface PromoteApiDeps {
  appDb: Database;
  tenantId: string;
  run: (attestation: FenceAttestation) => Promise<MirrorPromotionResult>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "promotion.break_glass_invalid": 401,
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "promotion.fence_not_attested": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
};

export function mountPromoteApi(app: Hono, deps: PromoteApiDeps, log: Logger = () => {}): void {
  const run = createErrorBoundary(STATUS, "promotion.failed");
  app.post("/management-api/promote", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        oldNodeNeutralised?: unknown;
        personId?: string; password?: string; totp?: string;
        breakGlass?: string;
      }>(c);
      // Authorize: break-glass path if a secret is present, else the manager-login path.
      if (typeof body.breakGlass === "string") {
        if (!(await verifyBreakGlass(deps.appDb, body.breakGlass))) {
          throw new AppError("promotion.break_glass_invalid", {});
        }
      } else if (typeof body.personId === "string" && isUuid(body.personId) && typeof body.password === "string" &&
                 (body.totp === undefined || typeof body.totp === "string")) {
        await withTenant(deps.appDb, deps.tenantId, async (tx) => {
          await asAppUser(tx);
          const session = await loginManagerById(tx, { tenantId: deps.tenantId, personId: body.personId!, password: body.password!, totp: body.totp });
          await authorizeManager(tx, { managementSessionId: session.id, permission: "node.promote" });
          await endManagementSession(tx, session.id);
        });
      } else {
        throw new AppError("password.invalid", {}); // no usable credential
      }
      // Delegate: run() calls promoteMirrorToPrimary (assertFenced + assertNotFenced + PONR + restart).
      const result = await deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true });
      return c.json({ promoted: !result.alreadyPrimary, seriesId: result.seriesId });
    }),
  );
}
```

- [ ] **Step 4: Run them, watch them pass.** Run: `pnpm --filter @waitron/server test promote-api` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/promote-api.ts apps/server/src/promote-api.test.ts
git commit -s -m "feat(server): mountPromoteApi — two-path auth over the promote closure"
```

---

### Task 7: Wire the endpoint into boot (mount, gate exemption, closure hoist)

**Files:**
- Modify: `apps/server/src/boot.ts` — hoist `withOwnerDb` + the mirror promote `run` closure above the mount point; mount `mountPromoteApi` on `isMirror` before the SPA catch-alls; add the read-only-gate exemption for `POST /management-api/promote`.
- Test: `apps/server/src/boot.promote-endpoint.test.ts` (real-PG) OR extend `boot.promote.test.ts` — a booted mirror serves the endpoint; a booted primary does not (404).

**Interfaces:**
- Consumes: `mountPromoteApi` (Task 6), the existing mirror promote closure body (`boot.ts` ~2060–2101).
- Produces: no new exports; the running mirror serves `POST /management-api/promote`.

- [ ] **Step 1: Hoist the closure.** Extract the mirror promote `run` closure (currently inline in the `makeStartedServer` call, `boot.ts` ~2063–2101, including `withOwnerDb` + `persistTradingEnv` + the `setTimeout(SIGTERM)` restart) into a `const promoteRun` defined once, after `holders`/`ring`/`till`/`config` are in scope and BEFORE the SPA catch-all mount. Pass `promoteRun` both to `mountPromoteApi` and, unchanged, to `makeStartedServer` (so the in-process `StartedServer.promoteMirrorToPrimary` the existing tests call still works). Keep `withOwnerDb` using `config.adminDatabaseUrl` (Task 5).

- [ ] **Step 2: Mount the endpoint.** In the `isMirror` branch, before the SPA catch-alls (near where the read-only gate is applied, ~line 998), add:

```ts
mountPromoteApi(app, { appDb: db, tenantId: config.till.tenantId, run: promoteRun }, log);
```

- [ ] **Step 3: Exempt the path from the read-only gate.** In the `readOnlyGate` `isExempt` predicate (`boot.ts` ~993–995), add the promote path so the authorized POST reaches the handler (the handler is the real guard; a fenced mirror is refused by `assertNotFenced` inside `run`):

```ts
(c) =>
  (c.req.method === "POST" && c.req.path === "/sync-api/cursor") ||
  (fenced && c.req.method === "POST" && c.req.path === "/api/box/retire") ||
  (c.req.method === "POST" && c.req.path === "/management-api/promote"),
```

- [ ] **Step 4: Write the failing boot test.**

```ts
it("a mirror serves POST /management-api/promote (not 404, not gated 403)", async () => {
  const mirror = await bootMirror(); // existing helper in boot.promote.test.ts / boot.mirror.test.ts
  const res = await fetch(`${mirror.url}/management-api/promote`, {
    method: "POST", body: JSON.stringify({ oldNodeNeutralised: true }), // no creds → 401, proves it reached the handler
  });
  expect(res.status).toBe(401); // NOT 403 node_read_only, NOT 404
});
it("a primary does not mount the promote endpoint (404)", async () => {
  const primary = await bootPrimary();
  const res = await fetch(`${primary.url}/management-api/promote`, { method: "POST", body: "{}" });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 5: Run it, watch it fail then pass.** Run: `pnpm --filter @waitron/server test boot.promote-endpoint` — iterate until PASS. Then run the whole promote area unfiltered enough to catch boot regressions: `pnpm --filter @waitron/server test boot.promote boot.mirror`.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.promote-endpoint.test.ts
git commit -s -m "feat(server): mount promote endpoint on a mirror + read-only-gate exemption"
```

---

### Task 8: Mint the break-glass secret at adopt and surface it once

**Files:**
- Modify: `apps/server/src/adopt.ts` (`adoptFromPrimary` — after the mirror is stamped, mint the secret and return it on the result)
- Modify: the setup-api adopt/connect route that calls `adoptFromPrimary` (grep `adoptFromPrimary(` in `apps/server/src` — likely `setup-api.ts`) to include the secret in the connect response ONCE
- Test: `apps/server/src/adopt.test.ts` (extend — the adopt result carries a break-glass secret; the verifier is stored; the secret is never logged)

**Interfaces:**
- Consumes: `mintBreakGlassSecret` (Task 4).
- Produces: `adoptFromPrimary` result gains `breakGlassSecret: string` (the raw secret, surfaced once by the connect response, never logged).

- [ ] **Step 1: Write the failing test.**

```ts
it("adopt mints a break-glass secret and stores only its verifier", async () => {
  const result = await adoptFromPrimary(deps, credential);
  expect(result.breakGlassSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(await verifyBreakGlass(appDb, result.breakGlassSecret)).toBe(true);
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test adopt` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `adoptFromPrimary`, after the deployment is stamped `mode='mirror'` and the owner pool is available (it already seals the sync token via the owner connection), call `const breakGlassSecret = await mintBreakGlassSecret(ownerDb)` and add it to the returned result. Thread it through the connect route's JSON response with a comment mirroring the mirror-bundle "appears once, never logged" discipline; ensure no log line prints it.

- [ ] **Step 4: Run it, watch it pass.** Run: `pnpm --filter @waitron/server test adopt` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/adopt.ts apps/server/src/setup-api.ts apps/server/src/adopt.test.ts
git commit -s -m "feat(server): mint the break-glass secret at adopt, surfaced once"
```

---

### Task 9: Make the awaiting-fiscal-certificate state explicit

**Files:**
- Modify: the fiscal drain worker / its boot wiring (grep `fiscal.aeat` + `credentials.missing` + the drain start; likely `apps/server/src/aeat-transport.ts` and the drain loop in `boot.ts`) so a promoted primary with no `fiscal.aeat` credential surfaces an "awaiting fiscal certificate" status instead of a silent retry loop.
- Modify: the box-status surface (grep `box-status` / `boxStatus` route) to report it.
- Test: `apps/server/src/awaiting-fiscal-cert.test.ts` (real-PG) — a primary with no cert surfaces the state, does not crash, does not file.

**Interfaces:**
- Produces: a box-status field (e.g. `awaitingFiscalCertificate: boolean`) true when the node is a filing primary but `getCredential(fiscal.aeat)` is missing; a single clear log (`fiscal.awaiting_certificate`), not a per-tick error spew.

- [ ] **Step 1: Confirm the drain's current behaviour.** Read how the drain obtains the cert and what it does on `credentials.missing` today (a promoted mirror is the first node that hits this). Establish the failing case: without a cert the drain currently throws/retries silently.

- [ ] **Step 2: Write the failing test.**

```ts
it("a filing primary with no fiscal cert surfaces awaiting-cert and does not crash the drain", async () => {
  const node = await bootPromotedPrimaryWithoutCert();
  const status = await (await fetch(`${node.url}/health/box-status`)).json(); // use the real box-status path
  expect(status.awaitingFiscalCertificate).toBe(true);
  // and: no registros are submitted, selling still works (asserted in Task 10's fuller e2e)
});
```

- [ ] **Step 3: Implement.** In the drain path, catch `credentials.missing` for `fiscal.aeat` specifically, set the awaiting-cert flag (a small in-process status holder), log `fiscal.awaiting_certificate` once (not every tick), and skip the submit rather than throwing. Surface the flag on box-status. Do NOT change chaining — records still chain locally (they are written on the sale path, not the drain).

- [ ] **Step 4: Run it, watch it pass.** Run: `pnpm --filter @waitron/server test awaiting-fiscal-cert` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/aeat-transport.ts apps/server/src/boot.ts apps/server/src/awaiting-fiscal-cert.test.ts
git commit -s -m "feat(server): surface awaiting-fiscal-certificate on a promoted primary (sell now, file later)"
```

---

### Task 10: End-to-end — promote a mirror over HTTP, restart, sell + chain, do not file

**Files:**
- Create: `apps/server/src/promote-endpoint-e2e.test.ts` (real-PG; models the two-node shape from `till-reroute-e2e.test.ts` / `boot.promote.test.ts`)

**Interfaces:**
- Consumes: everything above. No new production code — this task is the receipt (spec §8, §9.1).

- [ ] **Step 1: Write the e2e — the happy path.** Boot a real adopted mirror (reuse `boot.promote.test.ts`'s mirror setup), mint/authorize a `node.promote` manager, then:

```ts
it("mirror → primary over the HTTP endpoint: restarts, sells + chains, does NOT file", async () => {
  const res = await fetch(`${mirror.url}/management-api/promote`, {
    method: "POST",
    body: JSON.stringify({ oldNodeNeutralised: true, personId: ADMIN, password: PW }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ promoted: true });
  // Restart into primary (the harness restarts on SIGTERM, as boot.promote.test.ts does).
  const primary = await restart(mirror);
  // Sells + chains on its own reserved SIF:
  await expectSaleChainsLocally(primary);
  // Does NOT file — awaiting the cert (spec §4.3):
  const status = await (await fetch(`${primary.url}/health/box-status`)).json();
  expect(status.awaitingFiscalCertificate).toBe(true);
  await expectNoRegistrosSubmitted(primary);
});
```

- [ ] **Step 2: The break-glass path.** Same promotion but authorize with the adopt-minted break-glass secret instead of a manager login; assert 200 + promoted.

- [ ] **Step 3: The refusals.** A wrong break-glass → 401 and the node stays a read-only mirror; a valid credential with `oldNodeNeutralised:false` → 400 `promotion.fence_not_attested`, node unchanged.

- [ ] **Step 4: The read-only-gate hole, proven by deletion.** With the exemption in place, the promote POST reaches the handler on the mirror while an ordinary POST (e.g. `/api/...`) still gets 403 `node.read_only`. Then temporarily remove the exemption line (Task 7 step 3) and assert the authorized promote is blocked 403; restore it and confirm green (`CLAUDE.md` §4).

- [ ] **Step 5: The admin-connection fail-closed.** Boot a real-PG node whose `WAITRON_ADMIN_DATABASE_URL` is a non-owner (`app_user`) role; a promote owner write fails closed `42501` (surfaced as a 500/`promotion.failed`), never a silent no-op. With the admin URL unset, it falls back to the migrations URL and succeeds.

- [ ] **Step 6: Run the whole suite.** Run: `pnpm --filter @waitron/server test promote-endpoint-e2e` then the package coverage gate `pnpm --filter @waitron/server test:coverage` (CI runs coverage, not `test`). Expected: PASS at the `apps/server` floor thresholds.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/promote-endpoint-e2e.test.ts
git commit -s -m "test(server): promote-endpoint e2e — sell-now-file-later, both auth paths, gate hole by deletion"
```

---

## Self-Review

**Spec coverage:**
- §3 endpoint (mirror-only, boot-wired closure, restart) → Tasks 6, 7, 10. ✓
- §3 fenced refusal / no-lying-alreadyPrimary → handled by mounting on `isMirror` only + `assertNotFenced` inside `run` (Task 7); the endpoint never dispatches the local-secondary path. ✓
- §4.1 manager login + `node.promote` → Tasks 1, 6, 10. ✓
- §4.2 break-glass mint/verify (scrypt) → Tasks 2, 3, 4, 8, 10. ✓
- §4.3 sell-now-file-later, explicit awaiting-cert → Task 9, asserted in Task 10. ✓
- §5 admin DB connection, fail-closed, both `withOwnerDb` callers, not in trading.env → Task 5, proven in Task 10 step 5. ✓
- §6 mount both/gate hole → Task 7; proven-by-deletion Task 10 step 4. ✓
- §7 fiscal safety (fence passthrough, new chain, immutability) → inherited from `promoteMirrorToPrimary`; the e2e (Task 10) asserts the new chain on its own reserved SIF and no submission. ✓
- §8/§9 receipts → Task 10 (mirror-promote-restart-drain), Task 2 step 7 (grant shape), Task 10 step 1 (auth-row replication is exercised by a real adopted mirror). ✓

**Receipts owed still outside a task:** §9.4 (the 200 reaches the operator before the restart-exit) — Task 10 step 1 exercises the real HTTP round trip and asserts the 200 body, which IS that experiment; if the harness cannot observe the body before SIGTERM, narrow the response contract there (noted in the spec).

**Placeholder scan:** the `00NN` migration number (Task 2) is resolved by `db:generate:custom` at implementation, not a placeholder to hand-fill; grep-confirm steps (Task 1 step 1, Task 4 step 1, Task 8/9 file greps) are deliberate "find the exact sibling" actions, each with a concrete fallback. No `TODO`/`TBD`/"add error handling".

**Type consistency:** `run: (a: FenceAttestation) => Promise<MirrorPromotionResult>` is used identically in Tasks 6 and 7; `readBreakGlassVerifier`/`setBreakGlassVerifierTx` (Task 2) are consumed with matching signatures in Task 4; `verifyBreakGlass`/`mintBreakGlassSecret` (Task 4) match their uses in Tasks 6 and 8; `adminDatabaseUrl` (Task 5) matches its use in `withOwnerDb`.
