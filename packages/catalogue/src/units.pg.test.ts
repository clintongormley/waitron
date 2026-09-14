import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignProductUnit,
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  readProductUnitId,
  reassignProductsToUnit,
  updateUnit,
} from "./units.js";

const suite = useTemplateDb({ template: "core" });

function app<T>(
  db: Database,
  tenantId: string,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  void tenantId;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}

/** `id` is supplied only where a test needs the rows' physical and key order to be predictable. */
async function product(tenantId: string, id: string | null = null): Promise<string> {
  const menu = await suite.admin.execute<{ id: string }>(sql`
    insert into catalogues (tenant_id, name) values (${tenantId}, 'Menu') returning id`);
  return (
    await suite.admin.execute<{ id: string }>(sql`
      insert into products (id, tenant_id, catalogue_id, name, pricing_unit, unit_price, vat_class)
      values (coalesce(${id}::uuid, gen_random_uuid()), ${tenantId}, ${menu.rows[0]!.id}, 'Soup', 'each', 1, 'general')
      returning id`)
  ).rows[0]!.id;
}

it("changes a product's unit even while product_units publishes updates for replication", async () => {
  const tenantId = await seedTenant(suite.admin);
  const productId = await product(tenantId);
  const each = await app(suite.admin, tenantId, (tx) =>
    createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
  );
  const kg = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
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

    const unit = await createUnit(
      tx,
      tenantId,
      { name: { en: "portion" }, precision: 2, abbreviation: { en: "u" } },
      "en",
    );
    await updateUnit(tx, tenantId, unit.id, { precision: 1 }, "en");
    expect(await getUnit(tx, tenantId, unit.id)).toMatchObject({ precision: 1 });
    await deleteUnit(tx, tenantId, unit.id);
  });
});

it("rolls back unit creation and editing with the caller's transaction", async () => {
  const tenantId = await seedTenant(suite.admin);
  await expect(
    app(suite.admin, tenantId, async (tx) => {
      await createUnit(
        tx,
        tenantId,
        { name: { en: "crate" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      throw new Error("rollback create");
    }),
  ).rejects.toThrow("rollback create");
  expect(await app(suite.admin, tenantId, (tx) => listUnits(tx, tenantId))).toEqual([]);

  const unit = await app(suite.admin, tenantId, (tx) =>
    createUnit(
      tx,
      tenantId,
      { name: { en: "box" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
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
    createUnit(
      tx,
      tenantId,
      { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
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
    createUnit(
      tx,
      tenantId,
      { name: { en: "portion" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
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

// The contract: a bulk reassignment moves only the products STILL on the source unit when it
// writes, so a selection made stale by another manager's move is skipped, never overwritten.
it("skips a product another manager moved off the source unit while the selection was stale", async () => {
  const tenantId = await seedTenant(suite.admin);
  const productId = await product(tenantId);
  const [source, other, target] = await app(suite.admin, tenantId, async (tx) => [
    await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
    await createUnit(
      tx,
      tenantId,
      { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } },
      "en",
    ),
    await createUnit(
      tx,
      tenantId,
      { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } },
      "en",
    ),
  ]);
  await app(suite.admin, tenantId, (tx) => assignProductUnit(tx, tenantId, productId, source!.id));

  const [staleDb, moverDb] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  try {
    const stale = app(staleDb, tenantId, async (tx) => {
      await getUnit(tx, tenantId, source!.id);
      opened();
      await wait;
      await reassignProductsToUnit(tx, tenantId, source!.id, [productId], target!.id);
    });
    await ready;
    await app(moverDb, tenantId, (tx) => assignProductUnit(tx, tenantId, productId, other!.id));
    release();
    await stale;
    expect(
      await app(suite.admin, tenantId, (tx) => readProductUnitId(tx, tenantId, productId)),
    ).toBe(other!.id);
  } finally {
    release();
    await Promise.all([staleDb.close(), moverDb.close()]);
  }
});

it("does not deadlock when two bulk reassignments list the same products in opposite orders", async () => {
  const tenantId = await seedTenant(suite.admin);
  // Fixed ids, inserted in this order, so the row reached first is the same under a sequential scan
  // (insertion order) and under an index scan (uuid order) — the lock order has to be predictable
  // for this test to prove anything.
  const first = await product(tenantId, "11111111-1111-4111-8111-111111111111");
  const second = await product(tenantId, "22222222-2222-4222-8222-222222222222");
  const [source, target] = await app(suite.admin, tenantId, async (tx) => [
    await createUnit(
      tx,
      tenantId,
      { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
      "en",
    ),
    await createUnit(
      tx,
      tenantId,
      { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } },
      "en",
    ),
  ]);
  await app(suite.admin, tenantId, async (tx) => {
    await assignProductUnit(tx, tenantId, first, source!.id);
    await assignProductUnit(tx, tenantId, second, source!.id);
  });

  const [aheadDb, behindDb] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding!: () => void;
  const ready = new Promise<void>((resolve) => {
    holding = resolve;
  });
  try {
    const behindPid = (await behindDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const ahead = app(aheadDb, tenantId, async (tx) => {
      // Stands in for a manager whose reassignment already holds the first product's row.
      await tx.execute(sql`select 1 from product_units
        where tenant_id = ${tenantId} and product_id = ${first} for update`);
      holding();
      await wait;
      await reassignProductsToUnit(tx, tenantId, source!.id, [first, second], target!.id);
    });
    await ready;
    const behind = app(behindDb, tenantId, (tx) =>
      reassignProductsToUnit(tx, tenantId, source!.id, [second, first], target!.id),
    );
    const settled = Promise.allSettled([ahead, behind]);
    try {
      await blocked(behindPid);
    } finally {
      release();
    }
    const results = await settled;
    // Names the SQLSTATE so a failure reads as the deadlock (40P01) it is, not "a query failed".
    expect(
      results.map((r) =>
        r.status === "fulfilled"
          ? "ok"
          : `sqlstate ${(r.reason as { cause?: { code?: string } }).cause?.code ?? "none"}`,
      ),
    ).toEqual(["ok", "ok"]);
    const assignments = await suite.admin.execute<{ product_id: string; unit_id: string }>(sql`
      select product_id, unit_id from product_units
      where tenant_id = ${tenantId} order by product_id`);
    expect(assignments.rows).toEqual([
      { product_id: first, unit_id: target!.id },
      { product_id: second, unit_id: target!.id },
    ]);
  } finally {
    release();
    await Promise.all([aheadDb.close(), behindDb.close()]);
  }
});

it("reassigning to null clears the products' unit (they become Each)", async () => {
  const tenantId = await seedTenant(suite.admin);
  const p1 = await product(tenantId);
  const p2 = await product(tenantId);
  const sourceUnit = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  await app(suite.admin, tenantId, async (tx) => {
    await assignProductUnit(tx, tenantId, p1, sourceUnit.id);
    await assignProductUnit(tx, tenantId, p2, sourceUnit.id);
  });

  await app(suite.admin, tenantId, (tx) =>
    reassignProductsToUnit(tx, tenantId, sourceUnit.id, [p1, p2], null),
  );

  expect(
    await app(suite.admin, tenantId, (tx) => productsUsingUnit(tx, tenantId, sourceUnit.id)),
  ).toHaveLength(0);
  expect(await app(suite.admin, tenantId, (tx) => readProductUnitId(tx, tenantId, p1))).toBeNull();
});

it("reassigning to null returns the products to each-priced and leaves products on other units alone", async () => {
  const tenantId = await seedTenant(suite.admin);
  const onSource = await product(tenantId);
  const onOther = await product(tenantId);
  const sourceUnit = await app(suite.admin, tenantId, (tx) =>
    createUnit(tx, tenantId, { name: { en: "kg" }, precision: 3, abbreviation: { en: "u" } }, "en"),
  );
  const otherUnit = await app(suite.admin, tenantId, (tx) =>
    createUnit(
      tx,
      tenantId,
      { name: { en: "litre" }, precision: 2, abbreviation: { en: "u" } },
      "en",
    ),
  );
  // Put both products in the real "sold by weight" state: a unit row plus pricing_unit = 'weight'.
  await app(suite.admin, tenantId, async (tx) => {
    await assignProductUnit(tx, tenantId, onSource, sourceUnit.id);
    await assignProductUnit(tx, tenantId, onOther, otherUnit.id);
  });
  await suite.admin.execute(sql`
    update products set pricing_unit = 'weight'
    where tenant_id = ${tenantId} and id in (${onSource}, ${onOther})`);

  // onOther is in the list but on a different unit, so it stands in for a product already moved
  // elsewhere: scoped by the source unit, it must be skipped by both the delete and the update.
  await app(suite.admin, tenantId, (tx) =>
    reassignProductsToUnit(tx, tenantId, sourceUnit.id, [onSource, onOther], null),
  );

  const pricing = await suite.admin.execute<{ id: string; pricing_unit: string }>(sql`
    select id, pricing_unit from products
    where tenant_id = ${tenantId} and id in (${onSource}, ${onOther})`);
  const pricingById = Object.fromEntries(pricing.rows.map((r) => [r.id, r.pricing_unit]));
  // The reassigned product loses its unit row AND returns to each-priced (the no-unit ⟺ each invariant).
  expect(
    await app(suite.admin, tenantId, (tx) => readProductUnitId(tx, tenantId, onSource)),
  ).toBeNull();
  expect(pricingById[onSource]).toBe("each");
  // The product on another unit keeps both its unit row and its weight pricing.
  expect(await app(suite.admin, tenantId, (tx) => readProductUnitId(tx, tenantId, onOther))).toBe(
    otherUnit.id,
  );
  expect(pricingById[onOther]).toBe("weight");
});
