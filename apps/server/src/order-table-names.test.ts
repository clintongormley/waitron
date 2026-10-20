import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  parties,
  partyTables,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { dashboardOrderAt } from "./testing/session-device.js";
import { listCounterWaiting, listHeldOrders } from "./working-order.js";

let venue: BillVenue;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
});

describe("A765 table names in order lists", () => {
  it.each(["open", "placed"] as const)(
    "leaves a table-free %s counter order's label separate",
    async (status) => {
      const id = randomUUID();
      await withTransaction(venue.db, (tx) =>
        tx.insert(workingOrders).values({
          id,
          ...dashboardOrderAt(venue.cfg.locationId),
          nodeId: venue.cfg.nodeId,
          orderNumber: 204,
          status,
          label: "Alex",
        }),
      );
      const rows = await (status === "open"
        ? listHeldOrders({ db: venue.db }, venue.cfg)
        : listCounterWaiting({ db: venue.db }, venue.cfg));
      const row = rows.find((order) => order.id === id)!;
      expect(row.label).toBe("Alex");
      expect(row).not.toHaveProperty("tableLabel");
    },
  );

  it("names a party's joined table in the HTTP held list without replacing its bill label", async () => {
    const id = randomUUID();
    await withTransaction(venue.db, async (tx) => {
      const tables = [];
      for (const label of ["North 1", "North 2"])
        tables.push(await createTable(tx, venue.cfg, { label, zoneId: venue.zoneId }));
      const [join] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: venue.zoneId, seats: 6, name: "Garden party" })
        .returning();
      const [party] = await tx.insert(parties).values({ openedBy: venue.operatorId }).returning();
      for (const table of tables) {
        await tx.insert(floorTodayJoinTables).values({
          joinId: join!.id,
          tableId: table.id,
          beforeX: 0,
          beforeY: 0,
          beforeRotation: 0,
        });
        await tx.insert(partyTables).values({ partyId: party!.id, tableId: table.id });
      }
      await tx.insert(workingOrders).values({
        id,
        ...dashboardOrderAt(venue.cfg.locationId),
        nodeId: venue.cfg.nodeId,
        orderNumber: 201,
        partyId: party!.id,
        label: "Birthday bill",
      });
    });
    const response = await venue.app.request("/api/working-orders", {
      headers: { cookie: venue.cookie },
    });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as {
      id: string;
      label: string | null;
      tableLabel?: string;
    }[];
    expect(rows.find((row) => row.id === id)).toMatchObject({
      label: "Birthday bill",
      tableLabel: "Garden party",
    });
  });

  it.each(["open", "placed"] as const)(
    "names today's delivery table on an %s counter order and retains the released name",
    async (status) => {
      const id = randomUUID();
      await withTransaction(venue.db, async (tx) => {
        const table = await createTable(tx, venue.cfg, {
          label: `Saved ${status}`,
          zoneId: venue.zoneId,
        });
        await tx
          .update(floorTodayTables)
          .set({ name: `Today ${status}` })
          .where(eq(floorTodayTables.tableId, table.id));
        await tx.insert(workingOrders).values({
          id,
          ...dashboardOrderAt(venue.cfg.locationId),
          nodeId: venue.cfg.nodeId,
          orderNumber: status === "open" ? 202 : 203,
          status,
          deliveryTableId: table.id,
          deliveryTableLabel: "Released terrace",
          label: "Alex",
        });
      });
      const read = () =>
        status === "open"
          ? listHeldOrders({ db: venue.db }, venue.cfg)
          : listCounterWaiting({ db: venue.db }, venue.cfg);
      expect((await read()).find((row) => row.id === id)).toMatchObject({
        label: "Alex",
        tableLabel: `Today ${status}`,
      });
      await withTransaction(venue.db, (tx) =>
        tx.update(workingOrders).set({ deliveryTableId: null }).where(eq(workingOrders.id, id)),
      );
      expect((await read()).find((row) => row.id === id)).toMatchObject({
        label: "Alex",
        tableLabel: "Released terrace",
      });
    },
  );
});
