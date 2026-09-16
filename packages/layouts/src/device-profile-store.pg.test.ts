import { asAppUser, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
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

// Real Postgres, not PGlite: every store call below runs as a non-superuser member of `app_user`
// (`withTransaction` + `asAppUser`), the shape the management routes use. PGlite connects as a superuser
// holding every grant, so a missing GRANT on `device_profiles` — or on the
// `persons`/`management_sessions` reads `authorizeManager` performs — is invisible there (CLAUDE.md
// §4). The suite retains these app-role grant checks. Seeds run as the owner (pure setup); the `core_identity` template pairs core + identity
// migrations so authorizeManager's tables and `device_profiles` both exist.
// It also exercises `device_profiles_canvas_fk`, which rejects a `canvas_id` naming no canvas — a
// constraint, not a policy.

const suite = useTemplateDb({ template: "core_identity" });

/** Run `fn` as the non-owner app role — the shape the management routes wrap every store call in
 * (withTransaction + asAppUser). */
function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.admin, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session for them, as the superuser owner. Returns
 * the session id the store's authorizeManager gate resolves. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (display_name, pin_hash, role)
    values ('Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTransaction(suite.admin, (tx) =>
    startManagementSession(tx, { personId: person.rows[0]!.id }),
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

/** Rows counted as the owner, independently of anything the app role's own reads return — so a
 * refused or rolled-back write is visible here as an absence. */
async function rowCount(): Promise<number> {
  const rows = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from device_profiles`,
  );
  return rows.rows[0]!.n;
}

/** Delete every device profile as the owner — a `finally` teardown so the suite is
 * order-independent (CLAUDE.md §4). */
async function purgeProfiles(): Promise<void> {
  await suite.admin.execute(sql`delete from device_profiles`);
}

/** Create a real canvas (as a manager) and return its id — the target the FK check
 * accepts, and the wrong-tenant target that FK-rejects a cross-tenant reference. */
async function seedCanvas(session: string, name: string): Promise<string> {
  const { id } = await asApp((tx) =>
    createCanvas(tx, {
      managementSessionId: session,
      name,
      definition: DEFAULT_CANVASES["till"],
    }),
  );
  return id;
}

describe("device-profile store on real Postgres, as the app role", () => {
  let managerSession: string;

  beforeAll(async () => {
    await seedTenant(suite.admin);
    managerSession = await seedSession("manager");
  });

  it("round-trips a manager-authored profile through create → get with validated capabilities", async () => {
    try {
      const created = await asApp((tx) =>
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
      const fetched = await asApp((tx) => getDeviceProfile(tx, created.id));
      expect(fetched).toEqual(created);
    } finally {
      await purgeProfiles();
    }
  });

  it("carries the device form factor through create → get → list", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const created = await asApp((tx) =>
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
    expect(await asApp((tx) => getDeviceProfile(tx, created.id))).toEqual(created);
    const listed = await asApp((tx) => listDeviceProfiles(tx));
    expect(listed).toEqual([created]);
  });

  it("round-trips a phone-portrait inactivity timeout through create → get, and forces null for kds", async () => {
    // The auto-logout timeout persists and reads back for a non-exempt form factor; a kds create is
    // coerced to null by validateInactivityTimeout even when a value is passed (a display never logs
    // out). Proof-by-deletion: drop the `formFactor === "kds"` guard and the kds row reads 600.
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const handheld = await asApp((tx) =>
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
    expect(await asApp((tx) => getDeviceProfile(tx, handheld.id))).toEqual(handheld);

    const kds = await asApp((tx) =>
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

  it("stores and returns a canvas reference that satisfies the composite FK", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const canvasId = await seedCanvas(session, "The canvas");
    const created = await asApp((tx) =>
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

  it("lists a tenant's device profiles by name", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const first = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "P1",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "P2",
        formFactor: "till",
        canvasId: null,
        capabilities: ["act-as-kds"],
      }),
    );
    const listed = await asApp((tx) => listDeviceProfiles(tx));
    expect(listed.map((p) => p.id)).toEqual([first.id, second.id]);
    expect(listed.map((p) => p.name)).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown device-profile id", async () => {
    const missing = await asApp((tx) =>
      getDeviceProfile(tx, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeUndefined();
  });

  it("updates a profile's name, canvas and capabilities in place", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const canvasId = await seedCanvas(session, "Target canvas");
    const created = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Original",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const updated = await asApp((tx) =>
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
    expect(await asApp((tx) => getDeviceProfile(tx, created.id))).toEqual(updated);
    expect(await rowCount()).toBe(1); // update, never insert a duplicate
  });

  it("deletes an unreferenced profile", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const created = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Doomed",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    await asApp((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id }));
    expect(await asApp((tx) => getDeviceProfile(tx, created.id))).toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it("translates a delete of a device-referenced profile to device_profile.in_use (23001 → 409), profile survives", async () => {
    // Task 5 added devices.device_profile_id → device_profiles(id) ON DELETE RESTRICT. The
    // delete of a still-referenced profile trips a 23001 restrict_violation, which deleteDeviceProfile
    // now translates (via translateWriteError) into the domain device_profile.in_use — a clean 409, not
    // the raw DB error a 500 would surface. Proof-by-deletion: remove the try/catch in
    // deleteDeviceProfile and this fails with a raw 23001 instead of the AppError. RESTRICT means the
    // profile survives, asserted via rowCount as the owner.
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const created = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Referenced",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    // Seed a location + a register + a device that binds the profile, as the owner — setup, not the
    // thing under test. A device is defined by its profile's form factor (no device_kind column); the
    // `till` profile means the binding rule (0004_device_binding_rule) requires a register, not a station.
    const location = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description) values ('Loc', array['es'], 'Hostelería') returning id`);
    const till = await suite.admin.execute<{ id: string }>(sql`
      insert into tills (location_id, name) values (${location.rows[0]!.id}, 'Register 1') returning id`);
    await suite.admin.execute(sql`
      insert into devices (location_id, till_id, label, token_hash, device_profile_id) values (${location.rows[0]!.id}, ${till.rows[0]!.id}, 'Bound device', 'scrypt$00$00', ${created.id})`);
    const error = await errorOf(() =>
      asApp((tx) => deleteDeviceProfile(tx, { managementSessionId: session, id: created.id })),
    );
    expect(typeof error).not.toBe("string"); // it threw an AppError, not a raw 23001
    expect((error as AppError).code).toBe("device_profile.in_use");
    expect((error as AppError).params).toEqual({}); // the fact of the reference is the whole message
    expect(await rowCount()).toBe(1); // the profile survived the refused delete (RESTRICT)
  });

  it("throws device_profile.not_found when updating an absent id", async () => {
    // The write-path no-row guard: `.returning({ id })` comes back empty, so updateDeviceProfile
    // throws rather than reporting a silent success. Proof-by-deletion: drop the length === 0 check and
    // this resolves, failing the assertion.
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      asApp((tx) =>
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
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      asApp((tx) =>
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
    await seedTenant(suite.admin);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      asApp((tx) =>
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
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    // authorize FIRST (manager is permitted), THEN validate — so an unknown flag from an AUTHORISED
    // actor is what proves validate runs before the write.
    const error = await errorOf(() =>
      asApp((tx) =>
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

  it("translates a duplicate name to device_profile.name_taken (23505 → clean 409), no second row", async () => {
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Twin",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      asApp((tx) =>
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
    await seedTenant(suite.admin);
    const session = await seedSession("manager");
    await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Keep",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await asApp((tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        name: "Move",
        formFactor: "till",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      asApp((tx) =>
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
