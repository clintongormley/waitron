import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { invoiceSeries, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  decimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  deviceOrigin,
} from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { anulacionFor } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const T = Date.parse("2026-03-01T12:05:00.000Z");
const DAY = 86_400_000;
const YEAR_2001 = Date.parse("2001-01-01T11:00:00.000Z");

let backend: VerifactuBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

function sell(ms: number) {
  return withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
  );
}

function count(table: string): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]!.n;
}

function written() {
  return {
    registros: count("registros_facturacion"),
    sales: count("sales"),
    envios: count("envios"),
    incidents: count("incidents"),
    secuencia:
      suite.db.all<{ s: number }>(
        sql`select secuencia as s from cadenas where node_id = ${nodeId}`,
      )[0]?.s ?? 0,
    nextNumber: suite.db.all<{ n: number }>(
      sql`select next_number as n from invoice_series where id = ${seriesId}`,
    )[0]!.n,
  };
}

function chainNumbers() {
  return suite.db.all<{ n: string; s: number }>(
    sql`select num_serie_factura as n, secuencia as s from registros_facturacion where node_id = ${nodeId} order by secuencia`,
  );
}

function behindParams(ms: number) {
  return {
    clockAt: new Date(ms).toISOString(),
    offsetMinutes: 60,
    lastRecordAt: new Date(T).toISOString(),
    lastRecordOffsetMinutes: 60,
  };
}

/** A whole-invoice correction issued at `ms`, its corrective sale row written in the same
 * transaction so a refusal leaves nothing behind. */
function correctAt(ms: number, correctsSaleId: SaleId) {
  return withTransaction(suite.db, async (tx) => {
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
      .returning({ id: invoiceSeries.id });
    const [corrective] = await tx
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: new Date(ms).toISOString(),
        issuedOffsetMinutes: 60,
        total: -1441,
        vatBreakdown: [],
        correctsSaleId,
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });
    await backend.recordCorrection(
      tx,
      {
        origin: deviceOrigin(deviceId),
        nodeId,
        saleId: brandSaleId(corrective!.id),
        seriesId: brandSeriesId(series!.id),
        seriesCode: "R",
        invoiceNumber: 1,
        issuedAt: new Date(ms),
        offsetMinutes: 60,
        descriptionOfOperation: "Rectificacion por diferencias",
        total: decimal("-14.41"),
        vatBreakdown: [
          { rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") },
          { rate: decimal("10.00"), base: decimal("-2.10"), tax: decimal("-0.21") },
        ],
        counterparty: null,
      },
      { correctsSaleId },
    );
  });
}

describe("no record is written while the clock reads behind the latest record", () => {
  it("refuses a sale a day behind the last record and writes nothing", async () => {
    await sell(T);
    expect(chainNumbers()).toEqual([{ n: "A/1", s: 1 }]);
    const before = written();

    await expect(sell(T - DAY)).rejects.toMatchObject({
      code: "clock.behind_chain",
      params: behindParams(T - DAY),
    });

    expect(written()).toEqual(before);
    await sell(T + 60_000);
    expect(chainNumbers()).toEqual([
      { n: "A/1", s: 1 },
      { n: "A/2", s: 2 },
    ]);
  });

  it("refuses a correction and an anulación the same way", async () => {
    const { saleId } = await sell(T);
    const before = written();

    await expect(correctAt(T - DAY, saleId)).rejects.toMatchObject({
      code: "clock.behind_chain",
      params: behindParams(T - DAY),
    });
    expect(written()).toEqual(before);

    const anulacion = anulacionFor({ deviceId }, saleId, 1, 1);
    const behind = {
      ...anulacion,
      input: { ...anulacion.input, generadoEn: new Date(T - DAY), offsetMinutes: 60 },
    };
    await expect(
      withTransaction(suite.db, (tx) => appendToChain(tx, nodeId, behind)),
    ).rejects.toMatchObject({ code: "clock.behind_chain", params: behindParams(T - DAY) });
    expect(written()).toEqual(before);
  });

  it("records a sale exactly a minute behind", async () => {
    await sell(T);
    await sell(T - 60_000);
    expect(chainNumbers()).toEqual([
      { n: "A/1", s: 1 },
      { n: "A/2", s: 2 },
    ]);
  });

  it("refuses a 2001 record as clock.unusable on a database with no records", async () => {
    await expect(sell(YEAR_2001)).rejects.toMatchObject({
      code: "clock.unusable",
      params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
    });
    expect(count("registros_facturacion")).toBe(0);
  });

  it("refuses a 2001 record as clock.unusable on a database with records", async () => {
    await sell(T);
    const before = written();
    await expect(sell(YEAR_2001)).rejects.toMatchObject({
      code: "clock.unusable",
      params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
    });
    expect(written()).toEqual(before);
  });
});
