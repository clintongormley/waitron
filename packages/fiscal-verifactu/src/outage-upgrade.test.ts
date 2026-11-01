import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { runMigrations } from "@waitron/db";
import { applyMigrationSet, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPreReplacementRegistro } from "../test/pre-replacement-fixture.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";

let directory: string | undefined;
const suite = useVenueDb({
  migrations: [],
  setup: async (db) => {
    directory = await mkdtemp(join(tmpdir(), "waitron-outage-upgrade-"));
    await cp(FISCAL_MIGRATIONS.migrationsFolder, directory, { recursive: true });
    const journalPath = join(directory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.tag < "0009_aeat_outage_flag");
    await writeFile(journalPath, JSON.stringify(journal));
    for (const set of TEST_MIGRATIONS) {
      await applyMigrationSet(
        db,
        set.migrationsTable === FISCAL_MIGRATIONS.migrationsTable
          ? {
              ...set,
              migrationsFolder: directory,
              appendOnlyTables: set.appendOnlyTables?.filter(
                (table) =>
                  ![
                    "clock_stop_restarts",
                    "clock_checks",
                    "clock_confirmations",
                    "fiscal_conflict_evidence",
                  ].includes(table),
              ),
            }
          : set,
      );
    }
  },
});
afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

it("adds clean outage defaults to populated predecessor sidecars without changing fiscal bytes", async () => {
  const { registroId } = await seedPreReplacementRegistro(suite.db);
  await suite.db
    .execute(sql`insert into envios (registro_id, estado, intentos, incidencia, proximo_intento_en)
    values (${registroId}, 'pendiente', 3, 1, '2026-07-21T00:00:00.000Z')`);
  await suite.db.execute(sql`insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, '2026-07-21T00:01:00.000Z', 60)`);
  const before = (await suite.db.execute(sql`select * from registros_facturacion`)).rows.map(
    (row) => ({ ...row, corrects_registro_id: null }),
  );
  await runMigrations(suite.db, FISCAL_MIGRATIONS);
  expect((await suite.db.execute(sql`select * from fiscal_conflict_evidence`)).rows).toEqual([]);
  expect(
    (
      await suite.db.execute(
        sql`select estado, intentos, incidencia, proximo_intento_en, technical_incidence from envios`,
      )
    ).rows,
  ).toEqual([
    {
      estado: "pendiente",
      intentos: 3,
      incidencia: 1,
      proximo_intento_en: "2026-07-21T00:00:00.000Z",
      technical_incidence: 0,
    },
  ]);
  expect((await suite.db.execute(sql`select * from envio_flujo`)).rows).toEqual([
    {
      id: 1,
      proximo_envio_en: "2026-07-21T00:01:00.000Z",
      tiempo_espera_seg: 60,
      technical_incident_token: null,
    },
  ]);
  expect((await suite.db.execute(sql`select * from registros_facturacion`)).rows).toEqual(before);
});
