import {
  CORE_MIGRATIONS,
  captureError,
  devices,
  locations,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import { createCanvas } from "./canvas-store.js";
import {
  createDeviceProfile,
  deleteDeviceProfile,
  getDeviceProfile,
  listDeviceProfiles,
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
      });
      const fetched = await inTx((tx) => getDeviceProfile(tx, created.id));
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
    });
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toEqual(created);
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
    expect(await inTx((tx) => getDeviceProfile(tx, handheld.id))).toEqual(handheld);

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
    });
    expect(await inTx((tx) => getDeviceProfile(tx, created.id))).toEqual(updated);
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

  it("translates a delete of a device-referenced profile to device_profile.in_use (409), profile survives", async () => {
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
    // A `till` profile's device must bind a register (the binding-rule trigger), hence `tills`.
    // Through drizzle, for the `$defaultFn` reason `seedSession` states.
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Loc", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    const [till] = await suite.db
      .insert(tills)
      .values({ locationId: location!.id, name: "Register 1" })
      .returning({ id: tills.id });
    await suite.db.insert(devices).values({
      locationId: location!.id,
      tillId: till!.id,
      label: "Bound device",
      tokenHash: "scrypt$00$00",
      deviceProfileId: created.id,
    });
    const error = await errorOf(() =>
      inTx((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
    );
    expect(typeof error).not.toBe("string"); // it threw an AppError, not a raw driver refusal
    expect((error as AppError).code).toBe("device_profile.in_use");
    expect((error as AppError).params).toEqual({}); // the fact of the reference is the whole message
    expect(await rowCount()).toBe(1); // the profile survived the refused delete (RESTRICT)
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

/** The schema half of what `translateWriteError`'s foreign-key branches rest on (see its doc). */
describe("what can refuse a write to device_profiles", () => {
  it("has ONE key out of device_profiles and ONE key into it", async () => {
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
