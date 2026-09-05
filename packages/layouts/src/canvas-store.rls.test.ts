import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import type { CanvasDef } from "./canvas.js";
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  getCanvasForFormFactor,
  listCanvases,
  updateCanvas,
} from "./canvas-store.js";

// Real Postgres, not PGlite: the canvas store both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS + grants) and writes canvases under FORCE ROW
// LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the
// whole authorize→write path" claim would both be false passes there (CLAUDE.md §4). Seeds run as the
// superuser owner (RLS bypassed — pure setup); every store call runs under withTenant + asAppUser so
// it is a genuine RLS subject, exactly as the sibling store suites do. The `core_identity`
// template pairs core + identity migrations so authorizeManager's tables and canvases both
// exist.

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

/** The AppError code a rejected store call threw, or a describing string when it was not an AppError
 * (so a call that DID NOT throw — e.g. an authorizeManager gate deleted — reports plainly). */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

/** Rows for `tenantId` read straight as the superuser owner (RLS bypassed), to count what the app role
 * could never see across the isolation policy. */
async function rowCount(tenantId: string): Promise<number> {
  const rows = await suite.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from canvases where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

/** A valid phone canvas with a distinguishing title, so a stored row is never mistaken for a default. */
function phoneCanvas(title: string): CanvasDef {
  const base = DEFAULT_CANVASES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

describe("layout canvas store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("round-trips a manager-authored canvas through create → get", async () => {
    const definition = phoneCanvas("Floor A");
    const { id } = await asApp(managerTenant, (tx) =>
      createCanvas(tx, {
        managementSessionId: managerSession,
        tenantId: managerTenant,
        name: "Front counter",
        definition,
      }),
    );
    const row = await asApp(managerTenant, (tx) => getCanvas(tx, managerTenant, id));
    expect(row).toEqual({ id, name: "Front counter", definition });
  });

  it("lists a tenant's canvases", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const first = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "P1",
        definition: phoneCanvas("One"),
      }),
    );
    const second = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "P2",
        definition: phoneCanvas("Two"),
      }),
    );
    const listed = await asApp(tenantId, (tx) => listCanvases(tx, tenantId));
    expect(listed.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed.map((p) => p.name).sort()).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown canvas id", async () => {
    const missing = await asApp(managerTenant, (tx) =>
      getCanvas(tx, managerTenant, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeUndefined();
  });

  it("updates a canvas's name and definition in place", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const { id } = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Original",
        definition: phoneCanvas("Before"),
      }),
    );
    const nextDef = phoneCanvas("After");
    await asApp(tenantId, (tx) =>
      updateCanvas(tx, {
        managementSessionId: session,
        tenantId,
        id,
        name: "Renamed",
        definition: nextDef,
      }),
    );
    const row = await asApp(tenantId, (tx) => getCanvas(tx, tenantId, id));
    expect(row).toEqual({ id, name: "Renamed", definition: nextDef });
    expect(await rowCount(tenantId)).toBe(1); // update, never insert a duplicate
  });

  it("deletes a canvas", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const { id } = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Doomed",
        definition: phoneCanvas("Gone"),
      }),
    );
    await asApp(tenantId, (tx) => deleteCanvas(tx, { managementSessionId: session, tenantId, id }));
    expect(await asApp(tenantId, (tx) => getCanvas(tx, tenantId, id))).toBeUndefined();
    expect(await rowCount(tenantId)).toBe(0);
  });

  it("translates a delete of a profile-referenced canvas to canvas.in_use (23001 → 409), canvas survives", async () => {
    // A device profile's composite FK device_profiles_canvas_fk → canvases(tenant_id, id) is ON DELETE
    // RESTRICT, so deleting a canvas a profile still references trips a 23001 restrict_violation, which
    // deleteCanvas now translates (via translateWriteError) into the domain canvas.in_use — a clean 409,
    // not the raw DB error a 500 would surface. Proof-by-deletion: remove the try/catch in deleteCanvas
    // and this fails with a raw 23001. RESTRICT means the canvas survives. Real Postgres only: PGlite's
    // superuser bypasses nothing here (the FK still applies) but the sibling FK unit test already pins
    // the raw behaviour; this pins the translation on the same real target as the rest of the suite.
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const { id } = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Referenced canvas",
        definition: phoneCanvas("Bound"),
      }),
    );
    // Seed a device profile that binds the canvas, as the superuser owner (RLS bypassed — setup).
    await suite.admin.execute(sql`
      insert into device_profiles (tenant_id, name, canvas_id)
      values (${tenantId}, 'Binding profile', ${id})`);
    const code = await codeOf(() =>
      asApp(tenantId, (tx) => deleteCanvas(tx, { managementSessionId: session, tenantId, id })),
    );
    expect(code).toBe("canvas.in_use");
    expect(await rowCount(tenantId)).toBe(1); // the canvas survived the refused delete (RESTRICT)
  });

  it("throws canvas.not_found when updating an id the tenant does not own", async () => {
    // The write-path no-row guard: `.returning({ id })` comes back empty, so updateCanvas throws
    // rather than reporting a silent success. Proof-by-deletion: drop the `updated.length === 0` check
    // and this call resolves, failing the assertion. A well-formed uuid that names no row of this
    // tenant (an absent canvas, or another tenant's row RLS hides) hits it.
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        updateCanvas(tx, {
          managementSessionId: session,
          tenantId,
          id: "00000000-0000-4000-8000-000000000000",
          name: "Ghost",
          definition: phoneCanvas("None"),
        }),
      ),
    );
    expect(code).toBe("canvas.not_found");
  });

  it("throws canvas.not_found when deleting an id the tenant does not own", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        deleteCanvas(tx, {
          managementSessionId: session,
          tenantId,
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    );
    expect(code).toBe("canvas.not_found");
  });

  it("returns the built-in default for a form factor with no stored canvas", async () => {
    const fresh = await seedTenant(suite.admin);
    const result = await asApp(fresh, (tx) => getCanvasForFormFactor(tx, fresh, "kds"));
    expect(result).toEqual(DEFAULT_CANVASES.kds);
  });

  it("returns the first stored canvas of a form factor over the built-in default", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const stored = phoneCanvas("Custom floor");
    await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "My phone",
        definition: stored,
      }),
    );
    const result = await asApp(tenantId, (tx) =>
      getCanvasForFormFactor(tx, tenantId, "phone-portrait"),
    );
    expect(result).toEqual(stored);
    expect(result).not.toEqual(DEFAULT_CANVASES["phone-portrait"]);
  });

  it("refuses a create from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The by-deletion proof: staff holds no till.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from
    // createCanvas makes this succeed → codeOf returns "did not throw…" and a row lands, failing both
    // assertions.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        createCanvas(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          name: "Nope",
          definition: phoneCanvas("Denied"),
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount(staffTenant)).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid definition with canvas.invalid before any INSERT", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    // authorize FIRST (manager is permitted), THEN validate — so an invalid definition from an
    // AUTHORISED actor is what proves validate runs before the write. `{}` has no formFactor.
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        createCanvas(tx, {
          managementSessionId: session,
          tenantId,
          name: "Bad",
          definition: {} as unknown,
        }),
      ),
    );
    expect(code).toBe("canvas.invalid");
    expect(await rowCount(tenantId)).toBe(0); // validate threw before the INSERT
  });

  it("translates a duplicate name to canvas.name_taken (23505 → clean 409), no second row", async () => {
    // The per-tenant `canvases_tenant_name_key` unique fires on the SECOND create with the same
    // name; canvas-store catches the driver's 23505 and re-throws it as the domain canvas.name_taken
    // (the Phase-3 reviewer's flagged gap — a duplicate must not surface as a raw 500). Real Postgres,
    // not PGlite: PGlite serialises and reports no constraint, so the constraint-targeted translation
    // is only genuinely exercised here.
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Twin",
        definition: phoneCanvas("First"),
      }),
    );
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        createCanvas(tx, {
          managementSessionId: session,
          tenantId,
          name: "Twin",
          definition: phoneCanvas("Second"),
        }),
      ),
    );
    expect(code).toBe("canvas.name_taken");
    expect(await rowCount(tenantId)).toBe(1); // the duplicate never landed
  });

  it("translates a duplicate name on UPDATE to canvas.name_taken", async () => {
    // Renaming one canvas onto another's name trips the same unique on the UPDATE path.
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Keep",
        definition: phoneCanvas("A"),
      }),
    );
    const { id: second } = await asApp(tenantId, (tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        tenantId,
        name: "Move",
        definition: phoneCanvas("B"),
      }),
    );
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        updateCanvas(tx, {
          managementSessionId: session,
          tenantId,
          id: second,
          name: "Keep", // collides with the first canvas's name
          definition: phoneCanvas("B2"),
        }),
      ),
    );
    expect(code).toBe("canvas.name_taken");
  });

  it("keeps one tenant's canvases invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    const { id } = await asApp(tenantA, (tx) =>
      createCanvas(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        name: "A only",
        definition: phoneCanvas("Secret"),
      }),
    );
    // B's own list is empty, and even asking for A's id under B's GUC returns undefined — the policy's
    // USING clause filters A's row out. Drop asAppUser (or the policy) and the superuser owner would
    // read A's row here.
    expect(await asApp(tenantB, (tx) => listCanvases(tx, tenantB))).toEqual([]);
    expect(await asApp(tenantB, (tx) => getCanvas(tx, tenantB, id))).toBeUndefined();
  });
});
