# `@waitron/bookings` SP2 — dashboard module-UI seat (Track C item 3, part 2)

SP1 (`2026-09-07-module-bookings-sp1-server-extraction-design.md`, LANDED #270) moved bookings'
server + data into `@waitron/bookings` behind typed `routes` / `permissions` / `floorAnnotations`
seats, leaving the **dashboard untouched** — the screen still calls the same `/management-api/bookings…`
URLs and every line of bookings UI still lives, hand-wired, in `apps/dashboard`.

SP2 closes that gap. It designs the **general, reusable mechanism** (owner: general now, not
just-enough-for-bookings) by which ANY module contributes a dashboard **screen + i18n bundle + nav
entry + permission gate** into the browser bundle **without the dashboard importing the module's server
package** — then proves it by moving the bookings screen, its `booking-form` widget, its strings and
its api calls onto that seat. When SP2 lands, `apps/dashboard` names bookings **nowhere**.

This spec touches **nothing in CLAUDE.md §5.** Bookings are non-fiscal; SP2 moves browser code and adds
two fields to a read-only session probe. No fiscal table, chain, series or huella is in scope. No Fable
fiscal-spec read is required.

Ordering: SP1 → SP2. SP1 created the package whose `./dashboard` browser sub-path SP2 hangs off.

---

## 1. Scope

**In:**

- A new browser-safe package **`@waitron/dashboard-kit`** — the browser mirror of SP1's
  `@waitron/server-kit`: the contribution CONTRACT type, the shared request primitive, and the i18n
  registry + locale store, all lifted out of `apps/dashboard`.
- A new browser sub-path export **`@waitron/bookings/dashboard`** on the existing package: the moved
  screen + widget, the module's own typed api client, its namespaced i18n catalogue, and the
  `DashboardContribution` value tying them together.
- A new browser-safe registry package **`@waitron/dashboard-modules`** — the build-time list of every
  module's browser contribution; the browser mirror of `@waitron/composition`'s `ALL_MODULES` and the
  ONLY browser-side place that names modules.
- `apps/dashboard` changes: a generic module-mount path that coexists with the hand-wired core screens;
  the i18n core and request transport lifted into `@waitron/dashboard-kit`; bookings deleted from the
  app (screen, widget, api methods + types, strings, `Screen` union member, side-effect import,
  `NAV_GROUPS` entry, `#renderScreen` case).
- Two additive fields on the session probe: `getMe` (`GET /management-api/session/me`) returns
  `permissions: string[]` (the user's effective permission ids) and `modules: string[]` (the enabled
  module ids). A `permissionsForRole` helper in `@waitron/identity`.
- New root guards: a browser-purity guard on every module `./dashboard` graph; a registry ↔ `ALL_MODULES`
  honesty pin; a `module-seams` extension for `apps/dashboard`.

**Out (recorded, not forgotten):**

- **Migrating the other ~22 core screens** (staff, catalogue, floor, printers, devices, diagnostics…)
  onto the seat. SP2 builds the general mechanism and migrates BOOKINGS ONLY; the core screens stay
  hand-wired and adopt the seat incrementally later. This mirrors SP1's `routes` seat, which migrated
  bookings and left the other nineteen `*-api.ts` mounts in place. The two contribution paths coexist.
- **Core screens' permission migration.** SP2 makes `getMe` return the permission set and gates the
  bookings nav on `booking.manage`; core screens keep their existing coarse `requiresManager` role gate
  (`dashboard-app.ts:627-632`) until they migrate. Both gates run side by side.
- **Till card/theme seats.** `WaitronModule.cards?: unknown // SP-4` and `theme?: unknown`
  (`packages/module/src/module.ts:126/139`) are separate, untyped, and untouched here.
- **Code-splitting / dynamic `import()`.** Option 1 was chosen (§2.2): one bundle, build-time registry,
  runtime enable/disable. No dynamic imports enter the app.
- **Any bookings FEATURE work** (public/online/QR booking, availability, reminders, deposits —
  `docs/backlog.md` SP14 "Future"). SP2 is a behaviour-preserving move.

---

## 2. Owner decisions (2026-09-07 brainstorm)

1. **Migration scope: bookings only, rest incremental.** Build the general seat + registry; move only
   the bookings screen/widget/strings/api onto it. The hand-wired path stays for core screens.
2. **Discovery: build-time registry, runtime enable/disable (Option 1), not code-splitting.** A browser
   fact drove this: a browser has no filesystem and cannot enumerate installed packages at runtime —
   whatever code runs was decided when Vite built the bundle. So "discover installed packages" concretely
   means either a build-time registry (chosen) or a server-driven manifest of dynamically-imported chunks
   (rejected). Each tenant instance ships its own dashboard artifact (per-tenant version rollout,
   `docs/backlog.md` Track C item 4), so "adding a module = one registry edit + rebuild" costs nothing,
   and the runtime enabled-set still toggles a module's UI on/off with no rebuild.
3. **API ownership: the module owns its own browser client.** Symmetric with module-owns-its-routes on
   the server (SP1 §4.1). The dashboard injects a configured, shared request primitive; the module builds
   its own typed methods + types on top. Rejected: keep the monolithic `DashboardApi` and inject a narrow
   port — that leaves the app naming each module's api surface, the coupling SP2 removes.
4. **Permission gate: effective permission set from `getMe`, not a role floor on the browser.** `getMe`
   returns the user's `permissions: string[]`, computed server-side from role + the module-permission
   union SP1 already assembles (`registerModulePermissions`). The seat gates on the permission id. General
   and precise; rejected the coarse role-floor duplicate on the browser.
5. **Package layout: a dedicated `@waitron/dashboard-kit`** (clean symmetry with `@waitron/server-kit`),
   over folding the machinery into `@waitron/ui` (which would scope-creep a component library into
   app-infra).
6. **The enabled-module set rides on the existing `getMe` probe** (`modules: string[]`), saving a second
   startup round-trip, over a dedicated `/management-api/modules` endpoint.

---

## 3. Package layout

```text
apps/dashboard ──▶ @waitron/dashboard-modules       (DASHBOARD_MODULES: DashboardContribution[])
                        │
                        ├──▶ @waitron/bookings/dashboard   (screen · widget · own client · strings · contribution)
                        │            │
                        └──▶ @waitron/dashboard-kit ◀────── (imported by the app AND every module)
                                     (contract type · request primitive · i18n registry + locale store)

apps/server ──▶ @waitron/composition (ALL_MODULES, server seats)      ← unchanged, server-only
```

The dependency graph is acyclic: modules and the app import `@waitron/dashboard-kit`; the registry
imports the modules + the kit; nothing imports the registry but the app. `@waitron/dashboard-kit` names
no module (it is imported BY modules) — the registry is the only namer, honouring the composition-list
boundary (CLAUDE.md §3).

### 3.1 `@waitron/dashboard-kit` (new, browser-safe)

Depends only on browser-safe things: `@waitron/shared` (types), `lit` (for `TemplateResult`). Its
package.json lists NO server package — that is what the browser-purity guard (§10) leans on. It holds:

- the `DashboardContribution` / `DashboardModuleContext` contract (§4);
- the shared request primitive `createRequest` + `DashboardRequest` type (§6), the transport core lifted
  from `DashboardApi.#request` (`apps/dashboard/src/api/client.ts`);
- the i18n registry: `t`, `locale`, `setLocale`, `currentLocale`, `subscribeLocale`, `registerCatalogue`
  and `makeT(namespace)`, lifted from `apps/dashboard/src/i18n/t.ts` (`:7`, `:15-27`, `:37-39`) so app
  and modules share ONE locale state and ONE merged catalogue (§8).

### 3.2 `@waitron/bookings/dashboard` (new sub-path on the existing package)

The bookings `package.json` `exports` map gains a `./dashboard` entry beside `.`. The package now has a
**server entry** (`.`, which pulls `@waitron/db` and the drizzle schema) and a **browser entry**
(`./dashboard`, browser-safe). The critical invariant, proven by the browser-purity guard (§10): the
`./dashboard` import graph never reaches `.` or any server-only specifier. Contents:

- `packages/bookings/src/dashboard/bookings-screen.ts` + `booking-form.ts` — moved verbatim from
  `apps/dashboard/src/screens/bookings-screen.ts` (431 lines, `dashboard-bookings-screen`
  `:41-42`) and `apps/dashboard/src/widgets/booking-form.ts` (276 lines, `dashboard-booking-form`,
  `UpdateBookingDetail` `:12`). Their imports today are already browser-safe — `@waitron/ui`, local
  i18n, local utils, a local widget, and TYPE-only from the api client (`bookings-screen.ts:1-15`) — so
  the move re-points those imports at `@waitron/dashboard-kit` and the module's own client, nothing more.
- `packages/bookings/src/dashboard/client.ts` — the module's own typed client (§6), the seven methods +
  `Booking`/`BookingInput`/`BookingPatch`/`BookingStatus` types moved out of the app's `client.ts`
  (`:2330-2364`, `:900/909/930/943`).
- `packages/bookings/src/dashboard/strings.ts` — the `booking.*` keys (`strings.ts:446-463` en,
  `:997-1014` es), `nav.bookings` (`:53`), and the `bookingStatusName` `{en,es}` table (`i18n/domain.ts`),
  moved out of the app, re-homed as the module's namespaced catalogue (§8).
- `packages/bookings/src/dashboard/index.ts` — exports the `BOOKINGS_DASHBOARD: DashboardContribution`.

Bookings stays a domain module at the **floor coverage bar** (SP1 §3); the `./dashboard` code is covered
by the package's own browser-mode vitest (§11), not the app's.

### 3.3 `@waitron/dashboard-modules` (new, browser-safe registry)

The build-time list. Depends on `@waitron/dashboard-kit` and each module's `./dashboard` sub-path (today:
`@waitron/bookings/dashboard`). Its package.json lists NO server package. It exports

```ts
export const DASHBOARD_MODULES: readonly DashboardContribution[] = [BOOKINGS_DASHBOARD];
```

Adding a UI-bearing module is one edit here. This is the browser counterpart to `ALL_MODULES`
(`packages/composition/src/modules.ts:42-182`) — but a SEPARATE package, because `@waitron/composition`
declares every domain package as a dependency and importing it (or a sub-path of it) risks pulling
`@waitron/db` + Node built-ins into the browser bundle, the exact hazard `i18n/domain.ts:9-12` already
documents for `@waitron/catalogue`. A package whose manifest lists only browser deps is the guardable
boundary.

The server-side `WaitronModule` descriptor does **not** gain a dashboard seat: a browser-typed seat on
the server contract would drag `lit`/DOM types into `@waitron/module`. The browser contribution is a
separate artifact, and its `module` id is pinned to the server descriptor name by a guard (§10) so the
enabled set (server-provided, keyed by descriptor name) maps to browser contributions.

---

## 4. The seat contract

In `@waitron/dashboard-kit`:

```ts
interface DashboardContribution {
  module: string;                    // matches the server descriptor name, e.g. "bookings"
  screen: {
    id: string;                      // URL + routing id, e.g. "bookings"
    navLabelKey: string;             // i18n key resolved against the merged catalogue, e.g. "nav.bookings"
    group: NavGroupId;               // which sidebar group (§5.3)
    order?: number;                  // position within the group; unset sorts after ordered items
    requiresPermission: string;      // gate id, e.g. "booking.manage"
  };
  strings: { en: Record<string, string>; es: Record<string, string> };
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}
interface DashboardModuleContext {
  request: DashboardRequest;         // configured, injected by the app (§6)
}
interface DashboardScreenHandle {
  render(): TemplateResult;          // called each time the screen is active
}
```

Lifecycle: the app calls `create(ctx)` **once** per active module at startup, handing it the configured
`request`; the module builds its own client inside `create` and returns `{ render }`. The app calls
`render()` when that screen is the active one. Custom elements (`dashboard-bookings-screen`,
`dashboard-booking-form`) are defined by side-effect when the `./dashboard` module is imported by the
registry. No dynamic-tag rendering (the module's `render` uses its own literal tag), no app-visible
singletons (the client lives in the `create` closure).

`strings` is data the app reads at register time (§8); `create`/`render` are the runtime wiring. A module
that is bundled but not enabled is never registered — its strings are not merged and its `create` is never
called (§5.2).

---

## 5. Discovery + enable/disable

### 5.1 Bundled vs enabled

- **Bundled set** = `DASHBOARD_MODULES` (§3.3), fixed at build, tree-shaken into the one Vite entry
  (`apps/dashboard/vite.config.ts`, base `/manage/`).
- **Enabled set** = runtime, from `getMe().modules` (§7). The server reads it from the same enabled-module
  source `apps/server/src/modules.ts` already assembles over (SP1 §4). One-tenant-per-instance means this
  is instance config, not per-user, but it co-locates on the probe the app already calls at startup
  (decision §2.6).

The app activates the **intersection** `bundled ∩ enabled`. For each active contribution it: merges
`strings` into the catalogue (§8), adds the nav entry (§5.3), and calls `create(ctx)`. A module bundled
but disabled contributes nothing — no nav, no route, no strings — the first time those are observable
empty on the browser (a test, §11).

### 5.2 Routing

`apps/dashboard/src/dashboard-app.ts` today holds a closed `Screen` string-literal union (`:51-73`) and a
`switch` in `#renderScreen()` (`:656-714`). SP2:

- renames the closed `Screen` union (`:51-73`) to `CoreScreen` and widens the routing state `screen`
  (`:275`) to `CoreScreen | (string & {})` — the same widening idiom
  SP1 used server-side for `Permission` at the `authorizeManager` boundary
  (`manager-login.ts:120`). The `UrlStateController` (`navigation.ts:3`, `dashboard-app.ts:592-598`)
  already round-trips string ids.
- gives `#renderScreen` a generic tail: try the core `switch` first; else look the active screen id up in
  the activated-module map and return its `render()`. `#selectScreen`/`#permittedScreen` (`:571`,
  `:579-588`) consult the module's `requiresPermission` (§7) the same way they consult `requiresManager`
  for core screens.
- drops bookings' four hand-wired sites (union member `:51`, side-effect import `:26`, `NAV_GROUPS` entry
  `:114`, `#renderScreen` case).

### 5.3 Navigation

`NAV_GROUPS: NavGroup[]` (`dashboard-app.ts:93-141`) is a static, data-driven list of
`NavItem = { screen; labelKey; requiresManager? }` grouped by optional `headerKey`. SP2 keeps the core
groups and their entries; `NavGroupId` becomes a small named-group enum the app owns (derived from the
existing groups) so a module's `screen.group` targets a real group. `#nav()` (`:620-648`) renders core
items then, per group, the active-module items whose gate passes, sorted by `order`. A module naming an
unknown group is a guard failure (§10), not a silent drop.

---

## 6. API ownership

- The transport core of `DashboardApi.#request` (base URL, JSON encode/decode, error-code decode → a
  typed error carrying `{ code }`, the 401→login handling) lifts into `@waitron/dashboard-kit` as
  `createRequest({ baseUrl, fetchImpl, onUnauthorized }): DashboardRequest`, where
  `DashboardRequest = <T>(method, path, body?) => Promise<T>`. `onUnauthorized` is the app's login-redirect
  callback — the kit does transport + error decode, the app owns navigation.
- `apps/dashboard`'s `DashboardApi` (`client.ts:1209`, ctor `:1222`) is refactored to sit on
  `createRequest`; every core screen keeps its existing method calls unchanged. The app constructs the
  configured `request` once and injects it into each module via `DashboardModuleContext`.
- Bookings' seven methods (`listBookings`/`createBooking`/`updateBooking`/`seatBooking`/`cancelBooking`/
  `noShowBooking`/`completeBooking`, `client.ts:2330-2364`) and the `Booking`/`BookingInput`/`BookingPatch`/
  `BookingStatus` type copies (`:900/909/930/943`) MOVE to `packages/bookings/src/dashboard/client.ts` as
  the module's own typed client, built from `ctx.request`. The URLs and bodies are byte-identical
  (`/management-api/bookings…`), pinned by the moved wire test (§11). The app's `DashboardApi` loses those
  methods and types.

---

## 7. Permissions

- `getMe` (`GET /management-api/session/me`; client `client.ts:2217-2229` returns
  `{ personId, role, locale, venueLocale }`) gains **`permissions: string[]`** and **`modules: string[]`**.
- `permissions` is computed server-side in the `session/me` handler (`apps/server/src/me-api.ts`) via a new
  `permissionsForRole(role): string[]` in `@waitron/identity`, folding the `PERMISSIONS` catalogue + role
  sets that SP1's `registerModulePermissions` already assembles (`permissions.ts`, the `MANAGER` grant at
  `:120`) into the effective id list for the role. A manager therefore reports `…,"booking.manage",…`;
  `permissionsForRole` is unit-tested against the ladder (SUPERVISOR ⊂ MANAGER ⊂ ALL).
- The browser gate is uniform: a module nav entry / screen is shown iff
  `permissions.includes(screen.requiresPermission)`. Bookings gates on `"booking.manage"`. The shell
  keeps `sessionRole` (`dashboard-app.ts:306`, set in `#applyMe` `:405-418`) for the staff→my-schedule
  gate (`:505`) and the core screens' `requiresManager` gate (`:627-632`, `:584-588`); the module gate and
  the role gate coexist. As every screen already notes (e.g. `printers-screen.ts:86`,
  `devices-screen.ts:60`), the browser only HIDES; the server enforces (`authorizeManager`, SP1 §4.2).

---

## 8. i18n

- The i18n core lifts into `@waitron/dashboard-kit`: the module-global `locale` + pub-sub
  (`t.ts:7/15-27`), `t(key, locale)` resolving `catalogues[l]?.[key] ?? en[key]` (`:37-39`), plus a new
  `registerCatalogue(namespace, { en, es })` and `makeT(namespace)`. One locale store, one merged
  catalogue, shared by app and modules; locale switching still repaints via the existing
  `LocaleChangeController` / `keyed(currentLocale(), …)` (`dashboard-app.ts:559`).
- The app's `strings.ts` (1163 lines; `en` `:17`, `es` `:615-618`, `catalogues` `:1158-1163`) registers
  itself as the base catalogue and keeps its closed `StringKey = keyof typeof en` (`:613`) over CORE keys.
  Each active module registers its namespaced catalogue at register time.
- **Type safety survives per-package.** A module types its `t` against its OWN keys via `makeT` (its
  `ModuleStringKey = keyof typeof bookingsEn`), and enforces es-covers-en with its own
  `es: Record<BookingsStringKey, string>` — a missing key is a compile error, exactly the guarantee the
  app's single bundle gives today (`strings.ts:615-618`), now per-module. The merged runtime map is
  `Record<string,string>` at the resolution boundary.
- The `booking.*` keys, `nav.bookings`, and `bookingStatusName` move from the app's `strings.ts`/
  `domain.ts` into `packages/bookings/src/dashboard/strings.ts`. The app's catalogue loses them.
- **Code→message mapping.** The moved screen imports `codeMessage`/`codeOf` (`i18n/codes.ts`,
  `bookings-screen.ts:1-15`), so once it lives in the module it can no longer reach the app — those two
  lift to `@waitron/dashboard-kit` alongside `t`, and the app re-points. They resolve error codes against
  the merged catalogue, so a module's own error strings (registered via `registerCatalogue`) map with no
  further wiring.

---

## 9. What leaves `apps/dashboard`

`screens/bookings-screen.ts`, `widgets/booking-form.ts`, the seven bookings api methods + four types from
`client.ts`, the `booking.*`/`nav.bookings` strings, `bookingStatusName`, the `Screen` union's
`"bookings"` member, its side-effect import (`dashboard-app.ts:26`), its `NAV_GROUPS` entry (`:114`), and
its `#renderScreen` case. All re-home into `@waitron/bookings/dashboard` or become the generic module
path. The app names bookings nowhere; `grep -rn "booking" apps/dashboard/src` returns only the generic
module machinery (a receipt in the proof list, §11).

---

## 10. Boundaries & guards — each proven by a run, not a read (CLAUDE.md §1/§4)

- **Browser-purity guard (`scripts/dashboard-browser-purity.test.ts`, root project).** Walks the import
  graph from each module's `./dashboard` export and asserts it never reaches the module's server entry
  (`.`) nor any server-only specifier (`@waitron/db`, `hono`, `pg`, `node:*`). Proven by DELETION and a
  negative control: add a `@waitron/db` import to `bookings/src/dashboard/*` and the guard must go red for
  that reason. This is the new invariant the whole design rests on; it reads text, so state that in its
  header (the `errors-reachable` idiom). A build-time proof rides along in §11 (Vite builds the dashboard;
  a server import would surface as a Node-built-in externalisation warning or a bundle failure).
- **Registry ↔ composition honesty (a pin, `@waitron/dashboard-modules`).** Every UI-bearing module in
  `ALL_MODULES` has exactly one matching `DASHBOARD_MODULES` entry and vice-versa, and each
  contribution's `module` id equals its server descriptor `name`. The byte-pin shape
  `composition/src/composition.test.ts` already uses. Guards against a module server-registered but
  silently missing from the dashboard (or a stale browser entry for a removed module).
- **`module-seams` extension (`scripts/module-seams.test.ts`, root project).** `apps/dashboard` imports no
  `@waitron/composition`, no `@waitron/module`, and no module's server entry — only `./dashboard`
  sub-paths, and only via `@waitron/dashboard-modules`. Extends the existing text-walking seams guard.
- **`errors-reachable`** (`scripts/errors-reachable.test.ts`) stays green: SP2 moves no error codes (the
  `booking.*` codes moved in SP1); `@waitron/dashboard-kit` ships no `errors.ts` unless the plan finds a
  code with no home, in which case it declaration-merges (the SP1 §5 idiom) and the graph re-walks.
- **`english-only`** (`scripts/english-only.test.ts`): `@waitron/dashboard-kit` and
  `@waitron/dashboard-modules` are generic English packages — identifiers, strings AND comments in English,
  no `vocabulary` seat. The bookings `./dashboard` strings are UI copy in the module's package (already
  scanned via `migrations.from`); Spanish VALUES live in the `es` catalogue, which is data, not
  identifiers — the guard scans identifiers/comments, not string-table values (confirm against the guard's
  scope when the plan runs it).
- **`coverage-thresholds`** (`scripts/coverage-thresholds.test.ts`): the two new packages take the FLOOR
  bar (90/90/85/85), like every non-core package; neither is added to `HIGH_BAR_PACKAGES`. Bookings stays
  at the floor (SP1 §3).

---

## 11. Testing — each a run, not a read (CLAUDE.md §1/§4)

`apps/dashboard` and `@waitron/bookings`' browser code run vitest in **real headless Chromium**, so these
runs coordinate with the Chromium/RAM rule (CLAUDE.md §2/§4): before the run, check `memory_pressure` and
`pgrep -fl "chromium_headless_shell|Chromium"`, scale `--workspace-concurrency` to measured headroom.

- **Seat inversion proven both ways (CLAUDE.md §4).** With bookings in `getMe().modules`: the nav entry
  renders, `/manage?dashboard=bookings` routes to the screen, the strings resolve. With bookings absent
  from `modules`: no nav entry, the route falls through to the default screen, the `booking.*` keys are
  unmerged. The disabled run is also the §5.2 "observed empty" proof.
- **Permission gate proven both ways off `getMe`.** `permissions` without `booking.manage` → nav hidden
  and `#permittedScreen` rejects; with it → shown. `permissionsForRole` unit-tested against the role
  ladder (a supervisor lacks `booking.manage`, a manager holds it — the SP1 grant floor).
- **Browser-purity guard by deletion + negative control (§10).** The guard goes green on the real graph;
  a planted `@waitron/db` import turns it red for the right reason.
- **Behaviour preserved, not rewritten (global CLAUDE.md).** The bookings screen/widget/client tests move
  WITH their assertions intact; only imports/setup change (they target `@waitron/dashboard-kit` + the
  module client). A test rewritten to match the new wiring hides the regression it exists to catch.
- **Wire pin — the proof the URLs didn't move.** The bookings cases of `apps/dashboard/src/api/client.test.ts`
  (SP1's byte-pin) move into the module's client test and stay green. Byte-identical URLs and bodies.
- **`getMe` contract test.** A server test asserts `session/me` now returns `permissions` and `modules`
  with the right values for a given role + enabled set; the dashboard's session-probe test asserts the app
  activates the intersection.
- **Bundle proof.** `pnpm --filter @waitron/dashboard build` (Vite) succeeds and the emitted bundle pulls
  no server package — a build-time complement to the static purity guard (a server import would surface as
  a Node-built-in externalisation warning).
- **`grep` receipt.** `grep -rn "booking" apps/dashboard/src` returns only generic module machinery — the
  proof of §9.
- **Whole workspace once.** SP2 changes values more than one suite asserts — `strings.ts`, `DashboardApi`,
  the `session/me` response shape — so run the whole workspace before believing a pass (CLAUDE.md §2's
  name-filtered-run trap).

---

## 12. Interactions with other tracks

- **No new CORE migration.** SP2 is browser + a read-only probe field; it adds no table and touches no
  migration set. The Tracks B/C coordination rule (`docs/backlog.md`) about core-migration additions does
  not apply.
- **Shared files.** `apps/dashboard/src/dashboard-app.ts`, `.../api/client.ts`, `.../i18n/*` (all
  dashboard-owned, Track C), and `apps/server/src/me-api.ts` + `@waitron/identity`'s `permissions.ts` (the
  `getMe` additions — additive fields, no behaviour change to existing callers). Conflicts, if any, are
  textual (CLAUDE.md §6 coordination).
- **SP-B (till grid editor) is not a gate and is not gated.** SP2 touches the dashboard, not the till card
  grid.
- **Update `docs/backlog.md`** Track C item 3 in the same PR: mark SP2 landed, note the incremental
  core-screen migration and the core-screen permission migration as the follow-ons SP2 unblocks.

---

## 13. Slices for the plan

An outline for `writing-plans`; the plan pins the authoritative task sequencing and its review fixes it,
not the code.

1. **`@waitron/dashboard-kit`** — scaffold the browser-safe package; lift the i18n core
   (`t`/`locale`/pub-sub/`registerCatalogue`/`makeT`) and the request primitive (`createRequest`) out of
   `apps/dashboard`; re-point the app at the kit with zero behaviour change (core screens still work,
   locale still switches). Its own tests move with it.
2. **`@waitron/bookings/dashboard` sub-path** — add the `./dashboard` export; move the screen + widget +
   the module's own client + the namespaced strings + `bookingStatusName`; export
   `BOOKINGS_DASHBOARD: DashboardContribution`. Add the browser-purity guard (§10) and prove it by
   deletion. The moved screen/widget/client tests travel with their assertions.
3. **`@waitron/dashboard-modules` registry + generic mount in the app** — the registry package + its
   honesty pin; the app's generic module path (routing tail, nav merge, `create`/`render`, string merge),
   activating every BUNDLED contribution; delete bookings' four hand-wired sites and the app's bookings
   api/strings. `module-seams` extension. (Gating comes in slice 4; until then bookings is always active.)
4. **`getMe` additions + gating** — `permissions` + `modules` on the `session/me` handler;
   `permissionsForRole` in identity (unit-tested); narrow the generic mount from "every bundled" to the
   `bundled ∩ getMe().modules` intersection; add the browser permission gate on `requiresPermission`.
5. **Proofs** — seat inversion both ways, permission gate both ways, the `grep` receipt, the Vite bundle
   proof, and the whole-workspace run.

The one structural constraint the plan must respect (the SP1 lesson): the screen/widget/client/strings
move CANNOT precede the kit (slice 1) — they import `t`/`request` from it — and the app's bookings deletion
CANNOT precede the generic mount (slice 3), or the app strands a routed screen with no renderer. Slices 1
→ 2 → 3 are ordered; 4 can land beside 3; 5 is last.
