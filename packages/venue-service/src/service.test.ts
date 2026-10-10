import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { stationDayStates } from "./schema/station-times.js";
import { setStationToday } from "./station-times.js";
import { VENUE_SERVICE } from "./service.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("VENUE_SERVICE", () => {
  it("exposes every generic ordering capability", () => {
    expect(Object.keys(VENUE_SERVICE).sort()).toEqual([
      "acceptDepartmentTransfer",
      "acknowledgeKitchenNotice",
      "addProfileKitchenScreen",
      "assertDeviceKitchenScreens",
      "assertKitchenDisplayHasScreen",
      "assertPassScreenZone",
      "assertPeriodEndOffsets",
      "assertProfileZone",
      "assertZoneTakesNewOrders",
      "closeStationForToday",
      "closedZoneIdsAt",
      "copyLineContext",
      "copyOrderContext",
      "declineDepartmentTransfer",
      "describeMakers",
      "findOrderContext",
      "findOrderModes",
      "findOrderZones",
      "getOrderContext",
      "keepPeriodOpen",
      "keepZoneOpen",
      "listDepartmentSentTransfers",
      "listDepartmentTransferDestinations",
      "listIncomingDepartmentTransfers",
      "listLineContexts",
      "listSentDepartmentTransfers",
      "listServiceZones",
      "listStationNotices",
      "listStationsNotices",
      "listZoneOffers",
      "menuState",
      "narrowDeviceKitchenScreens",
      "openStationForToday",
      "orderInZones",
      "readClearingWorkflow",
      "readDepartmentLogoRasters",
      "readDepartmentReceipt",
      "readDepartmentTransfer",
      "readDeviceKitchenScreens",
      "readDevicesKitchenScreens",
      "readEditSentLines",
      "readIncomingDepartmentTransfer",
      "readKeepOpen",
      "readKitchenTicketGrouping",
      "readLinesSoldInEach",
      "readPrintHeldWork",
      "readPrintedDepartmentReceipt",
      "readProfileKitchenScreens",
      "readProfileServiceAccess",
      "readProfileServiceScopes",
      "readProfileZones",
      "readReleaseReminderMinutes",
      "readSaleReceiptHeader",
      "readStationScreens",
      "readZoneKeepOpenState",
      "receiptDefaultDepartment",
      "receiptDepartmentForOrder",
      "receiptDepartmentForSale",
      "recordKitchenNotices",
      "recordLineContexts",
      "recordOrderContext",
      "recordSaleReceiptHeader",
      "requestDepartmentTransfer",
      "resolveDefaultMenu",
      "resolveDepartmentService",
      "resolveExtraMakers",
      "resolveMakers",
      "resolveNewOrderZone",
      "resolveSalePolicy",
      "resolveZoneContext",
      "retargetOrderContext",
      "routingAt",
      "setDeviceKitchenScreens",
      "setProfileKitchenScreens",
      "setProfileServiceScope",
      "stationDestinations",
      "stationStates",
      "withdrawDepartmentTransfer",
      "withdrawPendingDepartmentTransfers",
      "writeDepartmentReceipt",
    ]);
  });

  it("transfers the service settings, and never the kitchen notices, which are operational rows", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names).toContain("service_settings");
    expect(names).not.toContain("kitchen_notices");
  });

  it("transfers a profile's department, zones and kitchen screens, which travel with profiles", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names).toContain("device_profile_service_access");
    expect(names).toContain("device_profile_zones");
    expect(names).toContain("device_profile_kitchen_screens");
    expect(names).toContain("device_profile_kitchen_screen_stations");
    expect(names).toContain("device_profile_kitchen_screen_zones");
    expect(names).not.toContain("device_profile_stations");
    expect(names).not.toContain("device_profile_watchers");
    expect(names.indexOf("device_profile_service_access")).toBeLessThan(
      names.indexOf("device_profile_zones"),
    );
  });

  it("transfers service calendars without station hours, fallbacks or today's by-hand state", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    for (const table of [
      "hours_week_cells",
      "hours_week_periods",
      "special_date_hours",
      "special_date_hours_periods",
    ])
      expect(names).not.toContain(table);
    expect(names).toContain("special_dates");
    expect(names).toContain("menu_periods");
    expect(names).toContain("menu_day_timetables");
    expect(names).toContain("menu_slots");
    expect(names).toContain("zone_closed_times");
    expect(names).not.toContain("station_hours");
    expect(names).not.toContain("department_hours");
    expect(names).not.toContain("station_fallbacks");
    expect(names).not.toContain("station_day_states");
    expect(names).not.toContain("period_extensions");
    expect(names).not.toContain("zone_extensions");
  });
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const AT = new Date("2026-10-02T18:00:00Z");

async function stationFixture(tx: Transaction) {
  const [venue] = await tx
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(venue!.id) };
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Grill" },
      { ...cfg, name: "Kitchen", isDefault: true },
      { ...cfg, name: "Bar" },
      { ...cfg, name: "Closed bar" },
      { ...cfg, name: "Retired", active: false },
    ])
    .returning();
  return {
    cfg,
    grill: stations[0]!.id,
    kitchen: stations[1]!.id,
    bar: stations[2]!.id,
    closed: stations[3]!.id,
  };
}

describe("station day seats", () => {
  it("lists the default first and omits the source and unavailable destinations", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await stationFixture(tx);
      await setStationToday(tx, f.cfg, f.closed, "closed", AT);
      expect(await VENUE_SERVICE.stationDestinations(tx, f.cfg, f.grill, AT)).toEqual([
        { id: f.kitchen, name: "Kitchen", isDefault: true },
        { id: f.bar, name: "Bar", isDefault: false },
      ]);
    });
  });

  it("closes the chosen station for this business day and records its destination", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await stationFixture(tx);
      await VENUE_SERVICE.closeStationForToday(tx, f.cfg, f.grill, f.bar, AT);
      expect(
        await tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, f.grill)),
      ).toEqual([
        {
          id: expect.any(String),
          stationId: f.grill,
          businessDay: "2026-10-02",
          open: false,
          sendsToStationId: f.bar,
        },
      ]);
      expect((await VENUE_SERVICE.stationStates(tx, f.cfg, AT)).get(f.grill)).toMatchObject({
        open: false,
        byHand: "closed",
        sendsTo: f.bar,
        why: "closed_by_hand",
      });
    });
  });

  it("opens a station by deleting its closure and destination", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await stationFixture(tx);
      await setStationToday(tx, f.cfg, f.grill, "closed", AT, f.bar);
      await VENUE_SERVICE.openStationForToday(tx, f.cfg, f.grill, AT);
      expect(
        await tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, f.grill)),
      ).toEqual([]);
      expect((await VENUE_SERVICE.stationStates(tx, f.cfg, AT)).get(f.grill)).toMatchObject({
        open: true,
        byHand: null,
        sendsTo: null,
        why: "open",
      });
    });
  });
});
