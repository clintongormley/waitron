import "./errors.js";
import { and, eq, gte, inArray, isNull, or, type SQL } from "drizzle-orm";
import {
  kitchenStations,
  orderGroups,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { ResolvedKitchenScreen } from "@waitron/module";
import type { TradingContext } from "./trading-context.js";
import { kitchenPhase, requestedItem } from "./kitchen-phase.js";
import { passWaitingStations } from "./kitchen-release.js";
import { VENUE_SERVICE } from "./modules.js";
import { unchosenAtClosedStation } from "./station-move.js";
import { orderWatchZones } from "./watch-zones.js";
import { buildPassBoard, type PassBoard, type PassRow, type PassTarget } from "./pass-card.js";
import { liveKitchenDish, readPassRows } from "./working-order.js";

/** null: every station (zone). */
export interface PassScope {
  stationIds: readonly string[] | null;
  zoneIds: readonly string[] | null;
}

/** A dish in no zone is seen only by a pass on every zone. */
export function passSees(
  scope: PassScope,
  dish: { stationId: string; zoneId: string | null },
): boolean {
  return (
    (scope.stationIds === null || scope.stationIds.includes(dish.stationId)) &&
    (scope.zoneIds === null || (dish.zoneId !== null && scope.zoneIds.includes(dish.zoneId)))
  );
}

/** What a device's pass screen or pass monitor shows now: its available stations and zones. */
export function passScopeOf(screen: ResolvedKitchenScreen): PassScope {
  const shown = (slots: readonly { id: string; available: boolean }[]) =>
    slots.filter((slot) => slot.available).map((slot) => slot.id);
  return {
    stationIds: shown(screen.stations),
    zoneIds: screen.zones === null ? null : shown(screen.zones),
  };
}

/** The pass's cards: every card one of whose live dishes the scope sees, each read whole. */
export async function readScopedPassBoard(
  tx: Transaction,
  cfg: TradingContext,
  scope: PassScope,
  display?: { showNonPassStations: boolean },
): Promise<PassBoard> {
  const nowMs = Date.now();
  const kept = await scopedItems(tx, cfg, scope);
  const groupIds = [...new Set(kept.flatMap((item) => item.groupId ?? []))];
  const billIds = [
    ...new Set(kept.flatMap((item) => (item.groupId === null ? [item.orderId] : []))),
  ];
  const keys: SQL[] = [];
  if (groupIds.length > 0) keys.push(inArray(workingOrderLines.groupId, groupIds));
  if (billIds.length > 0)
    keys.push(and(inArray(workingOrders.id, billIds), isNull(workingOrderLines.groupId))!);
  const rows = keys.length === 0 ? [] : await readCardRows(tx, cfg, or(...keys)!, nowMs);
  return buildPassBoard(rows, scope, display, await aStationInViewWaits(tx, scope));
}

/** Active stations only, so a deactivated station left waiting does not set the flag. */
async function aStationInViewWaits(tx: Transaction, scope: PassScope): Promise<boolean> {
  if (scope.stationIds !== null && scope.stationIds.length === 0) return false;
  const conditions = [eq(kitchenStations.waitsForPass, true), eq(kitchenStations.active, true)];
  if (scope.stationIds !== null)
    conditions.push(inArray(kitchenStations.id, [...scope.stationIds]));
  const [found] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(...conditions))
    .limit(1);
  return found !== undefined;
}

/** Releasing needs a pass screen, so a monitor's and a till's All stations cards name nothing to release. */
export function withoutRelease(board: PassBoard): PassBoard {
  const strip = (cards: PassBoard["toFire"]) =>
    cards.map((card) => ({ ...card, releaseTicketItemIds: [], releaseContext: null }));
  return {
    ...board,
    held: strip(board.held),
    toFire: strip(board.toFire),
    inProgress: strip(board.inProgress),
    ready: strip(board.ready),
  };
}

/** One card's rows, for the release. */
export async function readPassCardRows(
  tx: Transaction,
  cfg: TradingContext,
  target: PassTarget,
): Promise<PassRow[]> {
  return readCardRows(
    tx,
    cfg,
    target.kind === "group"
      ? and(eq(workingOrderLines.groupId, target.groupId), eq(orderGroups.partyId, target.partyId))!
      : and(eq(workingOrders.id, target.workingOrderId), isNull(workingOrderLines.groupId))!,
    Date.now(),
  );
}

async function readCardRows(
  tx: Transaction,
  cfg: TradingContext,
  cards: SQL,
  nowMs: number,
): Promise<PassRow[]> {
  const read = await readPassRows(tx, and(liveKitchenDish(), cards)!, nowMs);
  if (read.length === 0) return [];
  const zones = await rowsWatchZones(tx, cfg, read);
  const phase = (row: Pick<PassRow, "requestedAt" | "firedAt" | "item">) =>
    kitchenPhase({ requestedAt: row.requestedAt, firedAt: row.firedAt, state: row.item.state });
  const waits = await passWaitingStations(
    tx,
    read.filter((row) => phase(row) === "held").map((row) => row.stationId),
  );
  const states = await VENUE_SERVICE.stationStates(tx, cfg, new Date(nowMs));
  return read.map(
    ({
      stationChosenAt,
      stationRetainedAtRelease,
      makeAtStationId,
      servedAt,
      deliveryTableId,
      ...row
    }) => {
      void servedAt;
      void deliveryTableId;
      const state = states.get(row.stationId);
      const rowPhase = phase(row);
      return {
        ...row,
        zoneId: zones.get(row.orderId) ?? null,
        stationWaitsNow: rowPhase === "held" && waits.has(row.stationId),
        stationClosed:
          rowPhase === "requested" &&
          (!state || !state.active || !state.open) &&
          unchosenAtClosedStation(
            {
              stationChosenAt,
              stationRetainedAtRelease,
              makeAtStationId,
              stationId: row.stationId,
            },
            state,
          ),
      };
    },
  );
}

/** The live kitchen dishes the scope sees. */
async function scopedItems(
  tx: Transaction,
  cfg: TradingContext,
  scope: PassScope,
): Promise<{ id: string; orderId: string; groupId: string | null }[]> {
  if (scope.stationIds?.length === 0 || scope.zoneIds?.length === 0) return [];
  const candidates = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      groupId: workingOrderLines.groupId,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        liveKitchenDish(),
        scope.stationIds === null
          ? undefined
          : inArray(ticketItems.stationId, [...scope.stationIds]),
      ),
    );
  if (scope.zoneIds === null) return candidates;
  const zones = await rowsWatchZones(tx, cfg, candidates);
  return candidates.filter((item) =>
    passSees(scope, { stationId: item.stationId, zoneId: zones.get(item.orderId)! }),
  );
}

/** Every live kitchen dish fired, or requested and not yet released, at or after
 *  `firedSince`, with its order's watched zone when `withZones`, else a null zone. */
export async function firedPassDishes(
  tx: Transaction,
  cfg: TradingContext,
  firedSince: string,
  withZones: boolean,
): Promise<
  {
    id: string;
    stationId: string;
    zoneId: string | null;
  }[]
> {
  const rows = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        liveKitchenDish(),
        or(
          gte(ticketItems.firedAt, firedSince),
          and(requestedItem(), gte(ticketItems.requestedAt, firedSince)),
        ),
      ),
    );
  const zones = withZones ? await rowsWatchZones(tx, cfg, rows) : new Map<string, string>();
  return rows.map(({ id, orderId, stationId }) => ({
    id,
    stationId,
    zoneId: zones.get(orderId) ?? null,
  }));
}

/** The watched zone of each order the rows belong to, each order asked about once. */
function rowsWatchZones(
  tx: Transaction,
  cfg: TradingContext,
  rows: readonly { orderId: string; partyId: string | null; deliveryTableId: string | null }[],
): Promise<Map<string, string | null>> {
  return orderWatchZones(tx, cfg, [
    ...new Map(
      rows.map(({ orderId, partyId, deliveryTableId }) => [
        orderId,
        { id: orderId, partyId, deliveryTableId },
      ]),
    ).values(),
  ]);
}
