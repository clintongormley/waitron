import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./migrations.js";
import {
  insertRecoveryPack,
  markRecoveryPackReceived,
  nextRecoveryPackNumber,
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
    settingsRevision: "7",
  },
  { part: "archives", state: "absent" },
  { part: "server-key", state: "included", keyName: "2026-10-01 · K", carriedKey: true },
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
    [
      "a carried key that is not true or false",
      { part: "server-key", state: "included", carriedKey: "yes" },
    ],
    ["a key name that is not text", { part: "server-key", state: "included", keyName: 7 }],
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
