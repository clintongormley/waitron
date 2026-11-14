import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import {
  clearTakeFailuresTx,
  deleteNodeTakeFailuresOtherThanTx,
  readTakeFailures,
  recordTakeFailureTx,
} from "./take-failures.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("the switch take's failed takes", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

  it("reads null before any failure", async () => {
    expect(await readTakeFailures(suite.node, NODE)).toBeNull();
  });

  it("counts each failure and keeps the time of the last", async () => {
    const first = new Date("2026-10-16T11:40:00.000Z");
    const second = new Date("2026-10-16T11:41:00.000Z");
    await withNodeTransaction(suite.node, (tx) => recordTakeFailureTx(tx, NODE, first));
    expect(await readTakeFailures(suite.node, NODE)).toEqual({
      failures: 1,
      lastFailedAt: first,
    });
    await withNodeTransaction(suite.node, (tx) => recordTakeFailureTx(tx, NODE, second));
    expect(await readTakeFailures(suite.node, NODE)).toEqual({
      failures: 2,
      lastFailedAt: second,
    });
    expect(await readTakeFailures(suite.node, OTHER)).toBeNull();
  });

  it("clears only its own node's count", async () => {
    const at = new Date("2026-10-16T11:40:00.000Z");
    await withNodeTransaction(suite.node, async (tx) => {
      await recordTakeFailureTx(tx, NODE, at);
      await recordTakeFailureTx(tx, OTHER, at);
      await clearTakeFailuresTx(tx, NODE);
    });
    expect(await readTakeFailures(suite.node, NODE)).toBeNull();
    expect((await readTakeFailures(suite.node, OTHER))?.failures).toBe(1);
  });

  it("deletes other nodes' rows and keeps its own", async () => {
    const at = new Date("2026-10-16T11:40:00.000Z");
    await withNodeTransaction(suite.node, async (tx) => {
      await recordTakeFailureTx(tx, NODE, at);
      await recordTakeFailureTx(tx, OTHER, at);
      await deleteNodeTakeFailuresOtherThanTx(tx, NODE);
    });
    expect(suite.node.all(sql`select node_id from node_take_failures`)).toEqual([
      { node_id: NODE },
    ]);
  });
});
