import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { sales, saleSettlements, tenders, tenderRefunds, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { steadyClock, staticResolver } from "../test/write-path-fixtures.js";
import { writeAck, pendingAcks } from "./acks.js";
import { appendToChain, readChainHead } from "./chain.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import type { RemedyKind } from "./record-remedy.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";
import { verifyChain } from "./verify.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-20T17:20:35Z");
const KIND = "release-held-cancellation" satisfies RemedyKind;
let node: SeededNode;
let token: string;
let personId: string;
let writable: boolean;
let environment: "production" | "preproduction";
let runtimeNode: SeededNode["nodeId"];
let body: Record<string, unknown>;
let originalId: string;
let originalCaseId: string;
let currentId: string;

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  writable = true;
  environment = "preproduction";
  runtimeNode = node.nodeId;
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
    originalId = original.id;
    await tx
      .insert(envios)
      .values({ registroId: originalId, estado: "rechazado", codigoError: "1161" });
    originalCaseId = (
      await openFilingCase(tx, {
        registroId: originalId,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: NOW,
      })
    ).id;
    const held = await appendToChain(
      tx,
      node.nodeId,
      anulacionFor(node, saleId, 1, 2, "preproduction"),
    );
    await tx
      .insert(envios)
      .values({ registroId: held.id, estado: "retenido", intentos: 1, incidencia: true });
    await writeAck(tx, held.id, NOW);
    const heldCase = await openFilingCase(tx, {
      registroId: held.id,
      cause: "fiscal.anulacion_retenida",
      evidence: { codigo: null, mensaje: null, csv: null },
      now: NOW,
    });
    body = {
      kind: KIND,
      registroId: held.id,
      caseId: heldCase.id,
      actionKey: "release-held-1",
      reason: "Explicit synthetic release after original correction",
    };
  });
  const correction = await send(
    {
      kind: "record-correction",
      registroId: originalId,
      caseId: originalCaseId,
      actionKey: "correct-original",
      reason: "Correct rejected stored facts",
      facts: { description: "Corrected restaurant service" },
    },
    ["record-correction"],
  );
  expect(correction.status).toBe(200);
  currentId = ((await correction.json()) as { registroId: string }).registroId;
  body.acceptedRegistroId = currentId;
});

function send(value: unknown = body, enabled: RemedyKind[] | null = [KIND], runtime = true) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    {
      db: suite.db,
      recordGeneration: runtime
        ? {
            nodeId: runtimeNode,
            environment,
            clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: NOW }) },
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

async function acceptCurrent() {
  await suite.db
    .update(envios)
    .set({ estado: "aceptado", confirmadoEn: NOW, csv: "SYNTHETIC-CORRECTION-CSV" })
    .where(eq(envios.registroId, currentId));
}
async function snapshot() {
  return {
    records: await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia),
    deliveries: await suite.db.select().from(envios).orderBy(envios.registroId),
    cases: await withTransaction(suite.db, listFilingCases),
    sales: await suite.db.select().from(sales),
    tenders: await suite.db.select().from(tenders),
    refunds: await suite.db.select().from(tenderRefunds),
    settlements: await suite.db.select().from(saleSettlements),
    acks: await pendingAcks(suite.db),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}

it("releases the existing held cancellation and resolves its case without a new fiscal or accounting row", async () => {
  await acceptCurrent();
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(200);
  const result = (await response.json()) as { registroId: string; eventId: string };
  expect(result.registroId).toBe(body.registroId);
  const after = await snapshot();
  expect(after.records).toEqual(before.records);
  expect(after.sales).toEqual(before.sales);
  expect(after.tenders).toEqual(before.tenders);
  expect(after.refunds).toEqual(before.refunds);
  expect(after.settlements).toEqual(before.settlements);
  expect(after.head).toEqual(before.head);
  expect(after.cases[0]).toEqual(before.cases[0]);
  expect(after.cases[1]).toMatchObject({
    status: "resolved",
    events: [{ id: result.eventId, kind: "resolved", personId, remedyRegistroId: null }],
  });
  expect(JSON.parse(after.cases[1]!.events[0]!.action)).toEqual({
    ...body,
    acceptedRegistroId: currentId,
  });
  expect(after.acks).toEqual([]);
  expect(after.deliveries.filter((r) => r.registroId !== body.registroId)).toEqual(
    before.deliveries.filter((r) => r.registroId !== body.registroId),
  );
  expect(after.deliveries.find((r) => r.registroId === body.registroId)).toEqual({
    ...before.deliveries.find((r) => r.registroId === body.registroId),
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
  expect((await withTransaction(suite.db, (tx) => verifyChain(tx, node.nodeId))).issues).toEqual(
    [],
  );
});

it("keeps the cancellation held while the current correction has no confirmed acceptance", async () => {
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("submits the corrected original and then the same held cancellation through the real client with unchanged sales", async () => {
  const aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  const deps = {
    db: suite.db,
    environment: "preproduction" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: staticResolver(aeat.client()),
  };
  const beforeCorrection = await snapshot();
  const corrected = await drain(deps, NOW);
  expect(corrected.recordsAccepted).toBe(1);
  const beforeRelease = await snapshot();
  expect(beforeRelease.deliveries.find((r) => r.registroId === currentId)).toMatchObject({
    estado: "aceptado",
  });
  expect(beforeRelease.deliveries.find((r) => r.registroId === body.registroId)).toMatchObject({
    estado: "retenido",
  });
  expect((await send()).status).toBe(200);
  const cancelled = await drain(deps, new Date(NOW.getTime() + 60_000));
  expect(cancelled.recordsAccepted).toBe(1);
  expect(cancelled.recordsHalted).toBe(0);
  const after = await snapshot();
  expect(after.records).toEqual(beforeCorrection.records);
  expect(after.sales).toEqual(beforeCorrection.sales);
  expect(after.head).toEqual(beforeCorrection.head);
  expect(after.deliveries.find((r) => r.registroId === originalId)).toEqual(
    beforeCorrection.deliveries.find((r) => r.registroId === originalId),
  );
  expect(after.deliveries.find((r) => r.registroId === body.registroId)).toMatchObject({
    estado: "aceptado",
    intentos: 2,
  });
  expect(after.cases.map((c) => c.status)).toEqual(["resolved", "resolved"]);
});

it("replays a reordered release after submission and a later original outcome change without releasing again", async () => {
  await acceptCurrent();
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  await suite.db
    .update(envios)
    .set({ estado: "aceptado", confirmadoEn: NOW })
    .where(eq(envios.registroId, body.registroId as string));
  await suite.db
    .update(envios)
    .set({ estado: "rechazado" })
    .where(eq(envios.registroId, currentId));
  const before = await snapshot();
  const retry = await send(Object.fromEntries(Object.entries(body).reverse()));
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("serializes simultaneous release requests into one case event", async () => {
  await acceptCurrent();
  const results = await Promise.all([send(), send()]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(await results[0]!.json()).toEqual(await results[1]!.json());
  expect((await snapshot()).cases[1]!.events).toHaveLength(1);
});

it.each(["pendiente", "enviando", "rechazado", "detenido", "retenido", "aceptado_con_errores"])(
  "refuses current original state %s",
  async (estado) => {
    await suite.db.update(envios).set({ estado }).where(eq(envios.registroId, currentId));
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["pendiente", "enviando", "rechazado", "detenido", "aceptado", "aceptado_con_errores"])(
  "refuses cancellation state %s without a saved release",
  async (estado) => {
    await acceptCurrent();
    await suite.db
      .update(envios)
      .set({ estado })
      .where(eq(envios.registroId, body.registroId as string));
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["caseId", "registroId", "acceptedRegistroId"])("refuses a missing %s row", async (key) => {
  await acceptCurrent();
  const before = await snapshot();
  const response = await send({ ...body, [key]: "missing" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses another case even when both records belong to the same invoice", async () => {
  await acceptCurrent();
  const before = await snapshot();
  const response = await send({ ...body, caseId: originalCaseId });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an accepted older version when a newer correction is still pending", async () => {
  await acceptCurrent();
  const [original] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, originalId));
  await withTransaction(suite.db, async (tx) => {
    const next = altaFor(
      node,
      original!.saleId as Parameters<typeof altaFor>[1],
      1,
      4,
      "preproduction",
    );
    const appended = await appendToChain(tx, node.nodeId, {
      ...next,
      correctsRegistroId: currentId,
      input: { ...next.input, Subsanacion: "S", RechazoPrevio: "N" },
    });
    await tx.insert(envios).values({ registroId: appended.id });
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an unrelated accepted invoice with the same amount", async () => {
  const saleId = await seedSale(suite.db, node, 2);
  const accepted = await withTransaction(suite.db, async (tx) => {
    const next = await appendToChain(tx, node.nodeId, altaFor(node, saleId, 2, 4, "preproduction"));
    await tx.insert(envios).values({ registroId: next.id, estado: "aceptado" });
    return next.id;
  });
  const before = await snapshot();
  const response = await send({ ...body, acceptedRegistroId: accepted });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["reason", "acceptedRegistroId", "caseId"])(
  "refuses changed %s on replay",
  async (field) => {
    await acceptCurrent();
    expect((await send()).status).toBe(200);
    const before = await snapshot();
    const response = await send({ ...body, [field]: "changed" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["staff", "supervisor", "manager"] as const)("refuses %s authority", async (role) => {
  await acceptCurrent();
  await setBuiltInRoleForTest(suite.db, personId, role);
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "checks closed public policy and writable admission on replay=%s",
  async (replay) => {
    await acceptCurrent();
    if (replay) expect((await send()).status).toBe(200);
    const before = await snapshot();
    for (const enabled of [null, [], ["absent-original-cancellation"]] as (RemedyKind[] | null)[]) {
      const response = await send(body, enabled);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    }
    writable = false;
    const response = await send();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "node.read_only" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([false, true])("checks host node and environment on replay=%s", async (replay) => {
  await acceptCurrent();
  if (replay) expect((await send()).status).toBe(200);
  const before = await snapshot();
  runtimeNode = "foreign-node" as typeof runtimeNode;
  const foreign = await send();
  expect(foreign.status).toBe(400);
  expect(await foreign.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  runtimeNode = node.nodeId;
  environment = "production";
  const wrongEnvironment = await send();
  expect(wrongEnvironment.status).toBe(400);
  expect(await wrongEnvironment.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("rolls the release and ack removal back when the case already has another resolution", async () => {
  await acceptCurrent();
  await suite.db.insert(filingCaseEvents).values({
    caseId: body.caseId as string,
    actionKey: "older-decision",
    kind: "resolved",
    personId,
    action: "Earlier different decision",
    recordedAt: NOW,
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "filing_case.already_resolved" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["reason", "actionKey", "caseId", "registroId", "acceptedRegistroId"])(
  "refuses a blank %s",
  async (field) => {
    await acceptCurrent();
    const before = await snapshot();
    const response = await send({ ...body, [field]: " " });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "fiscal.remedy_request_invalid" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["operator", "enabledRemedies", "nodeId", "estado", "pending", "facts"])(
  "refuses client-controlled %s",
  async (field) => {
    await acceptCurrent();
    const before = await snapshot();
    const response = await send({ ...body, [field]: "override" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "fiscal.remedy_request_invalid" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a missing server generation context", async () => {
  await acceptCurrent();
  const before = await snapshot();
  const response = await send(body, [KIND], false);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an already accepted cancellation as the claimed accepted original", async () => {
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, body.registroId as string));
  const before = await snapshot();
  const response = await send({ ...body, acceptedRegistroId: body.registroId });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["current", "held"])("refuses a missing %s delivery", async (which) => {
  await acceptCurrent();
  await suite.db
    .delete(envios)
    .where(eq(envios.registroId, which === "current" ? currentId : (body.registroId as string)));
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a saved decision that belongs to another administrator", async () => {
  await acceptCurrent();
  expect((await send()).status).toBe(200);
  token = await withTransaction(suite.db, async (tx) => {
    const [other] = await seedPersons(tx, {
      displayName: "Other administrator",
      role: "admin",
      pinHash: hashPin("1357"),
    });
    const session = await startManagementSession(tx, { personId: other!.id });
    await setFreshManagementSignIn(tx, session.token);
    return session.token;
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
  expect(await snapshot()).toEqual(before);
});

it("still checks the administrator's current role on replay", async () => {
  await acceptCurrent();
  expect((await send()).status).toBe(200);
  await setBuiltInRoleForTest(suite.db, personId, "manager");
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await snapshot()).toEqual(before);
});

it.each([null, 1, [], {}, true])("refuses non-text accepted-version input %j", async (value) => {
  await acceptCurrent();
  const before = await snapshot();
  const response = await send({ ...body, acceptedRegistroId: value });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses an absent-original cancellation even with a matching accepted invoice and synthetic held case", async () => {
  const otherSale = await seedSale(suite.db, node, 2);
  await withTransaction(suite.db, async (tx) => {
    const accepted = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, otherSale, 2, 5, "preproduction"),
    );
    await tx.insert(envios).values({ registroId: accepted.id, estado: "aceptado" });
    const pending = anulacionFor(node, otherSale, 2, 6, "preproduction");
    const cancellation = await appendToChain(tx, node.nodeId, {
      ...pending,
      input: { ...pending.input, SinRegistroPrevio: "S" },
    });
    await tx.insert(envios).values({ registroId: cancellation.id, estado: "retenido" });
    const filingCase = await openFilingCase(tx, {
      registroId: cancellation.id,
      cause: "fiscal.anulacion_retenida",
      evidence: { codigo: null, mensaje: null, csv: null },
      now: NOW,
    });
    body = {
      ...body,
      registroId: cancellation.id,
      caseId: filingCase.id,
      acceptedRegistroId: accepted.id,
    };
  });
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

async function deliveryOf(registroId: string) {
  const [delivery] = await suite.db.select().from(envios).where(eq(envios.registroId, registroId));
  return delivery;
}

it("a set-aside cancellation on another chain is released once its original is accepted", async () => {
  // The box this one took over from cancelled its own refused invoice, and the cancellation was
  // set aside; this box corrects the invoice on its own chain, and the correction is accepted.
  const saleId = await seedSale(suite.db, node, 2);
  const { refused, refusedCase, cancellation, cancellationCase } = await withTransaction(
    suite.db,
    async (tx) => {
      const refused = await appendToChain(
        tx,
        node.nodeId,
        altaFor(node, saleId, 2, 40, "preproduction"),
      );
      await tx
        .insert(envios)
        .values({ registroId: refused.id, estado: "rechazado", codigoError: "1161" });
      const refusedCase = await openFilingCase(tx, {
        registroId: refused.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: NOW,
      });
      const cancellation = await appendToChain(
        tx,
        node.nodeId,
        anulacionFor(node, saleId, 2, 41, "preproduction"),
      );
      await tx
        .insert(envios)
        .values({ registroId: cancellation.id, estado: "retenido", intentos: 1, incidencia: true });
      const cancellationCase = await openFilingCase(tx, {
        registroId: cancellation.id,
        cause: "fiscal.anulacion_retenida",
        evidence: { codigo: null, mensaje: null, csv: null },
        now: NOW,
      });
      return { refused, refusedCase, cancellation, cancellationCase };
    },
  );
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  runtimeNode = successor.nodeId;
  const correction = await send(
    {
      kind: "record-correction",
      registroId: refused.id,
      caseId: refusedCase.id,
      actionKey: "correct-inherited-original",
      reason: "Correct rejected stored facts",
      facts: { description: "Corrected restaurant service" },
    },
    ["record-correction"],
  );
  expect(correction.status).toBe(200);
  const corrected = ((await correction.json()) as { registroId: string }).registroId;
  const [correctedRecord] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, corrected));
  expect(correctedRecord).toMatchObject({ nodeId: successor.nodeId, sifId: successor.sifId });
  await suite.db
    .update(envios)
    .set({ estado: "aceptado", confirmadoEn: NOW, csv: "SYNTHETIC-CORRECTION-CSV" })
    .where(eq(envios.registroId, corrected));

  const response = await send({
    ...body,
    caseId: cancellationCase.id,
    registroId: cancellation.id,
    acceptedRegistroId: corrected,
    actionKey: "release-inherited-1",
  });

  expect(response.status).toBe(200);
  expect(await deliveryOf(cancellation.id)).toMatchObject({
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
});

it("a refused record of the box this one took over from can be remedied here", async () => {
  await acceptCurrent();
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  runtimeNode = successor.nodeId;
  const before = await snapshot();

  const response = await send();

  expect(response.status).toBe(200);
  expect((await snapshot()).records).toEqual(before.records);
  expect(await deliveryOf(body.registroId as string)).toMatchObject({
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
});

it("a record of an unrelated box is still refused", async () => {
  await acceptCurrent();
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
