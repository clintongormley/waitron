import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
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
import { enrolDeviceForTest } from "./testing/enrol.js";
import "./errors.js";

// Real Postgres, not PGlite — MANDATORY for THIS suite (CLAUDE.md §4): the `till`-form-factor
// auto-create is a NEW write on `tills` by `app_user`, and PGlite connects as a superuser and never
// enforces grants, so a missing `INSERT ON tills` grant would pass there; every verb here runs through
// `app_user` (via `enrolDeviceForTest`), so the real grant is exercised.
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
  const st = await withTenant(admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return createStation(tx, cfg, { name: "Cocina", isDefault: true });
  });
  return { cfg, stationId: st.id };
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

async function tillCount(cfg: TillConfig): Promise<number> {
  const { rows } = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from tills where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

/** The enrolled device's binding columns and label, read as the superuser — the load-bearing check
 * that `acceptDeviceJoinRequest` (via `resolveDeviceBinding`) stamped the station/register the branch
 * resolved. */
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

describe("device join-and-accept binds the device by its profile's form factor (real Postgres)", () => {
  it("a till profile auto-creates exactly ONE register named after the device and binds it (station NULL)", async () => {
    // The `till` branch (spec §2.2): the device describes itself as a till, so resolveDeviceBinding
    // MINTS the cash register it rings against, names it after the device, and binds it. Proven by
    // DELETION: removing the `insert(tills)` leaves till_id NULL, which the binding-rule trigger (0004)
    // then rejects — but the load-bearing assertion here is that exactly ONE new till exists, named the
    // device's name, and the device points at it with a NULL station.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "till", "Perfil Caja");
    const before = await tillCount(cfg);

    const dev = await enrolDeviceForTest(suite.admin, cfg, { name: "Caja Nueva", profileId });

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
    // register, so resolveDeviceBinding binds the named `registerId` and mints NO till.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "phone-portrait", "Perfil Móvil");
    const before = await tillCount(cfg);

    const dev = await enrolDeviceForTest(suite.admin, cfg, {
      name: "Camarero 1",
      profileId,
      registerId: cfg.tillId,
    });
    expect(await tillCount(cfg)).toBe(before); // no register minted

    const row = await deviceRow(dev.deviceId);
    expect(row.till_id).toBe(cfg.tillId);
    expect(row.station_id).toBeNull();
  });

  it("a kds profile binds the named station (till NULL)", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile(cfg, "kds", "Perfil KDS");

    const dev = await enrolDeviceForTest(suite.admin, cfg, {
      name: "Pantalla Cocina",
      profileId,
      stationId,
    });

    const row = await deviceRow(dev.deviceId);
    expect(row.station_id).toBe(stationId);
    expect(row.till_id).toBeNull();
  });

  it("a kds profile with NO station is device.station_required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "kds", "Perfil KDS");
    await expect(
      enrolDeviceForTest(suite.admin, cfg, { name: "Pantalla", profileId }),
    ).rejects.toMatchObject({ code: "device.station_required" });
  });

  it("a handheld profile with NO register is device.register_required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "phone-portrait", "Perfil Móvil");
    await expect(
      enrolDeviceForTest(suite.admin, cfg, { name: "Camarero", profileId }),
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
    await expect(
      enrolDeviceForTest(suite.admin, cfg, {
        name: "Camarero",
        profileId,
        registerId: foreignTill.rows[0]!.id,
      }),
    ).rejects.toMatchObject({ code: "device.binding_invalid", params: { field: "tillId" } });
  });

  it("a till profile whose name collides at the venue is device.register_name_taken", async () => {
    // setupVenue already seeded a 'Caja 1' at cfg.locationId, so a till device named 'Caja 1' collides on
    // `tills_tenant_location_name_key` (migration 0006). Proven by DELETION: dropping the index (or the
    // 23505 translation) lets a SECOND 'Caja 1' insert succeed and this reject never fires.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile(cfg, "till", "Perfil Caja");
    const before = await tillCount(cfg);
    await expect(
      enrolDeviceForTest(suite.admin, cfg, { name: "Caja 1", profileId }),
    ).rejects.toMatchObject({ code: "device.register_name_taken" });
    expect(await tillCount(cfg)).toBe(before); // the colliding register did not land
  });
});
