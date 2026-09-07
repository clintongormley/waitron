import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { devicePairingCodes, devices } from "./devices.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const STATION_A = "cccccccc-0000-4000-8000-000000000001";
const STATION_B = "cccccccc-0000-4000-8000-000000000002";
// A kds device profile per tenant — a device is DEFINED by its profile now (device_profile_id is NOT
// NULL), and a `kds` form factor is what the binding rule requires for a station-bound device.
const KDS_PROFILE_A = "eeeeeeee-0000-4000-8000-000000000001";
const KDS_PROFILE_B = "eeeeeeee-0000-4000-8000-000000000002";
// A location id that is never seeded — the negative for the direct location_id → locations.id FK.
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
// A non-null token_hash fixture (shape only — the DB stores it as opaque text; the real scrypt
// value comes from hashSecret in a later task).
const TOKEN_HASH = "scrypt$00$00";

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("devices + device_pairing_codes schema (columns, FKs, unique)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location + a kitchen_station per tenant: a station-bound device carries a tenant-consistent
    // (tenant_id, station_id) → kitchen_stations FK, so a bound row needs a real owning station, which
    // itself needs an owning location. operation_description is Spanish test DATA, not a schema
    // identifier, exactly as the sibling kitchen-stations test uses 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await suite.admin.execute(sql`
      insert into kitchen_stations (id, tenant_id, location_id, name)
      values
        (${STATION_A}, ${TENANT_A}, ${LOCATION_A}, 'Kitchen A'),
        (${STATION_B}, ${TENANT_B}, ${LOCATION_B}, 'Kitchen B')
      on conflict (id) do nothing`);
    // One kds device profile per tenant — the (tenant_id, device_profile_id) composite-FK target a
    // station-bound device points at, and the `kds` form factor the binding rule reads to require a
    // station.
    await suite.admin.execute(sql`
      insert into device_profiles (id, tenant_id, name, form_factor)
      values
        (${KDS_PROFILE_A}, ${TENANT_A}, 'KDS A', 'kds'),
        (${KDS_PROFILE_B}, ${TENANT_B}, 'KDS B', 'kds')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // A device/code lives in its tenant's own venue. location_id is NOT NULL (a required scope), so
  // every seed supplies one; the default is the tenant's own location, overridable to prove the FK.
  function locationOf(tenant: string): string {
    return tenant === TENANT_A ? LOCATION_A : LOCATION_B;
  }

  function profileOf(tenant: string): string {
    return tenant === TENANT_A ? KDS_PROFILE_A : KDS_PROFILE_B;
  }

  // Seed a kds-profile device bound to `station` (a kds device binds a station and no register — the
  // binding rule, tested in devices.trigger.pg.test.ts). `profile`/`location` default to the tenant's
  // own, overridable to prove the composite FKs.
  async function seedDevice(
    tenant: string,
    station: string | null,
    label: string,
    location: string = locationOf(tenant),
    profile: string = profileOf(tenant),
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into devices (tenant_id, location_id, device_profile_id, station_id, label, token_hash)
            values (${tenant}, ${location}, ${profile}, ${station}, ${label}, ${TOKEN_HASH}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedPairingCode(
    tenant: string,
    codeSha256: string,
    location: string = locationOf(tenant),
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256)
            values (${tenant}, ${location}, ${codeSha256}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // ---- devices ------------------------------------------------------------------------------

  it("devices: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedDevice(TENANT_A, STATION_A, "Kitchen screen");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update devices set last_seen_at = now() where id = ${id}`),
    );
    // Read back through the Drizzle `devices` export (not raw SQL) — exercises the produced table
    // export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(devices)
        .where(sql`id = ${id}`),
    );
    expect(row!.deviceProfileId).toBe(KDS_PROFILE_A);
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.stationId).toBe(STATION_A);
    expect(row!.label).toBe("Kitchen screen");
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("devices: the station binding is tenant-consistent (composite FK to kitchen_stations)", async () => {
    // STATION_B belongs to TENANT_B, so binding it on a TENANT_A device trips the composite
    // (tenant_id, station_id) FK. The kds profile satisfies the binding rule (station present, no
    // till), so the ONLY violated constraint is devices_station_fk.
    const e = await captureError(() => seedDevice(TENANT_A, STATION_B, "Cross-tenant station"));
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });

  it("devices: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    // The direct FK the spec's `shifts` shape uses guarantees referential integrity to `locations`
    // (it does NOT enforce tenant-consistency — that would need the composite (tenant_id, location_id)
    // FK, which shifts and this table deliberately do not use). A never-seeded location → 23503.
    // A valid station (STATION_A) is supplied so the binding rule is satisfied and the ONLY violated
    // constraint is the location FK.
    const e = await captureError(() =>
      seedDevice(TENANT_A, STATION_A, "Ghost location", GHOST_LOCATION),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on location_id
  });

  // ---- device_pairing_codes ----------------------------------------------------------------

  it("device_pairing_codes: maps every column and is consumed by DELETE … RETURNING", async () => {
    const id = await seedPairingCode(TENANT_A, "sha-control");
    // Read back through the Drizzle `devicePairingCodes` export — exercises its column mapping. The
    // code carries NO binding columns now: the enrolling device's profile (and everything it decides)
    // is chosen at enrolment, not stamped on the code.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(devicePairingCodes)
        .where(sql`id = ${id}`),
    );
    expect(row!.codeSha256).toBe("sha-control");
    expect(row!.locationId).toBe(LOCATION_A);
    // The redemption shape: a locking DELETE … RETURNING consumes the row (app_user holds DELETE).
    const deleted = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`delete from device_pairing_codes where id = ${id} returning id`,
        )
        .then((r) => r.rows),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.id).toBe(id);
  });

  it("device_pairing_codes: (tenant_id, code_sha256) is UNIQUE — a duplicate digest is rejected 23505", async () => {
    // The redemption path (`enrolDevice`) deletes by (tenant_id, code_sha256) and reads only the FIRST
    // returned row, so two rows sharing a digest would let one escape consumption — breaking the
    // single-use invariant. A UNIQUE index on (tenant_id, code_sha256) makes that unrepresentable: the
    // generator's ~1-in-2^40 duplicate code now fails the INSERT (the manager retries) instead of
    // silently minting a consumable duplicate.
    await seedPairingCode(TENANT_A, "sha-dup");
    const e = await captureError(() => seedPairingCode(TENANT_A, "sha-dup"));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on (tenant_id, code_sha256)

    // Proof by deletion of the guard (§4): with the UNIQUE index replaced by a PLAIN one inside a
    // ROLLED-BACK tx, the SAME (tenant, digest) inserts a second time without error — attributing the
    // 23505 above to the unique index, not to some other constraint. The rollback restores it for the
    // shared clone. drop/create run as the owner (app_user holds no DDL), then `set local role app_user`
    // inserts through the same app path the positive case used.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`drop index device_pairing_codes_lookup_idx`);
      await tx.execute(
        sql`create index device_pairing_codes_lookup_idx on device_pairing_codes (tenant_id, code_sha256)`,
      );
      await tx.execute(sql`set local role app_user`);
      const inserted = await tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-dup') returning id`,
      );
      expect(inserted.rows).toHaveLength(1); // the duplicate digest inserts once the UNIQUE index is gone
    });
  });
});
