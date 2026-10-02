import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { seedNode } from "../testing/seed.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { catalogues, products } from "./catalogue.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { floorZones } from "./floor-zones.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { printers } from "./printers.js";
import { locations, tenants, tills } from "./tenants.js";
import { ticketItems } from "./ticket-items.js";
import { watcherItemMarks } from "./watcher-item-marks.js";
import { watchers } from "./watchers.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const WATCHER = "bbbbbbbb-0000-4000-8000-000000000001";
const AT = "2026-10-01T10:00:00.000Z";

describe("watchers schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture" });
    await suite.db
      .insert(locations)
      .values({
        id: LOCATION,
        name: "Kitchen",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      });
  });

  async function insertWatcher(id: string, name: string) {
    await suite.db.insert(watchers).values({ id, locationId: LOCATION, name, createdAt: AT });
  }

  it("defaults a new watcher to no stations, no zones, no pass, and active", async () => {
    await insertWatcher(WATCHER, "Pass");
    const [row] = await suite.db.all<{
      every_station: number;
      every_zone: number;
      runs_pass: number;
      display_order: number;
      active: number;
    }>(
      sql`select every_station, every_zone, runs_pass, display_order, active from watchers where id = ${WATCHER}`,
    );
    expect(row).toEqual({
      every_station: 0,
      every_zone: 0,
      runs_pass: 0,
      display_order: 0,
      active: 1,
    });
  });

  it("refuses a second active watcher with the same name and accepts it after deactivation", async () => {
    await insertWatcher(WATCHER, "Pass");
    expect(
      isRefusal(await captureError(() => insertWatcher("watcher-2", "Pass")), UNIQUE_VIOLATION),
    ).toBe(true);
    await suite.db.execute(sql`update watchers set active = 0 where id = ${WATCHER}`);
    await insertWatcher("watcher-2", "Pass");
    expect(
      suite.db.all<{ id: string }>(sql`select id from watchers where name = 'Pass'`),
    ).toHaveLength(2);
  });

  async function seedTicketAndDevice() {
    const [station] = await suite.db
      .insert(kitchenStations)
      .values({ locationId: LOCATION, name: "Grill" })
      .returning({ id: kitchenStations.id });
    await suite.db.insert(floorZones).values({ locationId: LOCATION, name: "Terrace" });
    await suite.db
      .insert(printers)
      .values({ locationId: LOCATION, name: "Printer", transport: "usb", localKey: "printer-1" });
    await suite.db.insert(tills).values({ id: "till", locationId: LOCATION, name: "Till" });
    const nodeId = await seedNode(suite.db, brandLocationId(LOCATION));
    const [catalogue] = await suite.db
      .insert(catalogues)
      .values({ name: "Menu" })
      .returning({ id: catalogues.id });
    const [product] = await suite.db
      .insert(products)
      .values({
        catalogueId: catalogue!.id,
        name: "Food",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    const [order] = await suite.db
      .insert(workingOrders)
      .values({ tillId: "till", nodeId, orderNumber: 1, status: "open", openedAt: AT })
      .returning({ id: workingOrders.id });
    const [line] = await suite.db
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
    const [item] = await suite.db
      .insert(ticketItems)
      .values({
        nodeId,
        workingOrderId: order!.id,
        workingOrderLineId: line!.id,
        stationId: station!.id,
      })
      .returning({ id: ticketItems.id });
    await suite.db.insert(deviceProfiles).values({ id: "kds", name: "Screen", formFactor: "kds" });
    await suite.db
      .insert(devices)
      .values({
        id: "device",
        locationId: LOCATION,
        deviceProfileId: "kds",
        stationId: station!.id,
        label: "Screen",
        tokenHash: "hash",
      });
    await insertWatcher(WATCHER, "Pass");
    return { itemId: item!.id, lineId: line!.id };
  }

  it("deletes a watcher's mark when its kitchen record is deleted", async () => {
    const { itemId, lineId } = await seedTicketAndDevice();
    await suite.db.execute(
      sql`insert into watcher_item_marks (watcher_id, ticket_item_id, done_at, done_by_device_id) values (${WATCHER}, ${itemId}, ${AT}, 'device')`,
    );
    await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
    expect(
      suite.db.all(sql`select * from watcher_item_marks where ticket_item_id = ${itemId}`),
    ).toEqual([]);
  });

  it("refuses a mark without a kitchen record or with both or neither Done actor", async () => {
    const { itemId } = await seedTicketAndDevice();
    const mark = (ticketId: string, person: string | null, device: string | null) =>
      suite.db.execute(
        sql`insert into watcher_item_marks (watcher_id, ticket_item_id, done_at, done_by_person_id, done_by_device_id) values (${WATCHER}, ${ticketId}, ${AT}, ${person}, ${device})`,
      );
    expect(
      isRefusal(await captureError(() => mark("missing", null, "device")), FOREIGN_KEY_VIOLATION),
    ).toBe(true);
    expect(
      isRefusal(await captureError(() => mark(itemId, "person", "device")), CHECK_VIOLATION),
    ).toBe(true);
    expect(isRefusal(await captureError(() => mark(itemId, null, null)), CHECK_VIOLATION)).toBe(
      true,
    );
    await mark(itemId, null, "device");
  });

  it("indexes marks by kitchen record", async () => {
    const rows = suite.db.all<{ name: string }>(
      sql`select name from pragma_index_list('watcher_item_marks')`,
    );
    expect(rows.map((row) => row.name)).toContain("watcher_item_marks_item_idx");
    expect(getTableConfig(watcherItemMarks).indexes.map((index) => index.config.name)).toContain(
      "watcher_item_marks_item_idx",
    );
  });

  it("declares the kitchen record cascade in the schema used by new migrations", () => {
    const keys = getTableConfig(watcherItemMarks).foreignKeys;
    const itemKey = keys.find((key) => key.getName() === "watcher_item_marks_item_fk");
    expect(itemKey?.onDelete).toBe("cascade");
  });

  it("declares the active-name condition in the schema used by new migrations", () => {
    const index = getTableConfig(watchers).indexes.find(
      (index) => index.config.name === "watchers_name_key",
    );
    expect(index?.config.where).toBeDefined();
  });
});
