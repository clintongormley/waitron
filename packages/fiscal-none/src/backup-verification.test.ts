import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { validateBackupVerificationContribution } from "@waitron/module";
import * as api from "./index.js";
import { FISCAL_NONE_MIGRATIONS } from "./migrations.js";
const suite = useVenueDb({ migrations: [FISCAL_NONE_MIGRATIONS] });
const query = {
  async *rows(): AsyncGenerator<never> {
    yield* [];
    throw new Error("No database state belongs to this owner");
  },
};
it("declares no owned state against its real empty migration set", () => {
  const journal = JSON.parse(
    readFileSync(join(FISCAL_NONE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  expect(journal.entries).toEqual([]);
  expect(
    suite.db.all(
      sql`select name from sqlite_schema where type='table' and name not glob '__drizzle_migrations*' and name not glob 'sqlite_*'`,
    ),
  ).toEqual([]);
  const owner = validateBackupVerificationContribution(api.FISCAL_NONE_BACKUP_VERIFICATION);
  expect(owner.data).toEqual({
    kind: "database_only",
    tables: [],
    immutableTables: [],
    checks: ["data"],
  });
  expect([
    owner.secrets,
    owner.entries,
    owner.effects,
    owner.publicEvidenceDigest,
    owner.zeroSchema,
    owner.targetOnly,
  ]).toEqual([[], [], [], null, "absent_tables_and_entries", "empty_after_migration"]);
});
it.each([0, 1, null])(
  "checks its explicit empty obligations without querying another owner's data (schema %s)",
  async (sourceSchema) => {
    expect(api.FISCAL_NONE_BACKUP_VERIFICATION).toBeDefined();
    expect(
      await api.FISCAL_NONE_BACKUP_VERIFICATION.verifyRestoredData({
        before: query,
        after: query,
        entries: {
          async read() {
            throw new Error("No entries declared");
          },
        },
        source: {
          nodeId: "source",
          locationId: "location",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema,
        targetSchema: 0,
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: "passed", checks: [{ code: "data", status: "passed" }] });
  },
);
