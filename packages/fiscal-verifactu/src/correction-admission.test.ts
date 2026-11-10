import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { CorrectionAdmission } from "@waitron/fiscal";
import type { SaleId } from "@waitron/shared";
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

/** Files one alta through the chain writer, with its submission in `estado` (none when null). */
async function file(
  options: {
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

describe("a fixed filing is judged by its newest version", () => {
  it.each([
    ["rechazado", "pendiente", eligible("queued", 1)],
    ["aceptado", "rechazado", refused("filing_refused")],
  ] as const)("first %s, fix %s", async (first, fix, expected) => {
    const original = await file({ estado: first });
    await file({
      estado: fix,
      sale: original.saleId,
      fixes: { registroId: original.registroId, number: original.number },
    });
    expect(await admission(original.saleId)).toEqual(expected);
  });
});

describe("refusals, each beside the eligible control it differs from in one fact", () => {
  it("a core void", async () => {
    const { saleId } = await file();
    expect(await admission(saleId)).toEqual(eligible("queued", 1));
    await withTransaction(suite.db, (tx) => backend.recordVoid(tx, saleId, "test", node.nodeId));
    expect(await admission(saleId)).toEqual(refused("voided"));
  });

  it.each(["F1", "R5"] as const)("an %s", async (tipo) => {
    expect(await admission((await file({ tipo: "F2" })).saleId)).toEqual(eligible("queued", 1));
    expect(await admission((await file({ tipo })).saleId)).toEqual(refused("not_simplified"));
  });

  it("another node's", async () => {
    const other = await seedNode(suite.db, "B");
    const { saleId } = await file({ on: other });
    expect(await admission(saleId, other.nodeId)).toEqual(eligible("queued", 1));
    expect(await admission(saleId)).toEqual(refused("wrong_node"));
  });

  it("no record, or a record with no submission", async () => {
    expect(await admission(await seedSale(suite.db, node, 50))).toEqual(refused("missing"));
    expect(await admission((await file({ estado: null })).saleId)).toEqual(refused("missing"));
  });

  it("two first versions for one sale", async () => {
    const { saleId } = await file();
    expect(await admission(saleId)).toEqual(eligible("queued", 1));
    await file({ sale: saleId });
    expect(await admission(saleId)).toEqual(refused("filing_versions_unusable"));
  });
});
