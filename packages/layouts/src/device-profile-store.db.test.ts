import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  locations,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import { createCanvas, deleteCanvas } from "./canvas-store.js";
import {
  createDeviceProfile,
  deleteDeviceProfile,
  getDeviceProfile,
  getDeviceProfileWithPrinters,
  listDeviceProfiles,
  readProfileStartingScreen,
  updateDeviceProfile,
} from "./device-profile-store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` and `created_at` take their value from the
 * table's `$defaultFn`, which is not a SQL DEFAULT, so a raw insert naming neither is refused
 * `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function errorOf(fn: () => Promise<unknown>): Promise<AppError | string> {
  const error = await captureError(fn);
  return isAppError(error) ? error : `did not throw an AppError: ${String(error)}`;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await errorOf(fn);
  return typeof error === "string" ? error : error.code;
}

async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from device_profiles`,
  );
  return rows.rows[0]!.n;
}

async function purgeProfiles(): Promise<void> {
  await suite.db.execute(sql`delete from device_profiles`);
}

async function seedCanvas(session: string, name: string): Promise<string> {
  const { id } = await inTx((tx) =>
    createCanvas(tx, {
      managementSessionId: session,
      name,
      definition: DEFAULT_CANVASES["till"],
    }),
  );
  return id;
}

/** Through drizzle, for the `$defaultFn` reason `seedSession` states. */
async function seedBoundDevice(profileId: string, active = true): Promise<string> {
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
    .returning({ id: locations.id });
  const [device] = await suite.db
    .insert(devices)
    .values({
      locationId: location!.id,
      label: "Bound device",
      tokenHash: "scrypt$00$00",
      deviceProfileId: profileId,
      active,
    })
    .returning({ id: devices.id });
  return device!.id;
}

const NO_DRAWERS_OR_DEFAULTS = {
  cashDrawerPrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
};

describe("device-profile store against a real migrated database", () => {
  let managerSession: string;

  beforeAll(async () => {
    await seedTenant(suite.db);
    managerSession = await seedSession("manager");
  });

  it("round-trips a manager-authored profile through create → get with validated capabilities", async () => {
    try {
      const created = await inTx((tx) =>
        createDeviceProfile(tx, {
          managementSessionId: managerSession,
          name: "Front counter",
          formFactor: "till",
          canvasId: null,
          capabilities: ["open-cash-drawer", "integrated-card-payment", "open-cash-drawer"],
        }),
      );
      // validateCapabilities dedupes, first-seen order preserved.
      expect(created).toEqual({
        id: created.id,
        name: "Front counter",
        formFactor: "till",
        canvasId: null,
        capabilities: ["open-cash-drawer", "integrated-card-payment"],
        inactivityTimeoutSeconds: null, // omitted on create ⇒ NULL (never)
        startingScreen: null,
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
        cashDrawerPrinterIds: [],
        receiptPrinterDefaultId: null,
        paymentSlipPrinterDefaultId: null,
        cashDrawerPrinterDefaultId: null,
      });
      const fetched = await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id));
      expect(fetched).toEqual(created);
    } finally {
      await purgeProfiles();
    }
  });

  it("carries the device form factor through create → get → list", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Kitchen display",
        canvasId: null,
        capabilities: ["act-as-kds"],
        formFactor: "kds",
      }),
    );
    expect(created).toEqual({
      id: created.id,
      name: "Kitchen display",
      canvasId: null,
      capabilities: ["act-as-kds"],
      formFactor: "kds",
      inactivityTimeoutSeconds: null,
      startingScreen: null,
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
    });
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id))).toEqual(created);
    const listed = await inTx((tx) => listDeviceProfiles(tx));
    expect(listed).toEqual([created]);
  });

  it("round-trips a phone-portrait inactivity timeout through create → get, and forces null for kds", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const handheld = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Handheld",
        formFactor: "phone-portrait",
        canvasId: null,
        capabilities: [],
        inactivityTimeoutSeconds: 300,
      }),
    );
    expect(handheld.inactivityTimeoutSeconds).toBe(300);
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, handheld.id))).toEqual(handheld);

    const kds = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Kitchen",
        formFactor: "kds",
        canvasId: null,
        capabilities: ["act-as-kds"],
        inactivityTimeoutSeconds: 600, // ignored — kds is exempt
      }),
    );
    expect(kds.inactivityTimeoutSeconds).toBeNull();
  });

  it("stores and returns a canvas reference that satisfies the FK", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const canvasId = await seedCanvas(session, "The canvas");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Bound",
        formFactor: "till",
        canvasId,
        capabilities: [],
      }),
    );
    expect(created).toEqual({
      id: created.id,
      name: "Bound",
      formFactor: "till",
      canvasId,
      capabilities: [],
      inactivityTimeoutSeconds: null,
      startingScreen: null,
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
    });
  });

  it("translates a canvasId naming no canvas to device_profile.invalid {bad_canvas_ref}", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const error = await errorOf(() =>
      inTx((tx) =>
        createDeviceProfile(tx, {
          managementSessionId: session,
          name: "Ghost reference",
          formFactor: "till",
          canvasId: "00000000-0000-4000-8000-000000000000",
          capabilities: [],
        }),
      ),
    );
    expect(typeof error).not.toBe("string"); // it threw an AppError, not a raw driver refusal
    expect((error as AppError).code).toBe("device_profile.invalid");
    expect((error as AppError).params).toEqual({ reason: "bad_canvas_ref" });
    expect(await rowCount()).toBe(0); // the refused insert left nothing behind
  });

  it("lists a tenant's device profiles by name", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const first = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "P1",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "P2",
        formFactor: "till",
        canvasId: null,
        capabilities: ["act-as-kds"],
      }),
    );
    const listed = await inTx((tx) => listDeviceProfiles(tx));
    expect(listed.map((p) => p.id)).toEqual([first.id, second.id]);
    expect(listed.map((p) => p.name)).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown device-profile id", async () => {
    const missing = await inTx((tx) =>
      getDeviceProfile(tx, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeUndefined();
  });

  it("updates a profile's name, canvas and capabilities in place", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const canvasId = await seedCanvas(session, "Target canvas");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Original",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const updated = await inTx((tx) =>
      updateDeviceProfile(tx, {
        managementSessionId: session,
        id: created.id,
        name: "Renamed",
        formFactor: "till",
        canvasId,
        capabilities: ["integrated-card-payment"],
      }),
    );
    expect(updated).toEqual({
      id: created.id,
      name: "Renamed",
      formFactor: "till",
      canvasId,
      capabilities: ["integrated-card-payment"],
      inactivityTimeoutSeconds: null,
      startingScreen: null,
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      cashDrawerPrinterIds: [],
      receiptPrinterDefaultId: null,
      paymentSlipPrinterDefaultId: null,
      cashDrawerPrinterDefaultId: null,
    });
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id))).toEqual(updated);
    expect(await rowCount()).toBe(1); // update, never insert a duplicate
  });

  it("deletes an unreferenced profile", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Doomed",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id }));
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it("refuses a delete of a profile an active device holds with device_profile.in_use (409), profile survives", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Referenced",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await seedBoundDevice(created.id);
    const error = await errorOf(() =>
      inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
    );
    expect(typeof error).not.toBe("string"); // it threw an AppError, not a raw driver refusal
    expect((error as AppError).code).toBe("device_profile.in_use");
    expect((error as AppError).params).toEqual({}); // the fact of the reference is the whole message
    expect(await rowCount()).toBe(1); // the profile survived the refused delete
  });

  it("translates a refusal by a key the device check does not read to device_profile.in_use", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Held elsewhere",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    // A table this test creates itself, standing for another module's key into device_profiles.
    await suite.db.execute(
      sql`create table device_profiles_test_holder (
            profile_id text not null references device_profiles(id) on delete restrict)`,
    );
    try {
      await suite.db.execute(
        sql`insert into device_profiles_test_holder (profile_id) values (${created.id})`,
      );
      const code = await codeOf(() =>
        inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
      );
      expect(code).toBe("device_profile.in_use");
      expect(await rowCount()).toBe(1);
    } finally {
      await suite.db.execute(sql`drop table device_profiles_test_holder`);
    }
  });

  it("retires a profile whose only device is disabled: hidden from every read, the device untouched", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Only disabled",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const deviceId = await seedBoundDevice(created.id, false);
    await inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id }));
    expect(await inTx((tx) => listDeviceProfiles(tx))).toEqual([]);
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toBeUndefined();
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id))).toBeUndefined();
    const held = await suite.db
      .select({ active: devices.active, deviceProfileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(held).toEqual([{ active: false, deviceProfileId: created.id }]);
  });

  it("frees a retired profile's name for a new profile", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const base = {
      managementSessionId: session,
      name: "Reused name",
      formFactor: "till" as const,
      canvasId: null,
      capabilities: [],
    };
    const retired = await inTx((tx) => createDeviceProfile(tx, base));
    await seedBoundDevice(retired.id, false);
    await inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: retired.id }));
    const replacement = await inTx((tx) => createDeviceProfile(tx, base));
    expect(replacement.id).not.toBe(retired.id);
    expect((await inTx((tx) => listDeviceProfiles(tx))).map((p) => p.id)).toEqual([replacement.id]);
  });

  it("refuses device_profile.in_use for a profile an active device holds, and keeps it listed", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Active holder",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await seedBoundDevice(created.id);
    const code = await codeOf(() =>
      inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
    );
    expect(code).toBe("device_profile.in_use");
    expect((await inTx((tx) => listDeviceProfiles(tx))).map((p) => p.id)).toEqual([created.id]);
  });

  it("refuses device_profile.in_use for a profile an active AND a disabled device hold, and keeps it listed", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Mixed holders",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await seedBoundDevice(created.id, false);
    await seedBoundDevice(created.id);
    const code = await codeOf(() =>
      inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
    );
    expect(code).toBe("device_profile.in_use");
    expect((await inTx((tx) => listDeviceProfiles(tx))).map((p) => p.id)).toEqual([created.id]);
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toBeDefined();
  });

  it("answers device_profile.not_found to a delete or an update of a retired profile", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const base = {
      managementSessionId: session,
      name: "Gone",
      formFactor: "till" as const,
      canvasId: null,
      capabilities: [],
    };
    const created = await inTx((tx) => createDeviceProfile(tx, base));
    await seedBoundDevice(created.id, false);
    await inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id }));
    expect(
      await codeOf(() =>
        inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
      ),
    ).toBe("device_profile.not_found");
    expect(
      await codeOf(() =>
        inTx((tx) => updateDeviceProfile(tx, { ...base, id: created.id, name: "Revived" })),
      ),
    ).toBe("device_profile.not_found");
    expect(await inTx((tx) => listDeviceProfiles(tx))).toEqual([]);
  });

  it("frees a retired profile's canvas and printer lists", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const canvasId = await seedCanvas(session, "Held canvas");
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    const [printer] = await suite.db
      .insert(printers)
      .values({ locationId: location!.id, name: "Bar", transport: "network_tcp", host: "10.0.0.1" })
      .returning({ id: printers.id });
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Canvas and printers",
        formFactor: "till",
        canvasId,
        capabilities: [],
        printerLists: {
          receiptPrinterIds: [printer!.id],
          paymentSlipPrinterIds: [printer!.id],
          ...NO_DRAWERS_OR_DEFAULTS,
        },
      }),
    );
    await seedBoundDevice(created.id, false);
    await inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id }));
    const listed = await suite.db
      .select({ printerId: deviceProfilePrinters.printerId })
      .from(deviceProfilePrinters)
      .where(eq(deviceProfilePrinters.deviceProfileId, created.id));
    expect(listed).toEqual([]);
    await inTx((tx) => deleteCanvas(tx, { managementSessionId: session, id: canvasId }));
  });

  it("translates a form-factor change on a profile an active device uses to device_profile.in_use", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Locked",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await seedBoundDevice(created.id);
    const code = await codeOf(() =>
      inTx((tx) =>
        updateDeviceProfile(tx, {
          managementSessionId: session,
          id: created.id,
          name: "Locked",
          formFactor: "phone-portrait",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.in_use");
    expect((await inTx((tx) => getDeviceProfile(tx, created.id)))?.formFactor).toBe("till");
  });

  it("passes any other trigger's refusal of an update through untranslated", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Guarded",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    // A trigger this test creates itself: its refusal carries the restrict refusal's result code.
    await suite.db.execute(
      sql`create trigger device_profiles_test_guard before update on device_profiles
          begin select raise(abort, 'refused by test trigger'); end`,
    );
    try {
      const error = await captureError(() =>
        inTx((tx) =>
          updateDeviceProfile(tx, {
            managementSessionId: session,
            id: created.id,
            name: "Renamed",
            formFactor: "till",
            canvasId: null,
            capabilities: [],
          }),
        ),
      );
      expect(isAppError(error)).toBe(false);
      expect(String(error)).toContain("refused by test trigger");
    } finally {
      await suite.db.execute(sql`drop trigger device_profiles_test_guard`);
    }
  });

  it("stores a profile's printer lists on create, keeps them on an update that names none, and replaces them on one that does", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    const [p1, p2] = await suite.db
      .insert(printers)
      .values([
        { locationId: location!.id, name: "Bar", transport: "network_tcp", host: "10.0.0.1" },
        { locationId: location!.id, name: "Counter", transport: "network_tcp", host: "10.0.0.2" },
      ])
      .returning({ id: printers.id });
    const base = {
      managementSessionId: session,
      name: "Listed",
      formFactor: "till" as const,
      canvasId: null,
      capabilities: [],
    };
    const created = await inTx((tx) =>
      createDeviceProfile(tx, {
        ...base,
        printerLists: {
          receiptPrinterIds: [p2!.id, p1!.id],
          paymentSlipPrinterIds: [p1!.id],
          ...NO_DRAWERS_OR_DEFAULTS,
        },
      }),
    );
    expect(created.receiptPrinterIds).toEqual([p2!.id, p1!.id]);
    expect(created.paymentSlipPrinterIds).toEqual([p1!.id]);
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id))).toEqual(created);
    expect(await inTx((tx) => listDeviceProfiles(tx))).toEqual([created]);
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toEqual({
      id: created.id,
      name: "Listed",
      formFactor: "till",
      canvasId: null,
      capabilities: [],
      inactivityTimeoutSeconds: null,
      startingScreen: null,
    });

    const renamed = await inTx((tx) =>
      updateDeviceProfile(tx, { ...base, id: created.id, name: "Renamed" }),
    );
    expect(renamed.receiptPrinterIds).toEqual([p2!.id, p1!.id]);
    expect(renamed.paymentSlipPrinterIds).toEqual([p1!.id]);

    const emptied = await inTx((tx) =>
      updateDeviceProfile(tx, {
        ...base,
        id: created.id,
        printerLists: {
          receiptPrinterIds: [],
          paymentSlipPrinterIds: [p2!.id],
          ...NO_DRAWERS_OR_DEFAULTS,
        },
      }),
    );
    expect(emptied.receiptPrinterIds).toEqual([]);
    expect(emptied.paymentSlipPrinterIds).toEqual([p2!.id]);
    expect(await inTx((tx) => getDeviceProfileWithPrinters(tx, created.id))).toEqual(emptied);
  });

  it("throws device_profile.not_found when updating an absent id", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      inTx((tx) =>
        updateDeviceProfile(tx, {
          managementSessionId: session,
          id: "00000000-0000-4000-8000-000000000000",
          name: "Ghost",
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.not_found");
  });

  it("throws device_profile.not_found when deleting an absent id", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      inTx((tx) =>
        deleteDeviceProfile(tx, {
          managementSessionId: session,
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    );
    expect(code).toBe("device_profile.not_found");
  });

  it("refuses a create from a staff-role session — the authorizeManager gate (differential)", async () => {
    await seedTenant(suite.db);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      inTx((tx) =>
        createDeviceProfile(tx, {
          managementSessionId: staffSession,
          name: "Nope",
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount()).toBe(0); // the gate ran before the write
  });

  it("rejects an unknown capability with device_profile.invalid {bad_capabilities} before any INSERT", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    // A manager passes the gate, so this refusal is validation's.
    const error = await errorOf(() =>
      inTx((tx) =>
        createDeviceProfile(tx, {
          managementSessionId: session,
          name: "Bad caps",
          formFactor: "till",
          canvasId: null,
          capabilities: ["not-a-flag"],
        }),
      ),
    );
    expect(typeof error).not.toBe("string");
    expect((error as AppError).code).toBe("device_profile.invalid");
    expect((error as AppError).params).toEqual({ reason: "bad_capabilities" });
    expect(await rowCount()).toBe(0); // validate threw before the INSERT
  });

  it("translates a duplicate name to device_profile.name_taken (clean 409), no second row", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Twin",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      inTx((tx) =>
        createDeviceProfile(tx, {
          managementSessionId: session,
          name: "Twin",
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.name_taken");
    expect(await rowCount()).toBe(1); // the duplicate never landed
  });

  it("translates a duplicate name on UPDATE to device_profile.name_taken", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Keep",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Move",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      inTx((tx) =>
        updateDeviceProfile(tx, {
          managementSessionId: session,
          id: second.id,
          name: "Keep", // collides with the first profile's name
          formFactor: "till",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.name_taken");
  });
});

describe("a profile's starting screen and shared-display actions", () => {
  let managerSession: string;

  beforeEach(async () => {
    managerSession = await seedSession("manager");
  });

  const till = (name: string, capabilities: string[], startingScreen?: unknown) =>
    inTx((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: managerSession,
        name,
        formFactor: "till",
        canvasId: null,
        capabilities,
        ...(startingScreen === undefined ? {} : { startingScreen }),
      }),
    );

  it("stores a starting screen the profile shows, and reads null when none was given", async () => {
    try {
      const expo = await till("Pass", ["show-expo", "take-orders"], "show-expo");
      const plain = await till("Plain", ["show-expo"]);
      expect(await inTx((tx) => readProfileStartingScreen(tx, expo.id))).toBe("show-expo");
      expect(await inTx((tx) => readProfileStartingScreen(tx, plain.id))).toBeNull();
    } finally {
      await purgeProfiles();
    }
  });

  it("reads null for a stored starting screen that is not a navigation screen", async () => {
    try {
      const [row] = await suite.db
        .insert(deviceProfiles)
        .values({
          name: "Written directly",
          formFactor: "till",
          capabilities: ["show-expo", "act-as-kds"],
          startingScreen: "act-as-kds",
        })
        .returning({ id: deviceProfiles.id });
      const [other] = await suite.db
        .insert(deviceProfiles)
        .values({ name: "Unknown screen", formFactor: "till", startingScreen: "counter" })
        .returning({ id: deviceProfiles.id });
      expect(await inTx((tx) => readProfileStartingScreen(tx, row!.id))).toBeNull();
      expect(await inTx((tx) => readProfileStartingScreen(tx, other!.id))).toBeNull();
    } finally {
      await purgeProfiles();
    }
  });

  it("refuses a starting screen the profile does not show, writing nothing", async () => {
    try {
      const error = await errorOf(() => till("Pass", ["show-station"], "show-expo"));
      expect(typeof error === "string" ? error : [error.code, error.params]).toEqual([
        "device_profile.invalid",
        { reason: "bad_starting_screen" },
      ]);
      expect(await rowCount()).toBe(0);
    } finally {
      await purgeProfiles();
    }
  });

  it("keeps the starting screen when an update omits it, and clears it on null", async () => {
    try {
      const created = await till("Pass", ["show-expo"], "show-expo");
      const update = (startingScreen?: unknown) =>
        inTx((tx) =>
          updateDeviceProfile(tx, {
            managementSessionId: managerSession,
            id: created.id,
            name: "Pass",
            formFactor: "till",
            canvasId: null,
            capabilities: ["show-expo", "show-schedule"],
            ...(startingScreen === undefined ? {} : { startingScreen }),
          }),
        );
      await update();
      expect(await inTx((tx) => readProfileStartingScreen(tx, created.id))).toBe("show-expo");
      await update("show-schedule");
      expect(await inTx((tx) => readProfileStartingScreen(tx, created.id))).toBe("show-schedule");
      await update(null);
      expect(await inTx((tx) => readProfileStartingScreen(tx, created.id))).toBeNull();
    } finally {
      await purgeProfiles();
    }
  });

  it("refuses an update that hides the starting screen, leaving the profile as it was", async () => {
    try {
      const created = await till("Pass", ["show-expo", "take-orders"], "show-expo");
      const error = await errorOf(() =>
        inTx((tx) =>
          updateDeviceProfile(tx, {
            managementSessionId: managerSession,
            id: created.id,
            name: "Pass",
            formFactor: "till",
            canvasId: null,
            capabilities: ["take-orders"],
          }),
        ),
      );
      expect(typeof error === "string" ? error : error.params).toEqual({
        reason: "bad_starting_screen",
      });
      expect((await inTx((tx) => getDeviceProfile(tx, created.id)))!.capabilities).toEqual([
        "show-expo",
        "take-orders",
      ]);
      expect(await inTx((tx) => readProfileStartingScreen(tx, created.id))).toBe("show-expo");
    } finally {
      await purgeProfiles();
    }
  });

  it("refuses a kitchen display an ordering, payment or drawer action on create and update", async () => {
    try {
      const kds = (capabilities: string[]) =>
        inTx((tx) =>
          createDeviceProfile(tx, {
            managementSessionId: managerSession,
            name: `Kitchen ${capabilities.join()}`,
            formFactor: "kds",
            canvasId: null,
            capabilities,
          }),
        );
      for (const flag of [
        "take-orders",
        "take-cash",
        "hand-keyed-card-payment",
        "open-cash-drawer",
      ]) {
        const error = await errorOf(() => kds(["act-as-kds", flag]));
        expect(typeof error === "string" ? error : error.params).toEqual({
          reason: "shared_display_action",
        });
      }
      const created = await kds(["act-as-kds", "prepare-orders"]);
      const error = await errorOf(() =>
        inTx((tx) =>
          updateDeviceProfile(tx, {
            managementSessionId: managerSession,
            id: created.id,
            name: created.name,
            formFactor: "kds",
            canvasId: null,
            capabilities: ["act-as-kds", "integrated-card-payment"],
          }),
        ),
      );
      expect(typeof error === "string" ? error : error.params).toEqual({
        reason: "shared_display_action",
      });
    } finally {
      await purgeProfiles();
    }
  });
});

/**
 * The keys out of and into device_profiles among core and identity's tables, which
 * `translateWriteError`'s doc relies on.
 */
describe("what can refuse a write to device_profiles", () => {
  // Migrates core and identity only: a key from another module's set is not seen.
  it("has ONE key out of device_profiles and ONE key into it that can refuse", async () => {
    const { rows } = await suite.db.execute<{
      child: string;
      column: string;
      parent: string;
      on_delete: string;
    }>(sql`
      select m.name as child, f."from" as column, f."table" as parent, f.on_delete
      from sqlite_master m join pragma_foreign_key_list(m.name) f
      where m.type = 'table' and (f."table" = 'device_profiles' or m.name = 'device_profiles')
      order by child, column`);
    expect(rows).toEqual([
      {
        child: "device_approved_profiles",
        column: "device_profile_id",
        parent: "device_profiles",
        on_delete: "CASCADE",
      },
      {
        child: "device_profile_admission_persons",
        column: "device_profile_id",
        parent: "device_profiles",
        on_delete: "CASCADE",
      },
      {
        child: "device_profile_admission_roles",
        column: "device_profile_id",
        parent: "device_profiles",
        on_delete: "CASCADE",
      },
      {
        child: "device_profile_printers",
        column: "device_profile_id",
        parent: "device_profiles",
        on_delete: "CASCADE",
      },
      {
        child: "device_profiles",
        column: "canvas_id",
        parent: "canvases",
        on_delete: "RESTRICT",
      },
      {
        child: "devices",
        column: "device_profile_id",
        parent: "device_profiles",
        on_delete: "RESTRICT",
      },
    ]);
  });
});
