import { seedPerson as seedResolutionAuthor } from "@waitron/db/testing/seed.js";
import { deliveryColumns } from "../test/drain-fixtures.js";
import type { CanonicalValue } from "@waitron/membership";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  insertInChunks,
  billPayments,
  departments,
  type Database,
  sales,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  refunds,
  withTransaction,
} from "@waitron/db";
import { saleId } from "@waitron/shared";
import { seedPerson, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { inspectReturnedPayments } from "./handover-return.js";
import { listFilingCases, openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { appendToChain, readChainHead } from "./chain.js";
import { checkFiscalChains } from "./handover-chain-check.js";
import {
  makeReturnedBatches,
  readOtherBoxesOriginals,
  readReturnedOriginals,
  readReturnedBatch,
  receiveReturnedOriginals,
  type ReturnRow,
} from "./handover-return.js";
import {
  addDeviceToNode,
  altaFor,
  anulacionFor,
  seedNode,
  seedSale,
  type SeededNode,
} from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const receiver = useVenueDb({ migrations: TEST_MIGRATIONS });

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

async function original(
  label: string,
  invoice: number,
  beforeRecord?: (node: SeededNode) => Promise<void>,
) {
  const node = await seedNode(suite.db, label);
  await beforeRecord?.(node);
  return appendOriginal(node, label, invoice);
}

async function appendOriginal(
  node: SeededNode,
  label: string,
  invoice: number,
  existingSaleId?: ReturnType<typeof saleId>,
) {
  const [identity] = suite.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from verifactu_identities where id = ${node.sifId}`,
  );
  const saleId = existingSaleId ?? (await seedSale(suite.db, node, invoice));
  const pending = altaFor(node, saleId, invoice, invoice);
  pending.input.IDEmisorFactura = identity!.nif;
  pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
  pending.input.NumSerieFactura = `${label}/${invoice}`;
  await withTransaction(suite.db, (tx) => appendToChain(tx, node.nodeId, pending));
  await checkFixture();
  const [record] = suite.db.all<{ id: string }>(
    sql`select id from verifactu_records where sale_id = ${saleId}`,
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
  const [batch] = makeReturnedBatches(returned);
  const payload = JSON.parse(JSON.stringify(batch)) as CanonicalValue;
  expect(payload).not.toHaveProperty("heads");
  expect(readReturnedBatch(payload)).toEqual(returned);
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
  expect(makeReturnedBatches(afterTender).flatMap((batch) => batch.tenders)).toHaveLength(1);
  expect(makeReturnedBatches(before).flatMap((batch) => batch.tenders)).toEqual([]);
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
  expect(makeReturnedBatches(after).flatMap((batch) => batch.settlements)).toEqual(
    after.settlements,
  );
  expect(makeReturnedBatches(afterTender).flatMap((batch) => batch.settlements)).toEqual([]);
});

it("reads a later delivery verdict without changing the original bytes", async () => {
  const source = await original("Source", 1);
  const before = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await suite.db.execute(sql`insert into verifactu_submissions
    (registro_id, estado, proximo_intento_en, csv, confirmado_en)
    values (${source.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z',
      'kept-csv', '2026-07-20T17:21:00.000Z')`);

  const after = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));

  expect(after.records).toEqual(before.records);
  expect(after.deliveries).toEqual([
    expect.objectContaining({ registro_id: source.recordId, estado: "aceptado", csv: "kept-csv" }),
  ]);
});

it.each([false, true])(
  "includes the cancellation and its filing case when retained=%s",
  async (retained) => {
    const source = await original("Source", 1, copyBase);
    const before = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
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
    if (retained)
      await suite.db
        .execute(sql`insert into verifactu_submissions (registro_id, estado, proximo_intento_en)
    select id, case when tipo_registro = 'alta' then 'rechazado' else 'retenido' end,
      '2026-07-20T17:21:00.000Z' from verifactu_records where node_id = ${source.nodeId}`);

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
    expect(returned.records).toHaveLength(before.records.length + 1);
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
      ),
    ).toEqual({ complete: true });
    expect(receiver.db.all<ReturnRow>(sql`select * from sale_voids`)).toEqual(returned.voids);
    const cases = await withTransaction(receiver.db, listFilingCases);
    expect(cases.map((row) => row.cause).sort()).toEqual(
      retained ? ["fiscal.anulacion_retenida", "fiscal.registro_rechazado"] : [],
    );
    const conflicting = structuredClone(returned);
    conflicting.voids[0]!.id = "conflicting-fact";
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(
          tx,
          source.nodeId,
          conflicting,
          new Date("2026-07-20T17:22:00.000Z"),
        ),
      ),
    ).toEqual({ complete: false });
    expect(receiver.db.all<ReturnRow>(sql`select * from sale_voids`)).toEqual(returned.voids);
    expect(await withTransaction(receiver.db, listFilingCases)).toEqual(cases);
  },
);

it("includes the replacement-invoice fact with both commercial originals", async () => {
  const source = await original("Source", 1, copyBase);
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
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_substitutions`)).toEqual(
    returned.substitutions,
  );
  const conflicting = structuredClone(returned);
  conflicting.substitutions[0]!.id = "conflicting-fact";
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(
        tx,
        source.nodeId,
        conflicting,
        new Date("2026-07-20T17:22:00.000Z"),
      ),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_substitutions`)).toEqual(
    returned.substitutions,
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it("includes a corrective sale's parent from another node and its payment facts", async () => {
  const parent = await original("Parent", 1);
  const source = await seedNode(suite.db, "Source");
  const [parentSale] = await suite.db.select().from(sales).where(eq(sales.id, parent.saleId));
  const correctionId = saleId("10000000-0000-4000-8000-000000000001");
  await suite.db.insert(sales).values({
    ...parentSale!,
    id: correctionId,
    nodeId: source.nodeId,
    deviceId: source.deviceId,
    seriesId: source.seriesId,
    correctsSaleId: parent.saleId,
  });
  await suite.db.insert(tenders).values({
    id: "parent-payment",
    saleId: parent.saleId,
    method: "cash",
    amount: 100,
    tipAmount: 100,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  await suite.db.insert(saleSettlements).values({
    id: "parent-settlement",
    saleId: parent.saleId,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  await withTransaction(suite.db, async (tx) => {
    const [identity] = tx.all<{ nif: string; numero_instalacion: string }>(
      sql`select nif, numero_instalacion from verifactu_identities where id = ${source.sifId}`,
    );
    const pending = altaFor(source, correctionId, 1, 35);
    pending.input.IDEmisorFactura = identity!.nif;
    pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
    pending.input.NumSerieFactura = "Source/1";
    pending.input.TipoFactura = "R1";
    pending.input.TipoRectificativa = "I";
    pending.input.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "Customer", NIF: "89890001K" }],
    };
    pending.input.FacturasRectificadas = [
      {
        IDEmisorFactura: parent.issuerTaxId,
        NumSerieFactura: "Parent/1",
        FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
      },
    ];
    await appendToChain(tx, source.nodeId, pending);
  });
  await checkFixture();

  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(returned.sales.map((row) => row.id).sort()).toEqual([parent.saleId, correctionId].sort());
  expect(returned.tenders.map((row) => row.id)).toEqual(["parent-payment"]);
  expect(returned.settlements.map((row) => row.id)).toEqual(["parent-settlement"]);
  expect(returned.devices.map((row) => row.id).sort()).toEqual(
    [parent.deviceId, source.deviceId].sort(),
  );
  expect(returned.records).toHaveLength(1);
  expect(returned.records[0]!.node_id).toBe(source.nodeId);
  const [batch, ...more] = makeReturnedBatches(returned);
  expect(more).toEqual([]);
  expect(batch!.sales.map((row) => row.id).sort()).toEqual([parent.saleId, correctionId].sort());
  expect(batch!.tenders.map((row) => row.id)).toEqual(["parent-payment"]);
});

it("reads only the named tail of an earlier box's chain, with its delivery state", async () => {
  const first = await original("Earlier", 1);
  const second = await appendOriginal(first, "Earlier", 2);
  const third = await appendOriginal(first, "Earlier", 3);
  await original("Sender", 4);
  await suite.db.execute(sql`insert into verifactu_submissions
    (registro_id, estado, proximo_intento_en, csv, confirmado_en)
    values (${third.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z',
      'kept-csv', '2026-07-20T17:21:00.000Z')`);
  await suite.db.execute(sql`insert into verifactu_submissions (registro_id, estado,
    proximo_intento_en) values (${first.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z')`);

  const returned = await withTransaction(suite.db, (tx) =>
    readOtherBoxesOriginals(tx, [{ nodeId: first.nodeId, sifId: first.sifId, after: 1 }]),
  );

  expect(returned.records.map((row) => row.id)).toEqual([second.recordId, third.recordId]);
  expect(returned.sales.map((row) => row.id).sort()).toEqual([second.saleId, third.saleId].sort());
  expect(returned.deliveries).toEqual([
    expect.objectContaining({ registro_id: third.recordId, estado: "aceptado", csv: "kept-csv" }),
  ]);
});

it("reads two earlier boxes' records box by box", async () => {
  const one = await seedNode(suite.db, "One");
  const two = await seedNode(suite.db, "Two");
  const appended = [
    await appendOriginal(one, "One", 1),
    await appendOriginal(two, "Two", 2),
    await appendOriginal(one, "One", 3),
    await appendOriginal(two, "Two", 4),
  ];

  const returned = await withTransaction(suite.db, (tx) =>
    readOtherBoxesOriginals(tx, [
      { nodeId: two.nodeId, sifId: two.sifId, after: 0 },
      { nodeId: one.nodeId, sifId: one.sifId, after: 0 },
    ]),
  );

  const [first, second] = [one, two].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
  const inBoxOrder = [first!, second!].flatMap((node) =>
    appended.filter((record) => record.nodeId === node.nodeId).map((record) => record.recordId),
  );
  expect(returned.records.map((row) => row.id)).toEqual(inBoxOrder);
  expect(returned.records.map((row) => [row.node_id, row.secuencia])).toEqual([
    [first!.nodeId, 1],
    [first!.nodeId, 2],
    [second!.nodeId, 1],
    [second!.nodeId, 2],
  ]);
});

it("reads a whole earlier chain with its corrective's parent sale and payments", async () => {
  const parent = await original("Parent", 1);
  const earlier = await seedNode(suite.db, "Earlier");
  const [parentSale] = await suite.db.select().from(sales).where(eq(sales.id, parent.saleId));
  const correctionId = saleId("10000000-0000-4000-8000-000000000002");
  await suite.db.insert(sales).values({
    ...parentSale!,
    id: correctionId,
    nodeId: earlier.nodeId,
    deviceId: earlier.deviceId,
    seriesId: earlier.seriesId,
    correctsSaleId: parent.saleId,
  });
  await suite.db.insert(tenders).values({
    id: "parent-payment",
    saleId: parent.saleId,
    method: "cash",
    amount: 100,
    tipAmount: 100,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  await suite.db.insert(saleSettlements).values({
    id: "parent-settlement",
    saleId: parent.saleId,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  await withTransaction(suite.db, async (tx) => {
    const [identity] = tx.all<{ nif: string; numero_instalacion: string }>(
      sql`select nif, numero_instalacion from verifactu_identities where id = ${earlier.sifId}`,
    );
    const pending = altaFor(earlier, correctionId, 1, 35);
    pending.input.IDEmisorFactura = identity!.nif;
    pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
    pending.input.NumSerieFactura = "Earlier/1";
    pending.input.TipoFactura = "R1";
    pending.input.TipoRectificativa = "I";
    pending.input.Destinatarios = {
      IDDestinatario: [{ NombreRazon: "Customer", NIF: "89890001K" }],
    };
    pending.input.FacturasRectificadas = [
      {
        IDEmisorFactura: parent.issuerTaxId,
        NumSerieFactura: "Parent/1",
        FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
      },
    ];
    await appendToChain(tx, earlier.nodeId, pending);
  });
  await checkFixture();

  const returned = await withTransaction(suite.db, (tx) =>
    readOtherBoxesOriginals(tx, [{ nodeId: earlier.nodeId, sifId: earlier.sifId, after: 0 }]),
  );

  expect(returned.records.map((row) => row.node_id)).toEqual([earlier.nodeId]);
  expect(returned.sales.map((row) => row.id).sort()).toEqual([parent.saleId, correctionId].sort());
  expect(returned.tenders.map((row) => row.id)).toEqual(["parent-payment"]);
  expect(returned.settlements.map((row) => row.id)).toEqual(["parent-settlement"]);
  expect(returned.devices.map((row) => row.id).sort()).toEqual(
    [parent.deviceId, earlier.deviceId].sort(),
  );
});

async function copyBase() {
  await withTransaction(receiver.db, async (tx) => {
    for (const table of [
      "taxpayer",
      "settings",
      "device_profiles",
      "nodes",
      "invoice_series",
      "verifactu_identities",
      "devices",
    ]) {
      for (const row of suite.db.all<ReturnRow>(sql`select * from ${sql.identifier(table)}`)) {
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
}

it("returns originals with named staff and a department added after the copy", async () => {
  const node = await seedNode(suite.db, "Source");
  await copyBase();
  const operatorId = await seedPerson(suite.db, { displayName: "Ana Rivera" });
  const authoriserId = await seedPerson(suite.db, { displayName: "Sam Greene" });
  await seedPerson(receiver.db, { id: authoriserId, displayName: "Sam at receiver" });
  const voiderId = await seedPerson(suite.db, { displayName: "Jo Costa" });
  const [department] = await suite.db
    .insert(departments)
    .values({ name: "Terrace", tradingName: "Terrace current" })
    .returning({ id: departments.id });
  const [commercial] = await suite.db
    .insert(sales)
    .values({
      source: "device",
      deviceId: node.deviceId,
      nodeId: node.nodeId,
      seriesId: node.seriesId,
      invoiceNumber: 1,
      issuedAt: "2026-07-20T19:20:30+02:00",
      issuedOffsetMinutes: 120,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
      operatorId,
      authorizedBy: authoriserId,
      receiptDepartmentId: department!.id,
      receiptTradingName: "Terrace at sale",
      receiptPrintsTradingName: true,
    })
    .returning({ id: sales.id });
  const source = await appendOriginal(node, "Source", 1, saleId(commercial!.id));
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(saleVoids).values({
      saleId: source.saleId,
      reason: "Incorrect invoice",
      voidedAt: "2026-07-20T17:20:03.000Z",
      voidedBy: voiderId,
    });
    const pending = anulacionFor(source, source.saleId, 1, 3);
    pending.input.IDEmisorFacturaAnulada = source.issuerTaxId;
    pending.input.SistemaInformatico.NumeroInstalacion = source.installation;
    pending.input.NumSerieFacturaAnulada = "Source/1";
    await appendToChain(tx, source.nodeId, pending);
  });
  const originals = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const [batch, ...rest] = makeReturnedBatches(originals);
  expect(rest).toEqual([]);
  const received = readReturnedBatch(JSON.parse(JSON.stringify(batch)));
  const now = new Date("2026-07-20T17:22:00.000Z");
  const receive = (payload = received) =>
    withTransaction(receiver.db, (tx) => receiveReturnedOriginals(tx, source.nodeId, payload, now));

  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await receive()).toEqual({ complete: true });
    expect(
      receiver.db.all(sql`
      select id, display_name, display_name_folded, status, email, pin_hash from persons
      order by display_name
    `),
    ).toEqual([
      {
        id: operatorId,
        display_name: "Ana Rivera",
        display_name_folded: "ana rivera",
        status: "suspended",
        email: null,
        pin_hash: null,
      },
      {
        id: voiderId,
        display_name: "Jo Costa",
        display_name_folded: "jo costa",
        status: "suspended",
        email: null,
        pin_hash: null,
      },
      {
        id: authoriserId,
        display_name: "Sam at receiver",
        display_name_folded: "sam at receiver",
        status: "active",
        email: null,
        pin_hash: null,
      },
    ]);
    expect(
      receiver.db.all(sql`select id, name, trading_name, active, is_default from departments`),
    ).toEqual([
      {
        id: department!.id,
        name: "Terrace",
        trading_name: "Terrace at sale",
        active: 0,
        is_default: 0,
      },
    ]);
    expect(
      receiver.db.all(sql`select id, huella from verifactu_records order by secuencia`),
    ).toEqual(originals.records.map(({ id, huella }) => ({ id, huella })));
    expect(receiver.db.all(sql`select voided_by from sale_voids`)).toEqual([
      { voided_by: voiderId },
    ]);
  }

  const conflictingPersonId = await seedPerson(suite.db, { displayName: "Conflicting voider" });
  const conflicting = {
    ...received,
    staff: [{ id: conflictingPersonId, displayName: "Conflicting voider" }],
    voids: [{ ...received.voids[0]!, id: "conflicting-void", voided_by: conflictingPersonId }],
  };
  expect(await receive(conflicting)).toEqual({ complete: false });
  expect(receiver.db.all(sql`select id from persons where id = ${conflictingPersonId}`)).toEqual(
    [],
  );
  expect(receiver.db.all(sql`select voided_by from sale_voids`)).toEqual([{ voided_by: voiderId }]);
});

it("receives original bytes and delivery evidence once, and advances only the source head", async () => {
  const source = await original("Source", 1, copyBase);
  await suite.db.execute(sql`insert into verifactu_submissions
    (registro_id, estado, proximo_intento_en, csv, confirmado_en)
    values (${source.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z',
      'original-csv', '2026-07-20T17:21:00.000Z')`);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const now = new Date("2026-07-20T17:22:00.000Z");

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records`)).toEqual(
    returned.records,
  );
  expect(await withTransaction(receiver.db, (tx) => readChainHead(tx, source.nodeId))).toEqual({
    secuencia: 1,
    ultimoRegistroId: source.recordId,
    ultimaHuella: returned.records[0]!.huella,
  });
  expect(
    receiver.db.all<ReturnRow>(
      sql`select ${sql.join(Object.values(deliveryColumns), sql`, `)} from verifactu_submissions`,
    ),
  ).toEqual(returned.deliveries);
  await receiver.db.execute(
    sql`update verifactu_submissions set csv = 'receiver-csv' where registro_id = ${source.recordId}`,
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<{ csv: string }>(sql`select csv from verifactu_submissions`)).toEqual([
    { csv: "receiver-csv" },
  ]);
  expect(receiver.db.all<{ n: number }>(sql`select count(*) n from sales`)).toEqual([{ n: 1 }]);
});

it("creates only a dead missing device and clears the order link on an imported sale", async () => {
  const source = await original("Source", 1, async (node) => {
    await copyBase();
    node.deviceId = (await addDeviceToNode(suite.db, node)).deviceId;
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  returned.sales[0]!.working_order_id = "unavailable-order";
  const existing = receiver.db.all<ReturnRow>(sql`select * from devices`);
  const now = new Date("2026-07-20T17:22:00.000Z");

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });

  expect(
    receiver.db.all<ReturnRow>(sql`select * from devices where id = ${source.deviceId}`),
  ).toEqual([
    expect.objectContaining({
      id: source.deviceId,
      token_hash: "",
      active: 0,
      deleted_at: now.toISOString(),
      device_profile_id: existing[0]!.device_profile_id,
    }),
  ]);
  expect(
    receiver.db.all<ReturnRow>(sql`select * from devices where id = ${existing[0]!.id}`),
  ).toEqual(existing);
  expect(
    receiver.db.all<{ working_order_id: null }>(sql`select working_order_id from sales`),
  ).toEqual([{ working_order_id: null }]);
});

it("returns late tender and settlement facts even for an already-held original", async () => {
  const source = await original("Source", 1, copyBase);
  const first = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, first, now),
  );
  await suite.db.insert(tenders).values({
    id: "late-tender",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await suite.db.insert(saleSettlements).values({
    id: "late-settlement",
    saleId: source.saleId,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from tenders`)).toEqual(returned.tenders);
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_settlements`)).toEqual(
    returned.settlements,
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
});

it.each(["node", "series", "sif"])(
  "refuses missing %s metadata before copying any sale",
  async (field) => {
    const source = await original("Source", 1, copyBase);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    if (field === "sif") returned.records[0]!.sif_id = "absent";
    else returned.sales[0]![field === "node" ? "node_id" : "series_id"] = "absent";

    await expect(
      withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
      ),
    ).rejects.toMatchObject({ code: "fiscal.return_invalid" });
    expect(receiver.db.all<{ n: number }>(sql`select count(*) n from sales`)).toEqual([{ n: 0 }]);
  },
);

it("inserts an earlier sale's settlement before its later corrective sale", async () => {
  const node = await seedNode(suite.db, "Source");
  await copyBase();
  const parent = await appendOriginal(node, "Source", 1);
  await suite.db.insert(tenders).values({
    id: "earlier-payment",
    saleId: parent.saleId,
    method: "cash",
    amount: 100,
    tipAmount: 100,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  await suite.db.insert(saleSettlements).values({
    id: "earlier-settlement",
    saleId: parent.saleId,
    settledAt: "2026-07-20T17:20:31.000Z",
  });
  const [parentSale] = await suite.db.select().from(sales).where(eq(sales.id, parent.saleId));
  const correctionId = saleId("10000000-0000-4000-8000-000000000002");
  await suite.db.insert(sales).values({
    ...parentSale!,
    id: correctionId,
    invoiceNumber: 2,
    issuedAt: "2026-07-20T17:20:32.000Z",
    correctsSaleId: parent.saleId,
    total: -100,
  });
  const pending = altaFor(node, correctionId, 2, 35);
  pending.input.IDEmisorFactura = parent.issuerTaxId;
  pending.input.SistemaInformatico.NumeroInstalacion = parent.installation;
  pending.input.NumSerieFactura = "Source/2";
  await withTransaction(suite.db, (tx) => appendToChain(tx, node.nodeId, pending));
  const returned = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, node.nodeId));
  returned.sales.sort((a, b) => (a.id === correctionId ? -1 : b.id === correctionId ? 1 : 0));

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, node.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_settlements`)).toEqual(
    returned.settlements,
  );
  expect(receiver.db.all<ReturnRow>(sql`select * from tenders`)).toEqual(returned.tenders);
  expect(
    receiver.db.all<{ total: number }>(sql`select total from sales where id = ${correctionId}`),
  ).toEqual([{ total: -100 }]);
});

async function billPayment(db: Database, id: string) {
  const order = await seedWorkingOrder(db);
  await db.insert(billPayments).values({
    id,
    workingOrderId: order.id,
    submissionId: id,
    fingerprint: id,
    kind: "contribution",
    method: "cash",
    applied: 200,
    tendered: 200,
    state: "received",
    requestedBy: await seedPerson(db, { id: "operator" }),
    source: "device",
    deviceId: db.all<{ id: string }>(sql`select id from devices limit 1`)[0]!.id,
    receivedAt: "2026-07-20T17:21:00.000Z",
  });
}

it("clears a bill-payment link whose payment the receiver does not hold", async () => {
  const source = await original("Source", 1, copyBase);
  await billPayment(suite.db, "source-payment");
  await suite.db.insert(tenders).values({
    id: "payment-tender",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
    billPaymentId: "source-payment",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const now = new Date("2026-07-20T17:22:00.000Z");

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from tenders`)).toEqual([
    { ...returned.tenders[0], bill_payment_id: null },
  ]);
});

it("rolls back both incoming payment facts on a named payment clash without opening a fiscal case", async () => {
  const source = await original("Source", 1, copyBase);
  const now = new Date("2026-07-20T17:22:00.000Z");
  const first = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, first, now),
  );
  await billPayment(suite.db, "shared-payment");
  await billPayment(receiver.db, "shared-payment");
  await receiver.db.insert(tenders).values({
    id: "receiver-tender",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
    billPaymentId: "shared-payment",
  });
  await suite.db.insert(tenders).values([
    {
      id: "a-earlier-tender",
      saleId: source.saleId,
      method: "cash",
      amount: 100,
      tipAmount: 100,
      settledAt: "2026-07-20T17:21:00.000Z",
    },
    {
      id: "z-clashing-tender",
      saleId: source.saleId,
      method: "cash",
      amount: 200,
      tipAmount: 200,
      settledAt: "2026-07-20T17:21:00.000Z",
      billPaymentId: "shared-payment",
    },
  ]);
  await suite.db.insert(saleSettlements).values({
    id: "incoming-settlement",
    saleId: source.saleId,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<{ id: string }>(sql`select id from tenders`)).toEqual([
    { id: "receiver-tender" },
  ]);
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_settlements`)).toEqual([]);
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it("stops when both boxes independently settled the same sale", async () => {
  const source = await original("Source", 1, copyBase);
  const now = new Date("2026-07-20T17:22:00.000Z");
  const first = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, first, now),
  );
  for (const [db, label] of [
    [suite.db, "source"],
    [receiver.db, "receiver"],
  ] as const) {
    await db.insert(tenders).values({
      id: `${label}-tender`,
      saleId: source.saleId,
      method: "cash",
      amount: 200,
      tipAmount: 200,
      settledAt: now.toISOString(),
    });
    await db.insert(saleSettlements).values({
      id: `${label}-settlement`,
      saleId: source.saleId,
      settledAt: now.toISOString(),
    });
  }
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<{ id: string }>(sql`select id from tenders`)).toEqual([
    { id: "receiver-tender" },
  ]);
  expect(receiver.db.all<{ id: string }>(sql`select id from sale_settlements`)).toEqual([
    { id: "receiver-settlement" },
  ]);
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);

  const inspect = inspectReturnedPayments;
  const [clash] = await inspect(receiver.db, source.nodeId, returned);
  expect(clash).toMatchObject({
    saleId: source.saleId,
    eligible: true,
    outstanding: [
      { table: "tenders", id: "source-tender" },
      { table: "sale_settlements", id: "source-settlement" },
    ],
    incoming: { tenders: returned.tenders, settlements: returned.settlements, refunds: [] },
    held: {
      tenders: [expect.objectContaining({ id: "receiver-tender" })],
      settlements: [expect.objectContaining({ id: "receiver-settlement" })],
      refunds: [],
    },
  });
  const receive = (batch = returned) =>
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, batch, now, [clash!.fingerprint]),
    );
  expect(await receive()).toEqual({ complete: true });
  expect(receiver.db.all<{ id: string }>(sql`select id from tenders`)).toEqual([
    { id: "receiver-tender" },
  ]);
  expect(receiver.db.all<{ id: string }>(sql`select id from sale_settlements`)).toEqual([
    { id: "receiver-settlement" },
  ]);
  const changed = structuredClone(returned);
  changed.tenders[0]!.amount = 201;
  expect(await receive(changed)).toEqual({ complete: false });
  const unrelated = structuredClone(returned);
  unrelated.voids.push({ id: "missing-void", sale_id: "missing-sale" });
  expect(await receive(unrelated)).toEqual({ complete: false });
  const changedSale = structuredClone(returned);
  changedSale.sales[0]!.total = 999;
  expect(await receive(changedSale)).toEqual({ complete: false });
  const changedRecord = structuredClone(returned);
  changedRecord.records[0]!.offset_minutos = 60;
  expect(await receive(changedRecord)).toEqual({
    complete: false,
    refusal: "fiscal.return_record_clash",
  });
  const pending = structuredClone(returned);
  pending.refunds.push({ id: "pending", sale_id: source.saleId, state: "pending" });
  expect((await inspect(receiver.db, source.nodeId, pending))[0]!.eligible).toBe(false);
  const withCapture = structuredClone(returned);
  withCapture.captures.push({ id: "capture", sale_id: source.saleId });
  expect((await inspect(receiver.db, source.nodeId, withCapture))[0]!.eligible).toBe(false);
  await seedRefundActors(receiver.db);
  await receiver.db.insert(refunds).values({
    id: "new-held-refund",
    saleId: source.saleId,
    tenderId: "receiver-tender",
    submissionId: "new-refund",
    fingerprint: "new-refund",
    appliedAmount: 0,
    tipAmount: 1,
    reason: "Returned tip",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    method: "cash",
    state: "pending",
    createdAt: now.toISOString(),
  });
  expect((await inspect(receiver.db, source.nodeId, returned))[0]!.eligible).toBe(false);
  expect(await receive()).toEqual({ complete: false });
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it("preflights a different-id record clash before importing its orphan sale", async () => {
  const source = await original("Source", 1, copyBase);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const existing = structuredClone(returned);
  existing.records[0]!.id = "receiver-original";
  existing.records[0]!.sale_id = "receiver-sale";
  existing.sales[0]!.id = "receiver-sale";
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, existing, now),
  );

  const later = await appendOriginal(source, "Source", 2);
  await suite.db.insert(saleVoids).values({
    id: "later-void",
    saleId: later.saleId,
    reason: "Incorrect invoice",
    voidedAt: now.toISOString(),
  });
  const suffix = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, suffix, now),
    ),
  ).toEqual({ complete: false, refusal: "fiscal.return_record_clash" });
  expect(receiver.db.all<{ id: string }>(sql`select id from sales`)).toEqual([
    { id: "receiver-sale" },
  ]);
  expect(await inspectReturnedPayments(receiver.db, source.nodeId, suffix)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records`)).toEqual(
    existing.records,
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_voids`)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_submissions`)).toEqual([
    expect.objectContaining({ registro_id: "receiver-original" }),
  ]);
});

it("rolls back every imported fact when an original's hash does not verify", async () => {
  const source = await original("Source", 1, copyBase);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  returned.records[0]!.importe_total = "123.46";

  await expect(
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).rejects.toMatchObject({ code: "fiscal.return_invalid" });
  expect(receiver.db.all<{ n: number }>(sql`select count(*) n from sales`)).toEqual([{ n: 0 }]);
  expect(receiver.db.all<{ n: number }>(sql`select count(*) n from verifactu_records`)).toEqual([
    { n: 0 },
  ]);
  expect(await withTransaction(receiver.db, (tx) => readChainHead(tx, source.nodeId))).toEqual({
    secuencia: 0,
    ultimoRegistroId: null,
    ultimaHuella: null,
  });
});

it("withholds confirmation when a held id has different immutable bytes", async () => {
  const source = await original("Source", 1, copyBase);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, returned, now),
  );
  const different = structuredClone(returned);
  different.records[0]!.offset_minutos = 60;

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, different, now),
    ),
  ).toEqual({ complete: false, refusal: "fiscal.return_record_clash" });
  expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records`)).toEqual(
    returned.records,
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it.each([
  ["rechazado", "fiscal.registro_rechazado"],
  ["aceptado_con_errores", "fiscal.aceptado_con_errores"],
] as const)("recreates the case for a newly returned %s record", async (state, cause) => {
  const source = await original("Source", 1, copyBase);
  await suite.db
    .execute(sql`insert into verifactu_submissions (registro_id, estado, codigo_error, mensaje_error,
    proximo_intento_en) values (${source.recordId}, ${state}, '1161', 'Wrong detail',
      '2026-07-20T17:21:00.000Z')`);
  await withTransaction(suite.db, async (tx) => {
    await openFilingCase(tx, {
      registroId: source.recordId,
      cause,
      evidence: { codigo: 1161, mensaje: "Wrong detail", csv: null },
      now: new Date("2026-07-20T17:21:00.000Z"),
    });
    await recordCaseEvent(tx, {
      caseRegistroId: source.recordId,
      actionKey: "source-decision",
      kind: "resolved",
      personId: await seedResolutionAuthor(tx),
      action: "Recognised on source",
      now: new Date("2026-07-20T17:21:30.000Z"),
    });
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );

  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([
    expect.objectContaining({
      registroId: source.recordId,
      cause,
      evidence: { codigo: 1161, mensaje: "Wrong detail", csv: null },
      status: "open",
      openedAt: new Date("2026-07-20T17:22:00.000Z"),
    }),
  ]);
});

it("selects and receives a substitution's earlier sale from a different node", async () => {
  const parentNode = await seedNode(suite.db, "Parent");
  const sourceNode = await seedNode(suite.db, "Source");
  await copyBase();
  const parent = await appendOriginal(parentNode, "Parent", 1);
  const source = await appendOriginal(sourceNode, "Source", 2);
  const replacementSaleId = await seedSale(suite.db, source, 3);
  const pending = altaFor(source, replacementSaleId, 3, 4);
  pending.input.IDEmisorFactura = source.issuerTaxId;
  pending.input.SistemaInformatico.NumeroInstalacion = source.installation;
  pending.input.NumSerieFactura = "Source/3";
  pending.input.TipoFactura = "F3";
  pending.input.FacturasSustituidas = [
    {
      IDEmisorFactura: parent.issuerTaxId,
      NumSerieFactura: "Parent/1",
      FechaExpedicionFactura: pending.input.FechaExpedicionFactura,
    },
  ];
  pending.input.Destinatarios = { IDDestinatario: [{ NombreRazon: "Customer", NIF: "89890001K" }] };
  await withTransaction(suite.db, async (tx) => {
    await appendToChain(tx, source.nodeId, pending);
    await tx.insert(saleSubstitutions).values({
      id: "cross-node-substitution",
      substitutionSaleId: replacementSaleId,
      substitutedSaleId: parent.saleId,
    });
  });
  await checkFixture();

  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  expect(returned.sales.map((row) => row.id).sort()).toEqual(
    [parent.saleId, source.saleId, replacementSaleId].sort(),
  );
  expect(
    makeReturnedBatches(returned)
      .flatMap((batch) => batch.sales.map((row) => row.id))
      .sort(),
  ).toEqual([parent.saleId, source.saleId, replacementSaleId].sort());
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_substitutions`)).toEqual(
    returned.substitutions,
  );
});

it("withholds confirmation for changed commercial facts even when the record is identical", async () => {
  const source = await original("Source", 1, copyBase);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, returned, now),
  );
  const different = structuredClone(returned);
  different.sales[0]!.total = 1;

  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, different, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<{ total: number }>(sql`select total from sales`)).toEqual([{ total: 0 }]);
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it("batches real originals within the row and byte bounds without splitting payment facts", async () => {
  const node = await seedNode(suite.db, "Source");
  await copyBase();
  for (let number = 1; number <= 51; number++) await appendOriginal(node, "Source", number);
  const [last] = suite.db.all<{ sale_id: string }>(
    sql`select sale_id from verifactu_records order by secuencia desc limit 1`,
  );
  await suite.db.insert(tenders).values({
    id: "batch-payment",
    saleId: last!.sale_id,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await suite.db.insert(saleSettlements).values({
    id: "batch-settlement",
    saleId: last!.sale_id,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, node.nodeId));
  const batches = makeReturnedBatches(returned);

  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flatMap((batch) => batch.records)).toEqual(returned.records);
  const paidBatch = batches.find((batch) => batch.sales.some((row) => row.id === last!.sale_id))!;
  expect(paidBatch.tenders.map((row) => row.id)).toEqual(["batch-payment"]);
  expect(paidBatch.settlements.map((row) => row.id)).toEqual(["batch-settlement"]);
  for (const batch of batches) {
    expect(
      Object.values(batch).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0),
    ).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(256 * 1024);
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, node.nodeId, batch, new Date("2026-07-20T17:22:00.000Z")),
      ),
    ).toEqual({ complete: true });
  }
  expect(
    receiver.db
      .all<{ id: string }>(sql`select id from verifactu_records order by secuencia`)
      .map((row) => row.id),
  ).toEqual(returned.records.map((row) => row.id));
});

it("refuses an indivisible sale/payment unit over the row bound", async () => {
  const source = await original("Source", 1, copyBase);
  await insertInChunks(
    suite.db,
    tenders,
    Array.from({ length: 101 }, (_, index) => ({
      id: `payment-${index}`,
      saleId: source.saleId,
      method: "cash" as const,
      amount: 100,
      tipAmount: 100,
      settledAt: "2026-07-20T17:21:00.000Z",
    })),
  );
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  expect(() => makeReturnedBatches(returned)).toThrowError(
    expect.objectContaining({ code: "fiscal.return_invalid" }),
  );
  await expect(
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "batch exceeds bounds" },
  });
});

it("refuses a single oversized byte payload before inserting it", async () => {
  const source = await original("Source", 1, copyBase);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  returned.sales[0]!.counterparty_legal_name = "x".repeat(256 * 1024);
  expect(() => makeReturnedBatches(returned)).toThrowError(
    expect.objectContaining({ code: "fiscal.return_invalid" }),
  );
  await expect(
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, new Date("2026-07-20T17:22:00.000Z")),
    ),
  ).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "batch exceeds bounds" },
  });
  expect(receiver.db.all<{ n: number }>(sql`select count(*) n from sales`)).toEqual([{ n: 0 }]);
});

it("stops when both boxes have corrected the same original", async () => {
  const main = await seedNode(suite.db, "Main");
  const source = await original("Source", 1, copyBase);
  const now = new Date("2026-07-20T17:22:00.000Z");
  const first = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, first, now),
  );
  await recordTakeover(receiver.db, source.nodeId, main.nodeId);
  for (const [db, node] of [
    [suite.db, source],
    [receiver.db, main],
  ] as const) {
    const pending = altaFor(node, source.saleId, 1, 3);
    pending.input.IDEmisorFactura = source.issuerTaxId;
    pending.input.NumSerieFactura = "Source/1";
    pending.input.Subsanacion = "S";
    await withTransaction(db, (tx) =>
      appendToChain(tx, node.nodeId, { ...pending, correctsRegistroId: source.recordId }),
    );
  }
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const before = receiver.db.all<ReturnRow>(sql`select * from verifactu_records order by id`);
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: false, refusal: "fiscal.return_record_clash" });
  expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records order by id`)).toEqual(
    before,
  );
});

it.each(["chain position", "invoice identity"])(
  "stops a record clashing only on %s",
  async (field) => {
    const source = await original("Source", 1, copyBase);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const now = new Date("2026-07-20T17:22:00.000Z");
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    );
    const conflicting = structuredClone(returned);
    conflicting.records[0]!.id = "different-record";
    if (field === "chain position") conflicting.records[0]!.num_serie_factura = "Other/1";
    else conflicting.records[0]!.secuencia = 2;
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, conflicting, now),
      ),
    ).toEqual({ complete: false, refusal: "fiscal.return_record_clash" });
    expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records`)).toEqual(
      returned.records,
    );
  },
);

it.each([60000, 60001])(
  "admits a returned clock lead only through the one-minute margin: %s ms",
  async (lead) => {
    const source = await original("Source", 1, copyBase);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const at = Date.parse(String(returned.records[0]!.fecha_hora_huso_gen_registro));
    const now = new Date(at - lead);
    const receive = () =>
      withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, returned, now),
      );
    if (lead === 60000) expect(await receive()).toEqual({ complete: true });
    else {
      await expect(receive()).rejects.toMatchObject({ code: "fiscal.return_clock_ahead" });
      expect(receiver.db.all<ReturnRow>(sql`select * from verifactu_records`)).toEqual([]);
      expect(receiver.db.all<ReturnRow>(sql`select * from sales`)).toEqual([]);
    }
  },
);

async function seedRefundActors(db: typeof suite.db) {
  await seedPerson(db, { id: "manager", displayName: "Refund manager" });
  await seedPerson(db, { id: "operator", displayName: "Refund cashier" });
}

it("selects a pending refund and preserves its completed outcome on return", async () => {
  const source = await original("Source", 1, copyBase);
  const device = await addDeviceToNode(suite.db, source);
  await seedRefundActors(suite.db);
  await suite.db.insert(tenders).values({
    id: "refunded-tender",
    saleId: source.saleId,
    method: "card",
    amount: 12345,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const [refund] = await suite.db
    .insert(refunds)
    .values({
      id: "finished-refund",
      saleId: source.saleId,
      tenderId: "refunded-tender",
      submissionId: "refund-submission",
      fingerprint: "refund-fingerprint",
      appliedAmount: 12345,
      reason: "Service returned",
      authorizedBy: "manager",
      requestedBy: "operator",
      source: "device",
      deviceId: device.deviceId,
      nodeId: source.nodeId,
      method: "card",
      provider: "recorded-provider",
      providerPaymentRef: "recorded-charge",
      state: "pending",
      createdAt: "2026-07-20T17:21:01.000Z",
    })
    .returning();
  const inProgress = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  expect(inProgress.refunds).toEqual(suite.db.all<ReturnRow>(sql`select * from refunds`));
  await suite.db
    .update(refunds)
    .set({ state: "completed", completedAt: "2026-07-20T17:21:02.000Z" })
    .where(eq(refunds.id, refund!.id));
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const batch = makeReturnedBatches(returned).find((row) => row.tenders.length > 0)!;
  const stored = suite.db.all<ReturnRow>(sql`select * from refunds`);
  expect(batch.refunds).toEqual(stored);
  expect(batch.staff).toEqual(
    expect.arrayContaining([
      { id: "manager", displayName: "Refund manager" },
      { id: "operator", displayName: "Refund cashier" },
    ]),
  );
  expect(batch.devices.map((row) => row.id)).toContain(device.deviceId);
  const now = new Date("2026-07-20T17:22:00.000Z");
  for (let pass = 0; pass < 2; pass++) {
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, batch, now),
      ),
    ).toEqual({ complete: true });
    expect(receiver.db.all<ReturnRow>(sql`select * from refunds`)).toEqual(stored);
  }
  const changed = structuredClone(batch);
  changed.refunds[0]!.reason = "Different refund";
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, changed, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from refunds`)).toEqual(stored);
  changed.refunds[0]!.id = "same-submission-another-id";
  changed.refunds[0]!.reason = returned.refunds[0]!.reason!;
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, changed, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from refunds`)).toEqual(stored);
  changed.refunds[0]!.state = "failed";
  await expect(
    withTransaction(receiver.db, (tx) => receiveReturnedOriginals(tx, source.nodeId, changed, now)),
  ).rejects.toMatchObject({ code: "fiscal.return_invalid" });
});

it.each([
  { applied: 7345, tip: 145, complete: true },
  { applied: 7346, tip: 145, complete: false },
  { applied: 7345, tip: 146, complete: false },
])(
  "accounts for the receiver's own refunds before confirming $applied plus $tip",
  async ({ applied, tip, complete }) => {
    const sourceNode = await seedNode(suite.db, "Source");
    const currentNode = await seedNode(suite.db, "Receiver");
    await copyBase();
    const [sale] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId: sourceNode.deviceId,
        nodeId: sourceNode.nodeId,
        seriesId: sourceNode.seriesId,
        invoiceNumber: 1,
        issuedAt: "2026-07-20T17:20:30.000Z",
        issuedOffsetMinutes: 120,
        total: 12345,
        vatBreakdown: [{ rate: "21.00", base: "102.02", tax: "21.43" }],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning();
    const source = { ...sourceNode, saleId: sale!.id };
    const [identity] = suite.db.all<{ nif: string; numero_instalacion: string }>(
      sql`select nif, numero_instalacion from verifactu_identities where id = ${source.sifId}`,
    );
    const pending = altaFor(source, saleId(sale!.id), 1, 1);
    pending.input.IDEmisorFactura = identity!.nif;
    pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
    pending.input.NumSerieFactura = "Source/1";
    await withTransaction(suite.db, (tx) => appendToChain(tx, source.nodeId, pending));
    await suite.db.insert(tenders).values({
      id: "shared-payment",
      saleId: source.saleId,
      method: "cash",
      amount: 12690,
      tipAmount: 345,
      settledAt: "2026-07-20T17:21:00.000Z",
    });
    await suite.db
      .insert(saleSettlements)
      .values({ saleId: source.saleId, settledAt: "2026-07-20T17:21:00.000Z" });
    const refund = {
      id: "source-refund",
      saleId: source.saleId,
      tenderId: "shared-payment",
      submissionId: "source-submission",
      fingerprint: "source-fingerprint",
      appliedAmount: applied,
      tipAmount: tip,
      reason: "Service returned",
      authorizedBy: "manager",
      requestedBy: "operator",
      source: "device" as const,
      deviceId: source.deviceId,
      nodeId: source.nodeId,
      method: "cash" as const,
      state: "completed" as const,
      createdAt: "2026-07-20T17:21:01.000Z",
      completedAt: "2026-07-20T17:21:02.000Z",
    };
    await seedRefundActors(suite.db);
    await suite.db.insert(refunds).values(refund);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const now = new Date("2026-07-20T17:22:00.000Z");
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, { ...returned, refunds: [] }, now),
    );
    await seedRefundActors(receiver.db);
    await receiver.db.insert(refunds).values({
      ...refund,
      id: "receiver-refund",
      submissionId: "receiver-submission",
      appliedAmount: 5000,
      tipAmount: 200,
      deviceId: currentNode.deviceId,
      nodeId: currentNode.nodeId,
    });
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, returned, now),
      ),
    ).toEqual({ complete });
    expect(receiver.db.all<{ id: string }>(sql`select id from refunds order by id`)).toEqual(
      complete ? [{ id: "receiver-refund" }, { id: "source-refund" }] : [{ id: "receiver-refund" }],
    );
    if (!complete) {
      const [clash] = await inspectReturnedPayments(receiver.db, source.nodeId, returned);
      expect(clash!.eligible).toBe(true);
      expect(
        await withTransaction(receiver.db, (tx) =>
          receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
        ),
      ).toEqual({ complete: true });
      expect(receiver.db.all<{ id: string }>(sql`select id from refunds order by id`)).toEqual([
        { id: "receiver-refund" },
      ]);
    }
  },
);

it.each([null, [], {}, { extra: [] }, { records: [false] }])(
  "refuses a malformed return batch %j before using its rows",
  (raw) => {
    expect(() => readReturnedBatch(raw as CanonicalValue)).toThrowError(
      expect.objectContaining({
        code: "fiscal.return_invalid",
        params: { reason: "malformed batch" },
      }),
    );
  },
);

it("batches pending refund recovery anchors and preserves receiver progress on replay", async () => {
  const source = await original("Source", 1, copyBase);
  const order = await seedWorkingOrder(suite.db, {
    nodeId: source.nodeId,
    status: "settled",
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await suite.db.insert(tenders).values({
    id: "pending-tender",
    saleId: source.saleId,
    method: "card",
    amount: 100,
    tipAmount: 100,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await suite.db.execute(sql`insert into payments
    (id, working_order_id, source, device_id, node_id, sale_id, provider, payment_ref,
      amount, state, settled_at, created_at, updated_at)
    values ('capture', ${order.id}, 'device', ${source.deviceId}, ${source.nodeId}, ${source.saleId},
      'recorded-provider', 'recorded-charge', 100, 'captured',
      '2026-07-20T17:21:00.000Z', '2026-07-20T17:21:00.000Z', '2026-07-20T17:21:00.000Z')`);
  await seedRefundActors(suite.db);
  await suite.db.insert(refunds).values({
    id: "pending-refund",
    saleId: source.saleId,
    tenderId: "pending-tender",
    submissionId: "pending-submission",
    fingerprint: "pending-fingerprint",
    appliedAmount: 0,
    tipAmount: 40,
    reason: "Goodwill",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    method: "card",
    provider: "recorded-provider",
    providerPaymentRef: "recorded-charge",
    state: "pending",
    createdAt: "2026-07-20T17:21:01.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const [batch] = makeReturnedBatches(returned);
  expect(batch!.captures.map((row) => row.id)).toEqual(["capture"]);
  expect(batch!.orders.map((row) => row.id)).toEqual([order.id]);
  expect(batch!.devices.map((row) => row.id)).toContain(source.deviceId);
  const now = new Date("2026-07-20T17:22:00.000Z");
  const receive = (payload = batch!) =>
    withTransaction(receiver.db, (tx) => receiveReturnedOriginals(tx, source.nodeId, payload, now));
  const invalidOrder = structuredClone(batch!);
  invalidOrder.orders[0]!.status = "held";
  await expect(receive(invalidOrder)).rejects.toMatchObject({ code: "fiscal.return_invalid" });
  expect(await receive()).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from payments`)).toEqual(batch!.captures);
  expect(receiver.db.all<ReturnRow>(sql`select * from working_orders`)).toEqual(batch!.orders);
  const conflicting = structuredClone(batch!);
  conflicting.refunds[0]!.id = "another-refund";
  conflicting.refunds[0]!.submission_id = "another-submission";
  await expect(receive(conflicting)).rejects.toThrow(
    "UNIQUE constraint failed: refunds.provider, refunds.provider_payment_ref",
  );
  await receiver.db.execute(sql`update refunds set state = 'completed',
    completed_at = '2026-07-20T17:22:00.000Z' where id = 'pending-refund'`);
  await receiver.db.execute(sql`update payments set state = 'refunded',
    updated_at = '2026-07-20T17:22:00.000Z' where id = 'capture'`);
  expect(await receive()).toEqual({ complete: true });
  expect(receiver.db.all<{ state: string }>(sql`select state from refunds`)).toEqual([
    { state: "completed" },
  ]);
  expect(receiver.db.all<{ state: string }>(sql`select state from payments`)).toEqual([
    { state: "refunded" },
  ]);
});

const returnedAt = new Date("2026-07-20T17:22:00.000Z");

async function boxesWithAnEarlierOne() {
  const main = await seedNode(suite.db, "Main");
  const sender = await seedNode(suite.db, "Sender");
  const earlier = await seedNode(suite.db, "Earlier");
  const other = await seedNode(suite.db, "Other");
  await copyBase();
  return { main, sender, earlier, other };
}

function receiveOthers(
  source: string,
  returned: Awaited<ReturnType<typeof readOtherBoxesOriginals>>,
  destinationNodeId: string,
) {
  return withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source, returned, returnedAt, [], { destinationNodeId }),
  );
}

function readTail(node: SeededNode, after: number) {
  return withTransaction(suite.db, (tx) =>
    readOtherBoxesOriginals(tx, [{ nodeId: node.nodeId, sifId: node.sifId, after }]),
  );
}

async function receiveOwn(node: SeededNode) {
  const own = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, node.nodeId));
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, node.nodeId, own, returnedAt),
  );
}

function heldRecordIds() {
  return receiver.db
    .all<{ id: string }>(sql`select id from verifactu_records order by node_id, secuencia`)
    .map((row) => row.id);
}

it("takes an earlier box's tail that extends the receiver's prefix, with a pending submission for the receiver's outbox", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await receiveOwn(earlier);
  const second = await appendOriginal(earlier, "Earlier", 2);

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 1), main.nodeId)).toEqual({
    complete: true,
  });
  expect(heldRecordIds()).toEqual([first.recordId, second.recordId]);
  expect(
    receiver.db.all(sql`select estado, proximo_intento_en from verifactu_submissions
      where registro_id = ${second.recordId}`),
  ).toEqual([{ estado: "pendiente", proximo_intento_en: returnedAt.toISOString() }]);
});

it("takes a whole earlier chain when the receiver holds its identity", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  const second = await appendOriginal(earlier, "Earlier", 2);

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 0), main.nodeId)).toEqual({
    complete: true,
  });
  expect(heldRecordIds()).toEqual([first.recordId, second.recordId]);
  expect(await withTransaction(receiver.db, (tx) => readChainHead(tx, earlier.nodeId))).toEqual(
    expect.objectContaining({ secuencia: 2, ultimoRegistroId: second.recordId }),
  );
});

it("refuses the sender's own record sent as another box's", async () => {
  const { main, sender } = await boxesWithAnEarlierOne();
  await appendOriginal(sender, "Sender", 1);

  await expect(
    receiveOthers(sender.nodeId, await readTail(sender, 0), main.nodeId),
  ).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "another box's record metadata" },
  });
  expect(heldRecordIds()).toEqual([]);
});

it("refuses a record of the receiver's own box", async () => {
  const { main, sender } = await boxesWithAnEarlierOne();
  await appendOriginal(main, "Main", 1);

  await expect(
    receiveOthers(sender.nodeId, await readTail(main, 0), main.nodeId),
  ).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "another box's record metadata" },
  });
  expect(heldRecordIds()).toEqual([]);
});

it("refuses a record whose identity belongs to another box", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  await appendOriginal(earlier, "Earlier", 1);
  const returned = await readTail(earlier, 0);
  returned.records[0]!.sif_id = sender.sifId;

  await expect(receiveOthers(sender.nodeId, returned, main.nodeId)).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "another box's record metadata" },
  });
  expect(heldRecordIds()).toEqual([]);
});

it("refuses a changed tail on the chain check", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await receiveOwn(earlier);
  await appendOriginal(earlier, "Earlier", 2);
  const tail = await readTail(earlier, 1);
  tail.records[0]!.importe_total = "123.46";

  await expect(receiveOthers(sender.nodeId, tail, main.nodeId)).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "chain verification failed" },
  });
  expect(heldRecordIds()).toEqual([first.recordId]);
});

it("keeps the earlier box's accepted delivery state rather than queueing it again", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await suite.db.execute(sql`insert into verifactu_submissions
    (registro_id, estado, proximo_intento_en, csv, confirmado_en)
    values (${first.recordId}, 'aceptado', '2026-07-20T17:21:00.000Z',
      'earlier-csv', '2026-07-20T17:21:00.000Z')`);

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 0), main.nodeId)).toEqual({
    complete: true,
  });
  expect(receiver.db.all(sql`select registro_id, estado, csv from verifactu_submissions`)).toEqual([
    { registro_id: first.recordId, estado: "aceptado", csv: "earlier-csv" },
  ]);
});

it("a clash on one earlier chain leaves another chain's records accepted", async () => {
  const { main, sender, earlier, other } = await boxesWithAnEarlierOne();
  const a1 = await appendOriginal(earlier, "Earlier", 1);
  const x1 = await appendOriginal(other, "Other", 2);
  const a2 = await appendOriginal(earlier, "Earlier", 3);
  const clashing = await readTail(other, 0);
  clashing.records[0]!.id = "receiver-original";
  clashing.records[0]!.sale_id = "receiver-sale";
  clashing.sales[0]!.id = "receiver-sale";
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, other.nodeId, clashing, returnedAt),
  );
  const both = await withTransaction(suite.db, (tx) =>
    readOtherBoxesOriginals(tx, [
      { nodeId: earlier.nodeId, sifId: earlier.sifId, after: 0 },
      { nodeId: other.nodeId, sifId: other.sifId, after: 0 },
    ]),
  );
  const byId = (id: string) => both.records.find((row) => row.id === id)!;
  both.records = [byId(a1.recordId), byId(x1.recordId), byId(a2.recordId)];

  expect(await receiveOthers(sender.nodeId, both, main.nodeId)).toEqual({
    complete: false,
    refusal: "fiscal.return_record_clash",
  });
  expect(
    receiver.db
      .all<{ id: string }>(
        sql`select id from verifactu_records
        where node_id = ${earlier.nodeId} order by secuencia`,
      )
      .map((row) => row.id),
  ).toEqual([a1.recordId, a2.recordId]);
  expect(receiver.db.all(sql`select id from verifactu_records where id = ${x1.recordId}`)).toEqual(
    [],
  );
});

it("counts an earlier box's batch complete when its records went in but a payment row differs", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await suite.db.insert(tenders).values({
    id: "earlier-payment",
    saleId: first.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const [sale] = await suite.db.select().from(sales).where(eq(sales.id, first.saleId));
  await receiver.db.insert(sales).values(sale!);
  await receiver.db.insert(tenders).values({
    id: "earlier-payment",
    saleId: first.saleId,
    method: "cash",
    amount: 300,
    tipAmount: 300,
    settledAt: "2026-07-20T17:21:30.000Z",
  });

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 0), main.nodeId)).toEqual({
    complete: true,
  });
  expect(heldRecordIds()).toEqual([first.recordId]);
  expect(receiver.db.all(sql`select id, amount from tenders`)).toEqual([
    { id: "earlier-payment", amount: 300 },
  ]);
});

it("counts an earlier box's batch complete when both hold its record and settle its sale differently", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await receiveOwn(earlier);
  for (const [db, label] of [
    [suite.db, "sender"],
    [receiver.db, "receiver"],
  ] as const)
    await db.insert(saleSettlements).values({
      id: `${label}-settlement`,
      saleId: first.saleId,
      settledAt: returnedAt.toISOString(),
    });

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 0), main.nodeId)).toEqual({
    complete: true,
  });
  expect(heldRecordIds()).toEqual([first.recordId]);
  expect(receiver.db.all(sql`select id from sale_settlements`)).toEqual([
    { id: "receiver-settlement" },
  ]);
});

it("counts an earlier box's batch complete when both hold its record and void its sale differently", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  const first = await appendOriginal(earlier, "Earlier", 1);
  await receiveOwn(earlier);
  for (const [db, label] of [
    [suite.db, "sender"],
    [receiver.db, "receiver"],
  ] as const)
    await db.insert(saleVoids).values({
      id: `${label}-void`,
      saleId: first.saleId,
      reason: "Incorrect invoice",
      voidedAt: returnedAt.toISOString(),
    });

  expect(await receiveOthers(sender.nodeId, await readTail(earlier, 0), main.nodeId)).toEqual({
    complete: true,
  });
  expect(heldRecordIds()).toEqual([first.recordId]);
  expect(receiver.db.all(sql`select id from sale_voids`)).toEqual([{ id: "receiver-void" }]);
});

/** Two earlier boxes, the one whose id sorts first having corrected the other's last record. */
async function correctionOfAnEarlierBox(records = 1) {
  const main = await seedNode(suite.db, "Main");
  const sender = await seedNode(suite.db, "Sender");
  const [corrector, corrected] = [await seedNode(suite.db, "One"), await seedNode(suite.db, "Two")]
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1))
    .map((node) => node!);
  await suite.db.execute(sql`update verifactu_identities set numero_instalacion = 'corrector',
    nif = (select nif from verifactu_identities where id = ${corrected!.sifId})
    where id = ${corrector!.sifId}`);
  await copyBase();
  const targets = [];
  for (let invoice = 1; invoice <= records; invoice++)
    targets.push(await appendOriginal(corrected!, "Corrected", invoice));
  const target = targets.at(-1)!;
  await recordTakeover(suite.db, corrected!.nodeId, corrector!.nodeId);
  const [identity] = suite.db.all<{ numero_instalacion: string }>(
    sql`select numero_instalacion from verifactu_identities where id = ${corrector!.sifId}`,
  );
  const pending = altaFor(corrector!, target.saleId, records, records + 1);
  pending.input.IDEmisorFactura = target.issuerTaxId;
  pending.input.SistemaInformatico.NumeroInstalacion = identity!.numero_instalacion;
  pending.input.NumSerieFactura = `Corrected/${records}`;
  pending.input.Subsanacion = "S";
  await withTransaction(suite.db, (tx) =>
    appendToChain(tx, corrector!.nodeId, { ...pending, correctsRegistroId: target.recordId }),
  );
  await checkFixture();
  const [correction] = suite.db.all<{ id: string }>(
    sql`select id from verifactu_records where corrects_registro_id = ${target.recordId}`,
  );
  const both = () =>
    withTransaction(suite.db, (tx) =>
      readOtherBoxesOriginals(tx, [
        { nodeId: corrector!.nodeId, sifId: corrector!.sifId, after: 0 },
        { nodeId: corrected!.nodeId, sifId: corrected!.sifId, after: 0 },
      ]),
    );
  return { main, sender, corrected: corrected!, targets, correctionId: correction!.id, both };
}

function inBoxOrder(returned: Awaited<ReturnType<typeof readOtherBoxesOriginals>>) {
  returned.records.sort(
    (a, b) =>
      (String(a.node_id) < String(b.node_id)
        ? -1
        : String(a.node_id) > String(b.node_id)
          ? 1
          : 0) || Number(a.secuencia) - Number(b.secuencia),
  );
  return returned;
}

it("takes a correction of another earlier box's record sent before that record in one batch", async () => {
  const { main, sender, targets, correctionId, both } = await correctionOfAnEarlierBox();
  const returned = inBoxOrder(await both());
  expect(returned.records.map((row) => row.id)).toEqual([correctionId, targets[0]!.recordId]);

  expect(await receiveOthers(sender.nodeId, returned, main.nodeId)).toEqual({ complete: true });
  expect(heldRecordIds().sort()).toEqual([correctionId, targets[0]!.recordId].sort());
});

it("reads and batches a correction after the earlier box's record it corrects, across batches", async () => {
  const { main, sender, corrected, targets, correctionId, both } =
    await correctionOfAnEarlierBox(51);
  const returned = await both();
  const ids = returned.records.map((row) => row.id);
  expect(ids.indexOf(correctionId)).toBeGreaterThan(ids.indexOf(targets.at(-1)!.recordId));
  expect(
    returned.records.filter((row) => row.node_id === corrected.nodeId).map((row) => row.secuencia),
  ).toEqual(targets.map((_, index) => index + 1));

  const batches = makeReturnedBatches(returned);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flatMap((batch) => batch.records)).toEqual(returned.records);
  for (const batch of batches)
    expect(await receiveOthers(sender.nodeId, batch, main.nodeId)).toEqual({ complete: true });
  expect(heldRecordIds()).toHaveLength(targets.length + 1);
});

it("holds back a correction whose earlier record's box clashes, without a database error", async () => {
  const { main, sender, corrected, both } = await correctionOfAnEarlierBox();
  const clashing = await readTail(corrected, 0);
  clashing.records[0]!.id = "receiver-original";
  clashing.records[0]!.sale_id = "receiver-sale";
  clashing.sales[0]!.id = "receiver-sale";
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, corrected.nodeId, clashing, returnedAt),
  );

  expect(await receiveOthers(sender.nodeId, inBoxOrder(await both()), main.nodeId)).toEqual({
    complete: false,
    refusal: "fiscal.return_record_clash",
  });
  expect(heldRecordIds()).toEqual(["receiver-original"]);
});

it("refuses an accepted payment clash for another box's records", async () => {
  const { main, sender, earlier } = await boxesWithAnEarlierOne();
  await appendOriginal(earlier, "Earlier", 1);
  const tail = await readTail(earlier, 0);

  await expect(
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, sender.nodeId, tail, returnedAt, ["a-fingerprint"], {
        destinationNodeId: main.nodeId,
      }),
    ),
  ).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "accepted payment clash for another box's record" },
  });
  expect(heldRecordIds()).toEqual([]);
});

it("refuses records that correct each other rather than looping", async () => {
  const { main, sender, targets, correctionId, both } = await correctionOfAnEarlierBox();
  const returned = await both();
  returned.records.find((row) => row.id === targets[0]!.recordId)!.corrects_registro_id =
    correctionId;

  await expect(receiveOthers(sender.nodeId, returned, main.nodeId)).rejects.toMatchObject({
    code: "fiscal.return_invalid",
    params: { reason: "correction cycle" },
  });
  expect(heldRecordIds()).toEqual([]);
});
