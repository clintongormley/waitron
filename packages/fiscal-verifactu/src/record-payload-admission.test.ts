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
import { registrosFacturacion } from "./schema/registros.js";
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
        await tx.insert(registrosFacturacion).values(
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
    expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
  },
);

/** An alta of the given type carrying an operation date, as a row ready to store. */
function altaRowWithOperationDate(
  type: Pick<AltaInput, "TipoFactura" | "TipoRectificativa" | "ImporteRectificacion">,
) {
  const pending = altaFor(node, saleId, 1, 1, "preproduction");
  const corrective = type.TipoFactura === "R5" && {
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
  { name: "a simplified invoice", type: { TipoFactura: "F2" } },
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
        await tx.insert(registrosFacturacion).values(
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
    expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
  },
);

it("leaves original records and the chain head intact when a correction contains unsupported fields", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const before = await suite.db.select().from(registrosFacturacion);
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
  expect(await suite.db.select().from(registrosFacturacion)).toEqual(before);
  expect(await readChainHead(suite.db, node.nodeId)).toEqual(head);
});
