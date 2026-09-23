import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type VenueDatabase } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { runMigrations } from "./migrate.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";

/**
 * `openVenueDatabase` — the whole of this module's public surface now that the two PostgreSQL
 * constructors are gone.
 *
 * **What this file does NOT test, because `packages/store/src/index.test.ts` already does.**
 * `openVenueDatabase` is a thin call onto `openVenueStore`, and that package's own suite covers the
 * engine settings, the two file names under the directory, creating the directory, and closing.
 * What is left here is what `client.ts` itself decides, which is one thing: both files are opened
 * on the SAME schema barrel, so nothing but the FILE separates a venue table from a node one.
 *
 * **Five cases went with the two deleted constructors. What nothing checks any more:**
 *
 * - `createPgliteDb` "tags itself as the pglite driver" and `createPostgresDb` "tags itself as the
 *   postgres driver". There is no `driver` tag on a handle (`client.ts:29-31`) and `runMigrations`
 *   dispatches on nothing, so there is no tag to read and no dispatch to get wrong.
 * - `createPgliteDb` "is in-memory when no data directory is given". There is no no-argument form:
 *   `openVenueDatabase` takes a directory and always writes files. The isolation that case
 *   protected — two databases not seeing each other's tables — is now only ever tested WITHIN one
 *   store, by the first case below; nothing here checks that two SEPARATE directories are
 *   independent.
 * - `createPostgresDb` "fails fast on a connection that cannot succeed". Gone with the connection
 *   string: there is no pool and no connect-probe, and a bad DIRECTORY is a different failure
 *   nothing in this package now asserts on.
 * - `createPostgresDb` "returns a database that answers a query", "rejects a query after close" and
 *   "honours poolOptions". All three were about a server and a connection pool; neither exists.
 */
const opened: VenueDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** A fresh directory nothing else holds, and the store opened on it. */
const open = async (directory = mkdtempSync(join(tmpdir(), "waitron-client-"))) => {
  directories.push(directory);
  const store = await openVenueDatabase(directory);
  opened.push(store);
  return { directory, store };
};

describe("openVenueDatabase", () => {
  it("opens two handles, and a table on one is not visible on the other", async () => {
    const { store } = await open();

    store.venue.run(sql`create table only_on_venue (id integer primary key)`);

    expect(store.venue).not.toBe(store.node);
    // Both directions, because asserting only that the node file lacks the table would also pass
    // if the venue file had never got it either.
    expect(
      store.venue.all(sql`select name from sqlite_master where name = 'only_on_venue'`),
    ).toHaveLength(1);
    expect(
      store.node.all(sql`select name from sqlite_master where name = 'only_on_venue'`),
    ).toHaveLength(0);
  });

  it("gives both handles the whole schema barrel, and lets the file refuse the query", async () => {
    // `client.ts:47-53` says both handles are typed on the barrel on purpose, and that a query
    // naming a venue table on the node handle is refused by the ENGINE rather than by the compiler.
    // This is that sentence as an experiment: the relational map is present on both sides — so the
    // compiler is not what stops anything — and after migrating the core set to the venue file
    // alone, the same read succeeds on one handle and is refused on the other.
    const { store } = await open();
    expect(store.venue.query.tenants).toBeDefined();
    expect(store.node.query.tenants).toBeDefined();

    await runMigrations(store.venue, CORE_MIGRATIONS);

    expect(await store.venue.query.tenants.findMany()).toEqual([]);
    const refusal = await captureError(() => store.node.query.tenants.findMany());
    expect(engineErrorMessage(refusal)).toBe("no such table: tenants");
  });

  it("closes both files", async () => {
    const { store } = await open();
    await store.close();
    opened.pop();

    // The message is the engine's own, read off `node:sqlite` rather than chosen here.
    expect(engineErrorMessage(await captureError(async () => store.venue.all(sql`select 1`)))).toBe(
      "database is not open",
    );
    expect(engineErrorMessage(await captureError(async () => store.node.all(sql`select 1`)))).toBe(
      "database is not open",
    );
  });

  it("persists to its directory across close and reopen", async () => {
    // Carried over from the deleted `createPgliteDb` case of the same name: the standalone backup
    // story is "copy one directory", so a store that lost its rows on close would not be the thing
    // we ship. This is the only case in the tree that runs it: of the five `openVenueStore(` calls
    // in `packages/store/src/index.test.ts`, three belong to its contention block and none writes
    // rows, closes, and reads them back.
    const { directory, store } = await open();
    store.venue.run(sql`create table persisted (id integer primary key)`);
    store.venue.run(sql`insert into persisted (id) values (7)`);
    await store.close();
    opened.pop();

    const reopened = await openVenueDatabase(directory);
    opened.push(reopened);
    expect(reopened.venue.all(sql`select id from persisted`)).toEqual([{ id: 7 }]);
  });
});
