import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { persons } from "./schema/persons.js";
import { listActivePersonsWithRoles } from "./staff.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

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

describe("listActivePersonsWithRoles", () => {
  it("lists the active people whose role is in the list by name, and nobody else", async () => {
    await seedTenant(suite.db);
    // Inserted out of name order, so a sorted answer shows the ordering rather than the insert.
    const supervisor = await seedPerson(suite.db, "Carla", "supervisor");
    await seedPerson(suite.db, "Bea", "manager");
    const staff = await seedPerson(suite.db, "Ada", "staff");
    await seedPerson(suite.db, "Dora", "admin");
    await seedPerson(suite.db, "Eva", "staff", "suspended");
    await seedPerson(suite.db, "Fina", "supervisor", "pending");

    const listed = await withTransaction(suite.db, (tx) =>
      listActivePersonsWithRoles(tx, ["supervisor", "staff"]),
    );

    expect(listed).toEqual([
      { personId: staff, displayName: "Ada" },
      { personId: supervisor, displayName: "Carla" },
    ]);
  });
});
