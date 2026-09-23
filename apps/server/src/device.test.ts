/**
 * Device join-and-accept binding, on the engine the box now runs.
 *
 * ## What this file does not check
 *
 * **SQLite has no roles and no grants**: one process opens one file. The grant half of every case
 * below is checked by nothing, here or elsewhere.
 *
 * What survives is the binding RULE, which is what the seven case names describe:
 * `resolveDeviceBinding` picks the station or the register, and the database refuses any other
 * shape through `device_binding_rule_insert` / `_update`, created by
 * `packages/db/drizzle/0001_behavioural_triggers.sql` and driven by
 * `scripts/behavioural-triggers.test.ts` and `packages/db/src/schema/devices.trigger.test.ts`.
 *
 * ## The disposition document expected a seventh case to be RED here, and it is not
 *
 * `docs/handoffs/2026-09-21-f1-step25-disposition.md` records this file as "convert 6, BLOCKER 1",
 * on the ground that `tills_tenant_location_name_key` was absent from the SQLite baseline, so a
 * duplicate register name would insert cleanly and the refusal would never come. That is no longer
 * true of this tree: the index is at `packages/db/drizzle/0000_baseline.sql:49`, and all SEVEN
 * cases pass. Control run 2026-09-22, so the green is not the look-alike CLAUDE.md §1 warns about:
 * giving the colliding device a name that does NOT collide ("Caja 2") fails the case with
 * `promise resolved "{ …(2) }" instead of rejecting`, and the name restored, it passes again.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, locations, tills, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { FormFactor } from "@waitron/layouts";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tillId as brandTillId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { requireDeviceBinding, resolveDeviceBinding } from "./device.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface SeededVenue {
  cfg: TillConfig;
  stationId: string;
}

/** A fresh tenant + venue + one station + one seeded `tills` row ('Caja 1'). Every test calls it,
 * and `useVenueDb` empties the data tables between tests, so the device and till counts each case
 * reads are its own. */
async function setupVenue(): Promise<SeededVenue> {
  const admin = suite.db;
  await seedTenant(admin);
  // Seeded through the table definitions, the change `apps/server/src/testing/fiscal-fixtures.ts`
  // took: `locations.id`, `tills.id` and `tills.created_at` are `$defaultFn` generators a raw
  // insert never reaches while the columns are NOT NULL, and `invoice_locales` is a JSON array in a
  // text column rather than the PostgreSQL `text[]` the `array[...]` constructor built.
  const [loc] = await admin
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await admin
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(admin, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const st = await withTransaction(admin, async (tx) => {
    return createStation(tx, cfg, { name: "Cocina", isDefault: true });
  });
  return { cfg, stationId: st.id };
}

/** Seed a device profile of the given form factor (owner SQL for setup). `name` is unique per tenant
 * (`device_profiles_tenant_name_key`), so a test seeding two profiles passes two distinct names. */
async function seedProfile(formFactor: FormFactor, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name, formFactor })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function tillCount(): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    // No `::int`: `count(*)` already comes back as a JavaScript number, and the cast operator is a
    // syntax error to this parser (`unrecognized token: ":"`).
    sql`select count(*) as n from tills `,
  );
  return rows[0]!.n;
}

/** The enrolled device's binding columns and label, read straight off the table rather than out of
 * the verb's return value: what is checked is that `acceptDeviceJoinRequest` (via
 * `resolveDeviceBinding`) STAMPED the station or register its branch resolved. */
async function deviceRow(deviceId: string): Promise<{
  station_id: string | null;
  till_id: string | null;
  device_profile_id: string;
  label: string;
}> {
  const { rows } = await suite.db.execute<{
    station_id: string | null;
    till_id: string | null;
    device_profile_id: string;
    label: string;
  }>(sql`
    select station_id, till_id, device_profile_id, label from devices where id = ${deviceId}`);
  return rows[0]!;
}

describe("device join-and-accept binds the device by its profile's form factor", () => {
  it("a till profile auto-creates exactly ONE register named after the device and binds it (station NULL)", async () => {
    // The `till` branch (spec §2.2): the device describes itself as a till, so resolveDeviceBinding
    // MINTS the cash register it rings against, names it after the device, and binds it. What the
    // case turns on is that exactly ONE new till exists, named after the device, and the device
    // points at it with a NULL station.
    //
    // A `till_id` left NULL would also be refused by `device_binding_rule_insert`
    // (`packages/db/drizzle/0001_behavioural_triggers.sql`, its non-kds arm); what these assertions
    // add is WHICH register — the one this branch mints, named after the device.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    const before = await tillCount();

    const dev = await enrolDeviceForTest(suite.db, cfg, { name: "Caja Nueva", profileId });

    // Exactly ONE new till, named after the device.
    expect(await tillCount()).toBe(before + 1);
    const { rows: created } = await suite.db.execute<{ id: string }>(
      sql`select id from tills where location_id = ${cfg.locationId} and name = 'Caja Nueva'`,
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
    const profileId = await seedProfile("phone-portrait", "Perfil Móvil");
    const before = await tillCount();

    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: "Camarero 1",
      profileId,
      registerId: cfg.tillId,
    });
    expect(await tillCount()).toBe(before); // no register minted

    const row = await deviceRow(dev.deviceId);
    expect(row.till_id).toBe(cfg.tillId);
    expect(row.station_id).toBeNull();
  });

  it("a kds profile binds the named station (till NULL)", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile("kds", "Perfil KDS");

    const dev = await enrolDeviceForTest(suite.db, cfg, {
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
    const profileId = await seedProfile("kds", "Perfil KDS");
    await expect(
      enrolDeviceForTest(suite.db, cfg, { name: "Pantalla", profileId }),
    ).rejects.toMatchObject({ code: "device.station_required" });
  });

  it("a handheld profile with NO register is device.register_required", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("phone-portrait", "Perfil Móvil");
    await expect(
      enrolDeviceForTest(suite.db, cfg, { name: "Camarero", profileId }),
    ).rejects.toMatchObject({ code: "device.register_required" });
  });

  it("a handheld profile naming a register of another venue is device.binding_invalid (field tillId)", async () => {
    // The explicit by-id read carries its own tenant AND location predicate (CLAUDE.md §3): a register
    // that is not this venue's is rejected here, not trusted. A foreign-venue till (another location of
    // the SAME tenant) trips it.
    const { cfg } = await setupVenue();
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Terraza",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const [foreignTill] = await suite.db
      .insert(tills)
      .values({ locationId: other!.id, name: "Caja 1" })
      .returning({ id: tills.id });
    const profileId = await seedProfile("phone-portrait", "Perfil Móvil");
    await expect(
      enrolDeviceForTest(suite.db, cfg, {
        name: "Camarero",
        profileId,
        registerId: foreignTill!.id,
      }),
    ).rejects.toMatchObject({ code: "device.binding_invalid", params: { field: "tillId" } });
  });

  it("a till profile whose name collides at the venue is device.register_name_taken", async () => {
    // setupVenue already seeded a 'Caja 1' at cfg.locationId, so a till device named 'Caja 1'
    // collides on `tills_tenant_location_name_key` (`packages/db/drizzle/0000_baseline.sql:49`) and
    // the unique violation is translated to this code. Control, 2026-09-22: naming the device
    // 'Caja 2' instead resolves the promise rather than rejecting it, so the assertion is reading
    // the collision and not the happy path.
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    const before = await tillCount();
    await expect(
      enrolDeviceForTest(suite.db, cfg, { name: "Caja 1", profileId }),
    ).rejects.toMatchObject({ code: "device.register_name_taken" });
    expect(await tillCount()).toBe(before); // the colliding register did not land
  });
});

describe("resolveDeviceBinding and requireDeviceBinding, called directly", () => {
  it("refuses a profile id that names no profile as device_profile.not_found", async () => {
    const { cfg } = await setupVenue();
    await expect(
      withTransaction(suite.db, (tx) =>
        resolveDeviceBinding(tx, cfg, cfg.locationId, { profileId: randomUUID(), name: "Caja 9" }),
      ),
    ).rejects.toMatchObject({ code: "device_profile.not_found" });
  });

  it("rethrows a register insert that fails for a reason other than a duplicate name, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    // A location id no `locations` row carries, so the register insert breaks its foreign key.
    const refusal = await withTransaction(suite.db, (tx) =>
      resolveDeviceBinding(tx, cfg, randomUUID(), { profileId, name: "Caja 9" }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toHaveProperty("code", "device.register_name_taken");
    expect(String(refusal)).toMatch(/FOREIGN KEY constraint failed/);
  });

  it("rethrows a duplicate on a unique index other than the venue's register name, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Perfil Caja");
    // setupVenue's 'Caja 1' already holds this location, so a one-register-per-location index makes
    // a differently named register collide on a key that is not the name key.
    await suite.db.execute(sql`create unique index tills_one_per_location on tills (location_id)`);
    try {
      const refusal = await withTransaction(suite.db, (tx) =>
        resolveDeviceBinding(tx, cfg, cfg.locationId, { profileId, name: "Caja 2" }),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toHaveProperty("code", "device.register_name_taken");
      expect(String(refusal)).toMatch(/UNIQUE constraint failed: tills\.location_id/);
    } finally {
      await suite.db.execute(sql`drop index tills_one_per_location`);
    }
  });

  it("accepts clearing a receipt-printer binding without looking for a printer", async () => {
    await setupVenue();
    await expect(
      withTransaction(suite.db, (tx) => requireDeviceBinding(tx, { receiptPrinterId: null })),
    ).resolves.toBeUndefined();
  });
});
