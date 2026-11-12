import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sales, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { steadyClock, staticResolver } from "../test/write-path-fixtures.js";
import { appendToChain, readChainHead } from "./chain.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import type { RemedyKind } from "./record-remedy.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { filingCaseEvents, type FilingCaseCause } from "./schema/filing-cases.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-20T17:20:35Z");
let node: SeededNode;
let token: string;
let personId: string;
let instant: Date;
let writable: boolean;
let runtimeNode: SeededNode["nodeId"];
let environment: "production" | "preproduction";
let body: { kind: string; caseId: string; registroId: string; actionKey: string; reason: string };

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  instant = NOW;
  writable = true;
  node = await seedNode(suite.db);
  runtimeNode = node.nodeId;
  environment = "preproduction";
  const saleId = await seedSale(suite.db, node, 1);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
    await setFreshManagementSignIn(tx, token);
    const original = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, 1, 1, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: original.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    body = {
      kind: "absent-original-cancellation",
      caseId: filingCase.id,
      registroId: original.id,
      actionKey: "absent-1",
      reason: "Explicit synthetic absent-original decision",
    };
  });
});

function send(
  value: unknown = body,
  enabled: RemedyKind[] | null = ["absent-original-cancellation"],
  runtime = true,
) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    {
      db: suite.db,
      recordGeneration: runtime
        ? {
            nodeId: runtimeNode,
            environment,
            clock: {
              ...steadyClock,
              now: () => ({ ...steadyClock.now(), instant, offsetMinutes: -300 }),
            },
            requireWritable: () => {
              if (!writable) throw new AppError("node.read_only", {});
            },
          }
        : undefined,
    },
    () => {},
    enabled === null ? undefined : new Set(enabled),
  );
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function snapshot() {
  return {
    records: await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia),
    deliveries: await suite.db.select().from(envios),
    cases: await withTransaction(suite.db, listFilingCases),
    sales: await suite.db.select().from(sales),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}

it("appends the explicit absent-original cancellation at the current head without changing issued or accounting facts", async () => {
  const laterSale = await seedSale(suite.db, node, 2);
  await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, altaFor(node, laterSale, 2, 2, "preproduction")),
  );
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(200);
  const result = (await response.json()) as { registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records).toHaveLength(3);
  expect(after.records[2]).toMatchObject({
    id: result.registroId,
    tipoRegistro: "anulacion",
    saleId: before.records[0]!.saleId,
    source: before.records[0]!.source,
    deviceId: before.records[0]!.deviceId,
    idEmisorFactura: "89890001K",
    numSerieFactura: "A/1",
    fechaExpedicionFactura: "2026-07-20",
    sinRegistroPrevio: "S",
    rechazoPrevio: null,
    correctsRegistroId: null,
    anteriorHuella: before.records[1]!.huella,
    secuencia: 3,
    fechaHoraHusoGenRegistro: NOW,
    offsetMinutos: 120,
    sistemaInformatico: { NombreSistemaInformatico: "Waitron", Version: "0.0.0-dev" },
  });
  expect(after.deliveries.find((row) => row.registroId === body.registroId)).toEqual(
    before.deliveries[0],
  );
  expect(after.deliveries.find((row) => row.registroId === result.registroId)).toMatchObject({
    estado: "pendiente",
    intentos: 0,
  });
  expect(after.sales).toEqual(before.sales);
  expect(after.cases[0]).toMatchObject({
    status: "resolved",
    events: [
      { id: result.eventId, personId, kind: "resolved", remedyRegistroId: result.registroId },
    ],
  });
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("replays the same decision after clock and original delivery changes without another append", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  instant = new Date("2026-07-20T18:20:35Z");
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, body.registroId));
  const before = await snapshot();
  const retry = await send(Object.fromEntries(Object.entries(body).reverse()));
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("serialises simultaneous retries into one saved result", async () => {
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
  expect((await snapshot()).records).toHaveLength(2);
  expect((await snapshot()).cases[0]!.events).toHaveLength(1);
});

it.each(["pendiente", "enviando", "detenido", "retenido", "aceptado", "aceptado_con_errores"])(
  "refuses the original outcome %s rather than choosing a cancellation",
  async (estado) => {
    await suite.db.update(envios).set({ estado }).where(eq(envios.registroId, body.registroId));
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a duplicate conflict even when it has the same invoice key and totals", async () => {
  await suite.db
    .update(envios)
    .set({ codigoError: "3000" })
    .where(eq(envios.registroId, body.registroId));
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses code 3000 even when a synthetic rejected case carries that same code", async () => {
  const otherSale = await seedSale(suite.db, node, 2);
  const selected = await withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, otherSale, 2, 2, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: record.id, estado: "rechazado", codigoError: "3000" });
    const filingCase = await openFilingCase(tx, {
      registroId: record.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 3000, mensaje: null, csv: null },
      now: NOW,
    });
    return { ...body, registroId: record.id, caseId: filingCase.id };
  });
  const before = await snapshot();
  const response = await send(selected);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an already generated ordinary cancellation and preserves its held payload", async () => {
  const [original] = await suite.db.select().from(registrosFacturacion);
  await withTransaction(suite.db, async (tx) => {
    const cancellation = await appendToChain(
      tx,
      node.nodeId,
      anulacionFor(node, brandSaleId(original!.saleId), 1, 2, "preproduction"),
    );
    await tx.insert(envios).values({ registroId: cancellation.id, estado: "retenido" });
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a stale rejected version after a correction was appended", async () => {
  const [original] = await suite.db.select().from(registrosFacturacion);
  await withTransaction(suite.db, (tx) => {
    const next = altaFor(node, brandSaleId(original!.saleId), 1, 2, "preproduction");
    return appendToChain(tx, node.nodeId, {
      ...next,
      correctsRegistroId: body.registroId,
      input: { ...next.input, Subsanacion: "S", RechazoPrevio: "X" },
    });
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("uses the issued sale origin when cancelling a rejected current correction", async () => {
  const [original] = await suite.db.select().from(registrosFacturacion);
  const decision = await withTransaction(suite.db, async (tx) => {
    const pending = altaFor(node, brandSaleId(original!.saleId), 1, 2, "preproduction");
    const current = await appendToChain(tx, node.nodeId, {
      ...pending,
      origin: { source: "operator_script", deviceId: null },
      correctsRegistroId: body.registroId,
      input: { ...pending.input, Subsanacion: "S", RechazoPrevio: "X" },
    });
    await tx
      .insert(envios)
      .values({ registroId: current.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: current.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    return { ...body, registroId: current.id, caseId: filingCase.id };
  });
  const before = await snapshot();
  const response = await send(decision);
  expect(response.status).toBe(200);
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    tipoRegistro: "anulacion",
    source: "device",
    deviceId: node.deviceId,
    numSerieFactura: "A/1",
    sinRegistroPrevio: "S",
    anteriorHuella: before.records[1]!.huella,
  });
  expect(after.cases[0]).toEqual(before.cases[0]);
  expect(after.cases[1]!.status).toBe("resolved");
});

it.each(["reason", "caseId", "registroId"] as const)(
  "refuses changed %s on replay",
  async (field) => {
    expect((await send()).status).toBe(200);
    const before = await snapshot();
    const response = await send({ ...body, [field]: "different-decision" });
    expect(response.status).toBe(field === "registroId" ? 400 : 409);
    expect(await response.json()).toMatchObject({
      error: {
        code: field === "registroId" ? "fiscal.remedy_invalid" : "filing_case.action_mismatch",
      },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["staff", "supervisor", "manager"] as const)("refuses %s authority", async (role) => {
  await setBuiltInRoleForTest(suite.db, personId, role);
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "keeps server policy and writable admission on %s replay",
  async (replay) => {
    if (replay) expect((await send()).status).toBe(200);
    const before = await snapshot();
    for (const enabled of [[], ["record-correction"]] as RemedyKind[][]) {
      const response = await send(body, enabled);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    }
    const production = await send(body, null);
    expect(production.status).toBe(409);
    expect(await production.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    writable = false;
    const response = await send();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "node.read_only" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([false, true])("binds node and deployment on %s replay", async (replay) => {
  if (replay) expect((await send()).status).toBe(200);
  const before = await snapshot();
  runtimeNode = "foreign-node" as typeof runtimeNode;
  const foreign = await send();
  expect(foreign.status).toBe(400);
  expect(await foreign.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  runtimeNode = node.nodeId;
  environment = "production";
  const wrongDeployment = await send();
  expect(wrongDeployment.status).toBe(400);
  expect(await wrongDeployment.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a second resolution and rolls its candidate append back", async () => {
  await suite.db.insert(filingCaseEvents).values({
    caseId: body.caseId,
    actionKey: "earlier",
    kind: "resolved",
    personId,
    action: "A different earlier resolution",
    recordedAt: NOW,
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "filing_case.already_resolved" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a clock more than a minute behind the chain", async () => {
  instant = new Date("2026-07-20T17:18:00Z");
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "clock.behind_chain" } });
  expect(await snapshot()).toEqual(before);
});

it("requires the case to belong to the selected record even when totals match", async () => {
  const otherSale = await seedSale(suite.db, node, 2);
  const other = await withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, otherSale, 2, 2, "preproduction"),
    );
    return openFilingCase(tx, {
      registroId: record.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
  });
  const before = await snapshot();
  const response = await send({ ...body, caseId: other.id });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([
  "fiscal.huella_divergente",
  "fiscal.duplicado_anulado",
  "fiscal.aceptado_con_errores",
  "fiscal.anulacion_retenida",
] satisfies FilingCaseCause[])("refuses case cause %s with a rejected delivery", async (cause) => {
  const otherSale = await seedSale(suite.db, node, 2);
  const selected = await withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, otherSale, 2, 2, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: record.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: record.id,
      cause,
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    return { ...body, registroId: record.id, caseId: filingCase.id };
  });
  const before = await snapshot();
  const response = await send(selected);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([null, "1162"])("refuses inconsistent rejection evidence %s", async (codigoError) => {
  await suite.db.update(envios).set({ codigoError }).where(eq(envios.registroId, body.registroId));
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an absent server generation context", async () => {
  const before = await snapshot();
  const response = await send(body, ["absent-original-cancellation"], false);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses when the venue row is missing without changing any fiscal facts", async () => {
  await suite.db.delete(tenants);
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a malformed synthetic correction with no issued original for its sale", async () => {
  const otherSale = await seedSale(suite.db, node, 2);
  const selected = await withTransaction(suite.db, async (tx) => {
    const [original] = await tx.select().from(registrosFacturacion);
    const [malformed] = await tx
      .insert(registrosFacturacion)
      .values({
        ...original!,
        id: crypto.randomUUID(),
        saleId: otherSale,
        secuencia: 2,
        correctsRegistroId: body.registroId,
        subsanacion: "S",
        rechazoPrevio: "X",
      })
      .returning();
    await tx
      .insert(envios)
      .values({ registroId: malformed!.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: malformed!.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    return { ...body, registroId: malformed!.id, caseId: filingCase.id };
  });
  const before = await snapshot();
  const response = await send(selected);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each([
  "operator",
  "enabledRemedies",
  "nodeId",
  "environment",
  "input",
  "facts",
  "SinRegistroPrevio",
])("refuses client-controlled %s", async (field) => {
  const before = await snapshot();
  const response = await send({ ...body, [field]: "override" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["reason", "actionKey", "registroId", "caseId"])("refuses an empty %s", async (field) => {
  const before = await snapshot();
  const response = await send({ ...body, [field]: "  " });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("submits the explicitly chosen absent-original operation instead of setting it aside as an ordinary cancellation", async () => {
  const response = await send();
  expect(response.status).toBe(200);
  const result = (await response.json()) as { registroId: string };
  const before = await snapshot();
  const aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  const counts = await drain(
    {
      db: suite.db,
      environment: "preproduction",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: staticResolver(aeat.client()),
    },
    NOW,
  );
  expect(counts.recordsAccepted).toBe(1);
  expect(counts.recordsHalted).toBe(0);
  const after = await snapshot();
  expect(after.deliveries.find((r) => r.registroId === result.registroId)).toMatchObject({
    estado: "aceptado",
    intentos: 1,
  });
  expect(after.deliveries.find((r) => r.registroId === body.registroId)).toEqual(
    before.deliveries[0],
  );
  expect(after.records).toEqual(before.records);
  expect(after.sales).toEqual(before.sales);
  expect(after.cases).toEqual(before.cases);
  const raw = await suite.db.execute(
    sql`select sin_registro_previo from registros_facturacion where id = ${result.registroId}`,
  );
  expect(raw.rows).toEqual([{ sin_registro_previo: "S" }]);
});

it("a refused record of the box this one took over from can be remedied here", async () => {
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  runtimeNode = successor.nodeId;
  const before = await snapshot();

  const response = await send();

  expect(response.status).toBe(200);
  const { registroId } = (await response.json()) as { registroId: string };
  const [appended] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, registroId));
  expect(appended).toMatchObject({
    nodeId: successor.nodeId,
    sifId: successor.sifId,
    tipoRegistro: "anulacion",
    saleId: before.records[0]!.saleId,
    numSerieFactura: before.records[0]!.numSerieFactura,
    sinRegistroPrevio: "S",
  });
  expect((await snapshot()).head).toEqual(before.head);
});

it("a record of an unrelated box is still refused", async () => {
  const successor = await seedNode(suite.db, "B");
  const unrelated = await seedNode(suite.db, "C");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  runtimeNode = unrelated.nodeId;
  const before = await snapshot();

  const response = await send();

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("names the producer from the settings in the cancellation's software block, keeping the taxpayer as issuer", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000T");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "1 Example Street, 00000 Nowhere (Province), Spain");
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(200);
  const after = await snapshot();
  const cancellation = after.records.at(-1)!;
  expect(cancellation.tipoRegistro).toBe("anulacion");
  expect(cancellation.sistemaInformatico).toMatchObject({
    NombreRazon: "PRODUCER PERSON",
    NIF: "00000000T",
  });
  expect(cancellation.nombreRazonEmisor).toBe(before.records[0]!.nombreRazonEmisor);
  expect(cancellation.nombreRazonEmisor).not.toBe("PRODUCER PERSON");
  expect(cancellation.idEmisorFactura).toBe(before.records[0]!.idEmisorFactura);
});

it("refuses a production cancellation while no producer is set, writing nothing", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "");
  const saleId = await seedSale(suite.db, node, 2);
  const decision = await withTransaction(suite.db, async (tx) => {
    const original = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, 2, 2, "production"),
    );
    await tx
      .insert(envios)
      .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
    const filingCase = await openFilingCase(tx, {
      registroId: original.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
    return { ...body, caseId: filingCase.id, registroId: original.id, actionKey: "absent-prod" };
  });
  environment = "production";
  const before = await snapshot();
  const response = await send(decision);
  expect(await response.json()).toMatchObject({ error: { code: "sif.producer_unset" } });
  expect(await snapshot()).toEqual(before);
});
