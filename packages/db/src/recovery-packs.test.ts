import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import {
  insertRecoveryPack,
  markRecoveryPackReceived,
  nextRecoveryPackNumber,
  readRecoveryPack,
  readRecoveryPacks,
  type RecoveryPackPartRecord,
} from "./recovery-packs.js";
import { recoveryPacks } from "./schema/recovery-packs.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const parts: RecoveryPackPartRecord[] = [
  {
    part: "bucket",
    state: "included",
    keyChangedAt: "2026-10-01T10:00:00.000Z",
    keyNeverChanged: true,
    settingsRevision: "7",
  },
  { part: "archives", state: "absent" },
  { part: "emergency", state: "included" },
];
const madeAt = new Date("2026-10-30T09:00:00.000Z");

async function make(nodeId: string, madeBy: string | null = "person-1") {
  return withTransaction(suite.db, async (tx) => {
    const number = await nextRecoveryPackNumber(tx, nodeId);
    await insertRecoveryPack(tx, { nodeId, number, madeAt, madeBy, parts });
    return number;
  });
}

describe("recovery pack records", () => {
  it("number from 1 per node, rising by one, each node on its own", async () => {
    expect(await make("node-a")).toBe(1);
    expect(await make("node-a")).toBe(2);
    expect(await make("node-b")).toBe(1);
    expect(await make("node-a")).toBe(3);
  });

  it("refuses a second pack with the same node and number", async () => {
    await make("node-a");
    await expect(
      withTransaction(suite.db, (tx) =>
        insertRecoveryPack(tx, { nodeId: "node-a", number: 1, madeAt, madeBy: null, parts }),
      ),
    ).rejects.toThrow(/UNIQUE constraint failed: recovery_packs\.node_id, recovery_packs\.number/);
  });

  it("reads back one node's packs only, newest first, as written", async () => {
    await make("node-a");
    await make("node-b", null);
    await make("node-a", "person-2");
    expect(await readRecoveryPacks(suite.db, "node-a")).toEqual([
      { nodeId: "node-a", number: 2, madeAt, madeBy: "person-2", receivedAt: null, parts },
      { nodeId: "node-a", number: 1, madeAt, madeBy: "person-1", receivedAt: null, parts },
    ]);
    expect(await readRecoveryPacks(suite.db, "node-b")).toEqual([
      { nodeId: "node-b", number: 1, madeAt, madeBy: null, receivedAt: null, parts },
    ]);
  });

  it("reads one pack by node and number, and none of another node's", async () => {
    await make("node-a");
    await make("node-b", "person-2");
    await make("node-b", "person-3");
    expect(await readRecoveryPack(suite.db, "node-b", 2)).toEqual({
      nodeId: "node-b",
      number: 2,
      madeAt,
      madeBy: "person-3",
      receivedAt: null,
      parts,
    });
    expect(await readRecoveryPack(suite.db, "node-a", 2)).toBeNull();
    expect(await readRecoveryPack(suite.db, "node-c", 1)).toBeNull();
  });

  it("marks a pack received once, keeping the first time, and touches no other node's pack", async () => {
    await make("node-a");
    await make("node-b");
    const first = new Date("2026-10-30T09:01:00.000Z");
    const later = new Date("2026-10-30T09:05:00.000Z");
    await withTransaction(suite.db, (tx) => markRecoveryPackReceived(tx, "node-a", 1, first));
    await withTransaction(suite.db, (tx) => markRecoveryPackReceived(tx, "node-a", 1, later));
    expect((await readRecoveryPacks(suite.db, "node-a"))[0]!.receivedAt).toEqual(first);
    expect((await readRecoveryPacks(suite.db, "node-b"))[0]!.receivedAt).toBeNull();
  });

  it.each([
    ["a secret", { part: "bucket", state: "included", secret: "s3cr3t" }],
    ["a code", { part: "archives", state: "included", archiveCode: "WRA1-…" }],
    ["an unknown part", { part: "disk-key", state: "included" }],
    ["an unknown state", { part: "bucket", state: "half" }],
    ["a server-key part", { part: "server-key", state: "included" }],
    ["a carried-key mark", { part: "bucket", state: "included", carriedKey: true }],
    [
      "a never-changed mark that is not true or false",
      { part: "bucket", state: "included", keyNeverChanged: "yes" },
    ],
    ["a key name", { part: "bucket", state: "included", keyName: "2026-10-01 · K" }],
    ["a destination outside the two", { part: "archives", state: "included", destination: "usb" }],
  ])("refuses a part record carrying %s, writing nothing", async (_name, entry) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        insertRecoveryPack(tx, {
          nodeId: "node-a",
          number: 1,
          madeAt,
          madeBy: null,
          parts: [entry as unknown as RecoveryPackPartRecord],
        }),
      ),
    ).rejects.toThrow("recovery pack part record refused");
    expect(await suite.db.select().from(recoveryPacks)).toEqual([]);
  });
});

it("records that the Cloud QR code was printed, refusing an issue date, a code or the address", async () => {
  const cloud: RecoveryPackPartRecord = { part: "emergency", state: "included" };
  await withTransaction(suite.db, (tx) =>
    insertRecoveryPack(tx, { nodeId: "node-a", number: 1, madeAt, madeBy: null, parts: [cloud] }),
  );
  expect((await readRecoveryPack(suite.db, "node-a", 1))!.parts).toEqual([cloud]);
  for (const extra of [
    { codeIssuedAt: "2026-10-12T08:00:00.000Z" },
    { code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" },
    { address: "https://es.waitron.io/" },
  ]) {
    await expect(
      withTransaction(suite.db, (tx) =>
        insertRecoveryPack(tx, {
          nodeId: "node-a",
          number: 2,
          madeAt,
          madeBy: null,
          parts: [{ ...cloud, ...extra } as RecoveryPackPartRecord],
        }),
      ),
    ).rejects.toThrow("recovery pack part record refused");
  }
  expect(await readRecoveryPack(suite.db, "node-a", 2)).toBeNull();
});

it("records that a pack showed the master key, refusing the key itself", async () => {
  const shown: RecoveryPackPartRecord = { part: "master-key", state: "included" };
  await withTransaction(suite.db, (tx) =>
    insertRecoveryPack(tx, { nodeId: "node-a", number: 1, madeAt, madeBy: null, parts: [shown] }),
  );
  expect((await readRecoveryPack(suite.db, "node-a", 1))!.parts).toEqual([shown]);
  for (const extra of [{ masterKey: "QZJV ABCD" }, { masterKeyCode: "QZJV ABCD" }]) {
    await expect(
      withTransaction(suite.db, (tx) =>
        insertRecoveryPack(tx, {
          nodeId: "node-a",
          number: 2,
          madeAt,
          madeBy: null,
          parts: [{ ...shown, ...extra } as RecoveryPackPartRecord],
        }),
      ),
    ).rejects.toThrow("recovery pack part record refused");
  }
  expect(await readRecoveryPack(suite.db, "node-a", 2)).toBeNull();
});

it("records which master key a pack showed by its row number and name, refusing any other number, name or part", async () => {
  const shown: RecoveryPackPartRecord = {
    part: "master-key",
    state: "included",
    masterKeyNumber: 3,
    masterKeyName: "2026-11-23 · QZJV",
  };
  await withTransaction(suite.db, (tx) =>
    insertRecoveryPack(tx, { nodeId: "node-a", number: 1, madeAt, madeBy: null, parts: [shown] }),
  );
  expect((await readRecoveryPack(suite.db, "node-a", 1))!.parts).toEqual([shown]);
  for (const entry of [
    { ...shown, masterKeyNumber: "3" },
    { ...shown, masterKeyNumber: 1.5 },
    { ...shown, masterKeyNumber: 0 },
    { ...shown, masterKeyNumber: Number.MAX_SAFE_INTEGER + 1 },
    { part: "bucket", state: "included", masterKeyNumber: 3 },
    { ...shown, masterKeyName: "" },
    { ...shown, masterKeyName: 3 },
    { ...shown, masterKeyName: null },
    { ...shown, masterKeyName: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5" },
    { ...shown, masterKeyName: "Key 3" },
    { part: "bucket", state: "included", masterKeyName: "2026-11-23 · QZJV" },
  ]) {
    await expect(
      withTransaction(suite.db, (tx) =>
        insertRecoveryPack(tx, {
          nodeId: "node-a",
          number: 2,
          madeAt,
          madeBy: null,
          parts: [entry as RecoveryPackPartRecord],
        }),
      ),
    ).rejects.toThrow("recovery pack part record refused");
  }
  expect(await readRecoveryPack(suite.db, "node-a", 2)).toBeNull();
});
