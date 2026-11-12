import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { readPairLink } from "./pair-link.js";
import { nodePairLink } from "./schema/index.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PEER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CREATED = new Date("2026-11-01T10:00:00.000Z");
const UPDATED = new Date("2026-11-01T10:05:00.000Z");

function row(nodeId: string, storeUrl: string) {
  return {
    nodeId,
    role: "streams" as const,
    state: "pending" as const,
    peerNodeId: PEER,
    peerPublicKey: "peer-public-key",
    storeUrl,
    venueId: "venue-a",
    accessKeyId: "waitron0123456789abcdef",
    secretCiphertext: new Uint8Array([1, 2, 3]),
    secretIv: new Uint8Array(12),
    secretAuthTag: new Uint8Array(16),
    keyVersion: 2,
    ringVersion: 3,
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
}

describe("the pair link's reader", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  it("reads null when this node has no link", async () => {
    suite.node.insert(nodePairLink).values(row(OTHER, "https://other.example:7443")).run();
    expect(await readPairLink(suite.node, NODE)).toBeNull();
  });

  it("reads this node's link, and none of its secret", async () => {
    suite.node.insert(nodePairLink).values(row(OTHER, "https://other.example:7443")).run();
    suite.node.insert(nodePairLink).values(row(NODE, "https://spare.example:7443")).run();
    expect(await readPairLink(suite.node, NODE)).toEqual({
      role: "streams",
      state: "pending",
      peerNodeId: PEER,
      peerPublicKey: "peer-public-key",
      storeUrl: "https://spare.example:7443",
      venueId: "venue-a",
      accessKeyId: "waitron0123456789abcdef",
      ringVersion: 3,
      createdAt: CREATED,
      updatedAt: UPDATED,
    });
  });
});
