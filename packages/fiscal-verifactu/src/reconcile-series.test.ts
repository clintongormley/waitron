import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { RegistroConsultado } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
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
        { nodeId: seeded.nodeId, taxpayerId: seeded.nif, environment: "production" },
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
