import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { listSubscriptions, readSubscriptionStatus } from "./status.js";

function queueDb(results: { rows: unknown[] }[]): Database {
  let i = 0;
  const db = {
    execute: async () => {
      const next = results[i];
      i += 1;
      if (next === undefined) throw new Error("fake db ran out of queued results");
      return next;
    },
  };
  return db as unknown as Database;
}

describe("readSubscriptionStatus", () => {
  it("maps the joined catalog/stat row (counts as numbers, LSNs as text)", async () => {
    const db = queueDb([
      {
        rows: [
          {
            subname: "waitron_production_sub_x",
            enabled: true,
            publications: ["waitron_production_ledger", "waitron_production_state"],
            worker_up: true,
            received_lsn: "0/AA",
            latest_end_lsn: "0/AB",
            apply_error_count: "0",
            sync_error_count: "0",
            tables_total: 4,
            tables_ready: 4,
          },
        ],
      },
    ]);
    expect(await readSubscriptionStatus(db, "waitron_production_sub_x")).toEqual({
      name: "waitron_production_sub_x",
      exists: true,
      enabled: true,
      publications: ["waitron_production_ledger", "waitron_production_state"],
      workerUp: true,
      receivedLsn: "0/AA",
      latestEndLsn: "0/AB",
      applyErrorCount: 0,
      syncErrorCount: 0,
      tablesTotal: 4,
      tablesReady: 4,
    });
  });

  it("an absent subscription reads exists:false with zeroed counts and no tables", async () => {
    const db = queueDb([{ rows: [] }]);
    expect(await readSubscriptionStatus(db, "waitron_production_sub_missing")).toEqual({
      name: "waitron_production_sub_missing",
      exists: false,
      enabled: false,
      publications: [],
      workerUp: false,
      receivedLsn: null,
      latestEndLsn: null,
      applyErrorCount: 0,
      syncErrorCount: 0,
      tablesTotal: 0,
      tablesReady: 0,
    });
  });
});

describe("listSubscriptions", () => {
  it("maps each subscription row to name/enabled/publications", async () => {
    const db = queueDb([
      {
        rows: [
          {
            subname: "waitron_production_sub_a",
            enabled: true,
            publications: ["waitron_production_ledger"],
          },
          { subname: "waitron_production_sub_b", enabled: false, publications: [] },
        ],
      },
    ]);
    expect(await listSubscriptions(db)).toEqual([
      {
        name: "waitron_production_sub_a",
        enabled: true,
        publications: ["waitron_production_ledger"],
      },
      { name: "waitron_production_sub_b", enabled: false, publications: [] },
    ]);
  });
});
