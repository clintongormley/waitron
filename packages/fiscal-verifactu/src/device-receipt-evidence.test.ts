import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceOrigin, saleId } from "@waitron/shared";
import { buildAltaRecord } from "@waitron/verifactu";
import { pointerTo, toRegistroRow } from "./registro-row.js";
import { seedNode, seedSale, TEST_NIF, TEST_SISTEMA } from "./testing/seed.js";
import { recordSale } from "@waitron/core";
import { invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
describe("device receipt evidence", () => {
  it.each(["production", "preproduction"] as const)(
    "reads the stored %s invoice after issuer and backend settings change",
    async (environment) => {
      const { nodeId, seriesId } = await seedTenantWithSif(suite.db, { nif: "89890001K" });
      const backend = new VerifactuBackend({
        db: suite.db,
        clock: steadyClock,
        resolveClient: staticResolver(fakeClient),
        deploymentEnvironment: environment,
      });
      const result = await withTransaction(suite.db, (tx) =>
        recordSale(tx, backend, saleInput({ nodeId, seriesId })),
      );
      const [record] = await suite.db
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.saleId, result.saleId));
      await suite.db.update(tenants).set({ taxId: "changed-taxpayer" });
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: new Date("2026-03-02T00:00:00.000Z") })
        .where(eq(invoiceSeries.id, seriesId));
      const other = new VerifactuBackend({
        db: suite.db,
        clock: steadyClock,
        resolveClient: staticResolver(fakeClient),
        deploymentEnvironment: environment === "production" ? "preproduction" : "production",
      });
      const filed = await withTransaction(suite.db, (tx) =>
        other.invoiceEvidenceFor(tx, result.saleId),
      );
      expect(
        await withTransaction(suite.db, (tx) =>
          other.invoiceEvidenceFor(tx, saleId("a0000000-0000-4000-8000-000000000001")),
        ),
      ).toBeUndefined();
      expect(filed).toEqual({
        taxpayerId: "89890001K",
        environment,
        series: "A",
        invoiceNumber: "A/1",
        issuedDate: "2026-03-01",
        fingerprint: record!.huella,
      });
      expect(
        await suite.db
          .select()
          .from(registrosFacturacion)
          .where(eq(registrosFacturacion.saleId, result.saleId)),
      ).toEqual([record]);
    },
  );
});

it("has no device evidence for a sale without an original fiscal record", async () => {
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    resolveClient: staticResolver(fakeClient),
    deploymentEnvironment: "production",
  });
  expect(
    await withTransaction(suite.db, (tx) =>
      backend.invoiceEvidenceFor(tx, saleId("a0000000-0000-4000-8000-000000000001")),
    ),
  ).toBeUndefined();
});

it("keeps the original invoice fingerprint after a cancellation, in either query order", async () => {
  const { nodeId, seriesId } = await seedTenantWithSif(suite.db, { nif: "89890001K" });
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    resolveClient: staticResolver(fakeClient),
    deploymentEnvironment: "production",
  });
  const result = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId })),
  );
  const original = await withTransaction(suite.db, (tx) =>
    backend.invoiceEvidenceFor(tx, result.saleId),
  );
  await withTransaction(suite.db, (tx) =>
    backend.recordVoid(tx, result.saleId, "Recorded cancellation"),
  );
  await suite.db.execute(sql`pragma reverse_unordered_selects = on`);
  try {
    expect(
      await withTransaction(suite.db, (tx) => backend.invoiceEvidenceFor(tx, result.saleId)),
    ).toEqual(original);
  } finally {
    await suite.db.execute(sql`pragma reverse_unordered_selects = off`);
  }
});

it("reads the original fingerprint after a correction even when later rows are returned first", async () => {
  const node = await seedNode(suite.db);
  const id = await seedSale(suite.db, node, 1);
  let original: typeof registrosFacturacion.$inferSelect | undefined;
  for (const position of [1, 2]) {
    const built = buildAltaRecord({
      IDEmisorFactura: TEST_NIF,
      NumSerieFactura: "REMEDY/1",
      FechaExpedicionFactura: new Date("2026-07-21T00:00:00+02:00"),
      NombreRazonEmisor: "Venue",
      TipoFactura: "F2",
      ...(original === undefined ? {} : { Subsanacion: "S" as const }),
      DescripcionOperacion: position === 1 ? "Restaurant service" : "Corrected description",
      Desglose: [
        {
          BaseImponibleOimporteNoSujeto: "100.00",
          CuotaRepercutida: "21.00",
          TipoImpositivo: "21.00",
          CalificacionOperacion: "S1",
        },
      ],
      CuotaTotal: "21.00",
      ImporteTotal: "121.00",
      SistemaInformatico: TEST_SISTEMA,
      generadoEn: new Date(Date.UTC(2026, 6, 21, 12, 0, position)),
      offsetMinutes: 120,
      Encadenamiento:
        original === undefined
          ? { PrimerRegistro: "S" }
          : { RegistroAnterior: pointerTo(original) },
    });
    const [stored] = await suite.db
      .insert(registrosFacturacion)
      .values({
        ...toRegistroRow(built, {
          origin: deviceOrigin(node.deviceId),
          nodeId: node.nodeId,
          sifId: node.sifId,
          saleId: id,
          secuencia: position,
          offsetMinutes: 120,
          entorno: "preproduction",
        }),
        correctsRegistroId: original?.id ?? null,
      })
      .returning();
    original ??= stored!;
  }
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    resolveClient: staticResolver(fakeClient),
    deploymentEnvironment: "production",
  });
  await suite.db.execute(sql`pragma reverse_unordered_selects = on`);
  try {
    expect(await withTransaction(suite.db, (tx) => backend.invoiceEvidenceFor(tx, id))).toEqual({
      taxpayerId: TEST_NIF,
      environment: "preproduction",
      series: "REMEDY",
      invoiceNumber: "REMEDY/1",
      issuedDate: "2026-07-21",
      fingerprint: original!.huella,
    });
  } finally {
    await suite.db.execute(sql`pragma reverse_unordered_selects = off`);
  }
});
