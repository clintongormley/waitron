import { eq, sql, type SQL } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedVenue, seedZone } from "../testing/seed.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { floorZones } from "./floor-zones.js";
import { workingOrderLines } from "./orders.js";
import { departments } from "./venue-service/service.js";

// What this suite proves is the schema half: the Drizzle export's column mapping, and the
// `dining_tables.zone_id` foreign key.
const ABSENT_ZONE = "99999999-9999-4999-8999-999999999999";

describe("floor_zones schema (columns and the dining_tables.zone_id FK)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  let departmentId: string;
  beforeAll(async () => {
    await seedVenue(suite.db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const [department] = await suite.db
      .insert(departments)
      .values({ name: "Restaurant", tradingName: "Restaurant" })
      .returning({ id: departments.id });
    departmentId = department!.id;
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder, not a raw `insert`: `id` and `created_at` both take their value
  // from a `$defaultFn` that Drizzle applies CLIENT-side, so a raw statement reaches neither and
  // the row is refused `NOT NULL constraint failed: floor_zones.id`.
  async function seedZone(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(floorZones)
        .values({ name, departmentId })
        .returning({ id: floorZones.id });
      return row!.id;
    });
  }

  it("maps display_order and name through the Drizzle export", async () => {
    const id = await seedZone("Dining room");
    await inTx((tx) => tx.update(floorZones).set({ displayOrder: 5 }).where(eq(floorZones.id, id)));
    const [row] = await inTx((tx) => tx.select().from(floorZones).where(eq(floorZones.id, id)));
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Dining room");
  });

  it("dining_tables.zone_id round-trips, and its FK rejects an absent zone", async () => {
    const initialZoneId = await seedZone("Initial");
    const [table] = await inTx((tx) =>
      tx
        .insert(diningTables)
        .values({ label: "T-zone", zoneId: initialZoneId })
        .returning({ id: diningTables.id }),
    );
    const tableId = table!.id;
    const zoneId = await seedZone("Lounge");
    await inTx((tx) => tx.update(diningTables).set({ zoneId }).where(eq(diningTables.id, tableId)));
    const [row] = await inTx((tx) =>
      tx
        .select({ zoneId: diningTables.zoneId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    expect(row!.zoneId).toBe(zoneId);

    const eRandom = await captureError(() =>
      inTx((tx) =>
        tx.update(diningTables).set({ zoneId: ABSENT_ZONE }).where(eq(diningTables.id, tableId)),
      ),
    );
    expect(isRefusal(eRandom, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("reuses a deleted zone name with a new id", async () => {
    const oldId = await seedZone("Reusable");
    await inTx((tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, oldId)),
    );
    const replacementId = await seedZone("Reusable");
    expect(replacementId).not.toBe(oldId);
    expect(await suite.db.select().from(floorZones).where(eq(floorZones.id, oldId))).toEqual([
      expect.objectContaining({ id: oldId, name: "Reusable", active: false }),
    ]);
  });

  it("still refuses two live names in one location", async () => {
    await seedZone("Live duplicate");
    await expect(seedZone("Live duplicate")).rejects.toThrow("UNIQUE constraint failed:");
  });

  it("working_order_lines.served_at is readable and writable", async () => {
    await inTx((tx) => tx.select({ servedAt: workingOrderLines.servedAt }).from(workingOrderLines));
    const updated = await inTx(async (tx) =>
      tx.all<{ served_at: string | null }>(
        sql`update working_order_lines set served_at = ${new Date().toISOString()}
              where id = ${ABSENT_ZONE} returning served_at`,
      ),
    );
    expect(updated).toHaveLength(0); // no such line — but the column and the UPDATE both resolved
  });
});

describe("zone service rules on floor_zones", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const zoneId = "88888888-8888-4888-8888-888888888888";
  const departmentId = "77777777-7777-4777-8777-777777777777";
  async function write(query: SQL) {
    await suite.db.execute(query);
  }
  async function department() {
    await write(sql`insert into departments (id, name, trading_name, created_at)
      values (${departmentId}, 'Restaurant', 'Restaurant', '2026-11-12T08:00:00.000Z')`);
  }
  async function zone() {
    return write(sql`insert into floor_zones (id, name, created_at)
      values (${zoneId}, 'Terrace', '2026-11-12T08:00:00.000Z')`);
  }
  it("refuses a zone with no department", async () => {
    await expect(zone()).rejects.toThrow("NOT NULL constraint failed: floor_zones.department_id");
  });
  it("refuses a department that does not exist", async () => {
    await expect(
      write(sql`insert into floor_zones (id, name, department_id, created_at)
      values (${zoneId}, 'Terrace', ${departmentId}, '2026-11-12T08:00:00.000Z')`),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
  });
  it.each([
    ["order_start", "floor_zones_order_start_ck"],
    ["paid_when", "floor_zones_paid_when_ck"],
    ["collection_number", "floor_zones_collection_number_ck"],
  ])("refuses an unknown %s", async (column, constraint) => {
    await department();
    await expect(
      write(sql`insert into floor_zones (id, name, department_id, created_at, ${sql.identifier(column)})
      values (${zoneId}, 'Terrace', ${departmentId}, '2026-11-12T08:00:00.000Z', 'unknown')`),
    ).rejects.toThrow(constraint);
  });
  it("stores null overrides and permits every declared sale rule", async () => {
    await department();
    await write(sql`insert into floor_zones (id, name, department_id, created_at)
      values (${zoneId}, 'Terrace', ${departmentId}, '2026-11-12T08:00:00.000Z')`);
    expect(
      (
        await suite.db.all(sql`select order_start, paid_when, collection_number from floor_zones`)
      )[0],
    ).toEqual({ order_start: null, paid_when: null, collection_number: null });
    for (const [order, paid, number] of [
      ["table", "prepay", "none"],
      ["counter", "ticket_then_pay", "numbered"],
    ]) {
      await write(
        sql`update floor_zones set order_start=${order}, paid_when=${paid}, collection_number=${number} where id=${zoneId}`,
      );
      expect(
        (
          await suite.db.all(sql`select order_start, paid_when, collection_number from floor_zones`)
        )[0],
      ).toEqual({ order_start: order, paid_when: paid, collection_number: number });
    }
  });
  it("allows one active counter default and reuses the mark after deletion", async () => {
    await department();
    await write(sql`insert into floor_zones (id, name, department_id, is_counter_default, created_at)
      values (${zoneId}, 'Terrace', ${departmentId}, 1, '2026-11-12T08:00:00.000Z')`);
    const second = sql`insert into floor_zones (id, name, department_id, is_counter_default, created_at)
      values ('66666666-6666-4666-8666-666666666666', 'Counter', ${departmentId}, 1, '2026-11-12T08:00:00.000Z')`;
    await expect(write(second)).rejects.toThrow(
      "UNIQUE constraint failed: floor_zones.is_counter_default",
    );
    await write(sql`update floor_zones set active=0 where id=${zoneId}`);
    await write(second);
    expect(
      (
        await suite.db.all(
          sql`select count(*) as n from floor_zones where active=1 and is_counter_default=1`,
        )
      )[0],
    ).toEqual({ n: 1 });
  });
});

describe("today's zone keep-open constraints", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it.each([
    ["2026-11-12", null, null, "floor_zones_kept_open_ck"],
    [null, "21:00", "22:00", "floor_zones_kept_open_ck"],
    ["2026-11-12", "21:10", "22:00", "floor_zones_kept_open_step_ck"],
    ["2026-11-12", "21:00", "22:10", "floor_zones_kept_open_step_ck"],
  ])(
    "refuses incomplete or off-quarter-hour keep-open %s / %s / %s",
    async (day, from, until, constraint) => {
      const zone = await seedZone(suite.db, { name: "Terrace" });
      const error = await captureError(() =>
        suite.db.execute(sql`update floor_zones
      set kept_open_day = ${day}, kept_open_from = ${from}, kept_open_until = ${until} where id = ${zone.id}`),
      );
      expect(engineErrorMessage(error)).toContain(constraint);
    },
  );
  it("stores a quarter-hour keep-open and clears all three values", async () => {
    const zone = await seedZone(suite.db, { name: "Terrace" });
    for (const [day, from, until] of [
      ["2026-11-12", "21:00", "22:15"],
      [null, null, null],
    ]) {
      await suite.db.execute(
        sql`update floor_zones set kept_open_day=${day}, kept_open_from=${from}, kept_open_until=${until} where id=${zone.id}`,
      );
      expect(
        suite.db.get(
          sql`select kept_open_day, kept_open_from, kept_open_until from floor_zones where id=${zone.id}`,
        ),
      ).toEqual({ kept_open_day: day, kept_open_from: from, kept_open_until: until });
    }
  });
});

describe("today's map on floor_zones", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("a new zone reads revision zero and no business day", async () => {
    const zone = await seedZone(suite.db, { name: "Today" });
    expect(
      suite.db.get(
        sql`select today_business_day, today_revision, today_set_id, today_layout_revision, today_occurrence from floor_zones where id=${zone.id}`,
      ),
    ).toEqual({
      today_business_day: null,
      today_revision: 0,
      today_set_id: null,
      today_layout_revision: 0,
      today_occurrence: null,
    });
  });
  it("refuses a recorded set that does not exist", async () => {
    const zone = await seedZone(suite.db, { name: "Today" });
    const error = await captureError(() =>
      suite.db.execute(sql`update floor_zones set today_set_id='absent' where id=${zone.id}`),
    );
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
  });
});
