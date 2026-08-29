import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { withTenant } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { listActivePersonsWithPermission } from "./staff.js";

// REAL Postgres, not PGlite: `listActivePersonsWithPermission` runs the SELECT on persons as the
// non-superuser deployment role `app_user` under FORCE ROW LEVEL SECURITY — the posture the drawer
// route calls it in (`withTenant` + `asAppUser`). PGlite runs every connection as a superuser and
// bypasses RLS (CLAUDE.md §4), so it could not prove the read is tenant-scoped for the real role.
// `identity_rls_probe` is the cluster-wide non-superuser app_user member the package globalSetup
// creates (see persons.rls.test.ts).
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";
const PIN = hashPin("1234");

const suite = useTemplateDb({ template: "core_identity" });

/** Seed one active-by-default person of `role` as the superuser (bypasses RLS to write across roles),
 * returning its id. The query under test then reads them back as the app_user probe. */
async function seedPerson(
  admin: Database,
  tenantId: string,
  name: string,
  role: PersonRoleValue,
  status: "active" | "suspended" = "active",
): Promise<string> {
  const rows = await admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role, status)
    values (${tenantId}, ${name}, ${PIN}, ${role}, ${status}) returning id`);
  return rows.rows[0]!.id;
}

describe("listActivePersonsWithPermission (real RLS, app_user role)", () => {
  it("returns active persons whose role holds the permission — supervisor/manager/admin in, staff and inactive out, name-sorted", async () => {
    const tenantId = await seedTenant(suite.admin);
    // Insert out of alphabetical order so a sorted result proves the orderBy, not insertion order.
    const mgr = await seedPerson(suite.admin, tenantId, "Carla", "manager");
    const sup = await seedPerson(suite.admin, tenantId, "Bea", "supervisor");
    const adm = await seedPerson(suite.admin, tenantId, "Ada", "admin");
    const staff = await seedPerson(suite.admin, tenantId, "Dora", "staff");
    const goneSup = await seedPerson(suite.admin, tenantId, "Eva", "supervisor", "suspended");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const rows = await withTenant(probe, tenantId, (tx) =>
        listActivePersonsWithPermission(tx, "cash.drawer"),
      );

      // cash.drawer holders only, active only, sorted by displayName: Ada(admin), Bea(sup), Carla(mgr).
      expect(rows).toEqual([
        { personId: adm, displayName: "Ada" },
        { personId: sup, displayName: "Bea" },
        { personId: mgr, displayName: "Carla" },
      ]);
      // Only id + name reach a caller — no PIN material, role or status leaks.
      expect(Object.keys(rows[0]!)).toEqual(["personId", "displayName"]);
      // The staff person (no cash.drawer) and the SUSPENDED supervisor (status filter) are excluded.
      const ids = new Set(rows.map((r) => r.personId));
      expect(ids.has(staff)).toBe(false);
      expect(ids.has(goneSup)).toBe(false);
    } finally {
      await probe.close();
    }
  });

  it("is tenant-scoped by RLS — another tenant's supervisor is never returned", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const mySup = await seedPerson(suite.admin, mine, "Nadia", "supervisor");
    // A supervisor in the OTHER tenant: real (so there is something to hide) but out of scope.
    await seedPerson(suite.admin, theirs, "Otra", "supervisor");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const rows = await withTenant(probe, mine, (tx) =>
        listActivePersonsWithPermission(tx, "cash.drawer"),
      );
      expect(rows).toEqual([{ personId: mySup, displayName: "Nadia" }]);
    } finally {
      await probe.close();
    }
  });
});
