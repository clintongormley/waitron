import type { TradingContext } from "./trading-context.js";
/**
 * Device join-and-accept, plus direct cases over `resolveDeviceKitchenScreens` and `insertDevice`.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { devices, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles, seedNode, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import type { FormFactor } from "@waitron/layouts";
import { nodeId as brandNodeId } from "@waitron/shared";

import { createStation } from "./kitchen.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import {
  approveDeviceProfiles,
  insertDevice,
  keepApprovedAfterSwitch,
  readApprovedProfiles,
  requireDeviceProfile,
} from "./device.js";
import { acceptDeviceJoinRequest, createJoinRequest, readJoinStatus } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

interface SeededVenue {
  cfg: TradingContext;
  stationId: string;
}

/** A fresh taxpayer + venue + one station. Every test calls it, and `useVenueDb` empties the data
 * tables between tests, so the counts each case reads are its own. */
async function setupVenue(): Promise<SeededVenue> {
  const admin = suite.db;
  await seedVenue(admin, {
    name: "Bar",
    invoiceLocales: [LOCALE],
  });
  const nodeId = await seedNode(admin);
  const cfg: TradingContext = {
    nodeId: brandNodeId(nodeId),
    locale: LOCALE,
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const st = await withTransaction(admin, async (tx) => {
    return createStation(tx, { name: "Kitchen", isDefault: true });
  });
  return { cfg, stationId: st.id };
}

/** `name` is unique among profiles that are not retired (`device_profiles_live_name_key`), so a
 * test seeding two profiles passes two distinct names. */
async function seedProfile(formFactor: FormFactor, name: string): Promise<string> {
  const [row] = await seedDeviceProfiles(suite.db, { name, formFactor });
  return row!.id;
}

/** Rows per table, so a case can say which tables an accept wrote to. */
async function rowCounts(): Promise<Record<string, number>> {
  const { rows: tables } = await suite.db.execute<{ name: string }>(sql`
    select name from sqlite_master
    where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`);
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from ${sql.identifier(name)}`,
    );
    counts[name] = rows[0]!.n;
  }
  return counts;
}

function changedCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(after)
      .map(([name, n]) => [name, n - (before[name] ?? 0)] as const)
      .filter(([, delta]) => delta !== 0),
  );
}

async function activeNamed(label: string): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(sql`
    select count(*) as n from devices
    where label = ${label} and active = 1`);
  return rows[0]!.n;
}

function deviceValues(deviceProfileId: string, label: string) {
  return { id: randomUUID(), deviceProfileId, label, tokenHash: "x", active: true };
}

/** The enrolled device's profile and label, read straight off the table rather than out of the
 * verb's return value. */
async function deviceRow(deviceId: string): Promise<{ device_profile_id: string; label: string }> {
  const { rows } = await suite.db.execute<{ device_profile_id: string; label: string }>(sql`
    select device_profile_id, label from devices where id = ${deviceId}`);
  return rows[0]!;
}

describe("device join-and-accept binds the device by its profile's form factor", () => {
  it("accepting a till profile writes the device row and nothing else", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Till profile");
    const before = await rowCounts();

    const dev = await enrolDeviceForTest(suite.db, cfg, { name: "New till", profileId });

    expect(changedCounts(before, await rowCounts())).toEqual({ devices: 1 });
    expect(await deviceRow(dev.deviceId)).toEqual({
      device_profile_id: profileId,
      label: "New till",
    });
  });

  it("accepting a handheld needs no till and stores no binding beyond its profile", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("phone-portrait", "Phone profile");
    const before = await rowCounts();

    const dev = await enrolDeviceForTest(suite.db, cfg, { name: "Waiter 1", profileId });

    expect(changedCounts(before, await rowCounts())).toEqual({ devices: 1 });
    expect(await deviceRow(dev.deviceId)).toEqual({
      device_profile_id: profileId,
      label: "Waiter 1",
    });
  });

  it("a kds profile shows the named station on its station screen", async () => {
    const { cfg, stationId } = await setupVenue();
    const profileId = await seedProfile("kds", "KDS profile");

    const dev = await enrolDeviceForTest(suite.db, cfg, {
      name: "Kitchen screen",
      profileId,
      stationId,
    });

    expect(
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.readDeviceKitchenScreens(tx, dev.deviceId),
      ),
    ).toMatchObject([{ kind: "station", stations: [{ id: stationId, available: true }] }]);
  });

  it("accepts an unconfigured kitchen profile and shows no screen", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("kds", "KDS profile");
    const { deviceId } = await enrolDeviceForTest(suite.db, cfg, { name: "Screen", profileId });
    expect(
      await withTransaction(suite.db, (tx) => VENUE_SERVICE.readDeviceKitchenScreens(tx, deviceId)),
    ).toEqual([]);
  });
});

describe("accepting a device inherits its profile's screen", () => {
  it.each(["kds", "till", "phone-portrait"] as const)(
    "%s devices inherit the same saved scope",
    async (formFactor) => {
      const { cfg, stationId } = await setupVenue();
      const profileId = await seedProfile(formFactor, "Profile");
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.setProfileKitchenScreens(tx, profileId, {
          pass: { stationIds: [stationId], zoneIds: null, showNonPassStations: false },
        }),
      );
      const before = await rowCounts();
      const first = await enrolDeviceForTest(suite.db, cfg, { name: "First", profileId });
      const second = await enrolDeviceForTest(suite.db, cfg, { name: "Second", profileId });
      expect(changedCounts(before, await rowCounts())).toEqual({ devices: 2 });
      for (const device of [first, second]) {
        expect(
          await withTransaction(suite.db, (tx) =>
            VENUE_SERVICE.readDeviceKitchenScreens(tx, device.deviceId),
          ),
        ).toEqual([
          {
            kind: "pass",
            available: true,
            everyStation: false,
            everyZone: true,
            stations: [{ id: stationId, name: "Kitchen", available: true, switchedOff: false }],
            zones: null,
            showNonPassStations: false,
          },
        ]);
      }
    },
  );
});

describe("device names among a venue's active devices", () => {
  it("refuses a second active device of the same name there as device.name_taken, and the request survives", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Till profile");
    await enrolDeviceForTest(suite.db, cfg, { name: "Bar", profileId });
    // Opened before the request, or the status read discards it as made while the window was shut.
    const window = createPairingMode();
    window.open();
    const made = await withTransaction(suite.db, (tx) =>
      createJoinRequest(tx, cfg, { kind: "device", label: "Bar" }),
    );

    await expect(
      withTransaction(suite.db, (tx) =>
        acceptDeviceJoinRequest(tx, cfg, made.joinId, { label: "Bar", profileId }),
      ),
    ).rejects.toMatchObject({ code: "device.name_taken" });

    expect(await readJoinStatus(suite.db, cfg, made.joinId, made.token, window)).toBe("pending");
    expect(await activeNamed("Bar")).toBe(1);
  });

  it("accepts the name of a revoked device there", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Till profile");
    const first = await enrolDeviceForTest(suite.db, cfg, { name: "Bar", profileId });
    await suite.db.execute(sql`update devices set active = 0 where id = ${first.deviceId}`);

    const second = await enrolDeviceForTest(suite.db, cfg, { name: "Bar", profileId });

    expect(second.deviceId).not.toBe(first.deviceId);
    expect(await activeNamed("Bar")).toBe(1);
  });
});

describe("requireDeviceProfile and insertDevice, called directly", () => {
  it("refuses a profile id that names no profile as device_profile.not_found", async () => {
    await setupVenue();
    await expect(
      withTransaction(suite.db, (tx) => requireDeviceProfile(tx, randomUUID())),
    ).rejects.toMatchObject({ code: "device_profile.not_found" });
  });

  it("rethrows a device insert that fails for a reason other than a duplicate name, untranslated", async () => {
    await setupVenue();
    const refusal = await withTransaction(suite.db, (tx) =>
      insertDevice(tx, deviceValues(randomUUID(), "Till 9")),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toHaveProperty("code", "device.name_taken");
    expect(String(refusal)).toMatch(/FOREIGN KEY constraint failed/);
  });

  it("rethrows a duplicate on a unique index other than the device name, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Till profile");
    await enrolDeviceForTest(suite.db, cfg, { name: "Till 1", profileId });
    await suite.db.execute(
      sql`create unique index devices_one_per_profile on devices (device_profile_id)`,
    );
    try {
      const refusal = await withTransaction(suite.db, (tx) =>
        insertDevice(tx, deviceValues(profileId, "Till 2")),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toHaveProperty("code", "device.name_taken");
      expect(String(refusal)).toMatch(/UNIQUE constraint failed: devices\.device_profile_id/);
    } finally {
      await suite.db.execute(sql`drop index devices_one_per_profile`);
    }
  });

  it("rethrows a duplicate on a unique index that names no key, untranslated", async () => {
    const { cfg } = await setupVenue();
    const profileId = await seedProfile("till", "Till profile");
    await enrolDeviceForTest(suite.db, cfg, { name: "Till 1", profileId });
    // An index over an expression: its refusal names the index, not a table and columns.
    await suite.db.execute(
      sql`create unique index devices_one_per_profile_expr on devices (lower(device_profile_id))`,
    );
    try {
      const refusal = await withTransaction(suite.db, (tx) =>
        insertDevice(tx, deviceValues(profileId, "Till 2")),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toHaveProperty("code", "device.name_taken");
      expect(String(refusal)).toMatch(
        /UNIQUE constraint failed: index 'devices_one_per_profile_expr'/,
      );
    } finally {
      await suite.db.execute(sql`drop index devices_one_per_profile_expr`);
    }
  });
});

describe("a device's saved zones under approved profiles", () => {
  async function fixture() {
    await setupVenue();
    const active = await seedProfile("till", "Active till");
    const alternative = await seedProfile("till", "Alternative till");
    const { id: zoneId } = await seedZone(suite.db, { name: "Terrace" });
    const device = deviceValues(active, "Bar till");
    await withTransaction(suite.db, (tx) => insertDevice(tx, device));

    return { active, alternative, deviceId: device.id, zoneId };
  }

  it.each([true, false])(
    "keeps active zones and remembers an alternative's zones while approved (retained=%s)",
    async (retained) => {
      const { active, alternative, deviceId, zoneId } = await fixture();
      await withTransaction(suite.db, async (tx) => {
        const switchTo = async (from: string, to: string) => {
          await tx.update(devices).set({ deviceProfileId: to }).where(eq(devices.id, deviceId));
          await keepApprovedAfterSwitch(tx, deviceId, from, to);
        };
        const saveCurrentZones = async () => {
          const current = await VENUE_SERVICE.readDeviceZoneSelection(tx, deviceId);
          await VENUE_SERVICE.setDeviceZoneSelection(tx, deviceId, {
            profileId: current.profileId,
            snapshot: current.snapshot,
            selectedZoneIds: [zoneId],
            startingZoneId: zoneId,
          });
        };
        await saveCurrentZones();
        await approveDeviceProfiles(tx, deviceId, [alternative]);
        await switchTo(active, alternative);
        await saveCurrentZones();
        expect((await readApprovedProfiles(tx, deviceId)).map(({ id }) => id)).toEqual([
          alternative,
          active,
        ]);

        await switchTo(alternative, active);
        await approveDeviceProfiles(tx, deviceId, retained ? [alternative] : []);
        expect(await VENUE_SERVICE.readDeviceZoneSelection(tx, deviceId)).toMatchObject({
          profileId: active,
          saved: true,
          selectedZoneIds: [zoneId],
        });
        if (!retained) await approveDeviceProfiles(tx, deviceId, [alternative]);
        await switchTo(active, alternative);

        const restored = await VENUE_SERVICE.readDeviceZoneSelection(tx, deviceId);
        expect(restored.saved).toBe(retained);
        if (retained) expect(restored.selectedZoneIds).toEqual([zoneId]);
      });
    },
  );
});
