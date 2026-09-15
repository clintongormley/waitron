import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { usePgliteDb } from "../testing/lifecycle.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A = "11111111-0000-4000-8000-0000000000a1";
const PRINTER_A = "11111111-0000-4000-8000-0000000000a3";
const PROFILE_A = "11111111-0000-4000-8000-0000000000a4";
const TOKEN_HASH = "scrypt$00$00";

// The device composite FKs (till / receipt_printer / device_profile) are the subject here. Every seed
// device points at a `till` device profile and names a till — a device is DEFINED by its profile
// (device_profile_id is NOT NULL) and the binding rule (device_binding_rule_insert / _update, tested in
// devices.trigger.pg.test.ts) requires a register and no station for a non-kds form factor — so the
// ONLY constraint each case leaves violated is the FK under test. `devices` is the only table that
// carries a device binding FK, so it is the only one with cases here.
describe("devices composite FKs (till / receipt_printer / device_profile)", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  beforeAll(async () => {
    admin = suite.db;
    await admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name) values
        (${TENANT_A}, 'ES', 'B00000000', 'Fixture Tenant A')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into tills (id, location_id, name) values (${TILL_A}, ${LOCATION_A}, 'Till A')
      on conflict (id) do nothing`);
    // cloud_poll printers: the transport CHECK (printers_transport_fields_ck) needs poll_id for that
    // transport and nothing else, so this is the seed that avoids an agent FK.
    await admin.execute(sql`
      insert into printers (id, location_id, name, transport, poll_id) values (${PRINTER_A}, ${LOCATION_A}, 'Printer A', 'cloud_poll', 'poll-a')
      on conflict (id) do nothing`);
    // One `till`-form-factor device_profiles row — the (device_profile_id) foreign-key
    // target, and the form factor whose binding rule requires a register (a till).
    await admin.execute(sql`
      insert into device_profiles (id, name, form_factor) values (${PROFILE_A}, 'Profile A', 'till')
      on conflict (id) do nothing`);
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from devices`);
    await suite.db.execute(sql`delete from device_profiles where id <> ${PROFILE_A}`);
  });

  it("accepts same-tenant bindings; a NULL printer is unconstrained (MATCH SIMPLE) and the defaults apply", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into devices (location_id, device_profile_id, station_id, label, token_hash, till_id, receipt_printer_id, has_cash_drawer) values (${LOCATION_A}, ${PROFILE_A}, ${null}, 'Bound till', ${TOKEN_HASH},
                  ${TILL_A}, ${PRINTER_A}, true) returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    // A same-tenant till (required by the binding rule) with a NULL receipt_printer_id — the composite
    // printer FK skips the check on the NULL column, and the hardware default applies (has_cash_drawer
    // false).
    const [row] = (
      await admin.execute<{ has_cash_drawer: boolean }>(
        sql`insert into devices (location_id, device_profile_id, station_id, label, token_hash, till_id) values (${LOCATION_A}, ${PROFILE_A}, ${null}, 'Unbound printer', ${TOKEN_HASH}, ${TILL_A})
            returning has_cash_drawer`,
      )
    ).rows;
    expect(row!.has_cash_drawer).toBe(false);
  });

  it("has no card_provider / card_reader_id column (dropped in Task 13)", async () => {
    // The per-device card columns were write-and-display only; the reader default now lives in
    // `device_card_readers` and the pay path routes through the provider pool. The migration DROPs both.
    const { rows } = await admin.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
       where table_name = 'devices' and column_name in ('card_provider', 'card_reader_id')`);
    expect(rows).toEqual([]);
  });

  it("accepts a same-tenant device_profile_id", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into devices (location_id, device_profile_id, station_id, label, token_hash, till_id) values (${LOCATION_A}, ${PROFILE_A}, ${null}, 'Profile-bound', ${TOKEN_HASH}, ${TILL_A}) returning id`,
    );
    expect(bound.rows).toHaveLength(1);
  });

  it("refuses to delete a device_profile a device references (ON DELETE RESTRICT)", async () => {
    // Bind a device to a fresh profile, then try to hard-delete that profile: RESTRICT blocks it.
    const profileC = "11111111-0000-4000-8000-0000000000c4";
    await admin.execute(sql`
      insert into device_profiles (id, name, form_factor) values (${profileC}, 'Profile C', 'till')`);
    await admin.execute(sql`
      insert into devices (location_id, device_profile_id, station_id, label, token_hash, till_id) values (${LOCATION_A}, ${profileC}, ${null}, 'Restrict device', ${TOKEN_HASH}, ${TILL_A})`);
    const e = await captureError(() =>
      admin.execute(sql`delete from device_profiles where id = ${profileC}`),
    );
    // ON DELETE RESTRICT raises restrict_violation (23001) immediately on the delete — distinct from the
    // deferred foreign_key_violation (23503) a plain NO ACTION would give.
    expect(pgErrorCode(e)).toBe("23001");
  });
});
