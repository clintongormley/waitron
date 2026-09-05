import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";

// Real Postgres (a template clone), not PGlite: the tenant-consistent composite FKs are enforced by
// the engine regardless of RLS, but the sibling suite (devices.rls.test.ts) already runs on real PG,
// so this stays on the same target for a single template. The composite FKs are hand-written in the
// --custom migration (a bare uuid column carries no FK), the `devices.station_id` idiom. These tests
// pin that a device's till/canvas/receipt-printer/device-profile binding cannot point at ANOTHER
// tenant's row, that a NULL binding is unconstrained (MATCH SIMPLE skips the check on any NULL column),
// and that a device_profiles row a device references cannot be hard-deleted (ON DELETE RESTRICT).
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
// One till / canvas / printer / device-profile per tenant — the composite-FK targets. Seeded as the
// superuser admin (bypasses RLS; the FK still applies).
const TILL_A = "11111111-0000-4000-8000-0000000000a1";
const TILL_B = "22222222-0000-4000-8000-0000000000b1";
const CANVAS_A = "11111111-0000-4000-8000-0000000000a2";
const CANVAS_B = "22222222-0000-4000-8000-0000000000b2";
const PRINTER_A = "11111111-0000-4000-8000-0000000000a3";
const PRINTER_B = "22222222-0000-4000-8000-0000000000b3";
const PROFILE_A = "11111111-0000-4000-8000-0000000000a4";
const PROFILE_B = "22222222-0000-4000-8000-0000000000b4";
const TOKEN_HASH = "scrypt$00$00";

describe("devices + device_pairing_codes composite FKs (till / canvas / receipt_printer)", () => {
  const suite = useTemplateDb({ template: "core" });
  let admin: Database;

  beforeAll(async () => {
    admin = suite.admin;
    await admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name) values
        (${TENANT_A}, 'ES', 'B00000000', 'Fixture Tenant A'),
        (${TENANT_B}, 'ES', 'B11111111', 'Fixture Tenant B')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description) values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into tills (id, tenant_id, location_id, name) values
        (${TILL_A}, ${TENANT_A}, ${LOCATION_A}, 'Till A'),
        (${TILL_B}, ${TENANT_B}, ${LOCATION_B}, 'Till B')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into canvases (id, tenant_id, name, definition) values
        (${CANVAS_A}, ${TENANT_A}, 'Canvas A', '{}'::jsonb),
        (${CANVAS_B}, ${TENANT_B}, 'Canvas B', '{}'::jsonb)
      on conflict (id) do nothing`);
    // cloud_poll printers: the transport CHECK (printers_transport_fields_ck) needs poll_id for that
    // transport and nothing else, so this is the seed that avoids an agent FK.
    await admin.execute(sql`
      insert into printers (id, tenant_id, location_id, name, transport, poll_id) values
        (${PRINTER_A}, ${TENANT_A}, ${LOCATION_A}, 'Printer A', 'cloud_poll', 'poll-a'),
        (${PRINTER_B}, ${TENANT_B}, ${LOCATION_B}, 'Printer B', 'cloud_poll', 'poll-b')
      on conflict (id) do nothing`);
    // One device_profiles row per tenant — the (tenant_id, device_profile_id) composite-FK target.
    await admin.execute(sql`
      insert into device_profiles (id, tenant_id, name) values
        (${PROFILE_A}, ${TENANT_A}, 'Profile A'),
        (${PROFILE_B}, ${TENANT_B}, 'Profile B')
      on conflict (id) do nothing`);
  });

  // ---- devices ------------------------------------------------------------------------------

  it("devices: rejects a till_id naming a DIFFERENT tenant's till (composite FK)", async () => {
    // Only till_id is cross-tenant; canvas_id / receipt_printer_id are NULL, so the ONLY
    // violated constraint is devices_till_fk.
    const e = await captureError(() =>
      admin.execute(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, till_id)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Cross-tenant till', ${TOKEN_HASH}, ${TILL_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });

  it("devices: rejects a canvas_id naming a DIFFERENT tenant's canvas (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, canvas_id)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Cross-tenant canvas', ${TOKEN_HASH}, ${CANVAS_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("devices: rejects a receipt_printer_id naming a DIFFERENT tenant's printer (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, receipt_printer_id)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Cross-tenant printer', ${TOKEN_HASH}, ${PRINTER_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("devices: accepts same-tenant bindings; NULL bindings are unconstrained (MATCH SIMPLE)", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash,
                               till_id, canvas_id, receipt_printer_id,
                               has_cash_drawer, card_provider, card_reader_id)
          values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Bound till', ${TOKEN_HASH},
                  ${TILL_A}, ${CANVAS_A}, ${PRINTER_A}, true, 'sumup', 'reader-1') returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    // All three bindings NULL — the composite FKs skip the check on any NULL column, and the column
    // defaults apply (has_cash_drawer false, card_provider 'none').
    const [row] = (
      await admin.execute<{
        has_cash_drawer: boolean;
        card_provider: string;
        card_reader_id: string | null;
      }>(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Unbound till', ${TOKEN_HASH})
            returning has_cash_drawer, card_provider, card_reader_id`,
      )
    ).rows;
    expect(row!.has_cash_drawer).toBe(false);
    expect(row!.card_provider).toBe("none");
    expect(row!.card_reader_id).toBeNull();
  });

  it("devices: rejects a device_profile_id naming a DIFFERENT tenant's profile (composite FK)", async () => {
    // Only device_profile_id is cross-tenant; every other binding is NULL, so the ONLY violated
    // constraint is devices_device_profile_fk.
    const e = await captureError(() =>
      admin.execute(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, device_profile_id)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Cross-tenant profile', ${TOKEN_HASH}, ${PROFILE_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("devices: accepts a same-tenant device_profile_id; a NULL is unconstrained (MATCH SIMPLE)", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, device_profile_id)
          values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Profile-bound', ${TOKEN_HASH}, ${PROFILE_A}) returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    // device_profile_id NULL — the composite FK skips the check on any NULL column.
    const nullProfile = await admin.execute<{ device_profile_id: string | null }>(
      sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, device_profile_id)
          values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'No profile', ${TOKEN_HASH}, ${null})
          returning device_profile_id`,
    );
    expect(nullProfile.rows[0]!.device_profile_id).toBeNull();
  });

  it("devices: refuses to delete a device_profile a device references (ON DELETE RESTRICT)", async () => {
    // Bind a device to a fresh profile, then try to hard-delete that profile: RESTRICT blocks it. This
    // is the delete-referenced case the Task-3 device-profile store test deferred to Task 5's FK.
    const profileC = "11111111-0000-4000-8000-0000000000c4";
    await admin.execute(sql`
      insert into device_profiles (id, tenant_id, name) values (${profileC}, ${TENANT_A}, 'Profile C')`);
    await admin.execute(sql`
      insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash, device_profile_id)
      values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Restrict device', ${TOKEN_HASH}, ${profileC})`);
    const e = await captureError(() =>
      admin.execute(sql`delete from device_profiles where id = ${profileC}`),
    );
    // ON DELETE RESTRICT raises restrict_violation (23001) immediately on the delete — distinct from the
    // deferred foreign_key_violation (23503) a plain NO ACTION would give.
    expect(pgErrorCode(e)).toBe("23001");
  });

  // ---- device_pairing_codes ----------------------------------------------------------------

  it("device_pairing_codes: rejects a till_id naming a DIFFERENT tenant's till (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, till_id)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-till', 'till', ${null}, 'Cross-tenant till', ${TILL_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("device_pairing_codes: rejects a canvas_id naming a DIFFERENT tenant's canvas (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, canvas_id)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-canvas', 'till', ${null}, 'Cross-tenant canvas', ${CANVAS_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("device_pairing_codes: rejects a receipt_printer_id naming a DIFFERENT tenant's printer (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, receipt_printer_id)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-printer', 'till', ${null}, 'Cross-tenant printer', ${PRINTER_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("device_pairing_codes: accepts same-tenant bindings; NULL bindings are unconstrained", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label,
                                            till_id, canvas_id, receipt_printer_id,
                                            has_cash_drawer, card_provider, card_reader_id)
          values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-ok', 'till', ${null}, 'Bound till code',
                  ${TILL_A}, ${CANVAS_A}, ${PRINTER_A}, true, 'sumup', 'reader-9') returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    const [row] = (
      await admin.execute<{
        has_cash_drawer: boolean;
        card_provider: string;
        card_reader_id: string | null;
      }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-unbound', 'till', ${null}, 'Unbound till code')
            returning has_cash_drawer, card_provider, card_reader_id`,
      )
    ).rows;
    expect(row!.has_cash_drawer).toBe(false);
    expect(row!.card_provider).toBe("none");
    expect(row!.card_reader_id).toBeNull();
  });

  it("device_pairing_codes: rejects a device_profile_id naming a DIFFERENT tenant's profile (composite FK)", async () => {
    const e = await captureError(() =>
      admin.execute(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, device_profile_id)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-profile', 'till', ${null}, 'Cross-tenant profile', ${PROFILE_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("device_pairing_codes: accepts a same-tenant device_profile_id; a NULL is unconstrained", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, device_profile_id)
          values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-profile-ok', 'till', ${null}, 'Profile-bound code', ${PROFILE_A}) returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    const nullProfile = await admin.execute<{ device_profile_id: string | null }>(
      sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label, device_profile_id)
          values (${TENANT_A}, ${LOCATION_A}, 'sha-fk-profile-null', 'till', ${null}, 'No profile code', ${null})
          returning device_profile_id`,
    );
    expect(nullProfile.rows[0]!.device_profile_id).toBeNull();
  });
});
