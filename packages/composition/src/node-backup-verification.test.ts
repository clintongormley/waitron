import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { NODE_CLASSIFICATION } from "@waitron/node-db";
import {
  validateBackupModuleResult,
  validateBackupVerificationContribution,
  type BackupVerificationContext,
} from "@waitron/module";
import { NODE_BACKUP_VERIFICATION } from "./node-backup-verification.js";
import { ALL_MODULES } from "./modules.js";

const before = useVenueDb({ migrations: [] });
const after = useVenueDb({ migrations: [] });

beforeEach(() => {
  for (const suite of [before, after]) suite.db.run(sql`drop table if exists node_mode`);
});

async function run() {
  const path = (s: typeof before) =>
    s.db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  const a = await openBackupQuery(path(before));
  try {
    const b = await openBackupQuery(path(after));
    try {
      const context: BackupVerificationContext = {
        before: a.query,
        after: b.query,
        entries: { read: async () => null },
        source: {
          nodeId: "20000000-0000-4000-8000-000000000002",
          locationId: "10000000-0000-4000-8000-000000000001",
          environment: "preproduction",
          createdAt: "2026-10-31T08:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return validateBackupModuleResult(
        await NODE_BACKUP_VERIFICATION.verifyRestoredData(context),
        NODE_BACKUP_VERIFICATION,
        false,
      );
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}

describe("node.db's backup verification", () => {
  it("is the node module's contribution and claims exactly node.db's tables", () => {
    const owner = validateBackupVerificationContribution(NODE_BACKUP_VERIFICATION);
    expect(ALL_MODULES.find((m) => m.name === "node")?.backup?.verification).toBe(
      NODE_BACKUP_VERIFICATION,
    );
    expect([...owner.data.tables].sort()).toEqual(
      NODE_CLASSIFICATION.map((entry) => entry.table).sort(),
    );
    expect(owner.entries).toEqual([]);
  });

  it("passes when neither venue copy holds a node.db table", async () => {
    await expect(run()).resolves.toEqual({
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    });
  });

  it.each([
    ["original", before],
    ["restored", after],
  ])("marks invalid a %s venue copy that holds a node.db table", async (_name, suite) => {
    suite.db.run(sql`create table node_mode (node_id text primary key)`);
    await expect(run()).resolves.toEqual({
      status: "invalid",
      checks: [{ code: "data", status: "invalid" }],
    });
  });
});
