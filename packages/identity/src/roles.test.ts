import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as identity from "./index.js";
import { seedPerson } from "../test/fixtures.js";

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
  await withTransaction(suite.db, (tx) => identity.setBuiltInMembership(tx, personId, "manager"));
  expect(await identity.heldBuiltInKey(suite.db, personId)).toBe("manager");
  const authority = await identity.readPersonAuthority(suite.db, personId);
  expect(authority.roleIds).toHaveLength(2);
  expect(authority.roleIds).toContain("accountant");
  expect(await identity.heldBuiltInKey(suite.db, crypto.randomUUID())).toBeNull();
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
