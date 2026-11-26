import type { BumpMode, Dining, OptionSnapshot, StationThresholds } from "@waitron/shared";
import type { KitchenAllergyBlock, KitchenNoteChange } from "@waitron/module";
import type { DietProfile } from "./client.js";
import type {
  AsServedAllergens,
  KitchenPhase,
  QueueCrossRef,
  QueueGroup,
  QueueModifier,
  QueueParty,
  TicketState,
  WorkingOrderStatus,
} from "./kitchen-api.js";

/** One ticket item on a station's queue; `id` is the per-line bump target. */
export interface StationQueueItem {
  allergy: KitchenAllergyBlock | null;
  lastMove?: {
    fromStationName: string;
    personName: string | null;
    deviceName: string | null;
    movedAt: string;
  };
  /** The dish's recorded answers with their list ids and frozen names. */
  optionSnapshots?: OptionSnapshot[];
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  /** The line's snapshotted KITCHEN name — the kitchen name falling back to the staff name, the
   * variant's own on a variant line. */
  name: string;
  /** What is left to serve: the amount sent less the amount served, as a three-place decimal string, e.g. "2.000". */
  quantity: string;
  /** Unit values frozen with the line. Absent/null only on older payloads. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** Counted in Each, whose unit the kitchen screen leaves out; absent reads as not. */
  soldInEach?: boolean;
  /** The dish's selected options, in selection order; absent reads as none. */
  modifiers?: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  /** The dish's OWN allergen profile; absent renders nothing. */
  asServed?: AsServedAllergens;
  /** The dish's OWN diet profile, the diet twin of {@link asServed}; absent renders nothing. */
  asServedDiet?: DietProfile;
  /** The item's course, or `null` for a line with none — the display groups the queue by it. */
  course: StationQueueCourse | null;
  /** Absent on a bill with no party, and on a line moved in from another bill. */
  group?: QueueGroup;
  /** The period this dish was sent after; absent when it was not. */
  afterPeriod?: string;
  /** Set when that send asked nobody, so its mark does not say agreed. */
  afterPeriodUnasked?: true;
  phase: KitchenPhase;
  /** `null` while the item is held. */
  requestedAt: string | null;
  /** `null` while the item is HELD — not advanceable (`ticket.item_held`) — or requested and
   *  waiting for the pass; a timestamp once fired. */
  firedAt: string | null;
  readyAt: string | null;
  /** Whether the item waited for the pass when it was requested. */
  passControlled: boolean;
  /** When this dish joined the queue: set at fire, and again when a release re-routes it. */
  queuedAt: string;
  /** The NON-FISCAL kitchen note as frozen at fire, so a later edit never changes what the cook sees. */
  note?: string | null;
}

/** The course a queue item was fired for; `null` on the item when its line carried no course. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/** One item of the order at another station, shown in this station's card. */
export interface ElsewhereItem {
  id: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  held: boolean;
}

/** What a kitchen notice tells a station about sent work. */
export type KitchenNoticeKind =
  "recalled" | "void" | "changed" | "moved" | "rerouted" | "allergy_changed" | "allergy_removed";

/**
 * A correction to work a station was sent, until a cook acknowledges it. `lineName` is the kitchen
 * name. `orderLabel` identifies the affected bill or bills; `unitName`, `soldInEach` and `note`
 * keep the line's recorded presentation.
 */
export interface KitchenNotice {
  allergyBlock?: KitchenAllergyBlock | null;
  orderNoteChange?: KitchenNoteChange;
  /** On a kitchen-note change, the dishes it affects at this station; matching counted dishes (no
   *  unit or sold in each, whole-number quantity) are merged. */
  dishes?: {
    lineName: string;
    unitName: Record<string, string> | null;
    soldInEach: boolean;
    quantity: string;
    note: string | null;
    wasStarted: boolean;
  }[];
  id: string;
  stationId: string;
  workingOrderId: string;
  orderLabel: string;
  kind: KitchenNoticeKind;
  lineName: string;
  /** The line's unit snapshot, keyed by locale; null when the line recorded none. */
  unitName: Record<string, string> | null;
  /** Counted in Each, whose unit the kitchen screen leaves out. */
  soldInEach: boolean;
  quantity: string;
  note: string | null;
  wasStarted: boolean;
  /** On a `moved` notice, the MOVED slip's To text; null when the work went to the counter. */
  movedTo: string | null;
  /** On a `rerouted` notice, the station now making the dish. */
  reroutedTo: string | null;
  /** On a `changed` notice, whether `quantity` was added to the work or taken from it. */
  direction: "added" | "removed" | null;
  /** On a `changed` notice, the extra taken off the dish. */
  cancelledExtra: string | null;
  createdAt: string;
}

/** A station printer whose oldest outstanding print has blocked its output. */
export interface StationPrinterDown {
  printerId: string;
  printerName: string;
  since: string;
}

/** `GET /api/stations/:id/queue` — work, unacknowledged notices and down printers. */
export interface StationQueue {
  printersDown: StationPrinterDown[];
  items: StationQueueGroup[];
  notices: KitchenNotice[];
}

/**
 * One order's lines at a station. `queuedAt` is that of the order's oldest line at this station; the
 * merged screen's ordering key.
 */
export interface StationQueueGroup {
  kitchenNote: string | null;
  orderId: string;
  orderNumber: number;
  label: string | null;
  /** The short names of the order's current tables, when it has any. */
  tableShortNames?: string[];
  dining: Dining;
  queuedAt: string;
  /** The order's own status. Abandoned and collected orders are excluded server-side, so a `settled`
   *  order here is a pickup awaiting its counter handover ({@link TillApi.markCollected}). */
  status: WorkingOrderStatus;
  /** Absent on a bill with no party. */
  party?: QueueParty;
  /** Present only when one of this bill's tickets for the station was not printed after the
   *  server's `JOBS_WAITING_MS`, or was given up on. */
  printProblem?: true;
  /** The numbers the order's dishes were sent under before they moved to it, lowest first;
   *  absent when there are none. */
  formerNumbers?: number[];
  items: StationQueueItem[];
  /** Present only when this station shows the rest of the order: the order's items at other stations, possibly none. */
  elsewhere?: ElsewhereItem[];
  /** This station's order-timing thresholds. Every group from one call shares them. */
  thresholds: StationThresholds;
  /** This order's own station's choice; a merged queue mixes stations. */
  bumpMode: BumpMode;
}
