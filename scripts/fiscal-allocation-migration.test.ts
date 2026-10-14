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
import { altaFor, seedSale, seedTill } from "../packages/fiscal-verifactu/src/testing/seed.js";

const { sql } = createRequire(new URL("../packages/db/package.json", import.meta.url))(
  "drizzle-orm",
);

const source = join(import.meta.dirname, "../packages/fiscal-verifactu/drizzle");
const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string; when: number }[];
};
const latest = journal.entries.at(-1)!;
const migration = readFileSync(join(source, `${latest.tag}.sql`), "utf8");
const options = migrationOptionsFor(manifestSets(), null);

for (const kind of ["empty", "populated", "orphan", "unchecked-orphan"] as const) {
  const scratch = mkdtempSync(join(tmpdir(), "waitron-allocation-upgrade-"));
  const old = join(scratch, "old");
  cpSync(source, old, { recursive: true });
  rmSync(join(old, `${latest.tag}.sql`));
  writeFileSync(
    join(old, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, -1),
    }),
  );
  const created = new Set(
    journal.entries
      .slice(0, -1)
      .flatMap(({ tag }) =>
        [...readFileSync(join(old, `${tag}.sql`), "utf8").matchAll(/CREATE TABLE `(\w+)`/g)].map(
          (match) => match[1]!,
        ),
      ),
  );
  const sets = options.map((set) =>
    set.migrationsTable === "__drizzle_migrations_fiscal"
      ? {
          ...set,
          migrationsFolder: old,
          appendOnlyTables: (set.appendOnlyTables ?? []).filter((table) => created.has(table)),
        }
      : set,
  );
  const suite = useVenueDb({ migrations: sets, resetPerTest: false });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it(`upgrades the ${kind} fiscal database without losing historical records`, async () => {
    const till = await seedTill(suite.db);
    if (kind !== "empty") {
      const sale = await seedSale(suite.db, till, 1);
      await suite.db.transaction((tx) => appendToChain(tx, till.nodeId, altaFor(till, sale, 1, 1)));
    }
    const records = suite.db.execute(sql`select * from registros_facturacion`).rows;
    expect(records).toHaveLength(kind === "empty" ? 0 : 1);
    const chains = suite.db.execute(sql`select * from cadenas`).rows;
    const sifs = suite.db.execute(sql`select * from registro_sif`).rows;
    const beforeJournal = suite.db.execute(
      sql`select * from __drizzle_migrations_fiscal order by created_at`,
    ).rows;
    await installChangeFeed(
      suite.db,
      ALL_MODULES.flatMap((module) => module.changes ?? []),
    );
    const candidate = join(scratch, "candidate");
    cpSync(source, candidate, { recursive: true });
    if (kind === "orphan" || kind === "unchecked-orphan") {
      writeFileSync(
        join(candidate, `${latest.tag}.sql`),
        migration.replace('SELECT "id", "node_id"', 'SELECT "id" || \'-changed\', "node_id"'),
      );
    }
    if (kind === "unchecked-orphan") {
      const path = join(candidate, `${latest.tag}.sql`);
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          /CREATE TEMP TABLE `w41_fk_assertion`[\s\S]*?DROP TABLE `w41_fk_assertion`;--> statement-breakpoint\n/,
          "",
        ),
      );
    }
    const files = suite.db.execute<{ name: string; file: string }>(sql`pragma database_list`).rows;
    const folder = dirname(files.find((file) => file.name === "main")!.file);
    const result = await applyMigrations(
      folder,
      options.map((set) =>
        set.migrationsTable === "__drizzle_migrations_fiscal"
          ? { ...set, migrationsFolder: candidate }
          : set,
      ),
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (kind === "orphan") {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("orphan migration committed");
      expect(result.error).toMatchObject({ code: "migrations.apply_failed" });
      const error = result.error as Error;
      const details = String(error.cause) + String((error.cause as Error)?.cause);
      expect(details).toContain("CHECK constraint failed");
      expect(suite.db.execute(sql`select * from registro_sif`).rows).toEqual(sifs);
      expect(
        suite.db.execute(sql`select * from __drizzle_migrations_fiscal order by created_at`).rows,
      ).toEqual(beforeJournal);
    } else {
      expect(result).toEqual({ ok: true });
      if (kind !== "unchecked-orphan")
        expect(suite.db.execute(sql`select * from registro_sif`).rows).toEqual(
          sifs.map((row) => ({
            ...row,
            numero_instalacion: String(row.numero_instalacion),
          })),
        );
      expect(
        suite.db.execute<{ type: string }>(
          sql`select type from pragma_table_info('registro_sif') where name = 'numero_instalacion'`,
        ).rows[0]?.type,
      ).toBe("TEXT");
      expect(
        suite.db.execute(sql`select name from sqlite_master where name = 'contadores_instalacion'`)
          .rows,
      ).toEqual([]);
    }
    expect(suite.db.execute(sql`select * from registros_facturacion`).rows).toEqual(records);
    expect(suite.db.execute(sql`select * from cadenas`).rows).toEqual(chains);
    const violations = suite.db.execute(sql`pragma foreign_key_check`).rows;
    if (kind === "unchecked-orphan") expect(violations).toHaveLength(1);
    else expect(violations).toEqual([]);
    expect(
      suite.db.execute(
        sql`select name from sqlite_master where type = 'trigger' and tbl_name = 'registros_facturacion' and name glob '*append*'`,
      ).rows,
    ).toHaveLength(2);
  });
}
