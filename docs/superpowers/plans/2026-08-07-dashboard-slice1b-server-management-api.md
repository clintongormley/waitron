# Dashboard Slice 1b — Server Management API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the slice-1a identity auth foundation over HTTP as a management API on `apps/server` — a browser management-session cookie, login/logout, and `person.manage`-gated staff CRUD — so the dashboard app (1c) has a real backend.

**Architecture:** A new Hono route group `mountManagementApi(app, deps, log)` attaching to the server's single shared app under the `/management-api/*` prefix, mirroring `mountTillApi`. A new management-session cookie (`waitron_management_session`) parallels the till's `waitron_till_session`; `requireManagementSession` reads and shape-validates it, and the identity functions (`loginManager`, `authorizeManager`, `listPersons`, staff mutations) do the real DB work under `withTenant` + `asAppUser`. One new identity function (`setPassword`) lets an admin grant dashboard access.

**Tech Stack:** Hono `^4.6`, `@hono/node-server`, Drizzle, `@waitron/identity` (slice 1a), Vitest (Testcontainers real-PG for the RLS API test).

**Depends on:** slice 1a (`@waitron/identity` must export `loginManager`, `authorizeManager`, `resolveManagementSession`, `endManagementSession`, `listPersons`, `createPerson`/`setRole`/`resetPin`/`suspendPerson`/`reactivatePerson` with `managementSessionId`, `listActiveStaff`, `PersonSummary`, `PersonRoleValue`).

## Global Constraints

- **The server serves ONE venue = one tenant.** All handlers scope to `deps.cfg.tenantId` (the same tenant the till config resolves). There is no cross-tenant management here.
- **`apps/server` has no barrel** — every file that throws an `AppError` code starts with `import "./errors.js";`. New codes go in `apps/server/src/errors.ts`'s `declare module "@waitron/shared"` block; `server.*` is reserved for facts about the process. Codes are never renamed once shipped.
- **Coverage thresholds: 98 / 98 / 98 / 95** (`apps/server/vitest.config.ts`).
- **The management API is served in dev by the dashboard's Vite proxy (1c); the server serving a built bundle is deployment #9** — not in scope here. Routes live under `/management-api/*` so the dashboard proxies exactly that prefix.
- **Every commit `-s`.** Before green: `pnpm --filter @waitron/server test:coverage` and (because the RLS test needs it) `TESTCONTAINERS_RYUK_DISABLED=true`.
- **`till-session.ts`'s cookie flags are the template**: `httpOnly: true`, `sameSite: "Strict"`, `path: "/"`, `secure` from `deps.secureCookies` (itself `config.tls !== undefined`).

---

### Task 1: `setPassword` in `@waitron/identity` (admin grants dashboard access)

**Design note:** the dashboard's `loginManager` needs a `password_hash` on the person. Bootstrapping the *first* admin's password is a provisioning concern (extend `waitron-provision venue` — a separate follow-up, flagged in Task 8). This task adds the general admin-sets-password path so the system is self-sustaining once one admin can log in.

**Files:**
- Modify: `packages/identity/src/staff.ts` (add `setPassword`)
- Modify: `packages/identity/src/staff.test.ts` (coverage)
- Modify: `packages/identity/src/index.ts` (export `setPassword`)

**Interfaces:**
- Consumes: `authorizeManager` (1a Task 8), `assertPasswordLength`/`hashPassword` (1a Task 2).
- Produces: `setPassword(tx, input: { managementSessionId: string; personId: string; password: string }): Promise<void>` — gated on `person.manage`; throws `password.too_short`.

- [ ] **Step 1: Write the failing test** — add to `packages/identity/src/staff.test.ts`:

```ts
it("setPassword lets a manager grant dashboard access, then that person can log in", async () => {
  const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
  const target = await seedPerson(suite.db, tenantId, "supervisor");
  await run((tx) => setPassword(tx, { managementSessionId: sessionId, personId: target, password: "second horse" }));
  const session = await run((tx) => loginManager(tx, { tenantId, personId: target, password: "second horse" }));
  expect(session.personId).toBe(target);
});

it("setPassword rejects a too-short password", async () => {
  const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
  const target = await seedPerson(suite.db, tenantId, "staff");
  const code = await run((tx) => codeOf(() => setPassword(tx, { managementSessionId: sessionId, personId: target, password: "short" })));
  expect(code).toBe("password.too_short");
});
```

(Add `setPassword` and `loginManager` to the file's imports.)

- [ ] **Step 2: Run, verify it fails** — Run: `pnpm --filter @waitron/identity test staff` · Expected: FAIL, `setPassword` not defined.

- [ ] **Step 3: Implement `setPassword`** in `staff.ts`:

```ts
export async function setPassword(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; password: string },
): Promise<void> {
  await authorizeManager(tx, { managementSessionId: input.managementSessionId, permission: "person.manage" });
  assertPasswordLength(input.password);
  await tx.update(persons).set({ passwordHash: hashPassword(input.password) }).where(eq(persons.id, input.personId));
}
```

(Import `assertPasswordLength`, `hashPassword` from `./verify-password.js` and `authorizeManager` from `./manager-login.js` if not already imported.)

- [ ] **Step 4: Export + run** — add `export { setPassword } from "./staff.js";` to `index.ts`. Run: `pnpm --filter @waitron/identity test staff` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/staff.ts packages/identity/src/staff.test.ts packages/identity/src/index.ts
git commit -s -m "feat(identity): setPassword (admin grants dashboard access)"
```

---

### Task 2: Management-session cookie helpers

**Files:**
- Create: `apps/server/src/management-session.ts`
- Create: `apps/server/src/management-session.test.ts`

**Interfaces:**
- Produces: `MANAGEMENT_COOKIE: string`, `setManagementCookie(c, sessionId, secure)`, `clearManagementCookie(c)`, `requireManagementSession(c): string` (returns the session id; throws `management_session.required` if the cookie is missing or not a UUID). Reuses `isUuid` from `./till-session.js`.

- [ ] **Step 1: Write the failing test** — `apps/server/src/management-session.test.ts`:

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { MANAGEMENT_COOKIE, clearManagementCookie, requireManagementSession, setManagementCookie } from "./management-session.js";

const VALID = "11111111-1111-4111-8111-111111111111";

describe("management-session cookie", () => {
  it("sets an httpOnly, SameSite=Strict cookie", async () => {
    const app = new Hono();
    app.get("/set", (c) => { setManagementCookie(c, VALID, true); return c.body(null, 204); });
    const res = await app.request("/set");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${MANAGEMENT_COOKIE}=${VALID}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
  });
  it("requireManagementSession returns the id from a valid cookie", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ id: requireManagementSession(c) }));
    const res = await app.request("/read", { headers: { cookie: `${MANAGEMENT_COOKIE}=${VALID}` } });
    expect(await res.json()).toEqual({ id: VALID });
  });
  it("requireManagementSession throws when the cookie is missing", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ id: requireManagementSession(c) }));
    let thrown: unknown;
    app.onError((err, c) => { thrown = err; return c.body(null, 500); });
    await app.request("/read");
    expect(isAppError(thrown) && thrown.code).toBe("management_session.required");
  });
});
```

- [ ] **Step 2: Run, verify it fails** — Run: `pnpm --filter @waitron/server test management-session` · Expected: FAIL, module not found.

- [ ] **Step 3: Implement `management-session.ts`:**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isUuid } from "./till-session.js";

export const MANAGEMENT_COOKIE = "waitron_management_session";

export function setManagementCookie(c: Context, sessionId: string, secure: boolean): void {
  setCookie(c, MANAGEMENT_COOKIE, sessionId, { httpOnly: true, secure, sameSite: "Strict", path: "/" });
}

export function clearManagementCookie(c: Context): void {
  deleteCookie(c, MANAGEMENT_COOKIE, { path: "/" });
}

export function requireManagementSession(c: Context): string {
  const id = getCookie(c, MANAGEMENT_COOKIE) ?? null;
  if (id === null || !isUuid(id)) throw new AppError("management_session.required", {});
  return id;
}
```

(`management_session.required` is declared in `@waitron/identity`'s `errors.ts` (1a). Because this file throws it, keep the `import "./errors.js";` first line — but the *definition* lives in identity's augmentation, which is loaded transitively via the identity imports the server already makes. If `errors.reachability` in the server complains, add `import "@waitron/identity";` for the side effect. Confirm at Step 4.)

- [ ] **Step 4: Run, verify pass** — Run: `pnpm --filter @waitron/server test management-session` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/management-session.ts apps/server/src/management-session.test.ts
git commit -s -m "feat(server): management-session cookie helpers"
```

---

### Task 3: `mountManagementApi` skeleton + error boundary + roster/login/logout

**Files:**
- Create: `apps/server/src/management-api.ts`
- Modify: `apps/server/src/errors.ts` (if any new `server.*`/validation codes are needed — see Step 1)
- Test: covered by the real-PG suite in Task 6 (login is only meaningfully testable against a migrated DB)

**Interfaces:**
- Produces: `interface ManagementApiDeps { db: Database; cfg: { tenantId: string }; secureCookies: boolean }`, `mountManagementApi(app: Hono, deps: ManagementApiDeps, log: Logger): void`. A local `run(c, log, fn)` boundary + `STATUS` map (management codes → HTTP).

- [ ] **Step 1: Confirm the STATUS mapping.** The management routes surface these AppError codes (all already declared — identity in 1a, server in existing `errors.ts`): `management_session.required` → 401, `management_session.expired` → 401, `password.invalid` → 401, `totp.invalid` → 401, `person.suspended` → 403, `person.not_found` → 404, `authorization.not_permitted` → 403, `pin.too_short` → 400, `password.too_short` → 400, `shared.invalid_id` → 400. No new code needed unless a body-validation code is wanted; if so add `management.request_invalid: { field: string }` to `apps/server/src/errors.ts`.

- [ ] **Step 2: Implement the skeleton + boundary + first three routes** — `apps/server/src/management-api.ts`:

```ts
import "./errors.js";
import "@waitron/identity"; // side-effect: identity's error-code augmentations
import type { Context } from "hono";
import type { Hono } from "hono";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import {
  endManagementSession, listActiveStaff, loginManager, type PersonRoleValue,
} from "@waitron/identity";
import { codeOf } from "./error-code.js";
import { clearManagementCookie, requireManagementSession, setManagementCookie } from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js"; // match till-api.ts's Logger import

export interface ManagementApiDeps {
  db: Database;
  cfg: { tenantId: string };
  secureCookies: boolean;
}

const STATUS: Record<string, number> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "password.invalid": 401,
  "totp.invalid": 401,
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "pin.too_short": 400,
  "password.too_short": 400,
  "shared.invalid_id": 400,
};

async function run(c: Context, log: Logger, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (cause) {
    if (isAppError(cause)) {
      const status = STATUS[cause.code] ?? 400;
      log("warn", cause.code, cause.params);
      return c.json({ error: { code: cause.code, params: cause.params } }, status as never);
    }
    log("error", "management.failed", { errorCode: codeOf(cause) });
    return c.json({ error: { code: "server.internal" } }, 500);
  }
}

export function mountManagementApi(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  // Pre-login roster for the login screen (ungated, active staff only, no secrets).
  app.get("/management-api/staff-roster", (c) =>
    run(c, log, async () => {
      const roster = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listActiveStaff(tx);
      });
      return c.json(roster);
    }),
  );

  // Login: password (+ TOTP iff enrolled) → management session cookie.
  app.post("/management-api/session", (c) =>
    run(c, log, async () => {
      const body = await c.req.json<{ personId?: string; password?: string; totp?: string }>();
      if (typeof body.personId !== "string" || !isUuid(body.personId) || typeof body.password !== "string") {
        throw (await import("@waitron/shared")).AppError
          ? new (await import("@waitron/shared")).AppError("password.invalid", {})
          : new Error("bad request");
      }
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManager(tx, {
          tenantId: deps.cfg.tenantId,
          personId: body.personId!,
          password: body.password!,
          totp: body.totp,
        });
      });
      setManagementCookie(c, session.id, deps.secureCookies);
      return c.json({ personId: session.personId });
    }),
  );

  // Logout: idempotent.
  app.delete("/management-api/session", (c) =>
    run(c, log, async () => {
      const id = requireManagementSessionOrNull(c);
      if (id !== null) {
        await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await endManagementSession(tx, id);
        });
      }
      clearManagementCookie(c);
      return c.body(null, 204);
    }),
  );
}
```

Simplify the login body-guard (the dynamic-import is wrong) — import `AppError` at the top and write:

```ts
import { AppError, isAppError } from "@waitron/shared";
// …
if (typeof body.personId !== "string" || !isUuid(body.personId) || typeof body.password !== "string") {
  throw new AppError("password.invalid", {}); // do not reveal which field failed pre-auth
}
```

and add a tiny helper for the idempotent logout (missing cookie ⇒ still 204):

```ts
function requireManagementSessionOrNull(c: Context): string | null {
  try { return requireManagementSession(c); } catch { return null; }
}
```

- [ ] **Step 3: Typecheck** — Run: `pnpm --filter @waitron/server typecheck` · Expected: PASS (fix the `Logger` import path to match `till-api.ts` exactly; the exploration shows `mountTillApi(app, deps, log: Logger)` — reuse that `Logger` type).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/management-api.ts apps/server/src/errors.ts
git commit -s -m "feat(server): management API skeleton — roster, login, logout"
```

---

### Task 4: Gated staff routes (list / create / patch / reset-pin / set-password)

**Files:**
- Modify: `apps/server/src/management-api.ts` (add the five gated routes inside `mountManagementApi`)

**Interfaces:**
- Consumes: `requireManagementSession` (Task 2); `listPersons`, `createPerson`, `setRole`, `suspendPerson`, `reactivatePerson`, `resetPin`, `setPassword` (identity 1a + Task 1).

- [ ] **Step 1: Add the routes** inside `mountManagementApi`, after logout. Import the identity functions at the top.

```ts
  // List all persons (roles, status, credential booleans — never secrets). Gated.
  app.get("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const people = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listPersons(tx, { managementSessionId: sessionId });
      });
      return c.json(people);
    }),
  );

  // Create a person. Gated.
  app.post("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await c.req.json<{ displayName?: string; role?: PersonRoleValue; pin?: string }>();
      if (typeof body.displayName !== "string" || typeof body.role !== "string" || typeof body.pin !== "string") {
        throw new AppError("management.request_invalid", { field: "displayName|role|pin" });
      }
      const created = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createPerson(tx, {
          tenantId: deps.cfg.tenantId, managementSessionId: sessionId,
          displayName: body.displayName!, role: body.role!, pin: body.pin!,
        });
      });
      return c.json(created, 201);
    }),
  );

  // Update role and/or status. Gated.
  app.patch("/management-api/staff/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
      const body = await c.req.json<{ role?: PersonRoleValue; status?: "active" | "suspended" }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        if (body.role !== undefined) await setRole(tx, { managementSessionId: sessionId, personId: id, role: body.role });
        if (body.status === "suspended") await suspendPerson(tx, { managementSessionId: sessionId, personId: id });
        if (body.status === "active") await reactivatePerson(tx, { managementSessionId: sessionId, personId: id });
      });
      return c.body(null, 204);
    }),
  );

  // Reset a person's PIN. Gated.
  app.post("/management-api/staff/:id/reset-pin", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
      const body = await c.req.json<{ pin?: string }>();
      if (typeof body.pin !== "string") throw new AppError("management.request_invalid", { field: "pin" });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await resetPin(tx, { managementSessionId: sessionId, personId: id, pin: body.pin! });
      });
      return c.body(null, 204);
    }),
  );

  // Set a person's dashboard password. Gated.
  app.post("/management-api/staff/:id/password", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
      const body = await c.req.json<{ password?: string }>();
      if (typeof body.password !== "string") throw new AppError("management.request_invalid", { field: "password" });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await setPassword(tx, { managementSessionId: sessionId, personId: id, password: body.password! });
      });
      return c.body(null, 204);
    }),
  );
```

- [ ] **Step 2: Add `management.request_invalid`** to `apps/server/src/errors.ts`: `"management.request_invalid": { field: string };` and confirm STATUS maps it to 400 (Task 3 STATUS — add if missing).

- [ ] **Step 3: Typecheck** — Run: `pnpm --filter @waitron/server typecheck` · Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/management-api.ts apps/server/src/errors.ts
git commit -s -m "feat(server): gated staff routes (list/create/patch/reset-pin/set-password)"
```

---

### Task 5: Wire `mountManagementApi` into boot

**Files:**
- Modify: `apps/server/src/boot.ts` (call `mountManagementApi` beside `mountTillApi`)

- [ ] **Step 1: Add the mount** in `boot.ts`, immediately after the `mountTillApi(...)` call (around line 236–247):

```ts
mountManagementApi(app, { db, cfg: { tenantId: till.tenantId }, secureCookies: config.tls !== undefined }, log);
```

(Import `mountManagementApi` from `./management-api.js`. `till.tenantId` is the already-resolved `TillConfig.tenantId`; the management API scopes to the same venue tenant.)

- [ ] **Step 2: Typecheck + full server suite** — Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test` · Expected: PASS (boot wiring compiles; existing suites unaffected).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/boot.ts
git commit -s -m "feat(server): mount management API in boot"
```

---

### Task 6: Real-Postgres end-to-end RLS test

**Files:**
- Create: `apps/server/src/management-api.rls.test.ts`

**Interfaces:** consumes `mountManagementApi` + a provisioned venue (mirror `till-api.rls.test.ts`'s `applyVenue(planVenue(...))` setup).

- [ ] **Step 1: Write the failing test** — mirror `apps/server/src/till-api.rls.test.ts`'s harness (real PG via `useRealPostgres` + `startRealPostgres`, `probeRole` inheriting `app_user`, a `new Hono()` driven with `app.request`). Seed a **manager with a password** (insert a person, then `setPassword` via an opened management session, OR seed directly with `hashPassword`). Assert the full flow:

```ts
// Pseudocode structure — fill against the till-api.rls.test.ts patterns:
// 1. provision venue (applyVenue(planVenue({...}), { db: suite.admin })), capture tenantId.
// 2. seed a manager person; set password_hash directly via suite.admin + withTenant + raw update using hashPassword("correct horse").
// 3. app = new Hono(); mountManagementApi(app, { db: suite.admin, cfg: { tenantId }, secureCookies: false }, noopLog);

it("login → list → create → verify persistence", async () => {
  const login = await app.request("/management-api/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: managerId, password: "correct horse" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]; // waitron_management_session=…

  const listed = await app.request("/management-api/staff", { headers: { cookie } });
  expect(listed.status).toBe(200);
  expect((await listed.json()).some((p: { displayName: string }) => p.displayName === "The Manager")).toBe(true);

  const created = await app.request("/management-api/staff", {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ displayName: "Ada", role: "staff", pin: "4321" }),
  });
  expect(created.status).toBe(201);

  // Re-read as app_user to prove a genuine row landed under the tenant.
  const rows = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return tx.execute(sql`select display_name from persons where display_name = 'Ada'`);
  });
  expect(rows.length).toBe(1);
});

it("rejects an unauthenticated staff list with 401", async () => {
  const res = await app.request("/management-api/staff");
  expect(res.status).toBe(401);
});

it("rejects a wrong password with 401 and sets no cookie", async () => {
  const res = await app.request("/management-api/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: managerId, password: "wrong" }),
  });
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
});

it("refuses staff-role creation with 403", async () => {
  // log in a staff-role person (also given a password), attempt POST /staff → 403 authorization.not_permitted
});
```

- [ ] **Step 2: Run, verify it fails, then passes as you implement** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api.rls` · Expected: PASS once wiring is correct.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/management-api.rls.test.ts
git commit -s -m "test(server): real-PG management API — login, list, create, RLS, refusals"
```

---

### Task 7: Full-package green

- [ ] **Step 1: Coverage gate** — Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` · Expected: PASS at 98/98/98/95 (includes the RLS suite and `errors.reachability`). If reachability fails on a new code, ensure the throwing file imports `./errors.js` and the code is declared.
- [ ] **Step 2: Identity still green** — Run: `pnpm --filter @waitron/identity test:coverage` · Expected: PASS (Task 1's `setPassword` covered).
- [ ] **Step 3: Workspace gate** — Run from root: `pnpm lint && pnpm typecheck && pnpm format:check` · Expected: PASS.
- [ ] **Step 4:** no commit — verification only.

---

### Task 8: Record the bootstrapping follow-up

**Files:** none (documentation of a known gap).

- [ ] **Step 1:** In the eventual PR description (and as a *Debt and odd jobs* entry when this lands), record: **"The first admin has no dashboard password."** `waitron-provision venue` seeds an admin with a PIN but no `password_hash`, so no one can log into the dashboard until an admin password exists. Options for the provisioning follow-up: extend `waitron-provision venue` to prompt for/set an initial admin password, or add a one-off `waitron-provision set-password` command. This is a **provisioning** task, out of scope for 1b/1c, but blocks a true end-to-end first login. `setPassword` (Task 1) covers every subsequent person.

---

## Self-Review

**Spec coverage (§2 management API, §3 staff CRUD, §4d session):**
- `/management-api/*` route group on the local server, one venue/tenant — Tasks 3–5. ✅
- Management-session cookie mirroring the till's flags — Task 2. ✅
- Login (password + TOTP-iff-enrolled), logout — Task 3. ✅
- Gated staff list/create/patch/reset-pin/set-password — Tasks 1, 4. ✅
- Real-PG RLS + refusal proofs (unauth 401, wrong password 401, staff-role 403, cross-tenant isolation via the seeded single tenant) — Task 6. ✅
- First-admin bootstrapping gap surfaced, not silently skipped — Task 8. ✅
- **Out of 1b (correctly):** the dashboard UI (1c), passkeys (1d), TOTP self-enrollment UX, federated login. None appear as tasks.

**Placeholder scan:** Task 6 uses labelled pseudocode for the harness *setup* (which must be copied from the real `till-api.rls.test.ts` in the tree) but gives real assertions; every other step is real code. The one dynamic-import mistake in Task 3 Step 2 is explicitly corrected in the same step. ✅

**Type consistency:** `ManagementApiDeps.cfg.tenantId` threads to every `withTenant`; `requireManagementSession(c): string` feeds `managementSessionId` into every identity call; `MANAGEMENT_COOKIE`/`setManagementCookie` names are stable across Tasks 2–3. ✅
