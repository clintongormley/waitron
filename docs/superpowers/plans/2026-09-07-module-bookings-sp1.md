# Bookings SP1 — server + data extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract bookings out of the core into a `@waitron/bookings` module — its own migration set, its verbs + routes behind typed module seats, its permission and floor-badge concerns off the core — behaviour-preserving, with the dashboard untouched.

**Architecture:** A new leaf module package holds the bookings schema (its tables leave the core migration set), the verbs, the Hono routes, the floor-badge query, and the sync enrolment. Three new typed seats on `WaitronModule` (`routes`, `permissions`, `floorAnnotations`) are assembled at the composition root and reached by one generic loop each in `boot.ts` / `listTablesWithState`, replacing hardcoded per-domain lines. Shared server-side HTTP helpers lift to a new `@waitron/server-kit`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, drizzle-orm + drizzle-kit, Hono, Vitest, PGlite + Testcontainers (real Postgres), `@waitron/shared` `AppError` registry.

**Spec:** `docs/superpowers/specs/2026-09-07-module-bookings-sp1-server-extraction-design.md` — the plan argues from the spec; executors read both.

**Plan review applied (Opus 5, 2026-09-07):** the task order below is the reviewed one. Its central correction: the schema/migration move CANNOT be a standalone step — it strands `apps/server`'s verbs, verb tests, and the raw-SQL floor read (all set up on `CORE_MIGRATIONS`). So the schema + migrations + verbs + routes move together in ONE atomic task (Task 2). Other review fixes are annotated `[review: …]` at the step that carries them.

## Global Constraints

- **CLAUDE.md §1 — claims discipline.** No comment or doc asserts more than the code delivers. Prove necessity/impossibility by RUNNING (a container, a deletion), never by reading. A correction is a new claim held to the same standard.
- **CLAUDE.md §5 — this branch touches NO fiscal invariant.** The migration split must leave `registros_facturacion` / `registro_sif` / `cadenas` / `envios` and every fiscal trigger byte-unchanged; `packages/fiscal-verifactu`'s `inmutabilidad` scan is the receipt (Task 2).
- **Behaviour-preserving extraction.** Moved tests keep their assertions intact; only setup/imports change. A test rewritten to match new code hides the regression it exists to catch (global CLAUDE.md).
- **No backwards-compat / no data migration (pre-production).** Schema changes drop and recreate; no backfill (CLAUDE.md §3).
- **Migrations are regenerated, never hand-edited.** Follow CLAUDE.md §3's drizzle recipe: reset the migrations dir to its pre-bookings state, then regenerate; the custom `_sql` file (snapshot-less) carries the hand-written grants + composite FKs + triggers, pasted verbatim.
- **Error codes are never renamed once shipped** — codes move packages verbatim, by declaration-merging on `@waitron/shared` (CLAUDE.md §3).
- **Never widen a grant to make a test pass.** `app_user` holds exactly `SELECT, INSERT, UPDATE` on `bookings` — read the ACL back with `has_table_privilege` AND `relacl` (a failed GRANT still materialises acl; group membership yields false positives — CLAUDE.md §3).
- **The module boundary:** seat TYPES live in `@waitron/module`; seat VALUES are exported by `@waitron/bookings` and named only by `@waitron/composition`. After Task 2 no file under `apps/server/src` (production code) imports `@waitron/bookings`; a test may import `BOOKINGS_MIGRATIONS` for setup. `scripts/module-seams.test.ts` must stay green (bookings is a toggleable module, not a regime — the guard pins regimes; still, the design keeps apps/server off it).
- **Gate before every commit that crosses packages:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and for a package `pnpm --filter <pkg> test:coverage` (CI runs coverage, not `test` — CLAUDE.md §2). Run the WHOLE workspace once when a value more than one suite asserts changes (the schema barrel, the error registry, `ALL_MODULES`, the seat maps).
- **Coverage bars:** `@waitron/bookings` takes the **90/90/85/85** floor — a domain module like `@waitron/workforce` (also own-migration-set, also floor), NOT one of the owner's six high-bar packages (CLAUDE.md §2: the six are the owner's list, not a rule that derives them). `@waitron/server-kit` is also at the floor. Only `server-kit` is a genuinely new entry to reason about; neither is added to `scripts/coverage-thresholds.test.ts`'s `HIGH_BAR_PACKAGES`, and the guard auto-applies the floor to any package not on that list.
- **Real-PG vs PGlite:** privilege / grant / trigger-as-`app_user` / two-tenant / concurrency proofs need real Postgres (Testcontainers, `TESTCONTAINERS_RYUK_DISABLED=true` locally). Pure logic uses PGlite. `usePgliteDb`/`useRealPostgres` own the DB; `usePgliteDb({ migrations })` takes a migration-set ARRAY (`packages/db/src/testing/lifecycle.ts`), so a test needing bookings passes `[CORE_MIGRATIONS, BOOKINGS_MIGRATIONS]` (CLAUDE.md §4).

---

## File structure

**New package `packages/server-kit/`:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/error-boundary.ts` (`createErrorBoundary`), `src/error-code.ts` (`codeOf`), `src/read-json-body.ts` (`readJsonBody`), `src/request-screens.ts` (the screens), `src/management-cookie.ts` (the cookie layer, from `apps/server/src/management-session.ts`), `src/errors.ts` (`management.request_invalid`), `src/logger.ts` (the `Logger` type), moved `*.test.ts`.

**New package `packages/bookings/`:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/index.ts`, `src/schema/bookings.ts` (from `packages/db`), `src/errors.ts` (the four `booking.*` codes), `src/bookings.ts` (verbs), `src/routes.ts` (`BOOKINGS_ROUTES`), `src/floor.ts` (`BOOKINGS_FLOOR_ANNOTATIONS`), `src/permissions.ts` (`BOOKINGS_PERMISSIONS`), `src/enrolment.ts` (`BOOKINGS_ENROLMENT`), `src/migrations.ts` (`BOOKINGS_MIGRATIONS`, the set for test setup — mirror how `packages/db` exports `CORE_MIGRATIONS`), `src/privileges.expected.ts` + `.test.ts`, `drizzle/0000_bookings_baseline.sql`, `drizzle/0001_bookings_baseline_sql.sql`, `drizzle/meta/*`, moved `*.test.ts`.

**Modified:** `packages/module/src/module.ts` (seat types), `packages/composition/src/modules.ts` + `composition.test.ts` (descriptor), `packages/migrations/migrations.manifest.json`, `packages/db/src/schema/{bookings.ts deleted, index.ts}` + `drizzle/*` (remove bookings), `packages/identity/src/{permissions.ts, manager-login.ts, index.ts}` (module-permission registration + `Permission` widening), `packages/shared/src/ids.ts` (`isUuid`), `apps/server/src/{boot.ts, modules.ts}` (mount loop, annotator loop, permission registration, route context), `apps/server/src/working-order.ts` (drop the reserved sub-select + timezone read; call annotators), the ~10 cookie-layer consumers + the helper consumers (re-pointed imports), `apps/server/src/errors.ts` (remove `management.request_invalid` + the four `booking.*`), `apps/dashboard/src/api/client.test.ts` (UNCHANGED — the wire pin).

---

## Task 1: `@waitron/server-kit` — lift the shared server-side HTTP helpers

Extract the request helpers and the management-cookie layer so the module's routes (Task 2) can import them without depending on `apps/server`. Widest-touching, lowest-risk (pure moves) — first, to de-risk the rest.

**Files:**
- Create: `packages/server-kit/` (all files above).
- Move: `apps/server/src/error-boundary.ts`, `error-code.ts`, `read-json-body.ts`, `request-screens.ts` → `packages/server-kit/src/`; `apps/server/src/management-session.ts` → `packages/server-kit/src/management-cookie.ts` `[review C3: the cookie layer — MANAGEMENT_COOKIE / setManagementCookie / clearManagementCookie / readManagementSessionId / requireManagementSession; NOT identity's already-existing session-lifecycle file]`.
- Move: `isUuid` from `apps/server/src/till-session.ts:28` → `packages/shared/src/ids.ts`.
- Modify: `apps/server/src/errors.ts` (remove `management.request_invalid:960`); `apps/server/src/till-session.ts` (re-export `isUuid` from shared); every consumer of the moved symbols.

**Interfaces:**
- Produces: `@waitron/server-kit` exports `createErrorBoundary`, `codeOf`, `readJsonBody`, the six request screens (`requireString`, `requireUuidParam`, `requireBodyUuid`, `requireNullableBodyUuid`, `requireNullableString`, `requirePeriod`), the cookie layer (`requireManagementSession`, `readManagementSessionId`, `setManagementCookie`, `clearManagementCookie`, `MANAGEMENT_COOKIE`), and `interface Logger`. `@waitron/shared` exports `isUuid(value: string): boolean`.
- Consumes: `@waitron/shared` (`isAppError`, `AppError`, `isUuid`), `hono` + `hono/cookie`.

- [ ] **Step 1: Scaffold.** Copy `packages/fiscal-none/{package.json,tsconfig.json,vitest.config.ts}`; rename `@waitron/server-kit`; deps `{ "@waitron/shared": "workspace:*", "hono": "<version from apps/server/package.json>" }`; drop drizzle scripts/deps. `pnpm install`.
- [ ] **Step 2: Move `isUuid` → shared FIRST.** `[review: Task-1 ordering — isUuid must land in shared before the files that import it move.]` Add `export function isUuid(value: string): boolean { … }` (verbatim from `till-session.ts:28`) to `packages/shared/src/ids.ts` + barrel. In `apps/server/src/till-session.ts` delete the local def and `export { isUuid } from "@waitron/shared"`. `[review m6: packages/printing/src/agent.ts has its OWN isUuid (deliberate, per its :71 comment) — do NOT touch it.]` Run `pnpm --filter @waitron/shared test:coverage`.
- [ ] **Step 3: Move `error-code.ts` + `error-boundary.ts`.** `git mv` both + tests. Replace `import type { Logger } from "./logger.js"` with server-kit's own `src/logger.ts` (`export interface Logger { … }` — copy only the methods the boundary calls; read `apps/server/src/logger.ts`). Keep `isAppError`/`codeOf` imports.
- [ ] **Step 4: Move `read-json-body.ts` + `request-screens.ts`.** `git mv` both + tests. In `request-screens.ts`: `isUuid` from `@waitron/shared`; `import "./errors.js"` → server-kit's `errors.ts` (Step 6).
- [ ] **Step 5: Move the cookie layer.** `git mv apps/server/src/management-session.ts packages/server-kit/src/management-cookie.ts` + its test. Re-point: `isUuid` from `@waitron/shared`; `import "./errors.js"` → server-kit `errors.ts`. `[review C3: identity's `management_session.*` codes stay in identity — nothing moves out of apps/server errors.ts for the cookie layer; only `management.request_invalid` moves (Step 6).]`
- [ ] **Step 6: Move `management.request_invalid`.** `packages/server-kit/src/errors.ts` declaration-merges `management.request_invalid: { field: string }` (payload verbatim from `errors.ts:960`) onto `@waitron/shared`. Remove from `apps/server/src/errors.ts`.
- [ ] **Step 7: Barrel.** `packages/server-kit/src/index.ts` re-exports everything above + `Logger` + `import "./errors.js"`.
- [ ] **Step 8: Re-point ALL consumers — enumerate, don't summarise.** `[review M4/C3: the literal symbol list.]` Grep and re-point every importer of each moved symbol:
  - `codeOf` → `@waitron/server-kit`: `grep -rl "codeOf" apps/server/src` (expect `boot.ts`, `webhook.ts`, `pass.ts`, `loop.ts`, `bin.ts`, `backup-sweep.ts`, `errors.ts`, and others — re-point every hit).
  - `createErrorBoundary`, `readJsonBody`, the six request screens → `@waitron/server-kit` (each has ~12–20 importers across `apps/server/src/*-api.ts`; grep each name).
  - The cookie layer (`requireManagementSession`, `readManagementSessionId`, `setManagementCookie`, `clearManagementCookie`, `MANAGEMENT_COOKIE`) → `@waitron/server-kit`: expect `box-retire.ts`, `recovery-bundle-api.ts`, `recipe-api.ts`, `read-only-gate.ts`, `booking-api.ts`, `catalogue-api.ts`, `report-api.ts`, `mirror-session.ts`, `me-api.ts`, `boot.ts` (grep to confirm the full set).
  - `isUuid` → `@waitron/shared`: grep `apps/server/src` (till-session re-exports, so leaving `from "./till-session"` also works, but prefer the direct shared import for new edits).
  `booking-api.ts` is re-pointed here even though it moves in Task 2 — so `apps/server` stays green now.
- [ ] **Step 9: Reachability + coverage list + gate.** `scripts/errors-reachable.test.ts` (moved code reachable from server-kit's barrel). Add `server-kit` to `scripts/coverage-thresholds.test.ts` at the floor bar. `pnpm --filter @waitron/server-kit test:coverage`, `@waitron/shared`, then the WHOLE workspace (every re-pointed file). Expected: green.
- [ ] **Step 10: Commit.** `git commit -s -m "server-kit: lift request + cookie helpers out of apps/server (bookings SP1 t1)"`.

---

## Task 2: the atomic bookings extraction (schema + migrations + verbs + routes)

`[review C1: these move TOGETHER — the schema/migration move strands the verbs/routes/tests otherwise. This is the big task; its sub-steps are TDD-ordered but it is one reviewer gate.]` Create `@waitron/bookings`; move the schema out of core into the module's own migration set; move the verbs and all seven routes in behind a new `routes` seat that `boot.ts` mounts generically. The floor read STAYS as raw SQL in `working-order.ts` (Task 5 moves it) — but its test setups gain `BOOKINGS_MIGRATIONS`.

**Files:**
- Create: `packages/bookings/` (package, `src/schema/bookings.ts`, `src/errors.ts`, `src/bookings.ts`, `src/routes.ts`, `src/migrations.ts`, `src/privileges.expected.ts`, `drizzle/*`, moved tests).
- Modify: `packages/module/src/module.ts` (`ModuleRoutes`, `ModuleRouteContext`, `CoreServices`; `routes?: ModuleRoutes` replacing `routes?: unknown`), `packages/composition/src/modules.ts` + `composition.test.ts`, `packages/migrations/migrations.manifest.json`, `packages/db/src/schema/{bookings.ts deleted, index.ts:36}` + `packages/db/drizzle/*`, `apps/server/src/boot.ts` (mount loop + route ctx; delete `mountBookingsApi` import), `apps/server/src/modules.ts` (assemble enabled routes), `apps/server/src/errors.ts` (remove the four `booking.*`), every test that set up bookings on `CORE_MIGRATIONS`.
- Delete: `apps/server/src/bookings.ts`, `booking-api.ts`.

**Interfaces:**
- Produces: `@waitron/bookings` barrel exports the schema (`bookings`, `bookingStatus`), `BOOKINGS_ROUTES: ModuleRoutes`, `BOOKINGS_MIGRATIONS` (the migration set for test setup). Seat types: `interface ModuleRoutes { mount(app: Hono, ctx: ModuleRouteContext, log: Logger): void }`; `interface ModuleRouteContext { db: Database; cfg: { tenantId: TenantId; locationId: LocationId }; core: CoreServices }` `[review m2: cfg is TWO fields — the module reads only tenantId/locationId (BookingConfig, bookings.ts:18); nodeId/tillId are consumed only inside core's openTab, which boot binds.]`; `interface CoreServices { openTab(tx: Transaction, req: { tableId: string; lines?: { productId: string; quantity: string }[] }): Promise<{ tabId: string; orderNumber: number }> }`.
- Consumes: `@waitron/server-kit` (Task 1); `authorizeManager`, `requireManagementSession` (from server-kit); core FK targets `tenants`/`locations`/`diningTables`/`workingOrders` (from `@waitron/db`); `core.openTab` (boot binds `till`).

- [ ] **Step 1: Scaffold `@waitron/bookings`.** Copy fiscal-none's config files; rename; deps `{ "@waitron/db": "workspace:*", "@waitron/shared": "workspace:*", "@waitron/server-kit": "workspace:*", "@waitron/identity": "workspace:*", "drizzle-orm": "<pin>", "hono": "<pin>" }`. `drizzle.config.ts` → `schema: src/schema/bookings.ts`, `out: drizzle/`. `pnpm install`.
- [ ] **Step 2: Move the schema + re-point its importers.** `git mv packages/db/src/schema/bookings.ts packages/bookings/src/schema/bookings.ts` + `bookings.test.ts`. Re-point FK-target imports (`tenants`, `locations`, `diningTables`, `workingOrders`) to `@waitron/db`. Remove `export * from "./bookings.js"` at `packages/db/src/schema/index.ts:36`. Barrel re-exports the schema. `[review: the only production importer of the `bookings` symbol is the verb file (Step 5) — grep `from "@waitron/db"` … `bookings` to confirm no OTHER production importer before deleting the barrel line.]`
- [ ] **Step 3 (failing test): migration split, real PG.** `packages/bookings/src/migrations.test.ts` (`useRealPostgres`): apply `orderedMigrationSets([core, bookings])` in order; assert (a) `to_regclass('public.bookings')` non-null; (b) ALL FOUR FKs present in `pg_constraint` — `bookings_tenant_fk`, `bookings_location_fk`, `bookings_table_fk`, `bookings_tab_fk`. Second case: core ALONE → `to_regclass('public.bookings')` IS NULL. Run → FAIL.
- [ ] **Step 4: Regenerate BOTH migration sets — regenerate path only.** `[review M2: mandate regenerate; there is no hand-remove alternative.]`
  - `packages/bookings`: `pnpm --filter @waitron/bookings db:generate --name bookings_baseline` → `0000_bookings_baseline.sql` (emits the table + the two SINGLE-column FKs `bookings_tenant_fk`, `bookings_location_fk` + `party_size` check + `tenant_id` unique + the two indexes). Then `db:generate:custom --name bookings_baseline_sql` → hand-author `0001_bookings_baseline_sql.sql` with: (i) the grants `REVOKE ALL ON "bookings" FROM app_user; GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;` (verbatim from core `0001:564-566`); (ii) `[review M1: the two COMPOSITE FKs are hand-written — copy `bookings_table_fk` (:568-571, `(tenant_id, table_id) → dining_tables`) and `bookings_tab_fk` (:572-573, `(tenant_id, tab_id) → working_orders`) verbatim from core `0001`.]` NO capture trigger yet (Task 3).
  - `packages/db`: delete the schema (done Step 2), reset `packages/db/drizzle` to main's state then regenerate so core's baselines no longer emit `bookings` (the `CREATE TABLE`, `bookings_tenant_fk`+`bookings_location_fk` at `0000:771-772`, the two indexes at `0000:802-803`, the grants + composite FKs at `0001:564-573`). Grep both core baselines for `bookings` → expect zero.
- [ ] **Step 5: Move the verbs.** `git mv apps/server/src/bookings.ts packages/bookings/src/bookings.ts` + `bookings.test.ts` + `bookings-cas.test.ts`. Re-point: `bookings`/`diningTables`/`Transaction` from the module's own schema / `@waitron/db`; `AppError`/ids from `@waitron/shared`; `import "./errors.js"` (Step 7); the `TillConfig` import → the narrowed `{ tenantId, locationId }` (the existing `BookingConfig`, was `bookings.ts:18`); `openTab` → a `core: CoreServices` param threaded into `seatBooking` (the one verb that opens a tab). The moved tests' `usePgliteDb({ migrations: [...] })` → `[CORE_MIGRATIONS, BOOKINGS_MIGRATIONS]`.
- [ ] **Step 6: Add the seat types + move the routes (all seven).** In `module.ts` define `ModuleRoutes`/`ModuleRouteContext`/`CoreServices`; replace `routes?: unknown` with `routes?: ModuleRoutes`. `git mv apps/server/src/booking-api.ts packages/bookings/src/routes.ts` + test → `routes.test.ts`. Rewrite `mountBookingsApi` as `export const BOOKINGS_ROUTES: ModuleRoutes = { mount(app, ctx, log) { … } }` reading `ctx.db`/`ctx.cfg`/`ctx.core.openTab`; helper imports from `@waitron/server-kit`; `authorizeManager` from `@waitron/identity`. `[review M5: SEVEN routes — GET/POST /management-api/bookings, PATCH …/:id, POST …/:id/seat, and the three lifecycle POSTs …/:id/{cancel,no-show,complete} built by `mountBookingLifecycleVerb`. Keep all seven paths byte-identical.]`
- [ ] **Step 7: Move the four codes.** `packages/bookings/src/errors.ts` declaration-merges `booking.not_found {bookingId}`, `booking.invalid {partySize}`, `booking.invalid_transition {bookingId}`, `booking.table_required {}` (payloads verbatim from `apps/server/src/errors.ts:549/559/572/582`). Remove them from apps/server. Barrel `import "./errors.js"`.
- [ ] **Step 8: Export `BOOKINGS_MIGRATIONS` + the generic mount loop.** In `packages/bookings/src/migrations.ts`, export the set the way `packages/db` exports `CORE_MIGRATIONS` (read that pattern). In `apps/server/src/boot.ts`, build `routeCtx: ModuleRouteContext` (`db`, `cfg: { tenantId, locationId }` off `till`, `core: { openTab: (tx, req) => openTab(tx, till, req) }` — cfg bound HERE) and replace `mountBookingsApi(app, { db, cfg: till }, log)` (`:1313`) at the same mount-order point with `for (const m of enabledModules) m.routes?.mount(app, routeCtx, log)`. `enabledModules` from `apps/server/src/modules.ts` (assemble like `ALL_SYNC_ENROLMENTS`, over the enabled set boot computes at `:552`). Delete the `mountBookingsApi` import.
- [ ] **Step 9: The descriptor + manifest + coverage + FIX EVERY STRANDED TEST.** `[review C1/m4.]` Add to `ALL_MODULES` at its FINAL post-`sync` array position (so Task 3's sync edge needs no reorder): `{ name: "bookings", version: "0.0.0", tier: "toggleable", requires: { core: "*" }, migrations: {...}, routes: BOOKINGS_ROUTES }`. Add the manifest entry at the matching position; update `composition.test.ts`'s byte pin. Add `bookings` to `scripts/coverage-thresholds.test.ts` at the SIX-package bar. Grep the whole repo for tests that set up bookings on `CORE_MIGRATIONS` (`apps/server/src/tables.test.ts:52`, `working-order` read tests, any `listTablesWithState`/`insert into bookings` suite) and add `BOOKINGS_MIGRATIONS` to their migration arrays.
- [ ] **Step 10: Run the split + grant + moved suites.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bookings test` (the migration-split test PASSES; the moved verb/routes/cas suites pass, assertions intact). Write `packages/bookings/src/privileges.test.ts` (real PG): `app_user` holds EXACTLY `SELECT, INSERT, UPDATE` on `bookings`, NOT `DELETE`/`TRUNCATE` — `has_table_privilege` for each AND read `relacl` back. Move the booking rows into `privileges.expected.ts`.
- [ ] **Step 11 (failing test): deletion proof — routes.** A test building the module list with the `bookings` descriptor's `routes` omitted asserts ALL SEVEN booking routes 404. Run → PASS.
- [ ] **Step 12: The fiscal + wire + workspace receipts.** Run `packages/fiscal-verifactu`'s `inmutabilidad` suite (§5 receipt — green). Run `apps/dashboard`'s `client.test.ts` booking cases UNCHANGED (the URLs/bodies held). Run `scripts/module-graph-honesty.test.ts` (requires.core matches the four FKs), `scripts/module-seams.test.ts`, `scripts/errors-reachable.test.ts`, then the WHOLE workspace.
- [ ] **Step 13: Commit.** `git commit -s -m "bookings: extract schema, migrations, verbs and routes into @waitron/bookings (SP1 t2)"`.

---

## Task 3: sync enrolment (the capture trigger + the `sync` seat)

Enrol the bookings table into sync as `state` class — bookings becomes the first genuinely-toggleable enrolling module. The capture trigger (SQL) and the `requires.modules.sync` edge land together (module-graph-honesty pins them).

**Files:** create `packages/bookings/src/enrolment.ts` + test; modify `packages/bookings/drizzle/0001_bookings_baseline_sql.sql` (add the trigger) + `drizzle/meta/*`; modify `packages/composition/src/modules.ts` (`sync: BOOKINGS_ENROLMENT`, `requires.modules.sync`) + `composition.test.ts`.

**Interfaces:** produces `BOOKINGS_ENROLMENT: readonly EnrolledTable[]` (one entry, `bookings`). Consumes `enrol` from `@waitron/sync-enrolment`; `sync_capture()` (the `requires.sync` edge).

- [ ] **Step 1 (failing test): enrolment shape.** `enrolment.test.ts`: one entry, `table: "bookings"`, `mode: "watermark-upsert"`, `conflictKey: ["id"]`, `configClass: false`, `captureOps: ["insert","update"]` `[review M3: INSERT/UPDATE only — the verbs never DELETE; app_user has no DELETE.]`, `columns` equals the table's columns. Run → FAIL.
- [ ] **Step 2: Write `BOOKINGS_ENROLMENT`.** `enrolment.ts` (the `FISCAL_ENROLMENT` idiom): `enrol(bookings, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: <the row's updated/created watermark col>, captureOps: ["insert","update"], fkRank: <see below>, lane: <the runtime lane dining_tables uses> })`. Read `dining_tables`' enrolment (`packages/db/src/enrolment.ts:159`) for `watermarkColumn`/`lane`. `[review m1: fkRank — dining_tables is rank 1, but bookings FKs into working_orders (rank 2), so bookings is ≥3; set it by its FK depth, don't blind-copy. (Unread by the apply path today, but keep the invariant honest.)]` NOT `configClass: true`. Run → PASS. Barrel export.
- [ ] **Step 3: Add the capture trigger.** Append to `0001_bookings_baseline_sql.sql`: `CREATE TRIGGER bookings_capture AFTER INSERT OR UPDATE ON bookings FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on') EXECUTE FUNCTION sync_capture();` `[review C2: the `WHEN (…)` echo-guard is mandatory — every capture trigger in the repo carries it (fiscal `0001:58`, sync state tables `sync/drizzle/0000_sync_baseline.sql:109/147`); without it an applied row re-enqueues itself. review M3: INSERT/UPDATE only.]` Regenerate `meta` if needed. Re-run the migration-split test — still green.
- [ ] **Step 4: Add the edge + enrolment to the descriptor.** `requires: { core: "*", modules: { sync: "*" } }`, `sync: BOOKINGS_ENROLMENT`. Descriptor stays in its Task-2 position (already after `sync`). Update `composition.test.ts`.
- [ ] **Step 5 (failing test): round-trip + module-by-table.** A `bookings` row inserted on the primary applies on the mirror (exercises the trigger + enrolment); `MODULE_BY_TABLE.get("bookings") === "bookings"`. Run → confirm.
- [ ] **Step 6: Guards + workspace + commit.** `scripts/module-graph-honesty.test.ts` (the sync edge matches the trigger SQL), `packages/composition`, the sync round-trip, `pnpm --filter @waitron/bookings test:coverage`, whole workspace. `git commit -s -m "bookings: sync enrolment as state class + echo-guarded capture trigger (SP1 t3)"`.

---

## Task 4: the `permissions` seat

Carry `booking.manage` out of identity's central catalog into the module's `permissions` seat; identity folds module permissions into the role ladder at boot.

**Files:** modify `packages/module/src/module.ts` (`ModulePermission`; retype `permissions`), create `packages/bookings/src/permissions.ts` + test, modify `packages/identity/src/{permissions.ts, manager-login.ts, index.ts}`, `apps/server/src/boot.ts` + `modules.ts`, `packages/composition/src/modules.ts`.

**Interfaces:** produces `type ModulePermission = { permission: string; grantedFrom: PersonRoleValue }`; `BOOKINGS_PERMISSIONS = [{ permission: "booking.manage", grantedFrom: "manager" }]`; `registerModulePermissions(perms): void`.

- [ ] **Step 1: Retype the seat.** `[review m3: `permissions?: readonly string[]` already EXISTS on WaitronModule (module.ts:57), unused — RETYPE it to `readonly ModulePermission[]`, don't "add".]` Define `ModulePermission`.
- [ ] **Step 2 (failing test): the grant fold.** In identity: after `registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }])`, `roleHasPermission("manager"|"admin", "booking.manage")` true; `"supervisor"|"staff"` false. Run → FAIL (remove `booking.manage` from the static catalog first so the test drives the registration path).
- [ ] **Step 3: Implement `registerModulePermissions`.** A registry `roleHasPermission` consults in addition to the static map; fold each `{ permission, grantedFrom }` into the roles at `grantedFrom` and above (reuse the SUPERVISOR→MANAGER→admin ladder). Remove `"booking.manage"` from `PERMISSIONS` (`permissions.ts:76`) and the `MANAGER` set (`:120`) and its comment. Run → PASS.
- [ ] **Step 4: Widen `Permission` at the boundary.** In `manager-login.ts`, `authorizeManager`'s `permission` param → `Permission | (string & {})`; `Permission` stays the closed core union elsewhere. Verify existing call sites still infer literals.
- [ ] **Step 5: Write `BOOKINGS_PERMISSIONS` + wire + call at boot.** `permissions.ts`; barrel; `permissions: BOOKINGS_PERMISSIONS` in the descriptor; assemble `ALL_MODULES.flatMap(m => m.permissions ?? [])` in `modules.ts` and call `registerModulePermissions(...)` once at startup before any route auth. (Assemble over `ALL_MODULES`: a disabled module mounts no route so its permission is unreachable anyway — state this in a comment.)
- [ ] **Step 6 (failing test): deletion proof.** With `permissions` omitted from the descriptor, `authorizeManager` for a manager on `booking.manage` throws `authorization.not_permitted`. Run → PASS.
- [ ] **Step 7: Workspace + commit.** `pnpm --filter @waitron/identity test:coverage`, `@waitron/bookings`, whole workspace (identity's `Permission` type is asserted widely). `git commit -s -m "bookings: permissions seat — booking.manage leaves identity's catalog (SP1 t4)"`.

---

## Task 5: the `floorAnnotations` seat

Move the "Reserved HH:MM" concern — timezone read, grace computation, query — out of `working-order.ts` into the module; `listTablesWithState` calls every enabled module's annotator and merges.

**Files:** modify `packages/module/src/module.ts` (`FloorAnnotator`; `floorAnnotations?`), create `packages/bookings/src/floor.ts` + test, modify `apps/server/src/working-order.ts` (drop the `res` lateral join + `tzRow` read + grace utils; call annotators), `apps/server/src/modules.ts`, `packages/composition/src/modules.ts`.

**Interfaces:** produces `interface FloorAnnotator { annotate(tx: Transaction, cfg: { tenantId: TenantId; locationId: LocationId }, now: Date, tableIds: string[]): Promise<Map<string, { reservedTime: string | null }>> }`; `BOOKINGS_FLOOR_ANNOTATIONS: FloorAnnotator`.

- [ ] **Step 1: Confirm the timezone-util homes.** `grep -n "venueWallClock\|safeTimeZone\|reservationGraceFloor\|RESERVATION_GRACE_MINUTES\|DEFAULT_TIME_ZONE" apps/server/src`. `[review m5: the first four are confirmed bookings-only (all refs within working-order.ts:3906-4098) → into floor.ts. DEFAULT_TIME_ZONE may be shared — if it has another consumer, leave it in a shared util and import it; if bookings-only, move it.]`
- [ ] **Step 2: Add the seat type.** `FloorAnnotator` in `module.ts`; `floorAnnotations?: FloorAnnotator`.
- [ ] **Step 3 (failing test): the annotator — pure scenarios in the module.** `[review M6: only the annotator scenarios live in the module; the listTablesWithState MERGE + deletion proof stay in apps/server (Step 6/7) since the module can't import apps/server.]` `packages/bookings/src/floor.test.ts`: seed a `booked` row today at/after the grace floor, one before it, one tomorrow, one non-`booked`; `annotate(tx, { tenantId, locationId }, now, [tableId])` returns the imminent `HH:MM`, `null` when none. Reuse the timezone/grace/status scenarios from `tables.test.ts:688-810`. Run → FAIL.
- [ ] **Step 4: Implement `BOOKINGS_FLOOR_ANNOTATIONS`.** `floor.ts`: read `locations.time_zone` by `cfg.locationId`; `safeTimeZone` + `venueWallClock(now, tz)` → `venueToday`/`venueNow`; `reservationGraceFloor(venueNow)`; query the earliest imminent `booked` time per `tableId`; build the `Map`. Run → PASS. Barrel + `floorAnnotations: BOOKINGS_FLOOR_ANNOTATIONS` in the descriptor.
- [ ] **Step 5: Gut `listTablesWithState`.** Remove the `res` lateral join (`working-order.ts:4103-4112`), the `tzRow` read + timezone/grace computation (`:3987-3996`). After the main query: `for (const a of enabledAnnotators) { const m = await a.annotate(tx, { tenantId, locationId: loc }, now, tableIds); merge m's reservedTime onto rows }`. `reservedTime` stays the optional row field. `enabledAnnotators` from `apps/server/src/modules.ts`.
- [ ] **Step 6: Move the reserved-on-floor tests — split per M6.** The pure-annotator scenarios → the module (Step 3). The `listTablesWithState` MERGE assertions (that a booked table surfaces `reservedTime` through the seat) → a suite in `apps/server` (it may import `BOOKINGS_MIGRATIONS` for setup). Assertions intact.
- [ ] **Step 7 (failing test): deletion proof — annotator (in apps/server).** With `floorAnnotations` omitted from the descriptor, `listTablesWithState` returns `reservedTime: null` for a table WITH a `booked` row. Run → PASS.
- [ ] **Step 8: Workspace + commit.** `pnpm --filter @waitron/bookings test:coverage`, `apps/server` unfiltered (the floor read changed; the till floor screen consumes `reservedTime`), whole workspace. `git commit -s -m "bookings: floorAnnotations seat — the reserved-badge query leaves core (SP1 t5)"`.

---

## Task 6: the `openTab` by-id tenant-scope fix (ride-along)

`[review: confirmed real — working-order.ts:806 is `.where(eq(diningTables.id, req.tableId))` with no tenant predicate; the till-reroute S3 shape (CLAUDE.md §3). Kept a separate task so the fix has its own reviewer gate and its own two-tenant proof.]`

**Files:** modify `apps/server/src/working-order.ts` (`openTab`); a real-PG two-tenant test.

- [ ] **Step 1 (failing test): the two-tenant probe.** Real PG, as `app_user` (rolsuper=f): tenant A and tenant B each own a `dining_tables` row; `openTab(txB, cfgB, { tableId: <A's table id> })` must NOT open a tab on A's table (expect a not-found / no cross-tenant write). Run → if it REPRODUCES (B reaches A's row), continue; if it does NOT (a predicate scopes it elsewhere), record the finding, drop the fix, and delete this task — do NOT assert a bug that isn't there (CLAUDE.md §1).
- [ ] **Step 2: Fix.** `where(and(eq(diningTables.id, req.tableId), eq(diningTables.tenantId, cfg.tenantId)))`. Run → PASS.
- [ ] **Step 3: Workspace + commit.** `apps/server` unfiltered, whole workspace. `git commit -s -m "fix(working-order): scope openTab's by-id table read to the tenant (SP1 t6)"`.

---

## Self-review

**Spec coverage:** §3 package/schema/migrations → Task 2; §3.4 sync → Task 3; §4.1 routes → Task 2; §4.2 permissions → Task 4; §4.3 floorAnnotations → Task 5; §5 helper lift → Task 1; §6 error codes → Tasks 1/2 (each code with its thrower); §7 guards → module-seams/graph-honesty/errors-reachable (T2), english-only (bookings English, no vocabulary seat — whole-workspace gate), coverage-thresholds (T1/T2), inmutabilidad (T2), disabled-set deletion proofs (T2/T4/T5); §8 testing → the container/deletion/wire-pin/two-tenant tasks; §9 no new core migration (T2 removes). No gaps.

**Placeholder scan:** the only conditionals are grep-gated and state both branches (T5 S1 timezone-util home; T6 openTab fix only if the probe reproduces). No TODOs.

**Type consistency:** `ModuleRouteContext.cfg = { tenantId, locationId }` (two fields) in T2 interfaces + boot binding; `CoreServices.openTab(tx, req)` identical T2; `FloorAnnotator.annotate` identical T5 S2/S3/S4/S5; `ModulePermission = { permission, grantedFrom }` identical T4; value names `BOOKINGS_ROUTES/MIGRATIONS/ENROLMENT/PERMISSIONS/FLOOR_ANNOTATIONS` consistent with the descriptor across T2/T3/T4/T5.

**Sequencing:** every task ends green — T2 is atomic (schema+migrations+verbs+routes+test-migration-lists together, no stranding); T3's sync edge needs no reorder (bookings placed post-`sync` in T2); T1 S2 lands `isUuid` before its importers move. Reviewer verdict incorporated: the plan is implementable as sequenced.
