import type { AllergyCommand } from "@waitron/module";
import type {
  ProductAllergens,
  KitchenAllergyBlock,
  OptionSnapshot,
  DietProfile,
  StationThresholds,
  TimingBand,
  Dining,
  ChangesAfterSending,
} from "@waitron/shared";
import {
  type TillCourse,
  type ScreenSlot,
  type ResolvedKitchenScreen,
  DeviceSessionApi,
  type StaffMember,
} from "./device-session-api.js";
import type { SaleLine, BillEditExpected, GroupCommand } from "./order-types.js";
import type {
  StationQueueGroup,
  KitchenNotice,
  StationPrinterDown,
  StationQueue,
} from "./station-queue-types.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

/** Whether a submitted group goes to the kitchen now or waits until it is fired. */
export type GroupRelease = "fire" | "hold";
/** One line of a submitted group. Its group, not its course, decides when it is released. `courseId`
 * is the waiter's course OVERRIDE; absent, the server uses the product's default course. */
export interface GroupLine extends SaleLine {
  courseId?: string;
}
/** A party's group of lines as `GET /api/parties/:id/groups` reads it. `lineIds` are the group's dish
 * lines, on whichever of the party's bills they sit; `summary` names them by staff name, e.g.
 * "2 × Steak, 1 × Fish". A removed group is never listed. */
export interface OrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /** Present when the group is fired, dishes are left to serve and every kitchen item left to serve
   *  is ready (recorded ready, or made here); or when at least one kitchen item the waiter asked for
   *  is left to serve and every such item is ready. */
  ready?: true;
  lineIds: string[];
  courseIds: string[];
  summary: string;
}
/** When to remind staff to fire the next held group with active dishes. */
export interface ReleaseReminder {
  groupId: string;
  dueAt: string | null;
}
/** Only what the kitchen recorded for a dish: a station that records nothing leaves `queued`. */
export interface CurrentOrderKitchen {
  state: TicketState;
  firedAt: string | null;
  stationId: string | null;
  movable: boolean;
  phase: KitchenPhase;
  requestedAt: string | null;
}
/** A dish row of `GET /api/parties/:id/current-orders`, on any bill of the party but an abandoned
 * one, a paid one included. Only a `released` row can be marked served; its extras are served with it. */
export interface LineNutrition {
  allergens: ProductAllergens | null;
  dietaryDeclarations: string[];
}

export interface CurrentOrderRow {
  billStatus: WorkingOrderStatus;
  /** Stored dish and extras total, after adjustments. */
  netAmount: string;
  readyAt: string | null;
  /** The earliest initiation of its kitchen components once every one is initiated, else null;
   *  `firedAt` for a dish with no kitchen work. */
  requestedAt: string | null;
  firedAt: string | null;
  /** First-send time, independent of whether Serve is currently available. */
  sentAt?: string;
  nutrition?: LineNutrition;
  lineId: string;
  workingOrderId: string;
  lineNo: number;
  courseId: string | null;
  /** The staff name. */
  name: string;
  quantity: string;
  /** Part of the billed quantity cancelled without removing its charge. */
  cancelledQuantity?: string;
  /** Decimal places the line's unit takes. */
  unitPrecision: number | null;
  countsWholePortions?: boolean;
  servedQuantity: string;
  servedAt: string | null;
  released: boolean;
  kitchen: CurrentOrderKitchen | null;
  note: string | null;
  extras: {
    lineId: string;
    name: string;
    quantity: string;
    netAmount: string;
    unitPriceGross: string;
    priceQuantity: string;
    cancelledQuantity?: string;
  }[];
}

export interface CurrentOrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /** A fired group's firing; a held group's holding. */
  sentAt: string;
  /** The display name of whoever fired or held it; null when the server has none. */
  sentBy: string | null;
  rows: CurrentOrderRow[];
}
/** What the party has ordered and what is known of it, groups in sequence. */
export interface CurrentOrders {
  revision: number;
  hasGroups: boolean;
  nextDisplayNumber: number;
  retainedCourses: TillCourse[];
  reminder: ReleaseReminder | null;
  groups: CurrentOrderGroup[];
  /** Dish rows in no group. */
  ungrouped: CurrentOrderRow[];
}
/** A kitchen ticket of a party's bill not printed after the server's `JOBS_WAITING_MS`, or given up
 * on; `since` is when the oldest such ticket was queued. */
export interface PrintProblem {
  workingOrderId: string;
  stationId: string;
  stationName: string;
  since: string;
}
/** The kitchen state a ticket item advances through: `queued → preparing → ready`. */
export type TicketState = "queued" | "preparing" | "ready";
/**
 * A working order's own status (`open → placed → settled|abandoned`). The station queue carries it so
 * the display offers the collect action only on a `settled` order awaiting its counter handover
 * (`TillApi.markCollected`).
 */
export type WorkingOrderStatus = "open" | "placed" | "settled" | "abandoned";
/**
 * One configured kitchen station from `GET /api/stations`. `isDefault` names the venue's single fallback
 * station (the counter/pass).
 */
export interface Station {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  open: boolean;
  byHand: "open" | "closed" | null;
  sendsTo: string | null;
  why: "default" | "open" | "closed_by_hand" | "switched_off";
}

export interface StationDestination {
  id: string;
  name: string;
  isDefault: boolean;
  /** The closing station's own "When closed, send to" choice; at most one row. */
  preferred: boolean;
}

export interface StationMoveBody {
  submissionId: string;
  lineIds: string[];
  stationId: string;
}

export interface StationMoveAnswer {
  revision: number;
  stationId: string;
  moved: { workingOrderLineId: string; fromStationId: string }[];
  personNotSignedIn?: true;
}

export interface KeepOpenZone {
  id: string;
  name: string;
  endsAt: string;
  running: boolean;
  extendedUntil: string | null;
  dayEndsAt: string;
  choices: readonly string[];
}

export interface ZoneExtensionWrite {
  until: string | null;
  override?: { personId: string; pin: string };
}

export interface StationTodayWrite {
  openDishes?: "send" | "leave";
  state: "open" | "closed";
  sendsToStationId?: string;
  override?: { personId: string; pin: string };
}
/** A child line without its own ticket item, riding beneath its dish. */
export interface QueueModifier {
  /** The KITCHEN name, the same one the printed kitchen ticket carries. */
  name: string;
  /** How many of a counted extra each dish has, as `QueueCrossRef.perDish` counts it. */
  perDish?: number;
  /** A measured extra's amount on each dish, in its unit. */
  amount?: string;
  /** The measured extra's unit abbreviation by language, sent with `amount`. */
  unitName?: Record<string, string>;
  /** The extra's OWN allergens, shown beside the dish's own — never folded. Absent/null when it
   *  declares none. */
  addAllergens?: ProductAllergens | null;
  /** The extra's OWN positive dietary suitability, shown beside the dish's own. Absent/empty when it
   *  declares none. */
  suitableFor?: string[] | null;
}
/** A line on another station's ticket that this item goes with. */
export interface QueueCrossRef {
  kind: "with" | "for";
  name: string;
  perDish?: number;
  amount?: QueueModifier["amount"];
  unitName?: QueueModifier["unitName"];
  stationName: string | null;
  addAllergens?: QueueModifier["addAllergens"];
  suitableFor?: QueueModifier["suitableFor"];
}
/**
 * The dish's OWN allergen profile on a queue/expo item, with no modifier contribution. `pending` is true
 * when the dish's allergens are unreviewed, so the display shows the plate as unverified. Display-only —
 * never a fiscal value.
 */
export interface AsServedAllergens {
  allergens: ProductAllergens;
  pending: boolean;
}
/** The seated party a queue card's bill belongs to, at the revision the queue was read at. */
export interface QueueParty {
  id: string;
  revision: number;
}
/** The group a queue item's dish was sent in. */
export interface QueueGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  /** The names of the stations of this group's dishes for the pass, until each is served; each name
   * once, in the stations list's order; non-empty when present. */
  goesWith?: readonly string[];
}
/** A station the display works, including recorded work on a historical station. */
export interface DeviceWorkedStation {
  id: string;
  name: string;
  available: boolean;
  switchedOff?: boolean;
  today: {
    open: boolean;
    isDefault: boolean;
    byHand: Station["byHand"];
    sendsTo: { id: string; name: string } | null;
    why: Station["why"];
  };
  queue: StationQueueGroup[];
  notices: KitchenNotice[];
  printersDown: StationPrinterDown[];
}
/** `GET /api/device/station-screen` success: the display's station slots and queues. */
export interface DeviceStationScreen {
  stations: (
    | (DeviceWorkedStation & { available: true })
    | (DeviceWorkedStation & { available: false; switchedOff: true })
    | { id: string; name: string; available: false; switchedOff: false }
  )[];
}
/**
 * One item on the cross-station expo/pass board. Unlike `StationQueueItem` it carries the RESOLVED
 * `stationName`, so the expediter sees which station is lagging.
 */
export interface ExpoItem {
  allergy: KitchenAllergyBlock | null;
  /** The dish's recorded answers with their list ids and frozen names. */
  optionSnapshots?: OptionSnapshot[];
  id: string;
  name: string;
  qty: string;
  /** Unit values frozen with the line. Absent/null only on older payloads. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** Counted in Each, whose unit the expo board leaves out; absent reads as not. */
  soldInEach?: boolean;
  stationName: string;
  state: TicketState;
  /** `null` while the item's course is HELD; a timestamp once fired. */
  firedAt: string | null;
  /** Absent on a bill with no party, and on a line moved in from another bill. */
  group?: QueueGroup;
  /** The kitchen note as frozen at fire, as `StationQueueItem.note`. */
  note?: string | null;
  /** The dish's selected options, in selection order; absent reads as none. */
  modifiers?: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  /** The dish's OWN allergen profile; absent renders nothing. */
  asServed?: AsServedAllergens;
  /** The dish's OWN diet profile; absent renders nothing. */
  asServedDiet?: DietProfile;
  /**
   * This item's own queued-at, ISO. Unlike {@link StationQueueGroup.thresholds} the timing rides PER
   * ITEM: one expo order's items can span several stations, each with its own thresholds.
   */
  queuedAt: string;
  /** This item's OWN station's order-timing thresholds (see {@link queuedAt}). */
  thresholds: StationThresholds;
  /** This item's age band on the server's clock at fetch time. The pass board does not read it:
   *  `passItemBand` derives the band on the till's own clock. */
  band: TimingBand;
}

export type KitchenPhase = "held" | "requested" | "waiting" | "preparing" | "ready";

export type PassTarget =
  { kind: "group"; partyId: string; groupId: string } | { kind: "bill"; workingOrderId: string };
/** null for a dish in no course. */
export type PassCourse = { id: string; name: string | null; displayOrder: number | null } | null;

export interface PassCardItem extends ExpoItem {
  lineId: string;
  orderId: string;
  stationId: string;
  phase: KitchenPhase;
  requestedAt: string | null;
  readyAt: string | null;
  visible: boolean;
  informational: boolean;
  passControlled: boolean;
  course: PassCourse;
  stationClosed: boolean;
  extra: boolean;
}

export interface PassCard {
  key: string;
  target: PassTarget;
  kind: "held" | "new_order" | "next_course" | "added";
  /** null on a held card. */
  requestedAt: string | null;
  readyAt: string | null;
  allReady: boolean;
  party?: { id: string; revision: number };
  orders: {
    orderId: string;
    orderNumber: number;
    tableLabel?: string;
    counter?: true;
    billName?: string;
    /** The short names of the order's current tables. */
    tableShortNames?: string[];
    kitchenNote: string | null;
    formerNumbers?: number[];
    dining: Dining;
  }[];
  group?: { displayNumber: number; numberPartyLabel?: string; position: number };
  items: PassCardItem[];
  /** Dimmed dishes the pass's display choice hides: never drawn, but counted for the card's
   *  lateness and allergy marker as if drawn. */
  hiddenItems?: PassCardItem[];
  /** Empty, with a null context, on the pass monitor's board. */
  releaseTicketItemIds: string[];
  releaseContext: string | null;
}

export type OverviewFact = Pick<
  PassCardItem,
  "lineId" | "stationId" | "name" | "qty" | "phase" | "informational" | "unitName" | "soldInEach"
>;

export interface PassBoard {
  held: PassCard[];
  toFire: PassCard[];
  inProgress: PassCard[];
  ready: PassCard[];
  overview: OverviewFact[];
}

export interface DevicePassBoard {
  board: PassBoard;
  stations: ScreenSlot[];
  /** null: no zone filter. */
  zones: ScreenSlot[] | null;
  display: Pick<ResolvedKitchenScreen, "showNonPassStations">;
}
/** A card's `releaseTicketItemIds` and `releaseContext`, sent back unchanged. */
export interface PassReleaseAsk {
  submissionId: string;
  target: PassTarget;
  ticketItemIds: string[];
  expectedContext: string;
}

export interface PassReleaseResult {
  releasedTicketItemIds: string[];
}
/** `GET /api/working-orders/:id/lines` — an open tab's lines and the revision they were read at. */
export interface TabLines {
  lines: TabLine[];
  revision: number;
}
/**
 * One line of a bill: an open one from `GET /api/working-orders/:id/lines`, an open or presented
 * one from `GET /api/parties/:id/split-sources`. A tab does NOT re-price:
 * `unitPriceGross` is the gross unit price LOCKED at add-time.
 */
export interface TabLine {
  nutrition?: LineNutrition;
  /** The row's id, which a group move names. A dish in an order group is listed by it in
   * {@link OrderGroup.lineIds}; a child extras row never is. */
  id: string;
  stationId: string | null;
  /** Its own kitchen record's station's choice; null with no record. Removing the dish is not
   * limited by it. */
  changesAfterSending: ChangesAfterSending | null;
  movable: boolean;
  /** The line's frozen STAFF label — the variant's name on a variant line, else the product's. Absent
   * only on a fixture that omits it, which falls back to the live menu name. */
  name?: string;
  /** The dish's recorded answers with their list ids and frozen names. */
  optionSnapshots?: OptionSnapshot[];
  lineNo: number;
  /** The line's product. `string | null` because the COLUMN is nullable, NOT because a child line lacks
   * a product: an extras child carries the PICKED product. Tell a child from a dish by
   * {@link parentLineNo}, never by this field. */
  productId: string | null;
  /** The `lineNo` of this row's PARENT dish when it is a CHILD extras line, else `null` — the one field
   * on this wire that tells the two apart. An absent value reads as a dish. */
  parentLineNo?: number | null;
  quantity: string;
  /** Part of the billed quantity cancelled without removing its charge. */
  cancelledQuantity?: string;
  /** Physical amount represented by one priced portion, frozen when the line was added. */
  priceQuantity?: string;
  /** How many decimal places the line's unit takes, frozen when it was rung (0 = sold by the unit).
   * The split reads this, never the product: a line sold as a variant names
   * the variant, which is not one of the till's products. Absent reads as three places. */
  unitPrecision?: number | null;
  unitPriceGross: string;
  /** The unit price the line had before a comp or a discount changed it; absent on a line no
   * adjustment has touched. */
  listUnitPriceGross?: string;
  servedAt: string | null;
  /** The line's RESOLVED kitchen course, or null when it has none. */
  courseId: string | null;
  course?: TillCourse;
  /** When the line was first released: fired, or for a no-preparation line, when it would have
   * fired; null if it never was. */
  sentAt: string | null;
  /** When the line's kitchen ticket item FIRED, or null while its course is still HELD or it has no
   * ticket item. A following extra has none; a split-off extra has its own. */
  firedAt: string | null;
  /** The line's kitchen ticket item state, or null when it has no LIVE ticket item. A following extra
   * has none; a split-off extra has its own. A parent line can lack one too. */
  state: TicketState | null;
  /** The order group the line is released with; null when it is in none, as on a bill with no party
   * or for a line moved in from another party's bill or from a bill with no party. */
  groupId: string | null;
  /** On a dish its held group has still to release, by the rule of the order screen's `released`;
   * absent otherwise. */
  waitsInHeldGroup?: true;
  note: string | null;
  /** The extras list a CHILD row was picked from, which a prefilled pick goes back to; null on a
   * dish. */
  listId: string | null;
  /** The offer the line was sold under (a child row's is its dish's), which finds the live product
   * whose picker an edit opens; null on a line with no recorded service context. */
  menuItemId: string | null;
  /** On a dish sold as a variant, {@link productId} names the variant and this its parent product;
   * otherwise null. */
  parentProductId: string | null;
  /** True on a dish line bound to a whole, unmeasured portion: only those share a row. Absent only
   * on a fixture that omits it, read as false. */
  portion?: boolean;
}

export class KitchenApi extends DeviceSessionApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  /** The venue's ACTIVE kitchen stations → `GET /api/stations`, by display order then name. */
  listStations(options: ReadOptions = {}): Promise<Station[]> {
    return this.#request<Station[]>("/api/stations", "GET", undefined, options.signal);
  }
  stationToday(
    stationId: string,
    options: ReadOptions = {},
  ): Promise<{ destinations: StationDestination[]; openDishCount: number }> {
    return this.#request(
      `/api/stations/${encodeURIComponent(stationId)}/today`,
      "GET",
      undefined,
      options.signal,
    );
  }
  setStationToday(stationId: string, body: StationTodayWrite): Promise<void> {
    return this.#request(`/api/stations/${encodeURIComponent(stationId)}/today`, "PUT", body);
  }
  deviceStationToday(
    stationId: string,
    options: ReadOptions = {},
  ): Promise<{
    destinations: StationDestination[];
    authorizers: StaffMember[];
    openDishCount: number;
  }> {
    return this.#request(
      `/api/device/stations/${encodeURIComponent(stationId)}/today`,
      "GET",
      undefined,
      options.signal,
    );
  }
  deviceSetStationToday(
    stationId: string,
    body: Omit<StationTodayWrite, "override"> & { authorizer: { personId: string; pin: string } },
  ): Promise<void> {
    return this.#request(
      `/api/device/stations/${encodeURIComponent(stationId)}/today`,
      "PUT",
      body,
    );
  }
  keepOpen(zoneId: string): Promise<{ zone: KeepOpenZone | null }> {
    return this.#request(`/api/service-zones/${encodeURIComponent(zoneId)}/keep-open`, "GET");
  }
  keepZoneOpen(zoneId: string, body: ZoneExtensionWrite): Promise<void> {
    return this.#request(
      `/api/service-zones/${encodeURIComponent(zoneId)}/zone-extension`,
      "PUT",
      body,
    );
  }
  serviceDayAuthorizers(options: ReadOptions = {}): Promise<StaffMember[]> {
    return this.#request("/api/service-day/authorizers", "GET", undefined, options.signal);
  }
  moveDishStation(
    orderId: string,
    body: StationMoveBody & { expectedEdit: BillEditExpected | null },
    options: ReadOptions = {},
  ): Promise<StationMoveAnswer> {
    return this.#request(
      `/api/working-orders/${orderId}/lines/move-station`,
      "POST",
      body,
      options.signal,
    );
  }
  /** {@link listStations} for a kitchen display using its device proof → `GET /api/device/stations`. */
  deviceStations(options: ReadOptions = {}): Promise<Station[]> {
    return this.#request<Station[]>("/api/device/stations", "GET", undefined, options.signal);
  }
  /**
   * One station's kitchen queue → `GET /api/stations/:id/queue`, grouped by order, oldest first. A
   * malformed or unknown station id rejects with `station.not_found`.
   */
  getStationQueue(stationId: string, options: ReadOptions = {}): Promise<StationQueue> {
    return this.#request<StationQueue>(
      `/api/stations/${stationId}/queue`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** Acknowledge one kitchen notice → `POST /api/kitchen-notices/:id/acknowledge`. An unknown id
   * rejects with `kitchen_notice.not_found`. */
  async acknowledgeKitchenNotice(id: string): Promise<void> {
    await this.#request<void>(`/api/kitchen-notices/${id}/acknowledge`, "POST");
  }
  /** The station display's twin of {@link acknowledgeKitchenNotice}, by its device cookie; a notice
   * at another station rejects as an unknown one does. */
  async deviceAcknowledgeKitchenNotice(id: string): Promise<void> {
    await this.#request<void>(`/api/device/kitchen-notices/${id}/acknowledge`, "POST");
  }
  /**
   * Advance ONE ticket item one kitchen step, or a Ready item still on its station's screen back to
   * `preparing` → `POST /api/ticket-items/:id/advance`. A skip, a repeat, or a Ready item going back
   * once it is off that screen (fully served, its order collected or cancelled) rejects with
   * `ticket.invalid_transition`, and an unknown item with `ticket_item.not_found`. A
   * dish now at a station other than `stationId` rejects with `device.forbidden_station`.
   */
  async advanceTicketItem(
    itemId: string,
    stationId: string,
    to: Exclude<TicketState, "queued">,
  ): Promise<void> {
    await this.#request<void>(`/api/ticket-items/${itemId}/advance`, "POST", { to, stationId });
  }
  getDeviceStationScreen(options: ReadOptions = {}): Promise<DeviceStationScreen> {
    return this.#request<DeviceStationScreen>(
      "/api/device/station-screen",
      "GET",
      undefined,
      options.signal,
    );
  }
  /** The pass's board → `GET /api/device/pass-board`; at a till it needs a signed-in person. */
  getDevicePassBoard(options: ReadOptions = {}): Promise<DevicePassBoard> {
    return this.#request<DevicePassBoard>(
      "/api/device/pass-board",
      "GET",
      undefined,
      options.signal,
    );
  }
  /** A pass monitor's board → `GET /api/device/pass-monitor-board`; its cards carry no release. */
  getDevicePassMonitorBoard(options: ReadOptions = {}): Promise<DevicePassBoard> {
    return this.#request<DevicePassBoard>(
      "/api/device/pass-monitor-board",
      "GET",
      undefined,
      options.signal,
    );
  }
  /** The pass's Fire → `POST /api/device/pass-screen/release`. A stale card rejects
   *  `ticket.pass_context_changed`. */
  releaseDevicePass(ask: PassReleaseAsk): Promise<PassReleaseResult> {
    return this.#request<PassReleaseResult>("/api/device/pass-screen/release", "POST", ask);
  }
  async bumpDeviceBillReady(orderId: string): Promise<void> {
    await this.#request<void>(`/api/device/orders/${orderId}/ready`, "POST", {});
  }
  bumpDeviceGroupReady(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/device/parties/${partyId}/groups/${groupId}/ready`, "POST", command);
  }
  /**
   * Advance ONE ticket item at a station the device's station screen works →
   * `POST /api/device/ticket-items/:id/advance`, the device-scoped {@link advanceTicketItem}. An
   * item at any other station rejects `device.forbidden_station` (403); an illegal transition
   * `ticket.invalid_transition`, and an unknown item `ticket_item.not_found`.
   */
  async deviceAdvance(itemId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    await this.#request<void>(`/api/device/ticket-items/${itemId}/advance`, "POST", { to });
  }
  async bumpBillReady(orderId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/ready`, "POST", {});
  }
  /** Send a held group to the kitchen → `POST /api/parties/:partyId/groups/:groupId/fire`. Rejects
   * `group.not_held`, `group.not_found`, `product.unavailable` and the command refusals. */
  fireGroup(
    partyId: string,
    groupId: string,
    command: AllergyCommand,
    options: ReadOptions = {},
  ): Promise<{ revision: number }> {
    return this.#request(
      `/api/parties/${partyId}/groups/${groupId}/fire`,
      "POST",
      command,
      options.signal,
    );
  }
  /** The pass marks a fired group's kitchen items ready → `POST /api/parties/:partyId/groups/:groupId/ready`.
   * A held group is a no-op that still moves the revision. Rejects `group.not_found` and the command
   * refusals. */
  bumpGroupReady(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/ready`, "POST", command);
  }
  /**
   * Mark part or all of each of a party's lines served → `POST /api/parties/:partyId/served`, on any
   * of its bills but an abandoned one, a paid one included. `quantity` is how much THIS command serves. Rejects
   * `tab.serve_quantity_invalid` for more than is left to serve, `group.line_held` for a line the waiter
   * has not yet asked for or one with a held extra, `group.not_found`, and the command refusals.
   */
  markServed(
    partyId: string,
    items: { lineId: string; quantity: string }[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/served`, "POST", { ...command, items });
  }
  /** Take back part or all of what was marked served on each line → `POST /api/parties/:partyId/unserved`;
   * more than is served rejects `tab.serve_quantity_invalid`. */
  unmarkServed(
    partyId: string,
    items: { lineId: string; quantity: string }[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/unserved`, "POST", { ...command, items });
  }
  /** Mark every line of a fired group served → `POST /api/parties/:partyId/groups/:groupId/served`.
   * A held group rejects `group.line_held`. */
  markGroupServed(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/served`, "POST", command);
  }
  /** Put off the release reminder of the group waiting →
   * `POST /api/parties/:partyId/groups/:groupId/snooze`: it becomes due `minutes` from now. A
   * fired group rejects `group.not_held`, and a held group other than the one waiting
   * `group.not_waiting`. */
  snoozeGroup(
    partyId: string,
    groupId: string,
    minutes: number,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/snooze`, "POST", {
      ...command,
      minutes,
    });
  }
  /** Clear the snooze of the group waiting →
   * `POST /api/parties/:partyId/groups/:groupId/unsnooze`: its reminder falls due at its own time
   * again, and a group with no snooze is left as it is. A fired group rejects `group.not_held`, and
   * a held group other than the one waiting `group.not_waiting`. */
  unsnoozeGroup(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/unsnooze`, "POST", command);
  }
  /** A party's Current orders → `GET /api/parties/:partyId/current-orders`. */
  readCurrentOrders(partyId: string, options: ReadOptions = {}): Promise<CurrentOrders> {
    return this.#request(
      `/api/parties/${partyId}/current-orders`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** Put a party's held groups in a new order → `PUT /api/parties/:partyId/groups/order`, naming every
   * held group once. Fired groups keep their places. */
  reorderGroups(
    partyId: string,
    heldGroupIds: string[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/order`, "PUT", {
      ...command,
      heldGroupIds,
    });
  }
  /** The revision identifies this listing for a later adjustment to an open order. */
  getTabLines(orderId: string, options: ReadOptions = {}): Promise<TabLines> {
    return this.#request<TabLines>(
      `/api/working-orders/${orderId}/lines`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /**
   * Move ONE held line (neither it nor its extras fired or waiting for the pass) into another
   * course → `PATCH /api/working-orders/:orderId/lines/:lineNo/course`. `null` CLEARS the line's course and is sent as an
   * explicit null, not an absent field. NON-FISCAL. Rejects `tab.not_open`, `course.not_found`,
   * `tab.line_not_found`, or `ticket.already_fired`.
   */
  async setLineCourse(
    orderId: string,
    lineNo: number,
    courseId: string | null,
    expectedEdit: BillEditExpected | null,
  ): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/course`, "PATCH", {
      courseId,
      expectedEdit,
    });
  }
  /**
   * Fire SPECIFIC held lines of an open tab → `POST /api/working-orders/:orderId/lines/send`.
   * NON-FISCAL; idempotent — an unknown or already-fired line matches nothing. Rejects `tab.not_open`,
   * and `group.line_held` for a named line in a held group, which only firing its group releases.
   */
  async sendLines(
    orderId: string,
    lineNos: number[],
    expectedEdit: BillEditExpected | null,
    command?: AllergyCommand,
    options: ReadOptions = {},
  ): Promise<void> {
    await this.#request<void>(
      `/api/working-orders/${orderId}/lines/send`,
      "POST",
      { lineNos, expectedEdit, ...command },
      options.signal,
    );
  }
}
