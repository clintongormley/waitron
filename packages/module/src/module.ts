import semver from "semver";
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type { Logger } from "@waitron/server-kit";
import type { MigrationSet } from "@waitron/migrations";
import type { ClassifiedTable } from "@waitron/sync-enrolment";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleProvisioning } from "./provisioning.js";
import type { RestoreHook } from "./restore.js";
import "./errors.js";

/**
 * The core verbs a module's routes need but cannot import — a module never depends on `apps/server`.
 * The module DECLARES this interface; boot SATISFIES it, binding the venue's full `TillConfig` into
 * the closure (so the method takes only a per-request `tx`, never the config). The dependency points
 * module → interface, core → implementation: no cycle. Today the sole verb is `openTab`
 * (`apps/server/src/working-order.ts`), how a booking's `seat` reaches the tab verb.
 */
export interface CoreServices {
  openTab(
    tx: Transaction,
    req: { tableId: string; lines?: { productId: string; quantity: string }[] },
  ): Promise<{ tabId: string; orderNumber: number }>;
}

/**
 * What a module's route handlers receive: the app `db`, the two `TillConfig` fields booking-shaped
 * routes actually read (`tenantId`/`locationId`, as their branded types), and `core`. `nodeId`/
 * `tillId` are read only INSIDE `core.openTab`, which boot binds, so they never enter `cfg`.
 */
export interface ModuleRouteContext {
  db: Database;
  cfg: { tenantId: TenantId; locationId: LocationId };
  core: CoreServices;
}

/**
 * A module's HTTP contribution: it mounts its routes on the shared Hono app. Boot iterates every
 * ENABLED module's `routes` seat through one generic loop, so toggling a module off mounts nothing
 * — no hand-written guard at the mount site (spec §4.1).
 */
export interface ModuleRoutes {
  mount(app: Hono, ctx: ModuleRouteContext, log: Logger): void;
}

/**
 * The four person roles, lowest-to-highest on identity's ladder. Written here rather than imported
 * from `@waitron/identity` because the module CONTRACT package must not depend on a domain module
 * (identity depends on this contract, never the reverse). This union must stay byte-identical to
 * identity's `PersonRoleValue`; `@waitron/composition`'s `role-parity.ts` — the one package that
 * imports both — asserts mutual assignability at compile time, so a divergence in EITHER direction is
 * a type error.
 */
export type ModuleRole = "staff" | "supervisor" | "manager" | "admin";

/**
 * A permission a module contributes to identity's role ladder, and the LOWEST role that holds it.
 * identity folds it into `grantedFrom` and every role ABOVE it on the ladder; the module states only
 * the floor, never an explicit role list — the ladder stays identity's (spec §4.2).
 */
export type ModulePermission = { readonly permission: string; readonly grantedFrom: ModuleRole };

/**
 * A module supplies each table's next reservation time for core's floor read-model: given the tables
 * being listed and the venue clock, the `reservedTime` per table. Core's `listTablesWithState` calls
 * every ENABLED module's annotator and merges the result onto its rows, so the reserved-badge query
 * (timezone read + grace window + the bookings scan) leaves core. Today the payload is one field and
 * bookings is the one producer; a genuinely different annotation waits for a second producer to exist.
 *
 * The returned Map carries one entry PER input `tableId` (`reservedTime` null when the table has no
 * imminent reservation), so the merge is a plain per-row lookup. `reservedTime` is the venue-local
 * `HH:MM` the floor renders as "Reserved HH:MM", already normalised by the annotator. `cfg` is scoped
 * to tenant AND location (a by-id/by-location read still scopes to the tenant — CLAUDE.md §3).
 */
export interface FloorAnnotator {
  annotate(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    now: Date,
    tableIds: string[],
  ): Promise<Map<string, { reservedTime: string | null }>>;
}

export type ServiceMode = "table_tab" | "prepay" | "invoice_first" | "ticket_then_pay";

export interface OrderServiceContext {
  readonly zoneId: string;
  readonly departmentId: string;
  readonly serviceMode: ServiceMode;
}

export interface ServiceZoneSummary {
  readonly id: string;
  readonly name: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly serviceMode: ServiceMode;
}

export interface ZoneMenuOffer {
  readonly id: string;
  readonly menuId: string;
  readonly productId: string;
  readonly sectionId: string;
  readonly grossPrice: string;
  readonly displayOrder: number;
  readonly active: boolean;
  readonly menuName: string;
  readonly sectionName: Readonly<Record<string, string>>;
  readonly descriptions: Readonly<Record<string, string>>;
  readonly pricingUnit: "each" | "weight";
  readonly vatClass: string;
  readonly category: string;
  readonly allergens: Readonly<
    Record<string, { readonly presence: "contains" | "may_contain"; readonly source?: string }>
  > | null;
  readonly diet: unknown;
  readonly dietDerivation: unknown;
  readonly dietOverride: unknown;
  readonly courseId: string | null;
  readonly optionGroups: readonly {
    readonly id: string;
    readonly name: Readonly<Record<string, string>>;
    readonly minSelect: number;
    readonly maxSelect: number;
    readonly required: boolean;
    readonly options: readonly {
      readonly id: string;
      readonly name: Readonly<Record<string, string>>;
      readonly priceDelta: string;
      readonly maxQuantity: number;
      readonly vatClass: string | null;
      readonly addAllergens: Readonly<
        Record<string, { readonly presence: "contains" | "may_contain"; readonly source?: string }>
      > | null;
      readonly removeAllergens: readonly string[] | null;
      readonly addOrigins: readonly string[] | null;
      readonly removeOrigins: readonly string[] | null;
    }[];
  }[];
}

export type PreparationRoute =
  { readonly kind: "station"; readonly stationId: string } | { readonly kind: "no_preparation" };

/** Venue-service decisions consumed by generic ordering code inside its existing transaction. */
export interface VenueServiceContribution {
  listServiceZones(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
  ): Promise<readonly ServiceZoneSummary[]>;
  resolveZoneContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    zoneId: string,
  ): Promise<OrderServiceContext>;
  resolvePreparationRoute(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    zoneId: string,
    productId: string,
  ): Promise<PreparationRoute>;
  listZoneOffers(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    zoneId: string,
  ): Promise<{
    defaultMenuId: string | null;
    menus: readonly { id: string; name: string; isDefault: boolean }[];
    offers: readonly ZoneMenuOffer[];
  }>;
  resolveNewOrderZone(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    input: { zoneId?: string | null; deviceId?: string | null },
  ): Promise<OrderServiceContext>;
  resolveZoneOffer(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    zoneId: string,
    menuItemId: string,
  ): Promise<ZoneMenuOffer>;
  recordOrderContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    workingOrderId: string,
    zoneId: string,
  ): Promise<void>;
  getOrderContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    workingOrderId: string,
  ): Promise<OrderServiceContext>;
  findOrderContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    workingOrderId: string,
  ): Promise<OrderServiceContext | null>;
  listLineContexts(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    workingOrderId: string,
  ): Promise<
    readonly {
      workingOrderLineId: string;
      menuItemId: string;
      menuId: string;
      menuName: string;
      categoryName: string;
      pricingUnit: "each" | "weight";
      vatClass: string;
      allergens: ZoneMenuOffer["allergens"];
      diet: unknown;
      dietDerivation: unknown;
      dietOverride: unknown;
    }[]
  >;
  recordLineContexts(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    workingOrderId: string,
    lines: readonly { workingOrderLineId: string; menuItemId: string }[],
  ): Promise<void>;
  copyOrderContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    fromWorkingOrderId: string,
    toWorkingOrderId: string,
  ): Promise<void>;
  copyLineContext(
    tx: Transaction,
    cfg: { tenantId: TenantId; locationId: LocationId },
    fromWorkingOrderLineId: string,
    toWorkingOrderLineId: string,
  ): Promise<void>;
}

/** A reference to non-DB state a module owns, resolved to a path by the composition root. */
export type NonDbSource = { readonly kind: "content-addressed-dir"; readonly source: string };

/** A module's backup contribution: the non-DB state it owns, and what it does after a restore. */
export interface ModuleBackupContribution {
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: RestoreHook;
}

/** One tenant-scoped table whose rows may cross from preparation into a fresh production database. */
export interface ConfigurationTransferTable {
  readonly name: string;
  readonly omit?: readonly string[];
  readonly locationColumns?: readonly string[];
  readonly reconnect?: boolean;
}

/** Every module declares either its transferable configuration or that it has none. */
export type ModuleConfigurationTransfer =
  | { readonly kind: "none" }
  | { readonly kind: "tables"; readonly tables: readonly ConfigurationTransferTable[] };

/**
 * A module descriptor: a plain object the composition root collects into a list, deriving each surface
 * (migrations here; routes/workers/cards/… in later slices) by mapping over it. There is no global
 * registry and no `register()` side effect.
 *
 * The descriptors are assembled in one list, `@waitron/composition`'s `ALL_MODULES`; each owning
 * package exports the VALUES its seats carry (enrolment, vocabulary, provisioning, fiscal) and never
 * the descriptor itself.
 */
export interface WaitronModule {
  /** Stable id; equals the migration-set name (`migrations.name`). NOT the drizzle table suffix —
   * that is `migrations.table`, usually `__drizzle_migrations_<name>` but not always (e.g. the `core`
   * set's table is `__drizzle_migrations_db`). */
  readonly name: string;
  /** Module version. Every package is 0.0.0 today (workspace-locked); real once modules distribute. */
  readonly version: string;
  /** Compatibility — recorded now, enforced in SP-1c. Inert while everything is workspace-locked. */
  readonly requires?: {
    readonly core?: string;
    readonly modules?: Readonly<Record<string, string>>;
  };
  /** mandatory (core) | provision-only (fiscal) | toggleable (rest). Recorded now; acted on in SP-1b. */
  readonly tier: "mandatory" | "provision-only" | "toggleable";
  /** Manifest-shaped migration info — NOT an import.meta.url-derived folder (spec §4). */
  readonly migrations: MigrationSet;

  // Optional module capabilities are assembled by composition without importing domain packages here.
  /** Swap S1: every table this module's migrations create, classified `ledger`/`state`/`local`
   * (swap spec §2.1). The composition root assembles every module's classification; the two
   * publication table-lists derive from it and the root completeness guard checks it covers each
   * module's `CREATE TABLE`s exactly once. */
  readonly classification?: readonly ClassifiedTable[];
  readonly cards?: unknown; // SP-4
  /** SP-3b: the domain terms this module OWNS — legitimate inside its own package (derived from
   * `migrations.from`, `../<pkg>/drizzle`), forbidden in every generic package. Tokens, not words:
   * lowercase ASCII, unaccented, singular and plural separately, nothing stemmed. Interpreted only
   * by the root english-only suite, which unions every declaration with the guard's base list and
   * asserts the two are disjoint; no runtime consumer. Omit the seat rather than declare `[]`. */
  readonly vocabulary?: readonly string[];
  /** SP1 (bookings): the permissions this module contributes to identity's role ladder — each a
   * permission string with the lowest role that holds it. The composition root assembles every
   * module's seat and boot folds them in once (`registerModulePermissions`) before any route auth, so
   * identity's central catalog names no module permission (spec §4.2). */
  readonly permissions?: readonly ModulePermission[];
  readonly duties?: unknown; // cronjobs
  readonly theme?: unknown;
  /** What this module seeds per node at provisioning, and how it takes part in standing up a
   * standby. Run by `@waitron/provisioning` and the composition root inside their transactions. */
  readonly provisioning?: ModuleProvisioning;
  /** The module's contribution to the fiscal slot — `fiscalSlot` selects exactly one. */
  readonly fiscal?: FiscalContribution;
  /** SP1 (bookings): the module's HTTP routes, mounted generically by boot over the enabled set.
   * Incremental — bookings is the first `*-api.ts` migrated behind the seat (spec §4.1). */
  readonly routes?: ModuleRoutes;
  /** SP1 (bookings): the module's per-table annotation of core's floor read-model. `listTablesWithState`
   * folds every ENABLED module's annotator onto its rows — bookings supplies the reserved-on-floor
   * badge, so its timezone/grace/query concern leaves core (spec §4.3). */
  readonly floorAnnotations?: FloorAnnotator;
  readonly venueService?: VenueServiceContribution;
  readonly backup?: ModuleBackupContribution; // The module's non-DB backup sources and restore hook.
  readonly configurationTransfer?: ModuleConfigurationTransfer;
}

/** The dependencies a module declares — its `requires.core` (a dep on "core") plus every
 * `requires.modules` entry — each as `[dependencyName, semverRange]`. A module with no `requires`
 * declares no dependencies, so it starts ready to emit, nothing to wait on (e.g. core). */
function* requiredEdges(m: WaitronModule): Iterable<readonly [string, string]> {
  if (m.requires?.core !== undefined) yield ["core", m.requires.core];
  for (const [dep, range] of Object.entries(m.requires?.modules ?? {})) yield [dep, range];
}

/**
 * Resolve, validate, and order the migration sets (spec §5). Pure — no DB, no I/O.
 *
 * The list order is NO LONGER the migration order (SP-1a); the order is DERIVED from each module's
 * declared `requires` graph. This single entry point validates the set (version compatibility +
 * dependency presence + no cycle) and returns the sets in a stable topological order, so boot's one
 * call site cannot skip the check. Kahn's algorithm with the INPUT list order as the tie-break among
 * ready nodes reproduces today's manifest order for `ALL_MODULES` (spec §5 trace; the SP-1a pin holds
 * and now also proves the sort reproduces the manifest).
 *
 * Throws (loud, before any caller migrates): `module.requires_invalid` (a malformed range — a
 * descriptor bug), `module.dependency_missing` (a required module absent from the set — trippable
 * today via modules.json, spec §4), `module.incompatible_version` (present but version out of range),
 * `module.dependency_cycle` (the graph does not drain).
 */
export function orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[] {
  const byName = new Map(modules.map((m) => [m.name, m]));

  // 1. Validate every declared edge: range well-formed, dependency present, version satisfied.
  //    validRange first (a descriptor bug is independent of the set); presence before satisfies
  //    (an absent module has no version to compare — spec §5).
  for (const m of modules) {
    for (const [dep, range] of requiredEdges(m)) {
      if (semver.validRange(range) === null) {
        throw new AppError("module.requires_invalid", { module: m.name, dependency: dep, range });
      }
      const target = byName.get(dep);
      if (target === undefined) {
        throw new AppError("module.dependency_missing", { module: m.name, requires: dep });
      }
      if (!semver.satisfies(target.version, range)) {
        throw new AppError("module.incompatible_version", {
          module: m.name,
          dependency: dep,
          required: range,
          actual: target.version,
        });
      }
    }
  }

  // 2. Kahn topological sort. Edges point dependency → dependent, so a module's IN-DEGREE is the
  //    number of dependencies it still waits on; `dependents[d]` lists the modules that require `d`
  //    (the edges to decrement when `d` is emitted).
  const inDegree = new Map<string, number>(modules.map((m) => [m.name, 0]));
  const dependents = new Map<string, string[]>();
  for (const m of modules) {
    for (const [dep] of requiredEdges(m)) {
      // `m.name` is always a key: inDegree is seeded for every module above.
      inDegree.set(m.name, inDegree.get(m.name)! + 1);
      const list = dependents.get(dep) ?? [];
      list.push(m.name);
      dependents.set(dep, list);
    }
  }

  // Repeatedly emit the EARLIEST-in-input-order ready (in-degree 0) module, removing it from a
  // shrinking `remaining` list. `findIndex` over `remaining` — which preserves input order — is the
  // stable tie-break: it always picks the lowest input index among the ready set. O(V^2) scans for V
  // modules — V is the module count (≤ a dozen), so this is negligible. A scan that finds nothing
  // ready while modules remain means the graph has a cycle: those `remaining` modules are exactly the
  // ones that could not be ordered.
  const ordered: WaitronModule[] = [];
  const remaining = modules.slice();
  for (;;) {
    const idx = remaining.findIndex((m) => inDegree.get(m.name) === 0);
    if (idx === -1) break;
    const [next] = remaining.splice(idx, 1);
    ordered.push(next);
    for (const d of dependents.get(next.name) ?? []) {
      // `d` is a requiring module's name, so it is always a seeded inDegree key.
      inDegree.set(d, inDegree.get(d)! - 1);
    }
  }

  if (remaining.length > 0) {
    throw new AppError("module.dependency_cycle", { modules: remaining.map((m) => m.name) });
  }

  return ordered.map((m) => m.migrations);
}

/** `../<pkg>/drizzle` — the shape every descriptor's `migrations.from` has (spec §4). */
const MIGRATIONS_FROM = /^\.\.\/([^/]+)\/drizzle$/;

/**
 * The `packages/<dir>` a module's package lives in, derived from `migrations.from`. The one place
 * that PARSES that string to recover the package directory — the root guards (english-only,
 * module-graph-honesty) map descriptors to package dirs through it; `@waitron/migrations`'s
 * `resolveMigrationsFolder` resolves the same string as an opaque path. Throws on any other shape —
 * a derivation that silently skipped would exempt nothing and scan nothing.
 */
export function packageDirOf(module: WaitronModule): string {
  const match = MIGRATIONS_FROM.exec(module.migrations.from);
  if (match === null) {
    throw new Error(
      `module ${module.name}: migrations.from (${module.migrations.from}) is not ../<pkg>/drizzle`,
    );
  }
  return match[1]!;
}
