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

/** Through the table definition, not raw SQL: `id` and `created_at` are Drizzle `$defaultFn`
 * generators that only the insert BUILDER runs. */
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

    expect(rows).toEqual([
      { personId: adm, displayName: "Ada" },
      { personId: sup, displayName: "Bea" },
      { personId: mgr, displayName: "Carla" },
    ]);
    expect(Object.keys(rows[0]!)).toEqual(["personId", "displayName"]);
    const ids = new Set(rows.map((r) => r.personId));
    expect(ids.has(staff)).toBe(false);
    expect(ids.has(goneSup)).toBe(false);
  });
});
