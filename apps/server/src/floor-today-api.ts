import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import {
  diningTables,
  floorPlans,
  floorTodayTables,
  floorZones,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, JOIN_SIDES, type JoinSide } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { asObject } from "./bill-payments-api.js";
import {
  backToSaved,
  ensureToday,
  moveToday,
  placeSpareToday,
  putBackToday,
  resetZone,
  rotateToday,
  seatsToday,
  takeOffToday,
} from "./floor-today-store.js";
import { splitFreeMerge, writeMerge } from "./floor-today-merges.js";
import { joinAgain } from "./floor-today-join-again.js";
import { splitJoinedTable } from "./floor-today-split.js";
import type { Logger } from "./logger.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import { roomRevision, sentRevision } from "./floor-revision.js";
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

async function corner(c: Context): Promise<{ x: number; y: number }> {
  const body = asObject(await readRawJsonBody<unknown>(c));
  return { x: whole(body.x, "x", 0, 999), y: whole(body.y, "y", 0, 999) };
}

async function seatsOf(c: Context): Promise<number> {
  return whole(asObject(await readRawJsonBody<unknown>(c)).seats, "seats", 1, 999);
}

/** A write and the other tables its zone check covers. */
interface TableWrite {
  write: (tx: Transaction, tableId: string) => Promise<void>;
  others?: readonly string[];
}

async function mergeBody(
  c: Context,
  tableId: string,
): Promise<{ targetId: string; side: JoinSide; seats: number | null }> {
  const body = asObject(await readRawJsonBody<unknown>(c));
  const targetId = requireTargetTable(body.targetId, "targetId");
  if (targetId === tableId) throw invalid("targetId");
  const side = body.side;
  if (!JOIN_SIDES.includes(side as JoinSide)) throw invalid("side");
  const seats = body.seats === undefined ? null : whole(body.seats, "seats", 1, 999);
  return { targetId, side: side as JoinSide, seats };
}

async function partsBody(c: Context): Promise<{ partIds: string[]; seats: number | null }> {
  const body = asObject(await readRawJsonBody<unknown>(c));
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
 * The zone reset's `zoneRevision`: a whole number from 0, `null` for a read that held no table of
 * the zone with a today's row, or undefined when the till sends none.
 */
async function resetRevision(c: Context): Promise<number | null | undefined> {
  const raw = await readRawJsonBody<unknown>(c);
  const body = raw === null ? {} : asObject(raw);
  return body.zoneRevision === null ? null : sentRevision(body);
}

async function hasTodayRow(tx: Transaction, zoneId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: floorTodayTables.id })
    .from(floorTodayTables)
    .innerJoin(diningTables, eq(diningTables.id, floorTodayTables.tableId))
    .where(eq(diningTables.zoneId, zoneId))
    .limit(1);
  return row !== undefined;
}

/** Today's changes to one table, merging and splitting, each answering 204; the zone reset answers the room's revision. */
export function mountFloorTodayApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  const removals = deps.tableRemovals ?? [];

  const tableRoute = (
    change: string,
    read: (c: Context, tableId: string) => TableWrite | Promise<TableWrite>,
  ) =>
    app.post(`/api/tables/:id/today/${change}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "take-orders" });
        const id = c.req.param("id");
        if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
        const tableId = id.toLowerCase();
        const { write, others = [] } = await read(c, tableId);
        await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, deps.cfg, session, [
            { tableId },
            ...others.map((other) => ({ tableId: other })),
          ]);
          await ensureToday(tx, deps.cfg, removals, deps.clock.now().instant);
          await write(tx, tableId);
        });
        return c.body(null, 204);
      }),
    );

  tableRoute("move", async (c) => {
    const at = await corner(c);
    return { write: (tx, tableId) => moveToday(tx, deps.cfg, tableId, at) };
  });
  tableRoute("rotate", () => ({ write: (tx, tableId) => rotateToday(tx, deps.cfg, tableId) }));
  tableRoute("take-off", () => ({ write: (tx, tableId) => takeOffToday(tx, deps.cfg, tableId) }));
  tableRoute("put-back", () => ({ write: (tx, tableId) => putBackToday(tx, deps.cfg, tableId) }));
  tableRoute("place", async (c) => {
    const at = await corner(c);
    return { write: (tx, tableId) => placeSpareToday(tx, deps.cfg, tableId, at) };
  });
  tableRoute("seats", async (c) => {
    const seats = await seatsOf(c);
    return { write: (tx, tableId) => seatsToday(tx, deps.cfg, tableId, seats) };
  });
  tableRoute("back", () => ({ write: (tx, tableId) => backToSaved(tx, deps.cfg, tableId) }));
  tableRoute("merge", async (c, tableId) => {
    const { targetId, side, seats } = await mergeBody(c, tableId);
    return {
      write: (tx, movingId) =>
        writeMerge(tx, deps.cfg, { movingId, targetId, side, seats, free: true }),
      others: [targetId],
    };
  });
  tableRoute("split", () => ({ write: (tx, tableId) => splitFreeMerge(tx, deps.cfg, tableId) }));
  tableRoute("split-off", async (c) => {
    const { partIds, seats } = await partsBody(c);
    return {
      write: (tx, joinedId) =>
        splitJoinedTable(tx, deps.cfg, { tableId: joinedId, partIds, seats }),
      others: partIds,
    };
  });
  tableRoute("join-again", async (c) => {
    const { partIds, seats } = await partsBody(c);
    return {
      write: (tx, joinedId) =>
        joinAgain(tx, deps.cfg, removals, deps.clock.now().instant, {
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
      const sent = await resetRevision(c);
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const [zone] = await tx
          .select({ active: floorZones.active, planId: floorPlans.id })
          .from(floorZones)
          .leftJoin(floorPlans, eq(floorPlans.zoneId, floorZones.id))
          .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, deps.cfg.locationId)));
        if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
        const now = deps.clock.now().instant;
        await ensureToday(tx, deps.cfg, removals, now);
        const from = await roomRevision(tx, zoneId);
        const stale =
          sent === null ? await hasTodayRow(tx, zoneId) : sent !== undefined && sent !== from;
        if (stale) throw new AppError("floor_today.out_of_date", { zoneId, revision: from });
        if (zone.active && zone.planId !== null)
          await resetZone(tx, deps.cfg, removals, zoneId, now);
        return roomRevision(tx, zoneId);
      });
      return c.json({ zoneId, revision });
    }),
  );
}
