import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, NOT_NULL_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { catalogues, products } from "./catalogue.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants } from "./tenants.js";
import { ticketItemMoves } from "./ticket-item-moves.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const AT = "2026-10-01T10:00:00.000Z";

describe("ticket_item_moves schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let lineId: string;
  let grill: string;
  let fryer: string;

  beforeEach(async () => {
    const db = suite.db;
    await db.insert(tenants).values({ id: 1, country: "ES", taxId: "B00000000", legalName: "F" });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Kitchen",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const [station, other] = await db
      .insert(kitchenStations)
      .values([
        { locationId: LOCATION, name: "Grill" },
        { locationId: LOCATION, name: "Fryer" },
      ])
      .returning({ id: kitchenStations.id });
    grill = station!.id;
    fryer = other!.id;
    const nodeId = await seedNode(db, brandLocationId(LOCATION));
    const [catalogue] = await db
      .insert(catalogues)
      .values({ name: "Menu" })
      .returning({ id: catalogues.id });
    const [product] = await db
      .insert(products)
      .values({
        catalogueId: catalogue!.id,
        name: "Food",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    const [order] = await db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        deviceId: null,
        locationId: LOCATION,
        nodeId,
        orderNumber: 1,
        status: "open",
        openedAt: AT,
      })
      .returning({ id: workingOrders.id });
    const [line] = await db
      .insert(workingOrderLines)
      .values({
        workingOrderId: order!.id,
        lineNo: 1,
        productId: product!.id,
        name: "Food",
        descriptions: { es: "Food" },
        quantity: 1000,
        unitPriceGross: 110,
        vatClass: "reduced",
        lineTotal: 110,
      })
      .returning({ id: workingOrderLines.id });
    lineId = line!.id;
    await db.insert(deviceProfiles).values({ id: "till", name: "Till", formFactor: "till" });
    await db.insert(devices).values({
      id: "device-a",
      locationId: LOCATION,
      deviceProfileId: "till",
      label: "device-a",
      tokenHash: "hash",
    });
  });

  const move = (values: {
    deviceId?: string | null;
    personId?: string | null;
    lineId?: string;
    from?: string;
    to?: string;
  }) =>
    suite.db.insert(ticketItemMoves).values({
      workingOrderLineId: values.lineId ?? lineId,
      fromStationId: values.from ?? grill,
      toStationId: values.to ?? fryer,
      movedAt: AT,
      movedByDeviceId: values.deviceId === undefined ? "device-a" : (values.deviceId as string),
      movedByPersonId: values.personId ?? null,
    });

  it("records a move by a device, with or without a person", async () => {
    await move({ personId: "person-1" });
    await move({ from: fryer, to: grill });
    const rows = suite.db.all<{
      from_station_id: string;
      to_station_id: string;
      moved_by_device_id: string;
      moved_by_person_id: string | null;
    }>(
      sql`select from_station_id, to_station_id, moved_by_device_id, moved_by_person_id
          from ticket_item_moves order by moved_by_person_id is null`,
    );
    expect(rows).toEqual([
      {
        from_station_id: grill,
        to_station_id: fryer,
        moved_by_device_id: "device-a",
        moved_by_person_id: "person-1",
      },
      {
        from_station_id: fryer,
        to_station_id: grill,
        moved_by_device_id: "device-a",
        moved_by_person_id: null,
      },
    ]);
  });

  it("refuses a move that names no device", async () => {
    expect(
      isRefusal(
        await captureError(() => move({ deviceId: null, personId: "person-1" })),
        NOT_NULL_VIOLATION,
      ),
    ).toBe(true);
  });

  it("refuses a move naming an unknown device, line or station", async () => {
    for (const values of [
      { deviceId: "missing" },
      { lineId: "missing" },
      { from: "missing" },
      { to: "missing" },
    ])
      expect(isRefusal(await captureError(() => move(values)), FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("deletes a move with its order line", async () => {
    await move({});
    await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
    expect(suite.db.all(sql`select * from ticket_item_moves`)).toEqual([]);
  });

  it("indexes moves by order line", () => {
    const rows = suite.db.all<{ name: string }>(
      sql`select name from pragma_index_list('ticket_item_moves')`,
    );
    expect(rows.map((row) => row.name)).toContain("ticket_item_moves_line_idx");
    const lineKey = getTableConfig(ticketItemMoves).foreignKeys.find(
      (key) => key.getName() === "ticket_item_moves_line_fk",
    );
    expect(lineKey?.onDelete).toBe("cascade");
  });
});
