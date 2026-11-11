import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { nodeMode, nodePairLink, nodeSigningKey } from "./schema/index.js";

const NODE_TABLES = [
  "node_handover_events",
  "node_handover_operations",
  "node_handover_restriction",
  "node_mirror_link",
  "node_mode",
  "node_pair_link",
  "node_primary_key",
  "node_recovery_key",
  "node_signing_key",
];

describe("node.db's tables", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  it("creates its tables in node.db and none in venue.db", () => {
    expect(migratedTableNames(suite.node)).toEqual(NODE_TABLES);
    expect(migratedTableNames(suite.db).filter((name) => NODE_TABLES.includes(name))).toEqual([]);
  });

  it("refuses a mode row that is a mirror holding the singleton duties", () => {
    expect(() =>
      suite.node
        .insert(nodeMode)
        .values({ nodeId: "node-a", mode: "mirror", singletonRole: "primary" })
        .run(),
    ).toThrow(/node_mode_role_valid_ck/);
    suite.node
      .insert(nodeMode)
      .values({ nodeId: "node-a", mode: "mirror", singletonRole: "secondary" })
      .run();
    expect(suite.node.all(sql`select node_id from node_mode`)).toEqual([{ node_id: "node-a" }]);
  });

  it("refuses a signing key whose iv is not 12 bytes", () => {
    const row = {
      nodeId: "node-a",
      ciphertext: new Uint8Array([1, 2, 3]),
      authTag: new Uint8Array(16),
      keyVersion: 1,
    };
    expect(() =>
      suite.node
        .insert(nodeSigningKey)
        .values({ ...row, iv: new Uint8Array(11) })
        .run(),
    ).toThrow(/node_signing_key_iv_len_ck/);
    suite.node
      .insert(nodeSigningKey)
      .values({ ...row, iv: new Uint8Array(12) })
      .run();
    expect(suite.node.all(sql`select node_id from node_signing_key`)).toEqual([
      { node_id: "node-a" },
    ]);
  });

  it("creates node_pair_link in node.db and not in venue.db", () => {
    expect(migratedTableNames(suite.node)).toContain("node_pair_link");
    expect(migratedTableNames(suite.db)).not.toContain("node_pair_link");
  });

  it("refuses a state that does not belong to its role", () => {
    const row = {
      nodeId: "node-a",
      peerNodeId: "node-b",
      peerPublicKey: "peer-key",
      storeUrl: "https://spare.example:7443",
      venueId: "venue-a",
      accessKeyId: "waitron0123456789abcdef",
      secretCiphertext: new Uint8Array([1, 2, 3]),
      secretIv: new Uint8Array(12),
      secretAuthTag: new Uint8Array(16),
      keyVersion: 1,
      ringVersion: 1,
    };
    expect(() =>
      suite.node
        .insert(nodePairLink)
        .values({ ...row, role: "streams", state: "awaiting_copy" })
        .run(),
    ).toThrow(/node_pair_link_state_ck/);
    expect(() =>
      suite.node
        .insert(nodePairLink)
        .values({ ...row, role: "serves", state: "streaming" })
        .run(),
    ).toThrow(/node_pair_link_state_ck/);
    suite.node
      .insert(nodePairLink)
      .values({ ...row, role: "serves", state: "copied" })
      .run();
    expect(suite.node.all(sql`select node_id, role, state from node_pair_link`)).toEqual([
      { node_id: "node-a", role: "serves", state: "copied" },
    ]);
  });
});
