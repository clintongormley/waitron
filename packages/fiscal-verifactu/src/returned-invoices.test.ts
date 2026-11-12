import { appendOriginalForReturn } from "./testing/returned-invoice.js";
import type { CanonicalValue } from "@waitron/membership";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";
import {
  readReturnedOriginals,
  receiveReturnedOriginals,
  type ReturnRow,
} from "./handover-return.js";
import { returnedInvoices, storedBases } from "./returned-invoices.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";

const source = useVenueDb({ migrations: TEST_MIGRATIONS });
const receiver = useVenueDb({ migrations: TEST_MIGRATIONS });
const receivedAt = new Date("2026-07-20T18:00:00.000Z");
async function fixture() {
  const node = await seedNode(source.db, "Returning");
  await withTransaction(receiver.db, async (tx) => {
    for (const table of [
      "tenants",
      "locations",
      "settings",
      "device_profiles",
      "nodes",
      "invoice_series",
      "registro_sif",
      "cadenas",
      "devices",
    ]) {
      for (const row of source.db.all<ReturnRow>(sql`select * from ${sql.identifier(table)}`)) {
        const entries = Object.entries(row);
        await tx.execute(sql`insert into ${sql.identifier(table)}
          (${sql.join(
            entries.map(([key]) => sql.identifier(key)),
            sql`, `,
          )})
          values (${sql.join(
            entries.map(([, value]) => sql`${value}`),
            sql`, `,
          )})`);
      }
    }
  });
  return node;
}
const append = (node: SeededNode, number: number) =>
  appendOriginalForReturn(source.db, node, number);
async function inventory(node: SeededNode) {
  return withTransaction(source.db, (tx) => readReturnedOriginals(tx, node.nodeId));
}
async function receive(
  node: SeededNode,
  batch: Awaited<ReturnType<typeof inventory>>,
  now = receivedAt,
) {
  return withTransaction(receiver.db, (tx) =>
    VERIFACTU_HANDOVER.returnRecords!.receive(
      tx,
      node.nodeId,
      batch as unknown as CanonicalValue,
      now,
      [],
    ),
  );
}
function markers() {
  return receiver.db.all(sql`select * from returned_invoice_records order by record_id`);
}

it("marks only newly imported originals and keeps their first receipt on replay", async () => {
  const node = await fixture();
  await append(node, 1);
  const copied = await inventory(node);
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, node.nodeId, copied, receivedAt),
  );
  const imported = await append(node, 2);
  const batch = await inventory(node);
  expect(await receive(node, batch)).toBe(true);
  expect(markers()).toEqual([{ record_id: imported, received_at: receivedAt.toISOString() }]);
  expect(await receive(node, batch, new Date("2026-07-21T18:00:00Z"))).toBe(true);
  expect(markers()).toEqual([{ record_id: imported, received_at: receivedAt.toISOString() }]);
});

it("marks an imported prefix even when a later record is refused", async () => {
  const node = await fixture();
  await append(node, 1);
  const copied = await inventory(node);
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, node.nodeId, copied, receivedAt),
  );
  const prefix = await append(node, 2);
  await append(node, 3);
  const batch = await inventory(node);
  batch.records[2]!.num_serie_factura = batch.records[0]!.num_serie_factura!;
  expect(await receive(node, batch)).toEqual({ refusal: "fiscal.return_record_clash" });
  expect(markers()).toEqual([{ record_id: prefix, received_at: receivedAt.toISOString() }]);
  expect(
    receiver.db.all(sql`select secuencia from registros_facturacion order by secuencia`),
  ).toEqual([{ secuencia: 1 }, { secuencia: 2 }]);
});

it("marks originals in an incomplete payment batch and rolls back with the caller", async () => {
  const node = await fixture();
  const id = await append(node, 1);
  const batch = await inventory(node);
  batch.voids.push({ id: "unreceived-void", sale_id: "unreceived-sale" });
  expect(await receive(node, batch)).toBe(false);
  expect(markers()).toEqual([{ record_id: id, received_at: receivedAt.toISOString() }]);
  const second = await append(node, 2);
  const later = await inventory(node);
  const aborted = new Error("abort caller");
  await expect(
    withTransaction(receiver.db, async (tx) => {
      await VERIFACTU_HANDOVER.returnRecords!.receive(
        tx,
        node.nodeId,
        later as unknown as CanonicalValue,
        receivedAt,
        [],
      );
      throw aborted;
    }),
  ).rejects.toBe(aborted);
  expect(markers()).toEqual([{ record_id: id, received_at: receivedAt.toISOString() }]);
  expect(
    receiver.db.get(sql`select id from registros_facturacion where id = ${second}`),
  ).toBeUndefined();
});

it("reads only marked invoices with stored bases and separate record kinds", async () => {
  const node = await fixture();
  const id = await append(node, 1);
  await receive(node, await inventory(node));
  const rows = await withTransaction(receiver.db, (tx) =>
    returnedInvoices(tx, { offset: 0, limit: 101 }),
  );
  expect(rows).toEqual([
    {
      recordId: id,
      saleId: (await inventory(node)).records[0]!.sale_id,
      sourceNodeId: node.nodeId,
      sourceName: "Node Returning",
      generationId: node.sifId,
      installation: source.db.get<{ value: string }>(
        sql`select numero_instalacion as value from registro_sif where id = ${node.sifId}`,
      )!.value,
      sequence: 1,
      invoiceNumber: "A/1",
      issueDate: "2026-07-20",
      kind: "F2",
      category: "simplified",
      correctsRecordId: null,
      taxable: "102.02",
      gross: "123.45",
      tax: "21.43",
      receivedAt: receivedAt.toISOString(),
    },
  ]);
  expect(
    await withTransaction(receiver.db, (tx) => returnedInvoices(tx, { offset: 1, limit: 101 })),
  ).toEqual([]);
});

it("keeps cancellations separate and orders receipt time before chain position", async () => {
  const node = await fixture();
  const id = await append(node, 1);
  const first = await inventory(node);
  await receive(node, first);
  const pending = anulacionFor(node, first.records[0]!.sale_id as never, 1, 2);
  pending.input.IDEmisorFacturaAnulada = String(first.records[0]!.id_emisor_factura);
  pending.input.SistemaInformatico.NumeroInstalacion = source.db.get<{ value: string }>(
    sql`select numero_instalacion as value from registro_sif where id = ${node.sifId}`,
  )!.value;
  await withTransaction(source.db, (tx) => appendToChain(tx, node.nodeId, pending));
  const second = await append(node, 2);
  await receive(node, await inventory(node), new Date("2026-07-21T18:00:00Z"));
  const read = (offset: number, limit: number) =>
    withTransaction(receiver.db, (tx) => returnedInvoices(tx, { offset, limit }));
  const rows = await read(0, 3);
  expect(rows.map((row) => [row.sequence, row.kind, row.taxable, row.gross, row.tax])).toEqual([
    [2, "cancellation", null, null, null],
    [3, "F2", "102.02", "123.45", "21.43"],
    [1, "F2", "102.02", "123.45", "21.43"],
  ]);
  expect(rows.map((row) => row.recordId)).toEqual([expect.any(String), second, id]);
  expect(await read(1, 1)).toEqual([rows[1]]);
  expect(await read(3, 101)).toEqual([]);
});

it("sums the stored bases exactly instead of subtracting totals, and retains correction references", async () => {
  const node = await fixture();
  const original = await append(node, 1);
  const first = await inventory(node);
  const sale = first.records[0]!.sale_id as never;
  const pending = altaFor(node, sale, 1, 2);
  pending.input.IDEmisorFactura = String(first.records[0]!.id_emisor_factura);
  pending.input.SistemaInformatico.NumeroInstalacion = source.db.get<{ value: string }>(
    sql`select numero_instalacion as value from registro_sif where id = ${node.sifId}`,
  )!.value;
  pending.input.Subsanacion = "S";
  pending.input.Desglose = ["0.10", "0.20"].map((base, i) => ({
    BaseImponibleOimporteNoSujeto: base,
    CuotaRepercutida: i === 0 ? "0.01" : "0.02",
    TipoImpositivo: "10.00",
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
  }));
  pending.input.CuotaTotal = "0.03";
  pending.input.ImporteTotal = "0.34";
  await withTransaction(source.db, (tx) =>
    appendToChain(tx, node.nodeId, { ...pending, correctsRegistroId: original }),
  );
  expect(await receive(node, await inventory(node))).toBe(true);
  const rows = await withTransaction(receiver.db, (tx) =>
    returnedInvoices(tx, { offset: 0, limit: 101 }),
  );
  expect(rows[1]).toMatchObject({
    correctsRecordId: original,
    taxable: "0.30",
    gross: "0.34",
    tax: "0.03",
  });
});

it.each([
  ["F1", "invoice"],
  ["F2", "simplified"],
  ["F3", "replacement"],
  ["R1", "correction"],
  ["R2", "correction"],
  ["R3", "correction"],
  ["R4", "correction"],
  ["R5", "correction"],
] as const)("keeps original type %s beside neutral category %s", async (kind, category) => {
  const node = await fixture();
  const original = await append(node, 1);
  const first = await inventory(node);
  const sale = await seedSale(source.db, node, 2);
  const pending = altaFor(node, sale, 2, 2);
  pending.input.IDEmisorFactura = String(first.records[0]!.id_emisor_factura);
  pending.input.SistemaInformatico.NumeroInstalacion = source.db.get<{ value: string }>(
    sql`select numero_instalacion as value from registro_sif where id = ${node.sifId}`,
  )!.value;
  pending.input.TipoFactura = kind;
  if (kind !== "F2" && kind !== "R5")
    pending.input.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "Customer", NIF: "89890001K" }],
    };
  const reference = {
    IDEmisorFactura: pending.input.IDEmisorFactura,
    NumSerieFactura: "A/1",
    FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
  };
  if (kind === "F3") pending.input.FacturasSustituidas = [reference];
  if (kind.startsWith("R")) {
    pending.input.TipoRectificativa = "I";
    pending.input.FacturasRectificadas = [reference];
  }
  await withTransaction(source.db, (tx) => appendToChain(tx, node.nodeId, pending));
  expect(await receive(node, await inventory(node))).toBe(true);
  const rows = await withTransaction(receiver.db, (tx) =>
    returnedInvoices(tx, { offset: 0, limit: 101 }),
  );
  expect(rows[0]!.recordId).toBe(original);
  expect(rows[1]).toMatchObject({ kind, category });
});

it.each(["[{}]", '[{"BaseImponibleOimporteNoSujeto":7}]'])(
  "leaves a missing or non-string stored base unrecorded (%s)",
  (breakdown) => {
    expect(storedBases(breakdown)).toBeNull();
  },
);
