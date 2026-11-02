import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleForFiscalRecord } from "@waitron/fiscal";
import { decimal, deviceOrigin, jobOrigin, seriesId, type SaleId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;
let originalSaleId: SaleId;
let backend: VerifactuBackend;
const AT = new Date("2026-07-20T17:20:40Z");
const recipient = { NombreRazon: "Customer SL", NIF: "B12345674" };

beforeEach(async () => {
  node = await seedNode(suite.db);
  originalSaleId = await seedSale(suite.db, node, 1);
  backend = new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
    clock: {
      ...steadyClock,
      now: () => ({ ...steadyClock.now(), instant: AT, offsetMinutes: 120 }),
    },
  });
});

async function versions(originalType: "F1" | "F2", currentType: "F1" | "F2") {
  let previous: string | undefined;
  for (const [index, tipo] of [originalType, originalType, currentType].entries()) {
    const pending = altaFor(node, originalSaleId, 1, index + 1, "preproduction");
    const record = await withTransaction(suite.db, (tx) =>
      appendToChain(tx, node.nodeId, {
        ...pending,
        origin: index === 0 ? deviceOrigin(node.deviceId) : jobOrigin("operator_script"),
        ...(previous === undefined ? {} : { correctsRegistroId: previous }),
        input: {
          ...pending.input,
          TipoFactura: tipo,
          ...(tipo === "F1" ? { Destinatarios: { IDDestinatario: [recipient] } } : {}),
          ...(previous === undefined ? {} : { Subsanacion: "S", RechazoPrevio: "X" }),
        },
      }),
    );
    previous = record.id;
  }
}

async function operationSale(kind: "credit" | "substitution"): Promise<SaleForFiscalRecord> {
  const credit = kind === "credit";
  return {
    origin: deviceOrigin(node.deviceId),
    nodeId: node.nodeId,
    saleId: await seedSale(suite.db, node, 2),
    seriesId: seriesId(node.seriesId),
    seriesCode: credit ? "R" : "F3",
    invoiceNumber: 2,
    issuedAt: AT,
    offsetMinutes: 120,
    descriptionOfOperation: "Restaurant adjustment",
    total: decimal(credit ? "-121.00" : "121.00"),
    vatBreakdown: [
      {
        rate: decimal("21.00"),
        base: decimal(credit ? "-100.00" : "100.00"),
        tax: decimal(credit ? "-21.00" : "21.00"),
      },
    ],
    counterparty: credit
      ? null
      : { legalName: "Customer SL", taxId: "B12345674", countryCode: "ES" },
  };
}

it.each(["credit", "substitution"] as const)(
  "%s admission uses the current corrected invoice type in either query order",
  async (kind) => {
    await versions("F2", "F1");
    const sale = await operationSale(kind);
    const before = await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia);
    for (const reverse of [false, true]) {
      await expect(
        withTransaction(suite.db, async (tx) => {
          await tx.execute(
            reverse
              ? sql`pragma reverse_unordered_selects = on`
              : sql`pragma reverse_unordered_selects = off`,
          );
          try {
            return kind === "credit"
              ? await backend.recordCorrection(tx, sale, { correctsSaleId: originalSaleId })
              : await backend.recordSubstitution(tx, sale, {
                  substitutedSaleIds: [originalSaleId],
                });
          } finally {
            await tx.execute(sql`pragma reverse_unordered_selects = off`);
          }
        }),
      ).rejects.toMatchObject({
        code:
          kind === "credit" ? "fiscal.correction_unsupported" : "fiscal.substitution_unsupported",
        params: { saleId: originalSaleId, tipoFactura: "F1" },
      });
    }
    expect(
      await suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia),
    ).toEqual(before);
  },
);

it.each(["credit", "substitution"] as const)(
  "%s remains available after correcting the stored invoice type to F2",
  async (kind) => {
    await versions("F1", "F2");
    const sale = await operationSale(kind);
    const before = await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia);
    const result = await withTransaction(suite.db, (tx) =>
      kind === "credit"
        ? backend.recordCorrection(tx, sale, { correctsSaleId: originalSaleId })
        : backend.recordSubstitution(tx, sale, { substitutedSaleIds: [originalSaleId] }),
    );
    const stored = await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia);
    expect(stored.slice(0, 3)).toEqual(before);
    expect(stored[3]).toMatchObject({
      id: result.recordId,
      tipoFactura: kind === "credit" ? "R5" : "F3",
      anteriorHuella: before[2]!.huella,
    });
    expect(
      kind === "credit" ? stored[3]!.facturasRectificadas : stored[3]!.facturasSustituidas,
    ).toEqual({
      [kind === "credit" ? "IDFacturaRectificada" : "IDFacturaSustituida"]: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "A/1",
          FechaExpedicionFactura: "20-07-2026",
        },
      ],
    });
  },
);

it("a void retains the issued sale's origin after corrections from another origin", async () => {
  await versions("F2", "F2");
  const before = await suite.db
    .select()
    .from(registrosFacturacion)
    .orderBy(registrosFacturacion.secuencia);
  const result = await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`pragma reverse_unordered_selects = on`);
    try {
      return await backend.recordVoid(tx, originalSaleId, "Operator error");
    } finally {
      await tx.execute(sql`pragma reverse_unordered_selects = off`);
    }
  });
  const [stored] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, result.recordId));
  expect(stored).toMatchObject({
    source: "device",
    deviceId: node.deviceId,
    nodeId: node.nodeId,
    idEmisorFactura: "89890001K",
    numSerieFactura: "A/1",
    fechaExpedicionFactura: "2026-07-20",
    anteriorHuella: before[2]!.huella,
  });
  expect(
    (
      await suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia)
    ).slice(0, 3),
  ).toEqual(before);
});
