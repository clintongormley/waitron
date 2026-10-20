import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BackupVerificationContext } from "@waitron/module";
import { validateBackupModuleResult } from "@waitron/module";
import { CORE_BACKUP_VERIFICATION } from "./core-backup-verification.js";
import { ALL_MODULES } from "./modules.js";

describe("core backup contribution", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  async function verify() {
    const path = suite.db
      .all<{ file: string }>(`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
    const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const query: BackupVerificationContext["before"] = {
      async *rows(statement, values = []) {
        const prepared = db.prepare(statement);
        prepared.setReadBigInts(true);
        yield* prepared.iterate(...values);
      },
    };
    try {
      return await CORE_BACKUP_VERIFICATION.verifyRestoredData({
        before: query,
        after: query,
        entries: { read: async () => null },
        source: {
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          createdAt: "2026-10-20T00:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      db.close();
    }
  }

  it("refuses absent source identity through the real registered owner", async () => {
    expect(ALL_MODULES.find((module) => module.name === "core")?.backup?.verification).toBe(
      CORE_BACKUP_VERIFICATION,
    );
    const result = await verify();
    expect(result).toEqual({ status: "invalid", checks: [{ code: "data", status: "invalid" }] });
    expect(validateBackupModuleResult(result, CORE_BACKUP_VERIFICATION, false)).toEqual(result);
  });

  it("returns only fixed checks for preserved bound data, leaving activation unattempted", async () => {
    suite.db.run(
      `insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into locations (id, name, invoice_locales, operation_description) values ('venue', 'Fixture venue', '["en"]', 'Restaurant')`,
    );
    suite.db.run(
      `insert into nodes (id, location_id, name, created_at) values ('source', 'venue', 'Source node', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
    );
    const result = await verify();
    expect(result).toEqual({
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    });
    expect(validateBackupModuleResult(result, CORE_BACKUP_VERIFICATION, false)).toEqual(result);
    expect(CORE_BACKUP_VERIFICATION.effects).toEqual([
      { id: "host_series_replacement", kind: "activation", check: null },
      { id: "host_first_start", kind: "activation", check: null },
    ]);
    expect(suite.db.all(`select * from invoice_series`)).toEqual([]);
    expect(suite.db.all(`select * from daily_close_chain`)).toEqual([]);
  });
  it("refuses preserved but broken close history through the registered core owner", async () => {
    suite.db.run(
      `insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into locations (id, name, invoice_locales, operation_description) values ('venue', 'Fixture venue', '["en"]', 'Restaurant')`,
    );
    suite.db.run(
      `insert into nodes (id, location_id, name, created_at) values ('source', 'venue', 'Source node', '2026-10-20T00:00:00Z')`,
    );
    suite.db.run(
      `insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
    );
    expect(await verify()).toEqual({
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    });
    suite.db.run(`insert into daily_closes
      (id, node_id, business_day, sequence_no, prev_entry_hash, entry_hash, closed_at, closed_by, snapshot)
      values ('close', 'source', '2026-10-19', 1, '', 'invalid', '2026-10-20T00:00:00Z', 'actor',
        '{"close":{},"cashReconciliation":{"byDevice":[],"nodeVariance":"0.00"}}')`);
    suite.db.run(`insert into daily_close_chain values ('source', 1, 'invalid')`);
    expect(await verify()).toEqual({
      status: "invalid",
      checks: [{ code: "data", status: "invalid" }],
    });
  });
});
