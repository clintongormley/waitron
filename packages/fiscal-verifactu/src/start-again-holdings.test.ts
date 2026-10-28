import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { eq, sql, type SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  deployment,
  invoiceSeries,
  readDeploymentEnvironment,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordSale } from "@waitron/core";
import { withOperationAuthority, type ModuleOperationHost } from "@waitron/module";
import { locationId, seriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, seedTenantWithSif, TENANT_A } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import { FISCAL_INITIAL_SETUP } from "./hour-configuration.js";
import { readHourHistory } from "./hour-history-reader.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { FISCAL_START_AGAIN_DELETABLE } from "./start-again-holdings.js";

const configured = FISCAL_INITIAL_SETUP.configure!({} as ModuleOperationHost);
const contributions = [
  ["the unconfigured contribution", FISCAL_INITIAL_SETUP],
  ["the configured contribution", configured],
] as const;

function readOnly(db: Database): { target: Pick<Database, "execute">; close(): void } {
  const [main] = db.all<{ file: string }>(
    sql`select file from pragma_database_list where name = 'main'`,
  );
  const connection = new DatabaseSync(main!.file, { readOnly: true });
  const dialect = new SQLiteSyncDialect();
  return {
    target: {
      execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
        const compiled =
          typeof query === "string"
            ? { sql: query, params: [] }
            : dialect.sqlToQuery(query.getSQL());
        return {
          rows: connection
            .prepare(compiled.sql)
            .all(...(compiled.params as SQLInputValue[])) as Row[],
        };
      },
    } as Pick<Database, "execute">,
    close: () => connection.close(),
  };
}

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

describe("startAgainHistory", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
  const bases = [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ];

  async function activate(identity: string, issuedAt: string): Promise<void> {
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: identity,
      sourceId: `attempt/${identity}`,
      targetNodeId: TENANT_A.nodeId,
    } as const;
    const input = {
      allocation: {
        version: 1,
        allocationId: `hour/${identity}`,
        taxpayerNif: "89890001K",
        softwareId: "W1",
        environment: "preproduction",
        installationIdentity: identity,
        series: bases.map((b) => ({ ...b, code: `${b.code}-${identity}` })),
        source: "hour",
        reservationEvidence: null,
        issuedAt,
      },
      approval: {
        version: 1,
        eventId: identity,
        operatorId: "administrator",
        sourceId: binding.sourceId,
        targetNodeId: TENANT_A.nodeId,
        oldMachineOffline: false,
        oldMachineAbsent: true,
        noParallelRecovery: true,
        confirmedAt: issuedAt,
        incidentEvidence: `owned/${identity}`,
      },
    };
    await withOperationAuthority(binding, "administrator", (authority) => {
      const operation = { binding, authority, input };
      return withHourAdmission(
        operation,
        { requiredBases: bases, priorActivation: "none" },
        (evidence) =>
          withCollectedModuleAllocation(
            operation,
            async (request) => ({ ...request, evidence }),
            (write) =>
              withTransaction(suite.db, (tx) =>
                write(tx, { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) }),
              ),
          ),
      );
    });
  }

  async function transactionSource() {
    const environment = await readDeploymentEnvironment(suite.db);
    return withTransaction(suite.db, (tx) => readHourHistory(tx, environment));
  }

  it.each(contributions)(
    "reads over a read-only connection the source readHourHistory reads, in %s",
    async (_, seat) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      await seedTenants(suite.db);
      await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
      await activate("0CNNW", "2026-10-16T11:40:00.000Z");
      const clock = {
        ...steadyClock,
        now: () => ({ ...steadyClock.now(), instant: new Date("2026-10-22T20:15:00Z") }),
      };
      const backend = new VerifactuBackend({
        deploymentEnvironment: "preproduction",
        clock,
        db: suite.db,
        resolveClient: staticResolver(fakeClient),
      });
      const [standard] = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.code, "A-0CNNW"));
      await withTransaction(suite.db, (tx) =>
        recordSale(
          tx,
          backend,
          saleInput({ nodeId: TENANT_A.nodeId, seriesId: seriesId(standard!.id), clock }),
        ),
      );
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: new Date("2026-10-16T12:30:00Z") })
        .where(eq(invoiceSeries.code, "FF-0CNNW"));

      const expected = await transactionSource();
      expect(expected.complete).toBe(true);
      expect(expected.records.length).toBeGreaterThan(0);
      const connection = readOnly(suite.db);
      try {
        expect(await seat.startAgainHistory!(connection.target)).toEqual([expected]);
      } finally {
        connection.close();
      }
    },
  );

  it.each(contributions)(
    "reads an empty database as an empty complete source in %s",
    async (_, seat) => {
      const connection = readOnly(suite.db);
      try {
        expect(await seat.startAgainHistory!(connection.target)).toEqual([
          { reference: "venue", complete: true, records: [] },
        ]);
      } finally {
        connection.close();
      }
    },
  );
});

it("lists exactly the append-only table the fiscal activation writes as deletable", () => {
  expect(FISCAL_START_AGAIN_DELETABLE).toEqual(["fiscal_allocations"]);
});
