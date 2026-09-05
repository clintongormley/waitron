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
// constraints themselves would fire on either target — a candidate for the PGlite tier once the
// suites are re-tagged.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
// One kitchen_station per tenant — the composite (tenant_id, station_id) FK target the device
// binding points at. Seeded as the superuser admin (bypasses RLS).
const STATION_A = "cccccccc-0000-4000-8000-000000000001";
const STATION_B = "cccccccc-0000-4000-8000-000000000002";
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

describe("devices + device_pairing_codes schema (columns, CHECKs, FKs, unique)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location + a kitchen_station per tenant: devices/device_pairing_codes carry a
    // tenant-consistent (tenant_id, station_id) → kitchen_stations FK, so a bound row needs a real
    // owning station, which itself needs an owning location. operation_description is Spanish test
    // DATA, not a schema identifier, exactly as the sibling kitchen-stations test uses 'Hostelería'.
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

  async function seedDevice(
    tenant: string,
    station: string | null,
    label: string,
    location: string = locationOf(tenant),
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
            values (${tenant}, ${location}, 'kds_station', ${station}, ${label}, ${TOKEN_HASH}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedPairingCode(
    tenant: string,
    station: string | null,
    codeSha256: string,
    label: string,
    location: string = locationOf(tenant),
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${tenant}, ${location}, ${codeSha256}, 'kds_station', ${station}, ${label}) returning id`,
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
    // export and its column mapping under the app role, incl. the device_kind enum column.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(devices)
        .where(sql`id = ${id}`),
    );
    expect(row!.deviceKind).toBe("kds_station");
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.stationId).toBe(STATION_A);
    expect(row!.label).toBe("Kitchen screen");
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("devices: the station binding is tenant-consistent (composite FK to kitchen_stations)", async () => {
    // Tenant A cannot bind a device to tenant B's station: the (tenant_id, station_id) composite FK
    // has no (A, STATION_B) row to satisfy it → foreign_key_violation, independently of RLS. The
    // location_id here is A's own (the default), so the ONLY violated FK is the station one.
    const e = await captureError(() => seedDevice(TENANT_A, STATION_B, "Cross-tenant station"));
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });

  it("devices: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    // The direct FK the spec's `shifts` shape uses guarantees referential integrity to `locations`
    // (it does NOT enforce tenant-consistency — that would need the composite (tenant_id, location_id)
    // FK, which shifts and this table deliberately do not use). A never-seeded location → 23503.
    // A valid station (STATION_A) is supplied so the per-kind station CHECK is satisfied and the ONLY
    // violated constraint is the location FK.
    const e = await captureError(() =>
      seedDevice(TENANT_A, STATION_A, "Ghost location", GHOST_LOCATION),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on location_id
  });

  // ---- device_pairing_codes ----------------------------------------------------------------

  it("device_pairing_codes: maps every column and is consumed by DELETE … RETURNING", async () => {
    const id = await seedPairingCode(TENANT_A, STATION_A, "sha-control", "Code control");
    // Read back through the Drizzle `devicePairingCodes` export — exercises its column mapping.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(devicePairingCodes)
        .where(sql`id = ${id}`),
    );
    expect(row!.codeSha256).toBe("sha-control");
    expect(row!.deviceKind).toBe("kds_station");
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.stationId).toBe(STATION_A);
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
    await seedPairingCode(TENANT_A, STATION_A, "sha-dup", "First");
    const e = await captureError(() =>
      seedPairingCode(TENANT_A, STATION_A, "sha-dup", "Duplicate"),
    );
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
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-dup', 'kds_station', ${STATION_A}, 'Now allowed') returning id`,
      );
      expect(inserted.rows).toHaveLength(1); // the duplicate digest inserts once the UNIQUE index is gone
    });
  });

  // ---- per-kind station CHECK (kds_station ⇒ a station, handheld ⇒ none) --------------------

  it("devices: the per-kind station CHECK ties station presence to device_kind", async () => {
    // handheld is location-wide, never station-bound (spec §8a): a station on a handheld violates
    // the CHECK. asApp so the insert runs the SAME app-role path the real enrolment does.
    const withStation = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
              values (${TENANT_A}, ${LOCATION_A}, 'handheld', ${STATION_A}, 'Bad handheld', ${TOKEN_HASH})`,
        ),
      ),
    );
    expect(pgErrorCode(withStation)).toBe("23514"); // check_violation

    // handheld WITHOUT a station succeeds — the location-wide binding.
    const ok = await asApp(TENANT_A, (tx) =>
      tx.execute<{ id: string }>(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
            values (${TENANT_A}, ${LOCATION_A}, 'handheld', ${null}, 'Good handheld', ${TOKEN_HASH}) returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);

    // kds_station WITHOUT a station is the opposite violation — a kitchen screen needs its station.
    const kdsNoStation = await captureError(() => seedDevice(TENANT_A, null, "Bad kds"));
    expect(pgErrorCode(kdsNoStation)).toBe("23514");

    // Proof by deletion of the guard (§4): with the CHECK dropped inside a ROLLED-BACK tx, the SAME
    // bad handheld-with-station insert now succeeds — attributing the 23514 above to this CHECK, not
    // to some other constraint. The rollback restores it for the shared template clone. DROP runs as
    // the owner (app_user holds no DDL), then `set local role app_user` inserts the app path.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table devices drop constraint devices_station_kind_ck`);
      await tx.execute(sql`set local role app_user`);
      const inserted = await tx.execute<{ id: string }>(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
            values (${TENANT_A}, ${LOCATION_A}, 'handheld', ${STATION_A}, 'Now allowed', ${TOKEN_HASH}) returning id`,
      );
      expect(inserted.rows).toHaveLength(1); // the bad row inserts once the CHECK is gone
    });
  });

  it("device_pairing_codes: the per-kind station CHECK ties station presence to device_kind", async () => {
    const withStation = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
              values (${TENANT_A}, ${LOCATION_A}, 'sha-hh-bad', 'handheld', ${STATION_A}, 'Bad handheld code')`,
        ),
      ),
    );
    expect(pgErrorCode(withStation)).toBe("23514"); // check_violation

    const ok = await asApp(TENANT_A, (tx) =>
      tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-hh-ok', 'handheld', ${null}, 'Good handheld code') returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);

    const kdsNoStation = await captureError(() =>
      seedPairingCode(TENANT_A, null, "sha-kds-nostation", "Bad kds code"),
    );
    expect(pgErrorCode(kdsNoStation)).toBe("23514");

    // Proof by deletion of the guard on this table too.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(
        sql`alter table device_pairing_codes drop constraint device_pairing_codes_station_kind_ck`,
      );
      await tx.execute(sql`set local role app_user`);
      const inserted = await tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-hh-bad2', 'handheld', ${STATION_A}, 'Now allowed') returning id`,
      );
      expect(inserted.rows).toHaveLength(1);
    });
  });

  it("devices: a till binds NO station (per-kind CHECK names only kds_station)", async () => {
    // A till is a first-class till device that rings sales under its node's SIF (spec §16); like a
    // handheld it binds NO kitchen station. The CHECK is written `(kind = 'kds_station') = (station
    // IS NOT NULL)`, so EVERY non-kds_station kind (handheld AND till) must carry a NULL station —
    // WITHOUT the SQL ever naming the 'till' literal (which would trip Postgres's "new enum value in
    // the same transaction" restriction if the CHECK were rewritten alongside the ADD VALUE).
    const withStation = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
              values (${TENANT_A}, ${LOCATION_A}, 'till', ${STATION_A}, 'Bad till', ${TOKEN_HASH})`,
        ),
      ),
    );
    expect(pgErrorCode(withStation)).toBe("23514"); // check_violation

    // A till WITHOUT a station succeeds — the sale-capable, station-less binding.
    const ok = await asApp(TENANT_A, (tx) =>
      tx.execute<{ id: string }>(
        sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
            values (${TENANT_A}, ${LOCATION_A}, 'till', ${null}, 'Good till', ${TOKEN_HASH}) returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });

  it("device_pairing_codes: a till binds NO station (per-kind CHECK names only kds_station)", async () => {
    const withStation = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
              values (${TENANT_A}, ${LOCATION_A}, 'sha-till-bad', 'till', ${STATION_A}, 'Bad till code')`,
        ),
      ),
    );
    expect(pgErrorCode(withStation)).toBe("23514"); // check_violation

    const ok = await asApp(TENANT_A, (tx) =>
      tx.execute<{ id: string }>(
        sql`insert into device_pairing_codes (tenant_id, location_id, code_sha256, device_kind, station_id, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-till-ok', 'till', ${null}, 'Good till code') returning id`,
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });
});
