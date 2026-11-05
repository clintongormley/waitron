import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { verifyBackupFiscalHistory } from "./backup-verification-history.js";
import { retainLookupConflict } from "./reconcile-conflicts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");

it.each(["valid", "registro_id", "case_id", "changed-evidence"] as const)(
  "checks lookup evidence and its retained links in real backup files (%s)",
  async (fault) => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await withTransaction(suite.db, (tx) =>
      retainLookupConflict(
        tx,
        seeded.registroIds[0]!,
        {
          source: "consulta",
          invoice: {
            IDEmisorFactura: seeded.nif,
            NumSerieFactura: "S1/1",
            FechaExpedicionFactura: "20-07-2026",
          },
          reference: "foreign-copy",
          state: "Correcto",
          fingerprint: "D".repeat(64),
          system: { taxId: "89890001K", softwareId: "WT", installation: "other" },
        },
        NOW,
      ),
    );
    const directory = await mkdtemp(join(tmpdir(), "waitron-lookup-backup-"));
    try {
      const [file] = suite.db.all<{ file: string }>(sql`pragma database_list`);
      const live = new DatabaseSync(file!.file, { readOnly: true });
      try {
        await backup(live, join(directory, "before.db"));
        await backup(live, join(directory, "after.db"));
      } finally {
        live.close();
      }
      if (fault !== "valid") {
        for (const side of fault === "changed-evidence" ? ["after"] : ["before", "after"]) {
          const copy = new DatabaseSync(join(directory, `${side}.db`));
          try {
            copy.exec("pragma foreign_keys=off");
            const triggers = copy
              .prepare(
                "select name,sql from sqlite_schema where type='trigger' and tbl_name='fiscal_lookup_conflicts'",
              )
              .all();
            for (const trigger of triggers)
              copy.exec(`drop trigger "${String(trigger.name).replaceAll('"', '""')}"`);
            if (fault === "changed-evidence")
              copy.exec("update fiscal_lookup_conflicts set evidence='{}'");
            else copy.exec(`update fiscal_lookup_conflicts set "${fault}"='missing-parent'`);
            for (const trigger of triggers) copy.exec(String(trigger.sql));
          } finally {
            copy.close();
          }
        }
      }
      const before = await openBackupQuery(join(directory, "before.db"));
      try {
        const after = await openBackupQuery(join(directory, "after.db"));
        try {
          const result = await verifyBackupFiscalHistory({
            before: before.query,
            after: after.query,
            entries: {
              read: async () => {
                throw new Error("unexpected archive entry");
              },
            },
            source: {
              nodeId: seeded.nodeId,
              environment: "production",
              createdAt: NOW.toISOString(),
            },
            sourceSchema: 1,
            targetSchema: 1,
            signal: new AbortController().signal,
          });
          expect(result).toEqual({
            status: fault === "valid" ? "passed" : "invalid",
            checks: [{ code: "history", status: fault === "valid" ? "passed" : "invalid" }],
          });
        } finally {
          await after.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
