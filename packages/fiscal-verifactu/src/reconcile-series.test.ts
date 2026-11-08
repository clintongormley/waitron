import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { RegistroConsultado } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedPinnedChain } from "../test/drain-fixtures.js";
import { retainUnheldSeriesConflicts } from "./reconcile-series.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
it("reads local invoice identities once while checking a complete returned month", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 12 });
  const records = (
    await suite.db.execute<{ number: string; date: string }>(
      sql`select num_serie_factura as number, fecha_expedicion_factura as date from registros_facturacion order by secuencia`,
    )
  ).rows;
  const observations: RegistroConsultado[] = records.map((row) => ({
    IDFactura: {
      IDEmisorFactura: seeded.nif,
      NumSerieFactura: row.number,
      FechaExpedicionFactura: row.date.split("-").reverse().join("-"),
    },
    DatosRegistroFacturacion: {},
    TimestampUltimaModificacion: "2026-07-21T00:01:00Z",
    EstadoRegistro: "Correcto",
  }));
  await withTransaction(suite.db, async (tx) => {
    const reads = vi.spyOn(tx, "execute");
    try {
      await retainUnheldSeriesConflicts(
        tx,
        {
          nodeId: seeded.nodeId,
          historyNodeIds: [seeded.nodeId],
          taxpayerId: seeded.nif,
          environment: "production",
        },
        observations,
        new Set(),
        new Date("2026-07-21T00:01:00Z"),
        { year: "2026", month: "07" },
      );
      expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      reads.mockRestore();
    }
  });
  expect((await suite.db.execute(sql`select * from fiscal_series_conflicts`)).rows).toEqual([]);
  expect(
    (await suite.db.execute(sql`select count(*) as count from registros_facturacion`)).rows,
  ).toEqual([{ count: 12 }]);
});

it("an invoice the old box holds is not outside this box's series of the same code", async () => {
  const old = await seedPendingEnvios(suite.db, { count: 1 });
  const { chain: spare } = await seedPinnedChain(suite.db, old, {
    sifId: randomUUID(),
    firstSecuencia: 50,
    rows: [{ nombreRazonEmisor: "Waitron SL", generadoEn: "2026-07-20T19:20:30+01:00" }],
  });
  // Series codes are unique per box only, so the spare box can run a live series with the code
  // of a series the old box issued under.
  await suite.db.insert(invoiceSeries).values({ nodeId: spare.nodeId, code: "S1" });
  const observed: RegistroConsultado[] = [
    {
      IDFactura: {
        IDEmisorFactura: old.nif,
        NumSerieFactura: "S1/1",
        FechaExpedicionFactura: "20-07-2026",
      },
      DatosRegistroFacturacion: {},
      TimestampUltimaModificacion: "2026-07-21T00:01:00Z",
      EstadoRegistro: "Correcto",
    },
  ];
  const retain = (historyNodeIds: readonly string[]) =>
    withTransaction(suite.db, (tx) =>
      retainUnheldSeriesConflicts(
        tx,
        { nodeId: spare.nodeId, historyNodeIds, taxpayerId: old.nif, environment: "production" },
        observed,
        new Set(),
        new Date("2026-07-21T00:01:00Z"),
        { year: "2026", month: "07" },
      ),
    );
  const conflicts = async () =>
    (await suite.db.execute(sql`select invoice_identity from fiscal_series_conflicts`)).rows;

  await retain([spare.nodeId, old.nodeId]);
  expect(await conflicts()).toEqual([]);

  // The control: read as the spare box's own records alone, the same invoice is outside.
  await retain([spare.nodeId]);
  expect(await conflicts()).toEqual([{ invoice_identity: "S1/1" }]);
});
