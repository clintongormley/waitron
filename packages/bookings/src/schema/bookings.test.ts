import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  captureError,
  CHECK_VIOLATION,
  diningTables,
  engineErrorMessage,
  FOREIGN_KEY_VIOLATION,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { BOOKINGS_TEST_MIGRATIONS } from "../testing/migrations.js";
import { bookings } from "./bookings.js";

describe("the bookings Drizzle table config", () => {
  it("declares all three FKs, two indexes, no unique key and both checks", () => {
    const config = getTableConfig(bookings);
    expect(config.columns.map((c) => c.name)).not.toContain("tenant_id");
    // The only place the keys' names are pinned: drizzle emits the keys unnamed and
    // `pragma foreign_key_list` reports no name, so `../migrations.test.ts` checks shapes only.
    expect(config.foreignKeys.map((fk) => fk.getName())).toEqual([
      "bookings_location_fk",
      "bookings_table_fk",
      "bookings_tab_fk",
    ]);
    expect(config.uniqueConstraints).toEqual([]);
    expect(
      config.indexes.map((i) => [
        i.config.name,
        i.config.columns.map((c) => ("name" in c ? c.name : "")),
      ]),
    ).toEqual([
      ["bookings_location_date_idx", ["location_id", "booking_date"]],
      [
        "bookings_table_status_date_time_idx",
        ["table_id", "status", "booking_date", "booking_time"],
      ],
    ]);
    expect(config.checks.map((c) => c.name)).toEqual([
      "bookings_party_size_ck",
      "bookings_status_ck",
    ]);
  });
});

// The foreign-key message is the same whichever key was broken, so the three key cases below are
// told apart only by which parent row each made absent.
const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TABLE = "aaaaaaaa-0000-4000-8000-000000000009";
// The identity person recorded in created_by — a plain uuid, no FK (the drawer_opens.person_id seam).
const CREATED_BY = "cccccccc-0000-4000-8000-000000000001";

describe("bookings schema (staff reservations — columns, CHECK, FKs)", () => {
  const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

  // Each test seeds its own parents: the helper empties every table after each test.
  async function seedParents(): Promise<void> {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(diningTables).values({ id: TABLE, locationId: LOCATION, label: "A1" });
  }

  // Raw SQL, deliberately: it is the database's refusal that is under test.
  async function seedBooking(time: string, extra: Record<string, unknown> = {}): Promise<string> {
    return withTransaction(suite.db, async (tx: Transaction) => {
      const cols: Record<string, unknown> = {
        // `id` and `created_at` are `$defaultFn` generators in JavaScript, not column DEFAULTs, so a
        // raw insert must name them.
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        location_id: LOCATION,
        booking_date: "2026-09-01",
        booking_time: time,
        party_size: 2,
        contact_name: "Ana",
        created_by: CREATED_BY,
        ...extra,
      };
      const keys = Object.keys(cols);
      const r = await tx.execute<{ id: string }>(
        sql`insert into bookings (${sql.join(
          keys.map((k) => sql.identifier(k)),
          sql`, `,
        )}) values (${sql.join(
          keys.map((k) => sql`${cols[k]}`),
          sql`, `,
        )}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("exposes every column through the Drizzle export, with the status default", async () => {
    await seedParents();
    const id = await seedBooking("20:00", { table_id: TABLE });
    const [row] = await withTransaction(suite.db, (tx: Transaction) =>
      tx.select().from(bookings).where(eq(bookings.id, id)),
    );
    expect(row).not.toHaveProperty("tenantId");
    expect(row!.locationId).toBe(LOCATION);
    expect(row!.tableId).toBe(TABLE);
    expect(row!.bookingDate).toBe("2026-09-01");
    expect(row!.partySize).toBe(2);
    expect(row!.contactName).toBe("Ana");
    expect(row!.status).toBe("booked");
    expect(row!.createdBy).toBe(CREATED_BY);
    // A written status as well as the default.
    await withTransaction(suite.db, (tx: Transaction) =>
      tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, id)),
    );
    const [after] = await withTransaction(suite.db, (tx: Transaction) =>
      tx.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, id)),
    );
    expect(after!.status).toBe("cancelled");
  });

  it("rejects a non-positive party_size (CHECK party_size > 0)", async () => {
    await seedParents();
    const e = await captureError(() => seedBooking("22:00", { party_size: 0 }));
    expect(e).toMatchObject({ errcode: CHECK_VIOLATION[0] }); // 275
    // The CHECK's message DOES carry its name here, unlike the foreign keys' — so this one case
    // can still say which constraint refused it.
    expect(engineErrorMessage(e)).toMatch(/bookings_party_size_ck/);
  });

  it("rejects a status outside the five (CHECK bookings_status_ck)", async () => {
    await seedParents();
    const e = await captureError(() => seedBooking("21:00", { status: "pencilled_in" }));
    expect(e).toMatchObject({ errcode: CHECK_VIOLATION[0] });
    expect(engineErrorMessage(e)).toMatch(/bookings_status_ck/);
  });

  it("refuses a table_id with no dining_tables row (bookings_table_fk)", async () => {
    await seedParents();
    const e = await captureError(() =>
      seedBooking("19:00", { table_id: "bbbbbbbb-0000-4000-8000-000000000009" }),
    );
    expect(e).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] }); // 787
    expect(engineErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
  });

  it("refuses a tab_id with no working_orders row (bookings_tab_fk)", async () => {
    await seedParents();
    const e = await captureError(() =>
      seedBooking("18:00", { tab_id: "dddddddd-0000-4000-8000-000000000001" }),
    );
    expect(e).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] });
    expect(engineErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
  });

  it("refuses a location_id with no locations row (bookings_location_fk)", async () => {
    await seedParents();
    const e = await captureError(() =>
      seedBooking("17:00", { location_id: "eeeeeeee-0000-4000-8000-000000000001" }),
    );
    expect(e).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] });
    expect(engineErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
  });
});
