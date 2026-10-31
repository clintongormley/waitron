import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type VenueDatabase } from "./client.js";
import { tableExists } from "./table-exists.js";
import { withNodeTransaction, withTransaction } from "./tenancy.js";

/**
 * A bare pair of files per case, built here rather than through `useVenueDb`: what is under test is
 * the transaction helper on the node file, which carries no migration set and no `change_log`.
 */
const opened: { store: VenueDatabase; directory: string }[] = [];

const open = async (): Promise<VenueDatabase> => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-tenancy-node-"));
  const store = await openVenueDatabase(directory);
  opened.push({ store, directory });
  store.node.run(sql`create table probe_node (id text primary key)`);
  return store;
};

afterEach(async () => {
  while (opened.length > 0) {
    const { store, directory } = opened.pop()!;
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

describe("withNodeTransaction", () => {
  it("withNodeTransaction commits on the node file and needs no change log", async () => {
    const store = await open();

    await withNodeTransaction(store.node, (tx) => {
      tx.run(sql`insert into probe_node (id) values ('a')`);
    });

    expect(store.node.all<{ id: string }>(sql`select id from probe_node`)).toEqual([{ id: "a" }]);
    expect(await tableExists(store.node, "change_log")).toBe(false);
    expect(await tableExists(store.venue, "probe_node")).toBe(false);
  });

  it("a body that throws commits nothing", async () => {
    const store = await open();

    await expect(
      withNodeTransaction(store.node, (tx) => {
        tx.run(sql`insert into probe_node (id) values ('a')`);
        throw new Error("body failed");
      }),
    ).rejects.toThrow("body failed");

    expect(store.node.all(sql`select id from probe_node`)).toEqual([]);
  });

  it("withTransaction refuses the node handle", async () => {
    const store = await open();

    await expect(
      // @ts-expect-error a node handle is not a venue handle
      withTransaction(store.node, () => undefined),
    ).rejects.toThrow(/change_log/);
  });
});
