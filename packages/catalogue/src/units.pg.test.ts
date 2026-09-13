import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  readProductUnitId,
  updateUnit,
} from "./units.js";

const suite = useTemplateDb({ template: "core" });

function app<T>(
  db: Database,
  tenantId: string,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}

async function product(tenantId: string): Promise<string> {
  const menu = await suite.admin.execute<{ id: string }>(sql`
    insert into catalogues (tenant_id, name) values (${tenantId}, 'Menu') returning id`);
  return (
    await suite.admin.execute<{ id: string }>(sql`
      insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
      values (${tenantId}, ${menu.rows[0]!.id}, '{"en":"Soup"}', 'each', 1, 'general') returning id`)
  ).rows[0]!.id;
}

it("changes a product's unit even while product_units publishes updates for replication", async () => {
  const tenantId = await seedTenant(suite.admin);
  const productId = await product(tenantId);
  const each = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "each" }, precision: 0 }, "en"),
  );
  const kg = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3 }, "en"),
  );
  await app(suite.admin, tenantId, (tx) => assignProductUnit(tx, tenantId, productId, each.id));
  // Reproduce production: the table publishes UPDATEs. Without a replica identity (its primary key)
  // Postgres refuses the reassignment upsert's UPDATE — the defect this guards against.
  await suite.admin.execute(
    sql`create publication test_product_units_updates for table product_units`,
  );
  try {
    await app(suite.admin, tenantId, (tx) => assignProductUnit(tx, tenantId, productId, kg.id));
    expect(
      await app(suite.admin, tenantId, (tx) => readProductUnitId(tx, tenantId, productId)),
    ).toBe(kg.id);
  } finally {
    await suite.admin.execute(sql`drop publication if exists test_product_units_updates`);
  }
});

async function blocked(pid: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await suite.admin.execute<{ blocked: boolean }>(
            sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`,
          )
        ).rows[0]!.blocked,
      { timeout: 5000 },
    )
    .toBe(true);
}

it("grants app_user the exact unit-table operations and enforces them as a non-superuser", async () => {
  const tenantId = await seedTenant(suite.admin);
  await app(suite.admin, tenantId, async (tx) => {
    const role = await tx.execute<{ role: string; superuser: boolean }>(sql`
      select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`);
    expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
    const grants = await tx.execute<{ table_name: string; privileges: string }>(sql`
      select relname as table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from pg_class cross join lateral aclexplode(relacl)
      where relname in ('units', 'unit_seed_states', 'product_units')
        and grantee = 'app_user'::regrole
      group by relname order by relname`);
    expect(grants.rows).toEqual([
      { table_name: "product_units", privileges: "DELETE,INSERT,SELECT,UPDATE" },
      { table_name: "unit_seed_states", privileges: "DELETE,INSERT,SELECT,UPDATE" },
      { table_name: "units", privileges: "DELETE,INSERT,SELECT,UPDATE" },
    ]);

    const unit = await createUnit(tx, tenantId, { name: { en: "portion" }, precision: 2 }, "en");
    await updateUnit(tx, tenantId, unit.id, { precision: 1 }, "en");
    expect(await getUnit(tx, tenantId, unit.id)).toMatchObject({ precision: 1 });
    await deleteUnit(tx, tenantId, unit.id);
  });
});

it("rolls back unit creation and editing with the caller's transaction", async () => {
  const tenantId = await seedTenant(suite.admin);
  await expect(
    app(suite.admin, tenantId, async (tx) => {
      await createUnit(tx, tenantId, { name: { en: "crate" }, precision: 0 }, "en");
      throw new Error("rollback create");
    }),
  ).rejects.toThrow("rollback create");
  expect(await app(suite.admin, tenantId, (tx) => listUnits(tx, tenantId))).toEqual([]);

  const unit = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "box" }, precision: 0 }, "en"),
  );
  await expect(
    app(suite.admin, tenantId, async (tx) => {
      await updateUnit(tx, tenantId, unit.id, { name: { en: "carton" } }, "en");
      throw new Error("rollback edit");
    }),
  ).rejects.toThrow("rollback edit");
  expect(await app(suite.admin, tenantId, (tx) => getUnit(tx, tenantId, unit.id))).toMatchObject({
    name: { en: "box" },
  });
});

it("serializes assignment against deletion so the committed product reference wins", async () => {
  const tenantId = await seedTenant(suite.admin);
  const productId = await product(tenantId);
  const unit = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "portion" }, precision: 0 }, "en"),
  );
  const [assigningDb, deletingDb] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let assigned!: () => void;
  const ready = new Promise<void>((resolve) => {
    assigned = resolve;
  });
  try {
    const deletingPid = (
      await deletingDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
    ).rows[0]!.pid;
    const assignment = app(assigningDb, tenantId, async (tx) => {
      await assignProductUnit(tx, tenantId, productId, unit.id);
      assigned();
      await wait;
    });
    await ready;
    const deletion = app(deletingDb, tenantId, (tx) => deleteUnit(tx, tenantId, unit.id));
    const settled = Promise.allSettled([assignment, deletion]);
    try {
      await blocked(deletingPid);
    } finally {
      release();
    }
    const [assignedResult, deletedResult] = await settled;
    expect(assignedResult.status).toBe("fulfilled");
    expect(deletedResult.status).toBe("rejected");
    if (deletedResult.status === "rejected") {
      expect(deletedResult.reason).toMatchObject({ code: "unit.in_use" });
    }
    await expect(
      app(suite.admin, tenantId, (tx) => getUnit(tx, tenantId, unit.id)),
    ).resolves.toBeDefined();
  } finally {
    release();
    await Promise.all([assigningDb.close(), deletingDb.close()]);
  }
});

it("reports unit.not_found when deletion commits before a concurrent assignment", async () => {
  const tenantId = await seedTenant(suite.admin);
  const productId = await product(tenantId);
  const unit = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "portion" }, precision: 0 }, "en"),
  );
  const [deletingDb, assigningDb] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let deleted!: () => void;
  const ready = new Promise<void>((resolve) => {
    deleted = resolve;
  });
  try {
    const assigningPid = (
      await assigningDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
    ).rows[0]!.pid;
    const deletion = app(deletingDb, tenantId, async (tx) => {
      await deleteUnit(tx, tenantId, unit.id);
      deleted();
      await wait;
    });
    await ready;
    const assignment = app(assigningDb, tenantId, (tx) =>
      assignProductUnit(tx, tenantId, productId, unit.id),
    );
    const settled = Promise.allSettled([deletion, assignment]);
    try {
      await blocked(assigningPid);
    } finally {
      release();
    }
    const [deletedResult, assignedResult] = await settled;
    expect(deletedResult.status).toBe("fulfilled");
    expect(assignedResult.status).toBe("rejected");
    if (assignedResult.status === "rejected") {
      expect(assignedResult.reason).toMatchObject({ code: "unit.not_found" });
    }
    const assignments = await suite.admin.execute<{ count: string }>(sql`
      select count(*)::text as count from product_units
      where tenant_id = ${tenantId} and product_id = ${productId}`);
    expect(assignments.rows).toEqual([{ count: "0" }]);
  } finally {
    release();
    await Promise.all([deletingDb.close(), assigningDb.close()]);
  }
});
