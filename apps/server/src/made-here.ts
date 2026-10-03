import { and, eq, inArray } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import {
  deviceMadeHereStations,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  type Database,
  type Transaction,
} from "@waitron/db";
import { staffPresentationName } from "@waitron/catalogue";
import { AppError, thousandthsToDecimal, type OptionSnapshot } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { requireLiveStation } from "./kitchen.js";
import { extraLabel } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

declare module "hono" {
  interface ContextVariableMap {
    madeHereSink?: Set<string>;
  }
}

export interface MadeHereItem {
  lineId: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  optionSnapshots: OptionSnapshot[];
  extras: string[];
  note: string | null;
}

/** A request's configuration as the device sending its work to the kitchen. */
export function sendingCfg<C extends TillConfig>(
  cfg: C,
  c: Context,
  device: { deviceId: string },
): C {
  return { ...cfg, sendingDeviceId: device.deviceId, madeHereSink: madeHereSinkFor(c) };
}

/** A request owns one sink through all of its sending paths. */
export function madeHereSinkFor(c: Context): Set<string> {
  const existing = c.get("madeHereSink");
  if (existing !== undefined) return existing;
  const sink = new Set<string>();
  c.set("madeHereSink", sink);
  return sink;
}

/** Read committed made-here records, omitting ids whose attempt rolled back. */
export async function readMadeHereItems(
  db: Database,
  lineIds: ReadonlySet<string>,
  locale: string,
): Promise<MadeHereItem[]> {
  if (lineIds.size === 0) return [];
  const ids = [...lineIds];
  const rows = await db
    .select({
      lineId: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: ticketItems.quantity,
      lineQuantity: workingOrderLines.quantity,
      unitName: workingOrderLines.unitName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      note: workingOrderLines.note,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(inArray(ticketItems.workingOrderLineId, ids), eq(ticketItems.madeHere, true)))
    .orderBy(workingOrderLines.lineNo);
  if (rows.length === 0) return [];
  const foundIds = rows.map((row) => row.lineId);
  const children = await db
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      unitName: workingOrderLines.unitName,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.parentLineId, foundIds))
    .orderBy(workingOrderLines.lineNo);
  const each = await VENUE_SERVICE.readLinesSoldInEach(db, [
    ...foundIds,
    ...children.map((child) => child.id),
  ]);
  return rows.map((row) => ({
    lineId: row.lineId,
    name: staffPresentationName(row),
    quantity: thousandthsToDecimal(row.quantity ?? row.lineQuantity),
    unitName: row.unitName,
    soldInEach: each.has(row.lineId),
    optionSnapshots: row.optionSnapshots,
    extras: children
      .filter((child) => child.parentLineId === row.lineId)
      .map((child) =>
        extraLabel(
          child.name,
          thousandthsToDecimal(child.quantity),
          thousandthsToDecimal(row.lineQuantity),
          child.unitName === null || each.has(child.id)
            ? undefined
            : (child.unitName[locale] ?? Object.values(child.unitName)[0]),
        ),
      ),
    note: row.note,
  }));
}

export function madeHereAnswer(db: Database, locale: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const ids = c.get("madeHereSink");
    if (
      ids === undefined ||
      ids.size === 0 ||
      c.res.status < 200 ||
      c.res.status >= 300 ||
      !c.res.headers.get("content-type")?.includes("application/json")
    )
      return;
    const body: unknown = await c.res.clone().json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return;
    const items = await readMadeHereItems(db, ids, locale);
    if (items.length === 0) return;
    c.res = new Response(JSON.stringify({ ...body, madeHere: items }), {
      status: c.res.status,
      headers: new Headers(c.res.headers),
    });
  };
}

const PREPAY_SUBMISSION = "made-here:prepay";

/** Store only made-here rows committed on this bill for a later payment replay. */
export async function storePrepayMadeHere(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const rows = await tx
    .select({ lineId: ticketItems.workingOrderLineId })
    .from(ticketItems)
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.madeHere, true),
        inArray(ticketItems.workingOrderLineId, [...lineIds]),
      ),
    );
  const madeHereIds = rows.map((row) => row.lineId);
  if (madeHereIds.length === 0) return;
  const [existing] = await tx
    .select({ kind: serviceCommands.kind, result: serviceCommands.result })
    .from(serviceCommands)
    .where(
      and(
        eq(serviceCommands.scopeKind, "bill"),
        eq(serviceCommands.scopeId, orderId),
        eq(serviceCommands.submissionId, PREPAY_SUBMISSION),
      ),
    );
  if (existing !== undefined) {
    if (existing.kind !== "made_here")
      throw new AppError("submission.id_reused", { submissionId: PREPAY_SUBMISSION });
    await tx
      .update(serviceCommands)
      .set({
        result: { value: [...new Set([...(existing.result.value as string[]), ...madeHereIds])] },
      })
      .where(
        and(
          eq(serviceCommands.scopeKind, "bill"),
          eq(serviceCommands.scopeId, orderId),
          eq(serviceCommands.submissionId, PREPAY_SUBMISSION),
        ),
      );
    return;
  }
  await tx.insert(serviceCommands).values({
    scopeKind: "bill",
    scopeId: orderId,
    submissionId: PREPAY_SUBMISSION,
    kind: "made_here",
    fingerprint: "",
    result: { value: madeHereIds },
  });
}

export async function replayPrepayMadeHere(
  tx: Transaction,
  cfg: Pick<TillConfig, "madeHereSink">,
  orderId: string,
): Promise<void> {
  if (cfg.madeHereSink === undefined) return;
  const [row] = await tx
    .select({ kind: serviceCommands.kind, result: serviceCommands.result })
    .from(serviceCommands)
    .where(
      and(
        eq(serviceCommands.scopeKind, "bill"),
        eq(serviceCommands.scopeId, orderId),
        eq(serviceCommands.submissionId, PREPAY_SUBMISSION),
      ),
    );
  if (row?.kind === "made_here")
    for (const id of row.result.value as string[]) cfg.madeHereSink.add(id);
}

/** The stations whose items `deviceId` makes on the spot. An absent device needs no query. */
export async function readMadeHereStations(
  tx: Transaction,
  deviceId: string | undefined,
): Promise<ReadonlySet<string>> {
  if (deviceId === undefined) return new Set();
  const rows = await tx
    .select({ stationId: deviceMadeHereStations.stationId })
    .from(deviceMadeHereStations)
    .where(eq(deviceMadeHereStations.deviceId, deviceId));
  return new Set(rows.map((row) => row.stationId));
}

/** Every device's list, with station ids in stable order. */
export async function listMadeHereStations(tx: Transaction): Promise<Map<string, string[]>> {
  const rows = await tx
    .select()
    .from(deviceMadeHereStations)
    .orderBy(deviceMadeHereStations.deviceId, deviceMadeHereStations.stationId);
  const byDevice = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byDevice.get(row.deviceId) ?? [];
    ids.push(row.stationId);
    byDevice.set(row.deviceId, ids);
  }
  return byDevice;
}

/** Replace one device's list after checking every station belongs to this location and is live. */
export async function setMadeHereStations(
  tx: Transaction,
  cfg: TillConfig,
  deviceId: string,
  stationIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(stationIds)];
  for (const stationId of ids) await requireLiveStation(tx, cfg, stationId);
  await tx.delete(deviceMadeHereStations).where(eq(deviceMadeHereStations.deviceId, deviceId));
  if (ids.length > 0) {
    await tx
      .insert(deviceMadeHereStations)
      .values(ids.map((stationId) => ({ deviceId, stationId })));
  }
}
