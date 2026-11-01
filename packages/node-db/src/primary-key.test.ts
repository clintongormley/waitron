import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  isRefusal,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { pinPrimaryKeyTx, readPinnedPrimaryKey } from "./primary-key.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRIMARY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NEXT_PRIMARY = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// A node file with NO migration set applied, so `node_primary_key` does not exist.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads null when the table itself is absent", async () => {
    expect(await readPinnedPrimaryKey(bare.node, NODE)).toBeNull();
  });
});

describe("the main box's pinned public key", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
  });

  it("reads null before anything is pinned", async () => {
    expect(await readPinnedPrimaryKey(suite.node, NODE)).toBeNull();
  });

  it("round-trips the key pinned on a caller's node transaction", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await pinPrimaryKeyTx(tx, NODE, { primaryNodeId: PRIMARY, publicKey: "PUB-1" });
      expect(await readPinnedPrimaryKey(tx, NODE)).toEqual({
        primaryNodeId: PRIMARY,
        publicKey: "PUB-1",
      });
    });
    expect(await readPinnedPrimaryKey(suite.node, NODE)).toEqual({
      primaryNodeId: PRIMARY,
      publicKey: "PUB-1",
    });
    expect(suite.node.all(sql`select node_id from node_primary_key`)).toEqual([{ node_id: NODE }]);
  });

  it("reads a pinned key only for the node that pinned it", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      pinPrimaryKeyTx(tx, NODE, { primaryNodeId: PRIMARY, publicKey: "PUB-1" }),
    );
    expect(await readPinnedPrimaryKey(suite.node, OTHER)).toBeNull();
  });

  it("a second pin for the same node replaces the main box and key in place", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      pinPrimaryKeyTx(tx, NODE, { primaryNodeId: PRIMARY, publicKey: "PUB-1" }),
    );
    const [first] = suite.node.all<{ pinned_at: string }>(
      sql`select pinned_at from node_primary_key`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await withNodeTransaction(suite.node, (tx) =>
      pinPrimaryKeyTx(tx, NODE, { primaryNodeId: NEXT_PRIMARY, publicKey: "PUB-2" }),
    );
    expect(suite.node.all(sql`select count(*) as n from node_primary_key`)).toEqual([{ n: 1 }]);
    expect(await readPinnedPrimaryKey(suite.node, NODE)).toEqual({
      primaryNodeId: NEXT_PRIMARY,
      publicKey: "PUB-2",
    });
    const [second] = suite.node.all<{ pinned_at: string }>(
      sql`select pinned_at from node_primary_key`,
    );
    expect(second!.pinned_at > first!.pinned_at).toBe(true);
  });

  it("permits at most one row per node — the primary key refuses a second", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      pinPrimaryKeyTx(tx, NODE, { primaryNodeId: PRIMARY, publicKey: "PUB-1" }),
    );
    const error = await captureError(() =>
      Promise.resolve(
        suite.node.run(
          sql`insert into node_primary_key (node_id, primary_node_id, public_key, pinned_at) values (${NODE}, ${PRIMARY}, 'x', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });
});
