import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { isDrained, listSlots, readSlotDrain, type SlotDrain } from "./drain.js";

// A fake db that hands back a queue of `{ rows }` results (one per execute call) and counts the
// calls. The reader's job is the row→struct mapping and the two-query fallback; the fake feeds it the
// catalog rows so the mapping is asserted without a database (the real reads are proven in the
// two-node pg suite).
function queueDb(results: { rows: unknown[] }[]): { db: Database; calls: () => number } {
  let i = 0;
  const db = {
    execute: async () => {
      const next = results[i];
      i += 1;
      if (next === undefined) throw new Error("fake db ran out of queued results");
      return next;
    },
  };
  return { db: db as unknown as Database, calls: () => i };
}

describe("readSlotDrain", () => {
  it("maps a present slot row to raw facts (retained bytes as a bigint)", async () => {
    const { db } = queueDb([
      {
        rows: [
          {
            active: true,
            wal_status: "reserved",
            confirmed_flush_lsn: "0/30",
            current_wal_lsn: "0/40",
            retained_bytes: "128",
          },
        ],
      },
    ]);
    expect(await readSlotDrain(db, "waitron_production_sub_abc")).toEqual({
      exists: true,
      active: true,
      walStatus: "reserved",
      confirmedFlushLsn: "0/30",
      currentWalLsn: "0/40",
      retainedBytes: 128n,
    });
  });

  it("maps a present slot whose restart_lsn is null (retained bytes null)", async () => {
    const { db } = queueDb([
      {
        rows: [
          {
            active: false,
            wal_status: null,
            confirmed_flush_lsn: null,
            current_wal_lsn: "0/40",
            retained_bytes: null,
          },
        ],
      },
    ]);
    expect(await readSlotDrain(db, "fresh")).toEqual({
      exists: true,
      active: false,
      walStatus: null,
      confirmedFlushLsn: null,
      currentWalLsn: "0/40",
      retainedBytes: null,
    });
  });

  it("when the slot is absent, a SECOND query fills currentWalLsn and the rest read empty", async () => {
    const { db, calls } = queueDb([{ rows: [] }, { rows: [{ current_wal_lsn: "0/50" }] }]);
    expect(await readSlotDrain(db, "gone")).toEqual({
      exists: false,
      active: false,
      walStatus: null,
      confirmedFlushLsn: null,
      currentWalLsn: "0/50",
      retainedBytes: null,
    });
    expect(calls()).toBe(2);
  });

  it("falls back to an empty currentWalLsn if even the second query returns no row (defensive)", async () => {
    const { db } = queueDb([{ rows: [] }, { rows: [] }]);
    expect((await readSlotDrain(db, "gone")).currentWalLsn).toBe("");
  });
});

describe("isDrained", () => {
  const base: SlotDrain = {
    exists: true,
    active: false,
    walStatus: "reserved",
    confirmedFlushLsn: "0/20",
    currentWalLsn: "0/20",
    retainedBytes: 0n,
  };
  it("is true only when the slot exists and confirmed_flush has passed the fence LSN", () => {
    // Fence-LSN watermark (Ruling C2), NOT confirmed_flush >= pg_current_wal_lsn() (which decays
    // after the carrier disables — probe E). The `!active` half lives in the caller.
    expect(isDrained(base, "0/10")).toBe(true);
    expect(isDrained(base, "0/30")).toBe(false);
    expect(isDrained({ ...base, exists: false }, "0/10")).toBe(false);
    expect(isDrained({ ...base, confirmedFlushLsn: null }, "0/10")).toBe(false);
  });
});

describe("listSlots", () => {
  it("maps every slot row to a summary (retained bytes as a bigint, null preserved)", async () => {
    const { db } = queueDb([
      {
        rows: [
          { slot_name: "s1", active: true, wal_status: "reserved", retained_bytes: "4096" },
          { slot_name: "s2", active: false, wal_status: null, retained_bytes: null },
        ],
      },
    ]);
    expect(await listSlots(db)).toEqual([
      { slotName: "s1", active: true, walStatus: "reserved", retainedBytes: 4096n },
      { slotName: "s2", active: false, walStatus: null, retainedBytes: null },
    ]);
  });
});
