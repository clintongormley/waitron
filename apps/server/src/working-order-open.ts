import "./errors.js";
import { refuseOverSimplifiedLimit } from "@waitron/core";
import {
  type Transaction,
  workingOrders,
  diningTables,
  devices,
  allocateOrderNumber,
  nowIso,
  insertInChunks,
  workingOrderLines,
  withTransaction,
  isUniqueViolation,
  tableInService,
  needsMoving,
  statementChunks,
  newId,
} from "@waitron/db";
import type { GrossLines } from "@waitron/menu";
import type { ServiceMode, ZoneOffers } from "@waitron/module";
import {
  type ExtraSelection,
  type OptionSelection,
  type Dining,
  type BillSetMenuState,
  AppError,
} from "@waitron/shared";
import { eq, and, sql } from "drizzle-orm";
import { checkedInvoiceRecipient, selectOrderInvoice } from "./invoice-selection.js";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import { expandPortionRows, portionIdentities } from "./order-portions.js";
import { tableHeld } from "./parties.js";
import type { RetainedCourseLine } from "./retained-course.js";
import {
  readBillSetMenus,
  SET_MENU_DRAFT_LINE,
  type SetMenuDraftLine,
  placeSetMenuRows,
} from "./set-menu-bill.js";
import { setSetMenuCount } from "./set-menu-count.js";
import {
  type OrderLineIdentity,
  totalBeforeEdit,
  refuseOrderOverSimplifiedLimit,
} from "./stored-order-lines.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import {
  type WorkingOrderDeps,
  type OrderAttendance,
  captureOrderEdit,
  readOrderRevision,
} from "./working-order-context.js";
import { type FireableLine, fireableLineColumns } from "./working-order-kitchen-fire.js";
import {
  type LineExtras,
  type WorkingOrderLineInsert,
  priceOrderLines,
} from "./working-order-pricing.js";

/**
 * Carries NO price of any kind: the server prices from the zone's menu offers.
 *
 * `id` is client-supplied and held stable across a retry, which makes park IDEMPOTENT: a re-sent
 * park collides on `working_orders.id` and replays the existing OPEN order's result. A colliding id
 * whose row is no longer `open` is an id reuse, not a retry, and is re-thrown.
 *
 * `operatorId` is credited with the order's lines (`working_order_lines.credited_to`).
 */
export interface ParkOrderRequest {
  id: string;
  kitchenNote?: string | null;
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  zoneId?: string;
  label?: string;
  operatorId?: string;
  lateSend?: LateSendConfirmation;
  dining?: Dining;
  firstSetMenu?: { menuId: string; personId: string };
}

export interface ParkOrderResult {
  id: string;
  orderNumber: number;
  serviceMode: ServiceMode | null;
  revision?: number;
  setMenus?: BillSetMenuState;
}
/**
 * Persist an OPEN working order and its priced lines on the CALLER's transaction, returning the
 * gross lines its rows were built from, for their totals: they carry no VAT rates, and a sale is
 * filed from the stored lines. Shared so a walk-up order has the same shape as a parked one. The
 * empty-basket refusal stays with each caller.
 */
export async function createOpenOrder(
  tx: Transaction,
  cfg: OriginConfig,
  id: string,
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[],
  label: string | null,
  // `creditedTo` is the operator creating the order, whose sale its lines count as.
  placement: {
    kitchenNote?: string | null;
    deliveryTableId?: string | null;
    zoneId?: string;
    partyId?: string | null;
    existingService?: boolean;
    copyServiceContextFrom?: string;
    receiptLocale?: string;
    creditedTo?: string;
    invalidMakeAt?: "ignore";
    lateSend?: LateSendConfirmation;
    /** The way the till showed; refused `order.dining_fixed` where the department sells otherwise. */
    dining?: Dining;
    /** The way of the existing order this one takes dishes from, whatever its department says. */
    keepDining?: Dining;
    invoiceChoice?: {
      invoiceType: unknown;
      recipient: unknown;
      recipientNameMaxLength: number | null;
    };
  } = {},
): Promise<{
  orderNumber: number;
  /** Null without `partyId`. */
  billNumber: number | null;
  gross: GrossLines;
  identities: OrderLineIdentity[];
  lineRows: WorkingOrderLineInsert[];
}> {
  const choice = placement.invoiceChoice;
  if (
    choice?.invoiceType !== undefined &&
    choice.invoiceType !== "F1" &&
    choice.invoiceType !== "F2"
  ) {
    throw new AppError("management.request_invalid", { field: "invoiceType" });
  }
  const recipient =
    choice?.invoiceType === "F1" ? checkedInvoiceRecipient(choice, choice.recipient) : null;
  if (recipient === null && choice?.recipient !== undefined && choice.recipient !== null) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
  const deliveryTableId = placement.deliveryTableId ?? null;
  let effectiveZoneId = placement.zoneId;
  let copiedDining: Dining | undefined;
  if (placement.copyServiceContextFrom !== undefined) {
    const context = await VENUE_SERVICE.findOrderContext(tx, placement.copyServiceContextFrom);
    if (context === null) {
      throw new AppError("order.service_context_missing", {
        workingOrderId: placement.copyServiceContextFrom,
      });
    }
    effectiveZoneId = context.zoneId;
    const [source] = await tx
      .select({ dining: workingOrders.dining })
      .from(workingOrders)
      .where(eq(workingOrders.id, placement.copyServiceContextFrom));
    copiedDining = source?.dining;
  }
  if (deliveryTableId !== null) {
    const [table] = await tx
      .select({
        id: diningTables.id,
        zoneId: diningTables.zoneId,
      })
      .from(diningTables)
      .where(eq(diningTables.id, deliveryTableId));
    if (table === undefined) {
      throw new AppError("table.not_found", { tableId: deliveryTableId });
    }
    effectiveZoneId = table.zoneId;
  }
  if (effectiveZoneId === undefined) {
    let profileId: string | undefined;
    if (cfg.origin.source === "device") {
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, cfg.origin.deviceId));
      profileId = device?.profileId;
    }
    effectiveZoneId = (await VENUE_SERVICE.resolveNewOrderZone(tx, { profileId })).zoneId;
  }
  if (placement.existingService !== true) {
    await VENUE_SERVICE.assertZoneTakesNewOrders(tx, effectiveZoneId, new Date());
  }
  const dining =
    copiedDining ??
    placement.keepDining ??
    (await VENUE_SERVICE.resolveOrderDining(tx, effectiveZoneId, placement.dining));
  const pricedLines = await priceOrderLines(
    tx,
    cfg,
    id,
    lines,
    effectiveZoneId,
    undefined,
    placement.invalidMakeAt ?? "refuse",
    "added",
    placement.lateSend,
  );
  const { gross, offers } = pricedLines;
  if (recipient === null) refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, gross.total);
  const expanded = expandPortionRows(
    pricedLines.lineRows,
    pricedLines.lineContexts,
    pricedLines.portionable,
    1,
  );
  const identities = portionIdentities(pricedLines.identities, pricedLines.lineRows, expanded);
  const lineContexts = expanded.lineContexts;
  const lineRows = expanded.rows.map((row) => ({
    ...row,
    creditedTo: placement.creditedTo ?? null,
  }));
  const orderNumber = await allocateOrderNumber(tx);
  const openedAt = nowIso();

  await tx.insert(workingOrders).values({
    id,
    source: cfg.origin.source,
    deviceId: cfg.origin.deviceId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    openedAt,
    // Read under the write lock, which the close-of-day job's release stamp also takes.
    trustedOpenedAt: cfg.clockUnconfirmed?.() === true ? null : openedAt,
    invoiceType: recipient === null ? "F2" : "F1",
    recipientTaxId: recipient?.taxId ?? null,
    recipientLegalName: recipient?.legalName ?? null,
    recipientAddress: recipient?.address ?? null,
    recipientCountryCode: recipient?.countryCode ?? null,
    recipientIdentifierType: recipient?.identifierType ?? null,
    recipientIdentifierCountryCode: recipient?.identifierCountryCode ?? null,
    // Not a fiscal field.
    deliveryTableId,
    partyId: placement.partyId ?? null,
    receiptLocale: placement.receiptLocale ?? null,
    dining,
  });
  const billNumber = placement.partyId
    ? await VENUE_SERVICE.allocateBillNumber(tx, id, placement.partyId)
    : null;

  if (placement.kitchenNote !== undefined) {
    await VENUE_SERVICE.writeKitchenNote(tx, { workingOrderId: id }, 0, placement.kitchenNote);
  }

  if (placement.copyServiceContextFrom !== undefined) {
    await VENUE_SERVICE.copyOrderContext(tx, placement.copyServiceContextFrom, id);
  } else {
    await VENUE_SERVICE.recordOrderContext(tx, id, effectiveZoneId);
  }
  const contextByLine = await VENUE_SERVICE.lineContextColumns(tx, id, lineContexts, offers);
  await insertInChunks(
    tx,
    workingOrderLines,
    lineRows.map((row) => ({ ...row, ...contextByLine.get(row.id!) })),
  );

  if (choice !== undefined) await selectOrderInvoice(tx, choice, cfg, id, gross.total);
  return { orderNumber, billNumber, gross, identities, lineRows };
}

export async function parkOrder(
  deps: WorkingOrderDeps,
  cfg: OriginConfig,
  req: ParkOrderRequest,
  attendance?: OrderAttendance,
): Promise<ParkOrderResult> {
  if (req.lines.length === 0 && req.firstSetMenu === undefined) {
    throw new AppError("sale.empty_basket", {});
  }

  try {
    return await withTransaction(deps.db, async (tx) => {
      const { orderNumber } = await createOpenOrder(tx, cfg, req.id, req.lines, req.label ?? null, {
        kitchenNote: req.kitchenNote,
        zoneId: req.zoneId,
        creditedTo: req.operatorId,
        lateSend: req.lateSend,
        dining: req.dining,
      });
      await captureOrderEdit(tx, attendance, req.id, req.operatorId, 0, "park");
      const serviceMode = (await VENUE_SERVICE.findOrderContext(tx, req.id))?.serviceMode ?? null;
      const reply = { id: req.id, orderNumber, serviceMode };
      if (req.firstSetMenu === undefined) return reply;
      const { menuId, personId } = req.firstSetMenu;
      const setMenus = await setSetMenuCount(tx, cfg, req.id, menuId, 1, personId);
      return { ...reply, revision: await readOrderRevision(tx, req.id), setMenus };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A re-sent park collided on the id an earlier park committed. One write transaction runs on the
    // venue file at a time, so that row is readable in a fresh transaction: replay its number.
    return withTransaction(deps.db, async (tx) => {
      const [existing] = await tx
        .select({
          orderNumber: workingOrders.orderNumber,
          revision: workingOrders.revision,
          serviceMode: workingOrders.serviceMode,
        })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, req.id), eq(workingOrders.status, "open")));
      // The colliding id is not `open`: an id reuse, not a retry.
      if (existing === undefined) {
        throw error;
      }
      const reply = {
        id: req.id,
        orderNumber: existing.orderNumber,
        serviceMode: existing.serviceMode,
      };
      return req.firstSetMenu === undefined
        ? reply
        : { ...reply, revision: existing.revision, setMenus: await readBillSetMenus(tx, req.id) };
    });
  }
}

export async function openTab(
  tx: Transaction,
  cfg: OriginConfig,
  req: {
    tableId: string;
    lines?: { menuItemId: string; quantity: string }[];
    partyId: string;
    /** Credited with `lines`. */
    operatorId?: string;
  },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({
      inService: tableInService(diningTables.id).mapWith(Boolean),
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
      needsMoving: needsMoving(diningTables.id).mapWith(Boolean),
    })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId));
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.inService) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }
  if (table.needsClearingSince !== null) {
    throw new AppError("table.needs_clearing", { tableId: req.tableId });
  }
  if (table.needsMoving) {
    throw new AppError("table.needs_moving", { tableId: req.tableId });
  }

  const context = await VENUE_SERVICE.resolveZoneContext(tx, table.zoneId);
  if (context.serviceMode !== "table_tab") {
    throw new AppError("service_zone.mode_incompatible", {
      zoneId: table.zoneId,
      expected: "table_tab",
      actual: context.serviceMode,
    });
  }

  // A party still holds the table after its bills settle, until Finish table.
  if (await tableHeld(tx, req.tableId)) {
    throw new AppError("tab.already_open", { tableId: req.tableId });
  }

  const tabId = newId();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null, {
    zoneId: table.zoneId,
    partyId: req.partyId,
    creditedTo: req.operatorId,
  });
  return { tabId, orderNumber };
}
/**
 * This working order is an open bill of a party, else `tab.not_open`; answers its revision. A counter
 * order is not.
 */
export async function assertPartyBillOpen(tx: Transaction, tabId: string): Promise<number> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      revision: workingOrders.revision,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (order?.status !== "open" || order.partyId === null) {
    throw new AppError("tab.not_open", { tabId });
  }
  return order.revision;
}

export type TabRoundLine = {
  menuItemId: string;
  quantity: string;
  courseId?: string | null;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine;
} & LineExtras &
  RetainedCourseLine;
/** A round priced for an open tab and numbered after its last line, not yet written. */
export interface PricedTabRound {
  /** The bill the round goes on. */
  tabId: string;
  /** One row per line and per extras child, in the order the lines were sent. */
  rows: WorkingOrderLineInsert[];
  /** Aligned with `rows`, as {@link priceOrderLines} answers it. */
  portionable: boolean[];
  lineContexts: Awaited<ReturnType<typeof priceOrderLines>>["lineContexts"];
  offers: ZoneOffers;
}
/**
 * Price a round for the bill and number its rows after the bill's last line, writing no line.
 * `"checked"` skips the check that the bill is open, for a caller that read it open in this
 * transaction.
 *
 * The `max(line_no)+1` read-then-insert cannot interleave with another append, because
 * `withTransaction` IS the venue file's write lock.
 */
export async function priceTabRound(
  tx: Transaction,
  cfg: TradingContext,
  tabId: string,
  lines: TabRoundLine[],
  bill: "check" | "checked" = "check",
  lateSend?: LateSendConfirmation,
): Promise<PricedTabRound> {
  if (bill === "check") await assertPartyBillOpen(tx, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const context = await VENUE_SERVICE.findOrderContext(tx, tabId);
  const { lineRows, portionable, lineContexts, offers } = await priceOrderLines(
    tx,
    cfg,
    tabId,
    lines,
    context?.zoneId,
    undefined,
    "refuse",
    "added",
    lateSend,
  );
  return {
    tabId,
    rows: lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 })),
    portionable,
    lineContexts,
    offers,
  };
}
/** Insert a priced round's rows and record their line contexts; answers what {@link fireLines} reads. */
export async function insertTabRound(
  tx: Transaction,
  cfg: TradingContext,
  round: PricedTabRound,
  rows: WorkingOrderLineInsert[],
): Promise<(FireableLine & { lineNo: number; groupId: string | null })[]> {
  const before = await totalBeforeEdit(tx, cfg, round.tabId);
  const inserted: (FireableLine & { lineNo: number; groupId: string | null })[] = [];
  const contextByLine = await VENUE_SERVICE.lineContextColumns(
    tx,
    round.tabId,
    round.lineContexts,
    round.offers,
  );
  const withContexts = rows.map((row) => ({ ...row, ...contextByLine.get(row.id!) }));
  const placementOrder = round.lineContexts.flatMap(({ workingOrderLineId, placement }) =>
    placement === undefined ? [] : [{ workingOrderLineId, ...placement }],
  );
  const placed = await placeSetMenuRows(tx, round.tabId, withContexts, placementOrder);
  for (const chunk of statementChunks(workingOrderLines, placed)) {
    inserted.push(
      ...(await tx
        .insert(workingOrderLines)
        .values(chunk)
        .returning({
          ...fireableLineColumns,
          lineNo: workingOrderLines.lineNo,
          groupId: workingOrderLines.groupId,
        })),
    );
  }
  await refuseOrderOverSimplifiedLimit(tx, cfg, round.tabId, before);
  return inserted;
}
