import { and, eq, exists, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import {
  diningTables,
  floorPlans,
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
  resetZone,
  type ResetOnto,
  rotateToday,
  seatsToday,
  takeOffToday,
} from "./floor-today-store.js";
import { writeMerge } from "./floor-today-merges.js";
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
 * The zone reset's `zoneRevision`: a whole number from 0, or `null` for a read that held no table
 * of the zone with a today's row.
 */
async function resetRevision(c: Context): Promise<number | null> {
  const body = await bodyOf(c);
  return body.zoneRevision === null ? null : requiredRevision(body);
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
  tableRoute("back", () => ({ write: (tx, tableId) => backToSaved(tx, deps.cfg, tableId) }));
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
      const sent = await resetRevision(c);
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const [zone] = await tx
          .select({
            active: floorZones.active,
            hasPlan: sql<number>`${exists(
              tx
                .select({ id: floorPlans.id })
                .from(floorPlans)
                .where(eq(floorPlans.zoneId, floorZones.id)),
            )}`,
          })
          .from(floorZones)
          .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, deps.cfg.locationId)));
        if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
        const now = deps.clock.now().instant;
        await ensureToday(tx, deps.cfg, removals, now);
        const from = await roomRevision(tx, zoneId);
        if (sent !== null) refuseStale(zoneId, sent, from);
        else if (await hasTodayRow(tx, deps.cfg.locationId, zoneId)) {
          throw new AppError("floor_today.out_of_date", { zoneId, revision: from });
        }
        if (!zone.active || !zone.hasPlan) return from;
        const onto = await recordedOrDefault(tx, deps.cfg, zoneId);
        return (await resetZone(tx, deps.cfg, removals, zoneId, now, onto)) ?? from;
      });
      return c.json({ zoneId, revision });
    }),
  );
}

/** The layout the zone's record names; with no record, the department's default set. */
async function recordedOrDefault(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
): Promise<ResetOnto> {
  const [record] = await tx
    .select({ setId: floorTodayZones.setId, occurrence: floorTodayZones.occurrence })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  if (record !== undefined) return record;
  const sets = await VENUE_SERVICE.readFloorPlanSets(tx, cfg);
  const fallback = sets.find((set) => set.isDefault && set.zoneIds.includes(zoneId));
  return { setId: fallback?.setId ?? null, occurrence: null };
}
