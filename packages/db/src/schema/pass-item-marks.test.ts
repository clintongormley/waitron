import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { catalogues, products } from "./catalogue.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { passItemMarks } from "./pass-item-marks.js";
import { locations, tenants } from "./tenants.js";
import { ticketItems } from "./ticket-items.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const AT = "2026-10-01T10:00:00.000Z";

describe("pass_item_marks schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let itemId: string;
  let lineId: string;

  beforeEach(async () => {
    const db = suite.db;
    await db.insert(tenants).values({ id: 1, country: "ES", taxId: "B00000000", legalName: "F" });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Kitchen",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: LOCATION, name: "Grill" })
      .returning({ id: kitchenStations.id });
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
    const [item] = await db
      .insert(ticketItems)
      .values({
        nodeId,
        workingOrderId: order!.id,
        workingOrderLineId: line!.id,
        stationId: station!.id,
      })
      .returning({ id: ticketItems.id });
    itemId = item!.id;
    await db.insert(deviceProfiles).values({ id: "till", name: "Till", formFactor: "till" });
    for (const id of ["device-a", "device-b"]) {
      await db.insert(devices).values({
        id,
        locationId: LOCATION,
        deviceProfileId: "till",
        label: id,
        tokenHash: "hash",
      });
    }
  });

  const mark = (deviceId: string, ticketItemId: string, personId: string | null) =>
    suite.db.insert(passItemMarks).values({
      deviceId,
      ticketItemId,
      doneAt: AT,
      doneByPersonId: personId,
    });

  it("lets two devices mark one item, and a mark with no person stands", async () => {
    await mark("device-a", itemId, "person-1");
    await mark("device-b", itemId, null);
    const rows = suite.db.all<{ device_id: string; done_by_person_id: string | null }>(
      sql`select device_id, done_by_person_id from pass_item_marks order by device_id`,
    );
    expect(rows).toEqual([
      { device_id: "device-a", done_by_person_id: "person-1" },
      { device_id: "device-b", done_by_person_id: null },
    ]);
  });

  it("refuses a second mark by the same device on the same item", async () => {
    await mark("device-a", itemId, null);
    expect(
      isRefusal(await captureError(() => mark("device-a", itemId, null)), UNIQUE_VIOLATION),
    ).toBe(true);
  });

  it("refuses a mark naming an unknown device or kitchen record", async () => {
    expect(
      isRefusal(await captureError(() => mark("missing", itemId, null)), FOREIGN_KEY_VIOLATION),
    ).toBe(true);
    expect(
      isRefusal(await captureError(() => mark("device-a", "missing", null)), FOREIGN_KEY_VIOLATION),
    ).toBe(true);
  });

  it("deletes a mark with its kitchen record", async () => {
    await mark("device-a", itemId, null);
    await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
    expect(
      suite.db.all(sql`select * from pass_item_marks where ticket_item_id = ${itemId}`),
    ).toEqual([]);
  });

  it("indexes marks by kitchen record", () => {
    const rows = suite.db.all<{ name: string }>(
      sql`select name from pragma_index_list('pass_item_marks')`,
    );
    expect(rows.map((row) => row.name)).toContain("pass_item_marks_item_idx");
    const itemKey = getTableConfig(passItemMarks).foreignKeys.find(
      (key) => key.getName() === "pass_item_marks_item_fk",
    );
    expect(itemKey?.onDelete).toBe("cascade");
  });
});
