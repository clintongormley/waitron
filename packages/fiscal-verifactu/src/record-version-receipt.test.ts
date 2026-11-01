import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deviceOrigin, type SaleId } from "@waitron/shared";
import { buildAltaRecord } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { pointerTo, toRegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedNode, seedSale, TEST_NIF, TEST_SISTEMA, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;
let saleId: SaleId;
let backend: VerifactuBackend;

beforeEach(async () => {
  node = await seedNode(suite.db);
  saleId = await seedSale(suite.db, node, 1);
  backend = new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function storeVersion(
  position: number,
  facts: { issuerName: string; base: string; tax: string; total: string },
  previous?: typeof registrosFacturacion.$inferSelect,
) {
  const built = buildAltaRecord({
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: "REMEDY/1",
    FechaExpedicionFactura: new Date("2026-07-21T00:00:00+02:00"),
    NombreRazonEmisor: facts.issuerName,
    TipoFactura: "F2",
    ...(previous === undefined ? {} : { Subsanacion: "S" as const }),
    DescripcionOperacion: "Restaurant service",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: facts.base,
        CuotaRepercutida: facts.tax,
        TipoImpositivo: "21.00",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: facts.tax,
    ImporteTotal: facts.total,
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 21, 12, 0, position)),
    offsetMinutes: 120,
    Encadenamiento:
      previous === undefined ? { PrimerRegistro: "S" } : { RegistroAnterior: pointerTo(previous) },
  });
  const [stored] = await suite.db
    .insert(registrosFacturacion)
    .values({
      ...toRegistroRow(built, {
        origin: deviceOrigin(node.deviceId),
        nodeId: node.nodeId,
        sifId: node.sifId,
        saleId,
        secuencia: position,
        offsetMinutes: 120,
        entorno: "preproduction",
      }),
      correctsRegistroId: previous?.id ?? null,
    })
    .returning();
  return stored!;
}

it.each([false, true])(
  "replays the original issued receipt after two corrections (reverse query order: %s)",
  async (reverseOrder) => {
    const original = await storeVersion(1, {
      issuerName: "Original venue",
      base: "100.00",
      tax: "21.00",
      total: "121.00",
    });
    const issued = await withTransaction(suite.db, (tx) => backend.filedReceiptFor(tx, saleId));
    expect(issued).toEqual({
      issuer: { legalName: "Original venue", taxId: TEST_NIF },
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
      verificationUrl: expect.stringContaining("importe=121.00"),
    });
    const first = await storeVersion(
      2,
      { issuerName: "First corrected venue", base: "200.00", tax: "42.00", total: "242.00" },
      original,
    );
    await storeVersion(
      3,
      { issuerName: "Second corrected venue", base: "300.00", tax: "63.00", total: "363.00" },
      first,
    );

    const replay = await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        reverseOrder
          ? sql`pragma reverse_unordered_selects = on`
          : sql`pragma reverse_unordered_selects = off`,
      );
      try {
        return await backend.filedReceiptFor(tx, saleId);
      } finally {
        await tx.execute(sql`pragma reverse_unordered_selects = off`);
      }
    });
    expect(replay).toEqual(issued);
    const [saved] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, original.id));
    expect(saved).toEqual(original);
  },
);
