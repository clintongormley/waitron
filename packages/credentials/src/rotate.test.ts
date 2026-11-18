import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  readActivityForSubject,
  CORE_MIGRATIONS,
  withNodeTransaction,
  withTransaction,
  type Database,
  venueCredentials,
} from "@waitron/db";
import {
  NODE_MIGRATIONS,
  readRecoveryKey,
  setRecoveryKeyTx,
  nodeHandoverEvents,
} from "@waitron/node-db";
import { hasCode, type AppError } from "@waitron/shared";
import { aadFor, seal } from "./cipher.js";
import { loadKeyRing } from "./keyring.js";
import { writePairLinkTx, type NewPairLink } from "./node-pair-link.js";
import {
  readNodeSigningKey,
  sealNodeSigningKeyTx,
  rotateNodeSigningKeysTx,
} from "./node-signing-key.js";
import { getCredential, putCredential, rotateCredentials } from "./store.js";
import { captured } from "./testing/captured.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_BOTH = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
  WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
});
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const STRIPE = {
  secretKey: "sk_test_rot",
  webhookSecret: "whsec_rot",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SIGNING_KEY = "MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_NODE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAIR_LINK: NewPairLink = {
  role: "streams",
  state: "pending",
  peerNodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  peerPublicKey: "peer-public-key",
  storeUrl: "https://spare.example:7443",
  venueId: "venue-a",
  accessKeyId: "waitron0123456789abcdef",
  secretAccessKey: "0f".repeat(32),
};

describe("rotateCredentials", () => {
  it("re-seals every row onto the current key and advances its version", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );

    const history = await readActivityForSubject(suite.db, {
      kind: "credential",
      id: "payments.stripe",
    });
    const result = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(
      await readActivityForSubject(suite.db, { kind: "credential", id: "payments.stripe" }),
    ).toEqual(history);
    expect(result.rotated).toBe(1);
    expect(result.alreadyCurrent).toBe(0);

    const versions = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from venue_credentials`);
    expect(versions.rows[0]!.key_version).toBe(2);

    // Readable with the new key ALONE — the old key can now be retired.
    const actual = await withTransaction(suite.db, (tx) =>
      getCredential(tx, RING_V2_ONLY, { purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("is idempotent — a second run rotates nothing", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, {
        personId: null,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AA", passphrase: "p", certKind: "sello" },
      }),
    );
    const first = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(first.rotated).toBe(1);
    const second = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(second.rotated).toBe(0);
    expect(second.alreadyCurrent).toBe(1);
  });

  it("finishes a rotation that was interrupted half-way", async () => {
    // Some rows on the old key, some already on the new one. This pins the row-by-row SKIP logic,
    // not per-row key SELECTION: with only `current`/`previous` in the ring, a row not on `current`
    // is necessarily on `previous`, so this cannot tell "select by the row's key_version" from
    // "always try `previous`". store.test.ts's "serves a row on either ring member" pins that.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_BOTH, {
        personId: null,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AA", passphrase: "p", certKind: "sello" },
      }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(result.rotated).toBe(1);
    expect(result.alreadyCurrent).toBe(1);

    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from venue_credentials where key_version = 2`);
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("refuses to run without a previous key when rows still need one", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() => rotateCredentials(suite.db, RING_V2_ONLY, suite.node));
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });

  it("propagates — rather than swallows — an undecryptable row instead of silently leaving it on the retiring key", async () => {
    // If rotateCredentials swallowed tryGetCredential's throw, this row would stay sealed under a
    // key about to be retired while the run reported success. Sealed under a key neither ring
    // member matches, but stamped with a version the ring carries (RING_BOTH.previous), so this is
    // `credentials.decrypt_failed`, not `credentials.key_version_unknown`.
    const strangerKey = Buffer.alloc(32, 9);
    const sealed = seal(strangerKey, aadFor("payments.stripe"), JSON.stringify(STRIPE));
    await withTransaction(suite.db, (tx) =>
      tx.insert(venueCredentials).values({
        purpose: "payments.stripe",
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: 1,
      }),
    );

    const error = await captured(() => rotateCredentials(suite.db, RING_BOTH, suite.node));
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);

    // No phantom success, no partial write: the row is exactly as it was sealed.
    const row = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from venue_credentials`);
    expect(row.rows[0]!.key_version).toBe(1);
  });

  it("skips a row whose purpose the registry no longer knows, rather than crashing on it", async () => {
    // `listCredentials` selects every row the vault holds, known purpose or not, so a purpose the
    // registry has since retired reaches rotation. The row is raw bytes, never decrypted: only the
    // iv/auth-tag LENGTH checks need satisfying.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTransaction(suite.db, (tx) =>
      tx.insert(venueCredentials).values({
        purpose: "legacy.retired-purpose",
        ciphertext: Buffer.from("stale"),
        iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        keyVersion: 1,
      }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(result.rotated).toBe(1);

    const rows = await suite.db.execute<{ purpose: string; key_version: number }>(sql`
      select purpose, key_version from venue_credentials order by purpose`);
    const legacy = rows.rows.find((r) => r.purpose === "legacy.retired-purpose");
    // Untouched — still on the old version, because it was never processed at all.
    expect(legacy?.key_version).toBe(1);
  });

  it("does not count a row deleted between the listing and its re-seal", async () => {
    // Rotation lists the vault in one transaction and re-seals each row in its own, so a `delete`
    // committing in between leaves a listed row with nothing to read. The wrapper deletes the row
    // as the second transaction (that row's re-seal) opens, which is where a concurrent delete lands.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );
    let transactions = 0;
    const db = suite.db;
    // `withTransaction` opens each transaction through `withWriteLock`: once for the listing, once
    // for the row's re-seal. The delete runs on `target` OUTSIDE the lock, so it commits in its own
    // autocommit statement before the re-seal's `begin immediate` is taken
    // (`packages/store/src/write-queue.ts`) — which is the ordering the case needs.
    const deletingDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "withWriteLock") return Reflect.get(target, property, receiver) as unknown;
        const withWriteLock: Database["withWriteLock"] = async (body) => {
          transactions += 1;
          if (transactions === 2) await target.execute(sql`delete from venue_credentials`);
          return target.withWriteLock(body);
        };
        return withWriteLock;
      },
    });

    const result = await rotateCredentials(deletingDb, RING_BOTH, suite.node);
    expect(transactions).toBe(2);
    expect(result).toEqual({ rotated: 0, alreadyCurrent: 0 });
  });

  it("rotation skips recovery-only boxes and still re-seals a populated signing group", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setRecoveryKeyTx(tx, OTHER_NODE, "verifier", "Recovery only", null);
      await sealNodeSigningKeyTx(tx, RING_V1, NODE, SIGNING_KEY);
    });
    expect(await rotateCredentials(suite.db, RING_BOTH, suite.node)).toEqual({
      rotated: 1,
      alreadyCurrent: 0,
    });
    expect(await readRecoveryKey(suite.node, OTHER_NODE)).toEqual({
      verifier: "verifier",
      keyName: "Recovery only",
    });
    expect(await readNodeSigningKey(suite.node, RING_V2_ONLY, NODE)).toBe(SIGNING_KEY);
    expect(
      await suite.node
        .select({
          nodeId: nodeHandoverEvents.nodeId,
          operationId: nodeHandoverEvents.operationId,
          kind: nodeHandoverEvents.kind,
          detail: nodeHandoverEvents.detail,
          envelope: nodeHandoverEvents.envelope,
        })
        .from(nodeHandoverEvents),
    ).toEqual([
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.signing_key_rotated",
        detail: { keyVersion: 2 },
        envelope: null,
      },
    ]);
  });

  it("rotation re-seals the signing key, and it opens once the previous key is dropped", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING_V1, NODE, SIGNING_KEY),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(result).toEqual({ rotated: 1, alreadyCurrent: 0 });
    expect(suite.node.all(sql`select signing_key_version as key_version from box`)).toEqual([
      { key_version: 2 },
    ]);
    expect(await readNodeSigningKey(suite.node, RING_V2_ONLY, NODE)).toBe(SIGNING_KEY);

    const again = await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(again).toEqual({ rotated: 0, alreadyCurrent: 1 });
    expect(
      await suite.node
        .select({
          nodeId: nodeHandoverEvents.nodeId,
          operationId: nodeHandoverEvents.operationId,
          kind: nodeHandoverEvents.kind,
          detail: nodeHandoverEvents.detail,
          envelope: nodeHandoverEvents.envelope,
        })
        .from(nodeHandoverEvents),
    ).toEqual([
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.signing_key_rotated",
        detail: { keyVersion: 2 },
        envelope: null,
      },
    ]);
  });

  it("records a rotation for each old box, leaves a current box alone, and rolls events back with keys", async () => {
    const current = "current-box";
    await withNodeTransaction(suite.node, async (tx) => {
      await sealNodeSigningKeyTx(tx, RING_V1, NODE, SIGNING_KEY);
      await sealNodeSigningKeyTx(tx, RING_V1, OTHER_NODE, "other-private-key");
      await sealNodeSigningKeyTx(tx, RING_BOTH, current, "current-private-key");
    });
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
    await expect(
      withNodeTransaction(suite.node, async (tx) => {
        await rotateNodeSigningKeysTx(tx, RING_BOTH);
        throw new Error("abandoned");
      }),
    ).rejects.toThrow("abandoned");
    expect(await readNodeSigningKey(suite.node, RING_V1, NODE)).toBe(SIGNING_KEY);
    expect(await readNodeSigningKey(suite.node, RING_V1, OTHER_NODE)).toBe("other-private-key");
    expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
    expect(await rotateCredentials(suite.db, RING_BOTH, suite.node)).toEqual({
      rotated: 2,
      alreadyCurrent: 1,
    });
    expect(await readNodeSigningKey(suite.node, RING_V2_ONLY, OTHER_NODE)).toBe(
      "other-private-key",
    );
    expect(await readNodeSigningKey(suite.node, RING_V2_ONLY, current)).toBe("current-private-key");
    expect(
      await suite.node
        .select({
          nodeId: nodeHandoverEvents.nodeId,
          operationId: nodeHandoverEvents.operationId,
          kind: nodeHandoverEvents.kind,
          detail: nodeHandoverEvents.detail,
          envelope: nodeHandoverEvents.envelope,
        })
        .from(nodeHandoverEvents)
        .orderBy(nodeHandoverEvents.nodeId),
    ).toEqual([
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.signing_key_rotated",
        detail: { keyVersion: 2 },
        envelope: null,
      },
      {
        nodeId: OTHER_NODE,
        operationId: null,
        kind: "box.signing_key_rotated",
        detail: { keyVersion: 2 },
        envelope: null,
      },
    ]);
  });

  it("refuses while node.db holds a pair link, and re-seals nothing", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { personId: null, purpose: "payments.stripe", value: STRIPE }),
    );
    await withNodeTransaction(suite.node, async (tx) => {
      await sealNodeSigningKeyTx(tx, RING_V1, NODE, SIGNING_KEY);
      await writePairLinkTx(tx, RING_V1, OTHER_NODE, PAIR_LINK);
    });

    const error = await captured(() => rotateCredentials(suite.db, RING_BOTH, suite.node));
    expect(hasCode(error, "credentials.rotation_spare_joined")).toBe(true);
    expect((error as AppError).params).toEqual({ role: "streams" });
    expect([
      ...suite.db.all(sql`select key_version from venue_credentials`),
      ...suite.node.all(sql`select signing_key_version as key_version from box`),
      ...suite.node.all(sql`select key_version from node_pair_link`),
    ]).toEqual([{ key_version: 1 }, { key_version: 1 }, { key_version: 1 }]);
  });
});
