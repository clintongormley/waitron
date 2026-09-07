import { describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import {
  assertReplicationReady,
  readReplicationReadiness,
  replicationReadinessGaps,
  type ReplicationReadiness,
} from "./replication-readiness.js";

const READY: ReplicationReadiness = {
  walLevel: "logical",
  trackCommitTimestamp: true,
  maxSlotWalKeepSizeBounded: true,
  replicationRolePresent: true,
  migratorCanCreateSubscription: true,
};
const READY_ROW = {
  wal_level: "logical",
  track: "on",
  slot_bounded: true,
  repl_present: true,
  migrator_can_subscribe: true,
};
function fakeDb(row: Record<string, unknown>) {
  return { execute: async () => ({ rows: [row] }) } as never;
}

describe("replicationReadinessGaps", () => {
  it("reports no gaps when everything is in place", () => {
    expect(replicationReadinessGaps(READY)).toEqual([]);
  });
  it("names each missing precondition (labels only)", () => {
    expect(replicationReadinessGaps({ ...READY, walLevel: "replica" })).toContain(
      "wal_level is not logical",
    );
    expect(replicationReadinessGaps({ ...READY, trackCommitTimestamp: false })).toContain(
      "track_commit_timestamp is off",
    );
    expect(replicationReadinessGaps({ ...READY, maxSlotWalKeepSizeBounded: false })).toContain(
      "max_slot_wal_keep_size is unbounded",
    );
    expect(replicationReadinessGaps({ ...READY, replicationRolePresent: false })).toContain(
      "replication role missing",
    );
    expect(replicationReadinessGaps({ ...READY, migratorCanCreateSubscription: false })).toContain(
      "migrator lacks pg_create_subscription",
    );
  });
});

describe("readReplicationReadiness maps the row", () => {
  it("reads the five facts", async () => {
    expect(await readReplicationReadiness(fakeDb(READY_ROW))).toEqual(READY);
    expect(
      await readReplicationReadiness(fakeDb({ ...READY_ROW, track: "off", slot_bounded: false })),
    ).toMatchObject({
      trackCommitTimestamp: false,
      maxSlotWalKeepSizeBounded: false,
    });
  });
});

describe("assertReplicationReady", () => {
  it("resolves when ready", async () => {
    await expect(assertReplicationReady(fakeDb(READY_ROW))).resolves.toBeUndefined();
  });
  it("throws provisioning.replication_not_ready listing the gaps", async () => {
    let thrown: unknown;
    try {
      await assertReplicationReady(
        fakeDb({ ...READY_ROW, wal_level: "replica", repl_present: false }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.replication_not_ready");
    if (!hasCode(thrown, "provisioning.replication_not_ready")) return;
    expect(thrown.params.missing).toContain("wal_level is not logical");
    expect(thrown.params.missing).toContain("replication role missing");
  });
});
