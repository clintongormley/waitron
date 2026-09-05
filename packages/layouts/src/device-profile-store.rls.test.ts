import { asAppUser, captureError, withTenant } from "@waitron/db";
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

// Real Postgres, not PGlite: the device-profile store both AUTHORIZES (authorizeManager reads persons
// + management_sessions under the app role's RLS + grants) and writes device_profiles under FORCE ROW
// LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the whole
// authorize→write path" claim would both be false passes there (CLAUDE.md §4). It also cannot exercise
// the tenant-consistent composite FK (device_profiles_canvas_fk) that rejects another tenant's canvas.
// Seeds run as the superuser owner (RLS bypassed — pure setup); every store call runs under
// withTenant + asAppUser so it is a genuine RLS subject, exactly as canvas-store.rls.test.ts does.

const suite = useTemplateDb({ template: "core_identity" });

/** Run `fn` as the non-owner app role, scoped to `tenantId` — the shape the management routes wrap
 * every store call in (withTenant + asAppUser). */
function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session for them, as the superuser owner. Returns
 * the session id the store's authorizeManager gate resolves. */
async function seedSession(tenantId: string, role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTenant(suite.admin, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
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

/** Rows for `tenantId` read straight as the superuser owner (RLS bypassed), to count what the app role
 * could never see across the isolation policy. */
async function rowCount(tenantId: string): Promise<number> {
  const rows = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from device_profiles where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

/** Delete every device profile of `tenantId` as the owner (RLS bypassed) — a `finally` teardown so a
 * suite reusing the shared managerTenant is order-independent (CLAUDE.md §4). */
async function purgeProfiles(tenantId: string): Promise<void> {
  await suite.admin.execute(sql`delete from device_profiles where tenant_id = ${tenantId}`);
}

/** Create a real canvas for `tenantId` (as a manager) and return its id — the target the FK check
 * accepts, and the wrong-tenant target that FK-rejects a cross-tenant reference. */
async function seedCanvas(tenantId: string, session: string, name: string): Promise<string> {
  const { id } = await asApp(tenantId, (tx) =>
    createCanvas(tx, {
      managementSessionId: session,
      tenantId,
      name,
      definition: DEFAULT_CANVASES["till"],
    }),
  );
  return id;
}

describe("device-profile store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("round-trips a manager-authored profile through create → get with validated capabilities", async () => {
    try {
      const created = await asApp(managerTenant, (tx) =>
        createDeviceProfile(tx, {
          managementSessionId: managerSession,
          tenantId: managerTenant,
          name: "Front counter",
          canvasId: null,
          capabilities: ["open-cash-drawer", "integrated-card-payment", "open-cash-drawer"],
        }),
      );
      // validateCapabilities dedupes, first-seen order preserved.
      expect(created).toEqual({
        id: created.id,
        name: "Front counter",
        canvasId: null,
        capabilities: ["open-cash-drawer", "integrated-card-payment"],
      });
      const fetched = await asApp(managerTenant, (tx) =>
        getDeviceProfile(tx, managerTenant, created.id),
      );
      expect(fetched).toEqual(created);
    } finally {
      await purgeProfiles(managerTenant);
    }
  });

  it("stores and returns a canvas reference that satisfies the composite FK", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const canvasId = await seedCanvas(tenantId, session, "The canvas");
    const created = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Bound",
        canvasId,
        capabilities: [],
      }),
    );
    expect(created).toEqual({ id: created.id, name: "Bound", canvasId, capabilities: [] });
  });

  it("lists a tenant's device profiles by name", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const first = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "P1",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "P2",
        canvasId: null,
        capabilities: ["act-as-kds"],
      }),
    );
    const listed = await asApp(tenantId, (tx) => listDeviceProfiles(tx, tenantId));
    expect(listed.map((p) => p.id)).toEqual([first.id, second.id]);
    expect(listed.map((p) => p.name)).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown device-profile id", async () => {
    const missing = await asApp(managerTenant, (tx) =>
      getDeviceProfile(tx, managerTenant, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeUndefined();
  });

  it("updates a profile's name, canvas and capabilities in place", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const canvasId = await seedCanvas(tenantId, session, "Target canvas");
    const created = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Original",
        canvasId: null,
        capabilities: [],
      }),
    );
    const updated = await asApp(tenantId, (tx) =>
      updateDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        id: created.id,
        name: "Renamed",
        canvasId,
        capabilities: ["integrated-card-payment"],
      }),
    );
    expect(updated).toEqual({
      id: created.id,
      name: "Renamed",
      canvasId,
      capabilities: ["integrated-card-payment"],
    });
    expect(await asApp(tenantId, (tx) => getDeviceProfile(tx, tenantId, created.id))).toEqual(
      updated,
    );
    expect(await rowCount(tenantId)).toBe(1); // update, never insert a duplicate
  });

  it("deletes an unreferenced profile", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const created = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Doomed",
        canvasId: null,
        capabilities: [],
      }),
    );
    await asApp(tenantId, (tx) =>
      deleteDeviceProfile(tx, { managementSessionId: session, tenantId, id: created.id }),
    );
    expect(
      await asApp(tenantId, (tx) => getDeviceProfile(tx, tenantId, created.id)),
    ).toBeUndefined();
    expect(await rowCount(tenantId)).toBe(0);
  });

  it("translates a delete of a device-referenced profile to device_profile.in_use (23001 → 409), profile survives", async () => {
    // Task 5 added devices.device_profile_id → device_profiles(tenant_id, id) ON DELETE RESTRICT. The
    // delete of a still-referenced profile trips a 23001 restrict_violation, which deleteDeviceProfile
    // now translates (via translateWriteError) into the domain device_profile.in_use — a clean 409, not
    // the raw DB error a 500 would surface. Proof-by-deletion: remove the try/catch in
    // deleteDeviceProfile and this fails with a raw 23001 instead of the AppError. RESTRICT means the
    // profile survives, asserted via rowCount as the owner (RLS bypassed).
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const created = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Referenced",
        canvasId: null,
        capabilities: [],
      }),
    );
    // Seed a location + a device that binds the profile, as the superuser owner (RLS bypassed — setup).
    const location = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Loc', array['es'], 'Hostelería') returning id`);
    await suite.admin.execute(sql`
      insert into devices (tenant_id, location_id, device_kind, label, token_hash, device_profile_id)
      values (${tenantId}, ${location.rows[0]!.id}, 'till', 'Bound device', 'scrypt$00$00', ${created.id})`);
    const error = await errorOf(() =>
      asApp(tenantId, (tx) =>
        deleteDeviceProfile(tx, { managementSessionId: session, tenantId, id: created.id }),
      ),
    );
    expect(typeof error).not.toBe("string"); // it threw an AppError, not a raw 23001
    expect((error as AppError).code).toBe("device_profile.in_use");
    expect((error as AppError).params).toEqual({}); // the fact of the reference is the whole message
    expect(await rowCount(tenantId)).toBe(1); // the profile survived the refused delete (RESTRICT)
  });

  it("throws device_profile.not_found when updating an id the tenant does not own", async () => {
    // The write-path no-row guard: `.returning({ id })` comes back empty, so updateDeviceProfile
    // throws rather than reporting a silent success. Proof-by-deletion: drop the length === 0 check and
    // this resolves, failing the assertion.
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        updateDeviceProfile(tx, {
          managementSessionId: session,
          tenantId,
          id: "00000000-0000-4000-8000-000000000000",
          name: "Ghost",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.not_found");
  });

  it("throws device_profile.not_found when deleting an id the tenant does not own", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        deleteDeviceProfile(tx, {
          managementSessionId: session,
          tenantId,
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    );
    expect(code).toBe("device_profile.not_found");
  });

  it("refuses a create from a staff-role session — the authorizeManager gate (differential)", async () => {
    // Staff holds no till.configure, so authorizeManager throws authorization.not_permitted BEFORE any
    // write. Deleting the authorizeManager call from createDeviceProfile makes this succeed → a row
    // lands, failing both assertions.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        createDeviceProfile(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          name: "Nope",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount(staffTenant)).toBe(0); // the gate ran before the write
  });

  it("rejects an unknown capability with device_profile.invalid {bad_capabilities} before any INSERT", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    // authorize FIRST (manager is permitted), THEN validate — so an unknown flag from an AUTHORISED
    // actor is what proves validate runs before the write.
    const error = await errorOf(() =>
      asApp(tenantId, (tx) =>
        createDeviceProfile(tx, {
          managementSessionId: session,
          tenantId,
          name: "Bad caps",
          canvasId: null,
          capabilities: ["not-a-flag"],
        }),
      ),
    );
    expect(typeof error).not.toBe("string");
    expect((error as AppError).code).toBe("device_profile.invalid");
    expect((error as AppError).params).toEqual({ reason: "bad_capabilities" });
    expect(await rowCount(tenantId)).toBe(0); // validate threw before the INSERT
  });

  it("maps a cross-tenant canvas reference to device_profile.invalid {bad_canvas_ref} via the FK", async () => {
    // The tenant-consistent composite FK device_profiles_canvas_fk → canvases(tenant_id, id) rejects a
    // canvas_id that belongs to ANOTHER tenant: (tenantB, A's canvas id) has no matching canvases row,
    // so Postgres raises 23503, which the store translates. Real Postgres only — PGlite bypasses this.
    const tenantA = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    const foreignCanvas = await seedCanvas(tenantA, sessionA, "A's canvas");

    const tenantB = await seedTenant(suite.admin);
    const sessionB = await seedSession(tenantB, "manager");
    const error = await errorOf(() =>
      asApp(tenantB, (tx) =>
        createDeviceProfile(tx, {
          managementSessionId: sessionB,
          tenantId: tenantB,
          name: "Stolen canvas",
          canvasId: foreignCanvas, // belongs to tenantA
          capabilities: [],
        }),
      ),
    );
    expect(typeof error).not.toBe("string");
    expect((error as AppError).code).toBe("device_profile.invalid");
    expect((error as AppError).params).toEqual({ reason: "bad_canvas_ref" });
    expect(await rowCount(tenantB)).toBe(0); // the FK rejected the row
  });

  it("translates a duplicate name to device_profile.name_taken (23505 → clean 409), no second row", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Twin",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        createDeviceProfile(tx, {
          managementSessionId: session,
          tenantId,
          name: "Twin",
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.name_taken");
    expect(await rowCount(tenantId)).toBe(1); // the duplicate never landed
  });

  it("translates a duplicate name on UPDATE to device_profile.name_taken", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Keep",
        canvasId: null,
        capabilities: [],
      }),
    );
    const second = await asApp(tenantId, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Move",
        canvasId: null,
        capabilities: [],
      }),
    );
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        updateDeviceProfile(tx, {
          managementSessionId: session,
          tenantId,
          id: second.id,
          name: "Keep", // collides with the first profile's name
          canvasId: null,
          capabilities: [],
        }),
      ),
    );
    expect(code).toBe("device_profile.name_taken");
  });

  it("keeps one tenant's device profiles invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    const created = await asApp(tenantA, (tx) =>
      createDeviceProfile(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        name: "A only",
        canvasId: null,
        capabilities: [],
      }),
    );
    // B's own list is empty, and even asking for A's id under B's GUC returns undefined — the policy's
    // USING clause filters A's row out. Drop asAppUser (or the policy) and the superuser owner would
    // read A's row here.
    expect(await asApp(tenantB, (tx) => listDeviceProfiles(tx, tenantB))).toEqual([]);
    expect(await asApp(tenantB, (tx) => getDeviceProfile(tx, tenantB, created.id))).toBeUndefined();
  });
});
