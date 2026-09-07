import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { FormFactor } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import "./errors.js";

// Real Postgres, not PGlite — MANDATORY for THIS suite (CLAUDE.md §4). Two properties here are
// FALSE-PASSES on PGlite: (1) the single-use guarantee is a CONCURRENCY property — two devices racing
// to redeem ONE code must yield exactly one enrolment, enforced by the locking `DELETE … RETURNING`
// that row-locks the code; PGlite serialises every query onto ONE backend, so the two redeems can never
// truly overlap there. (2) the `till`-form-factor auto-create is a NEW write on `tills` by `app_user` —
// PGlite connects as a superuser and never enforces grants, so a missing `INSERT ON tills` grant would
// pass there; here every verb runs through `asApp` (the `app_user` role), so the real grant is exercised.
// Each racer opens its own backend via `suite.pg.connect()` (distinct `pg_backend_pid()`, asserted), and
// the shared-container globalSetup throws rather than skips when Docker is absent.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

interface SeededVenue {
  cfg: TillConfig;
  stationId: string;
}

/** A fresh tenant + venue + one station + one seeded `tills` row ('Caja 1'), on the superuser admin
 * connection (pure setup), with the station created through the app role. Each test gets its OWN tenant
 * so device/till counts are order-independent across the shared clone (CLAUDE.md §4). */
async function setupVenue(): Promise<SeededVenue> {
  const admin = suite.admin;
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(admin, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const st = await asApp(admin, cfg, (tx) =>
    createStation(tx, cfg, { name: "Cocina", isDefault: true }),
  );
  return { cfg, stationId: st.id };
}

function asApp<T>(db: Database, cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a device profile of the given form factor (owner SQL for setup). `name` is unique per tenant
 * (`device_profiles_tenant_name_key`), so a test seeding two profiles passes two distinct names. */
async function seedProfile(cfg: TillConfig, formFactor: FormFactor, name: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor)
    values (${cfg.tenantId}, ${name}, ${formFactor})
    returning id`);
  return rows[0]!.id;
}

async function deviceCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from devices where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

async function tillCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from tills where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

/** The enrolled device's binding columns and label, read as the superuser — the load-bearing check
 * that `enrolDevice` stamped the station/register the branch resolved. */
async function deviceRow(deviceId: string): Promise<{
  station_id: string | null;
  till_id: string | null;
  device_profile_id: string;
  label: string;
}> {
  const { rows } = await suite.admin.execute<{
    station_id: string | null;
    till_id: string | null;
    device_profile_id: string;
    label: string;
  }>(sql`
    select station_id, till_id, device_profile_id, label from devices where id = ${deviceId}`);
  return rows[0]!;
}

describe("device enrolment single-use race (real Postgres)", () => {
  it("two concurrent enrolments of ONE code create exactly one device; the loser is device.pairing_invalid", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile(cfg, "kds", "Perfil KDS");
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));

    // TWO distinct backends racing to redeem ONE code. Load-bearing: distinct backend PROCESSES — on
    // PGlite these collapse onto one and the race never happens (a false pass).
    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2);

      // Both race past the locking DELETE … RETURNING. One row-locks the code, deletes it and enrols;
      // the other blocks, then — once the winner commits — matches zero rows and throws pairing_invalid.
      const results = await Promise.allSettled([
        asApp(connA, cfg, (tx) =>
          enrolDevice(tx, cfg, { code, name: "Pantalla A", profileId, stationId }),
        ),
        asApp(connB, cfg, (tx) =>
          enrolDevice(tx, cfg, { code, name: "Pantalla B", profileId, stationId }),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1); // exactly one enrolment succeeded
      expect(rejected).toHaveLength(1); // the loser was rejected
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "device.pairing_invalid",
      });
      // The database agrees: exactly ONE device row for this tenant — the loser filed nothing.
      expect(await deviceCount(cfg)).toBe(1);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});

describe("device pairing-code digest collision (real Postgres)", () => {
  it("maps a colliding-digest mint to device.pairing_code_unavailable, not a raw 23505", async () => {
    // The ~2^-40 digest collision is unreachable by chance, so the `codeSource` seam FORCES it: two
    // mints asked for the SAME code hash to the same code_sha256, and the second trips
    // `device_pairing_codes_lookup_idx` (the UNIQUE index on (tenant_id, code_sha256)) with 23505.
    // `generatePairingCode` must translate that into the clean, retryable domain code rather than
    // letting the raw driver error reach `run` as an opaque `server.internal` 500. Real Postgres so the
    // 23505 arrives through the PRODUCTION node-postgres driver shape `isUniqueViolation` walks.
    const { cfg } = await setupVenue();
    const forced = "COLLIDE7"; // any canonical Crockford-shaped code; returned by codeSource BOTH times
    const first = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg, () => forced));
    expect(first.code).toBe(forced);

    await expect(
      asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg, () => forced)),
    ).rejects.toMatchObject({ code: "device.pairing_code_unavailable" });
  });
});

describe("enrolDevice binds the device by its profile's form factor (real Postgres)", () => {
  it("a till profile auto-creates exactly ONE register named after the device and binds it (station NULL)", async () => {
    // The `till` branch (spec §2.2): the device describes itself as a till, so enrolDevice MINTS the
    // cash register it rings against, names it after the device, and binds it. Proven by DELETION:
    // removing the `insert(tills)` leaves till_id NULL, which the binding-rule trigger (0004) then
    // rejects — but the load-bearing assertion here is that exactly ONE new till exists, named the
    // device's name, and the device points at it with a NULL station.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "till", "Perfil Caja");
    const before = await tillCount(cfg);
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));

    const dev = await asApp(suite.admin, cfg, (tx) =>
      enrolDevice(tx, cfg, { code, name: "Caja Nueva", profileId }),
    );
    expect(dev).toMatchObject({ name: "Caja Nueva", formFactor: "till" });

    // Exactly ONE new till, named after the device.
    expect(await tillCount(cfg)).toBe(before + 1);
    const { rows: created } = await suite.admin.execute<{ id: string }>(
      sql`select id from tills where tenant_id = ${cfg.tenantId} and location_id = ${cfg.locationId} and name = 'Caja Nueva'`,
    );
    expect(created).toHaveLength(1);
    // …and the device is bound to THAT register, with no station.
    const row = await deviceRow(dev.deviceId);
    expect(row.till_id).toBe(created[0]!.id);
    expect(row.station_id).toBeNull();
    expect(row.device_profile_id).toBe(profileId);
    expect(row.label).toBe("Caja Nueva");
  });

  it("a handheld profile binds an EXISTING register named by registerId and creates no new till", async () => {
    // The else branch (phone-portrait / tablet-landscape): a handheld rings against an already-created
    // register, so enrolDevice binds the named `registerId` and mints NO till.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "phone-portrait", "Perfil Móvil");
    const before = await tillCount(cfg);
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));

    const dev = await asApp(suite.admin, cfg, (tx) =>
      enrolDevice(tx, cfg, { code, name: "Camarero 1", profileId, registerId: cfg.tillId }),
    );
    expect(dev).toMatchObject({ name: "Camarero 1", formFactor: "phone-portrait" });
    expect(await tillCount(cfg)).toBe(before); // no register minted

    const row = await deviceRow(dev.deviceId);
    expect(row.till_id).toBe(cfg.tillId);
    expect(row.station_id).toBeNull();
  });

  it("a kds profile binds the named station (till NULL)", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile(cfg, "kds", "Perfil KDS");
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));

    const dev = await asApp(suite.admin, cfg, (tx) =>
      enrolDevice(tx, cfg, { code, name: "Pantalla Cocina", profileId, stationId }),
    );
    expect(dev).toMatchObject({ name: "Pantalla Cocina", formFactor: "kds" });

    const row = await deviceRow(dev.deviceId);
    expect(row.station_id).toBe(stationId);
    expect(row.till_id).toBeNull();
  });

  it("a kds profile with NO station is device.station_required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "kds", "Perfil KDS");
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));
    await expect(
      asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code, name: "Pantalla", profileId })),
    ).rejects.toMatchObject({ code: "device.station_required" });
  });

  it("a handheld profile with NO register is device.register_required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "phone-portrait", "Perfil Móvil");
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));
    await expect(
      asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code, name: "Camarero", profileId })),
    ).rejects.toMatchObject({ code: "device.register_required" });
  });

  it("a handheld profile naming a register of another venue is device.binding_invalid (field tillId)", async () => {
    // The explicit by-id read carries its own tenant AND location predicate (CLAUDE.md §3): a register
    // that is not this venue's is rejected here, not trusted. A foreign-venue till (another location of
    // the SAME tenant) trips it.
    const { cfg } = await setupVenue();
    const other = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${cfg.tenantId}, 'Terraza', array[${LOCALE}], 'Venta en establecimiento') returning id`);
    const foreignTill = await suite.admin.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name) values (${cfg.tenantId}, ${other.rows[0]!.id}, 'Caja 1') returning id`);
    const profileId = await seedProfile(cfg, "phone-portrait", "Perfil Móvil");
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));
    await expect(
      asApp(suite.admin, cfg, (tx) =>
        enrolDevice(tx, cfg, {
          code,
          name: "Camarero",
          profileId,
          registerId: foreignTill.rows[0]!.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "device.binding_invalid", params: { field: "tillId" } });
  });

  it("a till profile whose name collides at the venue is device.register_name_taken", async () => {
    // setupVenue already seeded a 'Caja 1' at cfg.locationId, so a till device named 'Caja 1' collides on
    // `tills_tenant_location_name_key` (migration 0006). Proven by DELETION: dropping the index (or the
    // 23505 translation) lets a SECOND 'Caja 1' insert succeed and this reject never fires.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "till", "Perfil Caja");
    const before = await tillCount(cfg);
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));
    await expect(
      asApp(suite.admin, cfg, (tx) => enrolDevice(tx, cfg, { code, name: "Caja 1", profileId })),
    ).rejects.toMatchObject({ code: "device.register_name_taken" });
    expect(await tillCount(cfg)).toBe(before); // the colliding register did not land
  });

  it("is ONE transaction: a failure after the register insert leaves no orphan till", async () => {
    // enrolDevice writes the consumed code, the auto-created register and the device on the CALLER's
    // transaction (CLAUDE.md §3), never its own. A throw anywhere in that transaction — here forced right
    // after enrolDevice returns, standing in for a failing device insert — must discard the register.
    // Proven by DELETION: if createRegister opened its own connection/transaction, the register would
    // persist and the tills count would be +1 here.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "till", "Perfil Caja");
    const before = await tillCount(cfg);
    const { code } = await asApp(suite.admin, cfg, (tx) => generatePairingCode(tx, cfg));

    await expect(
      asApp(suite.admin, cfg, async (tx) => {
        await enrolDevice(tx, cfg, { code, name: "Caja Efímera", profileId });
        throw new Error("boom after register insert");
      }),
    ).rejects.toThrow("boom after register insert");

    expect(await tillCount(cfg)).toBe(before); // the register rolled back with the transaction
    expect(await deviceCount(cfg)).toBe(0); // and so did the device
  });
});
