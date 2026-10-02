import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { ticketItems, tills, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { raiseReleasedAtClosedStation } from "./closed-station-alert.js";
import { enqueueKitchenTickets, enqueueStationMoved, firedQuantity } from "./kitchen-print.js";
import type { TicketState, CorrectionItem, FiredItem } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { printedHeldGroups } from "./order-groups.js";
import { runServiceCommand } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import { bumpRevision, readOrderRevision } from "./working-order.js";
import type { RoutingOnce } from "./working-order.js";
import "./errors.js";

export type Rerouted = ReadonlyMap<string, { stationId: string; stationName: string }>;

/** A held dish at a station that is not open follows the release's routing snapshot unless a
 * hand-chosen station remains active. Its ticket can move even on a paid bill; its line's make-at
 * stays unchanged. */
export async function rerouteHeldAtRelease(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  scope: SQL,
  routing: RoutingOnce,
): Promise<Rerouted> {
  const held = await tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      lineNo: workingOrderLines.lineNo,
      stationId: ticketItems.stationId,
      stationChosenAt: ticketItems.stationChosenAt,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      makeAtStationId: workingOrderLines.makeAtStationId,
      groupId: workingOrderLines.groupId,
      quantity: firedQuantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        scope,
        isNull(ticketItems.firedAt),
        eq(ticketItems.state, "queued"),
        eq(ticketItems.madeHere, false),
      ),
    );
  if (held.length === 0) return new Map();
  const resolver = await routing();
  const states = await resolver.stations();
  const closed = held.filter((row) => {
    const state = states.get(row.stationId);
    return !state || !state.active || !state.open;
  });
  const unchosen = closed.filter((row) => {
    const state = states.get(row.stationId);
    return (
      !state?.active || (row.stationChosenAt === null && row.makeAtStationId !== row.stationId)
    );
  });
  const dishes = unchosen.filter((row) => row.parentLineId === null && row.productId !== null);
  const stranded = unchosen.filter((row) => row.parentLineId !== null);
  const alertStranded = async () => {
    if (stranded.length === 0) return;
    const byStation = new Map<
      string,
      { stationId: string; stationName: string; lineIds: string[] }
    >();
    for (const row of [...stranded].sort((a, b) => a.lineNo - b.lineNo)) {
      const station = byStation.get(row.stationId) ?? {
        stationId: row.stationId,
        stationName: states.get(row.stationId)?.name ?? row.stationId,
        lineIds: [],
      };
      station.lineIds.push(row.lineId);
      byStation.set(row.stationId, station);
    }
    await raiseReleasedAtClosedStation(tx, cfg, orderId, routing.at, [...byStation.values()]);
  };
  if (dishes.length === 0) {
    await alertStranded();
    return new Map();
  }
  const zoneId = (await VENUE_SERVICE.findOrderContext(tx, cfg, orderId))?.zoneId ?? null;
  const routes = await resolver.makers(zoneId, [...new Set(dishes.map((row) => row.productId!))]);
  const moving = dishes.flatMap((row) => {
    const outcome = routes.get(row.productId!);
    if (
      outcome?.kind !== "made" ||
      outcome.route.kind !== "station" ||
      outcome.route.stationId === row.stationId
    ) {
      stranded.push(row);
      return [];
    }
    return [{ ...row, toStationId: outcome.route.stationId }];
  });
  const printed = await printedHeldGroups(
    tx,
    moving.flatMap((row) => (row.groupId === null ? [] : [row.groupId])),
  );
  const byDestination = new Map<string, typeof moving>();
  for (const row of moving)
    byDestination.set(row.toStationId, [...(byDestination.get(row.toStationId) ?? []), row]);
  const rerouted = new Map<string, { stationId: string; stationName: string }>();
  for (const [destinationId, rows] of byDestination) {
    const destination = states.get(destinationId);
    if (!destination) throw new Error("re-route destination is absent from the venue snapshot");
    const corrections: CorrectionItem[] = rows.flatMap((row) => {
      const group = row.groupId === null ? undefined : printed.get(row.groupId);
      return group === undefined
        ? []
        : [
            {
              workingOrderLineId: row.lineId,
              stationId: row.stationId,
              quantity: row.quantity,
              wasStarted: false,
              group,
            },
          ];
    });
    await enqueueStationMoved(tx, cfg, orderId, corrections, destination.name);
    for (const row of rows) {
      const old = states.get(row.stationId);
      if (!old) throw new Error("held ticket has no old station in this venue");
      await tx
        .update(ticketItems)
        .set({ stationId: destinationId, queuedAt: routing.at.toISOString() })
        .where(eq(ticketItems.id, row.id));
      rerouted.set(row.lineId, { stationId: row.stationId, stationName: old.name });
    }
  }
  await alertStranded();
  return rerouted;
}

/** A held or fired record may move while queued, still at the kitchen, with no part served.
 * Made-here records are always fired and ready, and stay at their sending till's station. */
export function stillMovable(
  item: { state: TicketState; awayAt: string | null; madeHere: boolean },
  line: { servedAt: string | null; servedQuantity: number },
): boolean {
  return (
    item.state === "queued" &&
    item.awayAt === null &&
    !item.madeHere &&
    line.servedAt === null &&
    line.servedQuantity === 0
  );
}

export interface StationMoveRequest {
  submissionId: string;
  lineIds: readonly string[];
  stationId: string;
}

export interface StationMoveResult {
  revision: number;
  stationId: string;
  moved: { workingOrderLineId: string; fromStationId: string }[];
}

export async function moveDishesToStation(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  request: StationMoveRequest,
): Promise<StationMoveResult> {
  const at = new Date();
  const lineIds = [...new Set(request.lineIds)].sort();
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: orderId },
    request.submissionId,
    "line.move_station",
    { orderId, lineIds, stationId: request.stationId },
    async () => {
      const [order] = await tx
        .select({ status: workingOrders.status, collectedAt: workingOrders.collectedAt })
        .from(workingOrders)
        .innerJoin(tills, eq(tills.id, workingOrders.tillId))
        .where(and(eq(workingOrders.id, orderId), eq(tills.locationId, cfg.locationId)));
      if (order === undefined)
        throw new AppError("working_order.not_found", { workingOrderId: orderId });
      if (order.status === "abandoned")
        throw new AppError("working_order.not_open", { workingOrderId: orderId });
      if (order.collectedAt !== null)
        throw new AppError("working_order.already_collected", { workingOrderId: orderId });

      const stations = await VENUE_SERVICE.stationStates(tx, { locationId: cfg.locationId }, at);
      const destination = stations.get(request.stationId);
      if (destination === undefined)
        throw new AppError("station.not_found", { stationId: request.stationId });
      if (!destination.active)
        throw new AppError("route.station_inactive", { stationId: request.stationId });

      const rows =
        lineIds.length === 0
          ? []
          : await tx
              .select({
                id: workingOrderLines.id,
                workingOrderId: workingOrderLines.workingOrderId,
                servedAt: workingOrderLines.servedAt,
                servedQuantity: workingOrderLines.servedQuantity,
                groupId: workingOrderLines.groupId,
                ticketItemId: ticketItems.id,
                stationId: ticketItems.stationId,
                state: ticketItems.state,
                firedAt: ticketItems.firedAt,
                awayAt: ticketItems.awayAt,
                madeHere: ticketItems.madeHere,
                quantity: firedQuantity,
              })
              .from(workingOrderLines)
              .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
              .where(inArray(workingOrderLines.id, lineIds));
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const lineId of lineIds) {
        const row = byId.get(lineId);
        if (row === undefined || row.workingOrderId !== orderId)
          throw new AppError("tab.line_not_found", { tabId: orderId, lineId });
        if (row.ticketItemId === null)
          throw new AppError("ticket.not_sent", { workingOrderId: orderId, lineId });
        if (row.madeHere)
          throw new AppError("ticket.made_here", { ticketItemId: row.ticketItemId });
        if (!stillMovable({ state: row.state!, awayAt: row.awayAt, madeHere: false }, row))
          throw new AppError("ticket.already_started", { ticketItemId: row.ticketItemId });
      }
      const moving = rows.filter((row) => row.stationId !== request.stationId);
      if (moving.length === 0)
        return {
          revision: await readOrderRevision(tx, orderId),
          stationId: request.stationId,
          moved: [],
        };
      const printed = await printedHeldGroups(
        tx,
        moving.flatMap((row) => (row.groupId === null ? [] : [row.groupId])),
      );
      const byStation = new Map<string, typeof moving>();
      for (const row of moving)
        byStation.set(row.stationId!, [...(byStation.get(row.stationId!) ?? []), row]);
      for (const [oldStationId, lines] of byStation) {
        const corrections: CorrectionItem[] = lines.flatMap((row) => {
          const group = row.groupId === null ? undefined : printed.get(row.groupId);
          if (row.firedAt === null && group === undefined) return [];
          return [
            {
              workingOrderLineId: row.id,
              stationId: oldStationId,
              quantity: row.quantity,
              wasStarted: false,
              ...(row.firedAt === null ? { group } : {}),
            },
          ];
        });
        await enqueueStationMoved(tx, cfg, orderId, corrections, destination.name);
      }
      const changed = await tx
        .update(ticketItems)
        .set({
          stationId: request.stationId,
          queuedAt: at.toISOString(),
          stationChosenAt: at.toISOString(),
        })
        .where(
          and(
            inArray(
              ticketItems.id,
              moving.map((row) => row.ticketItemId!),
            ),
            eq(ticketItems.state, "queued"),
          ),
        )
        .returning({ id: ticketItems.id });
      if (changed.length !== moving.length)
        throw new Error("station move changed an unexpected number of ticket items");
      if (order.status === "open")
        await tx
          .update(workingOrderLines)
          .set({ makeAtStationId: request.stationId })
          .where(
            inArray(
              workingOrderLines.id,
              moving.map((row) => row.id),
            ),
          );
      for (const [oldStationId, lines] of byStation) {
        const from = stations.get(oldStationId)?.name;
        if (from === undefined) throw new Error("moving ticket has no old station in this venue");
        const fired: FiredItem[] = lines
          .filter((row) => row.firedAt !== null)
          .map((row) => ({
            workingOrderLineId: row.id,
            stationId: request.stationId,
            quantity: row.quantity,
          }));
        const held: FiredItem[] = lines
          .filter((row) => row.firedAt === null && row.groupId !== null && printed.has(row.groupId))
          .map((row) => ({
            workingOrderLineId: row.id,
            stationId: request.stationId,
            quantity: row.quantity,
          }));
        if (fired.length > 0) await enqueueKitchenTickets(tx, cfg, orderId, fired, { from });
        if (held.length > 0)
          await enqueueKitchenTickets(tx, cfg, orderId, held, { mark: "HOLD", from });
      }
      await bumpRevision(tx, [orderId]);
      return {
        revision: await readOrderRevision(tx, orderId),
        stationId: request.stationId,
        moved: moving.map((row) => ({ workingOrderLineId: row.id, fromStationId: row.stationId! })),
      };
    },
  );
}
