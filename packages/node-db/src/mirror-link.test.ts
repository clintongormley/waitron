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
import {
  readMirrorLink,
  writeMirrorLink,
  writeMirrorLinkTx,
} from "./mirror-link.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// A fixed v4 UUID standing in for the primary's nodeId (the mirror's sync origin).
const PRIMARY_NODE = "11111111-1111-4111-8111-111111111111";

const SAMPLE: Parameters<typeof writeMirrorLink>[2] = {
  originUrl: "https://relay.test:9000/",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n",
  originNodeId: PRIMARY_NODE,
};

// A node file with NO migration set applied, so `node_mirror_link` does not exist.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("is refused rather than read as unadopted", async () => {
    await expect(readMirrorLink(bare.node, NODE)).rejects.toThrow(
      /no such table: box/,
    );
  });
});

describe("box accessors", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
  });

  it("reads null before any write (a box nothing has adopted)", async () => {
    expect(await readMirrorLink(suite.node, NODE)).toBeNull();
  });

  it("upserts this node's row and reads it back", async () => {
    await writeMirrorLink(suite.node, NODE, SAMPLE);
    expect(await readMirrorLink(suite.node, NODE)).toEqual(SAMPLE);
  });

  it("writes into node.db", async () => {
    await writeMirrorLink(suite.node, NODE, SAMPLE);
    expect(suite.node.all(sql`select node_id from box`)).toEqual([{ node_id: NODE }]);
  });

  it("reads a mirror link only for the node that was adopted", async () => {
    await writeMirrorLink(suite.node, NODE, SAMPLE);
    expect(await readMirrorLink(suite.node, NODE)).toEqual(SAMPLE);
    expect(await readMirrorLink(suite.node, OTHER)).toBeNull();
  });

  it("round-trips originNodeId (the mirror's sync origin) through write/read", async () => {
    await writeMirrorLink(suite.node, NODE, SAMPLE);
    const back = await readMirrorLink(suite.node, NODE);
    expect(back?.originNodeId).toBe(PRIMARY_NODE);
  });

  it("writes on a caller's node transaction, and reads inside it", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await writeMirrorLinkTx(tx, NODE, SAMPLE);
      expect(await readMirrorLink(tx, NODE)).toEqual(SAMPLE);
    });
    expect(await readMirrorLink(suite.node, NODE)).toEqual(SAMPLE);
  });

  it("a second write for the same node updates its row in place", async () => {
    await writeMirrorLink(suite.node, NODE, {
      originUrl: "https://relay-one.test:9000/",
      boxHostname: "a",
      boxCaPem: "a",
      originNodeId: PRIMARY_NODE,
    });
    const [first] = suite.node.all<{ adopted_at: string }>(
      sql`select mirror_adopted_at as adopted_at from box`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeMirrorLink(suite.node, NODE, {
      originUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
    const count = await suite.node.execute<{ n: number }>(
      sql`select count(*) as n from box`,
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(await readMirrorLink(suite.node, NODE)).toEqual({
      originUrl: "https://relay-two.test:9000/",
      boxHostname: "b",
      boxCaPem: "b",
      originNodeId: PRIMARY_NODE,
    });
    const [second] = suite.node.all<{ adopted_at: string }>(
      sql`select mirror_adopted_at as adopted_at from box`,
    );
    expect(second?.adopted_at > first!.adopted_at).toBe(true);
  });

  it("permits at most one row per node — the primary key refuses a second", async () => {
    // `adopted_at` is stated because it is a `$defaultFn` column Drizzle fills CLIENT-side: a raw
    // insert would otherwise be refused NOT NULL rather than by the key.
    await writeMirrorLink(suite.node, NODE, SAMPLE);
    const error = await captureError(() =>
      Promise.resolve(
        suite.node.run(
          sql`insert into box (node_id, mirror_origin_url, mirror_box_hostname, mirror_box_ca_pem, mirror_origin_node_id, mirror_adopted_at) values (${NODE}, 'x', 'x', 'x', ${PRIMARY_NODE}, ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });
});
