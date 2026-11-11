import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, persons, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons, setBuiltInRoleForTest, builtInRoleForTest } from "../test/person-rows.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("seeds one person with the column's staff default and returns the complete stored row", async () => {
  const rows = await seedPersons(suite.db, { displayName: "Waiter", email: "waiter@example.test" });
  expect(rows).toHaveLength(1);
  const [person] = rows;
  expect(person!.displayName).toBe("Waiter");
  expect(person!.role).toBe("staff");
  const [stored] = await suite.db.select().from(persons).where(eq(persons.id, person!.id));
  expect(person).toEqual(stored);
});
it("seeds several people with their explicit roles inside the caller's transaction", async () => {
  const rows = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, [
      { displayName: "Manager", role: "manager" },
      { displayName: "Admin", role: "admin" },
    ]),
  );
  expect(rows.map((row) => [row.displayName, row.role])).toEqual([
    ["Manager", "manager"],
    ["Admin", "admin"],
  ]);
  expect(await suite.db.select().from(persons)).toHaveLength(2);
});
it("changes only the named person's role and reads it back", async () => {
  const [first, second] = await seedPersons(suite.db, [
    { displayName: "First" },
    { displayName: "Second", role: "manager" },
  ]);
  await withTransaction(suite.db, (tx) => setBuiltInRoleForTest(tx, first!.id, "supervisor"));
  expect(await builtInRoleForTest(suite.db, first!.id)).toBe("supervisor");
  expect(await withTransaction(suite.db, (tx) => builtInRoleForTest(tx, second!.id))).toBe(
    "manager",
  );
});
it("reads a missing person's role as null", async () => {
  expect(await builtInRoleForTest(suite.db, "missing")).toBeNull();
});
