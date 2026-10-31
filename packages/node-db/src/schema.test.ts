import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { nodeMode, nodeSigningKey } from "./schema/index.js";

const NODE_TABLES = [
  "node_mirror_link",
  "node_mode",
  "node_primary_key",
  "node_recovery_key",
  "node_signing_key",
];

describe("node.db's tables", () => {
  const suite = useVenueDb({ migrations: [{ ...NODE_MIGRATIONS, database: "node" }] });

  it("creates the five tables in node.db and none in venue.db", () => {
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
});
