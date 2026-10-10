import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { floorPlans, floorZones, withTransaction, type Transaction } from "@waitron/db";
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
import type { Logger } from "./logger.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

function whole(value: unknown, field: string, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high)
    throw invalid(field);
  return value;
}

async function corner(c: Context): Promise<{ x: number; y: number }> {
  const body = asObject(await readRawJsonBody<unknown>(c));
  return { x: whole(body.x, "x", 0, 999), y: whole(body.y, "y", 0, 999) };
}

async function seatsOf(c: Context): Promise<number> {
  return whole(asObject(await readRawJsonBody<unknown>(c)).seats, "seats", 1, 999);
}

type TableWrite = (tx: Transaction, tableId: string) => Promise<void>;
/** A write and the other tables its zone check covers. */
type TablesWrite = { write: TableWrite; others: readonly string[] };

async function mergeBody(
  c: Context,
  tableId: string,
): Promise<{ targetId: string; side: JoinSide; seats: number | null }> {
  const body = asObject(await readRawJsonBody<unknown>(c));
  const target = body.targetId;
  if (typeof target !== "string" || !isUuid(target))
    throw new AppError("table.not_found", { tableId: String(target) });
  const targetId = target.toLowerCase();
  if (targetId === tableId) throw invalid("targetId");
  const side = body.side;
  if (!JOIN_SIDES.includes(side as JoinSide)) throw invalid("side");
  const seats = body.seats === undefined ? null : whole(body.seats, "seats", 1, 999);
  return { targetId, side: side as JoinSide, seats };
}

/** Today's changes to one table, merging and splitting, and the zone reset; each answers 204. */
export function mountFloorTodayApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  const removals = deps.tableRemovals ?? [];

  const tableRoute = (
    change: string,
    read: (
      c: Context,
      tableId: string,
    ) => TableWrite | TablesWrite | Promise<TableWrite | TablesWrite>,
  ) =>
    app.post(`/api/tables/:id/today/${change}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "take-orders" });
        const id = c.req.param("id");
        if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
        const tableId = id.toLowerCase();
        const parsed = await read(c, tableId);
        const { write, others } =
          typeof parsed === "function" ? { write: parsed, others: [] } : parsed;
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
    return (tx, tableId) => moveToday(tx, deps.cfg, tableId, at);
  });
  tableRoute("rotate", () => (tx, tableId) => rotateToday(tx, deps.cfg, tableId));
  tableRoute("take-off", () => (tx, tableId) => takeOffToday(tx, deps.cfg, tableId));
  tableRoute("put-back", () => (tx, tableId) => putBackToday(tx, deps.cfg, tableId));
  tableRoute("place", async (c) => {
    const at = await corner(c);
    return (tx, tableId) => placeSpareToday(tx, deps.cfg, tableId, at);
  });
  tableRoute("seats", async (c) => {
    const seats = await seatsOf(c);
    return (tx, tableId) => seatsToday(tx, deps.cfg, tableId, seats);
  });
  tableRoute("back", () => (tx, tableId) => backToSaved(tx, deps.cfg, tableId));
  tableRoute("merge", async (c, tableId) => {
    const { targetId, side, seats } = await mergeBody(c, tableId);
    return {
      write: (tx, movingId) =>
        writeMerge(tx, deps.cfg, { movingId, targetId, side, seats, free: true }),
      others: [targetId],
    };
  });
  tableRoute("split", () => (tx, tableId) => splitFreeMerge(tx, deps.cfg, tableId));

  app.post("/api/zones/:id/today/reset", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
      const zoneId = id.toLowerCase();
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const [zone] = await tx
          .select({ active: floorZones.active, planId: floorPlans.id })
          .from(floorZones)
          .leftJoin(floorPlans, eq(floorPlans.zoneId, floorZones.id))
          .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, deps.cfg.locationId)));
        if (zone === undefined) throw new AppError("zone.not_found", { zoneId });
        const now = deps.clock.now().instant;
        await ensureToday(tx, deps.cfg, removals, now);
        // A reset switches tables on, so a disabled zone's must stay off; ensureToday skips both too.
        if (zone.active && zone.planId !== null)
          await resetZone(tx, deps.cfg, removals, zoneId, now);
      });
      return c.body(null, 204);
    }),
  );
}
