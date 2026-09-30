import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { persons } from "./schema/persons.js";
import { listActivePersonsAtOrAboveRole } from "./staff.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/** Through the table definition: `id` and `created_at` are `$defaultFn` generators. */
async function seedPerson(
  db: Database,
  name: string,
  role: PersonRoleValue,
  status: "active" | "suspended" | "pending" = "active",
): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({ displayName: name, pinHash: PIN, role, status })
    .returning({ id: persons.id });
  return row!.id;
}

describe("listActivePersonsAtOrAboveRole", () => {
  it("lists the active people at or above the role by name, and nobody below it or not active", async () => {
    await seedTenant(suite.db);
    // Inserted out of name order, so a sorted answer shows the ordering rather than the insert.
    const manager = await seedPerson(suite.db, "Carla", "manager");
    await seedPerson(suite.db, "Bea", "supervisor");
    const admin = await seedPerson(suite.db, "Ada", "admin");
    await seedPerson(suite.db, "Dora", "staff");
    await seedPerson(suite.db, "Eva", "manager", "suspended");
    await seedPerson(suite.db, "Fina", "admin", "pending");

    const managers = await withTransaction(suite.db, (tx) =>
      listActivePersonsAtOrAboveRole(tx, "manager"),
    );
    const everyone = await withTransaction(suite.db, (tx) =>
      listActivePersonsAtOrAboveRole(tx, "staff"),
    );

    expect(managers).toEqual([
      { personId: admin, displayName: "Ada" },
      { personId: manager, displayName: "Carla" },
    ]);
    expect(everyone.map((row) => row.displayName)).toEqual(["Ada", "Bea", "Carla", "Dora"]);
  });
});
