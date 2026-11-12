import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  persons,
  staffRoles,
  personStaffRoles,
  withTransaction,
} from "@waitron/db";
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

it("gives seeded people one shared fixture job role across calls", async () => {
  const [first] = await seedPersons(suite.db, { displayName: "First" });
  const [second] = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, { displayName: "Second" }),
  );
  expect(await suite.db.select({ name: staffRoles.name }).from(staffRoles)).toEqual([
    { name: "Fixture team" },
  ]);
  const held = await suite.db.select().from(personStaffRoles);
  expect(held.map((row) => row.personId).sort()).toEqual([first!.id, second!.id].sort());
  expect(new Set(held.map((row) => row.staffRoleId)).size).toBe(1);
});
it("uses explicit job roles and leaves jobRoles: [] without memberships", async () => {
  const [role] = await suite.db.insert(staffRoles).values({ name: "Kitchen" }).returning();
  const people = await seedPersons(suite.db, [
    { displayName: "Kitchen", jobRoles: [role!.id] },
    { displayName: "No job", jobRoles: [] },
  ]);
  expect(await suite.db.select().from(personStaffRoles)).toEqual([
    { personId: people[0]!.id, staffRoleId: role!.id },
  ]);
  expect(await suite.db.select({ name: staffRoles.name }).from(staffRoles)).toEqual([
    { name: "Kitchen" },
  ]);
});
