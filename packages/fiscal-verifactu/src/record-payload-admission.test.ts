import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deviceOrigin, type SaleId } from "@waitron/shared";
import {
  buildAltaRecord,
  buildAnulacionRecord,
  type AltaInput,
  type AnulacionInput,
} from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain, readChainHead } from "./chain.js";
import { toRegistroRow } from "./registro-row.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import {
  altaFor,
  anulacionFor,
  seedNode,
  seedSale,
  TEST_NIF,
  type SeededNode,
} from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;
let saleId: SaleId;

beforeEach(async () => {
  node = await seedNode(suite.db);
  saleId = await seedSale(suite.db, node, 1);
});

const unsupportedAlta = [
  { field: "RefExterna", value: "operator-reference" },
  { field: "FacturaSimplificadaArt7273", value: "S" },
  { field: "FacturaSinIdentifDestinatarioArt61d", value: "N" },
  { field: "Macrodato", value: "N" },
  { field: "EmitidaPorTerceroODestinatario", value: "D" },
  { field: "Tercero", value: { NombreRazon: "Third party SL", NIF: TEST_NIF } },
  { field: "Cupon", value: "N" },
  { field: "NumRegistroAcuerdoFacturacion", value: "AGREEMENT-1" },
  { field: "IdAcuerdoSistemaInformatico", value: "SYSTEM-1" },
] as const satisfies ReadonlyArray<{ field: keyof AltaInput; value: unknown }>;

it.each(unsupportedAlta)(
  "refuses to store an alta that would lose $field",
  async ({ field, value }) => {
    const pending = altaFor(node, saleId, 1, 1, "preproduction");
    const record = buildAltaRecord({
      ...pending.input,
      [field]: value,
      Encadenamiento: { PrimerRegistro: "S" },
    });
    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.insert(verifactuRecords).values(
          toRegistroRow(record, {
            origin: deviceOrigin(node.deviceId),
            nodeId: node.nodeId,
            sifId: node.sifId,
            saleId,
            secuencia: 1,
            offsetMinutes: 120,
            entorno: "preproduction",
          }),
        );
      }),
    ).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: [field], codes: ["UNSUPPORTED_FIELD"] },
    });
    expect(await suite.db.select().from(verifactuRecords)).toEqual([]);
  },
);

/** An alta of the given type carrying an operation date, as a row ready to store. */
function altaRowWithOperationDate(
  type: Pick<AltaInput, "TipoFactura" | "TipoRectificativa" | "ImporteRectificacion">,
) {
  const pending = altaFor(node, saleId, 1, 1, "preproduction");
  const corrective = type.TipoFactura.startsWith("R") && {
    FacturasRectificadas: [
      {
        IDEmisorFactura: TEST_NIF,
        NumSerieFactura: "A/9",
        FechaExpedicionFactura: new Date("2026-07-18T00:00:00+02:00"),
      },
    ],
  };
  const record = buildAltaRecord({
    ...pending.input,
    ...type,
    ...corrective,
    FechaOperacion: new Date("2026-07-18T00:00:00+02:00"),
    Encadenamiento: { PrimerRegistro: "S" },
  });
  return toRegistroRow(record, {
    origin: deviceOrigin(node.deviceId),
    nodeId: node.nodeId,
    sifId: node.sifId,
    saleId,
    secuencia: 1,
    offsetMinutes: 120,
    entorno: "preproduction",
  });
}

it.each([
  { name: "a simplified invoice (F2)", type: { TipoFactura: "F2" } },
  { name: "a full invoice (F1)", type: { TipoFactura: "F1" } },
] as const)("stores the operation date of $name", ({ type }) => {
  const row = altaRowWithOperationDate(type);

  expect(row.fechaOperacion).toBe("2026-07-18");
});

it.each([
  { name: "a full invoice for tickets (F3)", type: { TipoFactura: "F3" } },
  { name: "a corrective by differences", type: { TipoFactura: "R5", TipoRectificativa: "I" } },
] as const)("refuses to store an operation date on $name", ({ type }) => {
  expect(() => altaRowWithOperationDate(type)).toThrow(
    expect.objectContaining({
      code: "fiscal.record_invalid",
      params: { fields: ["FechaOperacion"], codes: ["UNSUPPORTED_FIELD"] },
    }),
  );
});

it("stores the operation date of a replacement corrective (R5 by replacement)", () => {
  const row = altaRowWithOperationDate({
    TipoFactura: "R5",
    TipoRectificativa: "S",
    ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
  });

  expect(row.fechaOperacion).toBe("2026-07-18");
});

it.each([
  { name: "an R1 by replacement", type: { TipoFactura: "R1", TipoRectificativa: "S" } },
  { name: "an R2 by replacement", type: { TipoFactura: "R2", TipoRectificativa: "S" } },
  { name: "an R3 by replacement", type: { TipoFactura: "R3", TipoRectificativa: "S" } },
  { name: "an R4 by differences", type: { TipoFactura: "R4", TipoRectificativa: "I" } },
] as const)("refuses to store an operation date on $name", ({ type }) => {
  expect(() =>
    altaRowWithOperationDate({
      ...type,
      ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
    }),
  ).toThrow(
    expect.objectContaining({
      code: "fiscal.record_invalid",
      params: { fields: ["FechaOperacion"], codes: ["UNSUPPORTED_FIELD"] },
    }),
  );
});

it("stores the operation date of a full invoice's replacement (R4 by replacement)", () => {
  const row = altaRowWithOperationDate({
    TipoFactura: "R4",
    TipoRectificativa: "S",
    ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
  });

  expect(row.fechaOperacion).toBe("2026-07-18");
});

it.each([
  { field: "RefExterna", value: "operator-reference" },
  { field: "GeneradoPor", value: "E" },
  { field: "Generador", value: { NombreRazon: "Third party SL", NIF: TEST_NIF } },
] as const satisfies ReadonlyArray<{ field: keyof AnulacionInput; value: unknown }>)(
  "refuses to store a cancellation that would lose $field",
  async ({ field, value }) => {
    const pending = anulacionFor(node, saleId, 1, 1, "preproduction");
    const record = buildAnulacionRecord({
      ...pending.input,
      [field]: value,
      Encadenamiento: { PrimerRegistro: "S" },
    });
    await expect(
      withTransaction(suite.db, async (tx) => {
        await tx.insert(verifactuRecords).values(
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
      }),
    ).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: [field], codes: ["UNSUPPORTED_FIELD"] },
    });
    expect(await suite.db.select().from(verifactuRecords)).toEqual([]);
  },
);

it("leaves original records and the chain head intact when a correction contains unsupported fields", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const before = await suite.db.select().from(verifactuRecords);
  const head = await readChainHead(suite.db, node.nodeId);
  const pending = altaFor(node, saleId, 1, 2, "preproduction");
  await expect(
    withTransaction(suite.db, (tx) =>
      appendToChain(tx, node.nodeId, {
        ...pending,
        correctsRegistroId: original.id,
        input: {
          ...pending.input,
          Subsanacion: "S",
          RechazoPrevio: "X",
          Cupon: "N",
        },
      }),
    ),
  ).rejects.toMatchObject({
    code: "fiscal.record_invalid",
    params: {
      fields: ["Cupon"],
      codes: ["UNSUPPORTED_FIELD"],
    },
  });
  expect(await suite.db.select().from(verifactuRecords)).toEqual(before);
  expect(await readChainHead(suite.db, node.nodeId)).toEqual(head);
});
