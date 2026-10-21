import type {
  KitchenAllergyBlock,
  PartyAllergySnapshot,
  TicketAllergyCopy,
} from "./party-allergy.js";
import type { ModuleTimeRecordExport } from "./record-export.js";
import semver from "semver";
import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import type {
  BusinessDayClock,
  DepartmentReceiptConfig,
  DepartmentReceiptPolicy,
  DepartmentReceiptWrite,
  DepartmentReceiptScope,
  ReceiptLogoRaster,
  ReceiptLogoRasters,
  ReceiptPaperWidth,
  Decimal,
  LocationId,
  DeleteImpactRefusal,
  DeleteImpactItem,
} from "@waitron/shared";
import type { ChangeSource } from "@waitron/shared";
import type { AllergenMap, Database, SQL, Transaction } from "@waitron/db";
import type { Logger } from "@waitron/server-kit";
import type { MigrationSet, MigrationSetSource } from "@waitron/migrations";
import { appendOnlyTablesIn, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { FiscalContribution } from "@waitron/fiscal";
import type { ModuleProvisioning } from "./provisioning.js";
import type { ModuleOperationPreparation } from "./operation-preparation.js";
import type { RestoreHook } from "./restore.js";
import type { BackupVerificationContribution } from "./backup-verification.js";
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
  floorDeletion: FloorDeletion;
  floorPlanSets: FloorPlanSets;
}

/** Core's floor plan sets: the layout rows a set holds, made and read for the module that names it. */
export interface FloorPlanSets {
  /** A new empty set of the location (no layout rows); answers its id. */
  create(tx: Transaction): Promise<string>;
  /** Copies every layout row, placement and kept size of `fromSetId` into `toSetId`, each layout at revision 1. */
  copyLayouts(tx: Transaction, fromSetId: string, toSetId: string): Promise<void>;
  /** Each of `zoneIds`' table count, and each asked pair's layout revision and counts in the pairs' order, a missing row as 0/0/all spare. */
  readLayouts(
    tx: Transaction,
    zoneIds: readonly string[],
    pairs: readonly { setId: string; zoneId: string }[],
  ): Promise<{
    tableCounts: ReadonlyMap<string, number>;
    layouts: readonly {
      setId: string;
      zoneId: string;
      revision: number;
      onPlan: number;
      spare: number;
    }[];
  }>;
  /** The zones whose today's record names the set, for the delete dialog's line. */
  zonesShowing(tx: Transaction, setId: string): Promise<string[]>;
}

/**
 * `nodeId` is read only inside `core.seatTable`, which boot binds, so it never enters `cfg`. The
 * tab it opens records the `dashboard` as its origin.
 */
export interface ModuleRouteContext {
  db: Database;
  cfg: {
    locationId: LocationId;
    contentDefaultLanguage?: string;
    operationDescriptionRequired?: boolean;
    operationDescriptionDefault?: string;
  };
  maxUploadBytes?: number;
  renderReceiptLogo?: (bytes: Uint8Array) => Promise<ReceiptLogoRasters>;
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

export interface FloorDeletion {
  readImpact(
    tx: Transaction,
    zoneIds: readonly string[],
    now: Date,
  ): Promise<{ refusals: DeleteImpactRefusal[]; removes: DeleteImpactItem[] }>;
  clear(tx: Transaction, zoneIds: readonly string[], now: Date): Promise<void>;
  /**
   * Deletes the sets' placements, sizes, layouts and rows; a today's record naming one keeps its
   * today's rows and loses its set. The caller first removes the department links and the
   * periods' references to the sets, which name them by plain foreign keys.
   */
  removeSets(tx: Transaction, setIds: readonly string[]): Promise<void>;
}

/** A module's part in removing a live table. */
export interface TableRemoval {
  deleteRefusals?(
    tx: Transaction,
    cfg: { locationId: LocationId },
    tableIds: readonly string[],
    now: Date,
  ): Promise<readonly DeleteImpactRefusal[]>;
  /**
   * The refusal for each of `tableIds` this module still needs; a table it lets go of has no entry.
   * A throw is not a refusal: it fails the caller, the till's floor read included.
   */
  refuse(
    tx: Transaction,
    cfg: { locationId: LocationId },
    tableIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, AppError>>;
  /** Lets go of every row naming the table, keeping `label` as text where history needs it. */
  release(
    tx: Transaction,
    cfg: { locationId: LocationId },
    tableId: string,
    label: string,
  ): Promise<void>;
}

export type ServiceMode = "table_tab" | "prepay" | "ticket_then_pay";

export interface OrderServiceContext {
  readonly zoneId: string;
  readonly departmentId: string;
  readonly serviceMode: ServiceMode;
}

export interface EffectiveSalePolicy {
  readonly orderStart: "table" | "counter";
  readonly zoneId: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly tradingName: string;
  readonly paidWhen: "prepay" | "ticket_then_pay";
  readonly collectionNumber: "none" | "numbered";
  readonly receiptPrintMode: "auto" | "on_request";
  readonly printTradingName: boolean;
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
    readonly staffName: string;
    readonly staffAbbreviation: string;
    readonly name: Readonly<Record<string, string>>;
    // The printed short form, frozen onto a sold line as its unit label; the offer carries it so the
    // add-time pricing freeze does not re-read the unit.
    readonly abbreviation: Readonly<Record<string, string>>;
    readonly precision: number;
    readonly hardwareUnit: "kg" | "g" | "mg" | null;
    /** Present only on a unit that measures an amount (ml, g…); a dish sold in one takes no extras. */
    readonly measure?: true;
  };
  /** The VAT class the live version froze. */
  readonly vatClass: string;
  readonly category: string | null;
  readonly allergens: Readonly<AllergenMap> | null;
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
        readonly presentation: {
          readonly name: string;
          readonly customerName: Readonly<Record<string, string>> | null;
          readonly kitchenName: string | null;
          readonly variantName: string | null;
          readonly variantCustomerName: Readonly<Record<string, string>> | null;
          readonly variantKitchenName: string | null;
        };
        readonly name: string;
        readonly customerName: Readonly<Record<string, string>> | null;
        readonly kitchenName: string | null;
        /** GROSS, as published. */
        readonly price: string;
        readonly portion: string;
        readonly unit: {
          readonly id: string;
          readonly staffName: string;
          readonly staffAbbreviation: string;
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
      /** Its members are drawn in its place; a shortcut to it still opens it. */
      readonly direct?: true;
      readonly internalName: string;
      /** The customer-facing name, locale -> text. */
      readonly names: Readonly<Record<string, string>>;
      readonly image: string | null;
      readonly color: string | null;
      readonly members: readonly ZoneMenuMember[];
    };

/** How one kind of device presents a menu's Device Home Page. */
export interface ZoneHomeDisplay {
  readonly columns: number;
  readonly tiles: "colours" | "thumbnails";
  readonly order: "home_first" | "menu_first";
}

/** A Device Home Page as the live version holds it: its shortcuts in order, and each device's
 * display settings. */
export interface ZoneDeviceHome {
  readonly shortcuts: readonly (
    | { readonly kind: "product"; readonly productId: string }
    | { readonly kind: "section"; readonly sectionId: string }
    | { readonly kind: "empty" }
  )[];
  readonly handheld: ZoneHomeDisplay;
  readonly till: ZoneHomeDisplay;
}

/**
 * A menu a zone sells from: its live version, whether it is the zone's default, and that version's
 * structure and Device Home Page.
 */
export interface ZoneMenu {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly orderable: boolean;
  readonly sendable: boolean;
  readonly audience: "customer" | "staff";
  readonly versionId: string;
  readonly structure: { readonly members: readonly ZoneMenuMember[] };
  readonly home: ZoneDeviceHome;
}

/** What a zone sells: its active, published menus' live versions, each offer marked with its
 *  availability. */
export interface ZoneOffers {
  readonly service: ZoneMenuState["service"];
  readonly defaultMenuId: string | null;
  readonly menus: readonly ZoneMenu[];
  readonly offers: readonly ZoneMenuOffer[];
  /** Digest of the course and reporting category of the menus' dishes, variants and extras;
   *  moves when either changes, which no menu version records. A read limited by `menuItemIds`
   *  digests only those offers' rows and is not comparable with `ZoneMenuState.liveFields`. */
  readonly liveFields: string;
}

/** What a zone's live menus hold that cannot be sold now. */
export interface ZoneUnavailable {
  /** Every product or variant that is Inactive or Unavailable, extras items' products included. */
  readonly products: readonly string[];
  /** Every option label that is unavailable, or deleted since the version was published. */
  readonly optionLabels: readonly string[];
}

/** A zone's live menu versions, and what they hold that cannot be sold now. */
export interface ZoneMenuState {
  readonly service: {
    readonly open: boolean;
    readonly zoneOpen: boolean;
    readonly periodName: string | null;
    readonly periodOccurrenceKey: string | null;
    readonly zoneKeepOpen: {
      readonly zoneId: string;
      readonly zoneName: string;
      readonly closesAt: string;
      readonly running: boolean;
      readonly extendedUntil: string | null;
    } | null;
    readonly keepOpen: {
      readonly periodId: string;
      readonly periodName: string;
      readonly endsAt: string;
      readonly running: boolean;
      readonly extendedUntil: string | null;
    } | null;
  };
  readonly menus: readonly {
    readonly menuId: string;
    readonly versionId: string;
    readonly orderable: boolean;
    readonly sendable: boolean;
  }[];
  readonly unavailable: ZoneUnavailable;
  /** Digest of the course and reporting category of the menus' dishes, variants and extras;
   *  moves when either changes, which no menu version records. */
  readonly liveFields: string;
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
      /** no_rule: no saved routing cell covers it; no_preparation: it needs no preparation;
       *  no_replacement: its station and every fallback are closed; same_station: made with its dish. */
      readonly why: "no_rule" | "no_preparation" | "no_replacement" | "same_station";
    };

export interface KeepOpenSubject {
  id: string;
  name: string;
  endsAt: string;
  running: boolean;
  extendedUntil: string | null;
  dayEndsAt: string;
  choices: readonly string[];
  next: { name: string; startsAt: string; endsAt: string } | null;
}

export interface StationTodayState {
  readonly open: boolean;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly name: string;
  readonly byHand: "open" | "closed" | null;
  readonly sendsTo: string | null;
  readonly why: "default" | "open" | "closed_by_hand" | "switched_off";
}

/** Rules and venue moment loaded once at `at`. Both questions use that snapshot and the
 *  transaction it was opened on. Use the resolver only inside that transaction. */
export interface MakerResolver {
  readonly at: Date;
  /** Station states from this resolver's rules and moment, including switched-off stations. */
  stations(): Promise<ReadonlyMap<string, StationTodayState>>;
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

export interface DepartmentTransfer {
  currentDepartmentId?: string;
  id: string;
  tabId: string;
  sourceDepartmentId: string;
  destinationDepartmentId: string;
  senderId: string;
  resolvedBy: string | null;
  destinationZoneId: string | null;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  revision: number;
  summary?: {
    orderNumber: number;
    tabLabel: string | null;
    tableLabel?: string;
    sourceDepartmentName: string;
    destinationDepartmentName: string;
  };
}

export interface DepartmentTransferActor {
  departmentId: string;
  personId: string;
}

export interface DepartmentTransferReceiver extends DepartmentTransferActor {
  profileId: string;
}

export interface DeviceZoneSelection {
  profileId: string;
  snapshot: string;
  zones: readonly {
    id: string;
    name: string;
    serviceMode: ServiceMode;
    departmentId: string;
    departmentName: string;
  }[];
  selectedZoneIds: readonly string[];
  startingZoneId: string | null;
  adjusted: boolean;
}

export interface DeviceZoneSelectionInput {
  profileId: string;
  snapshot: string;
  selectedZoneIds: readonly string[];
  startingZoneId: string;
}

export type KitchenScreenKind = "station" | "pass" | "pass_monitor";

/**
 * null stationIds = every station; null zoneIds = every zone. A station screen never filters by
 * zone: it is stored with every_zone 0 and no zone rows, and read back with zoneIds null. On a
 * device, "every" means every one its profile allows less its recorded removals.
 */
export interface KitchenScreenScope {
  readonly stationIds: readonly string[] | null;
  readonly zoneIds: readonly string[] | null;
}

export type ProfileKitchenScreens = Readonly<
  Partial<Record<KitchenScreenKind, KitchenScreenScope>>
>;

export interface DeviceKitchenScreen extends KitchenScreenScope {
  readonly kind: KitchenScreenKind;
}

export interface Named {
  readonly id: string;
  readonly name: string;
}

/** A device a profile save narrowed, and what it lost. */
export interface NarrowedDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly lost: {
    readonly screens: readonly KitchenScreenKind[];
    readonly stations: readonly Named[];
    readonly zones: readonly Named[];
  };
}

/** One station or zone of a device's kitchen screen: shown, or no longer available. */
export interface ScreenSlot {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  /** The stored active flag is false, rather than a recorded profile removal. */
  readonly switchedOff: boolean;
}

export interface ResolvedKitchenScreen {
  readonly kind: KitchenScreenKind;
  /** False when a profile narrowing took this kind from the device. */
  readonly available: boolean;
  /** The device's own station list is "every" (`stationIds` null). False on a kind it holds no
   *  choice of, as when a narrowing took the kind or emptied its list. */
  readonly everyStation: boolean;
  /** As `everyStation`, for zones; a station screen's is true, since it never filters by zone. */
  readonly everyZone: boolean;
  /** The profile's station list for this kind is "every", or it has no row for it. False on a
   *  kind the device holds no choice of. */
  readonly profileEveryStation: boolean;
  /** Display order; unavailable when a narrowing took it or it is switched off. */
  readonly stations: readonly ScreenSlot[];
  /** null: no zone filter; otherwise zone order. */
  readonly zones: readonly ScreenSlot[] | null;
}

export type KitchenNoteScope = { workingOrderId: string } | { partyId: string };
export interface KitchenNote {
  note: string | null;
  revision: number;
}
export type KitchenNoteSnapshot = KitchenNote & { scope: KitchenNoteScope; ownerRevision: number };
export interface KitchenNoteChange {
  before: string | null;
  after: string | null;
}

export interface StationNotice {
  orderNoteChange?: KitchenNoteChange;
  allergyBlock?: KitchenAllergyBlock | null;
  id: string;
  stationId: string;
  workingOrderId: string;
  orderLabel: string;
  kind:
    "recalled" | "void" | "changed" | "moved" | "rerouted" | "allergy_changed" | "allergy_removed";
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
}

export interface BusinessDayClockConflict {
  departmentId: string;
  departmentName?: string;
  zoneName?: string;
  periodName?: string;
  startsAt?: string;
  endsAt?: string;
  zoneId?: string;
  weekday?: number;
  seasonId?: string;
  seasonName?: string;
  specialDayId?: string;
  specialDayName?: string;
  date?: string;
  periodId?: string;
  rangeIndex: number;
  reason:
    | "range"
    | "overlap"
    | "endpoint_day"
    | "all_day"
    | "sending_cutoff"
    | "transition_strip"
    | "kept_open";
}

export interface FloorPlanSetSummary {
  setId: string;
  departmentId: string;
  name: string;
  isDefault: boolean;
  /** The department's zones, in display order. */
  zoneIds: readonly string[];
}

export interface DueFloorLayout {
  setId: string | null;
  setName: string | null;
  /** The due run's occurrence key; null on a day with no period, or when the clock names no day. */
  occurrence: string | null;
  /** The due run's period name; null with no occurrence. */
  periodName: string | null;
}

export interface ZoneFloorLayout {
  due: DueFloorLayout;
  /** Whether the zone's department has a set. */
  planned: boolean;
  /** The name of the set `recordedSetId` names; null with none, or when that set is gone. */
  recordedSetName: string | null;
}

declare const preparedServiceDay: unique symbol;
/** The venue clock and the plan of the business day one instant falls in, read once by
 *  `readServiceDay` for the reads that take it; a read for another business day reuses only the
 *  clock. Only venue-service reads what it holds. */
export interface PreparedServiceDay {
  /** Null when the clock names no business day at that instant. */
  readonly businessDay: string | null;
  readonly [preparedServiceDay]: true;
}

/** Venue-service decisions consumed by generic ordering code inside its existing transaction. */
export interface VenueServiceContribution {
  readServiceDay(
    tx: Transaction,
    cfg: { locationId: LocationId },
    at: Date,
  ): Promise<PreparedServiceDay>;
  /** One entry per zone named; each department's day is read once. */
  dueFloorLayouts(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zones: readonly {
      zoneId: string;
      recordedOccurrence: string | null;
      recordedSetId?: string | null;
    }[],
    at: Date,
    prepared?: PreparedServiceDay,
  ): Promise<ReadonlyMap<string, ZoneFloorLayout>>;
  readFloorPlanSets(
    tx: Transaction,
    cfg: { locationId: LocationId },
    filter?: { setIds?: readonly string[]; departmentId?: string },
  ): Promise<readonly FloorPlanSetSummary[]>;
  assertBusinessDayClockChange(
    tx: Transaction,
    cfg: { locationId: LocationId },
    before: BusinessDayClock,
    candidate: BusinessDayClock,
    effectiveBusinessDay: string,
  ): Promise<void>;
  assertBusinessDayScheduleWrite(
    tx: Transaction,
    cfg: { locationId: LocationId },
    changeKind: "time" | "metadata",
    expectedClockRevision: number,
  ): Promise<void>;
  listDepartmentTransferDestinations(
    tx: Transaction,
    cfg: { locationId: LocationId },
    sender: DepartmentTransferActor,
  ): Promise<{ id: string; name: string }[]>;
  listIncomingDepartmentTransfers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    receiver: DepartmentTransferReceiver,
  ): Promise<DepartmentTransfer[] | null>;
  readIncomingDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    requestId: string,
    receiver: DepartmentTransferReceiver,
  ): Promise<DepartmentTransfer>;
  listDepartmentSentTransfers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    sender: DepartmentTransferActor,
  ): Promise<DepartmentTransfer[]>;
  listSentDepartmentTransfers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    tabId: string,
    sender: DepartmentTransferActor,
  ): Promise<DepartmentTransfer[]>;
  requestDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    tabId: string,
    destinationDepartmentId: string,
    sender: DepartmentTransferActor,
  ): Promise<DepartmentTransfer>;
  readDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    requestId: string,
    sender: DepartmentTransferActor,
  ): Promise<DepartmentTransfer>;
  withdrawPendingDepartmentTransfers(tx: Transaction, tabIds: readonly string[]): Promise<void>;
  withdrawDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    requestId: string,
    sender: DepartmentTransferActor,
  ): Promise<DepartmentTransfer>;
  acceptDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    requestId: string,
    receiver: DepartmentTransferReceiver,
    input: { tabRevision: number; zoneId: string; tableId: string | null },
  ): Promise<DepartmentTransfer>;
  declineDepartmentTransfer(
    tx: Transaction,
    cfg: { locationId: LocationId },
    requestId: string,
    receiver: DepartmentTransferReceiver,
    reason: string,
  ): Promise<DepartmentTransfer>;
  listServiceZones(
    tx: Transaction,
    cfg: { locationId: LocationId },
  ): Promise<readonly ServiceZoneSummary[]>;
  resolveZoneContext(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
  ): Promise<OrderServiceContext>;
  closedZoneIdsAt(
    tx: Transaction,
    cfg: { locationId: LocationId },
    at: Date,
    zoneIds?: readonly string[],
  ): Promise<ReadonlySet<string>>;
  assertZoneTakesNewOrders(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    at: Date,
  ): Promise<void>;
  resolveDepartmentService(
    tx: Transaction,
    cfg: { locationId: LocationId },
    departmentId: string,
    at: Date,
  ): Promise<{
    departmentId: string;
    orderableMenuIds: readonly string[];
    endedMenuIds: readonly string[];
  }>;
  readKeepOpen(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    at: Date,
  ): Promise<{ period: KeepOpenSubject | null; zone: KeepOpenSubject | null }>;
  readZoneKeepOpenState(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    at: Date,
  ): Promise<ZoneOffers["service"]["zoneKeepOpen"]>;
  /** One entry per zone named, read together: whether it is closed at `at`, and its floor
   *  closing summary. */
  readZoneClosingStates(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneIds: readonly string[],
    at: Date,
    prepared?: PreparedServiceDay,
  ): Promise<
    ReadonlyMap<
      string,
      { readonly closed: boolean; readonly keepOpen: ZoneOffers["service"]["zoneKeepOpen"] }
    >
  >;
  keepZoneOpen(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    input: { until: string | null },
    at: Date,
  ): Promise<void>;
  keepPeriodOpen(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    input: { periodId: string; until: string | null },
    at: Date,
  ): Promise<void>;
  resolveSalePolicy(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
  ): Promise<EffectiveSalePolicy>;
  recordSaleReceiptHeader(
    tx: Transaction,
    cfg: { locationId: LocationId },
    saleId: string,
    zoneId: string | null,
  ): Promise<void>;
  readDepartmentReceiptPolicy(
    tx: Transaction,
    cfg: { locationId: LocationId },
    departmentId: string,
  ): Promise<DepartmentReceiptPolicy>;
  saveDepartmentReceiptSettings(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
    input: DepartmentReceiptWrite,
    rasters?: ReceiptLogoRasters,
  ): Promise<void>;
  readDepartmentReceipt(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
  ): Promise<DepartmentReceiptConfig>;
  readRetainedDepartmentReceipt(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
  ): Promise<DepartmentReceiptConfig>;
  readPrintedDepartmentReceipt(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
    paperWidth: ReceiptPaperWidth,
  ): Promise<{ receipt: DepartmentReceiptConfig; logo: ReceiptLogoRaster | null }>;
  readDepartmentLogoRasters(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
  ): Promise<ReceiptLogoRasters | null>;
  writeDepartmentReceipt(
    tx: Transaction,
    cfg: DepartmentReceiptScope,
    departmentId: string,
    receipt: DepartmentReceiptConfig,
    rasters?: ReceiptLogoRasters,
  ): Promise<void>;
  receiptDepartmentForSale(
    tx: Transaction,
    cfg: { locationId: LocationId },
    saleId: string,
  ): Promise<string | null>;
  receiptDepartmentForOrder(
    tx: Transaction,
    cfg: { locationId: LocationId },
    orderId: string,
  ): Promise<string | null>;
  receiptDefaultDepartment(
    tx: Transaction,
    cfg: { locationId: LocationId },
  ): Promise<string | null>;
  readSaleReceiptHeader(
    tx: Transaction,
    saleId: string,
  ): Promise<{
    departmentId: string | null;
    tradingName: string;
    printTradingName: boolean;
  } | null>;
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
  ): Promise<ReadonlyMap<string, StationTodayState>>;
  stationDestinations(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationId: string,
    at: Date,
  ): Promise<readonly { id: string; name: string; isDefault: boolean }[]>;
  closeStationForToday(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationId: string,
    sendsToStationId: string,
    at: Date,
  ): Promise<void>;
  openStationForToday(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationId: string,
    at: Date,
  ): Promise<void>;
  /** Base maker for active products and variants, plus whether any active zone's maker or no-replacement answer differs. */
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
   *  the zone's active menus. With `menuItemIds`, only the offers it names are served. The default
   *  is the menu timetable's at `at` (now when absent); with `withDefault: false` the timetable is
   *  not read, `defaultMenuId` is null and no menu is the default, which is what pricing passes. */
  listZoneOffers(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    options?: {
      asserted?: readonly { menuId: string; versionId: string }[];
      menuItemIds?: readonly string[];
      at?: Date;
      withDefault?: false;
    },
  ): Promise<ZoneOffers>;
  resolveDefaultMenu(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    at: Date,
    servedMenuIds: readonly string[],
  ): Promise<string | null>;
  menuState(
    tx: Transaction,
    cfg: { locationId: LocationId },
    zoneId: string,
    at?: Date,
  ): Promise<ZoneMenuState>;
  resolveNewOrderZone(
    tx: Transaction,
    cfg: { locationId: LocationId },
    /** A profile with a department starts at its starting zone, ahead of the venue's counter
     *  default; one with a department and no usable zone is refused
     *  `device_profile.no_service_zone`. */
    input: { zoneId?: string | null; profileId?: string | null },
  ): Promise<OrderServiceContext>;
  /** A profile's department and zones as they stand now. A null department means no
   *  department restriction, with null zones and starting zone; with a department, an empty zone
   *  list and a null starting zone mean the profile cannot order. An unknown profile is refused
   *  `device_profile.access_invalid`. */
  readProfileServiceAccess(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
  ): Promise<{
    departmentId: string | null;
    allowedZoneIds: string[] | null;
    startingZoneId: string | null;
  }>;
  /** Each live profile's kitchen screens in display order. */
  readProfileKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
  ): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]>;
  /** Replaces the profile's screens, preserving an unchanged stored empty zone bound.
   *  New empty lists and deleted nonempty zone or station choices refuse with field/reason. */
  setProfileKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
    screens: ProfileKitchenScreens,
  ): Promise<NarrowedDevice[]>;
  /** Copies a live source's kitchen screens, retaining its explicit empty zone bounds. */
  copyProfileKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    sourceId: string,
    targetId: string,
  ): Promise<void>;
  /** Narrows the device from its current profile to `profileId`, before a switch writes it,
   *  recording what it lost and giving back what `profileId` allows again, as a profile save does,
   *  against the profiles' lists at the device's own location; never refuses. Null: it lost nothing, or the device is unknown. */
  narrowDeviceKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
    profileId: string,
  ): Promise<NarrowedDevice | null>;
  /** Adds the screen's stations and zones to the profile's row of its kind, creating the row when
   *  there is none; never removes anything and never narrows a device. Unchecked: for test set-up. */
  addProfileKitchenScreen(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
    screen: DeviceKitchenScreen,
  ): Promise<void>;
  /** The device's stored kitchen screens, then the kinds a narrowing took from it. */
  readDeviceKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
  ): Promise<ResolvedKitchenScreen[]>;
  /** Each named device's `readDeviceKitchenScreens`, in a fixed number of queries; one unknown
   *  here reads none. */
  readDevicesKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceIds: readonly string[],
  ): Promise<Map<string, ResolvedKitchenScreen[]>>;
  /** Refuses `kitchen_screen.required` when `profileId` is a kitchen display's and the device's
   *  choice, less what narrowings took, holds no kitchen screen. */
  assertKitchenDisplayHasScreen(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
    profileId: string,
  ): Promise<void>;
  /** Replaces the device's kitchen screens and forgets what narrowings took from it. Refused
   *  `kitchen_screen.*` or `station.not_allowed` as `assertDeviceKitchenScreens` says. */
  setDeviceKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    input: { deviceId: string; profileId: string; screens: readonly DeviceKitchenScreen[] },
  ): Promise<void>;
  readDeviceZoneSelection(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
  ): Promise<DeviceZoneSelection>;
  setDeviceZoneSelection(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
    input: DeviceZoneSelectionInput,
  ): Promise<DeviceZoneSelection>;
  countDeviceZoneSelections(tx: Transaction, deviceId: string): Promise<number>;
  removeDeviceZoneSelections(tx: Transaction, deviceId: string): Promise<void>;
  /** How many kitchen screens the device has chosen. */
  countDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<number>;
  /** Removes the device's kitchen screens, their stations and zones, and what narrowings took. */
  removeDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<void>;
  /** A kitchen display takes exactly one kitchen screen (`kitchen_screen.required`, or
   *  `kitchen_screen.invalid` `one_only`), each kind at most once and never both a pass screen and
   *  a pass monitor (`one_only`), of a kind its profile offers (`kitchen_screen.not_allowed`; on
   *  any form factor a pass monitor needs a profile row); stations and zones within the profile's
   *  lists (`station.not_allowed`, `kitchen_screen.zone_not_allowed`). Deleted nonempty zone and
   *  station choices refuse (`kitchen_screen.invalid`); a device's stored empty zone bound may stay.
   *  Writes nothing. */
  assertDeviceKitchenScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
    screens: readonly DeviceKitchenScreen[],
    deviceId?: string,
  ): Promise<void>;
  /** Refuses an order's zone (null: an order in no zone) the device's pass screen does not show,
   *  and any order on a device with no pass screen once narrowings' removals are taken out
   *  (`kitchen_screen.not_allowed`). */
  assertPassScreenZone(
    tx: Transaction,
    cfg: { locationId: LocationId },
    deviceId: string,
    zoneId: string | null,
  ): Promise<void>;
  /** Each active kitchen display running a station screen, with the stations it shows now; with
   *  `withSwitchedOff`, also the switched-off ones its explicit list names (never "every"'s, never
   *  one a narrowing took). */
  readStationScreens(
    tx: Transaction,
    cfg: { locationId: LocationId },
    options?: { withSwitchedOff?: boolean },
  ): Promise<{ deviceId: string; stationIds: string[] }[]>;
  /** Each named profile's scope as last saved: `allowedZoneIds` null means every zone of the
   *  department, and a zone switched off since is still named. No saved scope reads all null. */
  readProfileServiceScopes(
    tx: Transaction,
    profileIds: readonly string[],
  ): Promise<
    {
      profileId: string;
      departmentId: string | null;
      allowedZoneIds: string[] | null;
      startingZoneId: string | null;
    }[]
  >;
  /** Replaces a profile's department, zones and starting zone.
   *  A field not named keeps its stored value, and naming none leaves a stored department's scope
   *  untouched; a kitchen display starts from no scope. Refused `device_profile.access_invalid`,
   *  naming the field, for no department on a profile that is not a kitchen display, any of the
   *  three on one that is, a zone outside the department or a starting zone outside the allowed
   *  ones. */
  setProfileServiceScope(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
    scope: {
      departmentId?: string | null;
      allowedZoneIds?: readonly string[] | null;
      startingZoneId?: string | null;
    },
  ): Promise<void>;
  /** The department and zone half of {@link readProfileServiceAccess}. */
  readProfileZones(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
  ): Promise<{
    departmentId: string | null;
    allowedZoneIds: string[] | null;
    startingZoneId: string | null;
  }>;
  /** Refused `service_zone.not_allowed` when the profile has a department and `zoneId` is not one of
   *  the zones it may order in now. */
  assertProfileZone(
    tx: Transaction,
    cfg: { locationId: LocationId },
    profileId: string,
    zoneId: string,
  ): Promise<void>;
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
  orderZoneIdSql(cfg: { locationId: LocationId }, orderId: SQL): SQL;
  /** A condition, for a query's WHERE, that holds for an order whose recorded zone is one of
   *  `zoneIds` or that has no recorded zone. `orderId` is the outer query's order id, written
   *  table-qualified. */
  orderInZones(cfg: { locationId: LocationId }, orderId: SQL, zoneIds: readonly string[]): SQL;
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
   *  Of the named `options`, `direction` and `cancelledExtra` (the extra taken off the dish) are
   *  for a `changed` notice only. `reroutedTo` names the new station on a `rerouted` notice only.
   *  `fromNumber`, the number of the order the dishes came from, is for a `moved` notice only and
   *  labels the notice `#28 → #27` when it differs. */
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
    kind:
      | "recalled"
      | "void"
      | "changed"
      | "moved"
      | "rerouted"
      | "allergy_changed"
      | "allergy_removed",
    options?: {
      orderNoteChange?: KitchenNoteChange;
      allergyBlock?: KitchenAllergyBlock | null;
      movedTo?: string | null;
      direction?: "added" | "removed" | null;
      cancelledExtra?: string | null;
      reroutedTo?: string | null;
      fromNumber?: number | null;
    },
  ): Promise<void>;
  /** A station's unacknowledged notices, oldest first: the newest fifty of the business day. */
  listStationNotices(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationId: string,
  ): Promise<StationNotice[]>;
  /** `listStationNotices` for several stations in one statement; every station asked for has an entry. */
  listStationsNotices(
    tx: Transaction,
    cfg: { locationId: LocationId },
    stationIds: readonly string[],
  ): Promise<Map<string, StationNotice[]>>;
  /** Clears one notice; with `stationId`, only one at that station. */
  acknowledgeKitchenNotice(
    tx: Transaction,
    cfg: { locationId: LocationId },
    id: string,
    scope?: { stationId?: string },
  ): Promise<void>;
  /** Whether staff may change an item already sent to the kitchen. */
  readEditSentLines(tx: Transaction): Promise<boolean>;
  /**
   * Which of these dining tables need clearing once their party leaves: those whose zone's
   * department has Needs clearing on. A table whose zone has no department is not among them.
   */
  readTablesNeedingClearing(
    tx: Transaction,
    tableIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** How identical dishes print on a kitchen ticket: one `N x` entry, or N entries of one. */
  readKitchenTicketGrouping(tx: Transaction): Promise<"combined" | "separate">;
  readPartyAllergy(tx: Transaction, partyId: string): Promise<PartyAllergySnapshot>;
  copyTicketAllergy(
    tx: Transaction,
    fromTicketItemId: string,
    toTicketItemId: string,
  ): Promise<void>;
  recordTicketAllergies(
    tx: Transaction,
    rows: readonly ({ ticketItemId: string } & TicketAllergyCopy)[],
  ): Promise<void>;
  readTicketAllergies(
    tx: Transaction,
    ticketItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, TicketAllergyCopy>>;
  setTicketAllergyCurrent(
    tx: Transaction,
    ticketItemId: string,
    block: KitchenAllergyBlock | null,
  ): Promise<void>;
  partiesWithAllergicGuests(
    tx: Transaction,
    partyIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  savePartyAllergy(
    tx: Transaction,
    partyId: string,
    expectedRevision: number,
    input: unknown,
    operatorId: string,
  ): Promise<PartyAllergySnapshot>;
  writePartyAllergy(
    tx: Transaction,
    partyId: string,
    input: unknown,
    operatorId: string,
  ): Promise<void>;
  setAllergyLineTicks(tx: Transaction, partyId: string, input: unknown): Promise<void>;
  moveAllergyDraftTicks(
    tx: Transaction,
    partyId: string,
    lines: readonly { draftLineId: string; workingLineId: string }[],
  ): Promise<void>;
  mergePartyAllergies(
    tx: Transaction,
    from: string,
    into: string,
    operatorId: string,
  ): Promise<void>;
  moveBillAllergies(
    tx: Transaction,
    from: string,
    into: string,
    billId: string,
    operatorId: string,
  ): Promise<void>;
  splitPartyAllergies(
    tx: Transaction,
    from: string,
    into: string,
    billId: string | null,
    operatorId: string,
  ): Promise<void>;
  kitchenNoteKey(scope: KitchenNoteScope): string;
  readKitchenNotes(
    tx: Transaction,
    scopes: readonly KitchenNoteScope[],
  ): Promise<ReadonlyMap<string, KitchenNote>>;
  writeKitchenNote(
    tx: Transaction,
    scope: KitchenNoteScope,
    expectedRevision: number,
    note: string | null,
  ): Promise<KitchenNote>;
  /** Whether held groups print in advance, marked HOLD. */
  readPrintHeldWork(tx: Transaction): Promise<boolean>;
  /** The venue's MOVED slips choice, which a prep station left as the venue follows. */
  readPrintMovedSlips(tx: Transaction): Promise<boolean>;
  /** Minutes after the work ahead is served that a held group is due to be released; null is off. */
  readReleaseReminderMinutes(tx: Transaction): Promise<number | null>;
}

export type NonDbSource =
  | { readonly kind: "content-addressed-dir"; readonly source: string }
  | {
      readonly kind: "preparation-history";
      readonly source: string;
      /** Select public evidence only; the opaque preparation journal is never an archive entry. */
      project(input: {
        readonly preparations: readonly unknown[];
        readonly retained: readonly unknown[];
      }): unknown;
    };

/** A module's backup contribution: the non-DB state it owns, and what it does after a restore. */
export interface ModuleBackupContribution {
  readonly verification?: BackupVerificationContribution;
  readonly nonDbState?: readonly NonDbSource[];
  readonly restore?: RestoreHook;
  /** A resume must already have committed locally. Preparation still supplies current authority. */
  readonly assertRestoreCommitted?: (
    tx: Transaction,
    node: import("./provisioning.js").ProvisionedNode,
    binding: import("./operation-authority.js").OperationBinding,
  ) => Promise<void>;
  /** Validate and return public recovery material; no private signing key or claim authority. */
  readonly recoveryPack?: (
    tx: Transaction,
    node: import("./provisioning.js").ProvisionedNode & { readonly venueId: string },
    input: unknown,
  ) => Promise<unknown>;
  /** Render a transient recovery PDF; the host commits its named verifier only after rendering succeeds. */
  readonly recoveryDocument?: (
    tx: Transaction,
    node: import("./provisioning.js").ProvisionedNode,
    context: {
      readonly nodeKey: { readonly nodeId: string; readonly name: string; readonly secret: string };
      readonly createdAt: string;
      readonly locale: "en" | "es";
      readonly evidence: Readonly<Record<string, unknown>>;
    },
  ) => Promise<Uint8Array<ArrayBuffer>>;
}

/** One table whose rows may cross from preparation into a fresh production database. */
export interface ConfigurationTransferTable {
  readonly name: string;
  /** Insert these rows before the named tables when a module adds a reference to its data. */
  readonly before?: readonly string[];
  readonly omit?: readonly string[];
  readonly locationColumns?: readonly string[];
  /** Columns holding another row's id that the schema declares no foreign key for. An import
   * rewrites `id`, these and every foreign-key column to the new ids, whatever column a key
   * references, so a key onto a column that is not an id would have a value equal to a bundle id
   * replaced. */
  readonly references?: readonly string[];
  /** An export leaves behind each row whose value in this column is not null, and then, in every
   * declared table, each row whose foreign key names a row left behind. */
  readonly leaveBehindWhenSet?: string;
  /** As above, but only rows holding false (stored as 0) in the declared column. */
  readonly leaveBehindWhenFalse?: string;
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
        bundle?: {
          readonly createdAt: Date;
          readonly timeZone: string;
          readonly dayCutover: string;
        },
      ) => void;
      /** Runs in the import's transaction after every module's rows are inserted, each module's in
       * module order, to set what the module derives from those rows, or to remove imported rows
       * the module does not keep, rather than letting a bundle carry them. */
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
  /** Collects module-owned outside evidence before the host opens its write transaction. */
  readonly operations?: ModuleOperationPreparation;
  /** The module's contribution to the fiscal slot — `fiscalSlot` selects exactly one. */
  readonly fiscal?: FiscalContribution;
  readonly routes?: ModuleRoutes;
  readonly timeRecordExport?: ModuleTimeRecordExport;
  readonly describeShifts?: (
    tx: Transaction,
    shiftIds: readonly string[],
  ) => Promise<Map<string, string>>;
  readonly floorAnnotations?: FloorAnnotator;
  readonly tableRemoval?: TableRemoval;
  readonly venueService?: VenueServiceContribution;
  /** Incident codes this module claims for the dashboard alerts, and its ongoing checks. Claims are
   * read from every module; sources only from enabled modules, since a disabled module's tables are
   * not migrated. */
  readonly alerts?: ModuleAlerts;
  readonly backup?: ModuleBackupContribution;
  readonly configurationTransfer?: ModuleConfigurationTransfer;
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
