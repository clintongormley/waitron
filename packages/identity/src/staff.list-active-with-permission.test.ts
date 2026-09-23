/**
 * `listActivePersonsWithPermission` returns the active holders of a permission, name-sorted, and
 * nothing else about them.
 *
 * ## What this suite was, and what converting it cost
 *
 * There are no roles on this engine, so nothing here distinguishes "the query is permitted" from
 * "the query runs". The filtering, the projection and the ordering — which is what the case
 * actually asserts — are unchanged.
 *
 * This is the only suite in the package that covers this function, which is why it is converted
 * rather than deleted with the role it used to exercise.
 *
 * The filename names that function because nothing else in the package does: `grep -rn
 * listActivePersonsWithPermission packages/identity/src`, run 2026-09-22, finds it in `staff.ts`
 * (the definition), `index.ts` (the re-export) and this file. The sibling `staff.test.ts` covers
 * the rest of `staff.ts` and never mentions it.
 */
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { persons } from "./schema/persons.js";
import { listActivePersonsWithPermission } from "./staff.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/**
 * Seed one person of `role`, returning its id. Through the table definition, not raw SQL: `id` and
 * `created_at` are Drizzle `$defaultFn` generators that only the insert BUILDER runs.
 */
async function seedPerson(
  db: Database,
  name: string,
  role: PersonRoleValue,
  status: "active" | "suspended" = "active",
): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({ displayName: name, pinHash: PIN, role, status })
    .returning({ id: persons.id });
  return row!.id;
}

describe("listActivePersonsWithPermission", () => {
  it("returns active persons whose role holds the permission — supervisor/manager/admin in, staff and inactive out, name-sorted", async () => {
    await seedTenant(suite.db);
    // Insert out of alphabetical order so a sorted result proves the orderBy, not insertion order.
    const mgr = await seedPerson(suite.db, "Carla", "manager");
    const sup = await seedPerson(suite.db, "Bea", "supervisor");
    const adm = await seedPerson(suite.db, "Ada", "admin");
    const staff = await seedPerson(suite.db, "Dora", "staff");
    const goneSup = await seedPerson(suite.db, "Eva", "supervisor", "suspended");

    const rows = await withTransaction(suite.db, (tx) =>
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
  });
});
