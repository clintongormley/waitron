import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { lockVenueDatabase, openVenueDatabase, type VenueDatabase } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { runMigrations } from "./migrate.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";

/**
 * `packages/store`'s own suite covers the engine settings, the two file names, creating the
 * directory, closing, and the folder lock. This file covers what `client.ts` decides: both files are
 * opened on the SAME schema barrel, and a folder another process holds is reported as
 * `provisioning.database_in_use`.
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

/** Holds `<directory>/venue.lock` from another process until killed, as a running server does. */
async function holdFromAnotherProcess(directory: string): Promise<ChildProcess> {
  const script = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("pragma busy_timeout = 0");
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => {}, 1000);`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, join(directory, "venue.lock")],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (chunk: Buffer) => chunk.toString().includes("held") && resolve());
    child.on("exit", (code) => reject(new Error(`holder exited early (${code})`)));
  });
  return child;
}

describe("a venue folder another process holds", () => {
  it("is refused as provisioning.database_in_use, naming the folder, by both entry points", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-db-in-use-"));
    directories.push(directory);
    const holder = await holdFromAnotherProcess(directory);
    try {
      for (const attempt of [
        () => openVenueDatabase(directory),
        () => lockVenueDatabase(directory),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: "provisioning.database_in_use",
          params: { database: directory },
        });
      }
    } finally {
      holder.kill("SIGKILL");
    }
  }, 20_000);

  it("passes every other refusal through untouched", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-db-not-a-db-"));
    directories.push(directory);
    writeFileSync(join(directory, "venue.db"), "these bytes are not a database".repeat(100));
    await expect(openVenueDatabase(directory)).rejects.toThrow("file is not a database");
  });

  it("opens beside a holder when asked for no lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-db-beside-"));
    directories.push(directory);
    const holder = await holdFromAnotherProcess(directory);
    try {
      const store = await openVenueDatabase(directory, { exclusive: false });
      opened.push(store);
      expect(store.venue.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
    } finally {
      holder.kill("SIGKILL");
    }
  }, 20_000);
});
