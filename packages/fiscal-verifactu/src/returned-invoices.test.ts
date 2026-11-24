import { appendOriginalForReturn } from "./testing/returned-invoice.js";
import type { CanonicalValue } from "@waitron/membership";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, it, onTestFinished, vi } from "vitest";

import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";
import {
  readReturnedOriginals,
  makeReturnedBatches,
  readOtherBoxesOriginals,
  receiveReturnedOriginals,
  type ReturnRow,
} from "./handover-return.js";
import { hasReturnedInvoices, returnedInvoices, storedBases } from "./returned-invoices.js";
import { VERIFACTU_HANDOVER } from "./handover-summary.js";
import { VerifactuBackend } from "./backend.js";
import { steadyClock } from "../test/write-path-fixtures.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

const source = useVenueDb({ migrations: TEST_MIGRATIONS });
const receiver = useVenueDb({ migrations: TEST_MIGRATIONS });
const request = { search: "", page: 0, sortKey: "", sortDirection: "descending" } as const;
const receivedAt = new Date("2026-07-20T18:00:00.000Z");
async function fixture() {
  const node = await seedNode(source.db, "Returning");
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
      { own: { accepted: [] } },
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
  expect(receiver.db.all(sql`select secuencia from verifactu_records order by secuencia`)).toEqual([
    { secuencia: 1 },
    { secuencia: 2 },
  ]);
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
        { own: { accepted: [] } },
      );
      throw aborted;
    }),
  ).rejects.toBe(aborted);
  expect(markers()).toEqual([{ record_id: id, received_at: receivedAt.toISOString() }]);
  expect(
    receiver.db.get(sql`select id from verifactu_records where id = ${second}`),
  ).toBeUndefined();
});

it("reads only marked invoices with stored bases and separate record kinds", async () => {
  const node = await fixture();
  const id = await append(node, 1);
  await receive(node, await inventory(node));
  const rows = await withTransaction(receiver.db, (tx) => returnedInvoices(tx, request));
  expect(rows.rows).toEqual([
    {
      recordId: id,
      saleId: (await inventory(node)).records[0]!.sale_id,
      sourceNodeId: node.nodeId,
      sourceName: "Node Returning",
      generationId: node.sifId,
      installation: source.db.get<{ value: string }>(
        sql`select numero_instalacion as value from verifactu_identities where id = ${node.sifId}`,
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
    await withTransaction(receiver.db, (tx) => returnedInvoices(tx, { ...request, page: 1 })),
  ).toMatchObject({ rows: rows.rows, page: 0, total: 1, pageSize: 50 });
});

it("lists an earlier box's returned record under the box that wrote it", async () => {
  const earlier = await seedNode(source.db, "Earlier");
  const sender = await fixture();
  const id = await append(earlier, 1);
  const batch = await withTransaction(source.db, (tx) =>
    readOtherBoxesOriginals(tx, [{ nodeId: earlier.nodeId, sifId: earlier.sifId, after: 0 }]),
  );
  expect(
    await withTransaction(receiver.db, (tx) =>
      VERIFACTU_HANDOVER.returnRecords!.receive(
        tx,
        sender.nodeId,
        batch as unknown as CanonicalValue,
        receivedAt,
        { others: { destinationNodeId: randomUUID() } },
      ),
    ),
  ).toBe(true);
  const rows = await withTransaction(receiver.db, (tx) => returnedInvoices(tx, request));
  expect(rows.rows).toMatchObject([
    { recordId: id, sourceNodeId: earlier.nodeId, sourceName: "Node Earlier" },
  ]);
});

it("keeps cancellations separate and orders receipt time before chain position", async () => {
  const node = await fixture();
  const id = await append(node, 1);
  const first = await inventory(node);
  await receive(node, first);
  const pending = anulacionFor(node, first.records[0]!.sale_id as never, 1, 2);
  pending.input.IDEmisorFacturaAnulada = String(first.records[0]!.id_emisor_factura);
  pending.input.SistemaInformatico.NumeroInstalacion = source.db.get<{ value: string }>(
    sql`select numero_instalacion as value from verifactu_identities where id = ${node.sifId}`,
  )!.value;
  await withTransaction(source.db, (tx) => appendToChain(tx, node.nodeId, pending));
  const second = await append(node, 2);
  await receive(node, await inventory(node), new Date("2026-07-21T18:00:00Z"));
  const read = (page: number) =>
    withTransaction(receiver.db, (tx) => returnedInvoices(tx, { ...request, page }));
  const { rows } = await read(0);
  expect(
    rows.map((row) => [row.sequence, row.kind, row.category, row.taxable, row.gross, row.tax]),
  ).toEqual([
    [2, "cancellation", "cancellation", null, null, null],
    [3, "F2", "simplified", "102.02", "123.45", "21.43"],
    [1, "F2", "simplified", "102.02", "123.45", "21.43"],
  ]);
  expect(rows.map((row) => row.recordId)).toEqual([expect.any(String), second, id]);
  expect(await read(3)).toEqual({ rows, page: 0, total: 3, pageSize: 50 });
});

it("sums the stored bases exactly instead of subtracting totals, and retains correction references", async () => {
  const node = await fixture();
  const original = await append(node, 1);
  const first = await inventory(node);
  const sale = first.records[0]!.sale_id as never;
  const pending = altaFor(node, sale, 1, 2);
  pending.input.IDEmisorFactura = String(first.records[0]!.id_emisor_factura);
  pending.input.SistemaInformatico.NumeroInstalacion = source.db.get<{ value: string }>(
    sql`select numero_instalacion as value from verifactu_identities where id = ${node.sifId}`,
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
  const rows = await withTransaction(receiver.db, (tx) => returnedInvoices(tx, request));
  expect(rows.rows[1]).toMatchObject({
    correctsRecordId: original,
    taxable: "0.30",
    gross: "0.34",
    tax: "0.03",
  });
  const matched = await withTransaction(receiver.db, (tx) =>
    returnedInvoices(tx, { ...request, search: original }),
  );
  expect(matched.total).toBe(2);
  expect(matched.rows.map((row) => row.recordId)).toEqual([original, rows.rows[1]!.recordId]);
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
    sql`select numero_instalacion as value from verifactu_identities where id = ${node.sifId}`,
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
  const rows = await withTransaction(receiver.db, (tx) => returnedInvoices(tx, request));
  expect(rows.rows[0]!.recordId).toBe(original);
  expect(rows.rows[1]).toMatchObject({ kind, category });
});

it.each(["[{}]", '[{"BaseImponibleOimporteNoSujeto":7}]'])(
  "leaves a missing or non-string stored base unrecorded (%s)",
  (breakdown) => {
    expect(storedBases(breakdown)).toBeNull();
  },
);

it("reports whether any newly returned invoice is recorded", async () => {
  const exists = () => withTransaction(receiver.db, (tx) => hasReturnedInvoices(tx));
  const node = await fixture();
  await append(node, 1);
  const batch = await inventory(node);
  await withTransaction(receiver.db, (tx) =>
    receiveReturnedOriginals(tx, node.nodeId, batch, receivedAt),
  );
  expect(await exists()).toBe(false);
  await append(node, 2);
  await receive(node, await inventory(node));
  expect(await exists()).toBe(true);
});

it("answers the returned invoice through the backend's own methods", async () => {
  const backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: receiver.db,
  });
  const node = await fixture();
  const id = await append(node, 1);
  await receive(node, await inventory(node));

  expect(await withTransaction(receiver.db, (tx) => backend.hasReturnedInvoices(tx))).toBe(true);
  const rows = await withTransaction(receiver.db, (tx) => backend.returnedInvoices(tx, request));
  expect(rows.rows.map((row) => [row.recordId, row.invoiceNumber, row.sourceNodeId])).toEqual([
    [id, "A/1", node.nodeId],
  ]);
});

it("counts only marked rows, bounds pages and sorts receipt batches before stable positions", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  let nextId = 0;
  vi.mocked(randomUUID).mockImplementation(() => {
    const suffix = (nextId++)
      .toString(6)
      .padStart(12, "0")
      .replace(/[0-5]/g, (digit) => "abcdef"[Number(digit)]!);
    return `cccccccc-cccc-4ccc-8ccc-${suffix}` as ReturnType<typeof randomUUID>;
  });
  onTestFinished(() => {
    vi.mocked(randomUUID).mockImplementation(actual.randomUUID);
  });
  const node = await fixture();
  // This weaker inside-word match keeps the invoice search wider than one page.
  await withTransaction(receiver.db, (tx) =>
    tx.execute(sql`update nodes set name = 'Node Returning a106' where id = ${node.nodeId}`),
  );
  for (let i = 1; i <= 102; i++) await append(node, i);
  for (const batch of makeReturnedBatches(await inventory(node))) await receive(node, batch);
  const latest = await append(node, 103);
  for (const batch of makeReturnedBatches(await inventory(node)))
    await receive(node, batch, new Date("2026-07-21T18:00:00Z"));
  await append(node, 104);
  const unmarked = await inventory(node);
  for (const batch of makeReturnedBatches(unmarked))
    await withTransaction(receiver.db, (tx) =>
      receiveReturnedOriginals(tx, node.nodeId, batch, receivedAt),
    );
  async function read(page = 0, sortDirection: "ascending" | "descending" = "descending") {
    return withTransaction(receiver.db, (tx) =>
      returnedInvoices(tx, { ...request, page, sortKey: "receivedAt", sortDirection }),
    );
  }
  const first = await read();
  expect(first).toMatchObject({ total: 103, page: 0, pageSize: 50 });
  expect(first.rows).toHaveLength(50);
  expect(first.rows.map((row) => row.sequence)).toEqual([
    103,
    ...Array.from({ length: 49 }, (_, i) => i + 1),
  ]);
  const last = await read(999);
  expect(last).toMatchObject({ total: 103, page: 2, pageSize: 50 });
  expect(last.rows.map((row) => row.sequence)).toEqual([100, 101, 102]);
  expect((await read(0, "ascending")).rows.map((row) => row.sequence)).toEqual(
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  // The shared rank breaks this source-name tie by invoice text length before receipt time.
  for (const sortDirection of ["ascending", "descending"] as const) {
    const ranked = await withTransaction(receiver.db, (tx) =>
      returnedInvoices(tx, {
        ...request,
        search: "Node Returning",
        sortKey: "receivedAt",
        sortDirection,
      }),
    );
    expect(ranked.total).toBe(103);
    expect(ranked.rows.slice(0, 9).map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
  const search = (search: string, page = 0) =>
    withTransaction(receiver.db, (tx) => returnedInvoices(tx, { ...request, search, page }));
  expect(await search("A/102 ", 99)).toMatchObject({
    page: 0,
    total: 1,
    rows: [{ invoiceNumber: "A/102" }],
  });
  expect(await search("missing-invoice", 99)).toEqual({
    page: 0,
    total: 0,
    pageSize: 50,
    rows: [],
  });
  expect((await search("A/10")).rows.slice(0, 5).map((row) => row.invoiceNumber)).toEqual([
    "A/10",
    "A/103",
    "A/100",
    "A/101",
    "A/102",
  ]);
  expect((await search("A/10 ")).rows.map((row) => row.invoiceNumber)).toEqual(["A/10"]);
  for (const value of ["Node Returning", node.nodeId, node.sifId])
    expect((await search(value)).total).toBe(103);
  expect((await search(first.rows[0]!.installation)).total).toBe(103);
  for (const value of [latest, first.rows[0]!.saleId])
    expect((await search(value)).rows.some((row) => row.recordId === latest)).toBe(true);
});
