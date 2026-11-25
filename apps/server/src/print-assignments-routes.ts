import {
  type Transaction,
  printers,
  deviceProfiles,
  stationPrinterPairs,
  kitchenStations,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ProfilePrinterRole } from "@waitron/layouts";
import { type Logger, requireManagementSession, requireUuidParam } from "@waitron/server-kit";
import { sql, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { VENUE_SERVICE } from "./modules.js";
import type { PrintPermissionGate } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
  putPrinterOnEveryStation,
} from "./station-printers.js";

const PROFILE_PRINTER_ROLE_ORDER = [
  "receipt",
  "payment_slip",
  "cash_drawer",
  "invoice",
] as const satisfies readonly ProfilePrinterRole[];
interface PrinterProfileUse {
  printerId: string | null;
  pagePrinterId: string | null;
  profileId: string;
  profileName: string;
  roles: ProfilePrinterRole[];
  departmentId: string | null;
  departmentName: string | null;
}
/** One row per printer or page printer and live profile listing it, its roles in a fixed order. */
async function readPrinterProfileUses(tx: Transaction): Promise<PrinterProfileUse[]> {
  const role = sql<ProfilePrinterRole>`printer_list.key`;
  const printerId = sql<string>`listed_printer.value`;
  const rows = await tx
    .select({
      printerId,
      kind: printers.kind,
      profileId: deviceProfiles.id,
      profileName: deviceProfiles.name,
      role,
    })
    .from(deviceProfiles)
    .crossJoin(sql`json_each(${deviceProfiles.printerLists}) as printer_list`)
    .crossJoin(sql`json_each(printer_list.value, '$.ids') as listed_printer`)
    // The wire response carries both receipt and A4 printer usage.
    .innerJoin(printers, eq(printers.id, printerId))
    .where(isNull(deviceProfiles.retiredAt))
    .orderBy(deviceProfiles.name, deviceProfiles.id, printers.kind, printerId);
  const uses = new Map<string, PrinterProfileUse>();
  for (const row of rows) {
    const key = `${row.profileId}/${row.printerId}`;
    const use = uses.get(key);
    if (use === undefined) {
      uses.set(key, {
        printerId: row.kind === "receipt" ? row.printerId : null,
        pagePrinterId: row.kind === "a4" ? row.printerId : null,
        profileId: row.profileId,
        profileName: row.profileName,
        roles: [row.role],
        departmentId: null,
        departmentName: null,
      });
    } else use.roles.push(row.role);
  }
  const result = [...uses.values()];
  for (const use of result)
    use.roles.sort(
      (a, b) => PROFILE_PRINTER_ROLE_ORDER.indexOf(a) - PROFILE_PRINTER_ROLE_ORDER.indexOf(b),
    );
  const profileIds = [...new Set(result.map((use) => use.profileId))];
  const departments = new Map(
    (await VENUE_SERVICE.readProfileDepartments(tx, profileIds)).map((d) => [d.profileId, d]),
  );
  for (const use of result) {
    const department = departments.get(use.profileId);
    use.departmentId = department?.departmentId ?? null;
    use.departmentName = department?.departmentName ?? null;
  }
  return result;
}

export function mountPrintAssignmentRoutes(
  app: Hono,
  gated: PrintPermissionGate,
  log: Logger,
): void {
  app.post("/management-api/stations/:sid/printers/:pid", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, (tx) => attachPrinterToStation(tx, { stationId, printerId }));
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/stations/:sid/printers/:pid", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, (tx) => detachPrinterFromStation(tx, { stationId, printerId }));
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/stations/:sid/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, { stationId }));
      return c.json(rows);
    }),
  );

  app.get("/management-api/printers/:pid/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, { printerId }));
      return c.json(rows);
    }),
  );

  app.post("/management-api/printers/:pid/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "venue.configure",
        });
        await putPrinterOnEveryStation(tx, printerId);
      });
      return c.body(null, 204);
    }),
  );

  // The printer details' "Used by" group, under the printers screen's own permission.
  app.get("/management-api/printer-profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(sessionId, readPrinterProfileUses));
    }),
  );

  app.get("/management-api/printer-stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            printerId: stationPrinterPairs.printerId,
            stationId: kitchenStations.id,
            stationName: kitchenStations.name,
          })
          .from(stationPrinterPairs)
          .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinterPairs.stationId))
          .where(eq(kitchenStations.active, true))
          .orderBy(kitchenStations.name, kitchenStations.id, stationPrinterPairs.printerId),
      );
      return c.json(rows);
    }),
  );
}
