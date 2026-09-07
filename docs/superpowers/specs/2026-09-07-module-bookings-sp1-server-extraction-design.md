# `@waitron/bookings` SP1 — server + data extraction (Track C item 3, part 1)

Bookings becomes the first UI-bearing module. Item 3 (`docs/backlog.md`) wants a module that
"proves cards, permissions and i18n arriving with a module — fiscal never exercises them", extracted
full end-to-end (owner, 2026-09-07). That is too large for one spec, so it decomposes into two
sub-projects, each its own spec → plan → implementation (owner-approved 2026-09-07):

- **SP1 (this spec) — server + data.** Create `@waitron/bookings`; move the schema into its own
  migration set (the tables leave core); move the verbs + routes in; design and fill the `routes`,
  `permissions` and a new `floorAnnotations` server seat; enrol the tables into sync. The dashboard is
  **not touched** — it still calls the same URLs.
- **SP2 (separate spec, later) — dashboard module-UI seat.** Design the general, reusable mechanism
  (owner: general now, not just-enough-for-bookings) by which a module contributes a dashboard screen +
  i18n bundle + nav entry + permission gate into the browser bundle without importing the server
  package, and migrate the existing screens onto it. Proven by moving the bookings screen/widget/strings.
  Out of scope here.

Ordering is SP1 → SP2: SP1 creates the package SP2's browser sub-path hangs off.

This spec touches **nothing in CLAUDE.md §5**. Bookings are non-fiscal; the migration split leaves
`registros_facturacion` / `registro_sif` / `cadenas` / `envios` untouched (the `inmutabilidad` scan is
in §8's proof list as the receipt); `openTab` is a tab verb, not a fiscal write. No Fable fiscal-spec
read is required.

---

## 1. Scope

**In:** a new `@waitron/bookings` package; the bookings schema + its migration set moved out of core;
the booking verbs (`bookings.ts`) and routes (`booking-api.ts`) moved into the package behind a typed
`routes` seat that `boot.ts` mounts generically; a `permissions` seat that carries `booking.manage`
out of `@waitron/identity`'s central catalog; a `floorAnnotations` seat that carries the floor
"Reserved HH:MM" sub-select out of core's `listTablesWithState`; a `sync` seat enrolling the tables
(`state` class); the four `booking.*` error codes moved to the package; a new `@waitron/server-kit` holding the lifted request + cookie helpers; the descriptor added to `ALL_MODULES`.

**Out (recorded, not forgotten):**

- The **dashboard** — screen, `booking-form` widget, i18n strings, the `Screen` union entry — stays in
  `apps/dashboard`, calling the unchanged `/management-api/bookings…` URLs. SP2's subject.
- The **till floor screen** stays; it keeps rendering the optional `reservedTime` field it already has
  (`packages/ui/src/floor.ts:73`). Only the field's server-side SOURCE moves.
- The **enabled-set-aware sync pull** stays deferred (`apps/server/src/boot.ts:556` comment; module
  spec §2/§7). SP1 makes bookings the first genuinely-toggleable module — the case that deferral was
  waiting for — but does NOT build the enabled-set pull; the pull stays over `ALL_MODULES`. Recorded as
  the follow-on it unblocks.
- Migrating the other nineteen `*-api.ts` files onto the `routes` seat. The seat's own comment
  (`packages/module/src/module.ts:65`) says "incremental"; SP1 migrates bookings only.
- Any bookings FEATURE work — public/online/QR booking, availability, reminders, CRM, deposits
  (`docs/backlog.md` SP14 "Future"). SP1 is a behaviour-preserving extraction.

---

## 2. Owner decisions (2026-09-07)

1. **Full end-to-end module**, decomposed SP1 → SP2. SP1 is server + data.
2. **Enrol the tables into sync now**, `state` class (not left un-enrolled). A promoted standby then
   carries the day's bookings. Bookings are already single-writer-per-row (edited only via the
   dashboard against the primary), so `state` / last-writer is correct — the `dining_tables` treatment.
3. **Permissions seat carries name + minimum role**: `{ permission: "booking.manage", grantedFrom:
   "manager" }`. The role LADDER (SUPERVISOR ⊂ MANAGER ⊂ ALL) stays identity's; a module only says
   where on it its permission sits. Not an explicit role list (which would let a module break the
   nesting invariant), not name-only-with-central-grant (which keeps identity naming every module).
4. **Floor badge via a module server seat**: a module may contribute a per-table floor-state enricher;
   core's floor read calls every enabled module's enricher and merges. Not "till fetches separately"
   (a second floor-poll request), not "leave the join in core" (core keeps naming the module's table).
5. **Routes live in the module; lift the shared helpers** into a new `@waitron/server-kit`. Not
   "verbs-in-module, routes-stay-in-apps/server" (which leaves `apps/server` naming bookings, so
   toggling it off needs a hand-written guard at the mount site).

---

## 3. The package and its data

`@waitron/bookings` is scaffolded from `@waitron/fiscal-none` (same `package.json` shape, `type:
module`, `main: ./src/index.ts`, the `db:generate` / `db:generate:custom` scripts, `drizzle.config.ts`,
`tsconfig.json`, `vitest.config.ts`). It is a data-layer package with its own migration set, so it
takes the **six-package coverage bar (98/98/98/95)**, and `scripts/coverage-thresholds.test.ts`'s
hardcoded list gains it with the reason in the commit (CLAUDE.md §2).

### 3.1 Schema

`packages/db/src/schema/bookings.ts` (111 lines) moves verbatim to
`packages/bookings/src/schema/bookings.ts`. `@waitron/db`'s barrel drops the re-export
(`packages/db/src/schema/index.ts:36`). Nothing in core references the booking tables — verified: the
only occurrence of `booking` in `packages/db/src/schema/*.ts` outside `bookings.ts` is that barrel line
— so the schema graph stays acyclic and `bookings` is a clean leaf whose four FKs all point INTO core
(`bookings_tenant_fk` → `tenants`, `bookings_location_fk` → `locations`, `bookings_table_fk` →
`dining_tables`, `bookings_tab_fk` → `working_orders`).

### 3.2 Migrations

Regenerated per #255's per-module baseline recipe (CLAUDE.md §3's drizzle-collision recipe applies on
rebase). Pre-production: no DROP migration, no backfill (CLAUDE.md §3).

- **Core's pair loses bookings.** `0000_db_baseline.sql`: the `CREATE TABLE "bookings"` (`:671-687`),
  its `bookings_tenant_fk` + `bookings_location_fk` (`:771-772`) and the two indexes (`:802-803`).
  `0001_db_baseline_sql.sql`: the `REVOKE ALL … / GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user`
  (`:564-566`) and the composite `bookings_table_fk` / `bookings_tab_fk` constraints (`:568-573`). Done
  by REGENERATION (reset the dir, delete the schema, regenerate), never by hand-editing the snapshot
  (CLAUDE.md §3).
- **The module's pair gains them.** `packages/bookings/drizzle/0000_bookings_baseline.sql` (the table,
  the `party_size` check, the `tenant_id` unique, the two indexes, and the two SINGLE-column FKs
  `bookings_tenant_fk` + `bookings_location_fk` — the only ones drizzle-kit emits) + `0001_bookings_baseline_sql.sql`
  (the `app_user` grants — `SELECT, INSERT, UPDATE`, never widened; the two COMPOSITE FKs
  `bookings_table_fk` `(tenant_id, table_id) → dining_tables` and `bookings_tab_fk`
  `(tenant_id, tab_id) → working_orders`, which are hand-written in core's custom migration today
  (`0001_db_baseline_sql.sql:568-573`) and must be hand-copied; and the `sync_capture` trigger, §3.4).
  The custom `_sql` file is snapshot-less, so the composite FKs/grants/triggers are hand-pasted (CLAUDE.md §3).
- **Manifest + composition.** `packages/migrations/migrations.manifest.json` gains
  `{ "name": "bookings", "table": "__drizzle_migrations_bookings", "from": "../bookings/drizzle" }`;
  `packages/composition/src/composition.test.ts` keeps its byte-for-byte pin of manifest ↔ `ALL_MODULES`.

### 3.3 The descriptor

Added to `ALL_MODULES` (`packages/composition/src/modules.ts`), in composition order after the modules
it depends on:

```ts
{
  name: "bookings",
  version: "0.0.0",
  tier: "toggleable",
  requires: { core: "*", modules: { sync: "*" } },
  migrations: { name: "bookings", table: "__drizzle_migrations_bookings", from: "../bookings/drizzle" },
  sync: BOOKINGS_ENROLMENT,
  permissions: BOOKINGS_PERMISSIONS,
  routes: BOOKINGS_ROUTES,
  floorAnnotations: BOOKINGS_FLOOR_ANNOTATIONS,
}
```

`requires.core` covers the four FKs; `requires.modules.sync` covers the `sync_capture` trigger's SPI
call. `scripts/module-graph-honesty.test.ts` cross-checks both edge kinds against the emitted SQL — the
same shape the `sync` and `payments`-dependent modules already carry (`modules.ts:120/127`).

### 3.4 Sync enrolment

`BOOKINGS_ENROLMENT` is built with `enrol()` from `@waitron/sync-enrolment`
(`packages/bookings/src/enrolment.ts`, the `FISCAL_ENROLMENT` idiom at
`packages/fiscal-verifactu/src/enrolment.ts:1`):

- `mode: "watermark-upsert"`, `conflictKey: ["id"]`, `configClass: false`.
- `state` class: a runtime table edited by managers against the current serving-primary — not
  config-class (which is primary-wins-only, `packages/sync-enrolment/src/enrolment.ts:38`) and not the
  fiscal append-only lane. The same treatment `dining_tables` gets (`packages/db/src/enrolment.ts:159`),
  for the same reason: single-writer-per-row runtime state a promoted node legitimately owns.
- `captureOps: ["insert", "update"]` — the verbs never DELETE and `app_user` holds no `DELETE` grant.
- The `0001_bookings_baseline_sql.sql` custom migration installs the `bookings_capture AFTER INSERT OR
  UPDATE ON bookings FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture()` trigger — the echo-guarded shape EVERY capture trigger carries
  (`packages/fiscal-verifactu/drizzle/0001_fiscal_baseline_sql.sql:58`, `sync/drizzle/0000_sync_baseline.sql:109/147`);
  without the `WHEN` guard an applied row re-enqueues itself. This is the `requires.sync` edge.
- `apps/server/src/modules.ts`'s `ALL_SYNC_ENROLMENTS` (`flatMap(m => m.sync ?? [])`) and
  `MODULE_BY_TABLE` (`bookings → "bookings"`) pick the enrolment up with no change — they already map
  over `ALL_MODULES`.

**First genuinely-toggleable module.** Bookings is the first module that is both toggleable AND
enrols tables. This is the case `boot.ts:556`'s deferred enabled-set-aware pull was waiting for. SP1
keeps that deferral (pull over `ALL_MODULES`) and records that bookings unblocks it — it does not
widen scope to build it.

---

## 4. The three server seats

Each is a typed seat added to `WaitronModule` (`packages/module/src/module.ts`, replacing an `unknown`
or adding a new field), assembled in `apps/server/src/modules.ts` by a `flatMap`/map over the ENABLED
set (mirroring `ALL_SYNC_ENROLMENTS`), and reached by one generic loop in `boot.ts` that replaces a
hardcoded line. The seat types live in `@waitron/module`; the VALUES are exported by
`@waitron/bookings` and named only by `@waitron/composition` (the module-boundary rule, CLAUDE.md §3).

### 4.1 `routes`

Seat: `readonly routes?: ModuleRoutes` where

```ts
interface ModuleRoutes {
  mount(app: Hono, ctx: ModuleRouteContext, log: Logger): void;
}
interface ModuleRouteContext {
  db: Database;
  cfg: { tenantId: TenantId; locationId: LocationId };
  core: CoreServices;   // { openTab }  — the verbs a module route needs but cannot import
}
```

`cfg` carries the two `TillConfig` fields the booking routes + verbs actually read — `tenantId` and
`locationId` (the existing `BookingConfig`, `apps/server/src/bookings.ts:18`), as their branded types
from `@waitron/shared` — so the package imports no `till-config.ts`. (`nodeId`/`tillId` are read only
INSIDE core's `openTab`, which boot binds — so they never enter the module's cfg.) `core.openTab`
(`apps/server/src/working-order.ts:798`, which stays in `apps/server`) is how `seatBooking` reaches the
tab verb it cannot import from a module. `CoreServices` is a small interface the module DECLARES and
boot SATISFIES — the dependency points module → interface, core → implementation, no cycle. The stable
full `TillConfig` is bound into `CoreServices` by boot, so the method is `openTab(tx: Transaction, req):
Promise<…>` (per-request `tx`, cfg already captured) — the module never receives the full `TillConfig`.

There are **seven** routes, all moving byte-identical: `GET` + `POST /management-api/bookings`, `PATCH
…/:id`, `POST …/:id/seat`, and the three lifecycle POSTs `…/:id/{cancel,no-show,complete}` built by
`mountBookingLifecycleVerb` (`booking-api.ts:198-275`). The deletion proof asserts all seven 404.

`mountBookingsApi` moves to `packages/bookings/src/routes.ts` behaviour-unchanged. All seven routes
keep their exact paths, so the dashboard's requests are byte-identical.

`boot.ts:1313` (`mountBookingsApi(app, { db, cfg: till }, log)`) is replaced by the generic loop:

```ts
for (const m of enabledModules) m.routes?.mount(app, routeCtx, log);
```

placed where `mountBookingsApi` was in the mount order. SP1 migrates only bookings onto it; the other
`mount*Api` calls stay as they are.

### 4.2 `permissions`

Seat: `readonly permissions?: readonly ModulePermission[]` where
`ModulePermission = { permission: string; grantedFrom: PersonRoleValue }`. Bookings declares
`[{ permission: "booking.manage", grantedFrom: "manager" }]`.

`@waitron/identity` gains `registerModulePermissions(mods)`, called once at boot with the assembled
union. It folds each entry into the role sets at `grantedFrom` and every role ABOVE it on the ladder —
so `grantedFrom: "manager"` reaches manager + admin, exactly today's grant (`permissions.ts:120`). The
ladder stays identity's; the module states only the floor.

`booking.manage` and its comment leave `permissions.ts`'s `PERMISSIONS` literal and the `MANAGER` set.
`Permission` widens at the `authorizeManager` boundary (`packages/identity/src/manager-login.ts:120`)
from the closed literal union to `CorePermission | (string & {})`, so a module's own permission string
type-checks through `authorizeManager({ permission })` without identity enumerating it. Codes/permissions
are never renamed (CLAUDE.md §3) — `booking.manage` is unchanged, only relocated.

### 4.3 `floorAnnotations`

Seat: `readonly floorAnnotations?: FloorAnnotator` where

```ts
interface FloorAnnotator {
  annotate(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    now: Date,                       // core's injected clock, for the venue wall-clock computation
    tableIds: string[],
  ): Promise<Map<string /* tableId */, { reservedTime: string | null }>>;
}
```

The **entire** floor-badge concern moves into `packages/bookings/src/floor.ts`: the lateral sub-select
(`working-order.ts:4103-4112`), the `locations.time_zone` read (`:3987-3991`), the venue-wall-clock +
grace-floor JS (`:3991-3996`, `venueWallClock` / `reservationGraceFloor` / `RESERVATION_GRACE_MINUTES`).
Verified bookings-only: `timeZone` / `venueToday` / `venueNow` / `graceFloor` are used NOWHERE in
`listTablesWithState` except that sub-select (`:3987-3996` compute, `:4108-4109` consume, nothing
else). So `listTablesWithState` DROPS its `locations.time_zone` read entirely and, after its own query,
calls every enabled module's `annotate(tx, cfg, now, tableIds)`, merging each returned `reservedTime`
onto the matching row. `now` is the injected clock the function already receives (testability, §2b).
`reservedTime` stays the optional field `packages/ui/src/floor.ts:73` and
`apps/till/src/api/client.ts:1042` already declare — the till and UI are untouched. One extra query per
floor read, only when the module is enabled; a booked table with the module disabled yields
`reservedTime: null`.

`venueWallClock` / `safeTimeZone` are GENERIC timezone utilities (not bookings-specific); if the plan
finds another `apps/server` consumer, they relocate to a shared util rather than duplicate — the plan
greps before moving. The venue-today/grace computation is done in JS, never SQL, for the timezone
reason at `working-order.ts:4098`; it moves intact.

---

## 5. The helper lift → `@waitron/server-kit`

`booking-api.ts` depends on `apps/server` locals with no shared home. They lift to the new
`@waitron/server-kit` — the home for shared server-side HTTP helpers (it depends only on
`@waitron/shared` + `hono`):

- **The request helpers:** `createErrorBoundary` + `codeOf` (need only `@waitron/shared`'s `isAppError`
  and a `Logger` TYPE), `readJsonBody` (Hono only), the request screens (`requireString`,
  `requireUuidParam`, `requireBodyUuid`, `requireNullableBodyUuid`, `requireNullableString`,
  `requirePeriod`). The `Logger` type becomes the kit's own interface; `apps/server`'s logger satisfies
  it structurally (no import cycle).
- **The management-cookie layer → `@waitron/server-kit`.** `apps/server/src/management-session.ts` is
  the COOKIE layer (`MANAGEMENT_COOKIE`, `setManagementCookie`, `clearManagementCookie`,
  `readManagementSessionId`, `requireManagementSession`) — distinct from `@waitron/identity`'s
  ALREADY-EXISTING `management-session.ts` (the session LIFECYCLE: `resolveManagementSession` etc.). It
  is pure HTTP (`hono/cookie`), so server-kit is its home, not identity. It has ~10 `apps/server`
  consumers (`management-api.ts`, `mirror-session.ts`, `device-session.ts`, `me-api.ts`, `catalogue-api.ts`,
  `report-api.ts`, `recipe-api.ts`, `recovery-bundle-api.ts`, `box-retire.ts`, `read-only-gate.ts`,
  `boot.ts`) — all re-pointed. (Do NOT `git mv` onto identity's file of the same name.)
- **`isUuid` → `@waitron/shared`:** pure, used by the cookie + screen helpers; `apps/server/src/till-session.ts`
  re-exports it from shared. (`packages/printing/src/agent.ts` keeps its own deliberate `isUuid`.)
- **Codes travel with their throwers, unrenamed.** Only `management.request_invalid` (`{ field: string }`,
  `apps/server/src/errors.ts:960`, thrown by the screens + the cookie helper) moves — to `@waitron/server-kit`,
  by declaration-merging on `@waitron/shared` (the `fiscal-verifactu/src/errors.ts` idiom).
  `management_session.required` / `.expired` ALREADY live in `@waitron/identity`'s `errors.ts` (nothing
  to move). `scripts/errors-reachable.test.ts` re-walks the graph and must stay green. `server.*` stays
  in `apps/server` — it describes the process (CLAUDE.md §3).

`apps/server` keeps importing the same names from their new homes; every other `*-api.ts` file keeps
using the helpers unchanged.

---

## 6. Error codes

The four `booking.*` codes move from `apps/server/src/errors.ts` (`:549/559/572/582`) to
`packages/bookings/src/errors.ts` by declaration-merge, with their payload shapes unchanged:
`booking.not_found` `{ bookingId }`, `booking.invalid` `{ partySize }`, `booking.invalid_transition`
`{ bookingId }`, `booking.table_required` `{}`. The verbs' `import "./errors.js"` registers them; the
routes reach them transitively through the verb value-imports (the `purchasing-api.ts` shape the
current `booking-api.ts:5-9` comment already relies on). Codes never renamed (CLAUDE.md §3).

---

## 7. Boundaries and guards

Every root guard must pass with **no allowlist growth**:

- **`scripts/module-seams.test.ts`.** Bookings is a toggleable module, not a fiscal regime, so the
  seams guard says nothing about `apps/server` importing it — but `apps/server` WON'T: it reaches the
  module only through `ALL_MODULES` / the assembled seat maps. The `DEFERRED_RUNTIME_PASS` allowlist
  stays empty (fiscal-none left it so). A module's per-node seed, if any, runs inside `applyVenue`'s one
  transaction — bookings has no seed, so its `provisioning` seat is omitted.
- **`scripts/module-graph-honesty.test.ts`.** The `requires` edges (`core` FKs, `sync` capture-trigger
  SPI) match the SQL.
- **`scripts/english-only.test.ts`.** Bookings is a generic, English module — identifiers, strings AND
  comments in English. No `vocabulary` seat (nothing Spanish-by-design). "booking", "reservation" are
  English; the guard needs no declaration. Bookings' package dir is derived from `migrations.from`
  (`../bookings/drizzle`) so the guard scans it like any generic package (owner's package is derived
  from `migrations.from` and never scanned — bookings is NOT an owner package).
- **`scripts/errors-reachable.test.ts`.** Every new `src/errors.ts` (bookings, server-kit if it ships
  one, identity's addition) is reachable from its barrel.
- **`scripts/coverage-thresholds.test.ts`.** Its hardcoded list gains `bookings` at the six-package
  bar, with the reason in the commit.
- **`inmutabilidad`'s trigger scan (`packages/fiscal-verifactu`).** Bookings is a `state` table with NO
  immutability/anti-truncate trigger — expected, and the scan asserting the fiscal set is unchanged is
  the receipt that §5's invariants are untouched.
- **A DISABLED bookings module** (via `modules.json`) mounts no routes, grants no permission, annotates
  no floor row, and leaves its tables intact per SP-1b — the first time those three seats can be
  observed EMPTY. That is a test (§8).

---

## 8. Testing — each a run, not a read (CLAUDE.md §1/§4)

- **Migration split, real PG (container).** Apply both baselines in `orderedMigrationSets` order; assert
  `bookings` exists with its four FKs and `app_user` holds EXACTLY `SELECT, INSERT, UPDATE` — read the
  ACL back (`has_table_privilege` + the relacl, per the grant lesson CLAUDE.md §3), not just "the GRANT
  succeeded". Assert core applied ALONE leaves no `bookings` relation. `privileges.expected.ts`'s
  booking rows move to the module's privilege suite.
- **Seat inversion proven by deletion (CLAUDE.md §4).** Remove the descriptor's `routes` → the four
  routes 404. Remove `permissions` → `authorizeManager` throws `authorization.not_permitted` for a
  manager on `booking.manage`. Remove `floorAnnotations` → `listTablesWithState` returns
  `reservedTime: null` for a table with a `booked` row. Each run against BOTH the enabled and the
  disabled set (the disabled-set run is also the §7 "observed empty" proof).
- **Behaviour preserved, not rewritten (global CLAUDE.md).** `bookings.test.ts`, `booking-api.test.ts`,
  `bookings-cas.test.ts`, and the reserved-on-floor cases in `apps/server/src/tables.test.ts:688-810`
  move WITH their assertions intact; only setup changes (they insert via the module's schema). A test
  rewritten to match the new code hides the regression it exists to catch.
- **`openTab` by-id read — the till-reroute S3 shape.** `openTab` reads `dining_tables` by `id` alone
  (`working-order.ts:806`, `.where(eq(diningTables.id, req.tableId))`), no `tenantId` predicate — the
  same shape that let tenant A touch tenant B's row (CLAUDE.md §3, till-reroute S3). While SP1 is in
  `seatBooking`'s caller path, add a two-tenant probe as `app_user` (rolsuper=f) and, if it reproduces,
  fix `openTab`'s predicate. This is a fix RIDING ALONG, flagged for the plan, not silently folded.
- **Sync round-trip.** The enrolment suite gains bookings: a row inserted on the primary applies on the
  mirror; `MODULE_BY_TABLE` resolves `bookings → "bookings"`.
- **Wire pin — the proof the dashboard didn't move.** `apps/dashboard/src/api/client.test.ts`'s booking
  cases run UNCHANGED. If they pass, the URLs and bodies are byte-identical.
- **Whole workspace once.** The extraction touches values more than one suite asserts (schema barrel,
  error registry, `ALL_MODULES`, the seat maps), so run the whole workspace before believing a pass
  (CLAUDE.md §2's name-filtered-run trap).

---

## 9. Interactions with other tracks

- **No new CORE migration.** SP1 REMOVES tables from core and adds a module-owned set; the "no new core
  migration until Track A's squash lands" coordination rule (`docs/backlog.md`) is about ADDITIONS to
  core — this is the opposite. Still, whoever lands second regenerates per CLAUDE.md §3 if the baselines
  collide; the module's set is regenerated, core's edit is a hand removal.
- **Shared files:** `apps/server/src/boot.ts` (the mount-loop edit; Track A deletes role pools, Track B
  refactors workers — textual, different regions), `apps/server/src/modules.ts` (the seat maps),
  `CLAUDE.md` (Track C's §3 — if a rule is added). Conflicts are textual (CLAUDE.md §6 coordination).
- **SP-B3.2 (till layout editor) is NOT a gate.** That gates the till's SP-4 card-registry inversion.
  Bookings' till surface is a read-only floor BADGE, not a card, so SP1 does not touch the card grid.
- **Update `docs/backlog.md`** Track C item 3 in the same PR (mark SP1 landed, SP2 next).

---

## 10. Slices for the plan

The authoritative, reviewed task sequencing is
`docs/superpowers/plans/2026-09-07-module-bookings-sp1.md` (six tasks). The one structural constraint
the plan review pinned: the schema + migration move CANNOT be a standalone slice — it strands
`apps/server`'s verbs, verb tests and the raw-SQL floor read (all set up on `CORE_MIGRATIONS`), so the
schema + migrations + verbs + routes move together in one atomic task, with every test that seeds
bookings switched to `[CORE_MIGRATIONS, BOOKINGS_MIGRATIONS]`. In outline: (1) `@waitron/server-kit`
helper + cookie lift; (2) the atomic extraction (schema + migrations + verbs + 7 routes + `routes`
seat); (3) `sync` enrolment (echo-guarded capture trigger); (4) `permissions` seat; (5)
`floorAnnotations` seat; (6) the `openTab` by-id tenant-scope fix.
