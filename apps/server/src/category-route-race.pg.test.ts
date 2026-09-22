/**
 * RED ON THIS BRANCH, AND NOT BY OVERSIGHT — the lock wait this case stages is not expressible on
 * this engine, and the harness it needs is gone.
 *
 * WHAT WENT. The subject is a WAIT: a category delete must block behind an uncommitted route
 * attachment on another connection, then cascade the route away once that commits. Staging it needs
 * two write transactions interleaved mid-flight, which is the one thing this engine does not admit
 * — `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write
 * queue, and the queue admits ONE write transaction on the file at a time, so the second does not
 * begin until the first has committed (the mechanism and its control are on
 * `assertExtraListForWrite`, `packages/catalogue/src/extras.ts`). `pg_backend_pid()` and
 * `pg_blocking_pids()` below have no counterpart here either: nothing in SQLite reports which
 * connection another is waiting on.
 *
 * WHAT STILL HAS TO HOLD: deleting a category must take its `preparation_routes` rows with it, and
 * an attachment committed first must not survive the delete. That half is engine-independent; what
 * cannot be re-staged is the concurrent one.
 *
 * WHAT IT REPORTS TODAY. It does not COLLECT: `useTemplateDb` throws `useTemplateDb: no shared
 * container in scope. Wire the package's vitest globalSetup to a file that calls
 * `startSharedContainer` and `provide("sharedPg", handle).` — the real-PostgreSQL harness this
 * branch removed. Measured 2026-09-22 on `npx vitest run src/category-route-race.pg.test.ts` in
 * `apps/server`, which reports `1 test | 1 skipped` and then fails the FILE. No assertion below has
 * run on this branch; the SQL it writes is converted anyway so nothing has to be untangled twice.
 */
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createCategory, deleteCategory } from "@waitron/catalogue";
import {
  asAppUser,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { preparationRoutes } from "@waitron/venue-service";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { LocationId } from "@waitron/shared";

const suite = useTemplateDb({ template: "manifest" });

function app<T>(db: Database, action: (tx: Transaction) => Promise<T>): Promise<T> {
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
  await seedTenant(suite.admin);
  // Through the table definition, as `apps/server/src/testing/fiscal-fixtures.ts` is:
  // `locations.id` is a `$defaultFn` generator a raw insert never reaches, and `invoice_locales` is
  // a JSON array in a text column rather than a PostgreSQL `text[]`.
  const [location] = await suite.admin
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  const locationId = location!.id as LocationId;
  const category = await app(suite.admin, (tx) => createCategory(tx, { name: { en: "Drinks" } }));
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
    const adding = app(attach, async (tx) => {
      // `no_preparation` is an integer column here, so a JavaScript boolean cannot bind in a raw
      // template; the table definition is what maps it.
      const [route] = await tx
        .insert(preparationRoutes)
        .values({ locationId, categoryId: category.id, noPreparation: true })
        .returning({ id: preparationRoutes.id });
      ready();
      await wait;
      return route!.id;
    });
    void adding.catch(() => ready());
    await attached;
    const deleting = app(remove, (tx) => deleteCategory(tx, category.id));
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
      select id from categories where id = ${category.id}
    `);
    expect(remaining.rows).toEqual([]);
  } finally {
    release();
    await settled;
    await Promise.all([attach.close(), remove.close()]);
  }
});
