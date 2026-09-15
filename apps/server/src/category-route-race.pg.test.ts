import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createCategory, deleteCategory } from "@waitron/catalogue";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";

const suite = useTemplateDb({ template: "manifest" });

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

async function blocked(pid: number) {
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

it("waits for a route attachment, then cascades the route away with the category", async () => {
  const tenantId = await seedTenant(suite.admin);
  const location = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Restaurant') returning id
  `);
  const locationId = location.rows[0]!.id as LocationId;
  const category = await app(suite.admin, tenantId, (tx) =>
    createCategory(tx, tenantId, { name: { en: "Drinks" } }),
  );
  const [attach, remove] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const attached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let settled: Promise<[PromiseSettledResult<string>, PromiseSettledResult<void>]> | undefined;

  try {
    const pid = (await remove.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const adding = app(attach, tenantId, async (tx) => {
      const route = await tx.execute<{ id: string }>(sql`
        insert into preparation_routes (location_id, category_id, no_preparation)
        values (${locationId}, ${category.id}, true) returning id
      `);
      ready();
      await wait;
      return route.rows[0]!.id;
    });
    void adding.catch(() => ready());
    await attached;
    const deleting = app(remove, tenantId, (tx) => deleteCategory(tx, category.id));
    settled = Promise.allSettled([adding, deleting]);
    try {
      await blocked(pid);
    } finally {
      release();
    }
    const [attachment, deletion] = await settled;
    expect(attachment.status).toBe("fulfilled");
    if (attachment.status !== "fulfilled") throw attachment.reason;
    // The delete serializes behind the committed route insert, then deletes the route and category.
    expect(deletion.status).toBe("fulfilled");
    const routes = await suite.admin.execute<{ id: string }>(sql`
      select id from preparation_routes
      where category_id = ${category.id}
    `);
    expect(routes.rows).toEqual([]);
    const remaining = await suite.admin.execute<{ id: string }>(sql`
      select id from categories where tenant_id = ${tenantId} and id = ${category.id}
    `);
    expect(remaining.rows).toEqual([]);
  } finally {
    release();
    await settled;
    await Promise.all([attach.close(), remove.close()]);
  }
});
