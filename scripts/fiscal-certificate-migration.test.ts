import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";
import { createRequire } from "node:module";
import { installChangeFeed } from "../packages/db/src/change-feed.js";
import { useVenueDb } from "../packages/db/src/testing/venue-db.js";
import {
  applyMigrations,
  manifestSets,
  migrationOptionsFor,
} from "../packages/migrations/src/index.js";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { appendToChain } from "../packages/fiscal-verifactu/src/chain.js";
import { openFilingCase } from "../packages/fiscal-verifactu/src/filing-cases.js";
import {
  altaFor,
  anulacionFor,
  seedSale,
  seedTill,
} from "../packages/fiscal-verifactu/src/testing/seed.js";

const { sql } = createRequire(new URL("../packages/db/package.json", import.meta.url))(
  "drizzle-orm",
);

const source = join(import.meta.dirname, "../packages/fiscal-verifactu/drizzle");
const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string; when: number }[];
};
const target = journal.entries.findIndex((entry) => entry.tag === "0007_certificate_installs");
if (target === -1)
  throw new Error("migration 0007_certificate_installs is not in the fiscal journal");
const options = migrationOptionsFor(manifestSets(), null);

const scratch = mkdtempSync(join(tmpdir(), "waitron-certificate-upgrade-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function folderUpTo(name: string, end: number) {
  const folder = join(scratch, name);
  cpSync(source, folder, { recursive: true });
  for (const { tag } of journal.entries.slice(end)) rmSync(join(folder, `${tag}.sql`));
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, end) }),
  );
  const created = new Set(
    journal.entries
      .slice(0, end)
      .flatMap(({ tag }) =>
        [...readFileSync(join(folder, `${tag}.sql`), "utf8").matchAll(/CREATE TABLE `(\w+)`/g)].map(
          (match) => match[1]!,
        ),
      ),
  );
  return options.map((set) =>
    set.migrationsTable === "__drizzle_migrations_fiscal"
      ? {
          ...set,
          migrationsFolder: folder,
          appendOnlyTables: (set.appendOnlyTables ?? []).filter((table) => created.has(table)),
        }
      : set,
  );
}

const suite = useVenueDb({ migrations: folderUpTo("old", target), resetPerTest: false });

/** Every row of every table, with each column's storage class beside its value. */
function snapshot(tables: string[]) {
  return Object.fromEntries(
    tables.map((table) => {
      const columns = suite.db
        .execute<{ name: string }>(sql`select name from pragma_table_info(${table})`)
        .rows.map(({ name }) => name);
      const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const select = columns
        .flatMap((column) => [
          quote(column),
          `typeof(${quote(column)}) as ${quote(`typeof:${column}`)}`,
        ])
        .join(", ");
      const rows = suite.db
        .execute<Record<string, unknown>>(sql.raw(`select ${select} from ${quote(table)}`))
        .rows.map((row) => JSON.stringify(row))
        .sort();
      return [table, rows];
    }),
  );
}

it("applies the certificate migration without changing any filed fiscal row", async () => {
  const till = await seedTill(suite.db);
  const sale = await seedSale(suite.db, till, 1);
  await suite.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till, sale, 1, 1)));
  await suite.db.transaction((tx) =>
    appendToChain(tx, till.nodeId, anulacionFor(till, sale, 1, 2)),
  );
  const [alta] = suite.db.execute<{ id: string }>(
    sql`select id from registros_facturacion where tipo_registro = 'alta'`,
  ).rows;
  await suite.db.transaction((tx) =>
    openFilingCase(tx, {
      registroId: alta!.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1100, mensaje: "rechazado", csv: null },
      now: new Date("2026-07-20T18:00:00.000Z"),
    }),
  );
  await installChangeFeed(
    suite.db,
    ALL_MODULES.flatMap((module) => module.changes ?? []),
  );

  const tables = suite.db
    .execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not glob '__drizzle_migrations*' order by name`,
    )
    .rows.map(({ name }) => name);
  const before = snapshot(tables);
  for (const filed of ["registros_facturacion", "cadenas", "registro_sif", "filing_cases"])
    expect(before[filed]?.length, filed).toBeGreaterThan(0);

  const candidate = folderUpTo("candidate", target + 1);
  const files = suite.db.execute<{ name: string; file: string }>(sql`pragma database_list`).rows;
  const folder = dirname(files.find((file) => file.name === "main")!.file);
  const result = await applyMigrations(folder, candidate).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  expect(result).toEqual({ ok: true });
  expect(
    suite.db.execute(
      sql`select name from sqlite_master where name in ('fiscal_certificate_installs', 'fiscal_certificate_reminders') order by name`,
    ).rows,
  ).toEqual([{ name: "fiscal_certificate_installs" }, { name: "fiscal_certificate_reminders" }]);

  expect(snapshot(tables)).toEqual(before);
});
