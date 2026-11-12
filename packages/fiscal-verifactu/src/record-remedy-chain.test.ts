import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { type SaleId } from "@waitron/shared";
import { computeHuella } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { appendToChain, readChainHead } from "./chain.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import {
  altaFor,
  anulacionFor,
  seedNode,
  seedSale,
  TEST_NIF,
  type SeededNode,
} from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let node: SeededNode;
let saleId: SaleId;

beforeEach(async () => {
  node = await seedNode(suite.db);
  saleId = await seedSale(suite.db, node, 1);
});

async function rows() {
  return suite.db.select().from(registrosFacturacion).orderBy(registrosFacturacion.secuencia);
}

function correction(correctsRegistroId: string, seconds: number) {
  const pending = altaFor(node, saleId, 1, seconds, "preproduction");
  return {
    ...pending,
    correctsRegistroId,
    input: {
      ...pending.input,
      Subsanacion: "S" as const,
      RechazoPrevio: "X" as const,
      DescripcionOperacion: `Corrected restaurant service ${seconds}`,
    },
  };
}

it("appends successive corrections at the live chain head while preserving invoice identity and older records", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const originalRow = (await rows())[0]!;
  const unrelatedSaleId = await seedSale(suite.db, node, 2);
  const unrelated = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, unrelatedSaleId, 2, 2, "preproduction")),
  );
  const first = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, correction(original.id, 3)),
  );
  const firstRow = (await rows())[2]!;
  const second = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, correction(first.id, 4)),
  );
  const stored = await rows();
  expect(stored[0]).toEqual(originalRow);
  expect(stored[2]).toEqual(firstRow);
  expect(stored.map((row) => row.correctsRegistroId)).toEqual([null, null, original.id, first.id]);
  expect(stored.map((row) => row.anteriorHuella)).toEqual([
    null,
    original.huella,
    unrelated.huella,
    first.huella,
  ]);
  for (const row of [stored[2]!, stored[3]!]) {
    expect([row.idEmisorFactura, row.numSerieFactura, row.fechaExpedicionFactura]).toEqual([
      TEST_NIF,
      "A/1",
      "2026-07-20",
    ]);
    expect([row.subsanacion, row.rechazoPrevio]).toEqual(["S", "X"]);
    expect(row.saleId).toBe(saleId);
    expect(row.huella).not.toBe(original.huella);
    const raw = await suite.db.execute(
      sql`select * from registros_facturacion where id = ${row.id}`,
    );
    expect(computeHuella(fromRegistroRow(decodeRegistroRow(raw.rows[0]!)))).toBe(row.huella);
  }
  expect(await readChainHead(suite.db, node.nodeId)).toEqual({
    secuencia: 4,
    ultimoRegistroId: second.id,
    ultimaHuella: second.huella,
  });
  expect(await verifyChain(suite.db, node.nodeId)).toEqual({ ok: true, checked: 2, issues: [] });
});

it("refuses the second simultaneous correction with a domain code and leaves the winning chain intact", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const results = await Promise.allSettled(
    [2, 3].map((seconds) =>
      withTransaction(suite.db, (tx) =>
        appendToChain(tx, node.nodeId, correction(original.id, seconds)),
      ),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const refused = results.find((result) => result.status === "rejected");
  expect(refused).toMatchObject({
    status: "rejected",
    reason: { code: "fiscal.record_already_corrected", params: { registroId: original.id } },
  });
  const replacements = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.correctsRegistroId, original.id));
  expect(replacements).toHaveLength(1);
  expect(await rows()).toHaveLength(2);
  expect(await readChainHead(suite.db, node.nodeId)).toEqual({
    secuencia: 2,
    ultimoRegistroId: replacements[0]!.id,
    ultimaHuella: replacements[0]!.huella,
  });
  expect(await verifyChain(suite.db, node.nodeId)).toEqual({ ok: true, checked: 2, issues: [] });
});

it.each([
  "missing",
  "number",
  "date",
  "issuer",
  "sale",
  "ordinary",
  "negative-marker",
  "node",
  "cancellation",
] as const)(
  "refuses a correction with a mismatched target or missing correction marker: %s",
  async (kind) => {
    const original = await withTransaction(suite.db, (tx) =>
      appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
    );
    const targetId =
      kind === "cancellation"
        ? (
            await withTransaction(suite.db, (tx) =>
              appendToChain(tx, node.nodeId, anulacionFor(node, saleId, 1, 2, "preproduction")),
            )
          ).id
        : kind === "missing"
          ? "missing-record"
          : original.id;
    const appendNodeId = kind === "node" ? (await seedNode(suite.db)).nodeId : node.nodeId;
    const pending = correction(targetId, 3);
    if (kind === "number") pending.input.NumSerieFactura = "A/2";
    if (kind === "date")
      pending.input.FechaExpedicionFactura = new Date("2026-07-19T00:00:00+02:00");
    if (kind === "issuer") pending.input.IDEmisorFactura = "B12345674";
    if (kind === "sale") pending.saleId = await seedSale(suite.db, node, 2);
    const request =
      kind === "ordinary"
        ? {
            ...pending,
            input: { ...pending.input, Subsanacion: undefined, RechazoPrevio: undefined },
          }
        : kind === "negative-marker"
          ? {
              ...pending,
              input: { ...pending.input, Subsanacion: "N" as const, RechazoPrevio: "N" as const },
            }
          : pending;
    const before = await rows();
    const headBefore = await readChainHead(suite.db, appendNodeId);
    await expect(
      withTransaction(suite.db, (tx) => appendToChain(tx, appendNodeId, request)),
    ).rejects.toMatchObject({
      code: "fiscal.remedy_invalid",
      params: { registroId: pending.correctsRegistroId },
    });
    expect(await rows()).toEqual(before);
    expect(await readChainHead(suite.db, appendNodeId)).toEqual(headBefore);
  },
);

it("appends a correction of a record of the box this one took over from on this box's chain", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  const ownSaleId = await seedSale(suite.db, successor, 1);
  const own = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, successor.nodeId, altaFor(successor, ownSaleId, 7, 2, "preproduction")),
  );

  const appended = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, successor.nodeId, correction(original.id, 3)),
  );

  const [row] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, appended.id));
  expect(row).toMatchObject({
    nodeId: successor.nodeId,
    sifId: successor.sifId,
    secuencia: own.secuencia + 1,
    anteriorHuella: own.huella,
    correctsRegistroId: original.id,
  });
});

it("refuses a correction of a record of a box this one did not take over from", async () => {
  const original = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1, "preproduction")),
  );
  const successor = await seedNode(suite.db, "B");
  const unrelated = await seedNode(suite.db, "C");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  const before = await rows();
  const headBefore = await readChainHead(suite.db, unrelated.nodeId);

  await expect(
    withTransaction(suite.db, (tx) =>
      appendToChain(tx, unrelated.nodeId, correction(original.id, 3)),
    ),
  ).rejects.toMatchObject({ code: "fiscal.remedy_invalid", params: { registroId: original.id } });
  expect(await rows()).toEqual(before);
  expect(await readChainHead(suite.db, unrelated.nodeId)).toEqual(headBefore);
});
