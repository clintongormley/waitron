# Onboarding Slice 1b: Setup-mode boot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the server boots on a box that is **not yet bound to a venue**, it enters **setup mode** — serving a minimal placeholder + a `/setup-api/status` endpoint instead of crashing — rather than dying at the first venue-dependent read. This is the boot/config half of onboarding; the actual provisioning **wizard**, secret generation, and cert handling are **slice 2**.

**Architecture:** Make `config.till` (the five `WAITRON_TILL_*_ID`) **optional** in config. Branch `startServer` on its presence: **absent → setup mode** (mount `/health` + a new `mountSetup` shell, serve, no trading routes/workers, no key ring); **present → trading mode** (today's flow, unchanged). A new `dev:onboard` boots the stack unprovisioned so setup mode is exercisable locally.

**Tech Stack:** TypeScript (Node ≥24), Hono 4.x + `@hono/node-server`, Vitest, Testcontainers (real-Postgres full-boot tests via `@waitron/db/testing/lifecycle`).

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md) (§5 "Server setup mode" + the "Dev story" paragraph). This plan is the second half of the spec's **slice 1**; slice **1a** (serve the built SPAs, PR #137) is already on `main`.

## The detection decision (read before implementing)

**"Provisioned" is detected by `config.till` presence, NOT by a cross-tenant DB query.** The earlier design sketch said "the database is the source of truth." That is not cheaply achievable at boot: `tenants` carries **FORCE ROW LEVEL SECURITY** (`packages/db/src/schema/tenants.ts:57`; `drizzle/0001_tenancy_rls.sql:75`, policy `USING (id = current_tenant_id())`), so `select exists(select 1 from tenants)` returns **false even when tenants exist** on any connection without a tenant GUC set — including the app pool and (unless it holds `BYPASSRLS`) the migrations/owner pool. `dev-setup`'s `inspectVenues` (`apps/server/scripts/dev-setup.ts:161-181`) only works because it uses the container **superuser**, which production does not have.

So the resolution, and why it is safe:

- **Setup trigger = "no venue bound to this server"** = `config.till` absent (the five till ids were never configured, because provisioning is what writes them). RLS-free, needs no DB read.
- **Trading path stays DB-confirmed:** when `config.till` IS present, the existing `readOrderFlow` (`till-config.ts:183-203`) reads the configured tenant's location **via `withTenant(tenantId)`** — which sets the tenant GUC, so RLS permits it. A trading server therefore still proves its venue exists; a present-but-missing venue keeps today's loud crash (a genuine misconfiguration, not the onboarding path).
- **The fiscal anti-duplicate-provisioning guard is NOT this slice's job and does not need the RLS read anyway:** slice 2's wizard is prevented from re-provisioning over existing data by the **`tenants` UNIQUE (country, tax_id)** constraint (`tenants_country_tax_id_key`) — attempt-insert-and-catch-the-unique-violation, exactly as the backlog's `tenant`-command note prescribes. Slice 1b's setup mode performs **no writes**, so it is non-destructive regardless.

This is a deliberate, recorded refinement. If a stronger DB-level "is a venue provisioned" signal is ever wanted, the clean form is a **non-RLS marker** (extend the singleton `deployment` table, or a new singleton set by `applyVenue`) — noted for slice 2, out of scope here.

## Global Constraints

- **Node ≥ 24; pnpm 9.15.0.** TDD: failing test first → red → minimal impl → green → commit. Prove guards by deletion.
- **Coverage — all changes are in `apps/server` (98/98/98/95).** Run `pnpm --filter @waitron/server test:coverage`. Container full-boot tests need `TESTCONTAINERS_RYUK_DISABLED=true` locally (the hook/CI env sets it or tolerates it; the subagent must export it when running the suite locally).
- **The trading (provisioned) boot path MUST be behaviourally unchanged.** This is the fiscal server's critical path (CLAUDE.md §5: nothing blocks a sale). The setup branch is only ever taken when there is **no** venue bound, i.e. the box is not trading. A full-boot test must prove the provisioned path still serves `/`, `/api/*`, `/health` exactly as before.
- **No new error codes** unless genuinely needed; reuse `server.config_invalid { variable, reason }` for a *partially*-configured till (some but not all five ids). Error codes name the domain concept (CLAUDE.md §3); a file that throws imports `./errors.js`.
- **Setup mode requires no credentials key.** `WAITRON_CREDENTIALS_KEY` is only consumed on trading paths (`boot.ts:241,273,301,624` — Stripe/AEAT). `loadKeyRing` moves inside the trading branch, so an unprovisioned box boots without a key.
- **Reuse the `media-api.ts` / `spa-api.ts` house style** for the new `setup-api.ts`: a small explicit module, `mountSetup(app, deps, log)`, plain responses, unauthenticated like `/health`.

---

## Task 1: Make `config.till` optional; gate `loadTillConfig`

**Files:**
- Modify: `apps/server/src/config.ts` (make `till` optional; gate the `loadTillConfig` call)
- Modify: `apps/server/src/till-config.ts` (add a "load-or-undefined, throw-on-partial" entry)
- Test: `apps/server/src/config.test.ts`, `apps/server/src/till-config.test.ts` (match existing test style)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ServerConfig.till?: Omit<TillConfig, "orderFlow">` (was non-optional at `config.ts:72`); a `tryLoadTillConfig(env): Omit<TillConfig,"orderFlow"> | undefined` in `till-config.ts` that returns `undefined` when **all five** `WAITRON_TILL_*_ID` are unset, returns the loaded config when **all five** are set, and **throws `server.config_invalid { variable, reason: "till_config_partial" }`** when *some but not all* are set (a half-configured server is a bug, not a setup box). Task 3 branches on `config.till === undefined`.

- [ ] **Step 1: Write the failing test** in `till-config.test.ts`:

```ts
// none of the five set → undefined (setup mode)
expect(tryLoadTillConfig(envWithout(FIVE_TILL_IDS))).toBeUndefined();
// all five set → a loaded config (spot-check one field)
expect(tryLoadTillConfig(envWithAll(FIVE_TILL_IDS)).tenantId).toBe(EXPECTED_TENANT_ID);
// exactly one missing → server.config_invalid { reason: "till_config_partial" }
expect(() => tryLoadTillConfig(envMissingOneOf(FIVE_TILL_IDS)))
  .toThrow(/* AppError server.config_invalid, reason till_config_partial */);
```

(Reuse the actual fixture helpers `till-config.test.ts` already defines for a full valid till env; `FIVE_TILL_IDS` = `WAITRON_TILL_{TENANT,TILL,NODE,SERIES,LOCATION}_ID`.)

- [ ] **Step 2: Run it — FAIL** (`tryLoadTillConfig` not exported).

- [ ] **Step 3: Implement `tryLoadTillConfig` in `till-config.ts`.** The existing `loadTillConfig` (`till-config.ts:122`) `required()`s each of the five ids (`:155-163`). Add a wrapper:

```ts
const TILL_ID_VARS = [
  "WAITRON_TILL_TENANT_ID", "WAITRON_TILL_TILL_ID", "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID", "WAITRON_TILL_LOCATION_ID",
] as const;

/** Setup mode has no venue, so the five till ids are absent. Return undefined when NONE are set
 * (→ setup mode), the loaded config when ALL are set, and throw on a partial set (a half-configured
 * server is a misconfiguration, never a setup box). */
export function tryLoadTillConfig(env: NodeJS.ProcessEnv): Omit<TillConfig, "orderFlow"> | undefined {
  const present = TILL_ID_VARS.filter((v) => !isUnset(env[v]));
  if (present.length === 0) return undefined;
  if (present.length < TILL_ID_VARS.length) {
    const missing = TILL_ID_VARS.find((v) => isUnset(env[v]))!;
    throw new AppError("server.config_invalid", { variable: missing, reason: "till_config_partial" });
  }
  return loadTillConfig(env);
}
```

Import `isUnset` (it lives in `config.ts`; export it, or duplicate the tiny helper in `till-config.ts` — prefer exporting `isUnset` from `config.ts` and importing it, matching how config already uses it). Ensure `till-config.ts` `import "./errors.js"` (it throws a code now).

- [ ] **Step 4: Run it — PASS.**

- [ ] **Step 5: Make `config.till` optional + gate the call.** In `config.ts`: change `till: Omit<TillConfig, "orderFlow">` (`:72`) to `till?: Omit<TillConfig, "orderFlow">`, and change the return-object line (`:485`) from `till: loadTillConfig(env)` to `till: tryLoadTillConfig(env)`. Add a `config.test.ts` case: a full valid env minus the five till ids → `loadConfig(...).till` is `undefined` and does not throw; a full env → `.till` is defined. (Everything else in `loadConfig` stays; `DATABASE_URL` is still required.)

- [ ] **Step 6: `pnpm --filter @waitron/server typecheck`** — this will now flag the three `config.till.*` consumers in `boot.ts` (`:238`, `:274`, `:294`) as possibly-undefined. **Do NOT fix them here** — Task 3 moves all three inside the trading branch where `config.till` is proven present. If typecheck must stay green between tasks, add a temporary `assert`/narrowing at those three sites with a `// TODO(task-3): moves into trading branch` and remove it in Task 3. Note this in the report. (Commit this task even with that temporary narrowing; the branch is green at each task boundary.)

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95. Commit `-s`: `feat(server): make config.till optional (tryLoadTillConfig) for setup-mode boot`.

---

## Task 2: The `setup-api.ts` module (`/setup-api/status` + placeholder)

**Files:**
- Create: `apps/server/src/setup-api.ts`
- Test: `apps/server/src/setup-api.test.ts`

**Interfaces:**
- Consumes: `Hono`, `Logger` (import as `media-api.ts`/`spa-api.ts` do). A `SetupDeps` with the read-only facts setup mode can report — `{ environment: DeploymentEnvironment }` (from `config.environment`); do NOT pass `db`, a key, or a tenant.
- Produces: `export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void` — registers `GET /setup-api/status` → `c.json({ provisioned: false, environment, needs: ["venue"] }, 200)` and a **root catch-all** `GET *` → a minimal placeholder HTML page (`c.html(...)`, `text/html`, `no-cache`) saying the box needs setup. Unauthenticated, like `/health`. Registered LAST (it is a catch-all) — Task 3 mounts it after `/health` and `/setup-api/status` so the JSON route wins its own path.

- [ ] **Step 1: Failing test** in `setup-api.test.ts` (bare Hono app + `app.request`):

```ts
it("reports unprovisioned status as JSON", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const res = await app.request("/setup-api/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ provisioned: false, environment: "preproduction", needs: ["venue"] });
});
it("serves a setup placeholder page for any other path", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const res = await app.request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toMatch(/set ?up/i);
});
it("does not shadow a route registered before it (e.g. /health)", async () => {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  mountSetup(app, { environment: "preproduction" }, () => {});
  expect((await app.request("/health")).status).toBe(200);
  expect(await (await app.request("/health")).json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `setup-api.ts`.** Mirror the `media-api.ts` header-comment style. `mountSetup` registers the two routes; the placeholder is a short inline HTML string (no external asset — the real setup **app** is slice 2). Keep the JSON shape stable and documented (slice 2's wizard/front-end will read `/setup-api/status`).

- [ ] **Step 4: Run — PASS. Coverage. Commit** `-s`: `feat(server): setup-api — /setup-api/status + placeholder for an unprovisioned box`.

---

## Task 3: Branch `startServer` into setup vs trading mode

The refactor. Split `startServer` so an unprovisioned box (`config.till === undefined`) serves only `/health` + `mountSetup`, and a provisioned box runs today's exact flow.

**Files:**
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/boot.test.ts` (extend the existing container full-boot suite — cover BOTH modes)

**Interfaces:**
- Consumes: `tryLoadTillConfig` result (`config.till`) from Task 1; `mountSetup` from Task 2.
- Produces: setup-mode boot behaviour; the trading path unchanged.

- [ ] **Step 1: Failing full-boot tests** in `boot.test.ts` (reuse its `useTemplateDb({ template: "manifest" })` harness, `TESTCONTAINERS_RYUK_DISABLED=true`):

```ts
// SETUP MODE: migrated DB, NO venue, env WITHOUT the five till ids and WITHOUT a credentials key.
it("boots in setup mode when no venue is bound: serves /setup-api/status and a placeholder, no crash", async () => {
  const server = await startServer(setupModeEnv(dbUrl)); // dbUrl → migrated, zero tenants
  try {
    const status = await fetch(`${base}/setup-api/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ provisioned: false });
    expect((await fetch(`${base}/`)).status).toBe(200);              // placeholder, not a crash
    expect((await fetch(`${base}/health`)).status).toBeLessThan(600); // health still answers
    // trading routes are NOT mounted:
    expect((await fetch(`${base}/api/staff`)).status).toBe(404);
  } finally {
    await server.close();
  }
});
// TRADING MODE unchanged: provisioned venue + full env still serves the app + APIs (regression guard).
it("boots in trading mode when a venue is bound: /api and the SPAs behave exactly as before", async () => {
  /* provision a venue into the template DB, full env incl. the five till ids + a key + app dirs;
     assert /api/staff works and /setup-api/status is 404 (setup routes NOT mounted when trading). */
});
```

`setupModeEnv` = the minimal env after Task 1: `DATABASE_URL`, `WAITRON_MIGRATIONS_DIR`/env as the suite already needs, `WAITRON_ENV`, `WAITRON_HTTP_PORT` — and **no** `WAITRON_TILL_*_ID`, **no** `WAITRON_CREDENTIALS_KEY`.

- [ ] **Step 2: Run — the setup-mode test FAILS** (today boot crashes at `readOrderFlow`, `boot.ts:294`, or earlier at `loadKeyRing`, `boot.ts:211`, on the missing key).

- [ ] **Step 3: Implement the branch.** In `startServer` (`boot.ts:174`):

- Keep the shared prefix in **both** modes: `loadConfig`, the maxTickMs guard, the slice-1a `assertBuiltApp` checks, the deployment-stamp probe (`boot.ts:203-207`) and `applyMigrations` (`boot.ts:217`) and the app pool open (`boot.ts:234`), plus `createHealthState` and `const app = healthApp(health, now)` (`boot.ts:268`). Setup mode still wants a migrated DB (ready for slice 2's wizard) and `/health`.
- **Move `loadKeyRing` (`boot.ts:211`) to the TOP of the trading branch** — it is only consumed on trading paths (`boot.ts:241,273,301,624`), so an unprovisioned box does not need `WAITRON_CREDENTIALS_KEY`.
- **Branch on `config.till`** right after the app is created (`boot.ts:268`) and before the `readOrderFlow` merge (`boot.ts:294`):

```ts
if (config.till === undefined) {
  // SETUP MODE — box not bound to a venue. No key ring, no venue read, no trading routes/workers.
  mountSetup(app, { environment: config.environment }, log);
  // (deliberately NOT mounting the till/dashboard SPAs — they are useless without a venue; the
  //  real setup wizard app arrives in slice 2. media stays optional/harmless — omit for now.)
  // serve + signal handling, but NO drain/reconcile workers (nothing to submit yet).
} else {
  const ring = loadKeyRing(env);                         // moved here from :211
  // ... the entire existing flow from the readOrderFlow merge (:294) through the sync block and
  //     the mounts, plus buildCardProvider/reconciler that consume `ring` and `config.till`.
}
```

Both branches converge on the existing `serve(buildServeOptions(...))` + the `StartedServer`/`close()` return. Extract the shared serve/return so it is written once. The reconciler/duty setup (`boot.ts:222-241`) and `runLoop` workers move into the trading branch (a setup box has no fiscal duties). Keep `close()` idempotent and correct for the setup branch (no workers/sync to abort).

- [ ] **Step 4: Run — both full-boot tests PASS.** Then **prove the branch by deletion**: force `config.till` to always-undefined and confirm the trading test fails (setup routes served instead of `/api`), then restore.

- [ ] **Step 5: Remove any temporary narrowing** added in Task 1 Step 6 (the three `config.till.*` sites now live in the `else` branch where it is defined). `typecheck` clean.

- [ ] **Step 6: Full coverage.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95, `boot.ts` branch coverage intact (both modes exercised by the two full-boot tests). Commit `-s`: `feat(server): boot into setup mode when no venue is bound`.

---

## Task 4: `dev:onboard` — exercise setup mode locally

**Files:**
- Create: `apps/server/scripts/dev-onboard.ts` (a trimmed `dev-setup` that migrates but does NOT provision)
- Modify: `apps/server/package.json` (add `dev:onboard`), root `package.json` (add `dev:onboard`)
- Modify: `apps/server/scripts/dev-server.mjs` if needed so a setup-mode `.env` (no till ids/key) is accepted

**Interfaces:**
- Consumes: the setup-mode boot from Task 3.
- Produces: `pnpm dev:onboard` → docker Postgres up + migrated + **no venue** + server running in setup mode, `/setup-api/status` reachable.

- [ ] **Step 1: Write `dev-onboard.ts`.** Reuse `dev-setup.ts`'s building blocks: `waitForPostgres`, then `applyMigrations(databaseUrl, migrationOptionsFor(manifestSets(), null))` (the exact call at `dev-setup.ts:310`) — and **STOP** (no `provisionVenue`). Then write a **setup-mode `apps/server/.env`**: `DATABASE_URL` (the dev URL), `WAITRON_ENV=preproduction`, `WAITRON_HTTP_PORT=8080` — and deliberately **no** `WAITRON_TILL_*_ID`, **no** `WAITRON_CREDENTIALS_KEY`. Guard like `dev-setup`: if the DB already holds a venue, refuse and point at `dev:reset` (a venue-bearing DB is not a setup-mode target). Reuse `inspectVenues` (superuser dev query — fine in dev).

- [ ] **Step 2: Wire the scripts.** `apps/server/package.json`: `"dev:onboard": "tsx scripts/dev-onboard.ts"`. Root `package.json`: `"dev:onboard": "docker compose up -d --wait db && pnpm --filter @waitron/server dev:onboard"`. Confirm `dev-server.mjs`'s `.env`-exists gate (`dev-server.mjs:21-27`) accepts the setup `.env` (it only checks existence — a minimal `.env` passes).

- [ ] **Step 3: Manual verification (documented, not a unit test).**

```bash
pnpm dev:reset >/dev/null 2>&1 || true      # start from a clean volume
pnpm dev:onboard                             # migrate-only + write setup .env
pnpm --filter @waitron/server dev &          # boots in setup mode
sleep 3
curl -s http://127.0.0.1:8080/setup-api/status   # {"provisioned":false,...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/   # 200 (placeholder)
```

Record the output in the report. (A `dev-onboard.ts` unit test against real Postgres — first run migrates + writes a venue-less `.env` + leaves zero tenants — is worthwhile if it fits the suite; otherwise the boot.test.ts setup-mode test already covers the server behaviour and this step covers the script.)

- [ ] **Step 4: Commit** `-s`: `feat(server): dev:onboard — boot the stack unprovisioned to exercise setup mode`.

---

## Self-Review

**1. Spec coverage** (spec §5 + "Dev story"):
- "detect unprovisioned, serve setup placeholder, skip venue-dependent routes" → Tasks 1–3. ✅
- "dev onboarding mode — boot the server unprovisioned" → Task 4. ✅
- **Deliberately NOT here (slice 2):** the real setup **wizard** front-end and its endpoints driving `planInstance`/`planVenue`; secret generation + persistence (vault key, CA); the self-signed cert; the AEAT-cert-required step. Slice 1b serves a *placeholder* + status only.

**2. Placeholder scan:** the two `/* ... */` in Task 3's branch sketch are illustrative structure, not code-to-paste — the step names the exact lines to move (`loadKeyRing` `:211` → trading branch; branch between `:268` and `:294`) and what each branch mounts. `setupModeEnv`, `envWithout`, etc. are named as "reuse the suite's existing helpers."

**3. Type consistency:** `tryLoadTillConfig(env): Omit<TillConfig,"orderFlow"> | undefined` (Task 1) is what `config.till?` holds and what Task 3 branches on. `mountSetup(app, {environment}, log)` (Task 2) is called with `config.environment` in Task 3. `server.config_invalid { variable, reason }` matches the existing code shape.

**Risk note carried into the fix/review loop:** Task 3 restructures the fiscal server's boot. The regression guard is the **trading-mode full-boot test** proving `/api/*` still works unchanged; the whole-branch (finish-branch) review must scrutinise that the provisioned path — reconciler, drain/reconcile workers, sync, `close()` — is byte-for-byte equivalent to today, only relocated inside the `else` branch.
