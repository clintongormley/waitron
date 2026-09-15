import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  asAppUser,
  captureError,
  pgErrorCode,
  pgErrorMessage,
  tenants,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { bookings } from "./bookings.js";

// The Drizzle table definition itself (the `(t) => [...]` extraConfig): evaluated in JS, so it does not
// need the container. Pins the single FK drizzle-kit emits (the table and tab FKs are hand-written in
// the custom migrations, so they are NOT on the drizzle object), the two indexes and the party-size
// check — the shapes the migration proofs assert at the SQL level.
describe("the bookings Drizzle table config", () => {
  it("declares the location FK, two indexes, no unique key and the party-size check", () => {
    const config = getTableConfig(bookings);
    expect(config.columns.map((c) => c.name)).not.toContain("tenant_id");
    expect(config.foreignKeys.map((fk) => fk.getName())).toEqual(["bookings_location_fk"]);
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
    expect(config.checks.map((c) => c.name)).toEqual(["bookings_party_size_ck"]);
  });
});

// Real Postgres (a whole-manifest template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// `manifest` template (not [core, bookings]) is the shared ordered set — bookings FKs into core.
const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
// A dining_tables row — the target of bookings.table_id.
const TABLE = "aaaaaaaa-0000-4000-8000-000000000009";
// The identity person recorded in created_by — a plain uuid, no FK (the drawer_opens.person_id seam).
const CREATED_BY = "cccccccc-0000-4000-8000-000000000001";

describe("bookings schema (staff reservations — columns, CHECK, FKs)", () => {
  const suite = useTemplateDb({ template: "manifest" });

  // beforeEach, not beforeAll: the helper empties every table after each test.
  beforeEach(async () => {
    // The core parents still carry their own tenant column, so they are seeded with one.
    await suite.admin
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" });
    await suite.admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION}, 'Loc A', array['es'], 'Hostelería')`);
    await suite.admin.execute(sql`
      insert into dining_tables (id, location_id, label) values (${TABLE}, ${LOCATION}, 'A1')`);
  });

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // Insert a booking under the app role — the path the real routes take.
  async function seedBooking(time: string, extra: Record<string, unknown> = {}): Promise<string> {
    return asApp(async (tx) => {
      const cols: Record<string, unknown> = {
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
    const id = await seedBooking("20:00", { table_id: TABLE });
    // Read back through the Drizzle `bookings` export (not raw SQL) — exercises the produced table
    // export, its column mapping, the `status` default and `booking_time`'s rendering.
    const [row] = await asApp((tx) =>
      tx
        .select()
        .from(bookings)
        .where(sql`id = ${id}`),
    );
    expect(row).not.toHaveProperty("tenantId");
    expect(row!.locationId).toBe(LOCATION);
    expect(row!.tableId).toBe(TABLE);
    expect(row!.bookingDate).toBe("2026-09-01");
    expect(row!.bookingTime).toBe("20:00:00");
    expect(row!.partySize).toBe(2);
    expect(row!.contactName).toBe("Ana");
    expect(row!.status).toBe("booked");
    expect(row!.createdBy).toBe(CREATED_BY);
    // A booking is edited and moved through its lifecycle: move it to a terminal state and read the
    // change back, so the mapping covers a written value as well as a default.
    await asApp((tx) => tx.execute(sql`update bookings set status = 'cancelled' where id = ${id}`));
    const after = await asApp((tx) =>
      tx
        .execute<{ status: string }>(sql`select status from bookings where id = ${id}`)
        .then((r) => r.rows[0]!.status),
    );
    expect(after).toBe("cancelled");
  });

  it("rejects a non-positive party_size (CHECK party_size > 0)", async () => {
    const e = await captureError(() => seedBooking("22:00", { party_size: 0 }));
    expect(pgErrorCode(e)).toBe("23514"); // check_violation on bookings_party_size_ck
  });

  it("refuses a table_id with no dining_tables row (bookings_table_fk)", async () => {
    const e = await captureError(() =>
      seedBooking("19:00", { table_id: "bbbbbbbb-0000-4000-8000-000000000009" }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
    expect(pgErrorMessage(e)).toMatch(/bookings_table_fk/);
  });

  it("refuses a tab_id with no working_orders row (bookings_tab_fk)", async () => {
    const e = await captureError(() =>
      seedBooking("18:00", { tab_id: "dddddddd-0000-4000-8000-000000000001" }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
    expect(pgErrorMessage(e)).toMatch(/bookings_tab_fk/);
  });

  it("refuses a location_id with no locations row (bookings_location_fk)", async () => {
    const e = await captureError(() =>
      seedBooking("17:00", { location_id: "eeeeeeee-0000-4000-8000-000000000001" }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
    expect(pgErrorMessage(e)).toMatch(/bookings_location_fk/);
  });
});
