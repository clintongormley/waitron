import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { parseStationTimingPatch } from "@waitron/provisioning";
import {
  requireUuidParam,
  type Logger,
  requireManagementSession,
  readJsonBody,
} from "@waitron/server-kit";
import {
  type StationColour,
  isStationColour,
  AppError,
  type TicketGrouping,
  isTicketGrouping,
  type BumpMode,
  isBumpMode,
  type ChangesAfterSending,
  isChangesAfterSending,
  isUuid,
} from "@waitron/shared";
import type { Hono } from "hono";
import { createStation, listStations, updateStation, setDefaultStation } from "./kitchen.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { runBodyPrinters, run } from "./management-api-errors.js";
import { withVenueAuth, withVenueReadAuth, requireStationId } from "./management-request-fields.js";
import { readPassCoverage } from "./pass-coverage.js";
import { readStationDeleteImpact, deleteStation } from "./station-delete.js";

function parseStationColour(value: unknown): StationColour | undefined {
  if (value === undefined) return undefined;
  if (!isStationColour(value))
    throw new AppError("management.request_invalid", { field: "colour" });
  return value;
}
function parseTicketGrouping(value: unknown): TicketGrouping | undefined {
  if (value === undefined) return undefined;
  if (!isTicketGrouping(value))
    throw new AppError("management.request_invalid", { field: "ticketGrouping" });
  return value;
}
function parseBumpMode(value: unknown): BumpMode | undefined {
  if (value === undefined) return undefined;
  if (!isBumpMode(value)) throw new AppError("management.request_invalid", { field: "bumpMode" });
  return value;
}
function parseChangesAfterSending(value: unknown): ChangesAfterSending | undefined {
  if (value === undefined) return undefined;
  if (!isChangesAfterSending(value)) {
    throw new AppError("management.request_invalid", { field: "changesAfterSending" });
  }
  return value;
}
function parseStationPrinterIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string") ||
    new Set(value).size !== value.length
  ) {
    throw new AppError("management.request_invalid", { field: "printerIds" });
  }
  return value.map((id: string) => requireUuidParam(id, "PrinterId"));
}
/** A station's printers need `hardware.manage` beside the `venue.configure` the route checks. */
async function authorizeStationPrinters(
  tx: Transaction,
  sessionId: string,
  printerIds: readonly string[] | undefined,
): Promise<void> {
  if (printerIds === undefined) return;
  await authorizeManager(tx, { managementSessionId: sessionId, permission: "hardware.manage" });
}

export function mountManagementStationRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
): void {
  // ── Kitchen stations and routing ──
  app.post("/management-api/stations", (c) =>
    runBodyPrinters(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        isDefault?: unknown;
        colour?: unknown;
        warmAfterMinutes?: unknown;
        overdueAfterMinutes?: unknown;
        forgottenAfterMinutes?: unknown;
        readyWarningAfterMinutes?: unknown;
        printerIds?: unknown;
        waitsForPass?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      if (Object.hasOwn(body, "displayOrder"))
        throw new AppError("management.request_invalid", { field: "displayOrder" });
      let isDefault: boolean | undefined;
      if (body.isDefault !== undefined) {
        if (typeof body.isDefault !== "boolean")
          throw new AppError("management.request_invalid", { field: "isDefault" });
        isDefault = body.isDefault;
      }
      let waitsForPass: boolean | undefined;
      if (body.waitsForPass !== undefined) {
        if (typeof body.waitsForPass !== "boolean")
          throw new AppError("management.request_invalid", { field: "waitsForPass" });
        waitsForPass = body.waitsForPass;
      }
      const colour = parseStationColour(body.colour);
      const { name } = body;
      const thresholds = parseStationTimingPatch(body);
      const printerIds = parseStationPrinterIds(body.printerIds);
      const result = await withVenueAuth(deps, sessionId, async (tx) => {
        await authorizeStationPrinters(tx, sessionId, printerIds);
        return createStation(tx, {
          name,
          isDefault,
          colour,
          thresholds,
          printerIds,
          waitsForPass,
        });
      });
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stations = await withVenueReadAuth(deps, sessionId, (tx) => listStations(tx));
      return c.json(stations);
    }),
  );

  app.get("/management-api/stations/pass-coverage", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await withVenueAuth(deps, sessionId, (tx) => readPassCoverage(tx));
      return c.json(result);
    }),
  );

  app.patch("/management-api/stations/:id", (c) =>
    runBodyPrinters(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        showsRestOfOrder?: unknown;
        printMovedSlips?: unknown;
        colour?: unknown;
        ticketGrouping?: unknown;
        printHeldWork?: unknown;
        bumpMode?: unknown;
        changesAfterSending?: unknown;
        warmAfterMinutes?: unknown;
        overdueAfterMinutes?: unknown;
        forgottenAfterMinutes?: unknown;
        readyWarningAfterMinutes?: unknown;
        printerIds?: unknown;
        waitsForPass?: unknown;
        whenClosedSendsTo?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (Object.hasOwn(body, "active"))
        throw new AppError("management.request_invalid", { field: "active" });
      const patch: {
        name?: string;
        showsRestOfOrder?: boolean;
        printMovedSlips?: boolean;
        colour?: StationColour;
        ticketGrouping?: TicketGrouping;
        printHeldWork?: boolean;
        bumpMode?: BumpMode;
        changesAfterSending?: ChangesAfterSending;
        waitsForPass?: boolean;
        warmAfterMinutes?: number;
        overdueAfterMinutes?: number;
        forgottenAfterMinutes?: number;
        readyWarningAfterMinutes?: number;
        printerIds?: string[];
        whenClosedSendsTo?: string | null;
      } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (Object.hasOwn(body, "displayOrder"))
        throw new AppError("management.request_invalid", { field: "displayOrder" });
      if (body.showsRestOfOrder !== undefined) {
        if (typeof body.showsRestOfOrder !== "boolean")
          throw new AppError("management.request_invalid", { field: "showsRestOfOrder" });
        patch.showsRestOfOrder = body.showsRestOfOrder;
      }
      if (body.printMovedSlips !== undefined) {
        if (typeof body.printMovedSlips !== "boolean")
          throw new AppError("management.request_invalid", { field: "printMovedSlips" });
        patch.printMovedSlips = body.printMovedSlips;
      }
      if (body.printHeldWork !== undefined) {
        if (typeof body.printHeldWork !== "boolean")
          throw new AppError("management.request_invalid", { field: "printHeldWork" });
        patch.printHeldWork = body.printHeldWork;
      }
      if (body.waitsForPass !== undefined) {
        if (typeof body.waitsForPass !== "boolean")
          throw new AppError("management.request_invalid", { field: "waitsForPass" });
        patch.waitsForPass = body.waitsForPass;
      }
      const colour = parseStationColour(body.colour);
      if (colour !== undefined) patch.colour = colour;
      const ticketGrouping = parseTicketGrouping(body.ticketGrouping);
      if (ticketGrouping !== undefined) patch.ticketGrouping = ticketGrouping;
      const bumpMode = parseBumpMode(body.bumpMode);
      if (bumpMode !== undefined) patch.bumpMode = bumpMode;
      const changesAfterSending = parseChangesAfterSending(body.changesAfterSending);
      if (changesAfterSending !== undefined) patch.changesAfterSending = changesAfterSending;
      Object.assign(patch, parseStationTimingPatch(body));
      const printerIds = parseStationPrinterIds(body.printerIds);
      if (printerIds !== undefined) patch.printerIds = printerIds;
      if (body.whenClosedSendsTo !== undefined) {
        if (
          body.whenClosedSendsTo !== null &&
          (typeof body.whenClosedSendsTo !== "string" || !isUuid(body.whenClosedSendsTo))
        )
          throw new AppError("management.request_invalid", { field: "whenClosedSendsTo" });
        patch.whenClosedSendsTo = body.whenClosedSendsTo?.toLowerCase() ?? null;
      }
      await withVenueAuth(deps, sessionId, async (tx) => {
        await authorizeStationPrinters(tx, sessionId, patch.printerIds);
        await updateStation(tx, id, patch);
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/stations/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      return c.json(await withVenueAuth(deps, sessionId, (tx) => readStationDeleteImpact(tx, id)));
    }),
  );

  app.delete("/management-api/stations/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      if ((await c.req.text()) !== "")
        throw new AppError("management.request_invalid", { field: "body" });
      return c.json(await withVenueAuth(deps, sessionId, (tx) => deleteStation(tx, id)));
    }),
  );

  app.post("/management-api/stations/:id/default", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      await withVenueAuth(deps, sessionId, (tx) => setDefaultStation(tx, id));
      return c.body(null, 204);
    }),
  );
}
