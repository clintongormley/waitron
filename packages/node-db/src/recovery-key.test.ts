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
  readRecoveryKey,
  readRecoveryKeyName,
  readRecoveryKeyVerifier,
  setRecoveryKeyTx,
} from "./recovery-key.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// A node file with NO migration set applied, so `node_recovery_key` does not exist.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads null for both the verifier and the name when the table itself is absent", async () => {
    expect(await readRecoveryKeyVerifier(bare.node, NODE)).toBeNull();
    expect(await readRecoveryKeyName(bare.node, NODE)).toBeNull();
    expect(await readRecoveryKey(bare.node, NODE)).toBeNull();
  });
});

describe("the node recovery-key check", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
  });

  it("reads null before anything is written", async () => {
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBeNull();
    expect(await readRecoveryKeyName(suite.node, NODE)).toBeNull();
    expect(await readRecoveryKey(suite.node, NODE)).toBeNull();
  });

  it("reads the verifier and name together, on a caller's node transaction too", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first");
      expect(await readRecoveryKey(tx, NODE)).toEqual({
        verifier: "scrypt$aa$bb",
        keyName: "2026-10-31-first",
      });
    });
    expect(await readRecoveryKey(suite.node, NODE)).toEqual({
      verifier: "scrypt$aa$bb",
      keyName: "2026-10-31-first",
    });
    expect(await readRecoveryKey(suite.node, OTHER)).toBeNull();
  });

  it("round-trips the verifier and name written on a caller's node transaction", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first");
      expect(await readRecoveryKeyVerifier(tx, NODE)).toBe("scrypt$aa$bb");
    });
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBe("scrypt$aa$bb");
    expect(await readRecoveryKeyName(suite.node, NODE)).toBe("2026-10-31-first");
  });

  it("writes into node.db", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first"),
    );
    expect(suite.node.all(sql`select node_id from node_recovery_key`)).toEqual([{ node_id: NODE }]);
  });

  it("reads a recovery-key check only for the node it was written for", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first"),
    );
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBe("scrypt$aa$bb");
    expect(await readRecoveryKeyVerifier(suite.node, OTHER)).toBeNull();
    expect(await readRecoveryKeyName(suite.node, OTHER)).toBeNull();
  });

  it("a second write for the same node replaces its verifier, name and time in place", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first"),
    );
    const [first] = suite.node.all<{ updated_at: string }>(
      sql`select updated_at from node_recovery_key`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$cc$dd", "2026-10-31-second"),
    );
    expect(suite.node.all(sql`select count(*) as n from node_recovery_key`)).toEqual([{ n: 1 }]);
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBe("scrypt$cc$dd");
    expect(await readRecoveryKeyName(suite.node, NODE)).toBe("2026-10-31-second");
    const [second] = suite.node.all<{ updated_at: string }>(
      sql`select updated_at from node_recovery_key`,
    );
    expect(second!.updated_at > first!.updated_at).toBe(true);
  });

  it.each(["", "   "])("reads a blank name %j as no name, keeping the verifier", async (blank) => {
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first"),
    );
    suite.node.run(sql`update node_recovery_key set key_name = ${blank} where node_id = ${NODE}`);
    expect(await readRecoveryKeyName(suite.node, NODE)).toBeNull();
    expect(await readRecoveryKeyVerifier(suite.node, NODE)).toBe("scrypt$aa$bb");
    expect(await readRecoveryKey(suite.node, NODE)).toEqual({
      verifier: "scrypt$aa$bb",
      keyName: null,
    });
  });

  it("permits at most one row per node — the primary key refuses a second", async () => {
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, "scrypt$aa$bb", "2026-10-31-first"),
    );
    const error = await captureError(() =>
      Promise.resolve(
        suite.node.run(
          sql`insert into node_recovery_key (node_id, verifier, key_name, updated_at) values (${NODE}, 'x', 'x', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });
});
