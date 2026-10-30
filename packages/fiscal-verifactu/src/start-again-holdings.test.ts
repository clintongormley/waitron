import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordSale } from "@waitron/core";
import type { ModuleOperationHost } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_INITIAL_SETUP } from "./hour-configuration.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { FISCAL_START_AGAIN_DELETABLE } from "./start-again-holdings.js";

const configured = FISCAL_INITIAL_SETUP.configure!({} as ModuleOperationHost);
const contributions = [
  ["the unconfigured contribution", FISCAL_INITIAL_SETUP],
  ["the configured contribution", configured],
] as const;

describe("startAgainHoldings", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it.each(contributions)("counts invoice records and AEAT's acceptances in %s", async (_, seat) => {
    expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 0, accepted: 0 });
    const { nodeId, seriesId: series } = await seedTenantWithSif(suite.db);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
    for (let sale = 0; sale < 2; sale++)
      await withTransaction(suite.db, (tx) =>
        recordSale(tx, backend, saleInput({ nodeId, seriesId: series })),
      );
    const rows = await suite.db
      .select({ id: registrosFacturacion.id })
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia);
    expect(rows).toHaveLength(2);
    expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 2, accepted: 0 });
    await suite.db
      .update(envios)
      .set({ estado: "aceptado" })
      .where(eq(envios.registroId, rows[0]!.id));
    // The second record's envío is still `pendiente`, which AEAT has not accepted.
    expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 2, accepted: 1 });
    await suite.db
      .update(envios)
      .set({ estado: "aceptado_con_errores" })
      .where(eq(envios.registroId, rows[1]!.id));
    expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 2, accepted: 2 });
  });

  it.each(contributions)("does not count a refused record as accepted in %s", async (_, seat) => {
    const { nodeId, seriesId: series } = await seedTenantWithSif(suite.db);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId, seriesId: series })),
    );
    await suite.db.update(envios).set({ estado: "rechazado" });
    expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 1, accepted: 0 });
  });
});

describe("startAgainHoldings on a database missing the fiscal tables", () => {
  const suite = useVenueDb({
    migrations: TEST_MIGRATIONS.filter(
      (set) => set.migrationsTable !== "__drizzle_migrations_fiscal",
    ),
    setup: async (db) => {
      await db.execute(sql`create table "__drizzle_migrations_fiscal" (id integer primary key)`);
    },
  });

  it.each(contributions)("refuses rather than counting nothing in %s", async (_, seat) => {
    await expect(seat.startAgainHoldings!(suite.db)).rejects.toThrow(
      /no such table: registros_facturacion/,
    );
  });
});

describe("startAgainHoldings with an invoice record and the envios table missing", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS, resetPerTest: false });

  it("still counts the invoice record, and no acceptance", async () => {
    const { nodeId, seriesId: series } = await seedTenantWithSif(suite.db);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId, seriesId: series })),
    );
    await suite.db.execute(sql`drop table envios`);
    for (const [, seat] of contributions)
      expect(await seat.startAgainHoldings!(suite.db)).toEqual({ records: 1, accepted: 0 });
  });
});

describe("startAgainHoldings with no invoice record and the envios table missing", () => {
  const suite = useVenueDb({
    migrations: TEST_MIGRATIONS,
    resetPerTest: false,
    setup: async (db) => {
      await db.execute(sql`drop table envios`);
    },
  });

  it.each(contributions)("refuses rather than counting nothing in %s", async (_, seat) => {
    await expect(seat.startAgainHoldings!(suite.db)).rejects.toThrow(/no such table: envios/);
  });
});

it("lists exactly the append-only table the fiscal activation writes as deletable", () => {
  expect(FISCAL_START_AGAIN_DELETABLE).toEqual(["fiscal_allocations"]);
});
