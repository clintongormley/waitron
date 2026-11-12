import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  insertInChunks,
  billPayments,
  type Database,
  sales,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  tenderRefunds,
  withTransaction,
} from "@waitron/db";
import { saleId } from "@waitron/shared";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { archiveTo, openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { inspectReturnedPayments } from "./handover-return.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";
import type { CanonicalValue } from "@waitron/membership";
import { listFilingCases } from "./filing-cases.js";
import { appendToChain } from "./chain.js";
import { checkFiscalChains } from "./handover-chain-check.js";
import { clockBehindChain } from "./clock-behind.js";
import {
  makeReturnedBatches,
  readReturnedOriginals,
  receiveReturnedOriginals,
  readReturnedBatch,
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

async function recordClash(paid = false) {
  const source = await original("Source", 1, copyBase);
  await suite.db.execute(sql`insert into envios
    (registro_id, estado, csv, codigo_error, proximo_intento_en)
    values (${source.recordId}, 'aceptado_con_errores', 'old-csv', '2000',
      '2026-07-20T17:21:00.000Z')`);
  if (paid)
    await suite.db.insert(tenders).values({
      id: "discarded-tip",
      saleId: source.saleId,
      method: "cash",
      amount: 100,
      tipAmount: 100,
      settledAt: "2026-07-20T17:21:00.000Z",
    });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const existing = structuredClone(returned);
  existing.tenders = [];
  existing.records[0]!.id = "held-record";
  existing.records[0]!.sale_id = "held-sale";
  existing.sales[0]!.id = "held-sale";
  existing.heads[0]!.ultimo_registro_id = "held-record";
  existing.deliveries[0]!.registro_id = "held-record";
  existing.deliveries[0]!.estado = "pendiente";
  existing.deliveries[0]!.csv = null;
  existing.deliveries[0]!.codigo_error = null;
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, existing, now),
  );
  return { source, returned, existing, now };
}

it("lists both versions of a record clash with current filing status for a readable download", async () => {
  const { source, returned, existing } = await recordClash();
  const inspect = () =>
    VERIFACTU_HANDOVER.returnRecords!.inspect!(
      receiver.db,
      source.nodeId,
      returned as unknown as CanonicalValue,
    );
  const [clash] = await inspect();
  expect(clash).toMatchObject({
    kind: "record",
    saleId: source.saleId,
    eligible: true,
    incoming: returned.records[0],
    held: existing.records,
  });
  expect(clash!.readable).toContain("Old-box record");
  expect(clash!.readable).toContain("Record held by the new main");
  expect(clash!.readable).toContain("Source/1");
  expect(clash!.readable).toContain("123.45");
  expect(clash!.readable).toContain("21.43");
  expect(clash!.readable).toContain("Accepted with errors (aceptado_con_errores)");
  expect(clash!.readable).toContain("old-csv");
  expect(clash!.readable).toContain("2000");
  await receiver.db.execute(sql`update envios set estado = 'aceptado', csv = 'new-csv'
    where registro_id = 'held-record'`);
  const [current] = await inspect();
  expect(current!.fingerprint).toBe(clash!.fingerprint);
  expect(current!.readable).toContain("Accepted (aceptado)");
  expect(current!.readable).toContain("new-csv");
});

it("accepts only the exact tail record clash without importing its sale or delivery", async () => {
  const { source, returned, existing, now } = await recordClash(true);
  const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    returned as unknown as CanonicalValue,
  );
  expect(clash!.readable).toContain("Tender discarded-tip");
  expect(clash!.readable).toContain("Amount: 1.00");
  expect(clash!.readable).toContain("not imported");
  const receive = (fingerprint: string) =>
    withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [fingerprint]),
    );
  expect(await receive("unrelated-fingerprint")).toEqual({ complete: false });
  expect(await receive(clash!.fingerprint)).toEqual({ complete: true });
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    existing.records,
  );
  expect(receiver.db.all<ReturnRow>(sql`select * from sales`)).toEqual(existing.sales);
  expect(receiver.db.all<ReturnRow>(sql`select * from envios`)).toEqual(existing.deliveries);
  expect(returned.tenders).toHaveLength(1);
  expect(receiver.db.all<ReturnRow>(sql`select * from tenders`)).toEqual([]);
  const changed = structuredClone(returned);
  changed.records[0]!.descripcion_operacion = "Different immutable evidence";
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, changed, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: false });
});

it("keeps a held sale's different payments unaccounted when accepting its only record clash", async () => {
  const source = await original("Source", 1, copyBase);
  await suite.db.insert(tenders).values({
    id: "shared-tip",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const existing = structuredClone(returned);
  existing.records[0]!.descripcion_operacion = "Held invoice description";
  existing.tenders[0]!.amount = 100;
  existing.tenders[0]!.tip_amount = 100;
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, existing, now),
  );
  const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    returned as unknown as CanonicalValue,
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    existing.records,
  );
  expect(receiver.db.all<ReturnRow>(sql`select * from tenders`)).toEqual(existing.tenders);
});

it("reports a held sale's imported payment without asking for manual entry (F4-4)", async () => {
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
  await suite.db.insert(tenders).values({
    id: "old-box-cash",
    saleId: source.saleId,
    method: "cash",
    amount: 3000,
    tipAmount: 0,
    settledAt: "2026-07-20T17:21:30.000Z",
  });
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const inspect = () =>
    VERIFACTU_HANDOVER.returnRecords!.inspect!(
      receiver.db,
      source.nodeId,
      returned as unknown as CanonicalValue,
    );
  const [clash] = await inspect();
  expect(clash!.kind).toBe("record");
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all(sql`select id, amount from tenders`)).toEqual([
    { id: "old-box-cash", amount: 3000 },
  ]);
  const [after] = await inspect();
  expect(after!.readable).not.toContain("Handle these facts manually");
  expect(after!.readable).toContain(`Sale ${source.saleId} is held by the new main`);
  expect(after!.readable).toContain("Tender old-box-cash\nRow on the new main: present");
  expect(clash!.readable).toContain("Tender old-box-cash\nRow on the new main: absent");
});

it("downloads totals, tax and payment facts for a sale blocked behind a clash (F4-2)", async () => {
  const source = await original("Source", 1, copyBase);
  await appendOriginal(source, "Source", 2);
  const prefix = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  const existing = structuredClone(prefix);
  const second = existing.records[1]!;
  const discarded = second.sale_id;
  second.id = "held-middle";
  second.sale_id = "held-middle-sale";
  existing.sales.find((row) => row.id === discarded)!.id = "held-middle-sale";
  existing.heads[0]!.ultimo_registro_id = "held-middle";
  const now = new Date("2026-07-20T17:22:00.000Z");
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, existing, now),
  );
  const later = await appendOriginal(source, "Source", 3);
  const order = await seedWorkingOrder(suite.db, {
    nodeId: source.nodeId,
    status: "settled",
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  await suite.db.insert(tenders).values({
    id: "later-cash",
    saleId: later.saleId,
    method: "cash",
    amount: 4500,
    tipAmount: 0,
    settledAt: "2026-07-20T17:21:30.000Z",
  });
  await suite.db.insert(tenders).values({
    id: "later-card",
    saleId: later.saleId,
    method: "card",
    amount: 1000,
    tipAmount: 0,
    settledAt: "2026-07-20T17:21:30.000Z",
  });
  await suite.db.insert(tenderRefunds).values({
    id: "later-refund",
    saleId: later.saleId,
    tenderId: "later-card",
    submissionId: "later-submission",
    fingerprint: "later-fingerprint",
    appliedAmount: 100,
    tipAmount: 0,
    reason: "Goodwill",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    locationId: order.locationId,
    method: "card",
    provider: "recorded-provider",
    providerPaymentRef: "later-charge",
    state: "pending",
    createdAt: "2026-07-20T17:21:31.000Z",
  });
  await suite.db.execute(sql`insert into payments
    (id, working_order_id, source, device_id, node_id, sale_id, provider, payment_ref,
      amount, state, settled_at, created_at, updated_at)
    values ('later-capture', ${order.id}, 'device', ${source.deviceId}, ${source.nodeId}, ${later.saleId},
      'recorded-provider', 'later-charge', 1000, 'captured',
      '2026-07-20T17:21:30.000Z', '2026-07-20T17:21:30.000Z', '2026-07-20T17:21:30.000Z')`);
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const inspect = () =>
    VERIFACTU_HANDOVER.returnRecords!.inspect!(
      receiver.db,
      source.nodeId,
      returned as unknown as CanonicalValue,
    );
  const [clash] = await inspect();
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all(sql`select id from tenders`)).toEqual([]);
  const [after] = await inspect();
  const waitingRecords = after!.readable!.split("Records in this batch still waiting")[1]!;
  expect(waitingRecords).toContain("Invoice: Source/3");
  const waiting = waitingRecords.split("Invoice: Source/3\n")[1]!;
  expect(waiting).toContain("Total: 123.45\nTax total: 21.43");
  expect(waiting).toContain("Tax breakdown: [{");
  expect(waiting).toContain(
    "Tender later-cash\nRow on the new main: absent\nMethod: cash\nAmount: 45.00",
  );
  expect(waiting).toContain(
    "Refund later-refund\nRow on the new main: absent\nTender: later-card\nMethod: card\nApplied amount: 1.00",
  );
  expect(waiting).toContain("Capture later-capture\nRow on the new main: absent\nAmount: 10.00");
  expect(waiting).toContain(`Sale ${later.saleId} is not held by the new main`);
  expect(waiting).toContain("Handle these facts manually");
});

it.each([false, true])(
  "keeps every missing suffix record blocked after an accepted middle clash (split batches: %s)",
  async (split) => {
    const source = await original("Source", 1, copyBase);
    await appendOriginal(source, "Source", 2);
    const prefix = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const existing = structuredClone(prefix);
    const second = existing.records[1]!;
    const discardedSale = second.sale_id;
    second.id = "held-middle";
    second.sale_id = "held-middle-sale";
    existing.sales.find((row) => row.id === discardedSale)!.id = "held-middle-sale";
    existing.heads[0]!.ultimo_registro_id = "held-middle";
    const now = new Date("2026-07-20T17:22:00.000Z");
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, existing, now),
    );
    await appendOriginal(source, "Source", 3);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
      receiver.db,
      source.nodeId,
      returned as unknown as CanonicalValue,
    );
    expect(clash!.eligible).toBe(true);
    if (split) {
      const first = structuredClone(returned);
      first.records = first.records.slice(0, 2);
      first.sales = first.sales.filter((row) =>
        first.records.some((record) => record.sale_id === row.id),
      );
      expect(
        await withTransaction(receiver.db, (tx) =>
          receiveReturnedOriginals(tx, source.nodeId, first, now, [clash!.fingerprint]),
        ),
      ).toEqual({ complete: true });
      returned.records = returned.records.slice(2);
      returned.sales = returned.sales.filter((row) =>
        returned.records.some((record) => record.sale_id === row.id),
      );
    }

    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(
          tx,
          source.nodeId,
          returned,
          now,
          split ? [] : [clash!.fingerprint],
          split ? [clash!] : [],
        ),
      ),
    ).toEqual({ complete: false });
    expect(
      receiver.db.all<ReturnRow>(sql`select * from registros_facturacion order by secuencia`),
    ).toEqual(existing.records);
    expect(receiver.db.all<ReturnRow>(sql`select * from sales order by id`)).toEqual(
      existing.sales.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    );
    const directory = await mkdtemp(join(tmpdir(), "waitron-return-receiver-"));
    try {
      const file = join(directory, "receiver.db");
      await archiveTo(receiver.db, file);
      const opened = await openBackupQuery(file);
      try {
        expect(await checkFiscalChains(opened.query)).toBe("ok");
      } finally {
        await opened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("lists all held counterparts and permits only the first unheld sequence", async () => {
  const { source, returned, now } = await recordClash();
  await appendOriginal(source, "Source", 2);
  const both = await withTransaction(suite.db, (tx) => readReturnedOriginals(tx, source.nodeId));
  const heldSecond = structuredClone(both);
  heldSecond.records = [heldSecond.records[1]!];
  heldSecond.sales = heldSecond.sales.filter((row) => row.id === heldSecond.records[0]!.sale_id);
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, source.nodeId, heldSecond, now),
  );
  const combined = structuredClone(returned);
  combined.records[0]!.num_serie_factura = "Source/2";
  const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    combined as unknown as CanonicalValue,
  );
  expect((clash!.held as ReturnRow[]).map((row) => row.num_serie_factura).sort()).toEqual([
    "Source/1",
    "Source/2",
  ]);
  const later = structuredClone(both);
  later.records[1]!.offset_minutos = 60;
  const clashes = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    later as unknown as CanonicalValue,
  );
  expect(clashes.map((row) => row.eligible)).toEqual([true, false]);
});

it.each([
  { type: "alta", invoiceType: "F2", state: "rechazado", want: "Rejected (rechazado)" },
  { type: "anulacion", invoiceType: null, state: "retenido", want: "Held (retenido)" },
  { type: "alta", invoiceType: "R1", state: "aceptado", want: "Accepted (aceptado)" },
])(
  "downloads readable $type/$invoiceType fields and an actual $state answer",
  async ({ type, invoiceType, state, want }) => {
    const { source, returned } = await recordClash();
    const record = returned.records[0]!;
    record.tipo_registro = type;
    record.tipo_factura = invoiceType;
    record.corrects_registro_id = invoiceType === "R1" ? "corrected-record" : null;
    record.tipo_rectificativa = invoiceType === "R1" ? "I" : null;
    record.facturas_rectificadas = invoiceType === "R1" ? '[{"NumSerieFactura":"Parent/1"}]' : null;
    returned.deliveries[0]!.estado = state;
    const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
      receiver.db,
      source.nodeId,
      returned as unknown as CanonicalValue,
    );
    expect(clash!.readable).toContain(`Record type: ${type}`);
    expect(clash!.readable).toContain(`Invoice type: ${invoiceType ?? "—"}`);
    expect(clash!.readable).toContain(want);
    expect(clash!.readable).toContain(
      `Correction target: ${invoiceType === "R1" ? "corrected-record" : "—"}`,
    );
    if (invoiceType === "R1")
      expect(clash!.readable).toContain('Corrected invoices: [{"NumSerieFactura":"Parent/1"}]');
    expect(clash!.readable).toContain("Issuer tax id:");
    expect(clash!.readable).toContain("Predecessor hash: —");
    expect(clash!.readable).toContain("Records in this batch still waiting");
    expect(clash!.readable).not.toContain("sourceEnvelope");
    expect(clash!.readable).not.toContain("undefined");
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

async function appendOriginal(node: SeededNode, label: string, invoice: number) {
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
  await suite.db.execute(sql`insert into envios
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
      await suite.db.execute(sql`insert into envios (registro_id, estado, proximo_intento_en)
    select id, case when tipo_registro = 'alta' then 'rechazado' else 'retenido' end,
      '2026-07-20T17:21:00.000Z' from registros_facturacion where node_id = ${source.nodeId}`);

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
      sql`select nif, numero_instalacion from registro_sif where id = ${source.sifId}`,
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
});

async function copyBase() {
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

it("receives original bytes and delivery evidence once, and advances only the source head", async () => {
  const source = await original("Source", 1, copyBase);
  await suite.db.execute(sql`insert into envios
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
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    returned.records,
  );
  expect(receiver.db.all<ReturnRow>(sql`select * from cadenas`)).toEqual(returned.heads);
  expect(receiver.db.all<ReturnRow>(sql`select * from envios`)).toEqual(returned.deliveries);
  await receiver.db.execute(
    sql`update envios set csv = 'receiver-csv' where registro_id = ${source.recordId}`,
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: true });
  expect(receiver.db.all<{ csv: string }>(sql`select csv from envios`)).toEqual([
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
    requestedBy: "operator",
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
  expect(await receive(changedRecord)).toEqual({ complete: false });
  const pending = structuredClone(returned);
  pending.refunds.push({ id: "pending", sale_id: source.saleId, state: "pending" });
  expect((await inspect(receiver.db, source.nodeId, pending))[0]!.eligible).toBe(false);
  const withCapture = structuredClone(returned);
  withCapture.captures.push({ id: "capture", sale_id: source.saleId });
  expect((await inspect(receiver.db, source.nodeId, withCapture))[0]!.eligible).toBe(false);
  await receiver.db.insert(tenderRefunds).values({
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
  existing.heads[0]!.ultimo_registro_id = "receiver-original";
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
  ).toEqual({ complete: false });
  expect(receiver.db.all<{ id: string }>(sql`select id from sales`)).toEqual([
    { id: "receiver-sale" },
  ]);
  expect(await inspectReturnedPayments(receiver.db, source.nodeId, suffix)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    existing.records,
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from sale_voids`)).toEqual([]);
  expect(receiver.db.all<ReturnRow>(sql`select * from envios`)).toEqual([
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
  expect(receiver.db.all<{ n: number }>(sql`select count(*) n from registros_facturacion`)).toEqual(
    [{ n: 0 }],
  );
  expect(receiver.db.all<{ secuencia: number }>(sql`select secuencia from cadenas`)).toEqual([
    { secuencia: 0 },
  ]);
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
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
    returned.records,
  );
  expect(await withTransaction(receiver.db, listFilingCases)).toEqual([]);
});

it.each([
  ["rechazado", "fiscal.registro_rechazado"],
  ["aceptado_con_errores", "fiscal.aceptado_con_errores"],
])("recreates the case for a newly returned %s record", async (state, cause) => {
  const source = await original("Source", 1, copyBase);
  await suite.db.execute(sql`insert into envios (registro_id, estado, codigo_error, mensaje_error,
    proximo_intento_en) values (${source.recordId}, ${state}, '1161', 'Wrong detail',
      '2026-07-20T17:21:00.000Z')`);
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
    sql`select sale_id from registros_facturacion order by secuencia desc limit 1`,
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
      .all<{ id: string }>(sql`select id from registros_facturacion order by secuencia`)
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
  const before = receiver.db.all<ReturnRow>(sql`select * from registros_facturacion order by id`);
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion order by id`)).toEqual(
    before,
  );
  const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    returned as unknown as CanonicalValue,
  );
  expect(clash!.kind).toBe("record");
  expect(clash!.eligible).toBe(true);
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: true });
  await receiver.db.insert(tenders).values({
    id: "unaccounted-payment",
    saleId: source.saleId,
    method: "cash",
    amount: 200,
    tipAmount: 200,
    settledAt: now.toISOString(),
  });
  returned.tenders.push({
    id: "unaccounted-payment",
    sale_id: source.saleId,
    method: "cash",
    amount: 100,
    tip_amount: 100,
    cash_tendered: null,
    bill_payment_id: null,
    settled_at: now.toISOString(),
  });
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, returned, now, [clash!.fingerprint]),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion order by id`)).toEqual(
    before,
  );
  expect(
    receiver.db.all<{ amount: number; tip_amount: number }>(
      sql`select amount, tip_amount from tenders`,
    ),
  ).toEqual([{ amount: 200, tip_amount: 200 }]);
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
    ).toEqual({ complete: false });
    expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual(
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
      expect(receiver.db.all<ReturnRow>(sql`select * from registros_facturacion`)).toEqual([]);
      expect(receiver.db.all<ReturnRow>(sql`select * from sales`)).toEqual([]);
    }
    expect(await clockBehindChain(receiver.db, { instant: now, offsetMinutes: 120 })).toBeNull();
  },
);

it("selects a pending refund and preserves its completed outcome on return", async () => {
  const source = await original("Source", 1, copyBase);
  const device = await addDeviceToNode(suite.db, source);
  await suite.db.insert(tenders).values({
    id: "refunded-tender",
    saleId: source.saleId,
    method: "card",
    amount: 12345,
    settledAt: "2026-07-20T17:21:00.000Z",
  });
  const [refund] = await suite.db
    .insert(tenderRefunds)
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
  expect(inProgress.refunds).toEqual(suite.db.all<ReturnRow>(sql`select * from tender_refunds`));
  await suite.db
    .update(tenderRefunds)
    .set({ state: "completed", completedAt: "2026-07-20T17:21:02.000Z" })
    .where(eq(tenderRefunds.id, refund!.id));
  const returned = await withTransaction(suite.db, (tx) =>
    readReturnedOriginals(tx, source.nodeId),
  );
  const batch = makeReturnedBatches(returned).find((row) => row.tenders.length > 0)!;
  const stored = suite.db.all<ReturnRow>(sql`select * from tender_refunds`);
  expect(batch.refunds).toEqual(stored);
  expect(batch.devices.map((row) => row.id)).toContain(device.deviceId);
  const now = new Date("2026-07-20T17:22:00.000Z");
  for (let pass = 0; pass < 2; pass++) {
    expect(
      await withTransaction(receiver.db, (tx) =>
        receiveReturnedOriginals(tx, source.nodeId, batch, now),
      ),
    ).toEqual({ complete: true });
    expect(receiver.db.all<ReturnRow>(sql`select * from tender_refunds`)).toEqual(stored);
  }
  const changed = structuredClone(batch);
  changed.refunds[0]!.reason = "Different refund";
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, changed, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from tender_refunds`)).toEqual(stored);
  changed.refunds[0]!.id = "same-submission-another-id";
  changed.refunds[0]!.reason = returned.refunds[0]!.reason!;
  expect(
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, changed, now),
    ),
  ).toEqual({ complete: false });
  expect(receiver.db.all<ReturnRow>(sql`select * from tender_refunds`)).toEqual(stored);
  changed.refunds[0]!.state = "failed";
  await expect(
    withTransaction(receiver.db, (tx) => receiveReturnedOriginals(tx, source.nodeId, changed, now)),
  ).rejects.toMatchObject({ code: "fiscal.return_invalid" });
});

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
  await suite.db.insert(tenderRefunds).values({
    id: "pending-refund",
    saleId: source.saleId,
    tenderId: "pending-tender",
    submissionId: "pending-submission",
    fingerprint: "pending-fingerprint",
    appliedAmount: 0,
    tipAmount: 100,
    reason: "Goodwill",
    authorizedBy: "manager",
    requestedBy: "operator",
    source: "device",
    deviceId: source.deviceId,
    nodeId: source.nodeId,
    locationId: order.locationId,
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
  const clashing = structuredClone(batch!);
  clashing.records[0]!.descripcion_operacion = "Different record to inspect";
  expect(await receive()).toEqual({ complete: true });
  const [clash] = await VERIFACTU_HANDOVER.returnRecords!.inspect!(
    receiver.db,
    source.nodeId,
    clashing as unknown as CanonicalValue,
  );
  expect(clash!.readable).toContain("Refund pending-refund");
  expect(clash!.readable).toContain("Applied amount: 0.00");
  expect(clash!.readable).toContain("Tip: 1.00");
  expect(clash!.readable).toContain("Capture capture");
  expect(clash!.readable).toContain("recorded-charge");

  expect(receiver.db.all<ReturnRow>(sql`select * from payments`)).toEqual(batch!.captures);
  expect(receiver.db.all<ReturnRow>(sql`select * from working_orders`)).toEqual(batch!.orders);
  await receiver.db.execute(sql`update tender_refunds set state = 'completed',
    completed_at = '2026-07-20T17:22:00.000Z' where id = 'pending-refund'`);
  await receiver.db.execute(sql`update payments set state = 'refunded',
    updated_at = '2026-07-20T17:22:00.000Z' where id = 'capture'`);
  expect(await receive()).toEqual({ complete: true });
  expect(receiver.db.all<{ state: string }>(sql`select state from tender_refunds`)).toEqual([
    { state: "completed" },
  ]);
  expect(receiver.db.all<{ state: string }>(sql`select state from payments`)).toEqual([
    { state: "refunded" },
  ]);
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
      sql`select nif, numero_instalacion from registro_sif where id = ${source.sifId}`,
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
    await suite.db.insert(tenderRefunds).values(refund);
    const returned = await withTransaction(suite.db, (tx) =>
      readReturnedOriginals(tx, source.nodeId),
    );
    const now = new Date("2026-07-20T17:22:00.000Z");
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, source.nodeId, { ...returned, refunds: [] }, now),
    );
    await receiver.db.insert(tenderRefunds).values({
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
    expect(receiver.db.all<{ id: string }>(sql`select id from tender_refunds order by id`)).toEqual(
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
      expect(
        receiver.db.all<{ id: string }>(sql`select id from tender_refunds order by id`),
      ).toEqual([{ id: "receiver-refund" }]);
    }
  },
);
