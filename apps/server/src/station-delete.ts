import "./errors.js";
import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  AppError,
  createLabelComparator,
  type DeleteImpact,
  type DeleteImpactItem,
  type DeleteTarget,
} from "@waitron/shared";
import {
  deviceMadeHereStations,
  devices,
  kitchenStations,
  kitchenStationTiming,
  orderDrafts,
  orderDraftLines,
  orderTableLabels,
  parties,
  printers,
  stationPrinters,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { clearStationDeleteSettings, readStationDeleteSettings } from "@waitron/venue-service";
import { bumpRevision } from "./working-order.js";
import type { TillConfig } from "./till-config.js";
import { firedQuantity } from "./kitchen-print.js";

function named(key: string, rows: DeleteTarget[]): DeleteImpactItem {
  const targets = [...new Map(rows.map((row) => [row.id, row])).values()];
  const compare = createLabelComparator();
  targets.sort((a, b) => compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { key, count: targets.length, targets };
}

async function stationDeleteRules(tx: Transaction, cfg: TillConfig, id: string) {
  const [station] = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      isDefault: kitchenStations.isDefault,
    })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, id),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (!station) throw new AppError("station.not_found", { stationId: id });
  const target = { id: station.id, name: station.name };
  const settings = await readStationDeleteSettings(tx, cfg, id);
  const preparation = await tx
    .select({
      id: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
      label: workingOrders.label,
      orderNumber: workingOrders.orderNumber,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(
      and(
        eq(ticketItems.stationId, id),
        eq(workingOrders.locationId, cfg.locationId),
        eq(ticketItems.madeHere, false),
        isNull(workingOrders.collectedAt),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrderLines.servedAt),
        gt(firedQuantity, workingOrderLines.servedQuantity),
        or(isNull(ticketItems.firedAt), inArray(ticketItems.state, ["queued", "preparing"])),
      ),
    );
  const orderLabels = await orderTableLabels(tx, cfg.locationId, [
    ...new Map(preparation.map((row) => [row.id, row])).values(),
  ]);
  const unsent = await tx
    .select({ id: workingOrderLines.id, orderId: workingOrders.id })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrders.locationId, cfg.locationId),
        eq(workingOrders.status, "open"),
        eq(workingOrderLines.makeAtStationId, id),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
      ),
    );
  const drafts = await tx
    .select({ id: orderDraftLines.id, draftId: orderDrafts.id })
    .from(orderDraftLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftLines.draftId))
    .innerJoin(parties, eq(parties.id, orderDrafts.partyId))
    .where(
      and(
        sql`exists (select 1 from working_orders draft_order where draft_order.party_id = ${parties.id} and draft_order.location_id = ${cfg.locationId})`,
        eq(orderDrafts.state, "open"),
        eq(orderDraftLines.makeAtStationId, id),
      ),
    );
  const mappedPrinters = await tx
    .select({ id: printers.id, name: printers.name })
    .from(stationPrinters)
    .innerJoin(printers, eq(printers.id, stationPrinters.printerId))
    .where(eq(stationPrinters.stationId, id));
  const madeHere = await tx
    .select({ id: devices.id, name: devices.label })
    .from(deviceMadeHereStations)
    .innerJoin(devices, eq(devices.id, deviceMadeHereStations.deviceId))
    .where(eq(deviceMadeHereStations.stationId, id));
  const timing = await tx
    .select({ id: kitchenStationTiming.stationId })
    .from(kitchenStationTiming)
    .where(eq(kitchenStationTiming.stationId, id));
  const refusals: DeleteImpact["refusals"] = [];
  if (station.isDefault)
    refusals.push({ code: "station.is_default", params: { stationId: id }, targets: [target] });
  if (settings.boundScreens.length)
    refusals.push({
      code: "station.screen_in_use",
      params: { stationId: id, count: settings.boundScreens.length },
      targets: settings.boundScreens,
    });
  if (preparation.length)
    refusals.push({
      code: "station.work_in_progress",
      params: { stationId: id, count: preparation.length },
      targets: named(
        "",
        preparation.map((row) => ({
          id: row.id,
          name: orderLabels.get(row.id) ?? `#${row.orderNumber}`,
        })),
      ).targets,
    });
  const removes = [
    { key: "station_unsent_lines", count: unsent.length, targets: [] },
    { key: "station_draft_lines", count: drafts.length, targets: [] },
    named("station_printers", mappedPrinters),
    named("station_made_here", madeHere),
    { key: "station_timing", count: timing.length, targets: [] },
    ...settings.removes,
  ].filter((row) => row.count > 0);
  const impact: DeleteImpact = { target, refusals, ends: [], removes };
  return { impact, unsent, drafts };
}

export async function readStationDeleteImpact(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<DeleteImpact> {
  return (await stationDeleteRules(tx, cfg, id)).impact;
}

export async function deleteStation(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  now = new Date(),
): Promise<DeleteImpact> {
  const { impact, unsent, drafts } = await stationDeleteRules(tx, cfg, id);
  const refusal = impact.refusals[0];
  if (refusal?.code === "station.is_default")
    throw new AppError("station.is_default", { stationId: id });
  if (refusal?.code === "station.screen_in_use")
    throw new AppError("station.screen_in_use", {
      stationId: id,
      count: Number(refusal.params.count),
    });
  if (refusal)
    throw new AppError("station.work_in_progress", {
      stationId: id,
      count: Number(refusal.params.count),
    });
  await clearStationDeleteSettings(tx, cfg, id);
  if (unsent.length) {
    await tx
      .update(workingOrderLines)
      .set({ makeAtStationId: null })
      .where(
        inArray(
          workingOrderLines.id,
          unsent.map((row) => row.id),
        ),
      );
    await bumpRevision(tx, [...new Set(unsent.map((row) => row.orderId))]);
  }
  if (drafts.length) {
    await tx
      .update(orderDraftLines)
      .set({ makeAtStationId: null })
      .where(
        inArray(
          orderDraftLines.id,
          drafts.map((row) => row.id),
        ),
      );
    await tx
      .update(orderDrafts)
      .set({ revision: sql`${orderDrafts.revision} + 1`, updatedAt: now.toISOString() })
      .where(inArray(orderDrafts.id, [...new Set(drafts.map((row) => row.draftId))]));
  }
  await tx.delete(stationPrinters).where(eq(stationPrinters.stationId, id));
  await tx.delete(deviceMadeHereStations).where(eq(deviceMadeHereStations.stationId, id));
  await tx.delete(kitchenStationTiming).where(eq(kitchenStationTiming.stationId, id));
  await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, id));
  return impact;
}
