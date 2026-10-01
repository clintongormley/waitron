# Prep station rules (slice 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's preparation routes with the design's rule — ordered exceptions, then the
nearest folder a station claims, then the venue's default station — edited on one new Prep Stations
screen with a change preview and a tester, and remove every older way of choosing a station.

**Architecture:** One pure function decides where an item is made (`chooseMaker`,
`packages/venue-service/src/routing.ts`). Venue-service stores the rules in two new tables
(`station_claims`, `route_exceptions`), loads them, and answers the sending code through its existing
seat (`VENUE_SERVICE`), now as `resolveMakers`. `fireLines` loses its second, product → category →
default chain: every order, with a service zone or without, goes through the one rule. The product's
and the category's own station columns are dropped. A new venue-service dashboard screen, Prep
Stations, holds the stations (moved from the Kitchen screen), their claims, the unassigned list, the
exceptions, a preview before each routing change is saved, and a tester.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (dashboard; venue-service's own dashboard screens run in real headless Chromium), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.1–§5.6, §5.12 and §6 "Slice 3". The owner split slice 3 into four plans on 2026-10-01; this is
the first. **Not in this plan:** opening hours, open/close by hand, fallback stations and a down
printer or screen (3b); split-off extras, ticket cross-references, "Show the rest of the order",
"Made here, no ticket" (3c); watchers and the whole-order printer (3d); takeaway and delivery
orders and their "Pickup" area (left out by the owner until such orders exist — routing matches the
service zone an order already has).

**Builds after slice 1** (`docs/superpowers/plans/2026-09-30-product-folders-slice-1.md`, branch
`feature/product-folders`): claims name the folders slice 1 turns categories into, and "Made at"
goes into slice 1's product browser. Start this branch from a `main` that holds slice 1.

## Decisions for the owner (R1–R14)

Each is a default this plan takes. Approving the plan approves them.

- **R1. The rules live in venue-service**, beside today's `preparation_routes`, which they replace:
  `station_claims` (one row per claimed folder) and `route_exceptions` (an ordered list).
  `preparation_routes` is dropped.
- **R2. A claim or exception whose station is switched off is skipped**, and the next rule down
  decides — the next matching exception, then the next claim further up the folders, then the
  default. This carries today's A143 rule ("a switched-off station falls back to the next one that
  is on") into the new model until 3b's fallback stations replace it. The screen flags such a rule.
- **R3. When nothing is left** — no active default station — sending is refused with the existing
  `station.no_default`, and paying sets the dish aside and raises `route.dish_not_sent`, exactly as a
  dish no route could take does today. Venue operations' readiness list shows one
  `venue.default_station_missing` instead of today's per-product `zone.route_missing`.
- **R4. An exception needs at least one condition** — a service zone, or a folder or product — and
  names a folder or a product, never both. A product exception names a top-level product; its
  variants follow it (as today: a route cannot name a variant). A folder condition includes its
  subfolders. **Lost:** today a variant can carry a station of its own (the product editor's
  station field, `catalogue-api.ts:775`, scope `"any"`); after 3a a variant routes by its own folder
  or follows its parent.
- **R5. A new claim or exception cannot name a switched-off station** (`route.station_inactive`, the
  code today's route writes use). Switching a station off later leaves its rules in place, flagged.
- **R6. Deleting a folder deletes its claim and every exception naming it** (a database cascade).
  Slice 1's delete dialog already says how many routing rules name the folders being deleted
  (`summariseFolders`, which today counts `preparation_routes`); 3a makes it count claims and
  exceptions, so the count stays true. It does NOT list which products would change station, which
  the design's §7 item 4 asks for, and moving a folder ("Move to…") reroutes its products with no
  preview at all. A backlog entry records both.
- **R7. A station's printers and kitchen screens show read-only** on Prep Stations, each with a link:
  printers are still attached on Printing rules, and a kitchen screen is still bound when it joins.
- **R8. Prep Stations is venue-service's screen.** Station editing moves there from the Kitchen
  screen (name, display order, thresholds, default, switch off); courses, bump mode and fire control
  stay on the Kitchen screen. The screen is listed for `venue_service.manage`, and loads data behind
  four core permissions: stations and service zones need `venue.configure`
  (`management-api.ts:339`), folders `person.manage` (`catalogue-api.ts:128`), printers
  `printer.manage` (`print-api.ts:89`) and devices `device.manage` (`device-api.ts:56`). Today no
  one can hold the first without the rest: `venue_service.manage` is granted from the manager role
  up (`packages/venue-service/src/permissions.ts:4`), and the manager role holds all four
  (`packages/identity/src/permissions.ts:47-66`). Venue operations already works this way.
- **R9. The drag-to-reorder helper moves into `@waitron/ui`**, so a module's screen can use it
  (`ReorderController`, today `apps/dashboard/src/widgets/reorder-table.ts`).
- **R10. A till's default service zone is set on Venue operations › Service zones and menus, not on
  the Devices screen, and configuration export does not carry it.** This changes what the owner
  approved on 2026-10-01: the Devices screen is core, and core dashboard code never calls a module's
  routes (checked: no non-test file under `apps/dashboard/src` names `/management-api/venue-service`;
  only `dashboard-app.test.ts`'s mocks do); and
  configuration export carries no devices at all, so it cannot carry a device's zone.
- **R11. The preview covers every active product and variant in every active service zone** (or
  once with no zone, when the venue has none).
- **R12. "Made at" on the products screen** shows where a product goes on an order whose service
  zone no exception names — the claims and the default — plus "varies by zone" when an exception
  with a service zone could apply to it. Its link opens the tester, filled in with the product.
- **R13. Codes deleted** (pre-live, CLAUDE.md §3): `route.missing`, `route.duplicate`,
  `zone.route_missing`. Kept: `route.not_found` (an exception), `route.subject_not_found`,
  `route.station_inactive` (writes), `station.no_default`, `route.dish_not_sent`.
- **R14. The two station columns are dropped by a table rebuild, and every venue is reset when this
  lands** (owner decision 2026-10-01). Measured 2026-10-01: `drizzle-kit generate` emits a full
  rebuild of both `products` and `categories` for the drop; a plain `ALTER TABLE products DROP
  COLUMN station_id` is refused on `node:sqlite` (Node v26.7.0, SQLite 3.53.4) with `error in table
  p after drop column: unknown column "station_id" in foreign key definition` when the key is
  written as a table-level `FOREIGN KEY` clause, which is how drizzle writes it (the same drop with
  the key written on the column succeeded — the control). A rebuild on a venue that has sold
  anything fails (restrict children), and on one that has not it empties `category_details`, so no
  existing database survives it; a fresh one migrates clean.

## Global Constraints

- **Every venue needs a reset after this lands** — dev venues `wa-wt reset demo <worktree-name>`,
  and the owner's box wiped and set up again. Say so in the PR body's first line.
- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. Mutation-tested packages touched: `ui` (Task 6), `db` (Task 5); a thinned test there
  reddens the weekly mutation run.
- Every colour, spacing, radius and font reads a `--wt-*` token. Markup handed to `wt-data-table` as
  a cell is styled with `part=`/`::part()`. A `wt-data-table` row menu column is keyed `actions` and
  declared `pinned: "end"`.
- Forms follow `docs/developers/design-system.md` → Forms: required fields marked, a field's problem
  beside the field, a hint as the field's placeholder, the form's refusal message at the BOTTOM of
  the form, left-aligned on its own line — never beside the buttons or in a dialog's pinned button
  bar (owner 2026-09-30).
- UI words: the design's "delivery area" is shown as **service zone** ("Service zone" / "Zona de
  servicio"), the word the dashboard already uses (`venue.zone`,
  `packages/venue-service/src/dashboard/strings.ts:18`). The screen is **Prep stations** /
  **Estaciones de preparación**. "No preparation" / "Sin preparación" as today.
- Every new string in English AND Spanish, in `packages/venue-service/src/dashboard/strings.ts`
  (venue-service screens) or `apps/dashboard/src/i18n/strings.ts` (core screens).
- Error codes name the domain concept; a deleted code goes from every copy in the tree in the same
  change (dashboard `codes.ts` maps, strings, tests) — `grep -rn '<code>'` before committing.
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter <pkg> db:generate --name <name>`; hand-written SQL with
  `pnpm --filter <pkg> db:generate:custom --name <name>`. READ every generated file: an unexpected
  `__new_<table>` rebuild is a STOP (CLAUDE.md §3), except the one Task 5 expects.
- The one fire point stays `fireLines` (`apps/server/src/working-order.ts`); the station is chosen
  and recorded when the work is sent, and a rule change never moves work already sent.
- Module boundary: core code reaches venue-service only through the `VENUE_SERVICE` seat
  (`apps/server/src/modules.ts:16`, contract `packages/module/src/module.ts`); core dashboard code
  never calls `/management-api/venue-service/*`.
- Browser suites: check `memory_pressure | grep free` before a browser run; do not start one beside
  a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These are the inputs likeliest to hurt a venue, each pinned by a test in the task named:

1. **Nearest claim wins, and an unclaimed subfolder inherits.** Bar claims Drinks; Cocktail bar
   claims Drinks › Cocktails; Drinks › Beer is unclaimed. A mojito goes to Cocktail bar, a lager to
   Bar, a product at the top level with no folder to the default. (Task 1)
2. **Exception order decides.** "Cocktails from Terrace → Main bar" above "Drinks from Terrace →
   Terrace bar": a mojito on the terrace goes to Main bar, a lager on the terrace to Terrace bar, a
   mojito indoors to its claim. Reversed, the cocktails exception is flagged as never matching and
   a terrace mojito goes to Terrace bar. (Tasks 1, 8)
3. **A switched-off station, and a switched-off default.** A claim naming a switched-off station is
   skipped for the claim above it; a sale is never refused while an active default exists. With the
   default switched off and nothing else matching: sending is refused `station.no_default`, paying
   sets the dish aside and raises `route.dish_not_sent`, and readiness shows
   `venue.default_station_missing`. (Tasks 1, 3, 4)
4. **A variant with a folder of its own.** A variant whose own category differs from its parent's
   routes by its own folder; a product exception naming the parent covers the variant. (Task 1)
5. **Upgrading a database the old migrations built.** `scripts/migration-upgrade.test.ts` passes
   through the rebuild; afterwards the five core triggers on `products` and media's four
   product-image triggers all exist. (Task 5)
6. **A folder deleted while claimed and named by an exception.** Its claim and the exception are
   gone; its products fall to the nearest claim above or the default. (Task 2)

---

## File structure

**Created**

- `packages/venue-service/src/routing.ts` + `routing.test.ts` — the pure rule: `chooseMaker`,
  `unreachableExceptions`, `folderAncestors`.
- `packages/venue-service/src/routing-store.ts` + `routing-store.test.ts` — claims and exceptions
  (read, write, reorder), `loadRoutingRules`, `resolveMakers`, `routingModel`, `previewRoutingChange`,
  `explainRoute`, `describeMakers`.
- `packages/venue-service/src/schema/routing.ts` — `stationClaims`, `routeExceptions`.
- `packages/venue-service/drizzle/0011_station_claims_route_exceptions.sql` (generated) and
  `00NN_drop_preparation_routes.sql` (generated).
- `packages/db/drizzle/0052_drop_product_triggers_before_rebuild.sql` (custom),
  `0053_drop_routing_station_columns.sql` (generated), `0054_recreate_product_triggers.sql` (custom).
- `packages/media/drizzle/00NN_recreate_product_image_triggers.sql` (custom).
- `packages/ui/src/reorder-table.ts` + tests (moved from `apps/dashboard/src/widgets/`).
- `packages/venue-service/src/dashboard/prep-stations-screen.ts` + `.test.ts` + `.a11y.test.ts`,
  `routing-client.ts` + `.test.ts`, `exception-sentence.ts` + `.test.ts`.

**Deleted**

- `packages/db/src/schema/routing-station.test.ts`; the Kitchen screen's stations panel and its
  tests; Venue operations' routing table, route dialog and route client methods;
  `setProductStation`, `setCategoryStation` and their routes; the product editor's station field.

**Modified (main ones)** — each task lists its own exactly.

- `packages/module/src/module.ts` (the seat), `packages/venue-service/src/{operations,routes,service,
  errors,classification,configuration-transfer,schema/service}.ts`
- `apps/server/src/{working-order,till-api,kitchen,management-api,catalogue-api,errors}.ts`,
  `apps/server/src/testing/zone-offers.ts`, `apps/server/scripts/demo-seed/{seed-catalogue,seed-floor}.ts`
- `packages/db/src/schema/catalogue.ts`, `packages/catalogue/src/{product-editor,product-types,
  variant-fallback}.ts`
- `apps/dashboard/src/screens/kitchen-screen.ts`, `widgets/product-editor.ts`, `widgets/product-list.ts`,
  `screens/catalogue-screen.ts`, `api/client.ts`, `i18n/strings.ts`
- `packages/venue-service/src/dashboard/{index,client,venue-operations-screen,strings,live-queries}.ts`
- `scripts/schema-constraints.test.ts`

---

### Task 1: The rule, as one pure function

Everything else calls this. No database, no I/O: rules and product facts in, a decision out.

**Files:**
- Create: `packages/venue-service/src/routing.ts`, `packages/venue-service/src/routing.test.ts`

**Interfaces:**
- Produces (exported from `routing.ts`, re-exported from `packages/venue-service/src/index.ts`):

```ts
import type { PreparationRoute } from "@waitron/module";

/** What a claim or an exception sends work to. */
export type RouteTarget = PreparationRoute; // { kind: "station"; stationId } | { kind: "no_preparation" }

export interface StationClaim {
  readonly categoryId: string;
  readonly target: RouteTarget;
}

export interface RouteException {
  readonly id: string;
  readonly position: number;
  readonly zoneId: string | null; // null: any service zone
  readonly categoryId: string | null; // a folder, including its subfolders
  readonly productId: string | null; // a top-level product, including its variants
  readonly target: RouteTarget;
}

export interface RoutingRules {
  readonly exceptions: readonly RouteException[]; // any order; sorted by (position, id) inside
  readonly claims: ReadonlyMap<string, RouteTarget>; // categoryId → target
  readonly parentOf: ReadonlyMap<string, string | null>; // categoryId → parent categoryId
  readonly activeStationIds: ReadonlySet<string>;
  readonly defaultStationId: string | null; // the active default, or null
}

export interface ProductFacts {
  readonly productId: string;
  readonly routedProductId: string; // the parent's id for a variant, else productId
  readonly categoryId: string | null; // the EFFECTIVE category (a variant's own, else its parent's)
}

export type RoutingDecision =
  | { readonly kind: "exception"; readonly exceptionId: string }
  | { readonly kind: "claim"; readonly categoryId: string }
  | { readonly kind: "default" };

export interface SkippedRule {
  readonly decision: RoutingDecision;
  readonly stationId: string; // the switched-off station it named
}

export interface MakerChoice {
  readonly route: RouteTarget | null; // null: nothing can take it (no active default)
  readonly decidedBy: RoutingDecision | null;
  readonly skipped: readonly SkippedRule[];
}

export function folderAncestors(
  parentOf: ReadonlyMap<string, string | null>,
  categoryId: string | null,
): string[]; // [categoryId, parent, grandparent, …]; stops at a repeat

export function chooseMaker(
  rules: RoutingRules,
  product: ProductFacts,
  zoneId: string | null,
): MakerChoice;

/** Ids of exceptions an earlier exception always catches first. */
export function unreachableExceptions(rules: RoutingRules): Set<string>;
```

**Behaviour (the tests pin each):**
- Exceptions are tried in `(position, id)` order. An exception matches when every condition it
  gives holds: `zoneId` null or equal to the order's zone (a zone-less order matches only
  exceptions with `zoneId` null); `productId` equal to `routedProductId`; `categoryId` among
  `folderAncestors(parentOf, product.categoryId)`.
- Then claims: the first of `folderAncestors(...)` with a claim.
- Then the default: `{ kind: "station", stationId: defaultStationId }` when not null.
- A rule whose target is a station NOT in `activeStationIds` is recorded in `skipped` and the search
  continues with the next rule (R2). A `no_preparation` target is never skipped.
- The default is used only when it is in `activeStationIds` (it is null otherwise, by contract).
- `folderAncestors` stops at a category it has already seen, so a corrupt loop cannot hang a sale.
- `unreachableExceptions`: exception B is unreachable when an earlier A has
  `A.zoneId === null || A.zoneId === B.zoneId`, and A's "what" covers B's: A names no folder and
  no product; or both name the same product; or A names a folder and B names a folder at or below
  it; or A names a folder and B names a product — NOT covered (the pure function does not know a
  product's folder; the store adds that case, Task 2). B with a zone of null is covered only by an
  A whose zone is null. An earlier A whose target is a station NOT in `activeStationIds` covers
  nothing, because `chooseMaker` skips it (R2).

- [ ] **Step 1: Write the failing tests** (`routing.test.ts`)

Build the design's folders once: `drinks` › `cocktails`, `drinks` › `beer`, `food`, and the
stations `bar`, `cocktailBar`, `mainBar`, `terraceBar`, `kitchen` (default). Zones `terrace`,
`indoors`.

```ts
import { describe, expect, it } from "vitest";
import { chooseMaker, folderAncestors, unreachableExceptions, type RoutingRules } from "./routing.js";

const station = (stationId: string) => ({ kind: "station" as const, stationId });
const parentOf = new Map<string, string | null>([
  ["drinks", null], ["cocktails", "drinks"], ["beer", "drinks"], ["food", null],
]);
const base: RoutingRules = {
  exceptions: [],
  claims: new Map([["drinks", station("bar")], ["cocktails", station("cocktailBar")]]),
  parentOf,
  activeStationIds: new Set(["bar", "cocktailBar", "mainBar", "terraceBar", "kitchen"]),
  defaultStationId: "kitchen",
};
const mojito = { productId: "mojito", routedProductId: "mojito", categoryId: "cocktails" };
const lager = { productId: "lager", routedProductId: "lager", categoryId: "beer" };
const bread = { productId: "bread", routedProductId: "bread", categoryId: null };

describe("chooseMaker", () => {
  it("gives the nearest claimed folder, and an unclaimed subfolder its parent's claim", () => {
    expect(chooseMaker(base, mojito, null)).toEqual({
      route: station("cocktailBar"), decidedBy: { kind: "claim", categoryId: "cocktails" }, skipped: [],
    });
    expect(chooseMaker(base, lager, "indoors").decidedBy).toEqual({ kind: "claim", categoryId: "drinks" });
    expect(chooseMaker(base, bread, "indoors")).toEqual({
      route: station("kitchen"), decidedBy: { kind: "default" }, skipped: [],
    });
  });

  it("tries exceptions first, in position order, and the first match wins", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        { id: "e2", position: 2, zoneId: "terrace", categoryId: "drinks", productId: null, target: station("terraceBar") },
        { id: "e1", position: 1, zoneId: "terrace", categoryId: "cocktails", productId: null, target: station("mainBar") },
      ],
    };
    expect(chooseMaker(rules, mojito, "terrace").route).toEqual(station("mainBar"));
    expect(chooseMaker(rules, lager, "terrace").route).toEqual(station("terraceBar"));
    expect(chooseMaker(rules, mojito, "indoors").decidedBy).toEqual({ kind: "claim", categoryId: "cocktails" });
    expect(chooseMaker(rules, mojito, null).decidedBy).toEqual({ kind: "claim", categoryId: "cocktails" });
  });

  it("matches an exception with no zone on any order, and one naming a product on its variants", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [{ id: "e1", position: 1, zoneId: null, categoryId: null, productId: "lager", target: { kind: "no_preparation" } }],
    };
    const lagerPint = { productId: "lager-pint", routedProductId: "lager", categoryId: "beer" };
    expect(chooseMaker(rules, lagerPint, null)).toEqual({
      route: { kind: "no_preparation" }, decidedBy: { kind: "exception", exceptionId: "e1" }, skipped: [],
    });
  });

  it("routes a variant with a folder of its own by that folder", () => {
    const mocktail = { productId: "virgin", routedProductId: "mojito", categoryId: "food" };
    expect(chooseMaker(base, mocktail, null).decidedBy).toEqual({ kind: "default" });
  });

  it("skips a rule whose station is switched off, and records it", () => {
    const rules = { ...base, activeStationIds: new Set(["bar", "kitchen"]) };
    expect(chooseMaker(rules, mojito, null)).toEqual({
      route: station("bar"),
      decidedBy: { kind: "claim", categoryId: "drinks" },
      skipped: [{ decision: { kind: "claim", categoryId: "cocktails" }, stationId: "cocktailBar" }],
    });
  });

  it("never skips a no-preparation target", () => {
    const rules = { ...base, claims: new Map([["drinks", { kind: "no_preparation" as const }]]) };
    expect(chooseMaker(rules, lager, null).route).toEqual({ kind: "no_preparation" });
  });

  it("returns no route when nothing matches and there is no active default", () => {
    expect(chooseMaker({ ...base, defaultStationId: null }, bread, null)).toEqual({
      route: null, decidedBy: null, skipped: [],
    });
  });
});

describe("folderAncestors", () => {
  it("walks up to the top, and stops at a loop", () => {
    expect(folderAncestors(parentOf, "cocktails")).toEqual(["cocktails", "drinks"]);
    expect(folderAncestors(parentOf, null)).toEqual([]);
    const loop = new Map<string, string | null>([["a", "b"], ["b", "a"]]);
    expect(folderAncestors(loop, "a")).toEqual(["a", "b"]);
  });
});

describe("unreachableExceptions", () => {
  it("flags an exception an earlier, wider one always catches", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        { id: "wide", position: 1, zoneId: "terrace", categoryId: "drinks", productId: null, target: station("terraceBar") },
        { id: "narrow", position: 2, zoneId: "terrace", categoryId: "cocktails", productId: null, target: station("mainBar") },
        { id: "other-zone", position: 3, zoneId: "indoors", categoryId: "cocktails", productId: null, target: station("mainBar") },
        { id: "any-zone", position: 4, zoneId: null, categoryId: "cocktails", productId: null, target: station("mainBar") },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["narrow"]));
  });

  it("flags a duplicate product exception, and everything after a catch-all for its zone", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        { id: "all-terrace", position: 1, zoneId: "terrace", categoryId: null, productId: null, target: station("terraceBar") },
        { id: "p1", position: 2, zoneId: "terrace", categoryId: null, productId: "lager", target: station("bar") },
        { id: "p2", position: 3, zoneId: null, categoryId: null, productId: "lager", target: station("bar") },
        { id: "p3", position: 4, zoneId: null, categoryId: null, productId: "lager", target: station("mainBar") },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["p1", "p3"]));
  });

  it("does not flag an exception behind one whose station is switched off", () => {
    const rules: RoutingRules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      exceptions: [
        { id: "off", position: 1, zoneId: "terrace", categoryId: "drinks", productId: null, target: station("terraceBar") },
        { id: "on", position: 2, zoneId: "terrace", categoryId: "cocktails", productId: null, target: station("mainBar") },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set());
  });
});

describe("the design's terrace example, written in the wrong order", () => {
  it("flags the cocktails exception and sends a terrace mojito to the terrace bar", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        { id: "drinks", position: 1, zoneId: "terrace", categoryId: "drinks", productId: null, target: station("terraceBar") },
        { id: "cocktails", position: 2, zoneId: "terrace", categoryId: "cocktails", productId: null, target: station("mainBar") },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["cocktails"]));
    expect(chooseMaker(rules, mojito, "terrace").route).toEqual(station("terraceBar"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts`
Expected: FAIL — `Cannot find module './routing.js'`.

- [ ] **Step 3: Implement** `routing.ts` to the interfaces and behaviour above. Sort exceptions by
  `(position, id)` inside `chooseMaker` and `unreachableExceptions`; never mutate the input.

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS. Then
  `pnpm --filter @waitron/venue-service exec vitest run --project node --coverage src/routing.test.ts`
  and read `routing.ts`'s row in the per-file table: 100% lines and branches. (That run exits
  non-zero, because the package's thresholds apply to every file in its include and only one test
  file ran; the row is the evidence, not the exit code.)

- [ ] **Step 5: Commit** — `git add packages/venue-service/src/routing.ts packages/venue-service/src/routing.test.ts packages/venue-service/src/index.ts && git commit -s -m "Prep stations: one pure rule decides where an item is made — exceptions in order, then the nearest claimed folder, then the default station"`

---

### Task 2: Claims and exceptions are stored, read and written

New tables beside `preparation_routes` (which Task 4 drops), their store, HTTP routes and
configuration export.

**Files:**
- Create: `packages/venue-service/src/schema/routing.ts` (export it from `schema/index.ts` or the
  file that gathers venue-service's tables — follow where `preparationRoutes` is exported)
- Create: `packages/venue-service/src/routing-store.ts`, `routing-store.test.ts`
- Create (generated): `packages/venue-service/drizzle/0011_station_claims_route_exceptions.sql`
- Modify: `packages/venue-service/src/classification.ts` (both tables `state`),
  `configuration-transfer.ts` (add `{ name: "station_claims", locationColumns: ["location_id"] }`,
  `{ name: "route_exceptions", locationColumns: ["location_id"] }`),
  `routes.ts` (new endpoints below), `errors.ts` (no new codes), `index.ts` (exports)
- Modify: `scripts/schema-constraints.test.ts` (pin the new keys, checks and unique index beside
  `preparation_routes`' entries at `:141-145`, `:285-288`, `:453-454`),
  `packages/venue-service/src/migrations.test.ts`,
  `packages/venue-service/src/classification.test.ts`

**Schema** (`schema/routing.ts`; import `table`, `id`, `flag`, `count`, `newId` and the core tables
from `@waitron/db` exactly as `schema/service.ts:1-20` does — CLAUDE.md §3 column vocabulary):

```ts
export const stationClaims = table(
  "station_claims",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    categoryId: id("category_id").notNull(),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
  },
  (t) => [
    foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "station_claims_location_fk" }),
    foreignKey({ columns: [t.categoryId], foreignColumns: [categories.id], name: "station_claims_category_fk" })
      .onDelete("cascade"),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "station_claims_station_fk" }),
    check("station_claims_target_ck",
      sql`(${t.stationId} is not null) + (nullif(${t.noPreparation}, false) is not null) = 1`),
    uniqueIndex("station_claims_folder_key").on(t.locationId, t.categoryId),
  ],
);

export const routeExceptions = table(
  "route_exceptions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    position: count("position").notNull(), // `count`, as `zone_menus.display_order` (schema/service.ts:116)
    zoneId: id("zone_id"),
    categoryId: id("category_id"),
    productId: id("product_id"),
    stationId: id("station_id"),
    noPreparation: flag("no_preparation").notNull().default(false),
  },
  (t) => [
    foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "route_exceptions_location_fk" }),
    foreignKey({ columns: [t.zoneId], foreignColumns: [floorZones.id], name: "route_exceptions_zone_fk" }),
    foreignKey({ columns: [t.categoryId], foreignColumns: [categories.id], name: "route_exceptions_category_fk" })
      .onDelete("cascade"),
    foreignKey({ columns: [t.productId], foreignColumns: [products.id], name: "route_exceptions_product_fk" }),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "route_exceptions_station_fk" }),
    check("route_exceptions_what_ck", sql`not (${t.categoryId} is not null and ${t.productId} is not null)`),
    check("route_exceptions_condition_ck",
      sql`${t.zoneId} is not null or ${t.categoryId} is not null or ${t.productId} is not null`),
    check("route_exceptions_target_ck",
      sql`(${t.stationId} is not null) + (nullif(${t.noPreparation}, false) is not null) = 1`),
    index("route_exceptions_order_idx").on(t.locationId, t.position),
  ],
);
```

`position` has NO unique index: reordering rewrites every row, and a unique position would refuse a
swap midway (CLAUDE.md §3, "Rewriting rows one at a time … can break a unique index").

**Interfaces** (`routing-store.ts`; every writer takes a `tx: Transaction` and opens none):

```ts
export interface ExceptionInput {
  zoneId: string | null; categoryId: string | null; productId: string | null; target: RouteTarget;
}
export async function setClaim(tx, cfg: VenueScope, categoryId: string, target: RouteTarget): Promise<void>; // upsert: moves a claim held by another station
export async function removeClaim(tx, cfg, categoryId: string): Promise<void>; // no row: no error
export async function createException(tx, cfg, input: ExceptionInput): Promise<string>; // appended last
export async function updateException(tx, cfg, id: string, input: ExceptionInput): Promise<void>; // route.not_found
export async function deleteException(tx, cfg, id: string): Promise<void>; // route.not_found
export async function reorderExceptions(tx, cfg, ids: readonly string[]): Promise<void>;
  // ids must be exactly this venue's exceptions: otherwise management.request_invalid {field:"ids"}
export async function loadRoutingRules(tx, cfg): Promise<RoutingRules>;
export interface RoutingModel {
  claims: { categoryId: string; target: RouteTarget; stationOff: boolean }[];
  exceptions: (RouteException & { neverMatches: boolean; stationOff: boolean })[];
  unassigned: { folders: { id: string; name: string }[]; products: { id: string; name: string }[] };
  defaultStationId: string | null;
  /** Every station any claim or exception names, switched off or not, and the default: core's
   *  `GET /management-api/stations` lists active stations only (`apps/server/src/kitchen.ts:99-116`),
   *  so the screen could not name a switched-off one without this. */
  stations: { id: string; name: string; active: boolean }[];
}
export async function routingModel(tx, cfg): Promise<RoutingModel>;
```

Validation on every write (COPY today's `validatePreparationRoute` checks, `operations.ts:926-969`
— it is not exported, and Task 4 deletes it): an unknown zone → `service_zone.not_found`; an unknown folder → `route.subject_not_found
{subject:"category"}`; a product that is unknown or a variant → `route.subject_not_found
{subject:"product"}`; a station not active in this location → `route.station_inactive` (R5).

`routingModel`'s `neverMatches` = `unreachableExceptions(rules)` PLUS a product exception that an
earlier exception with an active station, a covering zone and a folder always catches: the
product's own folder AND the effective folder of every one of its variants are at or below that
earlier folder (a variant with a folder of its own outside it can still reach the product
exception). Read effective folders with `effectiveProductColumns` as
`resolvePreparationRouteOutcomes` does. `unassigned.folders` = top-level folders — a category with
no `category_details` row, or one whose `parent_id` is null, so LEFT JOIN `category_details`
(categories have no active flag) — with no claim; `unassigned.products` = active top-level products
(`parent_id` null) with `category_id` null. Folder names: after slice 1 a category's `name` is one
plain string.

**HTTP routes** (`routes.ts`, all behind `MANAGE_VENUE_SERVICE`, errors through the existing
`STATUS` map):
- `GET /management-api/venue-service/routing` → `RoutingModel`
- `PUT /management-api/venue-service/routing/claims/:categoryId` body `{stationId}` or
  `{noPreparation: true}` → 204
- `DELETE /management-api/venue-service/routing/claims/:categoryId` → 204
- `POST /management-api/venue-service/routing/exceptions` body `{zoneId?, categoryId?, productId?,
  stationId? | noPreparation?}` → 201 `{id}`
- `PUT /management-api/venue-service/routing/exceptions/:id` (same body, every key present) → 204
- `DELETE /management-api/venue-service/routing/exceptions/:id` → 204
- `PUT /management-api/venue-service/routing/exception-order` body `{ids: string[]}` → 204

Body checks follow `requirePreparationRouteInput` (`routes.ts:105-130`): a missing target →
`management.request_invalid {field:"target"}`; folder and product together →
`{field:"subject"}`; no condition at all → `{field:"condition"}`.

- [ ] **Step 1: Write the failing store tests** (`routing-store.test.ts`), with `useVenueDb` and
  `[CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS]`, copying the setup at the top
  of `operations.test.ts:1-80`. Cases (each asserts the domain code, never just `Error`):

```ts
it("moves a claim from one station to another", async () => {
  await setClaim(tx, cfg, drinks, { kind: "station", stationId: bar });
  await setClaim(tx, cfg, drinks, { kind: "station", stationId: terraceBar });
  expect((await routingModel(tx, cfg)).claims).toEqual([
    { categoryId: drinks, target: { kind: "station", stationId: terraceBar }, stationOff: false },
  ]);
});

it("refuses a claim or exception naming a switched-off station, an unknown folder, or a variant", async () => {
  await expect(setClaim(tx, cfg, drinks, { kind: "station", stationId: switchedOff }))
    .rejects.toMatchObject({ code: "route.station_inactive" });
  await expect(setClaim(tx, cfg, randomUUID(), { kind: "no_preparation" }))
    .rejects.toMatchObject({ code: "route.subject_not_found", params: { subject: "category" } });
  await expect(createException(tx, cfg, { zoneId: null, categoryId: null, productId: lagerPint, target: noPrep }))
    .rejects.toMatchObject({ code: "route.subject_not_found", params: { subject: "product" } });
});

it("appends exceptions, and reorders them only by the full list", async () => {
  const a = await createException(tx, cfg, { zoneId: terrace, categoryId: drinks, productId: null, target: toTerraceBar });
  const b = await createException(tx, cfg, { zoneId: terrace, categoryId: cocktails, productId: null, target: toMainBar });
  expect((await routingModel(tx, cfg)).exceptions.map((e) => [e.id, e.neverMatches])).toEqual([[a, false], [b, true]]);
  await reorderExceptions(tx, cfg, [b, a]);
  expect((await routingModel(tx, cfg)).exceptions.map((e) => [e.id, e.neverMatches])).toEqual([[b, false], [a, false]]);
  await expect(reorderExceptions(tx, cfg, [b])).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "ids" } });
});

it("flags a product exception an earlier folder exception always catches", async () => { /* Drinks-from-terrace, then Mojito-from-terrace → neverMatches */ });

it("lists unclaimed top-level folders and top-level products with no folder", async () => { /* Food unclaimed + Bread → unassigned; Drinks claimed → not listed; Beer (a subfolder) never listed */ });

it("deletes a folder's claim and the exceptions naming it when the folder goes", async () => {
  await setClaim(tx, cfg, drinks, { kind: "station", stationId: bar });
  await setClaim(tx, cfg, cocktails, { kind: "station", stationId: cocktailBar });
  await createException(tx, cfg, { zoneId: terrace, categoryId: cocktails, productId: null, target: toMainBar });
  await tx.delete(categoryDetails).where(eq(categoryDetails.categoryId, cocktails));
  await tx.delete(categories).where(eq(categories.id, cocktails));
  const model = await routingModel(tx, cfg);
  expect(model.claims.find((c) => c.categoryId === cocktails)).toBeUndefined();
  expect(model.exceptions).toEqual([]);
  // Mojito was in Cocktails; read where the delete left it, and it falls to the nearest claim above.
  const [moved] = await tx.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, mojito));
  const rules = await loadRoutingRules(tx, cfg);
  expect(chooseMaker(rules, { productId: mojito, routedProductId: mojito, categoryId: moved!.categoryId }, terrace))
    .toMatchObject({ decidedBy: { kind: "claim", categoryId: drinks } });
});

it("names a switched-off station a claim still points at", async () => {
  await setClaim(tx, cfg, beer, { kind: "station", stationId: bar });
  await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, bar));
  const model = await routingModel(tx, cfg);
  expect(model.claims).toContainEqual({ categoryId: beer, target: { kind: "station", stationId: bar }, stationOff: true });
  expect(model.stations).toContainEqual({ id: bar, name: "Bar", active: false });
});
```

  (Delete the folder the way slice 1's `catalogue-items.ts` delete does; if it deletes through a
  function, call that function instead of the two raw deletes.)

- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** the schema, then
  `pnpm --filter @waitron/venue-service db:generate --name station_claims_route_exceptions`.
  READ the SQL: two `CREATE TABLE`s, their indexes, nothing else. Then the store and classification
  and transfer lists.
- [ ] **Step 4: Write the route tests** in `packages/venue-service/src/routes.test.ts` beside the
  existing route cases (same harness): each endpoint's success status; the three body refusals with
  their `field`; an unauthenticated call → 401. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/routes.test.ts src/routing-store.test.ts src/migrations.test.ts src/classification.test.ts`
  and `pnpm exec vitest run scripts/schema-constraints.test.ts` — PASS.
- [ ] **Step 5: Commit** — "Prep stations: claims and ordered exceptions are stored, checked and exported (venue-service 0011)".

---

### Task 3: Sending uses the new rule

Every order — with a service zone or without — now routes through `chooseMaker`. The old tables and
functions stay in the tree until Task 4 deletes them; after this task only Venue operations'
readiness list (`operations.ts:354`) still calls them.

**Files:**
- Modify: `packages/module/src/module.ts:282-313` — ADD to `VenueServiceContribution` (the two
  old methods stay until Task 4):

```ts
/** Where each product is made, for an order in `zoneId` (null: an order with no service zone).
 *  `null` means nothing can take it: no rule matched and there is no active default station.
 *  An unknown product throws `route.subject_not_found`; an unknown zone `service_zone.not_found`.
 *  Keys are the caller's spelling of each id (the first, when two spellings name one product). */
resolveMakers(
  tx: Transaction,
  cfg: { locationId: LocationId },
  zoneId: string | null,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, PreparationRoute | null>>;
```

- Modify: `packages/venue-service/src/service.ts:14-15,40-41` (wire `resolveMakers`),
  `routing-store.ts` (add `resolveMakers`: one `loadRoutingRules`, one read of the products'
  `routedId` and effective `categoryId` exactly as `resolvePreparationRouteOutcomes` reads them at
  `operations.ts:1101-1109`, then `chooseMaker` per product; copy its spelling handling —
  `storedUuid` and the `spellingByUuid` map — unchanged)
- Modify: `apps/server/src/working-order.ts` — `fireLines` (`:1145-1346`): every line routes by
  `VENUE_SERVICE.resolveMakers(tx, cfg, serviceContext?.zoneId ?? null, productIds)` (today's seat
  calls are at `:1169` and `:1191`). Delete the legacy chain (`:1199-1240`), `routeByProduct`,
  `defaultStationId` and the `effectiveProductColumns` / `categories` joins it used. A line whose
  outcome is `null` throws `station.no_default { locationId }`, or with `unroutable: "skip"` is set
  aside and returned. A line whose `productId` is null goes to the active default station, as the
  old chain sent it (`working-order.ts:1284,1300-1306`): keep the default-station read
  (`:1208-1220`) for such lines only, and throw `station.no_default` when there is none. No
  non-test code writes such a line today. Rewrite the comment block above `fireLines` (`:1134-1143`) to state the
  one rule. In `heldNoRouteLines` (`:1390-1429`) drop the `serviceContext === null → []` shortcut
  and call `resolveMakers` with the zone or null; rewrite its comment (`:1386-1388`, "Only a zoned
  order has no-preparation routes") to match.
- Modify: `apps/server/src/till-sale.ts:1352-1355` — the set-aside lines no longer imply a service
  zone: return `{ productIds }` with no `zoneId`, and delete the comment "Only a zoned order has
  routes to miss". `apps/server/src/dish-not-sent-alert.ts` — `DishesNotSent` loses `zoneId`; the
  alert stops reading `floorZones` and stops passing `zoneName`.
  `apps/dashboard/src/i18n/alert-messages.ts:183-186` — `route.dish_not_sent` becomes, EN: "Paid
  order {orderNumber} has dishes no prep station could take: {dishes}. They were not sent to the
  kitchen. Pass them to the kitchen by hand, and switch on a default station on the Prep stations
  page." ES: "El pedido pagado {orderNumber} tiene platos que ninguna estación de preparación podía
  recibir: {dishes}. No se han enviado a cocina. Pásalos a cocina a mano y activa una estación
  predeterminada en la página de Estaciones de preparación." `apps/server/src/errors.ts:1141-1148`
  — `route.dish_not_sent`'s params lose `zoneId` and `zoneName`.
  `apps/dashboard/src/i18n/alerts.test.ts:65-79` pins the old wording word for word: update it to
  the new text in both languages.
- Modify: `apps/server/src/testing/zone-offers.ts` — delete `mirrorLegacyRoutes` (`:230-270`) and
  the `routes` option; add, exported for tests:

```ts
/** Test-only: route one top-level product to a station on every order, as an exception. */
export async function routeProductTo(tx: Transaction, cfg: Cfg, productId: string, stationId: string): Promise<void>;
/** Test-only: a station claims a folder. */
export async function claimFolderFor(tx: Transaction, cfg: Cfg, categoryId: string, stationId: string): Promise<void>;
```

- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts:111-124` — per category, a claim to its
  station (`menu.ts` station key), or a `no_preparation` claim where the key is `null`; stop
  writing `preparation_routes`; KEEP the raw `categories.station_id` update until Task 5 deletes
  it. `apps/server/scripts/demo-seed/seed-floor.ts:176-196` — replace the zone routes with ONE
  exception per Downstairs-bar category: "<category> from Upstairs bar → Upstairs bar" (the claim
  already sends them to Downstairs bar everywhere else). `apps/server/scripts/demo-seed/seed.test.ts:204-213,328-329`
  reads the `preparation_routes` rows the seed no longer writes: make it read claims and
  exceptions instead, in this task.
- Tests — every test that routes by the product's or the category's own station, or by
  `preparation_routes`, is rewritten HERE, because from this task on neither routes anything:
  `grep -rln 'setProductStation\|setCategoryStation\|set({ *stationId\|productStationId\|categoryStationId\|mirrorLegacyRoutes\|PreparationRoute\|preparation_routes\|routes: "none"\|route.missing\|route.station_inactive' apps/server/src apps/server/scripts apps/dashboard/src packages/venue-service/src`
  (then read each hit: some are the functions' own definitions and cases, which Tasks 4 and 5
  delete)
  — among them `working-order.test.ts:2371,2795-2824,7327-7328`, `kitchen-print.test.ts:179,368-369`,
  `print-problems.test.ts:143,1061`, `testing-zone-offers.test.ts`, `till-api.unroutable-dish.test.ts`,
  `order-groups.test.ts`, `till-sale.test.ts`, `dish-not-sent-alert.test.ts`. A product's own
  station becomes `routeProductTo`; a category's becomes `claimFolderFor`. The test at
  `working-order.test.ts:7327-7328` gives a VARIANT a station of its own, which the new rule cannot
  express (R4): it becomes a variant with a folder of its own, claimed by that station.

**Keep the behaviour each old test protected.** Re-express, do not delete:
- "zoned fire has nowhere to go" (`testing-zone-offers.test.ts:254-268`) and "still refuses a table
  round with a dish no station can take" (`till-api.unroutable-dish.test.ts:715-729`): now "a dish
  is refused `station.no_default` when no rule matches and the default station is switched off".
- The payment path's set-aside and `route.dish_not_sent`: the same cases with the default switched
  off, INCLUDING one on an order with no service zone (the case `serviceContext!` would have crashed
  on), asserting the alert's text names no zone.
- Which station an item reached, in every rewritten test: the assertion stays; only the setup
  changes.

- [ ] **Step 1: Write the failing tests** — in `routing-store.test.ts`:

```ts
describe("resolveMakers", () => {
  it("routes an order with no service zone by claims and the default", async () => {
    await setClaim(tx, cfg, drinks, { kind: "station", stationId: bar });
    const made = await resolveMakers(tx, cfg, null, [lager, bread]);
    expect(made.get(lager)).toEqual({ kind: "station", stationId: bar });
    expect(made.get(bread)).toEqual({ kind: "station", stationId: kitchen });
  });

  it("answers null for every product when the default is off and nothing matches", async () => {
    await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, kitchen));
    expect((await resolveMakers(tx, cfg, terrace, [bread])).get(bread)).toBeNull();
  });

  it("refuses an unknown product and an unknown zone", async () => {
    await expect(resolveMakers(tx, cfg, null, [randomUUID()])).rejects.toMatchObject({ code: "route.subject_not_found" });
    await expect(resolveMakers(tx, cfg, randomUUID(), [bread])).rejects.toMatchObject({ code: "service_zone.not_found" });
  });
});
```

  and in `apps/server/src/working-order.test.ts` a fire on a zone-less order whose product sits in
  a folder claimed by a non-default station — the ticket item's `station_id` is the claiming
  station (today's chain picks the default, so this fails first).
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t "claimed"` — FAIL.
- [ ] **Step 3: Implement**: seat, store, `fireLines` and `heldNoRouteLines`, the payment path and
  its alert, the test helper, the seed, then the test rewrites.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node`,
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/testing-zone-offers.test.ts src/till-api.unroutable-dish.test.ts src/till-sale.test.ts src/order-groups.test.ts src/kitchen-print.test.ts src/print-problems.test.ts src/dish-not-sent-alert.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`,
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts` (or the path the
  server's vitest config gives that suite), and `pnpm exec vitest run scripts/alert-codes.test.ts`.
  Then `grep -rn 'mirrorLegacyRoutes\|routes: "none"' apps packages` prints nothing, and every
  remaining `setProductStation`/`setCategoryStation` hit is the function itself, its route, or its
  own case in `kitchen.test.ts` (Task 5 deletes them).
- [ ] **Step 5: Commit** — "Sending: every order routes by exceptions, claims and the default station; the product → category → default chain is gone".

---

### Task 4: The old routes go

**Files:**
- Modify: `packages/module/src/module.ts` — delete `resolvePreparationRoutes` and
  `resolvePreparationRouteOutcomes` from the seat; `packages/venue-service/src/service.ts` likewise
- Modify: `packages/venue-service/src/operations.ts` — delete `PreparationRouteInput`,
  `validatePreparationRoute` (its checks were copied into `routing-store.ts` in Task 2),
  `createPreparationRoute`, `updatePreparationRoute`, `listPreparationRoutes`,
  `deletePreparationRoute`, `routeRank`, `resolvePreparationRouteOutcomes`,
  `resolvePreparationRoutes`. In `listVenueReadiness` delete the per-product route check
  (`:338-369`) and put ONE check at the TOP of the function, before the early returns at `:281`
  and `:320`: when the location has no station with `is_default` and `active` both set, the list
  starts with `{ code: "venue.default_station_missing" }` (R3)
- Modify: `packages/venue-service/src/routes.ts` (delete the three `/routes` endpoints, the
  `routes` key of `GET /management-api/venue-service`, `requirePreparationRouteInput` (`:105`), and
  `route.missing` / `route.duplicate` from `STATUS`), `errors.ts` (delete `route.missing`,
  `route.duplicate`)
- Modify: `packages/venue-service/src/schema/service.ts` (delete `preparationRoutes`), then
  `pnpm --filter @waitron/venue-service db:generate --name drop_preparation_routes` — expect exactly
  `DROP TABLE \`preparation_routes\`;`
- Modify: `packages/venue-service/src/classification.ts`, `configuration-transfer.ts`,
  `scripts/schema-constraints.test.ts` (remove `preparation_routes`),
  `packages/venue-service/src/dashboard/live-queries.ts` (replace `preparation_routes` with
  `station_claims`, `route_exceptions`). Do NOT touch
  `packages/fiscal-verifactu/src/privileges.expected.ts`: its header says it is a frozen record of
  an engine that is gone.
- Modify: `packages/catalogue/src/categories.ts:194-195,207-239` — delete the raw
  `preparation_routes` delete (the new tables cascade) and the route listing in
  `categoryDependants`. `tablePresent` STAYS: it also guards `media_images` (`categories.ts:78`,
  and on slice 1 `sections.ts:87`, `catalogue-items.ts:147`). Slice 1's `summariseFolders`
  (`packages/catalogue/src/catalogue-items.ts:141-170`) counts `preparation_routes` for the
  folder-delete dialog: make it count `station_claims` plus `route_exceptions` rows naming the
  selected subtree instead, behind the same `tablePresent` guard, so the dialog's "{routes} kitchen
  routing rules" line keeps telling the truth about what the cascade will delete (R6). Its test is
  slice 1's `apps/server/src/catalogue-api.full-manifest.test.ts:9,31-54`, which imports
  `preparationRoutes` — catalogue's own suites cannot create venue-service's tables (venue-service
  depends on catalogue, so the reverse would be a loop).
- Modify: `packages/venue-service/src/operations.ts` — after the deletions, remove what nothing
  uses any more (`storedUuid` at `:1062` if `routing-store.ts` has its own copy, and the imports
  only the deleted functions used): an unused name fails the typecheck here.
- Modify: `apps/server/src/testing/clear-provision-fixture.ts:9` — it deletes from
  `preparation_routes`; delete from `route_exceptions` and `station_claims` instead, before
  stations. `apps/till/src/api/client.ts:2057` — its comment names preparation routes; cut it or
  point it at prep stations.
- Modify: `apps/server/src/till-api.ts:326-327` (delete `route.missing`, `route.station_inactive`
  from its status map — sending can no longer raise either; keep `station.no_default` 409)
- Modify: `packages/venue-service/src/dashboard/{venue-operations-screen,client,strings}.ts` — the
  "routing" view goes: delete `#routing()` (`:730-787`), the route dialog (`:1036-1066`), the
  `route.duplicate` message (`:242-243`), `PreparationRoute` and the three route methods in
  `client.ts`, the route strings. `VIEWS` becomes `["status", "departments", "zones", "kitchen"]`
  and the tab that held `#routing()${this.#kitchenChanges()}` becomes "kitchen" holding
  `#kitchenChanges()` alone (label `venue.kitchen_changes`). The readiness list renders
  `venue.default_station_missing` ("No default prep station is switched on. Items no rule sends
  anywhere cannot be sent." / "Ninguna estación de preparación predeterminada está activa. Los
  artículos que ninguna regla envía a una estación no se pueden enviar.") in place of
  `zone.route_missing`.
- Tests: `packages/venue-service/src/{operations,routes,service,migrations,category-dependencies,
  provisioning}.test.ts`, `apps/server/src/catalogue-api.full-manifest.test.ts` (the count),
  `packages/venue-service/src/dashboard/venue-operations-screen*.test.ts`.

**Keep the behaviour each old test protected:** "routes one cocktail to the bar serving its
service zone" (`operations.test.ts:356`) and "picks the most specific route" (`:990`) become an
exception and a claim through `resolveMakers`; "falls back past a switched-off station" (`:1135`)
becomes a switched-off claim skipped for the claim above.

- [ ] **Step 1: Failing tests** — readiness: a venue with NO department and its default station
  switched off lists `venue.default_station_missing` first (today's early return hides it);
  in `catalogue-api.full-manifest.test.ts`, a folder with one claim and one exception naming its
  subfolder reports `routes: 2` (import `stationClaims`/`routeExceptions` where it imported
  `preparationRoutes`).
- [ ] **Step 2: Run** them — FAIL. **Step 3: Implement** the list above.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service test` (node and browser projects —
  check memory first), `pnpm --filter @waitron/server exec vitest run src/catalogue-api.full-manifest.test.ts`,
  `pnpm --filter @waitron/venue-service typecheck`,
  and `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/module-graph-honesty.test.ts scripts/migrations-match-schema.test.ts`.
  Then `grep -rn 'route.missing\|route.duplicate\|zone.route_missing\|preparation_routes\|resolvePreparationRoute' apps packages scripts docs/developers`
  prints nothing outside migration files, `privileges.expected.ts`, and the two developer docs
  Task 13 rewrites (`docs/developers/conventions-data.md`, `products.md`).
- [ ] **Step 5: Commit** — "Venue operations: preparation routes are gone; readiness says when no default station is on (venue-service drops preparation_routes)".

---

### Task 5: The product's and the category's own station columns go

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts:30` and `:61` (delete both `stationId` columns, the
  doc comments at `:28` and `:58-59`, and the `/* v8 ignore start */` … `/* v8 ignore stop */`
  pairs around them at `:29-31` and `:60-62`)
- Create (custom, BEFORE generating): `packages/db/drizzle/0052_drop_product_triggers_before_rebuild.sql`:

```sql
-- The next migration rebuilds `products` and `categories`. Its rename fails while a trigger body
-- names a table the rebuild has dropped, and a trigger ON a rebuilt table would be dropped with it
-- silently, so every trigger that is either goes here and comes back in `0054` (core's) and in
-- media's `recreate_product_image_triggers` (media's).
DROP TRIGGER IF EXISTS products_variant_one_level_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_variant_parent_fixed_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_id_fixed_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_ordering_check_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_ordering_check_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_parent_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS products_media_image_fk_parent_rename;
```

  (Why: a rebuild silently drops every trigger ON the rebuilt table, and a trigger on another
  table whose BODY reads `products` fails the rebuild's rename on an existing database —
  `docs/developers/conventions-data.md`, "A core rebuild of a table that another set's trigger BODY
  names". The list above is every trigger in `packages/*/drizzle/*.sql` on `products` or naming it
  in its body, found 2026-10-01; re-run the search before writing the file — list the files,
  then read every trigger each creates, because a body can name `products` many lines below its
  `CREATE TRIGGER`: `grep -lw products packages/*/drizzle/*.sql | xargs grep -n 'CREATE TRIGGER'`.
  No trigger is on `categories` or names it.)
- Create (generated): `packages/db/drizzle/0053_drop_routing_station_columns.sql` —
  `pnpm --filter @waitron/db db:generate --name drop_routing_station_columns`. Expected: rebuilds
  of `categories` and `products` (`__new_categories`, `__new_products`), nothing else. This is the
  rebuild R14 accepts.
- Create (custom): `packages/db/drizzle/0054_recreate_product_triggers.sql` — the five core
  `CREATE TRIGGER` statements copied VERBATIM from `packages/db/drizzle/0004_variant_one_level.sql`
  and `0047_product_ordering_check.sql`.
- Create (custom): `packages/media/drizzle/00NN_recreate_product_image_triggers.sql` — for each of
  the four `products_media_image_fk_*` triggers: `DROP TRIGGER IF EXISTS …;` then its
  `CREATE TRIGGER` copied VERBATIM from `packages/media/drizzle/0001_image_references.sql`. (On a
  fresh database media `0001` has just created them and this re-creates them; on an upgrade core
  `0052` dropped them.) Generate it AFTER core's `0054`: at boot the sets run in order, core first
  (`packages/migrations/src/apply.ts:66-76`), but `scripts/migration-upgrade.test.ts` steps through
  every set's migrations by journal timestamp, so there a media file stamped earlier would run
  before core `0052` drops the triggers.
- **Merge order with slices 1 and 2.** Both add media migrations. If either lands after this
  branch was started, reset `packages/media/drizzle` to main's state and regenerate this branch's
  media file (CLAUDE.md §3: a number collision is fixed by regeneration, never by hand-editing
  snapshots or `_journal.json`), then re-run Step 4's guards.
- Modify: `apps/server/src/kitchen.ts:204-232` (delete `setCategoryStation`, `setProductStation`),
  `management-api.ts:1758-1790` (`registerStationRoute` and both routes),
  `catalogue-api.ts:743-783` (`screenRouting`/`applyRouting`: the product editor save no longer
  carries a station; `ProductRouting` keeps `courseId`, so only its `stationId` member goes),
  `packages/catalogue/src/{product-editor,product-types,variant-fallback,index}.ts`
  (`stationId`, `inherited.stationId`, `ProductRouting.stationId`, `effectiveProductColumns.stationId`),
  `apps/dashboard/src/widgets/{product-editor,product-editor-model}.ts` (the `product-station`
  field), `apps/dashboard/src/screens/catalogue-screen.ts:781-782`, `apps/dashboard/src/api/client.ts`
  (`setCategoryStation`), `apps/dashboard/src/i18n/strings.ts` (`category.station`,
  `product.station`, both languages), `apps/server/scripts/demo-seed/seed-catalogue.ts:114-117`
  (the raw `categories.station_id` update), `seed-floor.ts:181` (pick the Downstairs-bar
  categories from `menu.ts`'s station key instead of the column)
- Delete: `packages/db/src/schema/routing-station.test.ts`
- Tests: `scripts/schema-constraints.test.ts:52,162`, `apps/server/src/kitchen.test.ts:294-342`
  (the `setCategoryStation`/`setProductStation` cases go with the functions),
  `catalogue-api.test.ts:1485`, `apps/dashboard/src/widgets/product-editor.test.ts:612,1290,1810,2339,2367`,
  `catalogue-screen.test.ts:861,936`, `client.test.ts:1718-1735`, and any test still writing the
  column — Task 3 already moved every test that ROUTES by it onto `routeProductTo`/`claimFolderFor`.
- Modify: `scripts/migration-upgrade.test.ts`'s header (`:28-30`, "asserts only that each step does
  not throw") and root `CLAUDE.md`'s matching hedge (§2, the `migration-upgrade.test.ts` bullet:
  "asserts only that each step does not throw, so a rebuild that silently drops a trigger ON the
  rebuilt table passes it") — both become untrue for `products` once Step 4's assertion exists;
  narrow each to say the final step checks the triggers on `products` and nothing else.
  _(2026-10-01: A164 rewrote both texts, so the line numbers here are stale, and the test now
  carries two rows per table through every step. A migration that cannot carry those rows fails
  it unless named in the test's `RESETS`; whether this task's `0052`–`0054` can is not known. A new
  schema the filler cannot satisfy fails with `could not write row N of <table>`, whose fix is a
  `CANDIDATES` or `ONE_ROW` entry rather than a `RESETS` one.)_

- [ ] **Step 1: Write the failing test** — in `packages/db/src/schema/catalogue.test.ts`, with the
  file's own `columnsOf` helper (`:36-38`):

```ts
it("products and categories carry no station of their own", async () => {
  expect((await columnsOf(db, "products")).map((c) => c.name)).not.toContain("station_id");
  expect((await columnsOf(db, "categories")).map((c) => c.name)).not.toContain("station_id");
});
```
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement**: `0052` (custom) → schema edit → generate `0053` and READ it → `0054`
  (custom) → media custom migration → code and test changes (`pnpm --filter @waitron/server
  typecheck` and `pnpm --filter @waitron/dashboard typecheck` list every remaining reader).
- [ ] **Step 4: Run** the failing test (PASS), then `pnpm exec vitest run
  scripts/migration-upgrade.test.ts scripts/behavioural-triggers.test.ts
  scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts
  scripts/append-only-triggers.test.ts scripts/module-graph-honesty.test.ts` — PASS; then prove
  the triggers are back on a database migrated in one go AND on the upgrade path: add to
  `scripts/migration-upgrade.test.ts` (or a sibling case in the same file) an assertion that after
  the final step `select name from sqlite_master where type='trigger' and name like 'products_%'`
  holds all nine names above (the test closes the store after each step, `:119-138`, so open it
  once more for this read _(2026-10-01: line numbers stale since A164; the store is closed in
  `step`, and `carryRows` already reopens the file raw after it)_). Control: delete ONE `CREATE TRIGGER` from `0054` (copy the file to
  `/tmp` first), run, and check the failure names exactly that trigger; restore the file from the
  copy.
- [ ] **Step 5: Commit** — "Products and folders lose their own station field; the tables are rebuilt and every venue must be reset (core 0052–0054, media re-creates its product triggers)".

---

### Task 6: The drag-to-reorder helper moves into `@waitron/ui`

**Files:**
- Move: `apps/dashboard/src/widgets/reorder-table.ts` → `packages/ui/src/reorder-table.ts`, with
  `reorder-table.test.ts`; `apps/dashboard/src/widgets/reorder.ts` (+ test) → `packages/ui/src/reorder.ts`
- Modify: the one string it reads (`t("action.reordered")`, `reorder-table.ts:201`) becomes a
  constructor option `announce: () => string`, so `@waitron/ui` stays free of the dashboard's
  strings; every caller passes `() => t("action.reordered")`
- Modify: `packages/ui/src/index.ts` (export `ReorderController`, `ReorderModel`, the pure helper),
  and the users: `apps/dashboard/src/widgets/{member-list-editor,variant-table,option-list-form,
  product-editor,extra-list-form,home-layout-editor}.ts` (+ `variant-table.test.ts`)

- [ ] **Step 1:** Move the test first, change its import to `./reorder-table.js` in `packages/ui`,
  and add a case that the live region announces what `announce()` returns. The dashboard test
  leans on dashboard-only helpers (its locale setup, `setLocale`, and whatever it imports from
  `apps/dashboard/src`): replace each with `@waitron/ui`'s own test helpers or an inline fixture —
  a moved test that still imports from `apps/dashboard` will not resolve. Run
  `pnpm --filter @waitron/ui exec vitest run src/reorder-table.test.ts` — FAIL (file missing).
- [ ] **Step 2:** Move the code; add the option; update the callers.
- [ ] **Step 3:** Run `pnpm --filter @waitron/ui exec vitest run src/reorder-table.test.ts
  src/reorder.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run
  src/widgets/variant-table.test.ts src/widgets/member-list-editor.test.ts` — PASS; both packages
  typecheck.
- [ ] **Step 4: Mutation.** `@waitron/ui` holds a mutation floor of 90 over `src/**`
  (`packages/ui/stryker.config.json`), and these 261 lines have never been mutation-tested
  (`apps/dashboard` has no Stryker config). Run
  `pnpm --filter @waitron/ui exec stryker run --mutate src/reorder-table.ts,src/reorder.ts` and add
  tests until the surviving mutants are 10% or fewer; record the score in the commit message.
  Otherwise the weekly `.github/workflows/mutation.yml` run goes red after this lands.
- [ ] **Step 5: Commit** — "The drag-to-reorder helper moves into @waitron/ui so module screens can use it".

---

### Task 7: The Prep Stations screen — stations, claims and the unassigned list

**Files:**
- Create: `packages/venue-service/src/dashboard/prep-stations-screen.ts`, `.test.ts`, `.a11y.test.ts`
- Create: `packages/venue-service/src/dashboard/routing-client.ts` + `.test.ts` — `PrepStationsApi`:
  `load()` reads `GET /management-api/venue-service/routing`, `/management-api/stations`,
  `/management-api/categories`, `/management-api/zones`, the products list the Venue operations
  client already reads (`client.ts:111-125`), `/management-api/printers`, the stations' printers
  (`GET /management-api/stations/:sid/printers`) and `/management-api/devices`; station writes call
  core's `/management-api/stations` routes (`POST`, `PATCH /:id`, `DELETE /:id`,
  `POST /:id/default`); claim writes call Task 2's routes.
- Modify: `packages/venue-service/src/dashboard/index.ts` — a `moreScreens` entry, in the shape
  of `packages/adjustments/src/dashboard/index.ts:26-41`:

```ts
moreScreens: [
  {
    screen: { id: "prep-stations", navLabelKey: "nav.prep_stations", group: "service", requiresPermission: "venue_service.manage" },
    create(ctx) {
      const api = new PrepStationsApi(ctx.request, ctx.liveData);
      return { render: () => html`<dashboard-prep-stations-screen .api=${api}></dashboard-prep-stations-screen>` };
    },
  },
],
```

- The screen imports only TYPES from `../routing.js` (`import type …`), never `routing-store.ts`
  or anything that reaches drizzle: venue-service's dashboard is not in
  `scripts/dashboard-browser-purity.test.ts`'s `SUBPATHS`, so nothing would notice drizzle landing
  in the browser bundle. Pure helpers the screen needs (a folder's path) are written in the
  dashboard folder.
- Modify: `packages/venue-service/src/dashboard/live-queries.ts` — a `routing` entry:
  `station_claims`, `route_exceptions`, `kitchen_stations`, `categories`, `category_details`,
  `products`, `floor_zones`, `station_printers`, `printers`, `devices`
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` — the stations panel (`:313-400`,
  `:471-497`) and its state go; a line at the top "Stations are set up on Prep stations." /
  "Las estaciones se configuran en Estaciones de preparación." with a link to
  `/manage/prep-stations` (a core screen: its strings go in `apps/dashboard/src/i18n/strings.ts`,
  both languages). Its tests for stations move to the new screen's tests.
- Modify: `packages/venue-service/src/dashboard/strings.ts` (both languages)

**What the screen shows (the tests pin each):**
- One card per active station, ordered as the Kitchen screen ordered them (display order, then
  name): name; "Default" badge; the lateness thresholds; printers and kitchen screens, read-only,
  with links to `/manage/printing-rules` and `/manage/devices` (R7); "Claims:" followed by one chip
  per claimed folder showing its PATH ("Drinks › Cocktails") with a remove button; the actions
  Edit, Make default, Switch off. Edit opens a `wt-modal` form with name, display order and the
  three thresholds (the Kitchen screen edits display order today, `kitchen-screen.ts:326-331`),
  checked as `kitchen-screen.ts:26-37` checks them. `station.name_taken` names a shown field, so it
  goes under Name (CLAUDE.md §3 forms rule); anything else at the bottom of the form.
- A "No preparation" card, always present, with its claims.
- "New station" in the toolbar opens the same form, empty.
- "Unassigned" card: every folder and product in `unassigned`, each with "Assign to…", a
  `wt-combobox` of the stations plus "No preparation"; the sentence "These go to the default
  station, <name>." (or, with no active default, the readiness sentence of Task 4).
- "Claim a folder" on each station card opens a dialog with one `wt-combobox` of every folder by
  path. A folder already claimed shows "(Bar)" after its path; picking it moves the claim
  (the confirmation is Task 9's preview, which lists the moves and says "Drinks is claimed by Bar;
  this moves it to Terrace bar").
- A claim whose station is off does not happen on this screen (switched-off stations have no card);
  a claim on a station switched off elsewhere shows on the "Switched off" line below the cards,
  named from `RoutingModel.stations` (core's station list holds active stations only) and flagged
  "Switched off: its work goes to the next rule" (R2).
- Refusals: `route.station_inactive` beside the combobox; any other at the bottom of the form.

- [ ] **Step 1: Write the failing tests** (`prep-stations-screen.test.ts`), mounting with a stub
  `PrepStationsApi` in the style of `venue-operations-screen.test.ts`'s top-of-file fixtures:
  renders cards with claim paths; the unassigned list names Food and Bread and the default; Assign
  to… Bar on Food calls `setClaim(food, {stationId: bar})` (through Task 9's preview once it
  exists — until then directly); remove chip calls `removeClaim`; Edit's thresholds refuse
  `overdue <= warm` beside the field; Make default and Switch off call the core routes; the
  Kitchen screen no longer renders `stations-panel` and links to Prep stations.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Reuse `wt-card`, `wt-modal`, `wt-combobox`, `wt-button`, `wt-input`
  from `@waitron/ui`; no hard-coded colour or size.
- [ ] **Step 4: Run** the screen tests and its a11y test (each state, both themes, as
  `venue-operations-screen.a11y.test.ts` does), `pnpm --filter @waitron/dashboard exec vitest run
  src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.a11y.test.ts`, and
  `pnpm exec vitest run scripts/live-subscriptions.test.ts` — PASS. Open the screen with the dev
  stack (`wa-wt demo <worktree>`) at desktop and phone width, both themes, and look.
- [ ] **Step 5: Commit** — "Prep stations screen: stations, the folders each claims, and what nobody claims".

---

### Task 8: Exceptions — a sentence each, in order, dragged to reorder

**Files:**
- Create: `packages/venue-service/src/dashboard/exception-sentence.ts` + `.test.ts` — pure:
  `exceptionSentence(exception, names): string` → "Cocktails from Terrace → Main bar"; "Lager
  → No preparation" (no zone); "Everything from Terrace → Terrace bar" (no folder or product);
  Spanish "Cócteles desde Terraza → Barra principal", "Todo desde Terraza → …". The folder shows
  its path's last name; a product its staff name; a station its name from
  `RoutingModel.stations`, so a switched-off target is still named.
- Modify: `prep-stations-screen.ts`, its tests, `routing-client.ts` (exception methods), strings

**Behaviour:**
- An "Exceptions" card above the stations: an ordered table (a plain `<table>` driven by
  `ReorderController` from `@waitron/ui`, Task 6 — `wt-data-table` has no drag), one row per
  exception: its sentence, a warning chip when `neverMatches` ("Never used: an exception above
  always catches it first") or `stationOff` ("Its station is switched off"), and a row menu (Edit,
  Delete). Dragging, or the keyboard move the controller provides, calls `reorderExceptions` with
  the whole new order.
- "Add exception" / Edit open a form: **What** (`wt-combobox`: "Everything", each folder by path,
  each top-level product), **Service zone** ("Any service zone", each active zone), **Made at**
  (stations and "No preparation", required). "Everything" with "Any service zone" is refused on the
  client before sending ("Choose a folder or product, a service zone, or both"), shown beside
  **What**; the server's `{field:"condition"}` maps to the same place.
- Delete asks for confirmation.

- [ ] **Step 1: Failing tests**: the sentence function's six cases (three shapes × two languages);
  the screen lists exceptions in position order with the right chips; dragging row 2 above row 1
  (and the keyboard equivalent) calls `reorderExceptions([b, a])`; the form's condition refusal;
  Delete confirms then calls `deleteException`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, and look at it at
  phone width (the row menu stays on screen).
- [ ] **Step 5: Commit** — "Prep stations: ordered exceptions, written as sentences, flagged when they can never match".

---

### Task 9: A preview before a routing change is saved

**Files:**
- Modify: `packages/venue-service/src/routing-store.ts` — `previewRoutingChange`;
  `routes.ts` — `POST /management-api/venue-service/routing/preview`;
  `routing-client.ts`; `prep-stations-screen.ts` + tests; strings

**Interfaces:**

```ts
export type RoutingChange =
  | { kind: "claim"; categoryId: string; target: RouteTarget | null } // null: remove the claim
  | { kind: "exception"; id: string | null; input: ExceptionInput } // null id: a new one, last
  | { kind: "exception_delete"; id: string }
  | { kind: "exception_order"; ids: string[] };

export interface RoutingMove {
  productId: string; productName: string;
  zoneId: string | null; zoneName: string | null;
  from: RouteTarget | null; to: RouteTarget | null;
}

export async function previewRoutingChange(tx, cfg, change: RoutingChange): Promise<RoutingMove[]>;
```

It loads the rules once, applies the change IN MEMORY (never writes), and compares
`chooseMaker` before and after for every active product and variant in every active service zone,
or once with zone null when the venue has none (R11). Moves are sorted by product name, then zone
name. It validates the change as the matching write would (same codes), so a preview of an
impossible change is refused the same way.

**Screen:** every routing save — assign, claim, remove claim, add/edit/delete exception, reorder —
first calls preview and shows a `wt-modal`: "These products will be made somewhere else:" and a
table (product, service zone, from, to), or "No product changes where it is made." Confirm saves;
Cancel leaves everything as it was (a dragged row goes back). When the change moves a claim from
another station, the dialog's first line says "Drinks is claimed by Bar; this moves it to Terrace
bar."

- [ ] **Step 1: Failing tests** — store: a claim of Drinks by Terrace bar lists Lager in every
  zone moving Bar → Terrace bar and writes nothing (the model afterwards is unchanged); an
  exception reorder that swaps the two terrace exceptions lists Mojito on Terrace only; a
  no-change edit returns `[]`; a preview naming a switched-off station is refused
  `route.station_inactive`. Screen: Confirm saves, Cancel does not, the drag is undone on Cancel.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** — "Prep stations: every routing change shows which products would move before it is saved".

---

### Task 10: The tester

**Files:**
- Modify: `routing-store.ts` — `explainRoute`; `routes.ts` —
  `GET /management-api/venue-service/routing/explain?productId=<id>&zoneId=<id|empty>`;
  `routing-client.ts`; `prep-stations-screen.ts` + tests; strings

**Interfaces:**

```ts
export interface RouteExplanation {
  route: RouteTarget | null;
  decidedBy: RoutingDecision | null;
  skipped: SkippedRule[];
  /** Every station `route`, `decidedBy` and `skipped` name, switched off or not. */
  stations: { id: string; name: string; active: boolean }[];
}
export async function explainRoute(tx, cfg, productId: string, zoneId: string | null): Promise<RouteExplanation>;
```

(`chooseMaker` for one product; a variant is accepted here.)

**Screen:** a "Where is this made?" card: **Product** (`wt-combobox`, products and their
variants), **Service zone** (zones plus "No service zone"), and the answer: "Made at: Bar", then
why — "Because: Bar claims Drinks", "Because: the exception 'Cocktails from Terrace → Main bar'",
"Because: nothing else matched, so the default station takes it" — and for each skipped rule
"Skipped: Cocktail bar claims Cocktails, but Cocktail bar is switched off". With no route:
"Nothing can make this: no rule matched and no default station is switched on." The screen reads
`/manage/prep-stations/test/<productId>` with its `UrlStateController` (children
`{ "*": { test: "test" } }`, as `venue-operations-screen.ts:156-165` configures `view`) and fills
the product in.

Time, extras and watchers join the tester in 3b, 3c and 3d.

- [ ] **Step 1: Failing tests** — store: each decision kind and a skipped rule; screen: the three
  "Because" sentences, the skipped line, the nothing-can-make-it sentence, and opening
  `/manage/prep-stations/test/<lager>` fills Lager in.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** — "Prep stations: a tester says where a product is made and which rule decided".

---

### Task 11: "Made at" on the products screen

**Files:**
- Modify: `packages/module/src/module.ts` — the seat gains:

```ts
/** Where each product is made on an order whose service zone no exception names, and whether an
 *  exception naming a service zone could send it elsewhere. Variants included. */
describeMakers(
  tx: Transaction,
  cfg: { locationId: LocationId },
): Promise<ReadonlyMap<string, { route: PreparationRoute | null; variesByZone: boolean }>>;
```

- Modify: `routing-store.ts` (`describeMakers`: `chooseMaker` with zone null for every active
  product and variant; `variesByZone` when any exception with a zone matches the product's what —
  its product, or a folder at or above its effective folder, or no what), `service.ts` (wire it)
- Modify: `apps/server/src/catalogue-api.ts` — `GET /management-api/products/made-at` →
  `{ [productId]: { stationId: string | null; stationName: string | null; noPreparation: boolean; variesByZone: boolean } }`,
  behind the same permission as `GET /management-api/products` (`:1148`), through
  `VENUE_SERVICE.describeMakers` (import from `./modules.js` as `working-order.ts:129` does)
- Modify: `apps/dashboard/src/api/client.ts` (`listMadeAt()`), `screens/catalogue-screen.ts`
  (loads it beside the products and passes it down), `widgets/product-list.ts` (a "Made at"
  column after the category path: the station's name, "No preparation", or "Nowhere"; plus
  " · varies by service zone" when `variesByZone`; the cell is a link to
  `/manage/prep-stations/test/<productId>`), `i18n/strings.ts` (both languages)
- Tests: `catalogue-api.test.ts` (the endpoint), `product-list.test.ts`, `catalogue-screen.test.ts`

- [ ] **Step 1: Failing tests** — server: with Bar claiming Drinks and a terrace exception for
  Cocktails, `made-at` gives Lager `{stationName:"Bar", variesByZone:false}` and Mojito
  `{…, variesByZone:true}`; a product in no folder names the default. Dashboard: the column shows
  "Bar" and "Cocktail bar · varies by service zone", and the link's `href`.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** — "Products screen: each product says where it is made, with a link to the tester".

---

### Task 12: Tills' default service zones on Venue operations

**Files:**
- Modify: `packages/venue-service/src/operations.ts` — `clearDeviceDefaultZone(tx, cfg, deviceId)`
  (no row: no error) and `listDeviceDefaultZones(tx, cfg)`; `routes.ts` —
  `DELETE /management-api/venue-service/devices/:deviceId/default-zone` and the `deviceZones` key
  on `GET /management-api/venue-service`; `dashboard/client.ts` (read `/management-api/devices`,
  set and clear); `venue-operations-screen.ts` — in the "zones" view, a "Tills" table: each active
  device whose profile is not a kitchen screen, its label, and a select "Starts in" (blank: "The
  venue's counter zone", else each active zone); changing it calls set or clear
- Tests: `operations.test.ts`, `routes.test.ts`, `venue-operations-screen.test.ts`

- [ ] **Step 1: Failing tests** — set then clear leaves `resolveNewOrderZone` (`operations.ts:604-644`)
  choosing the counter default again; the table lists tills and not kitchen screens; choosing a
  zone calls set, choosing blank calls clear.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** — "Venue operations: each till's starting service zone can be set and cleared".

---

### Task 13: The demo routes by claims, and the documents catch up

**Files:**
- Modify: `apps/server/src/demo-seed.test.ts` (or the seed's own test) — after seeding, `resolveMakers`
  sends a Downstairs-bar drink to Downstairs bar in the downstairs zone and to Upstairs bar in the
  Upstairs bar zone, a dish to Kitchen, a no-preparation category to no preparation
- Modify: `docs/backlog.md` —
  - the design entry (`:178`): slice 3a built (PR number when it lands);
  - "The old station chain in `fireLines` routes nothing the till can sell now" (`:1407`): done —
    the chain and the three settings are deleted;
  - A9 "Category-driven routing to multiple printers/destinations" (`:6400`; re-find it by its
    title): overtaken by the design; watchers are slice 3d;
  - a NEW entry: "Deleting or moving a folder does not show which products change station" (R6:
    the delete dialog counts the rules it removes; "Move to…" says nothing), and
    "`station_claims` and `route_exceptions` cascade from `categories`, so a future rebuild of
    `categories` empties them" (CLAUDE.md §3's rebuild rule);
- Modify: `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` — a dated note at
  §5.1: "_2026-10-01: an order with a service zone did not reach steps 2–4; it used only the zone's
  routes and refused a dish none matched (`route.missing`). Slice 3a replaced both._"; and at §5.4
  and §5.12 the R10 and R7 notes.
- Modify: `docs/developers/conventions-data.md` — only if a rule there names `preparation_routes`
  or the station columns (grep); a behaviour change retires every receipt about the old behaviour
  (CLAUDE.md §1), so also `grep -rn "preparation route\|preparation_routes\|product's station\|category's station\|route.missing\|zone.route_missing" CLAUDE.md docs README.md apps/*/README.md packages/*/README.md`
  and fix each hit — root `CLAUDE.md` included (the path-set rule, CLAUDE.md §1).

- [ ] **Step 1:** the demo test (FAIL if Task 3's seed is wrong), then run it.
- [ ] **Step 2:** the documents.
- [ ] **Step 3: Commit** — "Demo and documents: routing by claims and exceptions".

---

## Self-review notes

- Spec §5.3 steps 1–3: Tasks 1–4. §5.4 with the owner's scope (no order type): Tasks 1, 3, 12.
  §5.5: Tasks 2, 7. §5.6: Tasks 1, 2, 8. §5.12 preview and tester: Tasks 9, 10. "Made at" (§2.2):
  Task 11. §6 slice 3 removals: Tasks 3, 4, 5. §5.7–§5.11 are 3b–3d.
- The seat's two old methods have exactly the callers the research listed
  (`working-order.ts:1169,1191,1423`, `operations.ts:354`); Task 3 replaces the first three and
  Task 4 the last.
