import type { RecipientIdentifierType } from "@waitron/country";
import type { AllergyCommand } from "@waitron/module";
import type {
  KitchenSignal,
  Dining,
  BillSetMenuState,
  DiscountNotice,
  PendingDiscountView,
  ServedSetMenuCopy,
  OptionSnapshot,
  OptionSelection,
  ExtraSelection,
} from "@waitron/shared";
import type { StaffMember } from "./device-session-api.js";
import type { LateSend, DeadEndAnswer, BillRequestCommand } from "./drafts-api.js";
import { type PartyBill, FloorApi } from "./floor-api.js";
import type { InvoiceDeliveryChoice } from "./invoice-delivery-api.js";
import type { CancellationRead, CancelItemRequest, CancelItemAnswer } from "./line-cancel-types.js";
import type { DiningChoice, TillProduct } from "./menu-api.js";
import type {
  BillEditExpected,
  KitchenNoteSnapshot,
  SaleLine,
  KitchenNoteScope,
  GroupCommand,
} from "./order-types.js";
import type { TillSaleResult, BillParty } from "./payments-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

/** What a cancel filed for a bill's receipt: its cancellation, or a corrective that credits it. */
export type CancelFiled = "cancellation" | "corrective" | null;

/** An order's dishes: `ordered` counts the order's dishes less cancellations, extras left out and a
 * dish not sold by the unit as one; the rest count those not yet served by where they stand. */
export interface OrderStateCounts {
  ordered: number;
  unsent: number;
  held: number;
  waiting: number;
  ready: number;
}

export interface OrderPreviewItem {
  lineId: string;
  name: string;
  quantity: string;
  note: string | null;
  extras: { lineId: string; name: string; quantity: string }[];
}
/** `GET /api/orders/counter-waiting`: a counter order the counter is still waiting on. A `placed`
 * one was sent and not paid, and was handed over when `collectedAt` is set; a `settled` one was paid,
 * or closed as a deferred payment (`closedDeferred`), and not handed over. `canHandOver` says
 * whether `TillApi.markCollected` would accept it now. */
export interface CounterWaitingOrder {
  items: OrderPreviewItem[];
  id: string;
  orderNumber: number;
  label: string | null;
  tableLabel?: string;
  counter?: true;
  status: "placed" | "settled";
  openedAt: string;
  settledAt: string | null;
  readyAt: string | null;
  zoneId: string | null;
  collectedAt: string | null;
  /** What collecting a placed order charges, correctives included. */
  total: string;
  counts: OrderStateCounts;
  canHandOver: boolean;
  /** A placed order's own service mode, frozen when it was opened, or `prepay` when it has none;
   * null on a settled one. */
  serviceMode: OrderFlow | "table_tab" | null;
  /** Only on a placed order whose invoice is issued: its number ("A/12"). */
  invoiceNumber?: string;
  /** A settled order's dishes that can still move to another station, in line order; empty on a
   * placed one. */
  movableDishes: { lineId: string; stationId: string }[];
  /** The numbers the order's dishes were sent under before they moved to it, lowest first;
   *  absent when there are none. */
  formerNumbers?: number[];
  /** Only on a settled order closed as a deferred payment. */
  closedDeferred?: true;
}
/**
 * One row of `GET /api/working-orders` — an open bill, a party's bill included. `total` is the GROSS
 * (VAT-inclusive) draft total; `label` is null when neither the operator nor a move to the counter
 * gave one.
 */
export interface HeldOrderSummary {
  items: OrderPreviewItem[];
  id: string;
  orderNumber: number;
  label: string | null;
  tableLabel?: string;
  counter?: true;
  counts: OrderStateCounts;
  total: string;
  /** `total` less the money the bill has received. */
  outstanding: string;
  /** A payment is pending or received on the bill, which the counter's single payment refuses. */
  hasPayments: boolean;
  /** Null for a counter order; a party's own bill is listed too. */
  partyId: string | null;
  /** The number the bill holds at its table; null for a counter order, or a fault in Waitron. */
  billNumber: number | null;
  /** The name staff gave the bill at its table; null for a counter order or an unnamed bill. */
  billName: string | null;
  openedAt: string;
  /** The service zone the order is recorded in; null for one with none. */
  zoneId: string | null;
  /** The bill's own dishes ready at a station, and its long wait. */
  signals: KitchenSignal[];
  /** The numbers the order's dishes were sent under before they moved to it, lowest first;
   *  absent when there are none. */
  formerNumbers?: number[];
}
/**
 * One CHILD line of a retrieved held order's dish: the picked product, its three frozen names, the
 * price it was sold at, how many of it this dish takes, and the list it was picked from.
 */
export interface HeldExtra {
  productId: string | null;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  price: string;
  quantity: number;
  listId: string | null;
}
/**
 * `GET /api/working-orders/:id` — a retrieved parked order: its stored inputs and commercial snapshots,
 * enough to rebuild its basket even when a line's live offer is no longer available. `quantity` is a
 * three-place decimal string ("2.000").
 */
export interface HeldOrder {
  id: string;
  serviceMode?: OrderFlow | "table_tab" | null;
  /** The service zone the order is recorded in; null for one with none. */
  zoneId: string | null;
  expectedEdit: BillEditExpected | null;
  kitchenNote: KitchenNoteSnapshot;
  orderNumber: number;
  label: string | null;
  billName?: string;
  /** What a save of this copy sends back, so a save from a copy since changed is refused. */
  revision: number;
  /** The receipt language staff chose for the order; absent while the venue's own applies. */
  receiptLanguage?: string;
  /** The invoice the order is set to issue: `F1` once a full invoice has been chosen for it. */
  invoiceType: "F1" | "F2";
  /** The customer a full invoice names; absent on a simplified invoice or one without a customer. */
  recipient?: NonNullable<PartyBill["recipient"]>;
  /** How the invoice is to be delivered; absent while no delivery has been chosen. */
  invoiceDelivery?: InvoiceDeliveryChoice;
  /** Only on a placed order whose invoice is issued. */
  invoiced?: true;
  /** The order's own way, whatever its department now says. */
  dining: Dining;
  diningChoice: DiningChoice;
  setMenus?: BillSetMenuState;
  setMenuCopies?: ServedSetMenuCopy[];
  /** Absent when it has no open notice (D54). */
  discountNotices?: DiscountNotice[];
  /** Its pending discounts; none on a settled or abandoned bill. */
  discounts: PendingDiscountView[];
  lines: (Omit<SaleLine, "extras" | "options"> & {
    productId?: string;
    /**
     * What each CHILD line of this dish froze, with `quantity` per dish. An edit turns them back into
     * a selection against the dish's live offer (`deriveExtraSelections`, `../state/held-extras.ts`).
     */
    extras?: HeldExtra[];
    product?: TillProduct;
    /**
     * The dish's recorded answers with the original list id and six frozen names.
     * The till rebuilds a selection only when that list still offers the recorded staff wording.
     */
    optionSnapshots?: OptionSnapshot[];
  })[];
}

export type OrderFlow = "prepay" | "ticket_then_pay";

export interface PlaceOrderResult {
  id: string;
  status: "placed";
}
/** One dish line's edit. An absent field keeps the line's own; a null `note` clears it; `options` and
 * `extras`, when present, replace the line's whole set. */
export interface OrderLinePatch {
  quantity?: string;
  note?: string | null;
  options?: OptionSelection[];
  extras?: ExtraSelection[];
  makeAt?: string | null;
  /** The other line numbers of the same Sent row, changed in the same save. `quantity` is the
   * row's total, a whole number no lower than it is now; a weighed dish leaves `quantity` out. */
  portionLineNos: number[];
}

export class OrdersApi extends FloorApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  getKitchenNote(scope: KitchenNoteScope, options: ReadOptions = {}): Promise<KitchenNoteSnapshot> {
    const path =
      "partyId" in scope
        ? `/api/parties/${scope.partyId}`
        : `/api/working-orders/${scope.workingOrderId}`;
    return this.#request(`${path}/kitchen-note`, "GET", undefined, options.signal);
  }
  setKitchenNote(
    scope: KitchenNoteScope,
    request: {
      submissionId: string;
      expectedNoteRevision: number;
      note: string | null;
      expectedPartyRevision?: number;
      expectedOrderRevision?: number;
      partyId?: null;
    },
  ): Promise<KitchenNoteSnapshot> {
    const path =
      "partyId" in scope
        ? `/api/parties/${scope.partyId}`
        : `/api/working-orders/${scope.workingOrderId}`;
    return this.#request(`${path}/kitchen-note`, "PUT", request);
  }
  setOrderInvoiceChoice(
    id: string,
    choice: {
      expectedEdit: BillEditExpected | null;
      revision: number;
      invoiceType: "F1" | "F2";
      recipient: {
        taxId: string;
        legalName: string;
        address: string;
        countryCode: string;
        identifierType?: RecipientIdentifierType;
        identifierCountryCode?: string;
      } | null;
      delivery?: InvoiceDeliveryChoice;
    },
  ): Promise<{ revision: number }> {
    return this.#request<{ revision: number }>(
      `/api/working-orders/${id}/invoice-choice`,
      "PUT",
      choice,
    );
  }
  /** Save the language the order's receipt prints in, one of `TillInfo.receiptLanguages`;
   * `null` goes back to the venue's own → `PUT /api/working-orders/:id/receipt-language`. */
  setOrderReceiptLanguage(
    id: string,
    choice: { revision: number; language: string | null; expectedEdit: BillEditExpected | null },
  ): Promise<{ revision: number }> {
    return this.#request<{ revision: number }>(
      `/api/working-orders/${id}/receipt-language`,
      "PUT",
      choice,
    );
  }
  /**
   * The cross-till held list → `GET /api/working-orders`: every OPEN working order in the venue,
   * except those in zones this device's profile does not allow.
   */
  listWorkingOrders(options: ReadOptions = {}): Promise<HeldOrderSummary[]> {
    return this.#request<HeldOrderSummary[]>(
      "/api/working-orders",
      "GET",
      undefined,
      options.signal,
    );
  }
  /**
   * Retrieve one parked order → `GET /api/working-orders/:id`. An id naming no OPEN order rejects with
   * `working_order.not_found`.
   */
  retrieveWorkingOrder(id: string, options: ReadOptions = {}): Promise<HeldOrder> {
    return this.#request<HeldOrder>(`/api/working-orders/${id}`, "GET", undefined, options.signal);
  }
  /** A counter order sent without payment, read as {@link retrieveWorkingOrder} reads an open one →
   * `GET /api/working-orders/:id/placed`. Any other id rejects with `working_order.not_found`. */
  retrievePlacedOrder(id: string, options: ReadOptions = {}): Promise<HeldOrder> {
    return this.#request<HeldOrder>(
      `/api/working-orders/${id}/placed`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /**
   * Edit a parked order → `PUT /api/working-orders/:id`. A full REPLACEMENT: the sent `lines` and
   * `label` become the order's new state (`label` absent clears it). Only an `open` order may change
   * (else `working_order.not_open`), and only from the copy at its current `revision` (else
   * `working_order.out_of_date`). Resolves the revision the order is at after the save, which a save
   * that changed nothing leaves where it was.
   */
  updateWorkingOrder(
    id: string,
    req: {
      lines: SaleLine[];
      label?: string;
      revision: number;
      expectedEdit: BillEditExpected | null;
      dining: Dining;
      lateSend?: LateSend;
      closedZoneId?: string;
    },
  ): Promise<{ revision: number; invoice?: TillSaleResult }> {
    return this.#request<{ revision: number; invoice?: TillSaleResult }>(
      `/api/working-orders/${id}`,
      "PUT",
      req,
    );
  }
  /** Switch a saved order between eaten here and takeaway → `PUT /api/working-orders/:id/dining`.
   * Rejects, among others, `order.dining_fixed`, `order.dining_locked`
   * and `working_order.out_of_date`. */
  switchDining(
    orderId: string,
    dining: Dining,
    revision: number,
    expectedEdit: BillEditExpected | null,
  ): Promise<{ revision: number }> {
    return this.#request<{ revision: number }>(`/api/working-orders/${orderId}/dining`, "PUT", {
      dining,
      revision,
      expectedEdit,
    });
  }
  setWorkingOrderLabel(
    id: string,
    req: { label: string; revision: number; expectedEdit: BillEditExpected | null },
  ): Promise<{ revision: number }> {
    return this.#request<{ revision: number }>(`/api/working-orders/${id}/label`, "PUT", req);
  }
  /**
   * Edit ONE dish line of an open order → `PUT /api/working-orders/:orderId/lines/:lineNo`, from the
   * copy read at `revision`. An absent optional field keeps the line's own; the change goes to
   * every dish of the observed Sent row. Resolves the revision the order is at after the edit,
   * and its party's.
   */
  updateOrderLine(
    orderId: string,
    lineNo: number,
    patch: OrderLinePatch,
    revision: number,
    expectedEdit: BillEditExpected | null,
    /** Confirms the extras the change adds to a dish whose period ended earlier today. */
    lateSend?: LateSend,
    closedZoneId?: string,
  ): Promise<{ revision: number; party: BillParty; invoice?: TillSaleResult }> {
    return this.#request<{ revision: number; party: BillParty; invoice?: TillSaleResult }>(
      `/api/working-orders/${orderId}/lines/${lineNo}`,
      "PUT",
      {
        ...patch,
        revision,
        expectedEdit,
        ...(lateSend === undefined ? {} : { lateSend }),
        ...(closedZoneId === undefined ? {} : { closedZoneId }),
      },
    );
  }
  /**
   * Discard a parked order (`open → abandoned`) → `DELETE /api/working-orders/:id`. Rejects first
   * `bill.refund_in_progress` while a card refund on it is pending, `order.payment_in_flight` while
   * a card payment is under way, and `bill.payments_received` while it holds money from a payment;
   * otherwise `working_order.not_open` for a non-open or unknown id. So a non-open order that
   * still holds money answers `bill.payments_received`.
   */
  async abandonWorkingOrder(id: string, expectedEdit: BillEditExpected | null): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}`, "DELETE", { expectedEdit });
  }
  /**
   * Place a working order → `POST /api/working-orders/:id/place` (`open → placed`): freezes its
   * composition and opens its amendment log. An identical retry returns the saved placed result,
   * except while a full-disk stop holds, when every placement, a retry included, rejects with
   * `storage.disk_full`.
   * A different placement rejects with `submission.id_reused`; an absent order or one closed
   * without this placement rejects with `working_order.not_open`. A stored dish whose period has
   * ended, unless `lateSend` confirms it, rejects with `menu_period.ended` naming its line in
   * `workingOrderLineIds`.
   */
  placeOrder(
    id: string,
    expectedEdit: BillEditExpected | null,
    lateSend?: LateSend,
  ): Promise<PlaceOrderResult> {
    return this.#request<PlaceOrderResult>(`/api/working-orders/${id}/place`, "POST", {
      expectedEdit,
      ...(lateSend === undefined ? {} : { lateSend }),
    });
  }
  /**
   * Hand a fired order to the customer → `POST /api/orders/:id/collect`: a settled one, or a counter
   * order sent without payment in a mode that pays after sending. NON-FISCAL: it stamps
   * `collected_at`, which drops the order off the station queue — DISTINCT from `collectOrder`,
   * the fiscal placed → settled collect. Any other or absent id rejects `working_order.not_settled`,
   * an already-collected order `working_order.already_collected`, and one never fired
   * `ticket.not_fired`. With a `submissionId`, a repeat of it is answered as the first was, and the
   * same id on a different command of the order is `submission.id_reused`.
   */
  async markCollected(id: string, submissionId?: string, options: ReadOptions = {}): Promise<void> {
    await this.#request<void>(
      `/api/orders/${id}/collect`,
      "POST",
      submissionId === undefined ? {} : { submissionId },
      options.signal,
    );
  }
  /** `GET /api/orders/counter-waiting`, oldest first. */
  listCounterWaiting(options: ReadOptions = {}): Promise<CounterWaitingOrder[]> {
    return this.#request<CounterWaitingOrder[]>(
      "/api/orders/counter-waiting",
      "GET",
      undefined,
      options.signal,
    );
  }
  /**
   * Reprint an order's CURRENT kitchen tickets → `POST /api/orders/:id/reprint`. A SESSION verb: there
   * is no device reprint route. NON-FISCAL and changes no order state; an order with no fired items and
   * no held group whose HOLD ticket was queued is a 200 no-op. A malformed or unknown id rejects
   * `working_order.not_found`.
   */
  async reprintOrder(orderId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/reprint`, "POST", {});
  }
  /** Answers what the server filed for the bill's receipt; `null` when it had none. */
  cancelOrder(
    id: string,
    reason: string,
    override?: { personId: string; pin: string },
    options: ReadOptions = {},
  ): Promise<{ filed: CancelFiled }> {
    return this.#request<{ filed: CancelFiled }>(
      `/api/working-orders/${id}/cancel`,
      "POST",
      { reason, ...(override ? { override } : {}) },
      options.signal,
    );
  }
  /**
   * Credit a printed table bill's ticket in full and put its dishes on a new open bill →
   * `POST /api/working-orders/:id/split-after-print`, which asks no approver. Rejects as
   * `cancelOrder` does, and `bill.not_at_table`, `bill.left_unpaid`, `bill.not_issued`
   * and `bill.unserved_dishes` (`dishes`, as `meal_end.unserved_dishes` lists them,
   * and `canStop`: whether `stopUnserved` may be sent to stop them and leave them off the new bill,
   * except a dish the kitchen started or finished, which stays on it, charged).
   */
  splitAfterPrint(
    id: string,
    options: ReadOptions & { stopUnserved?: true } = {},
  ): Promise<{ billId: string; correctiveNumber: string }> {
    const body = options.stopUnserved ? { stopUnserved: true } : {};
    return this.#request(
      `/api/working-orders/${id}/split-after-print`,
      "POST",
      body,
      options.signal,
    );
  }
  /** Who may approve cancelling an invoiced bill → `GET /api/cancel-credit-authorizers`. */
  listCancelCreditAuthorizers(options: ReadOptions = {}): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>(
      "/api/cancel-credit-authorizers",
      "GET",
      undefined,
      options.signal,
    );
  }
  askOrderDeadEnds(workingOrderId: string, toZoneId?: string): Promise<DeadEndAnswer> {
    return this.#request("/api/dead-ends/order", "POST", {
      workingOrderId,
      ...(toZoneId === undefined ? {} : { toZoneId }),
    });
  }
  /** Record or take back the party's bill request → `POST /api/parties/:partyId/bill-request`.
   * `billRequestedAt` is null once taken back. */
  requestBill(
    partyId: string,
    command: BillRequestCommand,
    options: ReadOptions = {},
  ): Promise<{ revision: number; billRequestedAt: string | null }> {
    return this.#request(`/api/parties/${partyId}/bill-request`, "POST", command, options.signal);
  }
  fireHeldLine(
    partyId: string,
    lineId: string,
    command: AllergyCommand & { lineIds?: string[] },
    options: ReadOptions = {},
  ): Promise<{ revision: number }> {
    return this.#request(
      `/api/parties/${partyId}/groups/fire-line`,
      "POST",
      { ...command, lineId },
      options.signal,
    );
  }
  splitHeldLineIntoUnits(
    partyId: string,
    lineId: string,
    command: GroupCommand & { expectedEdit: BillEditExpected },
    options: ReadOptions = {},
  ): Promise<{ revision: number }> {
    return this.#request(
      `/api/parties/${partyId}/groups/split-line`,
      "POST",
      { ...command, lineId },
      options.signal,
    );
  }
  /** Move lines, or part of one, between held groups, or into a new held group at the end →
   * `POST /api/parties/:partyId/groups/move`. */
  moveLinesToGroup(
    partyId: string,
    moves: { lineId: string; quantity: string }[],
    target: { groupId: string } | "new",
    command: GroupCommand & { expectedEdits: BillEditExpected[] },
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/move`, "POST", {
      ...command,
      moves,
      target,
    });
  }
  /** With `lineIds`, the read covers every portion of the row the till shows as one. */
  getCancellation(
    target: string | { billId: string },
    lineId: string,
    options: ReadOptions & { lineIds?: readonly string[] } = {},
  ): Promise<CancellationRead> {
    const query =
      options.lineIds === undefined
        ? ""
        : `?${new URLSearchParams(options.lineIds.map((id) => ["lineIds", id])).toString()}`;
    return this.#request(
      `/api/${typeof target === "string" ? `parties/${target}` : `working-orders/${target.billId}`}/lines/${lineId}/cancellation${query}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  cancelItem(
    target: string | { billId: string },
    lineId: string,
    command: CancelItemRequest,
    options: ReadOptions = {},
  ): Promise<CancelItemAnswer & { invoice?: TillSaleResult }> {
    return this.#request(
      `/api/${typeof target === "string" ? `parties/${target}` : `working-orders/${target.billId}`}/lines/${lineId}/cancel-item`,
      "POST",
      command,
      options.signal,
    );
  }
}
