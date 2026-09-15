import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { listActivePersonsWithPermission } from "./staff.js";

// Real PostgreSQL reads filtered person rows through an app_user member login.
const PROBE_ROLE = "identity_rls_probe";
const PROBE_PASSWORD = "probe";
const PIN = hashPin("1234");

const suite = useTemplateDb({ template: "core_identity" });

/** Seed one active-by-default person of `role` as the owner, returning its id. The query under test
 * then reads them back as the app_user probe. */
async function seedPerson(
  admin: Database,
  name: string,
  role: PersonRoleValue,
  status: "active" | "suspended" = "active",
): Promise<string> {
  const rows = await admin.execute<{ id: string }>(sql`
    insert into persons (display_name, pin_hash, role, status)
    values (${name}, ${PIN}, ${role}, ${status}) returning id`);
  return rows.rows[0]!.id;
}

describe("listActivePersonsWithPermission", () => {
  it("returns active persons whose role holds the permission — supervisor/manager/admin in, staff and inactive out, name-sorted", async () => {
    // Insert out of alphabetical order so a sorted result proves the orderBy, not insertion order.
    const mgr = await seedPerson(suite.admin, "Carla", "manager");
    const sup = await seedPerson(suite.admin, "Bea", "supervisor");
    const adm = await seedPerson(suite.admin, "Ada", "admin");
    const staff = await seedPerson(suite.admin, "Dora", "staff");
    const goneSup = await seedPerson(suite.admin, "Eva", "supervisor", "suspended");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const rows = await withTransaction(probe, (tx) =>
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
});
