import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import {
  diningTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, JOIN_SIDES, normalisePartyName, type JoinSide } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { asObject } from "./bill-payments-api.js";
import {
  backToSaved,
  ensureToday,
  moveToday,
  placeSpareToday,
  putBackToday,
  resetZoneOn,
  type ResetOnto,
  rotateToday,
  seatsToday,
  takeOffToday,
  updateLayout,
} from "./floor-today-store.js";
import { plannedZones } from "./floor-layout-due.js";
import { writeMerge } from "./floor-today-merges.js";
import { leaveHere, markMoved } from "./floor-today-mark-moved.js";
import { resetTable } from "./floor-today-reset-table.js";
import { splitOff } from "./floor-today-split-group.js";
import { nameToday } from "./floor-today-name.js";
import type { Logger } from "./logger.js";
import { withMovedSlips } from "./moved-slips.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import {
  moveRoom,
  refuseStale,
  requiredRevision,
  roomPrints,
  roomRevision,
} from "./floor-revision.js";
import { zoneOfTable } from "./floor-today-table.js";
import "./errors.js";

export function whole(value: unknown, field: string, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high)
    throw invalid(field);
  return value;
}

/** A table id a till body must carry; a malformed one names no table. */
export function requireTargetTable(value: unknown, field: string): string {
  if (value === undefined) throw invalid(field);
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("table.not_found", { tableId: String(value) });
  }
  return value.toLowerCase();
}

function corner(body: Record<string, unknown>): { x: number; y: number } {
  return { x: whole(body.x, "x", 0, 999), y: whole(body.y, "y", 0, 999) };
}

function seatsOf(body: Record<string, unknown>): number {
  return whole(body.seats, "seats", 1, 999);
}

/** A write and the other tables its zone check covers. */
interface TableWrite {
  write: (tx: Transaction, tableId: string) => Promise<void>;
  others?: readonly string[];
}

function mergeBody(
  body: Record<string, unknown>,
  tableId: string,
): { targetId: string; side: JoinSide; seats: number | null } {
  const targetId = requireTargetTable(body.targetId, "targetId");
  if (targetId === tableId) throw invalid("targetId");
  const side = body.side;
  if (!JOIN_SIDES.includes(side as JoinSide)) throw invalid("side");
  const seats = body.seats === undefined ? null : whole(body.seats, "seats", 1, 999);
  return { targetId, side: side as JoinSide, seats };
}

function partsBody(body: Record<string, unknown>): { partIds: string[]; seats: number | null } {
  const raw = body.partIds;
  if (!Array.isArray(raw) || raw.length === 0) throw invalid("partIds");
  const partIds = raw.map((partId) => {
    if (typeof partId !== "string" || !isUuid(partId)) throw invalid("partIds");
    return partId.toLowerCase();
  });
  if (new Set(partIds).size !== partIds.length) throw invalid("partIds");
  const seats = body.seats === undefined ? null : whole(body.seats, "seats", 1, 999);
  return { partIds, seats };
}

/**
 * A zone route's `zoneRevision`: a whole number from 0, or `null` for a read that held no table
 * of the zone with a today's row.
 */
function zoneRevision(body: Record<string, unknown>): number | null {
  return body.zoneRevision === null ? null : requiredRevision(body);
}

/**
 * Refuses `floor_today.out_of_date` for a `sent` other than `from`, or for a null once the zone has
 * a today's row.
 */
async function refuseStaleZone(
  tx: Transaction,
  locationId: string,
  zoneId: string,
  sent: number | null,
  from: number,
): Promise<void> {
  if (sent !== null) refuseStale(zoneId, sent, from);
  else if (await hasTodayRow(tx, locationId, zoneId)) {
    throw new AppError("floor_today.out_of_date", { zoneId, revision: from });
  }
}

async function hasTodayRow(tx: Transaction, locationId: string, zoneId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: floorTodayTables.id })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(and(eq(diningTables.locationId, locationId), eq(diningTables.zoneId, zoneId)))
    .limit(1);
  return row !== undefined;
}

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await readRawJsonBody<unknown>(c);
  return raw === null ? {} : asObject(raw);
}

/** Today's changes to one table, merging and splitting, and the zone reset, each answering the room's revision. */
export function mountFloorTodayApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  const removals = deps.tableRemovals ?? [];

  /** The room's write, refused when `sent` is not its revision now; moves it when the write changed the room. */
  const changeRoom = async (
    tx: Transaction,
    zoneId: string,
    sent: number,
    write: () => Promise<void>,
  ): Promise<{ zoneId: string; revision: number }> => {
    const from = await roomRevision(tx, zoneId);
    refuseStale(zoneId, sent, from);
    const before = (await roomPrints(tx, deps.cfg, [zoneId])).get(zoneId);
    await write();
    const after = (await roomPrints(tx, deps.cfg, [zoneId])).get(zoneId);
    return { zoneId, revision: after === before ? from : await moveRoom(tx, zoneId, from) };
  };

  const tableRoute = (
    change: string,
    read: (body: Record<string, unknown>, tableId: string) => TableWrite,
  ) =>
    app.post(`/api/tables/:id/today/${change}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "take-orders" });
        const id = c.req.param("id");
        if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
        const tableId = id.toLowerCase();
        const body = await bodyOf(c);
        const sent = requiredRevision(body);
        const { write, others = [] } = read(body, tableId);
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, deps.cfg, session, [
            { tableId },
            ...others.map((other) => ({ tableId: other })),
          ]);
          await ensureToday(tx, deps.cfg, removals, deps.clock.now().instant);
          const zoneId = await zoneOfTable(tx, deps.cfg, tableId);
          return changeRoom(tx, zoneId, sent, () => write(tx, tableId));
        });
        return c.json(answer);
      }),
    );

  tableRoute("move", (body) => {
    const at = corner(body);
    return { write: (tx, tableId) => moveToday(tx, deps.cfg, tableId, at) };
  });
  tableRoute("rotate", () => ({ write: (tx, tableId) => rotateToday(tx, deps.cfg, tableId) }));
  tableRoute("take-off", () => ({ write: (tx, tableId) => takeOffToday(tx, deps.cfg, tableId) }));
  tableRoute("put-back", () => ({ write: (tx, tableId) => putBackToday(tx, deps.cfg, tableId) }));
  tableRoute("place", (body) => {
    const at = corner(body);
    return { write: (tx, tableId) => placeSpareToday(tx, deps.cfg, tableId, at) };
  });
  tableRoute("seats", (body) => {
    const seats = seatsOf(body);
    return { write: (tx, tableId) => seatsToday(tx, deps.cfg, tableId, seats) };
  });
  tableRoute("back", () => ({
    write: (tx, tableId) => backToSaved(tx, deps.cfg, removals, tableId, deps.clock.now().instant),
  }));
  tableRoute("mark-moved", () => ({
    write: (tx, tableId) => markMoved(tx, deps.cfg, removals, tableId, deps.clock.now().instant),
  }));
  tableRoute("leave-here", () => ({
    write: (tx, tableId) => leaveHere(tx, deps.cfg, removals, tableId, deps.clock.now().instant),
  }));
  tableRoute("name", (body) => {
    if (body.name === undefined) throw invalid("name");
    const name = normalisePartyName(body.name);
    return { write: (tx, tableId) => nameToday(tx, deps.cfg, tableId, name) };
  });
  tableRoute("merge", (body, tableId) => {
    const { targetId, side, seats } = mergeBody(body, tableId);
    return {
      write: (tx, movingId) =>
        withMovedSlips(
          tx,
          deps.cfg,
          { tables: [movingId, targetId], targetGroupOf: targetId },
          () => writeMerge(tx, deps.cfg, { movingId, targetId, side, seats, free: true }),
        ),
      others: [targetId],
    };
  });
  tableRoute("split-off", (body) => {
    const { partIds, seats } = partsBody(body);
    return {
      write: (tx, pathId) =>
        splitOff(tx, deps.cfg, removals, deps.clock.now().instant, {
          tableId: pathId,
          partIds,
          seats,
        }),
      others: partIds,
    };
  });
  tableRoute("reset", (body) => {
    const { partIds, seats } = partsBody(body);
    return {
      write: (tx, joinedId) =>
        resetTable(tx, deps.cfg, removals, deps.clock.now().instant, {
          tableId: joinedId,
          partIds,
          seats,
        }),
      others: partIds,
    };
  });

  app.post("/api/zones/:id/today/reset", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
      const zoneId = id.toLowerCase();
      const sent = zoneRevision(await bodyOf(c));
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const active = await zoneActive(tx, deps.cfg, zoneId);
        const now = deps.clock.now().instant;
        const day = await ensureToday(tx, deps.cfg, removals, now);
        const from = await roomRevision(tx, zoneId);
        await refuseStaleZone(tx, deps.cfg.locationId, zoneId, sent, from);
        if (!active || day === null) return from;
        const onto = await recordedOnto(tx, deps.cfg, zoneId, day);
        if (onto === null) return from;
        return resetZoneOn(tx, deps.cfg, removals, zoneId, day, now, onto);
      });
      return c.json({ zoneId, revision });
    }),
  );

  app.post("/api/zones/:id/today/update-layout", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
      const zoneId = id.toLowerCase();
      const body = await bodyOf(c);
      const sent = zoneRevision(body);
      if (typeof body.setId !== "string" || !isUuid(body.setId)) throw invalid("setId");
      const layout = {
        setId: body.setId.toLowerCase(),
        layoutRevision: whole(body.layoutRevision, "layoutRevision", 0, Number.MAX_SAFE_INTEGER),
      };
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const active = await zoneActive(tx, deps.cfg, zoneId);
        const now = deps.clock.now().instant;
        const day = await ensureToday(tx, deps.cfg, removals, now);
        const from = await roomRevision(tx, zoneId);
        await refuseStaleZone(tx, deps.cfg.locationId, zoneId, sent, from);
        if (!active) return from;
        return updateLayout(tx, deps.cfg, removals, zoneId, day, now, layout);
      });
      return c.json({ zoneId, revision });
    }),
  );
}

/** Whether the venue's zone is enabled; refuses `zone.not_found` for none. */
async function zoneActive(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<boolean> {
  const [zone] = await tx
    .select({ active: floorZones.active })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
  return zone.active;
}

/**
 * Today's record of the zone, which the reset goes back to; null, and nothing reset, when the
 * zone's department has no set or there is no record of today — `ensureToday` has already made
 * the day's first reset wherever a saved layout is due. Refuses
 * `floor_today.layout_changed` when the recorded set is deleted or not its department's.
 */
async function recordedOnto(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
  day: string,
): Promise<ResetOnto | null> {
  const sets = await VENUE_SERVICE.readFloorPlanSets(tx, cfg);
  if (!plannedZones(sets).has(zoneId)) return null;
  const [record] = await tx
    .select({ setId: floorTodayZones.setId, occurrence: floorTodayZones.occurrence })
    .from(floorTodayZones)
    .where(and(eq(floorTodayZones.zoneId, zoneId), eq(floorTodayZones.businessDay, day)));
  if (record === undefined) return null;
  const { setId, occurrence } = record;
  if (setId === null || !sets.some((set) => set.setId === setId && set.zoneIds.includes(zoneId))) {
    throw new AppError("floor_today.layout_changed", { zoneId });
  }
  return { setId, occurrence };
}
