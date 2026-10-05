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
  /** Seats a party at a free table: opens its party record, its first table and its tab. */
  seatTable(
    tx: Transaction,
    req: { tableId: string; guestCount: number | null; operatorId: string },
  ): Promise<{ tabId: string; partyId: string }>;
}

/**
 * `nodeId` is read only inside `core.seatTable`, which boot binds, so it never enters `cfg`. The
 * tab it opens records the `dashboard` as its origin.
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
  readonly menuName: string;
  /** Each path of section ids from the menu's root to a list holding the product; `[]` is the top
   * level. */
  readonly placements: readonly (readonly string[])[];
  /** The product's staff-facing name (`products.name`) — plain text, not per-language. */
  readonly name: string;
  /** The product's customer-facing text, locale -> text; `null` or blank falls back to `name`. */
  readonly customerName: Readonly<Record<string, string>> | null;
  readonly kitchenName: string | null;
  /** Who may order the product on its own, as the live version published it. A version published
   * before the setting existed carries none. */
  readonly ordering?: "public" | "staff_only" | "not_sold_separately";
  readonly unit: {
    readonly id: string;
    readonly name: Readonly<Record<string, string>>;
    // The printed short form, frozen onto a sold line as its unit label; the offer carries it so the
    // add-time pricing freeze does not re-read the unit.
    readonly abbreviation: Readonly<Record<string, string>>;
    readonly precision: number;
    readonly hardwareUnit: "kg" | "g" | "mg" | null;
  };
  /** The VAT class the live version froze. */
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
   * `menuPrice` override, `available` (Active and Available), and its EFFECTIVE inherited values —
   * its own where set, else its parent's. */
  readonly variants: readonly ZoneMenuOfferVariant[];
  readonly courseId: string | null;
  /** The product is Active and Available now. An unavailable offer is served in its place, marked. */
  readonly available: boolean;
  /** The extras and options lists the published version offers with this dish, in order. */
  readonly offeredModifiers: readonly ZoneOfferedModifier[];
}

/**
 * One list a published offer carries. Every extras item and option label the version holds is
 * present, each marked with whether it can be picked now.
 */
export type ZoneOfferedModifier =
  | {
      readonly kind: "extras";
      readonly id: string;
      readonly name: string;
      readonly customerName: Readonly<Record<string, string>> | null;
      readonly kitchenName: string | null;
      readonly minPicks: number;
      readonly maxPicks: number | null;
      readonly items: readonly {
        readonly productId: string;
        readonly name: string;
        readonly customerName: Readonly<Record<string, string>> | null;
        readonly kitchenName: string | null;
        /** GROSS, as published. */
        readonly price: string;
        readonly portion: string;
        readonly unit: {
          readonly id: string;
          readonly name: Readonly<Record<string, string>>;
          readonly abbreviation: Readonly<Record<string, string>>;
          readonly precision: number;
          readonly hardwareUnit: "kg" | "g" | "mg" | null;
        };
        readonly vatClass: string;
        readonly maxQuantity: number | null;
        readonly preselected: boolean;
        readonly available: boolean;
      }[];
    }
  | {
      readonly kind: "options";
      readonly id: string;
      readonly name: string;
      readonly customerName: Readonly<Record<string, string>> | null;
      readonly kitchenName: string | null;
      readonly defaultLabelId: string | null;
      readonly labels: readonly {
        readonly id: string;
        readonly name: string;
        readonly customerName: Readonly<Record<string, string>> | null;
        readonly kitchenName: string | null;
        readonly available: boolean;
      }[];
    };

/** One entry of a live menu's structure: an offer, or a section holding its own entries in order. */
export type ZoneMenuMember =
  | { readonly kind: "product"; readonly menuItemId: string; readonly productId: string }
  | {
      readonly kind: "section";
      readonly sectionId: string;
      readonly internalName: string;
      /** The customer-facing name, locale -> text. */
      readonly names: Readonly<Record<string, string>>;
      readonly image: string | null;
      readonly color: string | null;
      readonly members: readonly ZoneMenuMember[];
    };

/** A home layout as the live version holds it: its shortcuts, in order. */
export interface ZoneHomeLayout {
  readonly id: string;
  readonly name: string;
  readonly tiles: readonly (
    | { readonly kind: "product"; readonly productId: string }
    | { readonly kind: "section"; readonly sectionId: string }
    | { readonly kind: "empty" }
  )[];
}

/** Why a device shows its menu's default layout rather than its profile's choice. */
export type ZoneLayoutFallback = "layout_removed" | "layout_unpublished";

/** The home layout a device shows for one menu, resolved against the live version. */
export interface ZoneDeviceHomeLayout {
  readonly homeLayoutId: string;
  readonly layoutFallback: ZoneLayoutFallback | null;
}

/**
 * A menu a zone sells from: its live version, whether it is the zone's default, that version's
 * structure and home layouts, and the layout the requesting device shows.
 */
export interface ZoneMenu extends ZoneDeviceHomeLayout {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly versionId: string;
  readonly structure: { readonly members: readonly ZoneMenuMember[] };
  /** The default first. */
  readonly homeLayouts: readonly ZoneHomeLayout[];
  readonly defaultHomeLayoutId: string;
}

/** What a zone sells: its active, published menus' live versions, each offer marked with its
 *  availability. */
export interface ZoneOffers {
  readonly defaultMenuId: string | null;
  readonly menus: readonly ZoneMenu[];
  readonly offers: readonly ZoneMenuOffer[];
}

/** What a zone's live menus hold that cannot be sold now. */
export interface ZoneUnavailable {
  /** Every product or variant that is Inactive or Unavailable, extras items' products included. */
  readonly products: readonly string[];
  /** Every option label that is unavailable, or deleted since the version was published. */
  readonly optionLabels: readonly string[];
}

/** A zone's live menu versions with the layout the device shows for each, and what they hold that
 * cannot be sold now. */
export interface ZoneMenuState {
  readonly menus: readonly ({
    readonly menuId: string;
    readonly versionId: string;
  } & ZoneDeviceHomeLayout)[];
  readonly unavailable: ZoneUnavailable;
}

export interface ZoneMenuOfferVariant {
  readonly id: string;
  readonly name: string;
  readonly customerName: Readonly<Record<string, string>> | null;
  readonly kitchenName: string | null;
  readonly image: string | null;
  readonly unitPrice: string;
  readonly menuPrice: string | null;
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

/** What the rules say for one product at one moment. */
export type MakerOutcome =
  | { readonly kind: "made"; readonly route: PreparationRoute }
  | { readonly kind: "no_replacement"; readonly stationId: string }
  | { readonly kind: "no_station" };

/** Where an extra pick is made, given where its dish is going. */
export type ExtraMakerOutcome =
  | { readonly kind: "made"; readonly stationId: string }
  | {
      readonly kind: "follows_dish";
      /** no_rule: no exception or claim covers it; no_preparation: it needs no preparation;
       *  no_replacement: its station and every fallback are closed; same_station: made with its dish. */
      readonly why: "no_rule" | "no_preparation" | "no_replacement" | "same_station";
    };

/** Rules and venue moment loaded once at `at`. Both questions use that snapshot and the
 *  transaction it was opened on. Use the resolver only inside that transaction. */
export interface MakerResolver {
  readonly at: Date;
  /** Station states from this resolver's rules and moment, including switched-off stations. */
  stations(): Promise<
    ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>
  >;
  /** Answers for an order in `zoneId` (null: no service zone). An unknown zone throws
   *  `service_zone.not_found` before an unknown product throws `route.subject_not_found`.
   *  Keys preserve the first caller spelling of each product id. */
  makers(
    zoneId: string | null,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, MakerOutcome>>;
  /** Answers by pick key. `dishStationId` is the dish's final station, null for no preparation.
   *  Unknown zones and products are refused as in `makers`. An empty list reads nothing. */
  extraMakers(
    zoneId: string | null,
    extras: readonly { key: string; productId: string; dishStationId: string | null }[],
  ): Promise<ReadonlyMap<string, ExtraMakerOutcome>>;
}

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
  /** Where each product is made, for an order in `zoneId` (null: an order with no service zone).
   *  An unknown product throws `route.subject_not_found`; an unknown zone `service_zone.not_found`.
   *  Keys are the caller's spelling of each id (the first, when two spellings name one product). */
  resolveMakers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string | null,
    productIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, MakerOutcome>>;
  /** Loads one venue moment and one rules snapshot; each question reads only its products' facts. */
  routingAt(tx: Transaction, cfg: { locationId: LocationId }, at: Date): Promise<MakerResolver>;
  /** Opens a routing snapshot and answers its extra question. */
  resolveExtraMakers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string | null,
    extras: readonly { key: string; productId: string; dishStationId: string | null }[],
    at: Date,
  ): Promise<ReadonlyMap<string, ExtraMakerOutcome>>;
  /** Every station's state at one instant, including stations switched off. */
  stationStates(
    tx: Transaction,
    cfg: { locationId: LocationId },
    at: Date,
  ): Promise<
    ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>
  >;
  /** Base maker for active products and variants, plus whether a zone-specific exception matches. */
  describeMakers(
    tx: Transaction,
    cfg: { locationId: LocationId },
  ): Promise<
    ReadonlyMap<
      string,
      {
        route: PreparationRoute | null;
        variesByZone: boolean;
        noReplacement: boolean;
        unavailableStationId: string | null;
      }
    >
  >;
  /** Refused `menu.version_changed` unless every `asserted` version is the live version of one of
   *  the zone's active menus. With `menuItemIds`, only the offers it names are served. Each menu's home
   *  layout is the one `deviceProfileId` chose for it when the menu's live version holds it, and
   *  the menu's default otherwise. */
  listZoneOffers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    options?: {
      asserted?: readonly { menuId: string; versionId: string }[];
      menuItemIds?: readonly string[];
      deviceProfileId?: string | null;
    },
  ): Promise<ZoneOffers>;
  /** Does not check the zone: an unknown one holds nothing. Each menu's home layout is the one
   *  `deviceProfileId` chose for it when the menu's live version holds it, and the menu's default
   *  otherwise. */
  menuState(
    tx: Transaction,
    zoneId: string,
    options?: { deviceProfileId?: string | null },
  ): Promise<ZoneMenuState>;
  resolveNewOrderZone(
    tx: Transaction,
    cfg: { locationId: LocationId },
    input: { zoneId?: string | null; deviceId?: string | null },
  ): Promise<OrderServiceContext>;
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
  /** Each named order's frozen service mode in one read; an order with no context is absent. */
  findOrderModes(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, ServiceMode>>;
  /** Each named order's recorded service zone in one read; an order with no context is absent. */
  findOrderZones(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  listLineContexts(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
  ): Promise<
    readonly {
      workingOrderLineId: string;
      menuItemId: string;
      menuId: string;
      menuVersionId: string | null;
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
  /** Each line's offer is looked up in `offers`, the zone's offers the lines were priced from; one
   *  it does not hold is refused `service_zone.offer_not_allowed`. */
  recordLineContexts(
    tx: Transaction,
    cfg: { locationId: LocationId },
    workingOrderId: string,
    lines: readonly {
      workingOrderLineId: string;
      menuItemId: string;
      unit?: {
        id: string;
        name: Record<string, string>;
        precision: number;
        hardwareUnit: "kg" | "g" | "mg" | null;
      };
    }[],
    offers: ZoneOffers,
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
  /** Which of the lines were sold in Each: by the unit id their context froze, and for a stored
   *  unit by that unit's current seed key; a line with no context is not. */
  readLinesSoldInEach(tx: Transaction, lineIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Records one kitchen notice per item, copying each line's kitchen name, unit, note and whether
   *  it was sold in Each as they stand now, so a caller removing a line records its notices first.
   *  `direction` and `cancelledExtra` (the extra taken off the dish) are for a `changed` notice
   *  only. `reroutedTo` names the new station on a `rerouted` notice only. */
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
    kind: "recalled" | "void" | "changed" | "moved" | "rerouted",
    movedTo?: string | null,
    direction?: "added" | "removed" | null,
    cancelledExtra?: string | null,
    reroutedTo?: string | null,
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
      kind: "recalled" | "void" | "changed" | "moved" | "rerouted";
      lineName: string;
      unitName: Record<string, string> | null;
      soldInEach: boolean;
      quantity: Decimal;
      note: string | null;
      wasStarted: boolean;
      movedTo: string | null;
      direction: "added" | "removed" | null;
      cancelledExtra: string | null;
      reroutedTo: string | null;
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
  /** Whether Finish table leaves the party's tables needing clearing. */
  readClearingWorkflow(tx: Transaction): Promise<boolean>;
  /** How identical dishes print on a kitchen ticket: one `N x` entry, or N entries of one. */
  readKitchenTicketGrouping(tx: Transaction): Promise<"combined" | "separate">;
  /** Whether held groups print in advance, marked HOLD. */
  readPrintHeldWork(tx: Transaction): Promise<boolean>;
  /** Minutes after the work ahead is served that a held group is due to be released; null is off. */
  readReleaseReminderMinutes(tx: Transaction): Promise<number | null>;
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
      /** Runs in the import's transaction after every module's rows are inserted, each module's in
       * module order, to set what the module derives from those rows rather than letting a bundle
       * carry it. */
      readonly afterImport?: (tx: Transaction) => Promise<void>;
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
