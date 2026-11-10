import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiledFigures } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";
import type { DetalleDesgloseInput } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { envios } from "./schema/envios.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
type Estado = (typeof envios.$inferInsert)["estado"];

const AT = new Date("2026-07-20T17:20:40Z");
const clock = {
  ...steadyClock,
  now: () => ({ ...steadyClock.now(), instant: AT, offsetMinutes: 120 }),
};

let node: SeededNode;
let backend: VerifactuBackend;
let invoice: number;
let second: number;

beforeEach(async () => {
  node = await seedNode(suite.db);
  invoice = 0;
  second = 0;
  backend = new VerifactuBackend({
    deploymentEnvironment: "preproduction",
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
    clock,
  });
});

const detail = (rate: string, base: string, tax: string): DetalleDesgloseInput => ({
  ClaveRegimen: "01",
  CalificacionOperacion: "S1",
  BaseImponibleOimporteNoSujeto: base,
  TipoImpositivo: rate,
  CuotaRepercutida: tax,
});

interface Figures {
  desglose: DetalleDesgloseInput[];
  cuota: string;
  importe: string;
}

const AT_21: Figures = {
  desglose: [detail("21.00", "10.00", "2.10")],
  cuota: "2.10",
  importe: "12.10",
};
const AT_10: Figures = {
  desglose: [detail("10.00", "11.00", "1.10")],
  cuota: "1.10",
  importe: "12.10",
};

/** Files one alta through the chain writer, with its submission in `estado`. */
async function file(
  options: {
    figures?: Figures;
    estado?: Estado;
    tipo?: "F2" | "R5";
    sale?: SaleId;
    fixes?: { registroId: string; number: number };
  } = {},
): Promise<{ saleId: SaleId; registroId: string; number: number }> {
  const number = options.fixes?.number ?? ++invoice;
  const saleId = options.sale ?? (await seedSale(suite.db, node, number));
  const figures = options.figures ?? AT_21;
  const registroId = await withTransaction(suite.db, async (tx) => {
    const pending = altaFor(node, saleId, number, ++second, "preproduction");
    const { id } = await appendToChain(tx, node.nodeId, {
      ...pending,
      ...(options.fixes === undefined ? {} : { correctsRegistroId: options.fixes.registroId }),
      input: {
        ...pending.input,
        TipoFactura: options.tipo ?? "F2",
        ...(options.tipo === "R5" ? { TipoRectificativa: "I" } : {}),
        ...(options.fixes === undefined ? {} : { Subsanacion: "S", RechazoPrevio: "X" }),
        Desglose: figures.desglose,
        CuotaTotal: figures.cuota,
        ImporteTotal: figures.importe,
      },
    });
    await tx.insert(envios).values({ registroId: id, estado: options.estado ?? "pendiente" });
    return id;
  });
  return { saleId, registroId, number };
}

function figuresFor(...saleIds: SaleId[]): Promise<ReadonlyMap<SaleId, FiledFigures>> {
  return withTransaction(suite.db, (tx) => backend.filedFiguresFor(tx, saleIds));
}

const version = (total: string, rate: string, base: string, tax: string) => ({
  total,
  vatBreakdown: [{ rate, base, tax }],
});
const V21 = version("12.10", "21.00", "10.00", "2.10");
const V10 = version("12.10", "10.00", "11.00", "1.10");

describe("a fixed filing: the newest is the fix, the newest answered the latest accepted", () => {
  it.each([
    ["rechazado", "pendiente", null],
    ["rechazado", "aceptado", V10],
    ["aceptado_con_errores", "pendiente", V21],
  ] as const)("first %s, fix %s", async (first, fix, answered) => {
    const original = await file({ estado: first });
    await file({
      figures: AT_10,
      estado: fix,
      sale: original.saleId,
      fixes: { registroId: original.registroId, number: original.number },
    });

    expect((await figuresFor(original.saleId)).get(original.saleId)).toEqual({
      readable: true,
      newest: V10,
      newestAnswered: answered,
    });
  });
});

describe("unreadable figures", () => {
  const surcharge: DetalleDesgloseInput = {
    ...detail("21.00", "10.00", "2.10"),
    TipoRecargoEquivalencia: "5.20",
    CuotaRecargoEquivalencia: "0.52",
  };
  it.each<[string, Figures]>([
    ["an equivalence surcharge", { desglose: [surcharge], cuota: "2.10", importe: "12.10" }],
    [
      "two details at one rate",
      {
        desglose: [detail("21.00", "5.00", "1.05"), detail("21.00", "5.00", "1.05")],
        cuota: "2.10",
        importe: "12.10",
      },
    ],
    ["details not summing to the total", { ...AT_21, importe: "12.11" }],
    ["VAT not summing to the VAT total", { ...AT_21, cuota: "2.11" }],
  ])("%s", async (_name, figures) => {
    const { saleId } = await file({ figures, estado: "aceptado" });
    expect((await figuresFor(saleId)).get(saleId)).toEqual({ readable: false });
  });

  it("an accepted version that is unreadable behind a readable queued fix", async () => {
    const original = await file({
      figures: { ...AT_21, importe: "12.11" },
      estado: "aceptado_con_errores",
    });
    await file({
      figures: AT_10,
      sale: original.saleId,
      fixes: { registroId: original.registroId, number: original.number },
    });
    expect((await figuresFor(original.saleId)).get(original.saleId)).toEqual({ readable: false });
  });

  it("two lines of fixes", async () => {
    const { saleId } = await file({ estado: "aceptado" });
    expect((await figuresFor(saleId)).get(saleId)).toMatchObject({ readable: true });
    await file({ sale: saleId, estado: "aceptado" });
    expect((await figuresFor(saleId)).get(saleId)).toEqual({ readable: false });
  });
});

it("leaves out a sale with no alta, and a cancellation is not one", async () => {
  const bare = await seedSale(suite.db, node, 50);
  const voided = await file({ estado: "aceptado" });
  await withTransaction(suite.db, (tx) =>
    backend.recordVoid(tx, voided.saleId, "test", node.nodeId),
  );

  const answer = await figuresFor(bare, voided.saleId);

  expect(answer.has(bare)).toBe(false);
  expect(answer.get(voided.saleId)).toMatchObject({ readable: true, newest: V21 });
});
