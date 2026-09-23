import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  captureError,
  CHECK_VIOLATION,
  diningTables,
  FOREIGN_KEY_VIOLATION,
  locations,
  engineErrorMessage,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { BOOKINGS_TEST_MIGRATIONS } from "../testing/migrations.js";
import { bookings } from "./bookings.js";

// The Drizzle table definition itself (the `(t) => [...]` extraConfig): evaluated in JS, so it does
// not need a database. Pins the foreign keys' NAMES — which this engine records nowhere else — and
// the two indexes and the checks, whose shapes the migration proofs assert at the SQL level. `getTableConfig` now comes from
// `drizzle-orm/sqlite-core`; the `pg-core` one threw `Cannot convert undefined or null to object`
// on a SQLite table.
describe("the bookings Drizzle table config", () => {
  it("declares all three FKs, two indexes, no unique key and both checks", () => {
    const config = getTableConfig(bookings);
    expect(config.columns.map((c) => c.name)).not.toContain("tenant_id");
    // THE ONLY PLACE THE THREE KEYS' NAMES ARE PINNED. SQLite does not record a foreign key's name
    // — drizzle's generator emits all three unnamed and `pragma foreign_key_list` has no name
    // column — so the engine can be asked for each key's SHAPE and never for what it is called.
    // `../migrations.test.ts` asks a migrated database for the shapes and points here for the names.
    //
    // All three, where this list held one: the table and tab keys were hand-written `--custom`
    // migration SQL (main's `drizzle/0001_bookings_baseline_sql.sql`) and so were absent from the
    // drizzle object, and `./bookings.ts` now declares all three with `foreignKey({...})`.
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
    // Two, where this list held one: `status` was a PostgreSQL ENUM TYPE the engine enforced (main's
    // baseline opens `CREATE TYPE "public"."booking_status" AS ENUM(...)`), and `enumType` enforces
    // the same five values with a CHECK here. A name is not a vocabulary, so the case below drives
    // a real refusal through the constraint that replaced the type.
    expect(config.checks.map((c) => c.name)).toEqual([
      "bookings_party_size_ck",
      "bookings_status_ck",
    ]);
  });
});

// WHAT THIS SUITE SHOWS: the CHECK and the three foreign keys. This engine has no roles, so
// nothing here is a claim about a privilege.
//
// `driverErrorCode` answers `"ERR_SQLITE_ERROR"` for every failure alike on this engine, so the
// refusal CLASS comes off `errcode` (`packages/db/src/sql-state.ts`: 275 for a CHECK, 787 for a
// foreign key). The foreign-key MESSAGE is `FOREIGN KEY constraint failed`, the same words
// whichever key was broken, so the three key cases below cannot tell each other apart by their
// message; each is separated only by which parent row it made absent. The constraint NAMES are
// asserted where the engine keeps them: on the drizzle object above.
const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
// A dining_tables row — the target of bookings.table_id.
const TABLE = "aaaaaaaa-0000-4000-8000-000000000009";
// The identity person recorded in created_by — a plain uuid, no FK (the drawer_opens.person_id seam).
const CREATED_BY = "cccccccc-0000-4000-8000-000000000001";

describe("bookings schema (staff reservations — columns, CHECK, FKs)", () => {
  const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

  // Each test seeds its own parents; the helper empties every table after each one. Written through
  // the table definitions rather than raw SQL where the row's id is NOT being pinned —
  // `invoiceLocales` reaches its column's JSON mapping, which `array['es']` used to do in SQL this
  // engine has not.
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

  // Insert a booking. Raw SQL, deliberately: the cases below write column sets a typed builder
  // would refuse at compile time — a party size of 0, a `table_id` naming no row — and it is the
  // database's refusal that is under test, not TypeScript's.
  async function seedBooking(time: string, extra: Record<string, unknown> = {}): Promise<string> {
    return withTransaction(suite.db, async (tx: Transaction) => {
      const cols: Record<string, unknown> = {
        // `id` and `created_at` are `$defaultFn` generators in JavaScript, not column DEFAULTs, so a
        // raw insert that does not name them is refused `NOT NULL constraint failed`. They are named
        // here for that reason, where PostgreSQL supplied both server-side.
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
    // Read back through the Drizzle `bookings` export (not raw SQL) — exercises the produced table
    // export, its column mapping and the `status` default.
    const [row] = await withTransaction(suite.db, (tx: Transaction) =>
      tx.select().from(bookings).where(eq(bookings.id, id)),
    );
    expect(row).not.toHaveProperty("tenantId");
    expect(row!.locationId).toBe(LOCATION);
    expect(row!.tableId).toBe(TABLE);
    expect(row!.bookingDate).toBe("2026-09-01");
    // DELETED, AND NO LONGER CHECKED HERE: that the COLUMN normalises `20:00` to `20:00:00`.
    // `booking_time` was a PostgreSQL `time` and the engine did that on the way in; `timeOfDay` is
    // plain `text` (`packages/db/src/schema/columns.ts`) and this insert is raw SQL, which reaches
    // the column without Drizzle's mapping — so no column-level normalising is expressible here at
    // all. The guarantee moved to the module's WRITE PATH (`storedTime` in `../bookings.ts`) and is
    // asserted where it now lives: `../bookings.test.ts`'s ordering case and `../routes.test.ts`'s
    // happy path each send `HH:MM` and read `HH:MM:SS` back.
    expect(row!.partySize).toBe(2);
    expect(row!.contactName).toBe("Ana");
    expect(row!.status).toBe("booked");
    expect(row!.createdBy).toBe(CREATED_BY);
    // A booking is edited and moved through its lifecycle: move it to a terminal state and read the
    // change back, so the mapping covers a written value as well as a default.
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
    expect(e).toMatchObject({ errcode: CHECK_VIOLATION[0] }); // 275, was 23514
    // The CHECK's message DOES carry its name here, unlike the foreign keys' — so this one case
    // can still say which constraint refused it.
    expect(engineErrorMessage(e)).toMatch(/bookings_party_size_ck/);
  });

  // The refusal that changed HANDS at the flip: `status` was a PostgreSQL ENUM TYPE, so the engine
  // itself refused a value outside the five; here it is an ordinary CHECK that `enumType` builds
  // from the same list. Nothing asserted the replacement refuses anything, so this drives one.
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
    expect(e).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] }); // 787, was 23503
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
