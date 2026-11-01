import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { captureError, triggerRaised, withTransaction } from "@waitron/db";
import { applyMigrationSet, migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPreReplacementEnvio } from "../test/pre-replacement-fixture.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { acks } from "./schema/acks.js";
import { envios } from "./schema/envios.js";

let directory: string | undefined;
const suite = useVenueDb({
  migrations: [],
  setup: async (db) => {
    directory = await mkdtemp(join(tmpdir(), "waitron-record-replacement-upgrade-"));
    await cp(FISCAL_MIGRATIONS.migrationsFolder, directory, { recursive: true });
    const journalPath = join(directory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.tag < "0014_w41s8_record_replacements",
    );
    await writeFile(journalPath, JSON.stringify(journal));
    for (const set of TEST_MIGRATIONS) {
      await applyMigrationSet(
        db,
        set.migrationsTable === FISCAL_MIGRATIONS.migrationsTable
          ? { ...set, migrationsFolder: directory }
          : set,
      );
    }
  },
});
afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

async function snapshot() {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const name of migratedTableNames(suite.db)) {
    tables[name] = (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows;
  }
  return tables;
}

it("adds an empty replacement link while preserving every populated row and fiscal refusal", async () => {
  const { registroIds } = await seedPreReplacementEnvio(suite.db);
  const registroId = registroIds[0]!;
  const now = new Date("2026-07-21T00:00:00.000Z");
  await withTransaction(suite.db, async (tx) => {
    await tx.update(envios).set({ estado: "rechazado" }).where(eq(envios.registroId, registroId));
    await tx.insert(acks).values({ registroId, state: "rejected", submittedAt: now });
    const opened = await openFilingCase(tx, {
      registroId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1100, mensaje: "Rejected fixture", csv: null },
      now,
    });
    await recordCaseEvent(tx, {
      caseId: opened.id,
      actionKey: "pre-replacement-note",
      kind: "note",
      personId: "fixture-administrator",
      action: "Investigate the rejected record",
      now,
    });
  });
  const before = await snapshot();
  expect(before.registros_facturacion).toHaveLength(1);
  expect(before.registros_facturacion![0]).not.toHaveProperty("corrects_registro_id");
  for (const name of ["cadenas", "envios", "acks", "filing_cases", "filing_case_events"]) {
    expect(before[name]).toHaveLength(1);
  }

  await applyMigrationSet(suite.db, FISCAL_MIGRATIONS);
  const expected = {
    ...before,
    registros_facturacion: before.registros_facturacion!.map((row) => ({
      ...row,
      corrects_registro_id: null,
    })),
  };
  expect(await snapshot()).toEqual(expected);
  expect((await suite.db.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);

  const update = await captureError(() =>
    suite.db.execute(sql`update registros_facturacion set huella = ${"F".repeat(64)}`),
  );
  expect(triggerRaised(update, "registros_facturacion is append-only")).toBe(true);
  const remove = await captureError(() =>
    suite.db.execute(sql`delete from registros_facturacion where id = ${registroId}`),
  );
  expect(triggerRaised(remove, "registros_facturacion is append-only")).toBe(true);
  expect(await snapshot()).toEqual(expected);
});
