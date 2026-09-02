import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PROFILES } from "./default-profiles.js";
import type { ProfileDef } from "./profile.js";
import {
  createProfile,
  deleteProfile,
  getProfile,
  getProfileForFormFactor,
  listProfiles,
  updateProfile,
} from "./profile-store.js";

// Real Postgres, not PGlite: the profile store both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS + grants) and writes layout_profiles under FORCE ROW
// LEVEL SECURITY. PGlite runs every connection as a superuser, which bypasses FORCE and the
// tenant-isolation policy, so the cross-tenant isolation assertion and the "app role can run the
// whole authorize→write path" claim would both be false passes there (CLAUDE.md §4). Seeds run as the
// superuser owner (RLS bypassed — pure setup); every store call runs under withTenant + asAppUser so
// it is a genuine RLS subject, exactly as store.rls.test.ts (till_layouts) does. The `core_identity`
// template pairs core + identity migrations so authorizeManager's tables and layout_profiles both
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
    sql`select count(*)::int as n from layout_profiles where tenant_id = ${tenantId}`,
  );
  return rows.rows[0]!.n;
}

/** A valid phone profile with a distinguishing title, so a stored row is never mistaken for a default. */
function phoneProfile(title: string): ProfileDef {
  const base = DEFAULT_PROFILES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

describe("layout profile store under real row-level security", () => {
  let managerTenant: string;
  let managerSession: string;

  beforeAll(async () => {
    managerTenant = await seedTenant(suite.admin);
    managerSession = await seedSession(managerTenant, "manager");
  });

  it("round-trips a manager-authored profile through create → get", async () => {
    const definition = phoneProfile("Floor A");
    const { id } = await asApp(managerTenant, (tx) =>
      createProfile(tx, {
        managementSessionId: managerSession,
        tenantId: managerTenant,
        name: "Front counter",
        definition,
      }),
    );
    const row = await asApp(managerTenant, (tx) => getProfile(tx, managerTenant, id));
    expect(row).toEqual({ id, name: "Front counter", definition });
  });

  it("lists a tenant's profiles", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const first = await asApp(tenantId, (tx) =>
      createProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "P1",
        definition: phoneProfile("One"),
      }),
    );
    const second = await asApp(tenantId, (tx) =>
      createProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "P2",
        definition: phoneProfile("Two"),
      }),
    );
    const listed = await asApp(tenantId, (tx) => listProfiles(tx, tenantId));
    expect(listed.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed.map((p) => p.name).sort()).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown profile id", async () => {
    const missing = await asApp(managerTenant, (tx) =>
      getProfile(tx, managerTenant, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeUndefined();
  });

  it("updates a profile's name and definition in place", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const { id } = await asApp(tenantId, (tx) =>
      createProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Original",
        definition: phoneProfile("Before"),
      }),
    );
    const nextDef = phoneProfile("After");
    await asApp(tenantId, (tx) =>
      updateProfile(tx, {
        managementSessionId: session,
        tenantId,
        id,
        name: "Renamed",
        definition: nextDef,
      }),
    );
    const row = await asApp(tenantId, (tx) => getProfile(tx, tenantId, id));
    expect(row).toEqual({ id, name: "Renamed", definition: nextDef });
    expect(await rowCount(tenantId)).toBe(1); // update, never insert a duplicate
  });

  it("deletes a profile", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const { id } = await asApp(tenantId, (tx) =>
      createProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "Doomed",
        definition: phoneProfile("Gone"),
      }),
    );
    await asApp(tenantId, (tx) =>
      deleteProfile(tx, { managementSessionId: session, tenantId, id }),
    );
    expect(await asApp(tenantId, (tx) => getProfile(tx, tenantId, id))).toBeUndefined();
    expect(await rowCount(tenantId)).toBe(0);
  });

  it("returns the built-in default for a form factor with no stored profile", async () => {
    const fresh = await seedTenant(suite.admin);
    const result = await asApp(fresh, (tx) => getProfileForFormFactor(tx, fresh, "kds"));
    expect(result).toEqual(DEFAULT_PROFILES.kds);
  });

  it("returns the first stored profile of a form factor over the built-in default", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    const stored = phoneProfile("Custom floor");
    await asApp(tenantId, (tx) =>
      createProfile(tx, {
        managementSessionId: session,
        tenantId,
        name: "My phone",
        definition: stored,
      }),
    );
    const result = await asApp(tenantId, (tx) =>
      getProfileForFormFactor(tx, tenantId, "phone-portrait"),
    );
    expect(result).toEqual(stored);
    expect(result).not.toEqual(DEFAULT_PROFILES["phone-portrait"]);
  });

  it("refuses a create from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The by-deletion proof: staff holds no till.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from
    // createProfile makes this succeed → codeOf returns "did not throw…" and a row lands, failing both
    // assertions.
    const staffTenant = await seedTenant(suite.admin);
    const staffSession = await seedSession(staffTenant, "staff");
    const code = await codeOf(() =>
      asApp(staffTenant, (tx) =>
        createProfile(tx, {
          managementSessionId: staffSession,
          tenantId: staffTenant,
          name: "Nope",
          definition: phoneProfile("Denied"),
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount(staffTenant)).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid definition with profile.invalid before any INSERT", async () => {
    const tenantId = await seedTenant(suite.admin);
    const session = await seedSession(tenantId, "manager");
    // authorize FIRST (manager is permitted), THEN validate — so an invalid definition from an
    // AUTHORISED actor is what proves validate runs before the write. `{}` has no formFactor.
    const code = await codeOf(() =>
      asApp(tenantId, (tx) =>
        createProfile(tx, {
          managementSessionId: session,
          tenantId,
          name: "Bad",
          definition: {} as unknown,
        }),
      ),
    );
    expect(code).toBe("profile.invalid");
    expect(await rowCount(tenantId)).toBe(0); // validate threw before the INSERT
  });

  it("keeps one tenant's profiles invisible to another — RLS isolation", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const sessionA = await seedSession(tenantA, "manager");
    const { id } = await asApp(tenantA, (tx) =>
      createProfile(tx, {
        managementSessionId: sessionA,
        tenantId: tenantA,
        name: "A only",
        definition: phoneProfile("Secret"),
      }),
    );
    // B's own list is empty, and even asking for A's id under B's GUC returns undefined — the policy's
    // USING clause filters A's row out. Drop asAppUser (or the policy) and the superuser owner would
    // read A's row here.
    expect(await asApp(tenantB, (tx) => listProfiles(tx, tenantB))).toEqual([]);
    expect(await asApp(tenantB, (tx) => getProfile(tx, tenantB, id))).toBeUndefined();
  });
});
