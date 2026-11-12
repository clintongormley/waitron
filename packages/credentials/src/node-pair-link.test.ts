import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withNodeTransaction } from "@waitron/db";
import { NODE_MIGRATIONS, readPairLink } from "@waitron/node-db";
import { hasCode } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "./keyring.js";
import {
  deleteNodePairLinkOtherThanTx,
  deletePairLinkTx,
  holdsPairLink,
  readPairSecret,
  setPairLinkStateTx,
  writePairLinkTx,
  type NewPairLink,
} from "./node-pair-link.js";
import { captured } from "./testing/captured.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PEER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ANOTHER_PEER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SECRET = "0f".repeat(32);

const RING_V1 = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const RING_V2 = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 2).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});
const ANOTHER_RING_V1 = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const LINK: NewPairLink = {
  role: "streams",
  state: "pending",
  peerNodeId: PEER,
  peerPublicKey: "peer-public-key",
  storeUrl: "https://spare.example:7443",
  venueId: "venue-a",
  accessKeyId: "waitron0123456789abcdef",
  secretAccessKey: SECRET,
};

describe("the pair link in node.db", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  beforeEach(() => {
    suite.node.run(sql`delete from node_pair_link`);
  });

  function write(nodeId: string, link: NewPairLink = LINK, ring = RING_V1) {
    return withNodeTransaction(suite.node, (tx) => writePairLinkTx(tx, ring, nodeId, link));
  }

  it("seals the pair's secret so it opens only under this ring and these two node ids", async () => {
    await write(NODE);
    expect(await readPairSecret(suite.node, RING_V1, NODE)).toBe(SECRET);
    const stored = suite.node.all<{ secret_ciphertext: Uint8Array }>(
      sql`select secret_ciphertext from node_pair_link`,
    );
    expect(Buffer.from(stored[0]!.secret_ciphertext).toString("utf8")).not.toContain(SECRET);

    const otherRing = await captured(() => readPairSecret(suite.node, ANOTHER_RING_V1, NODE));
    expect(hasCode(otherRing, "credentials.decrypt_failed")).toBe(true);
    expect(otherRing.params).toEqual({ purpose: "node.pair_secret" });

    suite.node.run(sql`update node_pair_link set peer_node_id = ${ANOTHER_PEER}`);
    const otherPeer = await captured(() => readPairSecret(suite.node, RING_V1, NODE));
    expect(hasCode(otherPeer, "credentials.decrypt_failed")).toBe(true);

    suite.node.run(sql`update node_pair_link set peer_node_id = ${PEER}, node_id = ${OTHER}`);
    const otherNode = await captured(() => readPairSecret(suite.node, RING_V1, OTHER));
    expect(hasCode(otherNode, "credentials.decrypt_failed")).toBe(true);
  });

  it("refuses a read when the ring lacks the key the secret was sealed under", async () => {
    await write(NODE, LINK, RING_V2);
    const error = await captured(() => readPairSecret(suite.node, RING_V1, NODE));
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
    expect(error.params).toEqual({ purpose: "node.pair_secret", keyVersion: 2 });
  });

  it("refuses a secret read for a node with no link", async () => {
    await write(OTHER);
    const error = await captured(() => readPairSecret(suite.node, RING_V1, NODE));
    expect(hasCode(error, "credentials.missing")).toBe(true);
    expect(error.params).toEqual({ purpose: "node.pair_secret" });
  });

  it("records the ring's version and keeps the link readable without its secret", async () => {
    await write(NODE, LINK, RING_V2);
    expect(await readPairLink(suite.node, NODE)).toMatchObject({
      role: "streams",
      state: "pending",
      peerNodeId: PEER,
      storeUrl: "https://spare.example:7443",
      ringVersion: 2,
    });
    expect(suite.node.all(sql`select key_version, ring_version from node_pair_link`)).toEqual([
      { key_version: 2, ring_version: 2 },
    ]);
  });

  it("replaces this node's link on a second write, with a fresh start time", async () => {
    await write(NODE);
    suite.node.run(
      sql`update node_pair_link set created_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z'`,
    );
    await write(NODE, {
      ...LINK,
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: ANOTHER_PEER,
      secretAccessKey: "second-secret",
    });
    expect(await readPairSecret(suite.node, RING_V1, NODE)).toBe("second-secret");
    expect(
      suite.node.all(
        sql`select node_id, role, state, peer_node_id, created_at, updated_at from node_pair_link`,
      ),
    ).toEqual([
      expect.objectContaining({
        node_id: NODE,
        role: "serves",
        state: "awaiting_copy",
        peer_node_id: ANOTHER_PEER,
      }),
    ]);
    const [row] = suite.node.all<{ created_at: string; updated_at: string }>(
      sql`select created_at, updated_at from node_pair_link`,
    );
    expect(row!.created_at).not.toBe("2000-01-01T00:00:00.000Z");
    expect(row!.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("moves this node's link to another state, and leaves another node's alone", async () => {
    await write(NODE);
    await write(OTHER);
    suite.node.run(sql`update node_pair_link set updated_at = '2000-01-01T00:00:00.000Z'`);
    await withNodeTransaction(suite.node, (tx) => setPairLinkStateTx(tx, NODE, "streaming"));
    expect(suite.node.all(sql`select node_id, state from node_pair_link order by node_id`)).toEqual(
      [
        { node_id: NODE, state: "streaming" },
        { node_id: OTHER, state: "pending" },
      ],
    );
    expect(
      suite.node.all(
        sql`select node_id from node_pair_link where updated_at <> '2000-01-01T00:00:00.000Z'`,
      ),
    ).toEqual([{ node_id: NODE }]);
    expect(await readPairSecret(suite.node, RING_V1, NODE)).toBe(SECRET);
  });

  it("deletes this node's link, and leaves another node's alone", async () => {
    await write(NODE);
    await write(OTHER);
    await withNodeTransaction(suite.node, (tx) => deletePairLinkTx(tx, NODE));
    expect(suite.node.all(sql`select node_id from node_pair_link`)).toEqual([{ node_id: OTHER }]);
  });

  it("deletes every row but this node id's, and keeps this one's", async () => {
    await write(NODE);
    await write(OTHER);
    await write(PEER);
    await withNodeTransaction(suite.node, (tx) => deleteNodePairLinkOtherThanTx(tx, NODE));
    expect(suite.node.all(sql`select node_id from node_pair_link`)).toEqual([{ node_id: NODE }]);
  });

  it("holds a pair link whichever node id it is under", async () => {
    expect(await holdsPairLink(suite.node)).toBe(false);
    await write(OTHER);
    expect(await holdsPairLink(suite.node)).toBe(true);
  });
});

describe("before the node set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("holds no pair link when node.db has no pair-link table", async () => {
    expect(await holdsPairLink(bare.node)).toBe(false);
  });
});
