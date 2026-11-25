import { type Transaction, floorZones } from "@waitron/db";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { isUuid, AppError } from "@waitron/shared";
import { readZoneDeleteImpact, deleteZone } from "@waitron/venue-service";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import "./errors.js";
import { floorDeletionFor } from "./floor-delete.js";
import { type ZonePlanSave, readLayout, saveLayout } from "./floor-plan.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run, runFloorPlanSave } from "./management-api-errors.js";
import { withVenueAuth, parseDisplayOrder } from "./management-request-fields.js";
import { listZones, updateZone, listTables } from "./tables.js";

function requireZoneId(id: string): string {
  if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
  return id;
}
function requireSetId(id: string): string {
  if (!isUuid(id)) throw new AppError("floor_plan_set.not_found", { setId: id });
  return id;
}

async function requireLiveZone(tx: Transaction, id: string): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.id, id), eq(floorZones.active, true)));
  if (zone === undefined) throw new AppError("zone.not_found", { zoneId: id });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringUnlessNullish(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
  return value;
}
/**
 * The shape of a floor-plan save; `saveLayout` checks the values. A null id, live table or
 * short name is absent, as the read shape sends them.
 */
function parseZonePlanSave(body: unknown): ZonePlanSave {
  const refuse = (field: string): never => {
    throw new AppError("management.request_invalid", { field });
  };
  if (!isRecord(body)) refuse("body");
  const { revision, tables } = body as Record<string, unknown>;
  if (typeof revision !== "number") refuse("revision");
  if (!Array.isArray(tables)) refuse("tables");
  return {
    revision: revision as number,
    tables: (tables as unknown[]).map((table, index) => {
      const at = `tables.${index}`;
      if (!isRecord(table)) return refuse(at);
      if (typeof table.key !== "string") refuse(`${at}.key`);
      if (typeof table.label !== "string") refuse(`${at}.label`);
      if (typeof table.fixed !== "boolean") refuse(`${at}.fixed`);
      if (table.placement !== null && !isRecord(table.placement)) refuse(`${at}.placement`);
      const id = stringUnlessNullish(table.id, `${at}.id`);
      const shortName = stringUnlessNullish(table.shortName, `${at}.shortName`);
      const partKeys = table.partKeys;
      if (!Array.isArray(partKeys) || !partKeys.every((key) => typeof key === "string")) {
        refuse(`${at}.partKeys`);
      }
      return {
        ...(id === undefined ? {} : { id }),
        key: table.key as string,
        label: table.label as string,
        seats: table.seats as number | null,
        fixed: table.fixed as boolean,
        placement: table.placement as ZonePlanSave["tables"][number]["placement"],
        partKeys: partKeys as string[],
        ...(shortName === undefined ? {} : { shortName }),
      };
    }),
  };
}

export function mountManagementFloorRoutes(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  // ── Zones and tables ──
  app.get("/management-api/zones", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const zones = await withVenueAuth(deps, sessionId, (tx) => listZones(tx));
      return c.json(zones);
    }),
  );

  app.patch("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (Object.hasOwn(body, "active"))
        throw new AppError("management.request_invalid", { field: "active" });
      const patch: { name?: string; displayOrder?: number } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined)
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      await withVenueAuth(deps, sessionId, async (tx) => {
        await requireLiveZone(tx, id);
        if (Object.keys(patch).length > 0) await updateZone(tx, id, patch);
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/zones/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      return c.json(
        await withVenueAuth(deps, sessionId, async (tx) => {
          await requireLiveZone(tx, id);
          return readZoneDeleteImpact(
            tx,
            floorDeletionFor(deps.tableRemovals ?? []),
            id,
            new Date(),
          );
        }),
      );
    }),
  );

  app.delete("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      if ((await c.req.text()) !== "")
        throw new AppError("management.request_invalid", { field: "body" });
      return c.json(
        await withVenueAuth(deps, sessionId, async (tx) => {
          await requireLiveZone(tx, id);
          return deleteZone(tx, floorDeletionFor(deps.tableRemovals ?? []), id, new Date());
        }),
      );
    }),
  );

  app.get("/management-api/floor-plan-sets/:setId/zones/:zoneId/floor-plan", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const at = {
        setId: requireSetId(c.req.param("setId")),
        zoneId: requireZoneId(c.req.param("zoneId")),
      };
      return c.json(await withVenueAuth(deps, sessionId, (tx) => readLayout(tx, at)));
    }),
  );

  app.put("/management-api/floor-plan-sets/:setId/zones/:zoneId/floor-plan", (c) =>
    runFloorPlanSave(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const at = {
        setId: requireSetId(c.req.param("setId")),
        zoneId: requireZoneId(c.req.param("zoneId")),
      };
      const input = parseZonePlanSave(await readJsonBody<unknown>(c));
      const now = new Date();
      const saved = await withVenueAuth(deps, sessionId, (tx) =>
        saveLayout(tx, deps.tableRemovals ?? [], at, input, now),
      );
      return c.json(saved);
    }),
  );

  app.get("/management-api/tables", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const tables = await withVenueAuth(deps, sessionId, (tx) =>
        listTables(tx, new Date(), {
          includeDisabled: c.req.query("includeDisabled") === "true",
        }),
      );
      return c.json(tables);
    }),
  );
}
