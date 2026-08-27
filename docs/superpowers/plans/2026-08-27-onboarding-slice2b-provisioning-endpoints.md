# Onboarding Slice 2b: `/setup-api` provisioning endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `/setup-api` JSON POST surface that takes the setup wizard's input, **provisions the venue in-process** (`planVenue`/`applyVenue`), does the **demo/live fork** (stamps `preproduction`/`production`), **seals the AEAT certificate** for a live ES-common venue, **persists the trading config**, and **restarts the process into trading mode**. The wizard front-end is slice 2c; this slice is a clean API only.

**Architecture:** A pure `provision.ts` orchestrator (guard → `stampDeployment` → `applyVenue` → optional AEAT seal) driven by IO-injected deps; a `trading-config.ts` that atomically writes `<stateDir>/trading.env`; new POST routes in `setup-api.ts` that validate the request, apply the demo/live + cert-required gates, run the orchestrator once (an in-process latch), persist, and `requestRestart`. Boot's setup branch grows the deps `mountSetup` needs (the owner DB connection, the vault `KeyRing` read back from `secrets.env`, `stateDir`, `requestRestart`). The dev launcher sources `trading.env` so the restart lands in trading mode locally.

**Tech Stack:** TypeScript (Node ≥24), Hono 4.x, `@waitron/provisioning` (`planVenue`/`applyVenue`), `@waitron/db` (`stampDeployment`/`readDeploymentEnvironment`/`withTenant`), `@waitron/credentials` (`putCredential`/`loadKeyRing`), Vitest, Testcontainers (real-Postgres for the provisioning paths via `@waitron/db/testing/lifecycle`).

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md) §3 (demo/live fork), §5 (setup mode drives provisioning in-process), §9 (persisted secrets/config), §10 (admin/tenant/location + AEAT-cert-required for live). **Implementation map (READ IT):** `.superpowers/notes/2b-implementation-map.md` in this worktree — exact signatures + `file:line` for every call below. Builds on slice 2a (#141): `ensureBoxSecrets`, `<stateDir>/secrets.env`, HTTPS setup boot.

---

## Scope rulings (decided at planning; surfaced for the owner to revise)

- **RULING R1 — venue-only, NOT full `instance` role-splitting.** The wizard **stamps** the environment + runs **`applyVenue`** + (live) seals the AEAT cert + persists + restarts. It does **NOT** run `planInstance`/`applyInstance` (the fresh-DB + 3-least-privilege-roles creation). Rationale: slice 1b already migrates `DATABASE_URL` in setup boot; the dev flows don't role-split; and least-privilege role/DB creation is **appliance-image infra that does not exist yet**. Building wizard-driven role-splitting would build against non-existent infra and require an admin (createrole) connection in the browser-facing setup process. **Deviation from spec §5's "planInstance/applyInstance in-process":** deferred to the appliance-image slice; recorded in the backlog at land. `trading.env`'s `DATABASE_URL` therefore stays the boot app `DATABASE_URL`; provisioning runs under the **owner** connection (`config.migrationsDatabaseUrl` — it owns the tables it migrated).
- **RULING R2 — the demo/live fork stamps the DB directly** via `stampDeployment(ownerDb, environment)` (exported from `@waitron/db`), because `applyVenue` requires an already-stamped DB and 2b does not run `instance` (which normally stamps). `stampDeployment` is idempotent for the same value and **throws `deployment.already_stamped` on a changed value** — the DB-level guard that a preproduction DB can never become production (spec §5, CLAUDE.md §5). `WAITRON_ENV` written into `trading.env` MUST equal the stamped value or the trading boot's `assertDeploymentMatches` throws.
- **RULING R3 — config persistence: a separate `<stateDir>/trading.env`** (0600, atomic), leaving 2a's `secrets.env` untouched; the supervisor/dev-launcher sources **both**. Boot is unchanged (reads `process.env`).
- **RULING R4 — restart: inject `requestRestart` into `SetupDeps`** (default `() => process.kill(process.pid, "SIGTERM")`, reusing `bin.ts`'s graceful-shutdown latch); flush the HTTP 200 first, then schedule the shutdown on the next tick.
- **RULING R5 — the vault `KeyRing` is recovered by boot parsing `<stateDir>/secrets.env`** (2a wrote it but never loaded it into the setup process) and passed into `mountSetup`, so the AEAT seal can `putCredential` in the same session.
- **RULING R6 — anti-duplicate is TWO layers** (fiscal footgun — a second `applyVenue` mints a NEW SIF/hash chain, CLAUDE.md §5): (a) an in-process one-shot latch so a double-POST within a session cannot re-provision; (b) a pre-`applyVenue` check that the deterministic `obligadoTenantId(country, taxId)` does **not** already exist (via `withTenant` + select), refusing `setup.already_provisioned` if it does. Once provisioned, the restart into trading mode removes the setup routes entirely.

**This slice does NOT modify any fiscal-core primitive** (huella, the append-only/immutability triggers, invoice numbering, `computeHuella`, the chain). It only *calls* the already-landed, already-reviewed `applyVenue` from HTTP. The fiscal review focus is the gates (R2 stamp, R6 guard, cert-required-for-live) and that no chain primitive is touched.

## What this slice is NOT (defer)

- **No wizard UI** — that is slice 2c (`apps/setup` Vite+Lit). 2b is JSON API only.
- **No full `instance` role-splitting / DB creation** (R1) — appliance-image slice.
- **No mDNS/trust UX** (slice 3); **no appliance systemd unit** (slices 5–6) — but the plan SPECIFIES the dev-launcher `trading.env` sourcing so the restart is exercisable locally, and documents the systemd `EnvironmentFile` requirement for the appliance.

## Global Constraints

- **Node ≥ 24; pnpm 9.15.0.** TDD: failing test first → red → minimal impl → green → commit. Prove guards by deletion.
- **Coverage — changes are in `apps/server` (98/98/98/95).** Run `pnpm --filter @waitron/server test:coverage`. Real-PG tests need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **The trading boot path stays behaviourally unchanged** (CLAUDE.md §5). 2b only adds to the **setup** branch + setup-api; the trading branch is untouched.
- **Error codes name the DOMAIN concept** (CLAUDE.md §3), a file that throws imports `./errors.js`. New codes live under `setup.*` (e.g. `setup.already_provisioned`, `setup.aeat_cert_required`, `setup.request_invalid`) — grep siblings (`setup.mode_active`, `setup.cert_hostnames_empty`) for the naming shape before adding.
- **Never build SQL by string concatenation** (CLAUDE.md §3) — all DB access via Drizzle/`withTenant`; no utility statements here.
- **An empty connection string is a valid connection string** (CLAUDE.md §3) — any admin/owner URI reaching a `Client` must be refused if `""`.
- **AEAT `certKind` is `"sello" | "representante"`** (identity type / SOAP host family), NOT prod/test — prod-vs-homologation is the deployment `environment`. Validate the enum.
- **A live/`production` ES-common venue REQUIRES the AEAT cert** before it can trade (spec §10); a demo/`preproduction` venue makes it optional.

---

## Task 1: `trading-config.ts` — atomically persist the trading env

**Files:** Create `apps/server/src/trading-config.ts`; Test `apps/server/src/trading-config.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface TradingConfig {
    tenantId: string; tillId: string; nodeId: string; seriesId: string; locationId: string;
    databaseUrl: string; migrationsDatabaseUrl: string; environment: "production" | "preproduction";
  }
  /** Atomically write <stateDir>/trading.env (KEY=value\n, 0600) — the file the supervisor sources
   *  on the next boot so the five WAITRON_TILL_*_ID + DATABASE_URL(+migrations) + WAITRON_ENV are
   *  present and the box boots in TRADING mode. Sibling to 2a's secrets.env (left untouched). */
  export async function writeTradingEnv(stateDir: string, cfg: TradingConfig): Promise<string>; // returns the path written
  ```
  Body: build the KEY=value block (`WAITRON_TILL_TENANT_ID`, `WAITRON_TILL_TILL_ID`, `WAITRON_TILL_NODE_ID`, `WAITRON_TILL_SERIES_ID`, `WAITRON_TILL_LOCATION_ID`, `DATABASE_URL`, `WAITRON_MIGRATIONS_DATABASE_URL`, `WAITRON_ENV`), write via temp-then-rename at mode `0o600` (reuse the exact atomic-write idiom from `box-secrets.ts`'s `writeFileAtomic` — import/extract a shared helper OR duplicate the 4-line idiom with a comment; prefer extracting `writeFileAtomic` into a tiny `fs-atomic.ts` both `box-secrets.ts` and this file import, to avoid a second copy — do that extraction here and update `box-secrets.ts` to import it).

- [ ] **Step 1: Failing test** — write to a `mkdtemp` dir, assert the file exists at `<dir>/trading.env`, mode `0o600`, and contains each of the 8 `KEY=value` lines with the exact names (`WAITRON_ENV=production`, `WAITRON_TILL_TENANT_ID=<id>`, …), LF-terminated, and no `.tmp` lingering.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Extract `writeFileAtomic` from `box-secrets.ts` into `apps/server/src/fs-atomic.ts`** (exported), update `box-secrets.ts` to import it (behaviour identical), and implement `writeTradingEnv` using it.
- [ ] **Step 4: Run — PASS** (both `trading-config.test.ts` and the existing `box-secrets.test.ts` — the extraction must not change box-secrets behaviour).
- [ ] **Step 5: Coverage + commit** `-s`: `feat(server): trading-config — atomically persist trading.env for the setup→trading restart`.

---

## Task 2: `provision.ts` — the venue-provisioning orchestrator (real-PG)

The fiscal-adjacent core. Guard → stamp → `applyVenue`. IO-injected so the plan/validation paths need no container, but the happy path is proven against real Postgres.

**Files:** Create `apps/server/src/provision.ts`; Test `apps/server/src/provision.test.ts` (real-PG via the shared-container harness — see `apps/server/src/*.rls.test.ts` for the `useRealPostgres`/`useTemplateDb` pattern).

**Interfaces:**
- Consumes: `planVenue`, `applyVenue`, `type VenueRequest`, `type VenueResult` from `@waitron/provisioning`; `stampDeployment`, `readDeploymentEnvironment`, `withTenant`, `type Database` from `@waitron/db`; `obligadoTenantId` from `@waitron/provisioning`.
- Produces:
  ```ts
  export interface ProvisionRequest {
    environment: "production" | "preproduction";   // from the demo/live fork
    venue: VenueRequest;                            // country/taxId/legalName/location/tillName/series/admin(hashed)
  }
  export interface ProvisionDeps { ownerDb: Database; } // the OWNER connection (config.migrationsDatabaseUrl)
  /** Stamp the environment then applyVenue, refusing a box that already holds THIS tenant. Returns the
   *  five ids the trading boot needs. Does NOT persist config or seal the cert — the caller does that. */
  export async function provisionVenue(deps: ProvisionDeps, req: ProvisionRequest): Promise<VenueResult>;
  ```
  Body (order matters):
  1. `planVenue(req.venue)` FIRST (pure; validates locales/series/territory; derives `tenantId = obligadoTenantId(...)`). A validation failure throws before any DB write.
  2. **Guard (R6b):** `await withTenant(deps.ownerDb, tenantId, tx => readTenantExists(tx))` — if the tenant row already exists, throw `AppError("setup.already_provisioned", { tenantId })`. (Use a minimal `select 1 from tenants where id = current_tenant_id()` under the GUC; register the code in `errors.ts`.)
  3. `await stampDeployment(deps.ownerDb, req.environment)` (R2). Idempotent same-value; a changed value throws `deployment.already_stamped` — let it propagate (it is the correct fiscal guard).
  4. `return await applyVenue(planVenue(req.venue), { db: deps.ownerDb })` — the single `withTenant` transaction that mints tenant/location/till/node/SIF/series + seeds the admin.

- [ ] **Step 1: Failing real-PG test** — on a fresh migrated DB (owner connection): `provisionVenue` returns a `VenueResult` with the five ids; `readDeploymentEnvironment` now equals the requested environment; a SECOND `provisionVenue` with the same NIF throws `setup.already_provisioned` (the fiscal-footgun guard) and mints **no** second SIF/chain (assert the SIF/series row count did not grow). Also: stamping `production` then calling with `preproduction` throws `deployment.already_stamped`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Register `setup.already_provisioned` in `errors.ts`, `import "./errors.js"`. Keep the order above (plan → guard → stamp → applyVenue). Read the map's §2/§9 for the exact `VenueRequest` fields + `applyVenue` semantics.
- [ ] **Step 4: Run — PASS.** Prove the guard by deletion (remove the tenant-exists check → the double-provision test mints a second chain → fails → restore).
- [ ] **Step 5: Coverage + commit** `-s`: `feat(server): provisionVenue — stamp + applyVenue with a double-provision guard (onboarding 2b)`.

---

## Task 3: AEAT credential sealing

**Files:** Create `apps/server/src/aeat-credential.ts`; Test `apps/server/src/aeat-credential.test.ts` (real-PG — `tenant_credentials` is FORCE-RLS).

**Interfaces:**
- Consumes: `putCredential`, `type KeyRing` from `@waitron/credentials`; `withTenant`, `type Database` from `@waitron/db`.
- Produces:
  ```ts
  export type CertKind = "sello" | "representante";
  export interface AeatCert { pfxBase64: string; passphrase: string; certKind: CertKind; }
  /** Seal the AEAT cert into the fiscal.aeat vault purpose for `tenantId`, under withTenant (RLS). */
  export async function sealAeatCredential(db: Database, ring: KeyRing, tenantId: string, cert: AeatCert): Promise<void>;
  ```
  Body: validate `certKind ∈ {sello, representante}` and `pfxBase64` is non-empty base64 (throw `setup.request_invalid` otherwise); `await withTenant(db, tenantId, tx => putCredential(tx, ring, { tenantId, purpose: "fiscal.aeat", value: { pfxBase64, passphrase, certKind } }))`. `putCredential` runs `validatePayload` (exact field match) internally.

- [ ] **Step 1: Failing real-PG test** — after a tenant exists, `sealAeatCredential` stores the cert; reading it back (`getCredential` under `withTenant`) returns the three fields; a bad `certKind` throws `setup.request_invalid`; an empty `pfxBase64` throws.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Register any new code in `errors.ts`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Coverage + commit** `-s`: `feat(server): sealAeatCredential — seal the AEAT PFX into the fiscal.aeat vault (onboarding 2b)`.

---

## Task 4: `setup-api.ts` — the provisioning POST endpoints + demo/live + cert gate + latch

**Files:** Modify `apps/server/src/setup-api.ts`; Test `apps/server/src/setup-api.test.ts` (bare Hono + injected deps — no container for the validation/gate/latch paths; one real-PG happy-path test may live in `boot.test.ts` Task 5).

**Interfaces:**
- `SetupDeps` grows (all injected, so the suite stays containerless for the non-DB paths):
  ```ts
  export interface SetupDeps {
    environment: DeploymentEnvironment;               // existing (the boot default; the request overrides via demo/live)
    provision?: (req: ProvisionRequest) => Promise<VenueResult>;   // bound to provisionVenue({ownerDb}) in boot
    sealAeat?: (tenantId: string, cert: AeatCert) => Promise<void>; // bound to sealAeatCredential(db, ring, …)
    persistTrading?: (cfg: TradingConfig) => Promise<void>;         // bound to writeTradingEnv(stateDir, …)
    databaseUrl?: string; migrationsDatabaseUrl?: string;           // to compose the TradingConfig
    requestRestart?: () => void;                                   // default at boot: SIGTERM (R4)
  }
  ```
  (Keep them optional so the existing `mountSetup(app, {environment}, log)` call sites/tests still compile; boot supplies the real ones. If a provisioning POST arrives without them wired, respond `503 setup.not_ready`.)
- New routes, registered **before** the `GET *` catch-all:
  - `POST /setup-api/provision` — body = `{ mode: "demo" | "live", venue: {…plaintext admin pin/password…}, aeatCert?: {pfxBase64, passphrase, certKind} }`.
    1. Parse the body defensively (`await c.req.json().catch(() => null)`; null → `400 setup.request_invalid`).
    2. **One-shot latch (R6a):** a module/closure `let provisioning = false`; if set, `409 setup.already_provisioning`; set it for the duration (reset on failure so a corrected retry is possible; leave set on success — the box is about to restart).
    3. **Demo/live fork (R2):** `environment = mode === "live" ? "production" : "preproduction"`.
    4. **Validate + hash:** validate the venue fields; **hash** the admin PIN + password at this boundary (`hashPin`/`hashPassword` from `@waitron/identity`) into the `VenueRequest.admin.{pinHash,passwordHash}` — plaintext never reaches `provision`. Missing/invalid fields → `400 setup.request_invalid`.
    5. **Cert-required gate (spec §10):** if `mode === "live"` AND `location.fiscalTerritory === "ES-common"` AND no `aeatCert` → `400 setup.aeat_cert_required`. (Demo: cert optional.)
    6. `const result = await deps.provision({ environment, venue })` (Task 2). Map `setup.already_provisioned`/`deployment.already_stamped` to `409`.
    7. If `aeatCert` present → `await deps.sealAeat(result.tenantId, aeatCert)` (Task 3).
    8. `await deps.persistTrading({ tenantId: result.tenantId, tillId: result.tillId, nodeId: result.nodeId, seriesId: result.seriesIds[0], locationId: result.locationId, databaseUrl: deps.databaseUrl, migrationsDatabaseUrl: deps.migrationsDatabaseUrl, environment })` (Task 1).
    9. Respond `200 { provisioned: true, tenantId, restarting: true }`, THEN schedule `deps.requestRestart()` on the next tick (`queueMicrotask`/`setTimeout(…,0)`) so the JSON flushes before shutdown (R4).
  - Update `GET /setup-api/status` to also report whether provisioning is in progress if useful (optional; keep `{provisioned:false, environment, needs}` stable otherwise).

- [ ] **Step 1: Failing tests** (bare Hono, injected spies): a valid **demo** body → 200, `provision`/`persistTrading`/`requestRestart` called in order, no `sealAeat` (no cert); a valid **live ES-common** body WITHOUT `aeatCert` → `400 setup.aeat_cert_required` and `provision` NOT called; a valid **live** body WITH cert → `sealAeat` called; a malformed body → `400`; a second concurrent POST while one is in flight → `409 setup.already_provisioning`; the demo/live→environment mapping is asserted (spy sees `production` for live).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Register the new `setup.*` codes. Hash at the boundary. Keep routes before the catch-all.
- [ ] **Step 4: Run — PASS.** Prove the cert-required gate by deletion (remove the gate → the live-without-cert test provisions → fails → restore).
- [ ] **Step 5: Coverage + commit** `-s`: `feat(server): /setup-api/provision — demo/live fork, cert gate, latch, orchestrate + restart (onboarding 2b)`.

---

## Task 5: Boot setup-branch wiring — KeyRing from secrets.env + the owner conn + restart

**Files:** Modify `apps/server/src/boot.ts` (setup branch only); Test `apps/server/src/boot.test.ts` (extend the setup-mode full-boot test).

- [ ] **Step 1: Failing full-boot test** — boot in setup mode (as 2a's HTTPS test does), then `POST /setup-api/provision` with a **demo** venue body over the CA-trusting dispatcher; assert `200 { provisioned: true }`, that `<stateDir>/trading.env` was written with the five till ids + `WAITRON_ENV=preproduction`, that the DB is now stamped `preproduction` and holds exactly one venue, and that the injected `requestRestart` spy fired once. (Inject `requestRestart` via env/test seam so the test process is not actually SIGTERM'd.)
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the wiring** in the setup branch (after `ensureBoxSecrets`):
  - Read `<stateDir>/secrets.env` back (a small `parseEnvFile`, mirror `dev-setup.ts:100-110`) and build the vault `ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY, WAITRON_CREDENTIALS_KEY_VERSION })` (R5). If secrets.env is unreadable, fail loudly (it was just written by `ensureBoxSecrets`).
  - Open the **owner** connection for provisioning: `ownerDb = createPostgresDb(config.migrationsDatabaseUrl)` (owner — it migrated). Close it in the setup teardown (`closePools`).
  - Pass into `mountSetup`: `provision: (req) => provisionVenue({ ownerDb }, req)`, `sealAeat: (tid, cert) => sealAeatCredential(ownerDb, ring, tid, cert)`, `persistTrading: (cfg) => writeTradingEnv(config.stateDir, cfg)`, `databaseUrl: config.databaseUrl`, `migrationsDatabaseUrl: config.migrationsDatabaseUrl`, `requestRestart: () => process.kill(process.pid, "SIGTERM")` (overridable by a test seam), plus the existing `environment`.
  - **Do NOT touch the trading branch.** The setup teardown now also closes `ownerDb`.
- [ ] **Step 4: Run — both setup + trading full-boot tests PASS.** Confirm the trading regression test is untouched.
- [ ] **Step 5: Coverage + commit** `-s`: `feat(server): wire provisioning deps (owner conn, vault ring, restart) into setup mode (onboarding 2b)`.

---

## Task 6: `dev:onboard` restart wiring + verification + backlog/spec notes

**Files:** Modify `apps/server/scripts/dev-server.mjs` (source `trading.env` if present), `apps/server/scripts/dev-onboard.ts` (ensure the owner/admin conn story is documented), `apps/server/.env.example`; the design-spec §16 note (record 2b landed + R1 deviation at land, not here).

- [ ] **Step 1: Make the dev launcher source `trading.env`.** `dev-server.mjs` runs `tsx watch --env-file=.env`. Add `--env-file=<stateDir>/secrets.env` and `--env-file=<stateDir>/trading.env` **when they exist** (Node's `--env-file` is additive; a later file overrides). So after a `POST /setup-api/provision` writes `trading.env` and the process restarts (`tsx watch` restarts on the file change, or the operator re-runs `pnpm dev`), the five till ids are present → the box boots in TRADING mode. Document the systemd `EnvironmentFile=-<stateDir>/{secrets,trading}.env` equivalent for the appliance in a comment.
- [ ] **Step 2: `.env.example` note** — document `trading.env`/`secrets.env` are generated + sourced; the setup-mode `DATABASE_URL`/`WAITRON_MIGRATIONS_DATABASE_URL` must be an **owner-capable** connection (dev: the superuser) so `applyVenue` (owner-only INSERT on `tenants`) can run.
- [ ] **Step 3: Manual verification (documented, best-effort).** `pnpm dev:reset && pnpm dev:onboard && pnpm --filter @waitron/server dev &`, then `curl -sk https://127.0.0.1:8080/setup-api/status`, then `POST /setup-api/provision` a demo venue, confirm `trading.env` is written and (after restart) `/health` returns 200 (trading) + `/setup-api/status` 404. Record output; rely on `boot.test.ts` as the gate if Docker/port contention interferes.
- [ ] **Step 4: Commit** `-s`: `feat(server): dev launcher sources trading.env so the setup→trading restart works locally (onboarding 2b)`.

---

## Self-Review

**1. Spec coverage:** §3 demo/live fork → Task 4 step 3 + Task 2 stamp (R2). §5 provisioning in-process → Task 2 (`applyVenue`; `applyInstance` deferred per R1, recorded). §9 persisted config + restart → Tasks 1, 4, 5 (R3/R4). §10 AEAT-cert-required for live ES-common → Task 4 step 5 + Task 3. **Deferred (stated):** wizard UI (2c); full `instance` role-splitting (R1); appliance systemd unit (5–6).

**2. Placeholder scan:** every task gives the exact call, the exact new error codes, and the order. The one prose test-body ("…") in Task 4 step 1 is enumerated by the surrounding assertions.

**3. Type consistency:** `provisionVenue(ProvisionDeps, ProvisionRequest): Promise<VenueResult>` (T2) → called by boot (T5) and by the endpoint via `deps.provision` (T4). `writeTradingEnv(stateDir, TradingConfig)` (T1) ← `deps.persistTrading` (T4). `sealAeatCredential(db, ring, tenantId, AeatCert)` (T3) ← `deps.sealAeat` (T4). `SetupDeps` grows the four optional deps (T4) that boot binds (T5). `VenueResult.seriesIds[0]` → `TradingConfig.seriesId`.

**Risk note for the fix/review loop:** this is fiscal-ADJACENT (stamps production, provisions the SIF/series/chain via `applyVenue`, seals the AEAT cert). It modifies **no** chain/huella/numbering primitive — it calls the landed `applyVenue`. The reviews must scrutinise: (a) the demo/live→`environment` mapping and that a preproduction DB can never become production (R2 + `stampDeployment` throw); (b) the double-provision guard actually prevents a second SIF/chain (R6, proven by deletion); (c) the cert-required-for-live gate (proven by deletion); (d) the trading branch is byte-for-byte unchanged. Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after any DB-touching change (no new tenant-scoped table here, but the guard is cheap insurance).
