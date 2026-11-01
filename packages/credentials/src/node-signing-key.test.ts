import { generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  locations,
  readMembershipTrustSet,
  setNodePublicKey,
  withNodeTransaction,
} from "@waitron/db";
import { NODE_MIGRATIONS, nodeSigningKey } from "@waitron/node-db";
import { hasCode } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { aadFor, seal } from "./cipher.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import {
  establishNodeSigningKey,
  nodeSigningPublicKey,
  openNodeSigningKeyRow,
  readNodeIdentity,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
} from "./node-signing-key.js";
import { rotateCredentials } from "./store.js";
import { captured, capturedSync } from "./testing/captured.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});
const RING_V1_AS_2 = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K1,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const pair = generateKeyPairSync("ed25519");
const PRIVATE_KEY = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const PUBLIC_KEY = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");

describe("before the node set has run", () => {
  const bare = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });

  it("refuses a read when node.db has no signing-key table", async () => {
    await expect(readNodeSigningKey(bare.node, RING_V1, NODE)).rejects.toThrow(
      /no such table: node_signing_key/,
    );
  });

  it("rotates nothing in node.db when it has no signing-key table", async () => {
    expect(await rotateCredentials(bare.db, RING_V1, bare.node)).toEqual({
      rotated: 0,
      alreadyCurrent: 0,
    });
  });
});

describe("the box's signing key in node.db", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
  });

  beforeEach(() => {
    suite.node.run(sql`delete from node_signing_key`);
  });

  async function insertRaw(nodeId: string, aad: string, plaintext: string, keyVersion = 1) {
    const sealed = seal(Buffer.from(K1, "base64"), aadFor(aad), plaintext);
    await withNodeTransaction(suite.node, (tx) =>
      tx.insert(nodeSigningKey).values({ nodeId, ...sealed, keyVersion }),
    );
  }

  it("seals and reads back the box's key, and a row copied under another node id does not open", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, NODE, PRIVATE_KEY),
    );
    expect(await readNodeSigningKey(suite.node, RING_V1, NODE)).toBe(PRIVATE_KEY);
    expect(suite.node.all(sql`select node_id, key_version from node_signing_key`)).toEqual([
      { node_id: NODE, key_version: 1 },
    ]);

    suite.node.run(sql`update node_signing_key set node_id = ${OTHER} where node_id = ${NODE}`);
    const error = await captured(() => readNodeSigningKey(suite.node, RING_V1, OTHER));
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
    expect(error.params).toEqual({ purpose: "membership.node_key" });
  });

  it("reads null for a node with no row, even when another node has one", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, NODE, PRIVATE_KEY),
    );
    expect(await readNodeSigningKey(suite.node, RING_V1, OTHER)).toBeNull();
  });

  it("reads through a caller's node transaction", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await sealNodeSigningKeyTx(tx, RING_V1, NODE, PRIVATE_KEY);
      expect(await readNodeSigningKey(tx, RING_V1, NODE)).toBe(PRIVATE_KEY);
    });
  });

  it("replaces the stored key on a second seal, on the ring's current key", async () => {
    const second = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64");
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, NODE, PRIVATE_KEY),
    );
    suite.node.run(sql`update node_signing_key set updated_at = '2000-01-01T00:00:00.000Z'`);
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V2_ONLY, NODE, second),
    );
    expect(await readNodeSigningKey(suite.node, RING_V2_ONLY, NODE)).toBe(second);
    const rows = suite.node.all<{ key_version: number; updated_at: string }>(
      sql`select key_version, updated_at from node_signing_key`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key_version).toBe(2);
    expect(rows[0]!.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it("does not open a key sealed as the venue vault's membership row", async () => {
    await insertRaw(NODE, "membership.node_key", JSON.stringify({ privateKey: PRIVATE_KEY }));
    const error = await captured(() => readNodeSigningKey(suite.node, RING_V1, NODE));
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
  });

  it("does not open under a ring that does not carry the row's key", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V2_ONLY, NODE, PRIVATE_KEY),
    );
    const wrongKey = await captured(() => readNodeSigningKey(suite.node, RING_V1_AS_2, NODE));
    expect(hasCode(wrongKey, "credentials.decrypt_failed")).toBe(true);
    const unknown = await captured(() => readNodeSigningKey(suite.node, RING_V1, NODE));
    expect(hasCode(unknown, "credentials.key_version_unknown")).toBe(true);
    expect(unknown.params).toEqual({ purpose: "membership.node_key", keyVersion: 2 });
  });

  it.each([
    ["not JSON", "privateKey"],
    ["a JSON array", JSON.stringify([PRIVATE_KEY])],
    ["JSON null", "null"],
    ["an object without privateKey", JSON.stringify({ key: PRIVATE_KEY })],
    ["an empty privateKey", JSON.stringify({ privateKey: "" })],
    ["a privateKey that is not a string", JSON.stringify({ privateKey: 7 })],
  ])("refuses a payload that is %s, without echoing it", async (_label, plaintext) => {
    await insertRaw(NODE, `membership.node_key/${NODE}`, plaintext);
    const error = await captured(() => readNodeSigningKey(suite.node, RING_V1, NODE));
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
    expect(error.params).toEqual({ purpose: "membership.node_key" });
  });
});

describe("establishing the box's signing key", () => {
  const suite = useVenueDb({
    resetPerTest: false,
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
    timeoutMs: 60_000,
  });

  async function freshNode() {
    await seedTenant(suite.db);
    const [loc] = await suite.db
      .insert(locations)
      .values({
        name: "Bar",
        invoiceLocales: ["es-ES"],
        operationDescription: "Sales on the premises",
      })
      .returning({ id: locations.id });
    return seedNode(suite.db, brandLocationId(loc!.id));
  }

  it("makes and seals a key, then stamps its public half on the node's row", async () => {
    const nodeId = await freshNode();
    await establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId);
    const privateKey = await readNodeSigningKey(suite.node, RING_V1, nodeId);
    expect(privateKey).not.toBeNull();
    expect((await readMembershipTrustSet(suite.db))[nodeId]).toBe(
      nodeSigningPublicKey(privateKey!),
    );
  });

  it("stamps a key already sealed, and keeps it on a second run", async () => {
    const nodeId = await freshNode();
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, nodeId, PRIVATE_KEY),
    );
    await establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId);
    await establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId);
    expect(await readNodeSigningKey(suite.node, RING_V1, nodeId)).toBe(PRIVATE_KEY);
    expect((await readMembershipTrustSet(suite.db))[nodeId]).toBe(PUBLIC_KEY);
  });

  it("refuses node.identity_mismatch when the venue names a different public key", async () => {
    const nodeId = await freshNode();
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, nodeId, PRIVATE_KEY),
    );
    const foreign = generateKeyPairSync("ed25519")
      .publicKey.export({ format: "der", type: "spki" })
      .toString("base64");
    await setNodePublicKey(suite.db, nodeId, foreign);
    const error = await captured(() =>
      establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId),
    );
    expect(hasCode(error, "node.identity_mismatch")).toBe(true);
    expect((await readMembershipTrustSet(suite.db))[nodeId]).toBe(foreign);
    expect(await readNodeSigningKey(suite.node, RING_V1, nodeId)).toBe(PRIVATE_KEY);
  });

  it("stamps nothing in venue.db when node.db refuses to seal the key", async () => {
    const nodeId = await freshNode();
    suite.node.run(
      sql.raw(`create trigger refuse_signing_key before insert on node_signing_key
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId)).rejects.toThrow(
        "refused by test",
      );
      expect((await readMembershipTrustSet(suite.db))[nodeId]).toBeUndefined();
    } finally {
      suite.node.run(sql`drop trigger if exists refuse_signing_key`);
    }
  });

  it("reads the venue's trust set beside this box's private key, null before one is made", async () => {
    const nodeId = await freshNode();
    expect(await readNodeIdentity(suite.db, suite.node, RING_V1, nodeId)).toEqual({
      trust: await readMembershipTrustSet(suite.db),
      privateKey: null,
    });
    await establishNodeSigningKey(suite.db, suite.node, RING_V1, nodeId);
    const own = await readNodeIdentity(suite.db, suite.node, RING_V1, nodeId);
    expect(own.privateKey).toBe(await readNodeSigningKey(suite.node, RING_V1, nodeId));
    expect(own.trust[nodeId]).toBe(nodeSigningPublicKey(own.privateKey!));
  });
});

describe("openNodeSigningKeyRow", () => {
  it("opens a row read from anywhere, bound to the node id it is given", () => {
    const row = {
      ...seal(
        Buffer.from(K1, "base64"),
        aadFor(`membership.node_key/${NODE}`),
        JSON.stringify({ privateKey: PRIVATE_KEY }),
      ),
      keyVersion: 1,
    };
    const asBytes = {
      ciphertext: new Uint8Array(row.ciphertext),
      iv: new Uint8Array(row.iv),
      authTag: new Uint8Array(row.authTag),
      keyVersion: 1,
    };
    expect(openNodeSigningKeyRow(asBytes, RING_V1, NODE)).toBe(PRIVATE_KEY);
    const error = capturedSync(() => openNodeSigningKeyRow(asBytes, RING_V1, OTHER));
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
  });
});

describe("nodeSigningPublicKey", () => {
  it("derives the base64 SPKI public half of a base64 PKCS8 private key", () => {
    expect(nodeSigningPublicKey(PRIVATE_KEY)).toBe(PUBLIC_KEY);
  });
});
