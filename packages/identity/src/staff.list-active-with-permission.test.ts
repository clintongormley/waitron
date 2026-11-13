import { seedPersons } from "../test/person-rows.js";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { registerModulePermissions } from "./permissions.js";
import type { BuiltInRoleKey } from "./permissions.js";
import { hashPin } from "./verify-pin.js";
import { listActivePersonsWithPermission } from "./staff.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/** Through the table definition, not raw SQL: `id` and `created_at` are Drizzle `$defaultFn`
 * generators that only the insert BUILDER runs. */
async function seedPerson(
  db: Database,
  name: string,
  role: BuiltInRoleKey,
  status: "active" | "suspended" | "pending" = "active",
): Promise<string> {
  const [row] = await seedPersons(db, { displayName: name, pinHash: PIN, role, status });
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
    await seedPerson(suite.db, "Fina", "supervisor", "pending");

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

it("lists active managers for a registered module permission, excluding staff and suspended managers", async () => {
  registerModulePermissions([{ permission: "test.active_manager", defaultHolders: ["manager"] }]);
  await seedTenant(suite.db);
  const managerId = await seedPerson(suite.db, "Manager", "manager");
  await seedPerson(suite.db, "Staff", "staff");
  await seedPerson(suite.db, "Suspended", "manager", "suspended");
  expect(
    await withTransaction(suite.db, (tx) =>
      listActivePersonsWithPermission(tx, "test.active_manager"),
    ),
  ).toEqual([{ personId: managerId, displayName: "Manager" }]);
});

it("uses one select for a supervisor picker with 50 people", async () => {
  const people = await seedPersons(
    suite.db,
    Array.from({ length: 50 }, (_, index) => ({
      displayName: `Person ${String(index).padStart(2, "0")}`,
      pinHash: PIN,
      role: index % 2 === 0 ? ("manager" as const) : ("staff" as const),
    })),
  );
  await withTransaction(suite.db, async (tx) => {
    const reads = vi.spyOn(tx, "select");
    try {
      expect(await listActivePersonsWithPermission(tx, "cash.drawer")).toEqual(
        people
          .filter((_, index) => index % 2 === 0)
          .map((person) => ({
            personId: person.id,
            displayName: person.displayName,
          })),
      );
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
  });
});
