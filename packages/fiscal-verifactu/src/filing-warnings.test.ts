import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { markIncidentHandled, recordIncident } from "@waitron/core";
import { incidents, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, jobOrigin } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RespuestaLinea, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { appendToChain, type PendingRegistro } from "./chain.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { readFilingWarnings } from "./filing-warnings.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const FIRST = new Date("2026-07-21T00:01:00Z");
const REF_EXTERNA_KEY = "refExterna";

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** AEAT's reply passes through `reshape`; `delivered` holds the lines the drain was handed. */
function reshaping(
  client: VerifactuClient,
  reshape: (lines: RespuestaLinea[]) => RespuestaLinea[],
): { client: VerifactuClient; delivered: RespuestaLinea[] } {
  const delivered: RespuestaLinea[] = [];
  return {
    delivered,
    client: {
      submit: async (cabecera, registros) => {
        const respuesta = await client.submit(cabecera, registros);
        delivered.splice(0, delivered.length, ...reshape(respuesta.RespuestaLinea));
        return { ...respuesta, RespuestaLinea: [...delivered] };
      },
      consultar: (...args) => client.consultar(...args),
    },
  };
}

/** Two records sent, one line answered: `persistResponse` raises `fiscal.respuesta_descuadrada`. */
async function mismatchedReply() {
  const aeat = createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });
  const seeded = await seedPendingEnvios(suite.db, { count: 2 });
  const reply = reshaping(aeat.client(), (lines) => lines.slice(0, 1));
  await drain(
    {
      db: suite.db,
      resolveClient: staticResolver(reply.client),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production",
    },
    FIRST,
  );
  return { seeded, delivered: reply.delivered };
}

/** An alta whose IPSI line has no regime code, which `validate` warns about. */
function ipsiAlta(node: SeededNode, saleId: Parameters<typeof altaFor>[1], n: number, at: Date) {
  const alta = altaFor(node, saleId, n, 0);
  const ipsiLine = { ...alta.input.Desglose[0]!, Impuesto: "02" as const };
  delete ipsiLine.ClaveRegimen;
  return { ...alta, input: { ...alta.input, Desglose: [ipsiLine], generadoEn: at } };
}

function cleanAlta(node: SeededNode, saleId: Parameters<typeof altaFor>[1], n: number, at: Date) {
  const alta = altaFor(node, saleId, n, 0);
  return { ...alta, input: { ...alta.input, generadoEn: at } };
}

async function append(node: SeededNode, registro: PendingRegistro): Promise<string> {
  const { id } = await inTx((tx) => appendToChain(tx, node.nodeId, registro));
  return id;
}

async function recordOf(id: string) {
  const [row] = await suite.db
    .select({
      numSerieFactura: registrosFacturacion.numSerieFactura,
      fechaExpedicionFactura: registrosFacturacion.fechaExpedicionFactura,
      tipoRegistro: registrosFacturacion.tipoRegistro,
    })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, id));
  return row!;
}

function keySets(value: unknown, path = "", found = new Map<string, Set<string>>()) {
  if (Array.isArray(value)) {
    for (const item of value) keySets(item, `${path}[]`, found);
  } else if (value !== null && typeof value === "object") {
    const keys = found.get(path) ?? new Set<string>();
    for (const [key, inner] of Object.entries(value)) {
      keys.add(key);
      keySets(inner, `${path}.${key}`, found);
    }
    found.set(path, keys);
  }
  return found;
}

// Each with milliseconds, which the stored generation time does not keep.
const AT_ONE = new Date("2026-07-20T17:20:01.400Z");
const AT_TWO = new Date("2026-07-20T17:20:02.700Z");
// After the drain fixture's records, so the chain's clock-behind stop lets it through.
const AFTER_SENT = new Date("2026-07-20T18:30:00.400Z");

describe("readFilingWarnings", () => {
  it("lists a mismatched reply with the records sent, in order, their state now, and AEAT's lines", async () => {
    const { seeded, delivered } = await mismatchedReply();

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    const [first, second] = await Promise.all(seeded.registroIds.map(recordOf));
    expect(delivered).toHaveLength(1);
    const line = delivered[0]!;
    expect(warnings).toEqual({
      replyMismatches: [
        {
          detectedAt: expect.any(String),
          csv: expect.any(String),
          sent: [
            { ...first, estado: "pendiente" },
            { ...second, estado: "pendiente" },
          ],
          lines: [
            {
              numSerieFactura: line.IDFactura.NumSerieFactura,
              fechaExpedicionFactura: line.IDFactura.FechaExpedicionFactura,
              tipoOperacion: line.Operacion?.TipoOperacion ?? null,
              estado: line.EstadoRegistro ?? null,
              codigo: line.CodigoErrorRegistro ?? null,
              mensaje: line.DescripcionErrorRegistro ?? null,
            },
          ],
        },
      ],
      recordWarnings: [],
      total: 1,
    });
    const { rows } = await suite.db.execute<{ csv: string }>(
      sql`select json_extract(params, '$.csv') as csv from incidents where code = 'fiscal.respuesta_descuadrada'`,
    );
    expect(warnings.replyMismatches[0]!.csv).toBe(rows[0]!.csv);
  });

  it("names the flagged invoice, its fields and codes", async () => {
    const node = await seedNode(suite.db);
    const saleId = await seedSale(suite.db, node, 1);
    const flagged = await append(node, ipsiAlta(node, saleId, 1, AT_ONE));

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    expect(warnings).toEqual({
      replyMismatches: [],
      recordWarnings: [
        {
          detectedAt: AT_ONE.toISOString(),
          kind: "flagged",
          fields: ["Desglose[0].ClaveRegimen"],
          codes: ["CLAVE_REGIMEN_REQUIRED"],
          record: { ...(await recordOf(flagged)), estado: null },
        },
      ],
      total: 1,
    });
  });

  it("names no record when two records of the sale were generated in the warning's second", async () => {
    const node = await seedNode(suite.db);
    const saleId = await seedSale(suite.db, node, 1);
    await append(node, ipsiAlta(node, saleId, 1, AT_ONE));
    const cancellation = anulacionFor(node, saleId, 1, 0);
    await append(node, {
      ...cancellation,
      input: { ...cancellation.input, generadoEn: new Date(AT_ONE.getTime() + 300) },
    });

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    expect(warnings.recordWarnings).toEqual([expect.objectContaining({ record: null })]);
  });

  it("never names another sale's record generated in the same second", async () => {
    const node = await seedNode(suite.db);
    const saleId = await seedSale(suite.db, node, 1);
    const flagged = await append(node, ipsiAlta(node, saleId, 1, AT_ONE));
    const otherSale = await seedSale(suite.db, node, 2);
    await append(node, cleanAlta(node, otherSale, 2, AT_ONE));

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    expect(warnings.recordWarnings).toEqual([
      expect.objectContaining({ record: { ...(await recordOf(flagged)), estado: null } }),
    ]);
  });

  it("leaves out a predecessor-check alert, and every handled one", async () => {
    const node = await seedNode(suite.db);
    const handledSale = await seedSale(suite.db, node, 1);
    await append(node, ipsiAlta(node, handledSale, 1, AT_ONE));
    const [handled] = await suite.db.select({ id: incidents.id }).from(incidents);
    await inTx(async (tx) => {
      await markIncidentHandled(tx, { id: handled!.id, personId: null, handledAt: AT_TWO });
      await recordIncident(tx, {
        origin: jobOrigin("dashboard"),
        error: new AppError("chain.verification_failed", { deviceId: null, issues: [] }),
        severity: "error",
        detectedAt: AT_TWO,
      });
    });
    const openSale = await seedSale(suite.db, node, 2);
    await append(node, ipsiAlta(node, openSale, 2, AT_TWO));

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    expect(warnings.total).toBe(1);
    expect(warnings.replyMismatches).toEqual([]);
    expect(warnings.recordWarnings).toEqual([
      expect.objectContaining({ detectedAt: AT_TWO.toISOString() }),
    ]);
  });

  it("lists the newest within the limit and counts every open one", async () => {
    const node = await seedNode(suite.db);
    const older = await seedSale(suite.db, node, 1);
    await append(node, ipsiAlta(node, older, 1, AT_ONE));
    const newer = await seedSale(suite.db, node, 2);
    await append(node, ipsiAlta(node, newer, 2, AT_TWO));

    const bounded = await inTx((tx) => readFilingWarnings(tx, { limit: 1 }));
    const unbounded = await inTx((tx) => readFilingWarnings(tx, { limit: null }));

    expect(bounded.total).toBe(2);
    expect(bounded.recordWarnings.map((each) => each.detectedAt)).toEqual([AT_TWO.toISOString()]);
    expect(unbounded.recordWarnings.map((each) => each.detectedAt)).toEqual([
      AT_TWO.toISOString(),
      AT_ONE.toISOString(),
    ]);
  });

  it("names only the listed fields, at every level, and carries no AEAT reference or issuer tax number", async () => {
    const { seeded, delivered } = await mismatchedReply();
    const node = await seedNode(suite.db);
    const saleId = await seedSale(suite.db, node, 1);
    await append(node, ipsiAlta(node, saleId, 1, AFTER_SENT));

    const warnings = await inTx((tx) => readFilingWarnings(tx, { limit: 200 }));

    expect(warnings.recordWarnings).toEqual([
      expect.objectContaining({ record: expect.any(Object) }),
    ]);
    const record = ["numSerieFactura", "fechaExpedicionFactura", "tipoRegistro", "estado"];
    const expected: Record<string, string[]> = {
      "": ["replyMismatches", "recordWarnings", "total"],
      ".replyMismatches[]": ["detectedAt", "csv", "sent", "lines"],
      ".replyMismatches[].sent[]": record,
      ".replyMismatches[].lines[]": [
        "numSerieFactura",
        "fechaExpedicionFactura",
        "tipoOperacion",
        "estado",
        "codigo",
        "mensaje",
      ],
      ".recordWarnings[]": ["detectedAt", "kind", "fields", "codes", "record"],
      ".recordWarnings[].record": record,
    };
    const found = Object.fromEntries(
      [...keySets(warnings)].map(([path, keys]) => [path, [...keys].sort()]),
    );
    expect(found).toEqual(
      Object.fromEntries(Object.entries(expected).map(([path, keys]) => [path, [...keys].sort()])),
    );
    const text = JSON.stringify(warnings);
    expect(text).not.toContain(REF_EXTERNA_KEY);
    for (const ref of delivered.map((line) => line.RefExterna).filter(Boolean))
      expect(text).not.toContain(ref);
    expect(text).not.toContain(seeded.nif);
  });
});
