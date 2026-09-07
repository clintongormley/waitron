# Bookings SP1 — server + data extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract bookings out of the core into a `@waitron/bookings` module — its own migration set, its verbs + routes behind typed module seats, its permission and floor-badge concerns off the core — behaviour-preserving, with the dashboard untouched.

**Architecture:** A new leaf module package holds the bookings schema (its tables leave the core migration set), the verbs, the Hono routes, the floor-badge query, and the sync enrolment. Three new typed seats on `WaitronModule` (`routes`, `permissions`, `floorAnnotations`) are assembled at the composition root and reached by one generic loop each in `boot.ts` / `listTablesWithState`, replacing hardcoded per-domain lines. Four request helpers lift to a new `@waitron/server-kit`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspaces, drizzle-orm + drizzle-kit, Hono, Vitest, PGlite + Testcontainers (real Postgres), `@waitron/shared` `AppError` registry.

**Spec:** `docs/superpowers/specs/2026-09-07-module-bookings-sp1-server-extraction-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- **CLAUDE.md §1 — claims discipline.** No comment or doc asserts more than the code delivers. Prove necessity/impossibility by RUNNING (a container, a deletion), never by reading. A correction is a new claim held to the same standard.
- **CLAUDE.md §5 — this branch touches NO fiscal invariant.** The migration split must leave `registros_facturacion` / `registro_sif` / `cadenas` / `envios` and every fiscal trigger byte-unchanged; `packages/fiscal-verifactu`'s `inmutabilidad` scan is the receipt (Task 2).
- **Behaviour-preserving extraction.** Moved tests keep their assertions intact; only setup/imports change. A test rewritten to match new code hides the regression it exists to catch (global CLAUDE.md).
- **No backwards-compat / no data migration (pre-production).** Schema changes drop and recreate; no backfill (CLAUDE.md §3).
- **Error codes are never renamed once shipped** — codes move packages verbatim, by declaration-merging on `@waitron/shared` (CLAUDE.md §3).
- **Never widen a grant to make a test pass.** `app_user` holds exactly `SELECT, INSERT, UPDATE` on `bookings` — read the ACL back, don't trust the GRANT's exit code (CLAUDE.md §3).
- **The module boundary:** seat TYPES live in `@waitron/module`; seat VALUES are exported by `@waitron/bookings` and named only by `@waitron/composition`. No file under `apps/server/src` imports `@waitron/bookings` (`scripts/module-seams.test.ts`).
- **Gate before every commit that crosses packages:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and for a package `pnpm --filter <pkg> test:coverage` (CI runs coverage, not `test` — CLAUDE.md §2). Run the WHOLE workspace once when a value more than one suite asserts changes (the schema barrel, the error registry, `ALL_MODULES`, the seat maps).
- **Coverage bars:** `@waitron/bookings` takes the six-package bar **98/98/98/95** (data-layer package with its own migration set); every other bar is the `90/90/85/85` floor. `scripts/coverage-thresholds.test.ts`'s hardcoded list gains `bookings`, reason in the commit (CLAUDE.md §2).
- **Real-PG vs PGlite:** privilege / grant / trigger-as-`app_user` / concurrency proofs need real Postgres (Testcontainers, `TESTCONTAINERS_RYUK_DISABLED=true` locally). Pure logic uses PGlite. `describeEachTarget` runs both where it matters (CLAUDE.md §4).

---

## File structure

**New package `packages/bookings/`** (scaffolded from `packages/fiscal-none/`):
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` — same shapes as fiscal-none.
- `src/index.ts` — the barrel: exports `BOOKINGS_ENROLMENT`, `BOOKINGS_PERMISSIONS`, `BOOKINGS_ROUTES`, `BOOKINGS_FLOOR_ANNOTATIONS`, the schema, and `import "./errors.js"`.
- `src/schema/bookings.ts` — the schema, moved verbatim from `packages/db/src/schema/bookings.ts`.
- `src/errors.ts` — the four `booking.*` codes, declaration-merged onto `@waitron/shared`.
- `src/bookings.ts` — the verbs (`createBooking`, `listBookings`, `updateBooking`, `seatBooking`, `cancelBooking`, `completeBooking`, `markNoShow`), moved from `apps/server/src/bookings.ts`.
- `src/routes.ts` — `BOOKINGS_ROUTES` (`ModuleRoutes`), from `apps/server/src/booking-api.ts`.
- `src/permissions.ts` — `BOOKINGS_PERMISSIONS`.
- `src/enrolment.ts` — `BOOKINGS_ENROLMENT`.
- `src/floor.ts` — `BOOKINGS_FLOOR_ANNOTATIONS` (`FloorAnnotator`) + the timezone read + grace computation + reserved-badge query.
- `src/privileges.expected.ts` + `src/privileges.test.ts` — the booking grant rows, moved.
- `drizzle/0000_bookings_baseline.sql`, `drizzle/0001_bookings_baseline_sql.sql`, `drizzle/meta/` — generated.
- `src/*.test.ts` — moved test suites.

**New package `packages/server-kit/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`.
- `src/index.ts` — barrel exporting the helpers + `Logger` type.
- `src/error-boundary.ts` (`createErrorBoundary`), `src/error-code.ts` (`codeOf`), `src/read-json-body.ts` (`readJsonBody`), `src/request-screens.ts` (the screens), moved from `apps/server/src/`.
- `src/errors.ts` — `management.request_invalid`, declaration-merged.
- moved `*.test.ts`.

**Modified:**
- `packages/module/src/module.ts` — add `ModuleRoutes`, `ModulePermission`, `FloorAnnotator` seat types; `routes`/`permissions`/`floorAnnotations` fields.
- `packages/composition/src/modules.ts` — the `bookings` descriptor.
- `packages/migrations/migrations.manifest.json` — the `bookings` manifest entry.
- `packages/db/src/schema/{bookings.ts (deleted), index.ts}` + `drizzle/0000_db_baseline.sql`, `drizzle/0001_db_baseline_sql.sql` — remove bookings.
- `packages/identity/src/{permissions.ts, manager-login.ts, index.ts}` + a new `src/management-session.ts` — module-permission registration, `Permission` widening, `requireManagementSession`.
- `packages/shared/src/ids.ts` (or a suitable home) — `isUuid`.
- `apps/server/src/{boot.ts, modules.ts}` — the generic mount loop, `registerModulePermissions`, the route context.
- `apps/server/src/working-order.ts` — drop the reserved sub-select + timezone read; call the annotators.
- `apps/server/src/{bookings.ts, booking-api.ts, request-screens.ts, error-boundary.ts, error-code.ts, read-json-body.ts, management-session.ts, till-session.ts, errors.ts}` — deleted or re-pointed.
- `apps/dashboard/src/api/client.test.ts` — UNCHANGED, the wire pin.

---

## Task 1: `@waitron/server-kit` + helper lift

Extract the four request helpers so the module's routes (Task 4) can import them without depending on `apps/server`. Widest-touching, lowest-risk (pure moves) — first, to de-risk the rest.

**Files:**
- Create: `packages/server-kit/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/error-boundary.ts`, `src/error-code.ts`, `src/read-json-body.ts`, `src/request-screens.ts`, `src/errors.ts`, and the moved `*.test.ts` for each.
- Move: `apps/server/src/error-boundary.ts` → `packages/server-kit/src/error-boundary.ts`; `apps/server/src/error-code.ts` → `.../error-code.ts`; `apps/server/src/read-json-body.ts` → `.../read-json-body.ts`; `apps/server/src/request-screens.ts` → `.../request-screens.ts`.
- Move: `apps/server/src/management-session.ts` → `packages/identity/src/management-session.ts`; `requireManagementSession`.
- Move: `isUuid` from `apps/server/src/till-session.ts:28` → `packages/shared/src/ids.ts` (pure predicate, used by both lifted files).
- Modify: `apps/server/src/errors.ts` — remove `management.request_invalid` (moves to server-kit) and `management_session.required` (moves to identity); `apps/server/src/till-session.ts` — re-import `isUuid` from `@waitron/shared`.
- Modify: every `apps/server/src/*-api.ts` that imports the four helpers — re-point imports to `@waitron/server-kit` / `@waitron/identity` / `@waitron/shared`.

**Interfaces:**
- Produces: `@waitron/server-kit` exports `createErrorBoundary(cfg) → (c: Context, fn) => Response`, `codeOf(err) → string`, `readJsonBody(c) → Promise<unknown>`, `requireString/requireUuidParam/requireBodyUuid/requireNullableBodyUuid/requireNullableString/requirePeriod` (signatures verbatim from the moved file), and `interface Logger` (the structural type the boundary needs). `@waitron/identity` exports `requireManagementSession(c, …)`. `@waitron/shared` exports `isUuid(value: string): boolean`.
- Consumes: nothing new.

- [ ] **Step 1: Scaffold `@waitron/server-kit`.** Copy `packages/fiscal-none/{package.json,tsconfig.json,vitest.config.ts}`; rename to `@waitron/server-kit`; set `dependencies` to `{ "@waitron/shared": "workspace:*", "hono": "<version apps/server pins>" }` (read the hono version from `apps/server/package.json`); drop the drizzle scripts/deps (server-kit ships no migrations). `pnpm install`.

- [ ] **Step 2: Move `codeOf` + `createErrorBoundary` with their tests.** `git mv apps/server/src/error-code.ts packages/server-kit/src/error-code.ts` and the same for `error-boundary.ts` and their `*.test.ts` if present. In `error-boundary.ts`, replace `import type { Logger } from "./logger.js"` with a local `export interface Logger { … }` matching the shape it uses (read `apps/server/src/logger.ts` for the exact method signatures the boundary calls — copy only those). Keep `import { isAppError } from "@waitron/shared"` and `import { codeOf } from "./error-code.js"`.

- [ ] **Step 3: Move `readJsonBody` and `request-screens` with their tests.** `git mv` both. In `request-screens.ts`, replace `import { isUuid } from "./till-session.js"` with `import { isUuid } from "@waitron/shared"` (Step 6 adds it there — do Step 6 first if executing strictly TDD), and replace `import "./errors.js"` with `import "./errors.js"` pointing at server-kit's new `errors.ts` (Step 5).

- [ ] **Step 4: Barrel + wire.** `packages/server-kit/src/index.ts` re-exports all four helpers + `Logger` + `import "./errors.js"`.

- [ ] **Step 5: Move the `management.request_invalid` code.** Create `packages/server-kit/src/errors.ts` declaration-merging `management.request_invalid: Record<string, never>` onto `@waitron/shared` (copy the exact payload shape from `apps/server/src/errors.ts`; the `fiscal-verifactu/src/errors.ts` idiom — `import "@waitron/shared"` then `declare module`). Remove that code from `apps/server/src/errors.ts`.

- [ ] **Step 6: Move `isUuid` → `@waitron/shared`.** Add `export function isUuid(value: string): boolean { … }` (verbatim from `till-session.ts:28`) to `packages/shared/src/ids.ts`; export from the shared barrel. In `apps/server/src/till-session.ts`, delete the local definition and re-export `export { isUuid } from "@waitron/shared"` (other `apps/server` importers keep working) OR re-point importers — grep `from "./till-session"` for `isUuid` users and re-point to `@waitron/shared`.

- [ ] **Step 7: Move `requireManagementSession` → `@waitron/identity`.** `git mv apps/server/src/management-session.ts packages/identity/src/management-session.ts` + its test. Re-point its imports: `isUuid` from `@waitron/shared`; its `management_session.required` code moves into `@waitron/identity`'s `errors.ts` (declaration-merge; remove from `apps/server/src/errors.ts`). Add `hono` to `@waitron/identity`'s deps (for `hono/cookie`). Export `requireManagementSession` from the identity barrel.

- [ ] **Step 8: Re-point `apps/server` importers.** Grep `apps/server/src` for imports of the four helpers + `requireManagementSession` + `isUuid`; re-point each to its new home. `booking-api.ts` will move in Task 4 — re-point it too so `apps/server` stays green now.

- [ ] **Step 9: Prove reachability + gate.** Run `scripts/errors-reachable.test.ts` (the moved codes must be reachable from their new barrels). Run `pnpm --filter @waitron/server-kit test:coverage`, `pnpm --filter @waitron/identity test:coverage`, `pnpm --filter @waitron/shared test:coverage`, then the WHOLE workspace (`apps/server` and every `*-api.ts` importer is affected). Expected: green.

- [ ] **Step 10: Add `server-kit` to the coverage-threshold list at the floor bar.** `scripts/coverage-thresholds.test.ts` — `server-kit` is a plain package (90/90/85/85). Commit reason in the message. Run `scripts/coverage-thresholds.test.ts`.

- [ ] **Step 11: Commit.** `git add -A && git commit -s -m "server-kit: lift request helpers out of apps/server (bookings SP1 t1)"`.

---

## Task 2: `@waitron/bookings` package + schema + migration split

Move the schema out of core into the module's own migration set. The tables leave core; the module gains them, their four FKs, the `app_user` grants. NO capture trigger yet (Task 3). Descriptor carries migrations + `requires.core` only.

**Files:**
- Create: `packages/bookings/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/index.ts`, `src/schema/bookings.ts`, `src/privileges.expected.ts`, `src/privileges.test.ts`, `src/migrations.test.ts`, `drizzle/0000_bookings_baseline.sql`, `drizzle/0001_bookings_baseline_sql.sql`, `drizzle/meta/*`.
- Delete: `packages/db/src/schema/bookings.ts`; remove `export * from "./bookings.js"` at `packages/db/src/schema/index.ts:36`.
- Modify: `packages/db/drizzle/0000_db_baseline.sql` (remove `CREATE TABLE "bookings"` `:671-687`, `bookings_tenant_fk` `:771`), `packages/db/drizzle/0001_db_baseline_sql.sql` (remove the `REVOKE/GRANT … "bookings"` `:564-566`, `bookings_table_fk`/`bookings_tab_fk` `:568-573`), and `packages/db/drizzle/meta/*`.
- Modify: `packages/migrations/migrations.manifest.json` (add the `bookings` entry), `packages/composition/src/modules.ts` (the descriptor), `packages/composition/src/composition.test.ts` (byte pin gains bookings).
- Move: booking rows from `packages/fiscal-verifactu/src/privileges.expected.ts`? No — the booking grant rows live wherever the core privilege suite asserts them today; grep `bookings` in `packages/db/src/**/privileges*` and move those rows to `packages/bookings/src/privileges.expected.ts`.

**Interfaces:**
- Produces: `@waitron/bookings` exports the schema (`bookings`, `bookingStatus`) from its barrel; the descriptor's `migrations` = `{ name: "bookings", table: "__drizzle_migrations_bookings", from: "../bookings/drizzle" }`, `requires: { core: "*" }`, `tier: "toggleable"`.
- Consumes: core tables `tenants`, `locations`, `dining_tables`, `working_orders` (FK targets — cross-set edges, all pointing INTO core).

- [ ] **Step 1: Scaffold `@waitron/bookings`.** Copy `packages/fiscal-none/{package.json,tsconfig.json,vitest.config.ts,drizzle.config.ts}`; rename to `@waitron/bookings`; deps `{ "@waitron/db": "workspace:*", "@waitron/shared": "workspace:*", "@waitron/sync-enrolment": "workspace:*", "drizzle-orm": "<pin>" }` (sync-enrolment lands in Task 3 but declaring it now is harmless). Point `drizzle.config.ts` `schema` at `src/schema/bookings.ts`, `out` at `drizzle/`. `pnpm install`.

- [ ] **Step 2: Move the schema.** `git mv packages/db/src/schema/bookings.ts packages/bookings/src/schema/bookings.ts` and its test (`packages/db/src/schema/bookings.test.ts` → `packages/bookings/src/schema/bookings.test.ts`). Re-point its imports of core FK targets (`tenants`, `locations`, `diningTables`, `workingOrders`) to `@waitron/db`. Remove `export * from "./bookings.js"` from `packages/db/src/schema/index.ts`. Barrel `packages/bookings/src/index.ts` re-exports the schema.

- [ ] **Step 3 (failing test first): migration split, real PG.** Write `packages/bookings/src/migrations.test.ts` using `describeEachTarget` (or `useRealPostgres`): apply `orderedMigrationSets([core, bookings])` in order (import from `@waitron/module` + the real descriptors), assert (a) `to_regclass('public.bookings')` is non-null, (b) all four FKs exist (`bookings_tenant_fk`, `bookings_location_fk`, `bookings_table_fk`, `bookings_tab_fk` — query `pg_constraint`). Then a second real-PG case: apply core ALONE, assert `to_regclass('public.bookings')` IS NULL.

- [ ] **Step 4: Run it — expect FAIL** (bookings still in core's baseline; module has no migrations yet). Confirms the test discriminates.

- [ ] **Step 5: Regenerate the migrations.** Follow CLAUDE.md §3's recipe. (a) In `packages/bookings`: `pnpm --filter @waitron/bookings db:generate --name bookings_baseline` (emits `0000` from the schema), then hand-author `0001_bookings_baseline_sql.sql` (custom, snapshot-less) with the `REVOKE ALL ON "bookings" FROM app_user; GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;` copied verbatim from core's old `:564-566`. (b) In `packages/db`: remove the bookings `CREATE TABLE` + all four FK statements + the grants from both baselines by regeneration — reset `packages/db/drizzle` to the state without bookings by re-running `db:generate` after the schema deletion, or hand-remove the exact statements and regenerate `meta`. Verify core's baselines no longer mention `bookings` (grep).

- [ ] **Step 6: Run the split test — expect PASS.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bookings test`. Both cases green.

- [ ] **Step 7 (failing test): the grant ACL, read back.** In `packages/bookings/src/privileges.test.ts` (real PG, as the deployment/app roles), assert `app_user` holds EXACTLY `SELECT, INSERT, UPDATE` on `bookings` and NOT `DELETE`/`TRUNCATE` — read `has_table_privilege('app_user','bookings','SELECT'|'INSERT'|'UPDATE'|'DELETE')` AND the `relacl` (per CLAUDE.md §3: a failed GRANT still materialises acl; membership can create false positives). Move the booking rows into `privileges.expected.ts`. Run → expect PASS (grants are in the module migration now).

- [ ] **Step 8: The descriptor (migrations + requires.core).** Add to `ALL_MODULES` after the modules it will depend on (final position set in Task 3 when `requires.sync` is added): `{ name: "bookings", version: "0.0.0", tier: "toggleable", requires: { core: "*" }, migrations: { name: "bookings", table: "__drizzle_migrations_bookings", from: "../bookings/drizzle" } }`. Add the manifest entry. Update `composition.test.ts`'s byte pin.

- [ ] **Step 9: Coverage list + guards.** Add `bookings` to `scripts/coverage-thresholds.test.ts` at the SIX-package bar (98/98/98/95), reason in commit. Run `scripts/module-graph-honesty.test.ts` (requires.core matches the four FK edges), `scripts/coverage-thresholds.test.ts`, `packages/composition` tests.

- [ ] **Step 10: The fiscal-invariant receipt.** Run `packages/fiscal-verifactu`'s `inmutabilidad` suite — it scans the trigger set and asserts the fiscal tables are unchanged. Expected: green (bookings touched nothing fiscal). This is the §5 receipt.

- [ ] **Step 11: Whole workspace + commit.** `pnpm --filter @waitron/bookings test:coverage`, `pnpm --filter @waitron/db test:coverage`, then the whole workspace (schema barrel + `ALL_MODULES` changed). `git add -A && git commit -s -m "bookings: extract schema into its own migration set (SP1 t2)"`.

---

## Task 3: sync enrolment (the capture trigger + the `sync` seat)

Enrol the bookings tables into sync as `state` class — making bookings the first genuinely-toggleable enrolling module. Adds the capture trigger (SQL) and the `requires.modules.sync` edge together (module-graph-honesty pins them).

**Files:**
- Create: `packages/bookings/src/enrolment.ts`, `packages/bookings/src/enrolment.test.ts`.
- Modify: `packages/bookings/drizzle/0001_bookings_baseline_sql.sql` (add the capture trigger), `drizzle/meta/*`.
- Modify: `packages/composition/src/modules.ts` (add `sync: BOOKINGS_ENROLMENT`, `requires.modules.sync`), `composition.test.ts`.
- Modify (verify only): `apps/server/src/modules.ts` — `ALL_SYNC_ENROLMENTS` / `MODULE_BY_TABLE` pick it up with no code change.

**Interfaces:**
- Produces: `BOOKINGS_ENROLMENT: readonly EnrolledTable[]` (one entry, the `bookings` table).
- Consumes: `enrol` from `@waitron/sync-enrolment`; `sync_capture()` (defined by the `sync` module) — the `requires.sync` edge.

- [ ] **Step 1 (failing test): the enrolment shape.** `packages/bookings/src/enrolment.test.ts`: `BOOKINGS_ENROLMENT` has one entry, `table: "bookings"`, `mode: "watermark-upsert"`, `conflictKey: ["id"]`, `configClass: false`, and `columns` equals the table's column names. Run → FAIL (no `enrolment.ts`).

- [ ] **Step 2: Write `BOOKINGS_ENROLMENT`.** `packages/bookings/src/enrolment.ts`, the `FISCAL_ENROLMENT` idiom: `import { type EnrolledTable, enrol } from "@waitron/sync-enrolment"; import { bookings } from "./schema/bookings.js"; export const BOOKINGS_ENROLMENT: readonly EnrolledTable[] = [ enrol(bookings, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: <the column>, captureOps: [...], fkRank: <n>, lane: <the runtime lane> }) ];` — copy the exact `watermarkColumn`/`captureOps`/`fkRank`/`lane` conventions a `state` runtime table uses from `dining_tables`' enrolment (`packages/db/src/enrolment.ts:159`). Do NOT pass `configClass: true`. Run → PASS. Export from the barrel.

- [ ] **Step 3: Add the capture trigger to the custom migration.** Append to `0001_bookings_baseline_sql.sql` the `CREATE TRIGGER bookings_capture AFTER INSERT OR UPDATE OR DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION sync_capture();` — the `registros_facturacion_capture` shape (`packages/fiscal-verifactu/drizzle/0001_fiscal_baseline_sql.sql:58`). Regenerate `meta` if needed.

- [ ] **Step 4: Add the sync edge + enrolment to the descriptor.** In `modules.ts`, set the bookings descriptor's `requires: { core: "*", modules: { sync: "*" } }` and `sync: BOOKINGS_ENROLMENT`; move the descriptor to its correct topological position (after `sync`). Update `composition.test.ts`.

- [ ] **Step 5 (failing test): the round-trip + module-by-table.** Extend the sync enrolment round-trip suite (or add a bookings case): a `bookings` row inserted on the primary applies on the mirror; `MODULE_BY_TABLE.get("bookings") === "bookings"`. Run → confirm it exercises the new trigger + enrolment.

- [ ] **Step 6: Run graph honesty + composition + sync.** `scripts/module-graph-honesty.test.ts` (the `requires.sync` edge now matches the capture trigger SQL), `packages/composition` tests, the sync round-trip. Expected: green.

- [ ] **Step 7: Record the unblock.** In the spec's/backlog's follow-on note, confirm bookings is now the first genuinely-toggleable enrolling module and the enabled-set-aware pull (`boot.ts:556`) stays deferred (not built here). (Backlog already carries this from the spec commit — verify, don't duplicate.)

- [ ] **Step 8: Whole workspace + commit.** `pnpm --filter @waitron/bookings test:coverage`, the sync package, then whole workspace. `git commit -s -m "bookings: sync enrolment as state class + capture trigger (SP1 t3)"`.

---

## Task 4: the `routes` seat

Move the verbs + routes into the module behind a typed `routes` seat; `boot.ts` mounts every enabled module's routes generically. Move the four `booking.*` codes.

**Files:**
- Modify: `packages/module/src/module.ts` — add `ModuleRoutes`, `ModuleRouteContext`, `CoreServices` types; `routes?: ModuleRoutes`.
- Create: `packages/bookings/src/routes.ts` (from `apps/server/src/booking-api.ts`), `packages/bookings/src/bookings.ts` (from `apps/server/src/bookings.ts`), `packages/bookings/src/errors.ts` (the four codes), and their moved tests (`bookings.test.ts`, `booking-api.test.ts` → `routes.test.ts`, `bookings-cas.test.ts`).
- Delete: `apps/server/src/bookings.ts`, `apps/server/src/booking-api.ts`, and the booking codes from `apps/server/src/errors.ts` (`:549/559/572/582`).
- Modify: `apps/server/src/boot.ts` (replace `mountBookingsApi(app, { db, cfg: till }, log)` `:1313` with the generic loop + build the route context), `apps/server/src/modules.ts` (assemble the enabled modules' routes), `packages/composition/src/modules.ts` (`routes: BOOKINGS_ROUTES`).

**Interfaces:**
- Produces: `interface ModuleRoutes { mount(app: Hono, ctx: ModuleRouteContext, log: Logger): void }`; `interface ModuleRouteContext { db: Database; cfg: { tenantId: TenantId; locationId: LocationId; nodeId: NodeId; tillId: TillId }; core: CoreServices }`; `interface CoreServices { openTab(tx: Transaction, req: { tableId: string; lines?: { productId: string; quantity: string }[] }): Promise<{ tabId: string; orderNumber: number }> }`. `BOOKINGS_ROUTES: ModuleRoutes`.
- Consumes: `@waitron/server-kit` helpers (Task 1); `authorizeManager`, `requireManagementSession` from `@waitron/identity`; the schema + verbs; `core.openTab` (boot binds `cfg`).

- [ ] **Step 1: Add the seat types.** In `packages/module/src/module.ts`, define `ModuleRoutes`/`ModuleRouteContext`/`CoreServices` (import `Hono`, `Database`, `Transaction`, the branded ids, and a `Logger` type — reuse `@waitron/server-kit`'s `Logger` or declare a minimal one; pick one and use it consistently). Replace `readonly routes?: unknown; // incremental` with `readonly routes?: ModuleRoutes`. `pnpm --filter @waitron/module typecheck`.

- [ ] **Step 2: Move the verbs.** `git mv apps/server/src/bookings.ts packages/bookings/src/bookings.ts` + `bookings.test.ts`, `bookings-cas.test.ts`. Re-point imports: `bookings`, `diningTables`, `Transaction` from `@waitron/db`; `AppError`, `LocationId`, `TenantId` from `@waitron/shared`; `import "./errors.js"` (Step 4); the `TillConfig` import becomes the narrowed `ModuleRouteContext["cfg"]` type (the verbs read only `tenantId`/`locationId`); `openTab` becomes `core.openTab` passed in (the verbs take `core` or the route passes the tab result — thread it through the verb signature that needs it, `seatBooking`).

- [ ] **Step 3: Move the routes.** `git mv apps/server/src/booking-api.ts packages/bookings/src/routes.ts` + its test → `routes.test.ts`. Rewrite `mountBookingsApi(app, deps, log)` as `export const BOOKINGS_ROUTES: ModuleRoutes = { mount(app, ctx, log) { … } }`, reading `ctx.db`, `ctx.cfg`, `ctx.core.openTab`. Re-point helper imports to `@waitron/server-kit` / `@waitron/identity`. Keep the four route paths byte-identical (`/management-api/bookings`, `…/:id`, `…/:id/seat`).

- [ ] **Step 4: Move the four codes.** `packages/bookings/src/errors.ts` declaration-merges `booking.not_found {bookingId}`, `booking.invalid {partySize}`, `booking.invalid_transition {bookingId}`, `booking.table_required {}` (payloads verbatim from `apps/server/src/errors.ts:549/559/572/582`). Remove them from `apps/server/src/errors.ts`. Barrel `import "./errors.js"`.

- [ ] **Step 5: The generic mount loop in boot.** In `apps/server/src/boot.ts`, build `routeCtx: ModuleRouteContext` (`db`, `cfg` = the four fields off `till`, `core: { openTab: (tx, req) => openTab(tx, till, req) }` — cfg bound here) and replace `mountBookingsApi(...)` `:1313` with, at the same point in the mount order: `for (const m of enabledModules) m.routes?.mount(app, routeCtx, log)`. Source `enabledModules` from `apps/server/src/modules.ts` (assemble it like `ALL_SYNC_ENROLMENTS`, but over the ENABLED set boot already computes at `:552`). Delete the `mountBookingsApi` import.

- [ ] **Step 6: Wire the descriptor.** `routes: BOOKINGS_ROUTES` in `modules.ts`.

- [ ] **Step 7: Run the moved suites + the wire pin.** `pnpm --filter @waitron/bookings test:coverage` (the moved `bookings`/`routes`/`cas` suites, assertions intact). Then `apps/dashboard`'s `client.test.ts` booking cases UNCHANGED — the proof the URLs/bodies held. Then `apps/server` unfiltered (the mount path changed; boot suites must stay green).

- [ ] **Step 8 (failing test): deletion proof — routes.** Add a test that constructs the module list WITHOUT the `routes` seat (or a `bookings` descriptor with `routes` omitted) and asserts the four booking routes 404. Run → PASS (proves the seat is what mounts them, not a stray import).

- [ ] **Step 9: errors-reachable + whole workspace + commit.** Run `scripts/errors-reachable.test.ts`, `scripts/module-seams.test.ts` (no `apps/server`→`@waitron/bookings` import), the whole workspace. `git commit -s -m "bookings: routes seat — module owns its Hono routes (SP1 t4)"`.

---

## Task 5: the `permissions` seat

Carry `booking.manage` out of identity's central catalog into the module's `permissions` seat; identity folds module permissions into the role ladder at boot.

**Files:**
- Modify: `packages/module/src/module.ts` (`ModulePermission` type; `permissions?: readonly ModulePermission[]`).
- Create: `packages/bookings/src/permissions.ts` (`BOOKINGS_PERMISSIONS`), `permissions.test.ts`.
- Modify: `packages/identity/src/permissions.ts` (remove `booking.manage` from `PERMISSIONS` + `MANAGER`; add `registerModulePermissions`), `packages/identity/src/manager-login.ts` (widen `Permission` at `authorizeManager`), `packages/identity/src/index.ts`.
- Modify: `apps/server/src/boot.ts` (call `registerModulePermissions` with the assembled union at boot), `packages/composition/src/modules.ts` (`permissions: BOOKINGS_PERMISSIONS`).

**Interfaces:**
- Produces: `type ModulePermission = { permission: string; grantedFrom: PersonRoleValue }`; `BOOKINGS_PERMISSIONS = [{ permission: "booking.manage", grantedFrom: "manager" }]`; `registerModulePermissions(perms: readonly ModulePermission[]): void`.
- Consumes: `PersonRoleValue` from `@waitron/identity`.

- [ ] **Step 1: Add the seat type.** `ModulePermission` in `module.ts`; `readonly permissions?: readonly ModulePermission[]`.

- [ ] **Step 2 (failing test): the grant fold.** In `packages/identity`, write a test: after `registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }])`, `roleHasPermission("manager", "booking.manage")` and `roleHasPermission("admin", "booking.manage")` are true; `roleHasPermission("supervisor", …)` and `roleHasPermission("staff", …)` are false. Run → FAIL (no `registerModulePermissions`; `booking.manage` still hardcoded — remove it first so the test drives the registration path).

- [ ] **Step 3: Implement `registerModulePermissions`.** In `permissions.ts`: a module-permissions registry the role-lookup consults IN ADDITION to the static map; `registerModulePermissions` folds each `{ permission, grantedFrom }` into the roles at `grantedFrom` and above (reuse the ladder order SUPERVISOR→MANAGER→admin/ALL). Remove `"booking.manage"` from the `PERMISSIONS` literal and the `MANAGER` set and its comment. `roleHasPermission` checks the static map OR the registry. Run → PASS.

- [ ] **Step 4: Widen `Permission` at the boundary.** In `manager-login.ts`, change `authorizeManager`'s `permission` param type from `Permission` to `Permission | (string & {})` (so a module's own permission string type-checks) while keeping `Permission` the closed core union everywhere else. Verify existing call sites still infer the literal.

- [ ] **Step 5: Write `BOOKINGS_PERMISSIONS` + wire.** `packages/bookings/src/permissions.ts`: `export const BOOKINGS_PERMISSIONS: readonly ModulePermission[] = [{ permission: "booking.manage", grantedFrom: "manager" }]`. Barrel export. `permissions: BOOKINGS_PERMISSIONS` in the descriptor.

- [ ] **Step 6: Call it at boot.** In `boot.ts`, assemble `ALL_MODULES.flatMap(m => m.permissions ?? [])` (in `modules.ts`) and call `registerModulePermissions(...)` once during startup, before any route auth runs. (Assemble over `ALL_MODULES`, not the enabled set, unless a disabled module's permission should not be grantable — decide: a disabled module mounts no routes so its permission is unreachable anyway; assembling over `ALL_MODULES` is simplest and harmless. State the choice in a comment.)

- [ ] **Step 7 (failing test): deletion proof — permission.** With the `bookings` descriptor's `permissions` omitted, `authorizeManager` for a manager on `booking.manage` throws `authorization.not_permitted`. Run → PASS.

- [ ] **Step 8: Whole workspace + commit.** `pnpm --filter @waitron/identity test:coverage`, `@waitron/bookings`, the whole workspace (identity's `Permission` type is asserted widely). `git commit -s -m "bookings: permissions seat — booking.manage leaves identity's catalog (SP1 t5)"`.

---

## Task 6: the `floorAnnotations` seat (+ the `openTab` by-id fix)

Move the whole "Reserved HH:MM" concern — timezone read, grace computation, query — out of core into the module; `listTablesWithState` calls every enabled module's annotator and merges. Ride-along fix for `openTab`'s by-id read if the two-tenant probe reproduces.

**Files:**
- Modify: `packages/module/src/module.ts` (`FloorAnnotator` type; `floorAnnotations?: FloorAnnotator`).
- Create: `packages/bookings/src/floor.ts` (`BOOKINGS_FLOOR_ANNOTATIONS`), `floor.test.ts`.
- Modify: `apps/server/src/working-order.ts` (drop the `res` lateral join `:4103-4112`, the `tzRow` read `:3987-3991`, `venueWallClock`/`reservationGraceFloor`/`RESERVATION_GRACE_MINUTES` if bookings-only; call the enabled annotators after the query and merge `reservedTime`), `apps/server/src/modules.ts` (assemble enabled annotators), `packages/composition/src/modules.ts` (`floorAnnotations: BOOKINGS_FLOOR_ANNOTATIONS`).
- Move: the reserved-on-floor cases in `apps/server/src/tables.test.ts:688-810` → a suite that exercises the module annotator + the merge (keep assertions intact).

**Interfaces:**
- Produces: `interface FloorAnnotator { annotate(tx: Transaction, cfg: { tenantId: TenantId; locationId: LocationId }, now: Date, tableIds: string[]): Promise<Map<string, { reservedTime: string | null }>> }`; `BOOKINGS_FLOOR_ANNOTATIONS: FloorAnnotator`.
- Consumes: the schema; `locations.time_zone` (its own read); the injected clock `now` from `listTablesWithState`.

- [ ] **Step 1: Grep before moving the timezone utils.** `grep -n "venueWallClock\|safeTimeZone\|reservationGraceFloor\|RESERVATION_GRACE_MINUTES" apps/server/src` — confirm `venueWallClock`/`safeTimeZone` have no OTHER consumer. If they do, they relocate to a shared util (`@waitron/shared` or a server util) rather than duplicate; if bookings-only, they move into `floor.ts`. `reservationGraceFloor`/`RESERVATION_GRACE_MINUTES` are bookings-specific → into `floor.ts`.

- [ ] **Step 2: Add the seat type.** `FloorAnnotator` in `module.ts`; `readonly floorAnnotations?: FloorAnnotator`.

- [ ] **Step 3 (failing test): the annotator.** `packages/bookings/src/floor.test.ts` (real PG or PGlite as appropriate — it queries): seed a `booked` row for a table today at/after the grace floor and one before it and one for tomorrow; `annotate(tx, cfg, now, [tableId])` returns `{ reservedTime: "HH:MM" }` for the imminent one, `null` for a table with none. Reuse the exact scenarios from `tables.test.ts:688-810` (timezone edges, grace window, status filter). Run → FAIL.

- [ ] **Step 4: Implement `BOOKINGS_FLOOR_ANNOTATIONS`.** `floor.ts`: read `locations.time_zone` by `cfg.locationId`; `safeTimeZone` + `venueWallClock(now, tz)` → `venueToday`/`venueNow`; `reservationGraceFloor(venueNow)`; the query (the `res` sub-select logic, now a normal query over `tableIds`) returning the earliest imminent `booked` time per table; build the `Map`. Run → PASS.

- [ ] **Step 5: Gut `listTablesWithState`.** Remove the `res` lateral join `:4103-4112`, the `tzRow` read + `timeZone`/`venueToday`/`venueNow`/`graceFloor` computation `:3987-3996`. After the main query, `for (const a of enabledAnnotators) { const m = await a.annotate(tx, { tenantId, locationId: loc }, now, tableIds); merge m.reservedTime onto rows }`. `reservedTime` stays the optional field on the row type (unchanged). Source `enabledAnnotators` from `modules.ts`.

- [ ] **Step 6: Move the reserved-on-floor tests.** Move `tables.test.ts:688-810`'s cases to the module (or a new `listTablesWithState` merge test), assertions intact — they now prove the annotator + merge produce the same `reservedTime` the join did.

- [ ] **Step 7 (failing test): deletion proof — annotator.** With `floorAnnotations` omitted from the descriptor, `listTablesWithState` returns `reservedTime: null` for a table that HAS a `booked` row. Run → PASS.

- [ ] **Step 8 (ride-along): the `openTab` by-id probe + fix.** Write a real-PG two-tenant test as `app_user` (rolsuper=f): tenant A and tenant B each own a `dining_tables` row; `openTab(txB, cfgB, { tableId: <A's table id> })` must NOT open a tab on A's table. `openTab` reads `dining_tables` by `id` alone (`working-order.ts:806`). Run → if it reproduces (tenant B reaches A's row), add `and(eq(diningTables.id, req.tableId), eq(diningTables.tenantId, cfg.tenantId))` and re-run → PASS. If it does NOT reproduce (a predicate already scopes it elsewhere), record that finding and drop the fix — do not assert a bug that isn't there (CLAUDE.md §1).

- [ ] **Step 9: Whole workspace + commit.** `pnpm --filter @waitron/bookings test:coverage`, `apps/server` unfiltered (the floor read changed; the till floor screen consumes `reservedTime`), the whole workspace. `git commit -s -m "bookings: floorAnnotations seat — the reserved-badge query leaves core (SP1 t6)"`.

---

## Self-review

**Spec coverage:** §3 package/schema/migrations → Task 2; §3.4 sync → Task 3; §4.1 routes → Task 4; §4.2 permissions → Task 5; §4.3 floorAnnotations → Task 6; §5 helper lift → Task 1; §6 error codes → split across Tasks 1/4/5 (each code with its thrower); §7 guards → asserted in each task (module-seams T4, graph-honesty T2/T3, english-only — bookings is English, no vocabulary seat, runs in the whole-workspace gate; coverage-thresholds T1/T2; inmutabilidad T2; disabled-set deletion proofs T4/T5/T6); §8 testing → the container/deletion/wire-pin/two-tenant tasks throughout; §9 interactions → no new core migration (T2 removes), backlog carried in the spec commit. No gaps.

**Placeholder scan:** the only deferred decisions are explicitly conditional and grep-gated (T6 S1 timezone-util home; T6 S8 openTab fix only if the probe reproduces) — each states both branches, not a TODO.

**Type consistency:** `ModuleRouteContext.cfg` = `{ tenantId, locationId, nodeId, tillId }` (branded) used identically in T4 S1/S2/S5; `FloorAnnotator.annotate` signature identical in T6 S2/S3/S4/S5; `ModulePermission = { permission, grantedFrom }` identical in T5; `CoreServices.openTab(tx, req)` identical in T4 S1/S5; `BOOKINGS_ENROLMENT`/`BOOKINGS_ROUTES`/`BOOKINGS_PERMISSIONS`/`BOOKINGS_FLOOR_ANNOTATIONS` names consistent with the descriptor in T2/T3/T4/T5/T6.

**Ordering note:** Task 1 Step 3 uses `isUuid` from `@waitron/shared` which Step 6 adds — execute Step 6 before Step 3's run, or accept the transient red until Step 6. Flagged inline.
