import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Counterparty, SaleForFiscalRecord } from "@waitron/fiscal";
import { deviceOrigin, jobOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { decimal, saleId as brandSaleId } from "@waitron/shared";
import { validate } from "@waitron/verifactu";
import type { RegistroAlta } from "@waitron/verifactu";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { seedTaxpayerWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";

let backend: VerifactuBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTaxpayerWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
  });
});

const originalId = brandSaleId("44444444-4444-4444-8444-444444444444");
const correctiveId = brandSaleId("55555555-5555-4555-8555-555555555555");
const laterDay = new Date("2026-03-05T19:40:00+01:00");
const storedCustomer = { IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345674" }] };
// A different name from the stored one, so a record built from the sale would show it.
const handedCustomer: Counterparty = {
  taxId: "B12345674",
  legalName: "Otro Nombre SL",
  countryCode: "ES",
};

type Original = { tipoFactura: string; tipoRectificativa?: "S" | "I" };

async function insertSale(id: SaleId, invoiceNumber: number, issuedAt: Date) {
  await suite.db.insert(sales).values({
    id,
    source: "device",
    deviceId,
    nodeId,
    seriesId,
    invoiceNumber,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
}

/** An original alta of the given type, built on a filed simplified invoice's own fields. */
async function originalOf({ tipoFactura, tipoRectificativa }: Original) {
  const { saleId: earlier } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, origin: deviceOrigin(deviceId) })),
  );
  const issuedAt = new Date("2026-03-02T10:00:00+01:00");
  await insertSale(originalId, 700, issuedAt);
  await withTransaction(suite.db, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(
      sql`select * from verifactu_records where sale_id = ${earlier}`,
    );
    const template = fromRegistroRow(decodeRegistroRow(rows[0]!)) as RegistroAlta;
    const earlierInvoice = {
      IDEmisorFactura: template.IDFactura.IDEmisorFactura,
      NumSerieFactura: template.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: new Date("2026-03-01T00:00:00+01:00"),
    };
    const full = ["F1", "F3", "R1", "R4"].includes(tipoFactura);
    await appendToChain(tx, nodeId, {
      tipo: "alta",
      saleId: originalId,
      origin: jobOrigin("operator_script"),
      entorno: "production",
      input: {
        IDEmisorFactura: template.IDFactura.IDEmisorFactura,
        NumSerieFactura: "A/700",
        FechaExpedicionFactura: issuedAt,
        NombreRazonEmisor: template.NombreRazonEmisor,
        TipoFactura: tipoFactura as RegistroAlta["TipoFactura"],
        ...(tipoRectificativa !== undefined && {
          TipoRectificativa: tipoRectificativa,
          FacturasRectificadas: [earlierInvoice],
        }),
        ...(tipoRectificativa === "S" && {
          ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
        }),
        ...(tipoFactura === "F3" && { FacturasSustituidas: [earlierInvoice] }),
        ...(full && { Destinatarios: storedCustomer }),
        DescripcionOperacion: template.DescripcionOperacion,
        Desglose: template.Desglose,
        CuotaTotal: template.CuotaTotal,
        ImporteTotal: template.ImporteTotal,
        SistemaInformatico: template.SistemaInformatico,
        generadoEn: issuedAt,
        offsetMinutes: 60,
      },
    });
  });
}

function correctiveSale(counterparty: Counterparty | null): SaleForFiscalRecord {
  return {
    origin: deviceOrigin(deviceId),
    nodeId,
    saleId: correctiveId,
    seriesId,
    seriesCode: "R",
    invoiceNumber: 900,
    issuedAt: laterDay,
    offsetMinutes: 60,
    descriptionOfOperation: "Rectificacion por diferencias",
    total: decimal("-12.10"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") }],
    counterparty,
  };
}

async function correct(counterparty: Counterparty | null) {
  await insertSale(correctiveId, 900, laterDay);
  return withTransaction(suite.db, (tx) =>
    backend.recordCorrection(tx, correctiveSale(counterparty), { correctsSaleId: originalId }),
  );
}

async function filedCorrective() {
  const { rows } = await suite.db.execute<Record<string, unknown>>(
    sql`select * from verifactu_records where sale_id = ${correctiveId}`,
  );
  return rows.map((row) => decodeRegistroRow(row));
}

async function registroCount() {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from verifactu_records`,
  );
  return rows[0]!.n;
}

const originals: (Original & { label: string })[] = [
  { label: "F1", tipoFactura: "F1" },
  { label: "F2", tipoFactura: "F2" },
  { label: "F3", tipoFactura: "F3" },
  { label: 'R1 "I"', tipoFactura: "R1", tipoRectificativa: "I" },
  { label: 'R4 "S"', tipoFactura: "R4", tipoRectificativa: "S" },
  { label: 'R4 "I"', tipoFactura: "R4", tipoRectificativa: "I" },
  { label: 'R5 "S"', tipoFactura: "R5", tipoRectificativa: "S" },
  { label: 'R5 "I"', tipoFactura: "R5", tipoRectificativa: "I" },
];
const filed: Record<string, "R1" | "R5"> = {
  "F1 customer": "R1",
  'R4 "S" customer': "R1",
  "F2 none": "R5",
  'R5 "S" none': "R5",
};
const grid = originals.flatMap((original) =>
  (["customer", "none"] as const).map((sale) => ({
    ...original,
    sale,
    files: filed[`${original.label} ${sale}`],
  })),
);

describe("recordCorrection — the record type a correction files", () => {
  it.each(grid.filter((cell) => cell.files !== undefined))(
    "files an $files by differences against an original $label, the sale naming $sale",
    async ({ tipoFactura, tipoRectificativa, sale, files }) => {
      await originalOf({ tipoFactura, ...(tipoRectificativa && { tipoRectificativa }) });

      const ref = await correct(sale === "customer" ? handedCustomer : null);

      const rows = await filedCorrective();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(ref.recordId).toBe(row.id);
      expect({
        tipoFactura: row.tipo_factura,
        tipoRectificativa: row.tipo_rectificativa,
        importeRectificacion: row.importe_rectificacion,
        destinatarios: row.destinatarios,
      }).toEqual({
        tipoFactura: files,
        tipoRectificativa: "I",
        importeRectificacion: null,
        destinatarios: files === "R1" ? storedCustomer : null,
      });
      expect(validate(fromRegistroRow(row) as RegistroAlta, { now: laterDay })).toEqual([]);
    },
  );

  it.each(grid.filter((cell) => cell.files === undefined))(
    "refuses a correction of an original $label, the sale naming $sale, and records nothing",
    async ({ tipoFactura, tipoRectificativa, sale }) => {
      await originalOf({ tipoFactura, ...(tipoRectificativa && { tipoRectificativa }) });
      const before = await registroCount();

      await expect(correct(sale === "customer" ? handedCustomer : null)).rejects.toMatchObject({
        code: "fiscal.correction_unsupported",
        params: { saleId: originalId, tipoFactura },
      });
      expect(await filedCorrective()).toEqual([]);
      expect(await registroCount()).toBe(before);
    },
  );
});
