import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { checkFiscalChains } from "./handover-chain-check.js";
import { readReturnedOriginals } from "./handover-return.js";
import { altaFor, anulacionFor, seedNode, seedSale } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

async function checkFixture() {
  const directory = await mkdtemp(join(tmpdir(), "waitron-return-fixture-"));
  try {
    const file = join(directory, "copy.db");
    await archiveTo(suite.db, file);
    const opened = await openBackupQuery(file);
    try {
      expect(await checkFiscalChains(opened.query)).toBe("ok");
    } finally {
      await opened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function original(label: string, invoice: number) {
  const node = await seedNode(suite.db, label);
  const [identity] = suite.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where id = ${node.sifId}`,
  );
  const saleId = await seedSale(suite.db, node, invoice);
  const pending = altaFor(node, saleId, invoice, invoice);
  pending.input.IDEmisorFactura = identity!.nif;
  pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
  pending.input.NumSerieFactura = `${label}/${invoice}`;
  await withTransaction(suite.db, (tx) => appendToChain(tx, node.nodeId, pending));
  await checkFixture();
  const [record] = suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion where sale_id = ${saleId}`,
  );
  return {
    ...node,
    saleId,
    recordId: record!.id,
    issuerTaxId: identity!.nif,
    installation: identity!.numero_instalacion,
  };
}

it("selects only the returning node's originals and keeps their stored bytes", async () => {
  const source = await original("Source", 1);
  await original("Other", 2);

  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(returned.records.map((row) => row.id)).toEqual([source.recordId]);
  expect(returned.records[0]).toMatchObject({
    node_id: source.nodeId,
    sale_id: source.saleId,
    secuencia: 1,
    offset_minutos: 120,
    cuota_total: "21.43",
    importe_total: "123.45",
    num_serie_factura: "Source/1",
  });
  expect(returned.sales.map((row) => row.id)).toEqual([source.saleId]);
  expect(returned.devices.map((row) => row.id)).toEqual([source.deviceId]);
  expect(returned.heads.map((row) => row.node_id)).toEqual([source.nodeId]);
  expect(JSON.parse(JSON.stringify(returned))).toEqual(returned);
});

it("re-enumerates late payment facts even when the original inventory has no new record", async () => {
  const source = await original("Source", 1);
  const before = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await suite.db.insert(tenders).values({
    id: "late-tender",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const afterTender = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  expect(afterTender.inventory).not.toBe(before.inventory);
  await suite.db.insert(saleSettlements).values({
    id: "late-settlement",
    saleId: source.saleId,
    settledAt: "2026-07-20T17:21:00.000Z",
  });

  const after = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));

  expect(after.records).toEqual(before.records);
  expect(after.tenders).toEqual([
    {
      id: "late-tender",
      sale_id: source.saleId,
      method: "cash",
      amount: 200,
      cash_tendered: null,
      tip_amount: 200,
      settled_at: "2026-07-20T17:21:00.000Z",
      bill_payment_id: null,
    },
  ]);
  expect(after.settlements).toEqual([
    { id: "late-settlement", sale_id: source.saleId, settled_at: "2026-07-20T17:21:00.000Z" },
  ]);
  expect(after.inventory).not.toBe(before.inventory);
  expect(after.inventory).not.toBe(afterTender.inventory);
});

it("does not use mutable delivery outcomes as the original inventory fingerprint", async () => {
  const source = await original("Source", 1);
  const before = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await suite.db.execute(sql`insert into envios
    (registro_id, estado, proximo_intento_en, csv, confirmado_en)
    values (${source.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z',
      'kept-csv', '2026-07-20T17:21:00.000Z')`);

  const after = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));

  expect(after.inventory).toBe(before.inventory);
  expect(after.deliveries).toEqual([
    expect.objectContaining({ registro_id: source.recordId, estado: "aceptado", csv: "kept-csv" }),
  ]);
});

it("includes the cancellation fact alongside the original and its cancellation record", async () => {
  const source = await original("Source", 1);
  const before = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(saleVoids).values({
      id: "returned-void",
      saleId: source.saleId,
      reason: "Incorrect invoice",
      voidedAt: "2026-07-20T17:20:03.000Z",
    });
    const pending = anulacionFor(source, source.saleId, 1, 3);
    pending.input.IDEmisorFacturaAnulada = source.issuerTaxId;
    pending.input.SistemaInformatico.NumeroInstalacion = source.installation;
    pending.input.NumSerieFacturaAnulada = "Source/1";
    await appendToChain(tx, source.nodeId, pending);
  });
  await checkFixture();

  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(returned.records.map((row) => row.tipo_registro)).toEqual(["alta", "anulacion"]);
  expect(returned.voids).toEqual([
    {
      id: "returned-void",
      sale_id: source.saleId,
      reason: "Incorrect invoice",
      voided_at: "2026-07-20T17:20:03.000Z",
      voided_by: null,
    },
  ]);
  expect(returned.inventory).not.toBe(before.inventory);
});

it("includes the replacement-invoice fact with both commercial originals", async () => {
  const source = await original("Source", 1);
  const replacementSaleId = await seedSale(suite.db, source, 2);
  await withTransaction(suite.db, async (tx) => {
    const pending = altaFor(source, replacementSaleId, 2, 3);
    pending.input.IDEmisorFactura = source.issuerTaxId;
    pending.input.SistemaInformatico.NumeroInstalacion = source.installation;
    pending.input.NumSerieFactura = "Source/2";
    pending.input.TipoFactura = "F3";
    pending.input.FacturasSustituidas = [
      {
        IDEmisorFactura: pending.input.IDEmisorFactura,
        NumSerieFactura: "Source/1",
        FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
      },
    ];
    pending.input.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "Customer", NIF: "89890001K" }],
    };
    await appendToChain(tx, source.nodeId, pending);
    await tx.insert(saleSubstitutions).values({
      id: "returned-substitution",
      substitutionSaleId: replacementSaleId,
      substitutedSaleId: source.saleId,
    });
  });
  await checkFixture();

  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(returned.substitutions).toEqual([
    {
      id: "returned-substitution",
      substitution_sale_id: replacementSaleId,
      substituted_sale_id: source.saleId,
    },
  ]);
  expect(returned.sales.map((row) => row.id).sort()).toEqual(
    [source.saleId, replacementSaleId].sort(),
  );
});
