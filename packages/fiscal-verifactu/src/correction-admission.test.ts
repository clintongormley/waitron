import { beforeEach, describe, expect, it } from "vitest";
import { newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { CorrectionAdmission, FiledFigures } from "@waitron/fiscal";
import { saleId as brandSaleId, type SaleId } from "@waitron/shared";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import type { DetalleDesgloseInput } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { envios } from "./schema/envios.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const AT = new Date("2026-07-20T17:20:40Z");
const clock = {
  ...steadyClock,
  now: () => ({ ...steadyClock.now(), instant: AT, offsetMinutes: 120 }),
};
type Estado = (typeof envios.$inferInsert)["estado"];

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

const detail = (rate: string, base: string, tax: string) =>
  ({
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
    BaseImponibleOimporteNoSujeto: base,
    TipoImpositivo: rate,
    CuotaRepercutida: tax,
  }) satisfies DetalleDesgloseInput;

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

/** Files one alta through the chain writer, with its submission in `estado` (none when null). */
async function file(
  options: {
    figures?: Figures;
    estado?: Estado | null;
    tipo?: "F1" | "F2" | "R5";
    on?: SeededNode;
    sale?: SaleId;
    fixes?: { registroId: string; number: number };
  } = {},
): Promise<{ saleId: SaleId; registroId: string; number: number }> {
  const on = options.on ?? node;
  const number = options.fixes?.number ?? ++invoice;
  const saleId = options.sale ?? (await seedSale(suite.db, on, number));
  const registroId = await withTransaction(suite.db, async (tx) => {
    const pending = altaFor(on, saleId, number, ++second, "preproduction");
    const tipo = options.tipo ?? "F2";
    const { id } = await appendToChain(tx, on.nodeId, {
      ...pending,
      ...(options.fixes === undefined ? {} : { correctsRegistroId: options.fixes.registroId }),
      input: {
        ...pending.input,
        TipoFactura: tipo,
        ...(tipo === "F1"
          ? {
              Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
            }
          : {}),
        ...(tipo === "R5" ? { TipoRectificativa: "I" } : {}),
        ...(options.fixes === undefined ? {} : { Subsanacion: "S", RechazoPrevio: "X" }),
        Desglose: (options.figures ?? AT_21).desglose,
        CuotaTotal: (options.figures ?? AT_21).cuota,
        ImporteTotal: (options.figures ?? AT_21).importe,
      },
    });
    const estado = options.estado === undefined ? "pendiente" : options.estado;
    if (estado !== null)
      await tx.insert(envios).values({ registroId: id, estado, codigoError: "1161" });
    return id;
  });
  return { saleId, registroId, number };
}

function admission(saleId: SaleId, issuingNodeId = node.nodeId): Promise<CorrectionAdmission> {
  return withTransaction(suite.db, (tx) =>
    backend.correctionAdmissionFor(tx, saleId, issuingNodeId),
  );
}

const eligible = (filing: string, number: number) => ({
  eligible: true,
  filing,
  original: { number: `A/${number}`, issuedAt: "2026-07-20" },
});
const refused = (reason: string) => ({ eligible: false, reason });

describe("an F2 is judged by its submission state", () => {
  it.each([
    ["pendiente", eligible("queued", 1)],
    ["enviando", eligible("sending", 1)],
    ["aceptado", eligible("accepted", 1)],
    ["aceptado_con_errores", eligible("accepted_with_issues", 1)],
    ["rechazado", refused("filing_refused")],
  ] as const)("%s", async (estado, expected) => {
    const { saleId } = await file({ estado });
    expect(await admission(saleId)).toEqual(expected);
  });
});

function figuresFor(...saleIds: SaleId[]): Promise<ReadonlyMap<SaleId, FiledFigures>> {
  return withTransaction(suite.db, (tx) => backend.filedFiguresFor(tx, saleIds));
}

const version = (total: string, rate: string, base: string, tax: string) => ({
  total,
  vatBreakdown: [{ rate, base, tax }],
});
const V21 = version("12.10", "21.00", "10.00", "2.10");
const V10 = version("12.10", "10.00", "11.00", "1.10");

describe("a fixed filing: both judge the newest version; the newest answered is the latest accepted", () => {
  it.each([
    ["rechazado", "pendiente", eligible("queued", 1), null],
    ["rechazado", "aceptado", eligible("accepted", 1), V10],
    ["aceptado_con_errores", "pendiente", eligible("queued", 1), V21],
    ["aceptado", "rechazado", refused("filing_refused"), V21],
  ] as const)("first %s, fix %s", async (first, fix, admitted, answered) => {
    const original = await file({ estado: first });
    await file({
      figures: AT_10,
      estado: fix,
      sale: original.saleId,
      fixes: { registroId: original.registroId, number: original.number },
    });

    expect(await admission(original.saleId)).toEqual(admitted);
    expect((await figuresFor(original.saleId)).get(original.saleId)).toEqual({
      readable: true,
      newest: V10,
      newestAnswered: answered,
    });
  });
});

describe("refusals", () => {
  it("a core void", async () => {
    const { saleId } = await file();
    await withTransaction(suite.db, (tx) => backend.recordVoid(tx, saleId, "test", node.nodeId));
    expect(await admission(saleId)).toEqual(refused("voided"));
  });

  it.each(["F1", "R5"] as const)("an %s", async (tipo) => {
    expect(await admission((await file({ tipo })).saleId)).toEqual(refused("not_simplified"));
  });

  it("another node's", async () => {
    const other = await seedNode(suite.db);
    const { saleId } = await file({ on: other });
    expect(await admission(saleId)).toEqual(refused("wrong_node"));
  });

  it("no record, or a record with no submission", async () => {
    expect(await admission(await seedSale(suite.db, node, 50))).toEqual(refused("missing"));
    expect(await admission((await file({ estado: null })).saleId)).toEqual(refused("missing"));
  });

  it("two first versions for one sale", async () => {
    const { saleId } = await file();
    await file({ sale: saleId });
    expect(await admission(saleId)).toEqual(refused("filing_versions_unusable"));
  });
});

describe("unreadable figures", () => {
  const surcharge: DetalleDesgloseInput = {
    ...detail("21.00", "10.00", "2.10"),
    TipoRecargoEquivalencia: "5.20",
    CuotaRecargoEquivalencia: "0.52",
  };
  it.each<[string, Figures, "F1"?]>([
    ["an equivalence surcharge", { desglose: [surcharge], cuota: "2.10", importe: "12.10" }],
    [
      "a regime other than the general one",
      {
        desglose: [{ ...detail("21.00", "10.00", "2.10"), ClaveRegimen: "03" }],
        cuota: "2.10",
        importe: "12.10",
      },
    ],
    [
      "a reverse-charged operation",
      {
        desglose: [{ ...detail("0.00", "12.10", "0.00"), CalificacionOperacion: "S2" }],
        cuota: "0.00",
        importe: "12.10",
      },
      "F1",
    ],
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
  ])("%s", async (_name, figures, tipo) => {
    const { saleId } = await file({ figures, estado: "aceptado", ...(tipo ? { tipo } : {}) });
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

it("reads more sales than one statement can bind, a repeated sale once", async () => {
  const first = await file({ estado: "aceptado" });
  const last = await file({ estado: "aceptado" });
  const unfiled = Array.from({ length: SQL_VARIABLE_LIMIT }, () => brandSaleId(newId()));

  const answer = await figuresFor(first.saleId, ...unfiled, last.saleId, first.saleId);

  expect([...answer.keys()]).toEqual([first.saleId, last.saleId]);
  expect(answer.get(first.saleId)).toMatchObject({ readable: true, newest: V21 });
  expect(answer.get(last.saleId)).toMatchObject({ readable: true, newest: V21 });
});
