import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { RESTRICT_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
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

// The device FKs (till / receipt_printer / device_profile) are the subject here. Every seed
// device points at a `till` device profile and names a till — a device is DEFINED by its profile
// (device_profile_id is NOT NULL) and the binding rule (device_binding_rule_insert / _update, tested in
// devices.trigger.pg.test.ts) requires a register and no station for a non-kds form factor — so the
// ONLY constraint each case leaves violated is the FK under test. `devices` is the only table that
// carries a device binding FK, so it is the only one with cases here.
describe("devices FKs (till / receipt_printer / device_profile)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than raw SQL for every fixture row, for two things the raw statements relied on
  // PostgreSQL for. `array['es']` is refused at prepare here — `near "['es']": syntax error` (node
  // v26.7.0, `node:sqlite`) — because SQLite has no array literal, and `invoice_locales` is now a
  // JSON array in a TEXT column. And four of these tables carry `$defaultFn` timestamps, which are
  // JavaScript generators rather than SQL DEFAULTs: before this change the suite died in
  // `beforeAll` with `NOT NULL constraint failed: tenants.created_at` and all four cases reported
  // `skipped` (measured on this suite). Going through drizzle calls the generators and encodes the
  // locale list.
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
    // cloud_poll printers: the transport CHECK (printers_transport_fields_ck) needs poll_id for that
    // transport and nothing else, so this is the seed that avoids an agent FK.
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
    // One `till`-form-factor device_profiles row — the (device_profile_id) foreign-key
    // target, and the form factor whose binding rule requires a register (a till).
    await admin
      .insert(deviceProfiles)
      .values({ id: PROFILE_A, name: "Profile A", formFactor: "till" })
      .onConflictDoNothing({ target: deviceProfiles.id });
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from devices`);
    await suite.db.execute(sql`delete from device_profiles where id <> ${PROFILE_A}`);
  });

  it("accepts real bindings; a NULL printer is unconstrained (MATCH SIMPLE) and the defaults apply", async () => {
    // Drizzle for the inserts, for the reason the `beforeAll` records — and for the
    // `has_cash_drawer` read below, which a raw statement would hand back as the stored 0 rather
    // than the `false` this case asserts on: it is a `flag(...)` column, stored as INTEGER, and
    // only drizzle's read mapping turns it back into a boolean.
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
        hasCashDrawer: true,
      })
      .returning({ id: devices.id });
    expect(bound).toHaveLength(1);

    // A real till (required by the binding rule) with a NULL receipt_printer_id — a foreign key does
    // not check a NULL, and the hardware default applies (has_cash_drawer false).
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
      .returning({ hasCashDrawer: devices.hasCashDrawer });
    expect(row!.hasCashDrawer).toBe(false);
  });

  it("has no card_provider / card_reader_id column (dropped in Task 13)", async () => {
    // The per-device card columns were write-and-display only; the reader default now lives in
    // `device_card_readers` and the pay path routes through the provider pool. The migration DROPs both.
    // `information_schema.columns` does not exist on this engine — run as written this statement
    // died with `no such table: information_schema.columns`. `pragma_table_info` is the
    // replacement, following `packages/payments/src/migrations.test.ts`. The case's subject is
    // unchanged: it asserts the two columns are ABSENT.
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
    // Bind a device to a fresh profile, then try to hard-delete that profile: RESTRICT blocks it.
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
    // ON DELETE RESTRICT refuses the delete itself, distinct from the foreign-key violation a
    // plain NO ACTION gives. That distinction survives the engine change: measured on this suite,
    // a RESTRICT refusal is errcode 1811 and a NO ACTION delete of a referenced row (a node an
    // invoice_series names) is 787, which is `FOREIGN_KEY_VIOLATION`.
    expect(isPgError(e, RESTRICT_VIOLATION)).toBe(true);
    // The message half is not decoration. 1811 is `SQLITE_CONSTRAINT_TRIGGER`, which this schema's
    // own `raise(abort, …)` guards also report (`../sql-state.ts`) — including one ON THIS TABLE:
    // `update device_profiles set form_factor = …` on a profile an active device uses refuses with
    // 1811 and `cannot change form factor of a profile in use by an active device` (measured).
    // The class alone would therefore accept a trigger refusal as a RESTRICT one.
    expect(pgErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
    // The control in the other direction, and the half a foreign-key refusal can no longer carry
    // itself: it names no table and no column, so nothing in it says WHICH key blocked the delete.
    // An otherwise identical profile that no device references deletes cleanly, so it is the
    // reference that refuses and not the delete.
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
