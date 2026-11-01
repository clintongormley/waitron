import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deviceOrigin } from "@waitron/shared";
import {
  buildAltaRecord,
  buildAnulacionRecord,
  serializeEnvio,
  type RegistroAlta,
  type RegistroAnulacion,
} from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { decodeRegistroRow, fromRegistroRow, toRegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedNode, seedSale, TEST_NIF, TEST_SISTEMA, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;

beforeEach(async () => {
  node = await seedNode(suite.db);
});

async function roundTrip(record: RegistroAlta | RegistroAnulacion) {
  const saleId = await seedSale(suite.db, node, 1);
  await suite.db.insert(registrosFacturacion).values(
    toRegistroRow(record, {
      origin: deviceOrigin(node.deviceId),
      nodeId: node.nodeId,
      sifId: node.sifId,
      saleId,
      secuencia: 1,
      offsetMinutes: 120,
      entorno: "preproduction",
      nombreRazonEmisor: "Waitron SL",
    }),
  );
  const { rows } = await suite.db.execute(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  return fromRegistroRow(decodeRegistroRow(rows[0]!));
}

const common = {
  SistemaInformatico: TEST_SISTEMA,
  generadoEn: new Date("2026-07-21T12:00:00Z"),
  offsetMinutes: 120,
  Encadenamiento: { PrimerRegistro: "S" as const },
};

it.each([
  { Subsanacion: "S", RechazoPrevio: "X" },
  { Subsanacion: "S", RechazoPrevio: "S" },
  { Subsanacion: "S", RechazoPrevio: "N" },
  { Subsanacion: "N", RechazoPrevio: "N" },
  {},
] as const)("retains an alta's remedy markers through storage and XML: %j", async (markers) => {
  const record = buildAltaRecord({
    ...common,
    ...markers,
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
  });
  const replay = await roundTrip(record);
  expect(replay).toEqual(record);
  const xml = serializeEnvio({ ObligadoEmision: { NIF: TEST_NIF, NombreRazon: "Waitron SL" } }, [
    { RegistroAlta: replay as RegistroAlta },
  ]);
  for (const field of ["Subsanacion", "RechazoPrevio"] as const) {
    const value = markers[field];
    if (value === undefined) expect(xml).not.toContain(`<sf:${field}>`);
    else expect(xml).toContain(`<sf:${field}>${value}</sf:${field}>`);
  }
  expect(xml).not.toContain("<sf:SinRegistroPrevio>");
});

it.each([
  { SinRegistroPrevio: "S", RechazoPrevio: "S" },
  { SinRegistroPrevio: "S", RechazoPrevio: "N" },
  { SinRegistroPrevio: "N", RechazoPrevio: "N" },
  {},
] as const)(
  "retains a cancellation's remedy markers through storage and XML: %j",
  async (markers) => {
    const record = buildAnulacionRecord({
      ...common,
      ...markers,
      IDEmisorFacturaAnulada: TEST_NIF,
      NumSerieFacturaAnulada: "REMEDY/1",
      FechaExpedicionFacturaAnulada: new Date("2026-07-21T00:00:00+02:00"),
    });
    const replay = await roundTrip(record);
    expect(replay).toEqual(record);
    const xml = serializeEnvio({ ObligadoEmision: { NIF: TEST_NIF, NombreRazon: "Waitron SL" } }, [
      { RegistroAnulacion: replay as RegistroAnulacion },
    ]);
    for (const field of ["SinRegistroPrevio", "RechazoPrevio"] as const) {
      const value = markers[field];
      if (value === undefined) expect(xml).not.toContain(`<sf:${field}>`);
      else expect(xml).toContain(`<sf:${field}>${value}</sf:${field}>`);
    }
    expect(xml).not.toContain("<sf:Subsanacion>");
  },
);
