import semver from "semver";
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import type { Decimal, LocationId } from "@waitron/shared";
import type { ChangeSource } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type { Logger } from "@waitron/server-kit";
import type { MigrationSet, MigrationSetSource } from "@waitron/migrations";
import { appendOnlyTablesIn, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleProvisioning } from "./provisioning.js";
import type { RestoreHook } from "./restore.js";
import type { ModuleAlerts } from "./alerts.js";
import "./errors.js";

/**
 * The core verbs a module's routes need but cannot import — a module never depends on `apps/server`.
 * Boot implements it with the venue's config bound in, so a verb never takes the config.
 */
export interface CoreServices {
  openTab(
    tx: Transaction,
    req: { tableId: string },
  ): Promise<{ tabId: string; orderNumber: number }>;
}

/**
 * `nodeId`/`tillId` are read only inside `core.openTab`, which boot binds, so they never enter
 * `cfg`.
 */
export interface ModuleRouteContext {
  db: Database;
  cfg: { locationId: LocationId; contentDefaultLanguage?: string };
  maxUploadBytes?: number;
  core: CoreServices;
}

/** Boot mounts every ENABLED module's routes in one generic loop; a disabled module mounts nothing. */
export interface ModuleRoutes {
  mount(app: Hono, ctx: ModuleRouteContext, log: Logger): void;
}

/**
 * The person roles, lowest-to-highest on identity's ladder. Declared here because this contract
 * package must not depend on identity; `@waitron/composition`'s `role-parity.ts` fails to compile if
 * it diverges from identity's `PersonRoleValue`.
 */
export type ModuleRole = "staff" | "supervisor" | "manager" | "admin";

/**
 * A permission a module contributes, and the LOWEST role that holds it; identity grants it to that
 * role and every role above it, so the ladder stays identity's.
 */
export type ModulePermission = { readonly permission: string; readonly grantedFrom: ModuleRole };

/**
 * Each floor table's next reservation time. The returned Map carries one entry PER input `tableId`
 * (`reservedTime` null when the table has no imminent reservation); `reservedTime` is venue-local
 * `HH:MM`, already normalised by the annotator.
 */
export interface FloorAnnotator {
  annotate(
    tx: Transaction,
    cfg: { locationId: LocationId },
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
  /** The STORED menu price, null when the menu sets none; `unitPrice` is the one charged. */
  readonly grossPrice: string | null;
  /** The price this offer charges, resolved along the catalogue's menu price chain. */
  readonly unitPrice: string;
  readonly active: boolean;
  readonly menuName: string;
  /** Each path of section ids from the menu's root to a list holding the product; `[]` is the top
   * level. */
  readonly placements: readonly (readonly string[])[];
  /** The product's staff-facing name (`products.name`) — plain text, not per-language. */
  readonly name: string;
  /** The product's customer-facing text, locale -> text; `null` or blank falls back to `name`. */
  readonly customerName: Readonly<Record<string, string>> | null;
  readonly kitchenName: string | null;
  readonly unit: {
    readonly id: string;
    readonly name: Readonly<Record<string, string>>;
    // The printed short form, frozen onto a sold line as its unit label; the offer carries it so the
    // add-time pricing freeze does not re-read the unit.
    readonly abbreviation: Readonly<Record<string, string>>;
    readonly precision: number;
    readonly hardwareUnit: "kg" | "g" | "mg" | null;
  };
  readonly vatClass: string;
  readonly category: string | null;
  readonly allergens: Readonly<
    Record<string, { readonly presence: "contains" | "may_contain"; readonly source?: string }>
  > | null;
  readonly diet: unknown;
  readonly dietDerivation: unknown;
  readonly dietOverride: unknown;
  readonly dietaryDeclarations: readonly string[];
  /** The product's Active variants, each with its RESOLVED `unitPrice`, this menu's stored
   * `menuPrice` override, `available` (Active, Available and offered on this menu), and its
   * EFFECTIVE inherited values — its own where set, else its parent's. */
  readonly variants: readonly ZoneMenuOfferVariant[];
  readonly courseId: string | null;
}

export interface ZoneMenuOfferVariant {
  readonly id: string;
  readonly name: string;
  readonly customerName: Readonly<Record<string, string>> | null;
  readonly kitchenName: string | null;
  readonly image: string | null;
  readonly unitPrice: string;
  readonly menuPrice: string | null;
  readonly offered: boolean;
  readonly available: boolean;
  readonly unit: ZoneMenuOffer["unit"];
  readonly pricingUnit: string;
  readonly vatClass: string;
  readonly category: string | null;
  readonly courseId: string | null;
  readonly allergens: ZoneMenuOffer["allergens"];
  readonly diet: unknown;
  readonly dietDerivation: unknown;
  readonly dietOverride: unknown;
  readonly dietaryDeclarations: readonly string[];
}

export type PreparationRoute =
  { readonly kind: "station"; readonly stationId: string } | { readonly kind: "no_preparation" };

/** Venue-service decisions consumed by generic ordering code inside its existing transaction. */
export interface VenueServiceContribution {
  listServiceZones(
    tx: Transaction,
    cfg: { locationId: LocationId },
  ): Promise<readonly ServiceZoneSummary[]>;
  resolveZoneContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
  ): Promise<OrderServiceContext>;
  /** Resolves every product in one batch. An unknown zone throws `service_zone.not_found` before any
   *  product error; otherwise throws the first failing product's coded error in input order. Keys are
   *  the caller's spelling of each id (the first, when two spellings name one product). An empty list
   *  returns an empty map without querying. */
  resolvePreparationRoutes(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, PreparationRoute>>;
  listZoneOffers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
  ): Promise<{
    defaultMenuId: string | null;
    menus: readonly { id: string; name: string; isDefault: boolean }[];
    offers: readonly ZoneMenuOffer[];
  }>;
  resolveNewOrderZone(
    tx: Transaction,
    cfg: { locationId: LocationId },
    input: { zoneId?: string | null; deviceId?: string | null },
  ): Promise<OrderServiceContext>;
  resolveZoneOffer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    menuItemId: string,
  ): Promise<ZoneMenuOffer>;
  recordOrderContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
    zoneId: string,
  ): Promise<void>;
  retargetOrderContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
    zoneId: string,
  ): Promise<void>;
  getOrderContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
  ): Promise<OrderServiceContext>;
  findOrderContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
  ): Promise<OrderServiceContext | null>;
  listLineContexts(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
  ): Promise<
    readonly {
      workingOrderLineId: string;
      menuItemId: string;
      menuId: string;
      menuName: string;
      categoryName: string;
      unitId: string;
      unitName: Readonly<Record<string, string>>;
      unitPrecision: number;
      hardwareUnit: "kg" | "g" | "mg" | null;
      vatClass: string;
      allergens: ZoneMenuOffer["allergens"];
      diet: unknown;
      dietDerivation: unknown;
      dietOverride: unknown;
    }[]
  >;
  recordLineContexts(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
    lines: readonly { workingOrderLineId: string; menuItemId: string }[],
  ): Promise<void>;
  copyOrderContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    fromWorkingOrderId: string,
    toWorkingOrderId: string,
  ): Promise<void>;
  copyLineContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    fromWorkingOrderLineId: string,
    toWorkingOrderLineId: string,
  ): Promise<void>;
  /** Records one kitchen notice per item, copying each line's kitchen name and note as they stand
   *  now, so a caller removing a line records its notices first. */
  recordKitchenNotices(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
    items: readonly {
      workingOrderLineId: string;
      stationId: string;
      quantity: Decimal;
      wasStarted: boolean;
    }[],
    kind: "recalled" | "void" | "changed",
  ): Promise<void>;
  /** A station's unacknowledged notices, oldest first: the newest fifty of the business day. */
  listStationNotices(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationId: string,
  ): Promise<
    {
      id: string;
      stationId: string;
      workingOrderId: string;
      orderLabel: string;
      kind: "recalled" | "void" | "changed";
      lineName: string;
      quantity: Decimal;
      note: string | null;
      wasStarted: boolean;
      createdAt: string;
    }[]
  >;
  /** Clears one notice; with `stationId`, only one at that station. */
  acknowledgeKitchenNotice(
    tx: Transaction,
    cfg: { locationId: LocationId },
    id: string,
    scope?: { stationId?: string },
  ): Promise<void>;
  /** Whether staff may change an item already sent to the kitchen. */
  readEditSentLines(tx: Transaction): Promise<boolean>;
}

/** A reference to non-DB state a module owns, resolved to a path by the composition root. */
export type NonDbSource = { readonly kind: "content-addressed-dir"; readonly source: string };

/** A module's backup contribution: the non-DB state it owns, and what it does after a restore. */
export interface ModuleBackupContribution {
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: RestoreHook;
}

/** One table whose rows may cross from preparation into a fresh production database. */
export interface ConfigurationTransferTable {
  readonly name: string;
  /** Insert these rows before the named tables when a module adds a reference to its data. */
  readonly before?: readonly string[];
  readonly omit?: readonly string[];
  readonly locationColumns?: readonly string[];
  readonly reconnect?: boolean;
}

/** Every module declares either its transferable configuration or that it has none. */
export type ModuleConfigurationTransfer =
  | { readonly kind: "none" }
  | {
      readonly kind: "tables";
      readonly tables: readonly ConfigurationTransferTable[];
      readonly validate?: (
        tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
      ) => void;
    };

/**
 * A module descriptor: a plain object listed in `@waitron/composition`'s `ALL_MODULES` — no global
 * registry, no `register()` side effect. Each owning package exports the values its seats carry,
 * never the descriptor itself.
 */
export interface WaitronModule {
  /** Stable id; equals the migration-set name (`migrations.name`). NOT the drizzle table suffix —
   * that is `migrations.table`, usually `__drizzle_migrations_<name>` but not always (e.g. the `core`
   * set's table is `__drizzle_migrations_db`). */
  readonly name: string;
  readonly version: string;
  /** Migration sets this one depends on, with semver ranges; `orderedMigrationSets` orders by them. */
  readonly requires?: {
    readonly core?: string;
    readonly modules?: Readonly<Record<string, string>>;
  };
  readonly tier: "mandatory" | "provision-only" | "toggleable";
  /** The SOURCE half only: append-only table names come from `classification`, and
   * `orderedMigrationSets` joins the two into a `MigrationSet`. */
  readonly migrations: MigrationSetSource;

  /** Every table this module's migrations create, classified `ledger`/`state`/`local` (meanings on
   * `TableClass`, `@waitron/sync-enrolment`). No foreign key may join a `local` table to a
   * `ledger`/`state` one: `scripts/two-file-foreign-keys.test.ts`. */
  readonly classification?: readonly ClassifiedTable[];
  readonly changes?: readonly ChangeSource[];
  readonly cards?: unknown;
  /** The domain terms this module OWNS — allowed in its own package (`packageDirOf`), forbidden in
   * every generic package. Tokens, not words: lowercase ASCII, unaccented, singular and plural
   * separately, nothing stemmed. Read only by the root english-only suite. Omit the seat rather than
   * declare `[]`. */
  readonly vocabulary?: readonly string[];
  /** Folded into identity's ladder once at boot (`registerModulePermissions`), before route auth. */
  readonly permissions?: readonly ModulePermission[];
  readonly duties?: unknown; // cronjobs
  readonly theme?: unknown;
  /** What this module seeds per node at provisioning, and its part in standing up a standby. */
  readonly provisioning?: ModuleProvisioning;
  /** The module's contribution to the fiscal slot — `fiscalSlot` selects exactly one. */
  readonly fiscal?: FiscalContribution;
  readonly routes?: ModuleRoutes;
  readonly floorAnnotations?: FloorAnnotator;
  readonly venueService?: VenueServiceContribution;
  /** Incident codes this module claims for the dashboard alerts, and its ongoing checks. Claims are
   * read from every module; sources only from enabled modules, since a disabled module's tables are
   * not migrated. */
  readonly alerts?: ModuleAlerts;
  readonly backup?: ModuleBackupContribution;
  readonly configurationTransfer?: ModuleConfigurationTransfer;
  /** Required localized fields contributed to a content-default change check. */
  readonly contentTranslations?: {
    gaps(tx: Transaction, language: string): Promise<{ kind: string; id: string }[]>;
  };
}

/** Each declared dependency as `[dependencyName, semverRange]`; `requires.core` names "core". */
function* requiredEdges(m: WaitronModule): Iterable<readonly [string, string]> {
  if (m.requires?.core !== undefined) yield ["core", m.requires.core];
  for (const [dep, range] of Object.entries(m.requires?.modules ?? {})) yield [dep, range];
}

/**
 * Validate the `requires` graph and return the migration sets in dependency order, input order
 * breaking ties. One entry point validates and orders, so a caller cannot skip the check.
 *
 * Each set's `appendOnlyTables` comes from the `appendOnly()` marker in its `classification`, never
 * from the `ledger` CLASS: some `ledger` tables are updated by product code, and an append-only table
 * may be `state`.
 *
 * Throws `module.requires_invalid`, `module.dependency_missing`, `module.incompatible_version` or
 * `module.dependency_cycle`.
 */
export function orderedMigrationSets(modules: readonly WaitronModule[]): MigrationSet[] {
  const byName = new Map(modules.map((m) => [m.name, m]));

  // A malformed range is a descriptor bug whatever the set, so it is checked first; presence before
  // satisfies, because an absent module has no version to compare.
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

  // Kahn's sort: a module's in-degree is the number of dependencies it still waits on.
  const inDegree = new Map<string, number>(modules.map((m) => [m.name, 0]));
  const dependents = new Map<string, string[]>();
  for (const m of modules) {
    for (const [dep] of requiredEdges(m)) {
      inDegree.set(m.name, inDegree.get(m.name)! + 1);
      const list = dependents.get(dep) ?? [];
      list.push(m.name);
      dependents.set(dep, list);
    }
  }

  // `findIndex` over the input-ordered `remaining` is the tie-break. Nothing ready while modules
  // remain means a cycle, and `remaining` is exactly the modules that could not be ordered.
  const ordered: WaitronModule[] = [];
  const remaining = modules.slice();
  for (;;) {
    const idx = remaining.findIndex((m) => inDegree.get(m.name) === 0);
    if (idx === -1) break;
    const [next] = remaining.splice(idx, 1);
    ordered.push(next);
    for (const d of dependents.get(next.name) ?? []) {
      inDegree.set(d, inDegree.get(d)! - 1);
    }
  }

  if (remaining.length > 0) {
    throw new AppError("module.dependency_cycle", { modules: remaining.map((m) => m.name) });
  }

  // A fresh object per set: the descriptors are shared by every caller.
  return ordered.map((m) => ({
    ...m.migrations,
    appendOnlyTables: appendOnlyTablesIn(m.classification ?? []),
  }));
}

const MIGRATIONS_FROM = /^\.\.\/([^/]+)\/drizzle$/;

/**
 * The `packages/<dir>` a module lives in, parsed from `migrations.from` (`../<pkg>/drizzle`). Throws
 * on any other shape: the root guards map descriptors to directories through it, and a silent skip
 * would exempt nothing and scan nothing.
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
