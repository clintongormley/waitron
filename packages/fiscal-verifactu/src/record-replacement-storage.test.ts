import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { captureError, constraintTarget, isRefusal, isUniqueViolation } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { buildAltaRecord } from "@waitron/verifactu";
import { deviceOrigin, type SaleId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { pointerTo, toRegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedNode, seedSale, TEST_NIF, TEST_SISTEMA, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;
let saleId: SaleId;

beforeEach(async () => {
  node = await seedNode(suite.db);
  saleId = await seedSale(suite.db, node, 1);
});

function rowFor(
  position: number,
  previous?: typeof registrosFacturacion.$inferSelect,
  correctsRegistroId: string | null = null,
) {
  const built = buildAltaRecord({
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: "REMEDY/1",
    FechaExpedicionFactura: new Date("2026-07-21T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Restaurant service",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
        TipoImpositivo: "21",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "21.00",
    ImporteTotal: "121.00",
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 21, 12, 0, position)),
    offsetMinutes: 120,
    Encadenamiento:
      previous === undefined ? { PrimerRegistro: "S" } : { RegistroAnterior: pointerTo(previous) },
  });
  return {
    ...toRegistroRow(built, {
      origin: deviceOrigin(node.deviceId),
      nodeId: node.nodeId,
      sifId: node.sifId,
      saleId,
      secuencia: position,
      offsetMinutes: 120,
      entorno: "preproduction",
    }),
    correctsRegistroId,
  };
}

it("stores two successive replacements under the original invoice identity without changing older rows", async () => {
  const [original] = await suite.db.insert(registrosFacturacion).values(rowFor(1)).returning();
  const [first] = await suite.db
    .insert(registrosFacturacion)
    .values(rowFor(2, original!, original!.id))
    .returning();
  const [second] = await suite.db
    .insert(registrosFacturacion)
    .values(rowFor(3, first!, first!.id))
    .returning();

  expect(first!.correctsRegistroId).toBe(original!.id);
  expect(second!.correctsRegistroId).toBe(first!.id);
  for (const replacement of [first!, second!]) {
    expect([
      replacement.idEmisorFactura,
      replacement.numSerieFactura,
      replacement.fechaExpedicionFactura,
    ]).toEqual([TEST_NIF, "REMEDY/1", "2026-07-21"]);
    expect(replacement.id).not.toBe(original!.id);
    expect(replacement.huella).not.toBe(original!.huella);
  }
  const [savedOriginal] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, original!.id));
  const [savedFirst] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, first!.id));
  expect(savedOriginal).toEqual(original);
  expect(savedFirst).toEqual(first);
});

it("refuses two concurrent replacements of one version on the replacement key", async () => {
  const [original] = await suite.db.insert(registrosFacturacion).values(rowFor(1)).returning();
  const attempts = await Promise.allSettled(
    [2, 3].map((position) =>
      suite.db
        .insert(registrosFacturacion)
        .values(rowFor(position, original!, original!.id))
        .returning(),
    ),
  );
  expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  expect(isUniqueViolation(rejected?.reason)).toBe(true);
  expect(constraintTarget(rejected?.reason)).toEqual({
    table: "registros_facturacion",
    columns: ["corrects_registro_id"],
  });
  expect(await suite.db.select().from(registrosFacturacion)).toHaveLength(2);
});

it("refuses a replacement naming a missing record", async () => {
  const error = await captureError(() =>
    suite.db.insert(registrosFacturacion).values(rowFor(1, undefined, "missing-record")),
  );
  expect(isRefusal(error, [787])).toBe(true);
  expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
});

it("still refuses a second original with the same invoice identity", async () => {
  const [original] = await suite.db.insert(registrosFacturacion).values(rowFor(1)).returning();
  const error = await captureError(() =>
    suite.db.insert(registrosFacturacion).values(rowFor(2, original!)),
  );
  expect(isUniqueViolation(error)).toBe(true);
  expect(constraintTarget(error)).toEqual({
    table: "registros_facturacion",
    columns: [
      "id_emisor_factura",
      "num_serie_factura",
      "fecha_expedicion_factura",
      "tipo_registro",
    ],
  });
  expect(await suite.db.select().from(registrosFacturacion)).toEqual([original]);
});
