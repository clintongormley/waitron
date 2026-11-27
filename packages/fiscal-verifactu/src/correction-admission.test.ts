import { beforeEach, describe, expect, it } from "vitest";
import { previewCorrectionAmounts, readCorrectableLines } from "@waitron/core";
import { captureError, newId, withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { CorrectionAdmission, FiledFigures } from "@waitron/fiscal";
import { saleId as brandSaleId, decimal, type SaleId } from "@waitron/shared";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import type { DetalleDesgloseInput } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { recordCaseEvent } from "./filing-cases.js";
import { currentSif } from "./registro-sif.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const AT = new Date("2026-07-20T17:20:40Z");
const clock = {
  ...steadyClock,
  now: () => ({ ...steadyClock.now(), instant: AT, offsetMinutes: 120 }),
};
type Estado = (typeof verifactuSubmissions.$inferInsert)["estado"];

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
    tipo?: "F1" | "F2" | "F3" | "R4" | "R5";
    byReplacement?: true;
    on?: SeededNode;
    sale?: SaleId;
    fixes?: { registroId: string; number: number };
    refusal?: { codigo: string; mensaje?: string; caseOpen?: boolean };
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
        ...(tipo === "F1" || tipo === "F3" || tipo === "R4"
          ? {
              Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
            }
          : {}),
        ...(tipo === "R4" || tipo === "R5"
          ? options.byReplacement
            ? {
                TipoRectificativa: "S",
                ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
              }
            : { TipoRectificativa: "I" }
          : {}),
        ...(options.fixes === undefined ? {} : { Subsanacion: "S", RechazoPrevio: "X" }),
        Desglose: (options.figures ?? AT_21).desglose,
        CuotaTotal: (options.figures ?? AT_21).cuota,
        ImporteTotal: (options.figures ?? AT_21).importe,
      },
    });
    const estado = options.estado === undefined ? "pendiente" : options.estado;
    const refusal = options.refusal;
    if (estado !== null)
      await tx.insert(verifactuSubmissions).values({
        registroId: id,
        estado,
        codigoError: refusal?.codigo ?? "1161",
        mensajeError: refusal?.mensaje ?? null,
        ...(refusal === undefined || refusal.caseOpen === false
          ? {}
          : {
              caseCause: "fiscal.registro_rechazado" as const,
              caseEvidence: { codigo: Number(refusal.codigo), mensaje: null, csv: null },
              caseOpenedAt: AT,
              caseOpenSeq: number,
            }),
      });
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
    ["detenido", refused("filing_refused")],
    ["retenido", refused("filing_refused")],
  ] as const)("%s", async (estado, expected) => {
    const { saleId } = await file({ estado });
    expect(await admission(saleId)).toEqual(expected);
  });

  it("refused with no fix offered still waits, as today", async () => {
    const { saleId } = await file({ estado: "rechazado", refusal: { codigo: "1161" } });
    expect(await admission(saleId)).toStrictEqual(refused("filing_refused"));
  });
});

describe("a full invoice, an F1 or an R4 by replacement, says so in every answer", () => {
  const full = (answer: object) => ({ ...answer, fullInvoice: true });
  const kinds = [
    ["an F1", { tipo: "F1" }],
    ["an R4 by replacement", { tipo: "R4", byReplacement: true }],
  ] as const;

  it.each(kinds)("%s is admitted", async (_name, kind) => {
    const { saleId, number } = await file(kind);
    expect(await admission(saleId)).toStrictEqual(full(eligible("queued", number)));
  });

  it.each(kinds)("%s refused naming the description waits for its fix", async (_name, kind) => {
    const { saleId } = await file({
      ...kind,
      estado: "rechazado",
      refusal: {
        codigo: "1100",
        mensaje: "Valor o tipo incorrecto del campo: DescripcionOperacion",
      },
    });
    expect(await admission(saleId)).toStrictEqual(full(refused("filing_refused")));
  });

  it.each([
    ["an F1 refused 1112", { tipo: "F1" }, "1112"],
    ["an R4 by replacement refused 1112", { tipo: "R4", byReplacement: true }, "1112"],
    ["an F1 refused with another code", { tipo: "F1" }, "1161"],
    ["an F1 refused 1100 over another field", { tipo: "F1" }, "1100"],
  ] as const)("%s has no fix to wait for", async (_name, kind, codigo) => {
    const { saleId } = await file({ ...kind, estado: "rechazado", refusal: { codigo } });
    expect(await admission(saleId)).toStrictEqual(full(refused("refused_no_fix")));
  });

  it("refused with no open case has no fix to wait for", async () => {
    const { saleId } = await file({
      tipo: "F1",
      estado: "rechazado",
      refusal: {
        codigo: "1100",
        mensaje: "Valor o tipo incorrecto del campo: DescripcionOperacion",
        caseOpen: false,
      },
    });
    expect(await admission(saleId)).toStrictEqual(full(refused("refused_no_fix")));
  });

  it("refused with its case resolved has no fix to wait for", async () => {
    const { saleId, registroId } = await file({
      tipo: "F1",
      estado: "rechazado",
      refusal: {
        codigo: "1100",
        mensaje: "Valor o tipo incorrecto del campo: DescripcionOperacion",
      },
    });
    await withTransaction(suite.db, async (tx) =>
      recordCaseEvent(tx, {
        caseRegistroId: registroId,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: await seedPerson(tx, {}),
        action: "Resolved for the test",
        now: AT,
      }),
    );
    expect(await admission(saleId)).toStrictEqual(full(refused("refused_no_fix")));
  });

  it.each(["detenido", "retenido"] as const)("held or set aside (%s) waits", async (estado) => {
    const { saleId } = await file({ tipo: "F1", estado });
    expect(await admission(saleId)).toStrictEqual(full(refused("filing_refused")));
  });

  it("another node's, accepted, is admitted", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId, number } = await file({ tipo: "F1", on: other, estado: "aceptado" });
    expect(await admission(saleId)).toStrictEqual(full(eligible("accepted", number)));
  });

  it.each([
    [
      "the preview",
      (saleId: SaleId) =>
        withTransaction(suite.db, (tx) =>
          previewCorrectionAmounts(tx, backend, saleId, node.nodeId, { gross: decimal("1.00") }),
        ),
    ],
    [
      "the lines",
      (saleId: SaleId) =>
        withTransaction(suite.db, (tx) => readCorrectableLines(tx, backend, saleId, node.nodeId)),
    ],
  ] as const)(
    "another node's, read by %s without fullInvoice, is refused as not simplified",
    async (_name, read) => {
      const other = await seedNode(suite.db, "B");
      const { saleId } = await file({ tipo: "F1", on: other, estado: "aceptado" });
      expect(await captureError(() => read(saleId))).toMatchObject({
        code: "sale.correction_not_admitted",
        params: { reason: "not_simplified" },
      });
    },
  );

  it("with no submission", async () => {
    const { saleId } = await file({ tipo: "F1", estado: null });
    expect(await admission(saleId)).toStrictEqual(full(refused("missing")));
  });
});

describe("an invoice filed on another chain is judged by its filing, as this box's own", () => {
  const full = (answer: object) => ({ ...answer, fullInvoice: true });
  const kinds = [
    ["a receipt", {}, (answer: object) => answer],
    ["a full invoice", { tipo: "F1" }, full],
  ] as const;

  async function openNewInstallation(on: SeededNode) {
    await withTransaction(suite.db, async (tx) => {
      const { nif, idSistemaInformatico } = await currentSif(tx, on.nodeId);
      await seedFixtureSif(tx, { nodeId: on.nodeId, nif, idSistemaInformatico });
    });
  }

  it.each(kinds)("%s another node filed and AEAT accepted is admitted", async (_n, kind, as) => {
    const other = await seedNode(suite.db, "B");
    const { saleId, number } = await file({ ...kind, on: other, estado: "aceptado" });
    expect(await admission(saleId)).toStrictEqual(as(eligible("accepted", number)));
  });

  it.each(
    kinds.flatMap(([name, kind, as]) =>
      (["pendiente", "enviando", null] as const).map((estado) => [name, estado, kind, as] as const),
    ),
  )("%s another node filed waits while AEAT has not answered it (%s)", async (_n, estado, kind, as) => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({ ...kind, on: other, estado });
    expect(await admission(saleId)).toStrictEqual(as(refused("filing_pending")));
  });

  it("a receipt an earlier installation of this box filed waits while AEAT has not answered it", async () => {
    const { saleId } = await file({ estado: "pendiente" });
    await openNewInstallation(node);
    expect(await admission(saleId)).toStrictEqual(refused("filing_pending"));
  });

  it("a receipt this box's open installation filed is admitted while queued", async () => {
    const { saleId, number } = await file({ estado: "pendiente" });
    expect(await admission(saleId)).toStrictEqual(eligible("queued", number));
  });

  it("a receipt another node filed and AEAT refused waits for its fix", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({ on: other, estado: "rechazado", refusal: { codigo: "1161" } });
    expect(await admission(saleId)).toStrictEqual(refused("filing_refused"));
  });

  it("a full invoice another node filed and AEAT refused with no fix offered is refused for good", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({
      tipo: "F1",
      on: other,
      estado: "rechazado",
      refusal: { codigo: "1112" },
    });
    expect(await admission(saleId)).toStrictEqual(full(refused("refused_no_fix")));
  });

  it("a full invoice another node filed and AEAT refused with a fix offered waits for it", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({
      tipo: "F1",
      on: other,
      estado: "rechazado",
      refusal: { codigo: "1100", mensaje: "Valor o tipo incorrecto del campo: DescripcionOperacion" },
    });
    expect(await admission(saleId)).toStrictEqual(full(refused("filing_refused")));
  });

  it("a receipt another node filed and this box cancelled stays voided", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({ on: other, estado: "aceptado" });
    await withTransaction(suite.db, (tx) => backend.recordVoid(tx, saleId, "test", node.nodeId));
    expect(await admission(saleId)).toStrictEqual(refused("voided"));
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

it("admits a replacement, an R5 by replacement, as it admits an F2", async () => {
  const { saleId, number } = await file({ tipo: "R5", byReplacement: true });
  expect(await admission(saleId)).toEqual(eligible("queued", number));
});

describe("refusals", () => {
  it("a core void", async () => {
    const { saleId } = await file();
    await withTransaction(suite.db, (tx) => backend.recordVoid(tx, saleId, "test", node.nodeId));
    expect(await admission(saleId)).toEqual(refused("voided"));
  });

  it.each(["F3", "R4", "R5"] as const)("an %s", async (tipo) => {
    expect(await admission((await file({ tipo })).saleId)).toStrictEqual(refused("not_simplified"));
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
