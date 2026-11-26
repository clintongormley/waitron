import type { RecipientIdentifierType } from "@waitron/country";
import type {
  PartyAllergyRead,
  AllergySendTarget,
  AllergyCommand,
  AllergyPatch,
  AllergyMoveRead,
} from "@waitron/module";
import type {
  BillSetMenuState,
  DiscountNotice,
  ServedSetMenuCopy,
  Dining,
  JoinSide,
  TimingBand,
  TableSignal,
  DishMove,
} from "@waitron/shared";
import type { CloseDeferredRequest, CloseDeferredResult } from "./deferred-close-types.js";
import type { StaffMember } from "./device-session-api.js";
import type { UnsentDraft } from "./drafts-api.js";
import type {
  FinishTableResolution,
  FinishTableCollect,
  FinishTableAnswer,
} from "./finish-table-types.js";
import { type InvoiceDeliveryChoice, InvoiceDeliveryApi } from "./invoice-delivery-api.js";
import type { ReleaseReminder } from "./kitchen-api.js";
import type { ServiceZoneSummary, DiningChoice } from "./menu-api.js";
import type { BillEditExpected, KitchenNoteSnapshot } from "./order-types.js";
import type {
  TillSaleResult,
  UnpaidDepartureRequest,
  UnpaidDepartureResult,
} from "./payments-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

/** `POST /api/parties/:id/end-meal`: Print the bill, issuing one bill's ticket before payment.
 * `printAnyway` absent means false: dishes not yet served refuse `meal_end.unserved_dishes`. */
export interface EndMealRequest {
  billId: string;
  expectedPartyRevision: number;
  expectedEdits: BillEditExpected[];
  submissionId: string;
  printAnyway?: boolean;
}
/** A dish `meal_end.unserved_dishes` lists: `released` says the kitchen has it, so it can be
 * marked served. */
export interface MealEndUnservedDish {
  lineId: string;
  dishName: string;
  quantity: string;
  released: boolean;
}
/** The bill's ticket, for its whole total, and what it still owes. */
export interface EndedMeal {
  revision: number;
  workingOrderId: string;
  saleId: string;
  invoiceNumber: string;
  total: string;
  owed: string;
}
/** One active floor-plan zone from `GET /api/zones`. */
export interface FloorZone {
  closesAt: string | null;
  closed: boolean;
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  /** The zone's department has a floor plan set. */
  hasPlan: boolean;
  /** The name of the set today's plan was last reset from; null before the day's first reset. */
  layoutSetName: string | null;
  /** The layout Update layout offers; null when today's plan already follows the due one. */
  layoutDue: { setId: string; revision: number; periodName: string | null } | null;
  /** Null for a zone with no service policy. */
  serviceMode: ServiceZoneSummary["serviceMode"] | null;
}
/**
 * The party seated at a table (`TableState.party`). `outstanding` is what the party's open and placed
 * bills still owe, merged parties' bills included, as a two-place decimal string; `billCount` leaves
 * out abandoned bills; `tableIds` lists every table the party sits at, in the order they joined it.
 * `revision` is what a command that changes the party's tables or bills sends back.
 */
export interface TableParty {
  id: string;
  kitchenNote: KitchenNoteSnapshot;
  revision: number;
  guestCount: number | null;
  state: "open" | "closed";
  /** The name staff gave the party, or null. */
  name: string | null;
  /** `name`, or else the party's tables' shown names. */
  displayName: string;
  /**
   * The bill a table opens on: the lowest-numbered bill still owing, else the highest-numbered shown
   * bill, else null. A read for opening the screen only.
   */
  openingBillId: string | null;
  outstanding: string;
  billCount: number;
  tableIds: string[];
  /** Nonempty saved outboxes in the bill list’s order; `ownerName` is "" for an unknown person. */
  unsentDrafts: UnsentDraft[];
  /**
   * Null when the party's department has reminders off, no group is held, or the party is not
   * open.
   */
  reminder: ReleaseReminder | null;
}
/** A full-invoice customer as a merge names one: legal name and address are not compared. */
export interface InvoiceIdentity {
  taxId: string;
  identifierType?: RecipientIdentifierType;
  identifierCountryCode?: string;
}
/** Which bill's invoice a merged bill, or the bill every dish moves to, keeps, and each bill's
 * customer as the till read it; `into` is null when the receiving bill was simplified or new. */
export interface MergeInvoiceChoice {
  keep: "into" | "from";
  into: InvoiceIdentity | null;
  from: InvoiceIdentity;
}

export interface BillSetMenusReply {
  setMenus: BillSetMenuState;
  partyRevision: number;
}
/** One bill of a seated party from `GET /api/parties/:id/bills`. `outstanding` is zero on a settled or
 * abandoned bill; `receiptAvailable` says a sale was filed for it, so its receipt can be printed again. */
export interface PartyBill {
  setMenus?: BillSetMenuState;
  setMenuCopies?: ServedSetMenuCopy[];
  /** Absent when it has no open notice (D54). */
  discountNotices?: DiscountNotice[];
  workingOrderId: string;
  revision: number;
  /** The bill's own way, whatever its department now says. */
  dining: Dining;
  diningChoice: DiningChoice;
  invoiceType: "F1" | "F2";
  invoiceDelivery?: InvoiceDeliveryChoice;
  recipient: {
    taxId: string;
    legalName: string;
    address: string;
    countryCode: string;
    identifierType?: RecipientIdentifierType;
    identifierCountryCode?: string;
  } | null;
  partyId: string;
  label: string | null;
  /** The number the bill holds at its table; null when the bill is abandoned, or when a bill at a
   * table was stored with none, which is a fault in Waitron. */
  billNumber: number | null;
  /** The name staff gave the bill; null when it has none. */
  billName: string | null;
  status: "open" | "placed" | "settled" | "abandoned";
  leftUnpaid?: boolean;
  total: string;
  outstanding: string;
  overpaid?: string;
  /** A payment is pending or received on the bill, which the single payment refuses. */
  hasPayments: boolean;
  /** The bill holds money: a pending payment, or received money not all given back. A close as a
   * deferred payment refuses such a bill. */
  holdsMoney?: true;
  receiptAvailable: boolean;
  /** The language the bill's sale was filed in, else the one staff chose for it; absent when
   * neither is set. */
  receiptLanguage?: string;
  /** The issued invoice's number ("A/1"); absent while no sale is filed. */
  invoiceNumber?: string;
  /** The numbers of the correctives correcting the invoice, oldest first; absent while no sale is
   * filed. */
  correctives?: string[];
  /** Its sale's total plus its correctives, whether or not the bill has been paid, or 0.00 once the
   * sale is voided; absent while no sale is filed. */
  amountDue?: string;
  /** The bill was closed as a deferred payment: the customer pays outside Waitron. */
  deferred?: true;
  /** The printed bill this one was reopened from, by Reopen bill or by Pay for items on a printed bill; absent on any other bill. */
  reopenedFrom?: string;
}

export interface JoinMerge {
  moving: string;
  target: string;
  side: JoinSide;
  seats: number;
}
/**
 * What Move guests and Join tables send of the parties the till read (D19): the moving party's
 * revision, and what it read at the target table. `otherPartyId` is the party seated there, sent with
 * its revision, or null for a table read free; both are left out for a table of the party itself.
 */
export interface TableActionRevisions {
  expectedEdits: BillEditExpected[];
  expectedPartyRevision: number;
  otherPartyId?: string | null;
  expectedOtherPartyRevision?: number;
}
/** A move or join's answer: the party the guests are in now and its bills, in number order; no
 * bill is merged. `zoneRevisions` carries the revisions when a room changed. */
export interface TableActionResult {
  partyId: string;
  billIds: string[];
  zoneRevisions?: Record<string, number>;
}
/** Which bills go whole, and which dishes go loose, to the party Split a table starts. */
export interface SplitSelection {
  wholeBillIds: string[];
  loose: { billId: string; lineIds: string[] }[];
}
/** What a bill action sends of the party the till read the bill under: its revision and its id. Both
 * are left out for a bill of no party. */
export interface BillRevisions {
  expectedPartyRevision?: number;
  partyId?: string;
}
/** Where Move a bill sends a bill: a table, or the counter in the counter's zone (null for none). */
export type MoveBillTarget = { tableId: string } | { counter: { zoneId: string | null } };
/** Move a bill's revisions; `partyId` is null for a bill read with no party, as a counter order. */
export interface MoveBillRevisions
  extends
    Omit<BillRevisions, "partyId">,
    Pick<TableActionRevisions, "otherPartyId" | "expectedOtherPartyRevision"> {
  partyId?: string | null;
  expectedEdits: BillEditExpected[];
}
/** A move's answer: the party the bill is in now (null at the counter), and the bill, which arrives
 * as a bill of its own. */
export interface MoveBillResult {
  partyId: string | null;
  billId: string;
  /** Present when seating a Counter order issued its invoice. */
  invoice?: TillSaleResult;
  /** Present when seating a Counter order changed its set menus and left it paid over its total: by
   * how much. */
  overpaid?: string;
}
/** Whole grid squares; `x` and `y` name the unrotated table's top-left corner. */
export interface TodayPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: "rect" | "round";
  rotation: number;
}

export interface TableToday {
  /** `null` for an unplaced spare, or a table taken off. */
  placement: TodayPlacement | null;
  seats: number | null;
  fixed: boolean;
  takenOff: boolean;
  joinId: string | null;
  joinSeats: number | null;
  /** The revision of this table's room, sent back with each change to today's floor. */
  zoneRevision: number;
  /** This table's name for today. Optional so hand-built fixtures need not say it; the server always does. */
  name?: string | null;
  /** Its group's name for today, on every member. */
  joinName?: string | null;
  /** A reset left its change waiting until someone marks it moved. Optional so hand-built fixtures
   * need not say it; the server always does. */
  needsMoving?: boolean;
}
/** A change to today's floor answers its room's new revision. */
export interface FloorAnswer {
  zoneId: string;
  revision: number;
}

export interface TableState {
  id: string;
  label: string;
  /** The table's saved short name, else its full name. */
  shortName: string;
  zoneId: string | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  /** `held` while a party holds the table; `needs_clearing` after Finish table with the clearing
   * setting on, until Mark cleared. */
  condition: "free" | "held" | "needs_clearing";
  tabLineCount?: number;
  tabTotal?: string;
  pendingDeliveries: number;
  pendingToServe: number;
  readyToServe: number;
  /**
   * The worst age band across the unserved lines fired to, or waiting for the pass at, a kitchen
   * station (not made here) of every bill of the party's family that is not abandoned, paid ones
   * included (a held dish does not age here); `"fresh"` for a free table. Only the REDUCED band is
   * sent, not the per-line ages and thresholds, so the floor cannot re-derive it locally: it is
   * fixed until the next `getTablesState` fetch.
   */
  timingBand: TimingBand;
  /**
   * The table's next imminent `booked` reservation today, or `null`. Only `time` (venue-local "HH:MM")
   * is projected, so the party size and contact name are deliberately kept off every till device.
   */
  nextReservation: { time: string } | null;
  /** `null` when the table has no today's row. */
  today: TableToday | null;
  party: TableParty | null;
  hasAllergy?: true;
  /** One of the party's bills was closed as a deferred payment. */
  hasDeferredBill?: true;
  /** What wants attention at the table; several at once. */
  signals: TableSignal[];
}
/** `POST /api/tables/:id/seat` success — the new party, its tab and the tab's order number. */
export interface SeatResult {
  kitchenNote?: KitchenNoteSnapshot;
  partyId: string;
  tabId: string;
  revision: number;
  orderNumber: number;
}

export class FloorApi extends InvoiceDeliveryApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  // --- Live floor. ---

  /** The venue's ACTIVE floor-plan zones, by display order → `GET /api/zones`. */
  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/api/zones", "GET");
  }
  /** The live-floor occupancy read-model → `GET /api/tables/state`, one row per active table. */
  getTablesState(options: ReadOptions = {}): Promise<TableState[]> {
    return this.#request<TableState[]>("/api/tables/state", "GET", undefined, options.signal);
  }
  /**
   * Seat a party at a free table → `POST /api/tables/:tableId/seat`, which opens its tab. `guestCount`
   * is sent as an explicit null when none was given. A table a party already holds rejects
   * `tab.already_open`; `table.not_found`, `table.inactive` and `table.needs_clearing` surface as a
   * rejected `{ code }`.
   */
  seatTable(
    tableId: string,
    guestCount: number | null,
    kitchenNote?: string | null,
  ): Promise<SeatResult> {
    return this.#request<SeatResult>(`/api/tables/${tableId}/seat`, "POST", {
      guestCount,
      ...(kitchenNote === undefined ? {} : { kitchenNote }),
    });
  }
  /** Seat a party at `tableId` and, in the same request, at each of `withTableIds`. */
  seatAtTables(
    tableId: string,
    guestCount: number | null,
    withTableIds: readonly string[],
    kitchenNote?: string | null,
  ): Promise<SeatResult> {
    return this.#request<SeatResult>(`/api/tables/${tableId}/seat`, "POST", {
      guestCount,
      withTableIds,
      ...(kitchenNote === undefined ? {} : { kitchenNote }),
    });
  }
  finishTable(
    partyId: string,
    expectedPartyRevision: number,
    expectedEdits: BillEditExpected[],
    resolution?: FinishTableResolution | FinishTableCollect,
    options: ReadOptions = {},
  ): Promise<FinishTableAnswer> {
    return this.#request(
      `/api/parties/${partyId}/finish`,
      "POST",
      {
        expectedPartyRevision,
        expectedEdits,
        ...resolution,
      },
      options.signal,
    );
  }
  recordUnpaidDeparture(
    partyId: string,
    request: UnpaidDepartureRequest,
    options: ReadOptions = {},
  ): Promise<UnpaidDepartureResult> {
    return this.#request(
      `/api/parties/${partyId}/unpaid-departure`,
      "POST",
      request,
      options.signal,
    );
  }
  endMeal(partyId: string, request: EndMealRequest, options: ReadOptions = {}): Promise<EndedMeal> {
    return this.#request(`/api/parties/${partyId}/end-meal`, "POST", request, options.signal);
  }
  /** Who may approve an unpaid departure → `GET /api/unpaid-departure-authorizers`. */
  listUnpaidDepartureAuthorizers(options: ReadOptions = {}): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>(
      "/api/unpaid-departure-authorizers",
      "GET",
      undefined,
      options.signal,
    );
  }
  closeDeferred(billId: string, request: CloseDeferredRequest): Promise<CloseDeferredResult> {
    return this.#request(
      `/api/working-orders/${encodeURIComponent(billId)}/close-deferred`,
      "POST",
      request,
    );
  }
  /** The answer the bill's deferred close gave; `null` while the bill is not closed that way. */
  getDeferredClosure(
    billId: string,
    options: ReadOptions = {},
  ): Promise<{ closure: CloseDeferredResult | null }> {
    return this.#request(
      `/api/working-orders/${encodeURIComponent(billId)}/deferred-closure`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** Free a table that needs clearing → `POST /api/tables/:tableId/cleared`. A table that does not
   * need it is left as it is; rejects `table.not_found`. */
  async markTableCleared(tableId: string): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/cleared`, "POST");
  }
  /** Mark a party's service step done → `POST /api/parties/:partyId/service-steps/:stepId/done`,
   * for the showing of it due at `dueAt`, as the floor read sent it. Answers the steps it cleared,
   * none when that showing was already cleared; rejects `service_step.not_found`. */
  markServiceStepDone(
    partyId: string,
    stepId: string,
    dueAt: string,
  ): Promise<{ cleared: string[] }> {
    return this.#request<{ cleared: string[] }>(
      `/api/parties/${encodeURIComponent(partyId)}/service-steps/${encodeURIComponent(stepId)}/done`,
      "POST",
      { dueAt },
    );
  }
  /** Every bill of a party, merged parties' included → `GET /api/parties/:partyId/bills`. */
  getPartyBills(partyId: string): Promise<PartyBill[]> {
    return this.#request<PartyBill[]>(`/api/parties/${partyId}/bills`, "GET");
  }
  readPartyAllergy(partyId: string, options: ReadOptions = {}): Promise<PartyAllergyRead> {
    return this.#request(`/api/parties/${partyId}/allergy`, "GET", undefined, options.signal);
  }
  previewPartyAllergy(
    partyId: string,
    target: AllergySendTarget,
    options: ReadOptions = {},
  ): Promise<PartyAllergyRead> {
    return this.#request(
      `/api/parties/${partyId}/allergy/send-preview`,
      "POST",
      target,
      options.signal,
    );
  }
  savePartyAllergy(
    partyId: string,
    command: AllergyCommand,
    options: ReadOptions = {},
  ): Promise<PartyAllergyRead> {
    return this.#request(`/api/parties/${partyId}/allergy`, "PUT", command, options.signal);
  }
  /**
   * The party moves off all its tables to `toTableId` → `POST /api/parties/:id/move`. At a table
   * another party holds the two become one, keeping every bill. Rejects,
   * among others, `table.needs_clearing`, `table.already_in_party`, `table.inactive`,
   * `service_zone.mode_incompatible`, `party.not_open` and `party.out_of_date`.
   */
  moveGuests(
    partyId: string,
    toTableId: string,
    revisions: TableActionRevisions,
  ): Promise<TableActionResult> {
    return this.#request(`/api/parties/${partyId}/move`, "POST", { toTableId, ...revisions });
  }
  /**
   * Move a whole bill to a table or the counter → `POST /api/bills/:id/move`; it arrives as a bill
   * of its own. Rejects, among others, `bill.paid`, `group.held_leaves_party`,
   * `table.needs_clearing`, `table.already_in_party` and `party.out_of_date`.
   */
  moveBill(
    billId: string,
    to: MoveBillTarget,
    revisions: MoveBillRevisions,
    command?: { submissionId: string; allergy: AllergyPatch },
    options: ReadOptions = {},
  ): Promise<MoveBillResult> {
    return this.#request(
      `/api/bills/${billId}/move`,
      "POST",
      { to, ...revisions, ...command },
      options.signal,
    );
  }
  previewBillMoveAllergy(
    billId: string,
    to: MoveBillTarget,
    revisions: MoveBillRevisions,
    options: ReadOptions = {},
  ): Promise<AllergyMoveRead> {
    return this.#request(
      `/api/bills/${billId}/move/allergy-preview`,
      "POST",
      { to, ...revisions },
      options.signal,
    );
  }
  /**
   * `tableId` joins the party → `POST /api/parties/:id/join`; a party seated there joins with every
   * table it holds. Rejects as {@link moveGuests} does, and `service_zone.join_mismatch`; with a
   * merge, also `floor_today.out_of_date` when the room has changed since `zoneRevision`.
   */
  joinTables(
    partyId: string,
    tableId: string,
    revisions: TableActionRevisions,
    merge?: JoinMerge & { zoneRevision: number },
  ): Promise<TableActionResult> {
    if (merge === undefined) {
      return this.#request(`/api/parties/${partyId}/join`, "POST", { tableId, ...revisions });
    }
    const { zoneRevision, ...shape } = merge;
    return this.#request(`/api/parties/${partyId}/join`, "POST", {
      tableId,
      ...revisions,
      merge: shape,
      zoneRevision,
    });
  }
  // --- Today's plan: each sends the room's revision and answers the room's new one. ---

  /** Move a table, with its merge, to a new top-left corner → `POST /api/tables/:id/today/move`. */
  moveToday(
    tableId: string,
    at: { x: number; y: number },
    zoneRevision: number,
  ): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "move", { x: at.x, y: at.y }, zoneRevision);
  }
  /** Turn a table 15° more, clockwise → `POST /api/tables/:id/today/rotate`. */
  rotateToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "rotate", {}, zoneRevision);
  }
  /** Take a table off the floor for today → `POST /api/tables/:id/today/take-off`. */
  takeOffToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "take-off", {}, zoneRevision);
  }
  /** Put a taken-off table back → `POST /api/tables/:id/today/put-back`. */
  putBackToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "put-back", {}, zoneRevision);
  }
  /** Put a spare on the map at a corner → `POST /api/tables/:id/today/place`. */
  placeSpareToday(
    tableId: string,
    at: { x: number; y: number },
    zoneRevision: number,
  ): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "place", { x: at.x, y: at.y }, zoneRevision);
  }
  /** A table's seats for today, or its merge's → `POST /api/tables/:id/today/seats`. */
  setSeatsToday(tableId: string, seats: number, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "seats", { seats }, zoneRevision);
  }
  /** A table's or its group's name for today; null clears it → `POST /api/tables/:id/today/name`. */
  nameToday(tableId: string, name: string | null, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "name", { name }, zoneRevision);
  }
  /** Put a table back as the last reset left it → `POST /api/tables/:id/today/back`. */
  backToSavedToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "back", {}, zoneRevision);
  }
  /** Apply the change a reset left waiting for a table that needs moving →
   * `POST /api/tables/:id/today/mark-moved`. */
  markMovedToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "mark-moved", {}, zoneRevision);
  }
  /** Keep a table that needs moving where it stands until the next reset →
   * `POST /api/tables/:id/today/leave-here`. */
  leaveHereToday(tableId: string, zoneRevision: number): Promise<FloorAnswer> {
    return this.#todayChange(tableId, "leave-here", {}, zoneRevision);
  }
  /** Merge two free tables, `tableId` moving against `targetId` → `POST /api/tables/:id/today/merge`. */
  mergeToday(
    tableId: string,
    merge: { targetId: string; side: JoinSide; seats: number },
    zoneRevision: number,
  ): Promise<FloorAnswer> {
    return this.#todayChange(
      tableId,
      "merge",
      { targetId: merge.targetId, side: merge.side, seats: merge.seats },
      zoneRevision,
    );
  }
  splitOffToday(
    tableId: string,
    split: {
      partIds: string[];
      seats?: number;
      expectedParties: Pick<TableParty, "id" | "revision">[];
    },
    zoneRevision: number,
  ): Promise<FloorAnswer> {
    return this.#todayChange(
      tableId,
      "split-off",
      {
        partIds: split.partIds,
        expectedParties: split.expectedParties,
        ...(split.seats === undefined ? {} : { seats: split.seats }),
      },
      zoneRevision,
    );
  }
  /** Reset a zone onto the set today's plan was last made from → `POST /api/zones/:id/today/reset`. `zoneRevision` is null when
   * the floor read held no table of the zone with a today's row. */
  resetZoneToday(zoneId: string, zoneRevision: number | null): Promise<FloorAnswer> {
    return this.#request<FloorAnswer>(`/api/zones/${zoneId}/today/reset`, "POST", {
      zoneRevision,
    });
  }
  /** Reset a zone onto the layout its banner offers → `POST /api/zones/:id/today/update-layout`. */
  updateLayoutToday(
    zoneId: string,
    offer: { setId: string; revision: number },
    zoneRevision: number | null,
  ): Promise<FloorAnswer> {
    return this.#request<FloorAnswer>(`/api/zones/${zoneId}/today/update-layout`, "POST", {
      setId: offer.setId,
      layoutRevision: offer.revision,
      zoneRevision,
    });
  }
  #todayChange(
    tableId: string,
    change: string,
    body: object,
    zoneRevision: number,
  ): Promise<FloorAnswer> {
    return this.#request<FloorAnswer>(`/api/tables/${tableId}/today/${change}`, "POST", {
      ...body,
      zoneRevision,
    });
  }
  /**
   * `tableId` leaves the party and a new party starts there with the selection's whole bills and a
   * new bill holding its loose dishes, or a new empty bill when nothing is selected →
   * `POST /api/parties/:id/split-table`, answering the new party and its bills in number order.
   * `guestCounts`, when given, is each side's guest count afterwards; without it the staying party
   * keeps its count. Rejects, among others, `table.not_shared`, `table.not_joined` and
   * `party.out_of_date`.
   */
  splitTable(
    partyId: string,
    tableId: string,
    selection: SplitSelection,
    expectedPartyRevision: number,
    expectedEdits: BillEditExpected[],
    guestCounts?: { staying: number | null; leaving: number | null },
  ): Promise<{
    partyId: string;
    billIds: string[];
    zoneRevisions?: Record<string, number>;
  }> {
    return this.#request(`/api/parties/${partyId}/split-table`, "POST", {
      tableId,
      selection,
      expectedPartyRevision,
      expectedEdits,
      ...(guestCounts === undefined ? {} : { guestCounts }),
    });
  }
  /** A new empty bill on the party → `POST /api/parties/:id/bills`, answering it and the party's new
   * revision. Rejects, among others, `party.not_open` and `party.out_of_date`. */
  createPartyBill(
    partyId: string,
    expectedPartyRevision: number,
  ): Promise<{ billId: string; revision: number }> {
    return this.#request(`/api/parties/${partyId}/bills`, "POST", { expectedPartyRevision });
  }
  /** Name the party, or clear its name with null → `PUT /api/parties/:id/name`. A name over 40
   * characters is `management.request_invalid` naming the field `name`. */
  setPartyName(
    partyId: string,
    name: string | null,
    expectedPartyRevision: number,
  ): Promise<{ revision: number; name: string | null }> {
    return this.#request(`/api/parties/${partyId}/name`, "PUT", { name, expectedPartyRevision });
  }
  /** Set the party's guest count, or clear it with null → `PUT /api/parties/:id/guests`. A count
   * that is not a whole number from 1 to 999 is `management.request_invalid` naming the field
   * `guestCount`. */
  setPartyGuestCount(
    partyId: string,
    guestCount: number | null,
    expectedPartyRevision: number,
  ): Promise<{ revision: number; guestCount: number | null }> {
    return this.#request(`/api/parties/${partyId}/guests`, "PUT", {
      guestCount,
      expectedPartyRevision,
    });
  }
  setSetMenuCount(
    billId: string,
    setMenuId: string,
    count: number,
    expectedPartyRevision: number,
    expectedEdit: BillEditExpected | null,
  ): Promise<BillSetMenusReply> {
    return this.#request(`/api/bills/${billId}/set-menus/${setMenuId}`, "PUT", {
      count,
      expectedPartyRevision,
      expectedEdit,
    });
  }
  removeSetMenu(
    billId: string,
    lineId: string,
    expectedPartyRevision: number,
    expectedEdit: BillEditExpected | null,
  ): Promise<BillSetMenusReply> {
    return this.#request(`/api/bills/${billId}/set-menu-lines/${lineId}`, "DELETE", {
      expectedPartyRevision,
      expectedEdit,
    });
  }
  moveSetMenuDishes(
    billId: string,
    moves: readonly DishMove[],
    expectedPartyRevision: number,
    expectedEdit: BillEditExpected | null,
  ): Promise<BillSetMenusReply> {
    return this.#request(`/api/bills/${billId}/set-menu-moves`, "POST", {
      moves,
      expectedPartyRevision,
      expectedEdit,
    });
  }
  /**
   * Name a bill, or clear its name with null or "" → `PUT /api/bills/:id/name`, answering the
   * party's revision and the bill's number and name. Rejects, among others, a name over 40
   * characters as `management.request_invalid` naming the field `name`; unsent dishes another person
   * is editing on the bill as `draft.taken_over`, until this person takes the bill over; a stale
   * editor expectation as `draft.out_of_date`; and `party.out_of_date`.
   */
  setBillName(
    billId: string,
    name: string | null,
    revisions: Required<BillRevisions> & { expectedEdit: BillEditExpected },
  ): Promise<{ revision: number; billNumber: number | null; billName: string | null }> {
    return this.#request(`/api/bills/${billId}/name`, "PUT", { name, ...revisions });
  }
  /**
   * The source has no payments; payments on the receiving open bill stay with it. `invoiceChoice` is
   * sent only when given: the server refuses a `null` one as malformed.
   */
  async mergeBills(
    intoBillId: string,
    fromBillId: string,
    revisions: BillRevisions & { expectedEdits: BillEditExpected[] },
    invoiceChoice?: MergeInvoiceChoice,
  ): Promise<void> {
    await this.#request<void>(`/api/bills/${intoBillId}/merge`, "POST", {
      fromBillId,
      ...revisions,
      ...(invoiceChoice === undefined ? {} : { invoiceChoice }),
    });
  }
  /**
   * Move whole dishes, named by line id, from one bill of a party to another, or to a new bill of
   * the party when `toBillId` is null → `POST /api/bills/:fromBillId/move-dishes`, answering the
   * bill they went to. Rejects, among others, `bill.received_exceeds_total`,
   * `tab.line_not_found`, `draft.taken_over`, `party.out_of_date` and `sale.empty_basket`.
   * `invoiceChoice` answers `bill.merge_invoice_choice_required` for a move that takes every dish,
   * and is sent only when given, as {@link mergeBills} sends it.
   */
  moveDishes(
    fromBillId: string,
    lineIds: readonly string[],
    toBillId: string | null,
    revisions: BillRevisions & { expectedEdits: BillEditExpected[] },
    invoiceChoice?: MergeInvoiceChoice,
  ): Promise<{ billId: string; invoice?: TillSaleResult }> {
    return this.#request(`/api/bills/${fromBillId}/move-dishes`, "POST", {
      lineIds,
      toBillId,
      ...revisions,
      ...(invoiceChoice === undefined ? {} : { invoiceChoice }),
    });
  }
}
