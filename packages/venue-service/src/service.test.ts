import { eq, and, isNotNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  withTransaction,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedActivityActor } from "@waitron/db/testing/seed.js";
import { setStationToday } from "./station-times.js";
import { VENUE_SERVICE } from "./service.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("VENUE_SERVICE", () => {
  it("exposes every generic ordering capability", () => {
    expect(Object.keys(VENUE_SERVICE).sort()).toEqual([
      "acceptDepartmentTransfer",
      "acknowledgeKitchenNotice",
      "addProfileKitchenScreen",
      "allocateBillNumber",
      "assertBusinessDayClockChange",
      "assertBusinessDayScheduleWrite",
      "assertDeviceKitchenScreens",
      "assertKitchenDisplayHasScreen",
      "assertPassScreenZone",
      "assertProfileZone",
      "assertZoneTakesNewOrders",
      "closeStationForToday",
      "closedZoneIdsAt",
      "copyLineContext",
      "copyLineContexts",
      "copyOrderContext",
      "copyProfileKitchenScreens",
      "copyTicketAllergy",
      "declineDepartmentTransfer",
      "describeMakers",
      "dueFloorLayouts",
      "findOrderContext",
      "findOrderModes",
      "findOrderZones",
      "getOrderContext",
      "keepZoneOpen",
      "kitchenNoteKey",
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
      "mergePartyAllergies",
      "moveAllergyDraftTicks",
      "moveBillAllergies",
      "narrowDeviceKitchenScreens",
      "openStationForToday",
      "orderInZones",
      "orderZoneIdSql",
      "partiesWithAllergicGuests",
      "productsOfferedIn",
      "readBillIdentities",
      "readDepartmentLogoRasters",
      "readDepartmentReceipt",
      "readDepartmentReceiptPolicy",
      "readDepartmentTransfer",
      "readDeviceKitchenScreens",
      "readDeviceZoneSelection",
      "readDevicesKitchenScreens",
      "readFloorPlanSets",
      "readIncomingDepartmentTransfer",
      "readKeepOpen",
      "readKitchenNotes",
      "readLateSendMarks",
      "readLateSendNeedsManager",
      "readLinesSoldInEach",
      "readLunchLineIds",
      "readLunchOffers",
      "readPartyAllergy",
      "readPrintedDepartmentReceipt",
      "readProfileDepartments",
      "readProfileKitchenScreens",
      "readProfileServiceAccess",
      "readProfileServiceScopes",
      "readProfileZones",
      "readProfilesZones",
      "readReleaseReminderMinutesByZone",
      "readRetainedDepartmentReceipt",
      "readSaleReceiptHeader",
      "readSentLineNutrition",
      "readServiceDay",
      "readStationScreens",
      "readTablesNeedingClearing",
      "readTicketAllergies",
      "readZoneClosingStates",
      "readZoneKeepOpenState",
      "receiptDefaultDepartment",
      "receiptDepartmentForOrder",
      "receiptDepartmentForSale",
      "recordKitchenNotices",
      "recordLineContexts",
      "recordOrderContext",
      "recordSaleReceiptHeader",
      "recordSentLineNutrition",
      "recordTicketAllergies",
      "releaseBillNumber",
      "requestDepartmentTransfer",
      "rescopeBillNumbers",
      "resolveDefaultMenu",
      "resolveDepartmentService",
      "resolveExtraMakers",
      "resolveMakers",
      "resolveNewOrderZone",
      "resolveSalePolicy",
      "resolveZoneContext",
      "retargetOrderContext",
      "routingAt",
      "saveDepartmentReceiptSettings",
      "savePartyAllergy",
      "setAllergyLineTicks",
      "setBillName",
      "setDeviceKitchenScreenDisplay",
      "setDeviceKitchenScreens",
      "setDeviceZoneSelection",
      "setProfileKitchenScreens",
      "setProfileServiceScope",
      "setTicketAllergyCurrent",
      "splitPartyAllergies",
      "stationDestinations",
      "stationStates",
      "withdrawDepartmentTransfer",
      "withdrawPendingDepartmentTransfers",
      "writeDepartmentReceipt",
      "writeKitchenNote",
      "writePartyAllergy",
    ]);
  });

  it("never transfers the kitchen notices, which are operational rows", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
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
    expect(names).toContain("special_days");
    expect(names).toContain("special_day_dates");
    expect(names).toContain("menu_periods");
    expect(names).toContain("department_days");
    expect(names).toContain("department_day_ranges");
    expect(names).toContain("zone_days");
    expect(names).toContain("zone_day_ranges");
    expect(names).not.toContain("station_hours");
    expect(names).not.toContain("department_hours");
    expect(names).not.toContain("station_fallbacks");
    expect(names).not.toContain("station_day_states");
    expect(names).not.toContain("period_extensions");
    expect(names).not.toContain("zone_extensions");
  });
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const AT = new Date("2026-10-02T18:00:00Z");

async function stationFixture(tx: Transaction) {
  await seedVenue(tx, {
    name: "Venue",
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  });
  const venueId = await venueLocationId(tx);
  const cfg = { locationId: venueId };
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
  it("lists destinations by name and omits the source and unavailable stations", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await stationFixture(tx);
      await setStationToday(tx, f.closed, "closed", AT, await seedActivityActor(tx));
      expect(await VENUE_SERVICE.stationDestinations(tx, f.grill, AT)).toEqual([
        { id: f.bar, name: "Bar", isDefault: false, preferred: false },
        { id: f.kitchen, name: "Kitchen", isDefault: true, preferred: false },
      ]);
    });
  });

  it("closes the chosen station for this business day and records its destination", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await stationFixture(tx);
      await VENUE_SERVICE.closeStationForToday(tx, f.grill, f.bar, AT, await seedActivityActor(tx));
      expect(
        await tx
          .select({
            id: kitchenStations.id,
            stationId: kitchenStations.id,
            businessDay: kitchenStations.closedOnDay,
            open: sql<boolean>`0`.mapWith(Boolean),
            sendsToStationId: kitchenStations.closedSendsToStationId,
          })
          .from(kitchenStations)
          .where(and(isNotNull(kitchenStations.closedOnDay), eq(kitchenStations.id, f.grill))),
      ).toEqual([
        {
          id: expect.any(String),
          stationId: f.grill,
          businessDay: "2026-10-02",
          open: false,
          sendsToStationId: f.bar,
        },
      ]);
      expect((await VENUE_SERVICE.stationStates(tx, AT)).get(f.grill)).toMatchObject({
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
      await setStationToday(tx, f.grill, "closed", AT, await seedActivityActor(tx), f.bar);
      await VENUE_SERVICE.openStationForToday(tx, f.grill, AT, await seedActivityActor(tx));
      expect(
        await tx
          .select({
            id: kitchenStations.id,
            stationId: kitchenStations.id,
            businessDay: kitchenStations.closedOnDay,
            open: sql<boolean>`0`.mapWith(Boolean),
            sendsToStationId: kitchenStations.closedSendsToStationId,
          })
          .from(kitchenStations)
          .where(and(isNotNull(kitchenStations.closedOnDay), eq(kitchenStations.id, f.grill))),
      ).toEqual([]);
      expect((await VENUE_SERVICE.stationStates(tx, AT)).get(f.grill)).toMatchObject({
        open: true,
        byHand: null,
        sendsTo: null,
        why: "open",
      });
    });
  });
});
