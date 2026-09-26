import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { RESTRICT_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";
import { printers } from "./printers.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "11111111-0000-4000-8000-0000000000a1";
const PRINTER_A = "11111111-0000-4000-8000-0000000000a3";
const PROFILE_A = "11111111-0000-4000-8000-0000000000a4";
const TOKEN_HASH = "scrypt$00$00";

// Every seed device points at a `till` profile and names a till, as the binding rule requires, so
// the only constraint each case leaves violated is the FK under test.
describe("devices FKs (till / receipt_printer / device_profile)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than raw SQL: the `$defaultFn` columns are JavaScript generators, not SQL
  // DEFAULTs, and drizzle encodes `invoice_locales` as the JSON text the column holds.
  beforeAll(async () => {
    admin = suite.db;
    await admin
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" })
      .onConflictDoNothing({ target: tenants.id });
    await admin
      .insert(locations)
      .values({
        id: LOCATION_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      })
      .onConflictDoNothing({ target: locations.id });
    await admin
      .insert(tills)
      .values({ id: TILL_A, locationId: LOCATION_A, name: "Till A" })
      .onConflictDoNothing({ target: tills.id });
    // cloud_poll needs only `poll_id` under `printers_transport_fields_ck`.
    await admin
      .insert(printers)
      .values({
        id: PRINTER_A,
        locationId: LOCATION_A,
        name: "Printer A",
        transport: "cloud_poll",
        pollId: "poll-a",
      })
      .onConflictDoNothing({ target: printers.id });
    await admin
      .insert(deviceProfiles)
      .values({ id: PROFILE_A, name: "Profile A", formFactor: "till" })
      .onConflictDoNothing({ target: deviceProfiles.id });
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from devices`);
    await suite.db.execute(sql`delete from device_profiles where id <> ${PROFILE_A}`);
  });

  it("accepts real bindings and defaults to no receipt printer", async () => {
    const bound = await admin
      .insert(devices)
      .values({
        locationId: LOCATION_A,
        deviceProfileId: PROFILE_A,
        stationId: null,
        label: "Bound till",
        tokenHash: TOKEN_HASH,
        tillId: TILL_A,
        receiptPrinterId: PRINTER_A,
      })
      .returning({ id: devices.id });
    expect(bound).toHaveLength(1);

    const [row] = await admin
      .insert(devices)
      .values({
        locationId: LOCATION_A,
        deviceProfileId: PROFILE_A,
        stationId: null,
        label: "Unbound printer",
        tokenHash: TOKEN_HASH,
        tillId: TILL_A,
      })
      .returning({ receiptPrinterId: devices.receiptPrinterId });
    expect(row!.receiptPrinterId).toBeNull();
  });

  it("has no card_provider / card_reader_id column (dropped in Task 13)", async () => {
    const { rows } = await admin.execute<{ name: string }>(sql`
      select name from pragma_table_info('devices')
       where name in ('card_provider', 'card_reader_id')`);
    expect(rows).toEqual([]);
  });

  it("accepts a real device_profile_id", async () => {
    const bound = await admin
      .insert(devices)
      .values({
        locationId: LOCATION_A,
        deviceProfileId: PROFILE_A,
        stationId: null,
        label: "Profile-bound",
        tokenHash: TOKEN_HASH,
        tillId: TILL_A,
      })
      .returning({ id: devices.id });
    expect(bound).toHaveLength(1);
  });

  it("refuses to delete a device_profile a device references (ON DELETE RESTRICT)", async () => {
    const profileC = "11111111-0000-4000-8000-0000000000c4";
    await admin
      .insert(deviceProfiles)
      .values({ id: profileC, name: "Profile C", formFactor: "till" });
    await admin.insert(devices).values({
      locationId: LOCATION_A,
      deviceProfileId: profileC,
      stationId: null,
      label: "Restrict device",
      tokenHash: TOKEN_HASH,
      tillId: TILL_A,
    });
    const e = await captureError(() =>
      admin.execute(sql`delete from device_profiles where id = ${profileC}`),
    );
    // RESTRICT refuses with a code distinct from the `FOREIGN_KEY_VIOLATION` a plain NO ACTION
    // gives.
    expect(isRefusal(e, RESTRICT_VIOLATION)).toBe(true);
    // The message half matters: this schema's `raise(abort, …)` triggers report the same code
    // (`../sql-state.ts`), including one on this table, so the class alone would accept a trigger
    // refusal as a RESTRICT one.
    expect(engineErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
    // Control: the refusal names no key, so show an identical profile no device references deletes
    // cleanly.
    const profileD = "11111111-0000-4000-8000-0000000000d4";
    await admin
      .insert(deviceProfiles)
      .values({ id: profileD, name: "Profile D", formFactor: "till" });
    await admin.execute(sql`delete from device_profiles where id = ${profileD}`);
    const { rows } = await admin.execute<{ n: number }>(
      sql`select count(*) as n from device_profiles where id = ${profileD}`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});
