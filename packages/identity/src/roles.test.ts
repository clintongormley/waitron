import { CORE_MIGRATIONS, activityLog, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as identity from "./index.js";
import { openFreshManagementSession, seedPerson } from "../test/fixtures.js";
import { seedPersons } from "../test/person-rows.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("creates each built-in once and preserves its edited permissions", async () => {
  const first = await withTransaction(suite.db, identity.ensureBuiltInRoles);
  await suite.db.execute(sql`update roles set permissions = '[]' where built_in_key = 'staff'`);
  expect(await withTransaction(suite.db, identity.ensureBuiltInRoles)).toEqual(first);
  const rows = await suite.db.execute<{ built_in_key: string; name: null; permissions: string }>(
    sql`select built_in_key, name, permissions from roles order by built_in_key`,
  );
  expect(rows.rows).toHaveLength(4);
  expect(rows.rows.map((r) => r.built_in_key)).toEqual(["admin", "manager", "staff", "supervisor"]);
  expect(rows.rows.every((r) => r.name === null)).toBe(true);
  expect(rows.rows.find((r) => r.built_in_key === "staff")!.permissions).toBe("[]");
  expect(rows.rows.find((r) => r.built_in_key === "admin")!.permissions).toBe("[]");
  expect(JSON.parse(rows.rows.find((r) => r.built_in_key === "supervisor")!.permissions)).toContain(
    "sale.refund",
  );
});

it("combines stored roles and filters undeclared permissions, with no grants without a membership", async () => {
  const personId = await seedPerson(suite.db, "staff");
  await suite.db.execute(sql`insert into roles (id, name, name_folded, permissions, created_at)
    values ('accountant', 'Accountant', 'accountant', '["report.view","role_test.retired"]', '2026-11-13T00:00:00Z')`);
  await suite.db.execute(sql`insert into person_roles values (${personId}, 'accountant')`);
  const authority = await identity.readPersonAuthority(suite.db, personId);
  expect(authority.roleIds).toContain("accountant");
  expect(authority.admin).toBe(false);
  expect(identity.holds(authority, "payment.take")).toBe(true);
  expect(identity.holds(authority, "report.view")).toBe(true);
  expect(authority.permissions.has("role_test.retired")).toBe(false);
  await suite.db.execute(sql`delete from person_roles where person_id = ${personId}`);
  expect(await identity.readPersonAuthority(suite.db, personId)).toEqual({
    personId,
    admin: false,
    roleIds: [],
    permissions: new Set(),
  });
});

it("replaces only the built-in membership", async () => {
  const personId = await seedPerson(suite.db, "staff");
  await suite.db.execute(sql`insert into roles (id, name, name_folded, created_at)
    values ('accountant', 'Accountant', 'accountant', '2026-11-13T00:00:00Z')`);
  await suite.db.execute(sql`insert into person_roles values (${personId}, 'accountant')`);
  const actor = await openFreshManagementSession(suite.db, "admin");
  const builtIns = await withTransaction(suite.db, identity.ensureBuiltInRoles);
  await withTransaction(suite.db, (tx) =>
    identity.setPersonAccessRoles(tx, {
      managementSessionId: actor.token,
      personId,
      roleIds: [builtIns.manager, "accountant"],
      expectedRoleIds: [builtIns.staff, "accountant"],
    }),
  );
  expect((await identity.readPersonAuthority(suite.db, personId)).roleIds).toContain(
    builtIns.manager,
  );
  const authority = await identity.readPersonAuthority(suite.db, personId);
  expect(authority.roleIds).toHaveLength(2);
  expect(authority.roleIds).toContain("accountant");
  expect((await identity.readPersonAuthority(suite.db, crypto.randomUUID())).roleIds).toEqual([]);
});

it("normalises an imported custom role name instead of trusting its folded value", async () => {
  const id = await withTransaction(suite.db, (tx) =>
    identity.importAccessRole(tx, {
      built_in_key: null,
      name: "  ACCOUNTANT  ",
      name_folded: "WRONG",
      permissions: "[]",
      created_at: "2026-11-13T00:00:00Z",
    }),
  );
  const rows = await suite.db.execute(sql`select name, name_folded from roles where id = ${id}`);
  expect(rows.rows).toEqual([{ name: "ACCOUNTANT", name_folded: "accountant" }]);
});

it("imports an edited built-in onto its local id and logs its membership without mail", async () => {
  const [person] = await seedPersons(suite.db, {
    displayName: "Imported supervisor",
    email: "supervisor@example.test",
  });
  const builtIns = await withTransaction(suite.db, identity.ensureBuiltInRoles);
  const otherRoles = sql`select id, permissions from roles
    where built_in_key <> 'supervisor' order by id`;
  const before = await suite.db.execute(otherRoles);
  const roleId = await withTransaction(suite.db, async (tx) => {
    const id = await identity.importAccessRole(tx, {
      id: "source-supervisor",
      built_in_key: "supervisor",
      permissions: '["report.view"]',
    });
    await identity.importAccessRoleMembership(tx, person!.id, id);
    return id;
  });
  expect(roleId).toBe(builtIns.supervisor);
  const stored = await suite.db.execute(sql`select permissions from roles where id = ${roleId}`);
  expect(stored.rows).toEqual([{ permissions: '["report.view"]' }]);
  expect((await suite.db.execute(otherRoles)).rows).toEqual(before.rows);
  expect((await identity.readPersonAuthority(suite.db, person!.id)).roleIds).toContain(roleId);
  const entries = await suite.db.select().from(activityLog);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "access_role.member_added",
    personId: null,
    subjectKind: "person",
    subjectId: person!.id,
  });
  expect(entries[0]!.data).toEqual({ roleId, builtInKey: "supervisor", name: null });
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});
