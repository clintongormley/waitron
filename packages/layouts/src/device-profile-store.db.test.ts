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

// One real migrated SQLite database, carrying the core and identity sets in that order: the core
// set creates `device_profiles`, and the identity set creates the `persons`/`management_sessions`
// tables `authorizeManager` reads. Every store call below runs inside `withTransaction`, the shape
// the management routes use. It also exercises `device_profiles_canvas_fk`, which rejects a
// `canvas_id` naming no canvas — a constraint, not a policy.
//
// What it does NOT show: no assertion here is about who may write `device_profiles`. This engine
// has no roles and no grants — one process opens one file — so there is no such property left for a
// suite to assert, and the store's own gates are the only refusal. Every assertion below is the
// store's behaviour, which the engine does not touch.

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/** Run `fn` in one transaction — the shape the management routes wrap every store call in. */
function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Seed a person of `role` and an open management session for them. Returns the session id the
 * store's authorizeManager gate resolves. Through drizzle rather than raw SQL: `persons.id` and
 * `created_at` take their value from the table's `$defaultFn`, which is not a SQL DEFAULT, so a raw
 * insert naming neither is refused `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.id;
}

/** The AppError a rejected store call threw, or a describing string when it was not an AppError (so a
 * call that DID NOT throw — e.g. an authorizeManager gate deleted — reports plainly). */
async function errorOf(fn: () => Promise<unknown>): Promise<AppError | string> {
  const error = await captureError(fn);
  return isAppError(error) ? error : `did not throw an AppError: ${String(error)}`;
}

/** Just the code, for the assertions that only care which leaf fired. */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await errorOf(fn);
  return typeof error === "string" ? error : error.code;
}

/** Rows counted outside the store's own reads, so a refused or rolled-back write is visible here
 * as an absence. No `::int` cast: SQLite's `count(*)` already arrives as a number. */
async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from device_profiles`,
  );
  return rows.rows[0]!.n;
}

/** Delete every device profile — a `finally` teardown so the suite is order-independent
 * (CLAUDE.md §4). */
async function purgeProfiles(): Promise<void> {
  await suite.db.execute(sql`delete from device_profiles`);
}

/** Create a real canvas (as a manager) and return its id — the target the FK check accepts. A
 * canvas id naming no row is what the FK rejects; there is no cross-tenant case to write. */
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
    // The auto-logout timeout persists and reads back for a non-exempt form factor; a kds create is
    // coerced to null by validateInactivityTimeout even when a value is passed (a display never logs
    // out). Proof-by-deletion: drop the `formFactor === "kds"` guard and the kds row reads 600.
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
    // The real `device_profiles_canvas_fk` refusal: a well-formed uuid that names no canvas row.
    // createDeviceProfile catches the driver's foreign-key refusal (errcode 787) and re-throws the
    // domain code, so the management surface answers a clean 4xx rather than a raw 500.
    // Proof-by-deletion: remove that branch from translateWriteError and this fails with the raw
    // driver error.
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
    // devices.device_profile_id → device_profiles(id) is ON DELETE RESTRICT. The delete of a
    // still-referenced profile trips a restrict refusal (errcode 1811), which deleteDeviceProfile
    // translates (via translateWriteError) into the domain device_profile.in_use — a clean 409, not
    // the raw DB error a 500 would surface. Proof-by-deletion: remove the try/catch in
    // deleteDeviceProfile and this fails with the raw refusal instead of the AppError. RESTRICT
    // means the profile survives, asserted via rowCount.
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
    // Seed a location + a register + a device that binds the profile — setup, not the thing under
    // test. A device is defined by its profile's form factor (no device_kind column); the `till`
    // profile means the binding rule requires a register, not a station. Through drizzle, for the
    // `$defaultFn` reason `seedSession` states, and because `invoice_locales` is a JSON array in a
    // text column here rather than a PostgreSQL `text[]` — the column's own write mapping is what
    // turns the list into what the database stores.
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
    // The write-path no-row guard: `.returning({ id })` comes back empty, so updateDeviceProfile
    // throws rather than reporting a silent success. Proof-by-deletion: drop the length === 0 check and
    // this resolves, failing the assertion.
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
    // Staff holds no layout.configure, so authorizeManager throws authorization.not_permitted BEFORE any
    // write. Deleting the authorizeManager call from createDeviceProfile makes this succeed → a row
    // lands, failing both assertions.
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
    // authorize FIRST (manager is permitted), THEN validate — so an unknown flag from an AUTHORISED
    // actor is what proves validate runs before the write.
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

/**
 * The property `translateWriteError`'s two foreign-key branches rest on, read off the real migrated
 * schema.
 *
 * Both used to match a CONSTRAINT NAME. SQLite reports every foreign-key refusal as the identical
 * `FOREIGN KEY constraint failed` — no table, no column, no name
 * (`packages/db/src/constraint-target.ts`) — so each branch can only ask the DIRECTION: 787 for a
 * written value naming no parent, 1811 for a delete a RESTRICT key refused. What keeps the two
 * domain codes honest is that inside the one statement each writer wraps, only one key can raise
 * either: `canvas_id` is the only key out of `device_profiles`, so a 787 can only be a canvas
 * reference naming no row, and `devices.device_profile_id` is the only key into it, so an 1811 can
 * only be a profile a device still binds.
 *
 * That is a fact about the SCHEMA, which is why it is checked here rather than in the crafted-error
 * unit suite — where the two refusals are byte-for-byte identical and no assertion can separate
 * them. Add a second key in either direction and this fails; one of the two codes would then be
 * reported for a refusal the store never read.
 */
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
