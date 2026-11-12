import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { StatementSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { AltaInput } from "@waitron/verifactu";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { appendToChain, readChainHead } from "./chain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-20T17:20:35Z");
let instant: Date;
let writable: boolean;
let tradingReady: boolean;
let environment: "production" | "preproduction";
let token: string;
let personId: string;
let node: SeededNode;
let generationNode: SeededNode["nodeId"];
let body: Record<string, unknown>;
const clock: TrustedClock = {
  now: () => ({
    instant,
    offsetMinutes: -300,
    confidence: "anchored",
    confident: true,
    anchorAgeSeconds: 0,
  }),
  anchor: (trusted) => ({
    trustedAtMs: trusted.instant.getTime(),
    offsetMinutes: trusted.offsetMinutes,
    monotonicMs: 0,
    wallClockMs: trusted.instant.getTime(),
    source: trusted.source,
  }),
  currentAnchor: () => null,
};

beforeEach(async () => {
  instant = NOW;
  writable = true;
  tradingReady = true;
  environment = "preproduction";
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  generationNode = node.nodeId;
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
      kind: "record-correction",
      caseId: filingCase.id,
      registroId: original.id,
      actionKey: "http-correction",
      reason: "Correct recorded description",
      facts: { description: "Corrected restaurant service" },
    };
  });
});

function send(
  value: unknown = body,
  enabled = true,
  runtime = true,
  returnSource?: () => Promise<SeededNode["nodeId"] | null>,
) {
  const app = new Hono();
  mountRecordRemedies(
    app,
    {
      db: suite.db,
      recordGeneration: runtime
        ? {
            nodeId: generationNode,
            environment,
            clock,
            returnSource,
            requireWritable: () => {
              if (!writable) throw new AppError("node.read_only", {});
              if (!tradingReady)
                throw new AppError("venue.time_zone_not_ready", { reason: "restart_required" });
            },
          }
        : undefined,
    },
    () => {},
    new Set(enabled ? ["record-correction"] : []),
  );
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function snapshot() {
  return {
    records: await suite.db.select().from(registrosFacturacion),
    deliveries: await suite.db.select().from(envios),
    cases: await withTransaction(suite.db, listFilingCases),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}

it("keeps correction disabled for an original outside the pinned former main", async () => {
  generationNode = (await seedNode(suite.db)).nodeId;
  const formerMain = (await seedNode(suite.db)).nodeId;
  const before = await snapshot();
  const response = await send(body, false, true, async () => formerMain);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "fiscal.remedy_disabled", params: { kind: "record-correction" } },
  });
  expect(await snapshot()).toEqual(before);
});

async function acceptedDescriptionDecision() {
  const saleId = await seedSale(suite.db, node, 2);
  return withTransaction(suite.db, async (tx) => {
    const original = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, 2, 2, "preproduction"),
    );
    await tx.insert(envios).values({
      registroId: original.id,
      estado: "aceptado_con_errores",
      codigoError: "2000",
      csv: "ACCEPTED-ORIGINAL-CSV",
      confirmadoEn: NOW,
    });
    const filingCase = await openFilingCase(tx, {
      registroId: original.id,
      cause: "fiscal.aceptado_con_errores",
      evidence: {
        codigo: 2000,
        mensaje: "Synthetic description error",
        csv: "ACCEPTED-ORIGINAL-CSV",
      },
      now: NOW,
    });
    return {
      ...body,
      caseId: filingCase.id,
      registroId: original.id,
      actionKey: "accepted-description-correction",
      priorOutcome: "accepted-with-errors",
    };
  });
}

it("requires the shared confirmation before an enabled remedy changes records", async () => {
  await suite.db
    .update(managementSessions)
    .set({ provedAt: null })
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "management_session.proof_required", params: {} },
  });
  expect(await snapshot()).toEqual(before);
});

it("appends an explicitly selected accepted-with-errors description correction with S/N markers", async () => {
  const decision = await acceptedDescriptionDecision();
  const before = await snapshot();
  const res = await send(decision);
  expect(res.status).toBe(200);
  const result = (await res.json()) as { registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(3);
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    id: result.registroId,
    correctsRegistroId: decision.registroId,
    numSerieFactura: "A/2",
    fechaExpedicionFactura: "2026-07-20",
    descripcionOperacion: "Corrected restaurant service",
    subsanacion: "S",
    rechazoPrevio: "N",
    anteriorHuella: before.records[1]!.huella,
  });
  expect(after.deliveries.slice(0, 2)).toEqual(before.deliveries);
  expect(after.deliveries[2]).toMatchObject({ registroId: result.registroId, estado: "pendiente" });
  expect(after.cases.find((item) => item.id === body.caseId)).toEqual(
    before.cases.find((item) => item.id === body.caseId),
  );
  expect(after.cases.find((item) => item.id === decision.caseId)).toMatchObject({
    status: "resolved",
    events: [{ id: result.eventId, remedyRegistroId: result.registroId, personId }],
  });
});

it("replays an accepted-with-errors decision after a late outcome and clock change", async () => {
  const decision = await acceptedDescriptionDecision();
  const first = await send(decision);
  expect(first.status).toBe(200);
  const result = await first.json();
  instant = new Date(NOW.getTime() + 120_000);
  await suite.db
    .update(envios)
    .set({ estado: "aceptado" })
    .where(eq(envios.registroId, decision.registroId as string));
  const before = await snapshot();
  const replay = await send(decision);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("refuses a changed prior-outcome decision under the saved HTTP action key", async () => {
  const decision = await acceptedDescriptionDecision();
  expect((await send(decision)).status).toBe(200);
  const before = await snapshot();
  const res = await send({ ...decision, priorOutcome: "rejected" });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
  expect(await snapshot()).toEqual(before);
});

it("retains the explicit rejected decision's S/X markers", async () => {
  const before = await snapshot();
  const res = await send({ ...body, priorOutcome: "rejected" });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({ subsanacion: "S", rechazoPrevio: "X" });
});

it("treats omitted and explicit rejected decisions as the same retry", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  const before = await snapshot();
  const replay = await send({ ...body, priorOutcome: "rejected" });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it.each(
  [null, [], ["rejected"], {}, "accepted", "X", 1, true, false].map((priorOutcome) => ({
    priorOutcome,
  })),
)("refuses malformed prior-outcome selection %j", async ({ priorOutcome }) => {
  const before = await snapshot();
  const res = await send({ ...body, priorOutcome });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["rechazado", "pendiente", "enviando", "detenido", "aceptado", "retenido"])(
  "refuses outcome %s for an accepted-with-errors decision",
  async (estado) => {
    const decision = await acceptedDescriptionDecision();
    await suite.db
      .update(envios)
      .set({ estado })
      .where(eq(envios.registroId, decision.registroId as string));
    const before = await snapshot();
    const res = await send(decision);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a claimed accepted-with-errors decision on a rejected case even when delivery now matches", async () => {
  await suite.db
    .update(envios)
    .set({ estado: "aceptado_con_errores" })
    .where(eq(envios.registroId, body.registroId as string));
  const before = await snapshot();
  const res = await send({ ...body, priorOutcome: "accepted-with-errors" });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a rejected decision on an accepted-with-errors case even when delivery now matches", async () => {
  const decision = await acceptedDescriptionDecision();
  await suite.db
    .update(envios)
    .set({ estado: "rechazado" })
    .where(eq(envios.registroId, decision.registroId as string));
  const before = await snapshot();
  const res = await send({ ...decision, priorOutcome: "rejected" });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("retains S/N and the same invoice identity across two accepted-with-errors corrections", async () => {
  const decision = await acceptedDescriptionDecision();
  const first = await send(decision);
  expect(first.status).toBe(200);
  const saved = (await first.json()) as { registroId: string };
  const nextCase = await withTransaction(suite.db, async (tx) => {
    await tx
      .update(envios)
      .set({ estado: "aceptado_con_errores", codigoError: "2000", csv: "FIRST-CORRECTION-CSV" })
      .where(eq(envios.registroId, saved.registroId));
    return openFilingCase(tx, {
      registroId: saved.registroId,
      cause: "fiscal.aceptado_con_errores",
      evidence: { codigo: 2000, mensaje: "Another synthetic error", csv: "FIRST-CORRECTION-CSV" },
      now: NOW,
    });
  });
  const before = await snapshot();
  const res = await send({
    ...decision,
    caseId: nextCase.id,
    registroId: saved.registroId,
    actionKey: "second-accepted-correction",
    facts: { description: "Second corrected service" },
  });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records).toHaveLength(4);
  expect(after.records.slice(0, 3)).toEqual(before.records);
  expect(after.records[3]).toMatchObject({
    correctsRegistroId: saved.registroId,
    numSerieFactura: "A/2",
    fechaExpedicionFactura: "2026-07-20",
    subsanacion: "S",
    rechazoPrevio: "N",
    anteriorHuella: before.records[2]!.huella,
    descripcionOperacion: "Second corrected service",
  });
  expect(after.deliveries.slice(0, 3)).toEqual(before.deliveries);
  expect(after.cases.find((item) => item.id === decision.caseId)).toEqual(
    before.cases.find((item) => item.id === decision.caseId),
  );
});

it.each([false, true])(
  "keeps an accepted-with-errors remedy disabled at the server on replay %s",
  async (replay) => {
    const decision = await acceptedDescriptionDecision();
    if (replay) expect((await send(decision)).status).toBe(200);
    const before = await snapshot();
    const res = await send(decision, false);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("appends a description correction through HTTP with the server's clock, installation and original identity", async () => {
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const result = (await res.json()) as { registroId: string; eventId: string };
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({
    id: result.registroId,
    correctsRegistroId: body.registroId,
    idEmisorFactura: before.records[0]!.idEmisorFactura,
    numSerieFactura: "A/1",
    fechaExpedicionFactura: "2026-07-20",
    saleId: before.records[0]!.saleId,
    nodeId: node.nodeId,
    entorno: "preproduction",
    descripcionOperacion: "Corrected restaurant service",
    importeTotal: "123.45",
    cuotaTotal: "21.43",
    fechaHoraHusoGenRegistro: NOW,
    offsetMinutos: 120,
    subsanacion: "S",
    rechazoPrevio: "X",
    sistemaInformatico: {
      NombreSistemaInformatico: "Waitron",
      Version: "0.0.0-dev",
      NumeroInstalacion: "1",
      TipoUsoPosibleMultiOT: "N",
    },
  });
  expect(after.deliveries[0]).toEqual(before.deliveries[0]);
  expect(after.deliveries[1]).toMatchObject({
    registroId: result.registroId,
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
  expect(after.cases[0]).toMatchObject({
    status: "resolved",
    events: [{ id: result.eventId, personId, remedyRegistroId: result.registroId }],
  });
});

it("replays an HTTP decision after the clock advances without a second record or case event", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  const before = await snapshot();
  instant = new Date(NOW.getTime() + 120_000);
  const second = await send();
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("refuses a changed description under the saved HTTP action key", async () => {
  expect((await send()).status).toBe(200);
  const before = await snapshot();
  const res = await send({ ...body, facts: { description: "Another decision" } });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "filing_case.action_mismatch" } });
  expect(await snapshot()).toEqual(before);
});

it("reports a competing replacement as a conflict and preserves the committed result", async () => {
  expect((await send()).status).toBe(200);
  const before = await snapshot();
  const res = await send({ ...body, actionKey: "competing-action" });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.record_already_corrected" } });
  expect(await snapshot()).toEqual(before);
});

it("reports an already-resolved case as a conflict and rolls back the proposed correction", async () => {
  await suite.db.insert(filingCaseEvents).values({
    caseId: body.caseId as string,
    actionKey: "earlier-resolution",
    kind: "resolved",
    personId,
    action: "Earlier decision",
    recordedAt: NOW,
  });
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "filing_case.already_resolved" } });
  expect(await snapshot()).toEqual(before);
});

it.each([
  "nodeId",
  "environment",
  "operatorId",
  "enabledRemedies",
  "pending",
  "SistemaInformatico",
  "generadoEn",
  "offsetMinutes",
])("refuses client-owned generation or policy field %s", async (field) => {
  const before = await snapshot();
  const res = await send({ ...body, [field]: "client override" });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(
  [
    { description: "" },
    { description: 42 },
    { description: "Text", CuotaTotal: "0.00" },
    null,
    [],
  ].map((facts) => ({ facts })),
)("refuses malformed or unsupported corrected facts: %j", async ({ facts }) => {
  const before = await snapshot();
  const res = await send({ ...body, facts });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses issuance without trusted runtime facts", async () => {
  const before = await snapshot();
  const res = await send(body, true, false);
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "requires server enablement with a complete runtime on replay: %s",
  async (replay) => {
    if (replay) expect((await send()).status).toBe(200);
    const before = await snapshot();
    const res = await send(body, false);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "fiscal.remedy_disabled", params: { kind: "record-correction" } },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([false, true])("rechecks writable admission on an HTTP replay: %s", async (replay) => {
  if (replay) expect((await send()).status).toBe(200);
  writable = false;
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "node.read_only" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a remedy on a box the held chart does not name primary without appending", async () => {
  await writeNodeMembership(suite.db, {
    body: {
      term: 2,
      nodes: [
        { nodeId: node.nodeId, contactUrl: "https://this-box", standing: "sell-only" },
        { nodeId: "new-box", contactUrl: "https://new-box", standing: "serving-primary" },
      ],
    },
    signerNodeId: "new-box",
    signature: "sig-2",
    endorsements: [],
  });
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.chain_handed_over" } });
  expect(await snapshot()).toEqual(before);
});

it("refuses a server clock behind the chain without appending", async () => {
  instant = new Date(NOW.getTime() - 120_000);
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: { code: "clock.behind_chain" } });
  expect(await snapshot()).toEqual(before);
});

it("reports a host trading refusal as a conflict without changing records", async () => {
  tradingReady = false;
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: { code: "venue.time_zone_not_ready", params: { reason: "restart_required" } },
  });
  expect(await snapshot()).toEqual(before);
});

it("keeps the invoice's original date when generation moves to another local day", async () => {
  instant = new Date("2026-07-21T00:30:00Z");
  const res = await send();
  expect(res.status).toBe(200);
  expect((await snapshot()).records[1]).toMatchObject({
    fechaExpedicionFactura: "2026-07-20",
    fechaHoraHusoGenRegistro: instant,
  });
});

it.each(["aceptado_con_errores", "pendiente", "enviando", "detenido", "aceptado"])(
  "refuses outcome %s on the rejected-description adapter",
  async (estado) => {
    await suite.db
      .update(envios)
      .set({ estado })
      .where(eq(envios.registroId, body.registroId as string));
    const before = await snapshot();
    const res = await send();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("rechecks administrator authority on HTTP replay", async () => {
  expect((await send()).status).toBe(200);
  await setBuiltInRoleForTest(suite.db, personId, "manager");
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await snapshot()).toEqual(before);
});

it("returns the saved result even if the original delivery outcome changes after commit", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const result = await first.json();
  await suite.db
    .update(envios)
    .set({ estado: "aceptado", csv: "LATE-ORIGINAL-CSV" })
    .where(eq(envios.registroId, body.registroId as string));
  const before = await snapshot();
  const retry = await send();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("corrects a second rejected version without changing the first two records or their case facts", async () => {
  const first = await send();
  expect(first.status).toBe(200);
  const saved = (await first.json()) as { registroId: string };
  await suite.db
    .update(envios)
    .set({ estado: "rechazado", codigoError: "1161" })
    .where(eq(envios.registroId, saved.registroId));
  const filingCase = await withTransaction(suite.db, (tx) =>
    openFilingCase(tx, {
      registroId: saved.registroId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    }),
  );
  const before = await snapshot();
  const res = await send({
    ...body,
    registroId: saved.registroId,
    caseId: filingCase.id,
    actionKey: "http-second-correction",
    facts: { description: "Second corrected service" },
  });
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records).toHaveLength(3);
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    correctsRegistroId: saved.registroId,
    numSerieFactura: "A/1",
    descripcionOperacion: "Second corrected service",
    anteriorHuella: before.records[1]!.huella,
  });
  expect(after.cases[0]).toEqual(before.cases[0]);
});

it.each(["R1", "F3"] as const)(
  "preserves the supported %s payload while correcting its description",
  async (kind) => {
    const saleId = await seedSale(suite.db, node, 2);
    const invoice = {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: new Date("2026-07-19T22:00:00Z"),
    };
    const recipient = { IDDestinatario: [{ NombreRazon: "Business Customer", NIF: "B12345674" }] };
    const fields: Partial<AltaInput> =
      kind === "R1"
        ? {
            TipoRectificativa: "S",
            FacturasRectificadas: [invoice],
            ImporteRectificacion: { BaseRectificada: "102.02", CuotaRectificada: "21.43" },
          }
        : { FacturasSustituidas: [invoice] };
    const filingCase = await withTransaction(suite.db, async (tx) => {
      const pending = altaFor(node, saleId, 2, 2, "preproduction");
      const original = await appendToChain(tx, node.nodeId, {
        ...pending,
        input: { ...pending.input, ...fields, TipoFactura: kind, Destinatarios: recipient },
      });
      await tx
        .insert(envios)
        .values({ registroId: original.id, estado: "rechazado", codigoError: "1161" });
      return openFilingCase(tx, {
        registroId: original.id,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1161, mensaje: null, csv: null },
        now: NOW,
      });
    });
    const before = await snapshot();
    instant = new Date("2026-12-20T17:20:35Z");
    const res = await send({ ...body, caseId: filingCase.id, registroId: filingCase.registroId });
    expect(res.status).toBe(200);
    const after = await snapshot();
    expect(after.records.slice(0, 2)).toEqual(before.records);
    const original = before.records[1]!;
    expect(after.records[2]).toMatchObject({
      tipoFactura: kind,
      destinatarios: recipient,
      fechaExpedicionFactura: "2026-07-20",
      offsetMinutos: 60,
      tipoRectificativa: kind === "R1" ? "S" : null,
      facturasRectificadas: original.facturasRectificadas,
      facturasSustituidas: original.facturasSustituidas,
      importeRectificacion: original.importeRectificacion,
      desglose: original.desglose,
      cuotaTotal: "21.43",
      importeTotal: "123.45",
      descripcionOperacion: "Corrected restaurant service",
    });
  },
);

it("a refused record of the box this one took over from can be remedied here", async () => {
  const successor = await seedNode(suite.db);
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  generationNode = successor.nodeId;
  const before = await snapshot();

  const res = await send();

  expect(res.status).toBe(200);
  const { registroId } = (await res.json()) as { registroId: string };
  const [appended] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, registroId));
  expect(appended).toMatchObject({
    nodeId: successor.nodeId,
    sifId: successor.sifId,
    correctsRegistroId: body.registroId,
    descripcionOperacion: "Corrected restaurant service",
  });
  expect(await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId))).toEqual(
    before.head,
  );
});

it("walks the takeover history once to remedy a record of the box this one took over from", async () => {
  const successor = await seedNode(suite.db);
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  generationNode = successor.nodeId;
  let reads = 0;
  const all = StatementSync.prototype.all;
  const spy = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (
    this: StatementSync,
    ...args
  ) {
    if (/\bfrom\s+"handover_activations"/i.test(this.sourceSQL)) reads++;
    return Reflect.apply(all, this, args) as never;
  });
  try {
    expect((await send()).status).toBe(200);
  } finally {
    spy.mockRestore();
  }

  // One walk reads the activations once for each of the two boxes it lists.
  expect(reads).toBe(2);
});

it("a record of an unrelated box is still refused", async () => {
  const successor = await seedNode(suite.db);
  const unrelated = await seedNode(suite.db);
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  generationNode = unrelated.nodeId;
  const before = await snapshot();

  const res = await send();

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("names the producer from the settings in the correction's software block, keeping the taxpayer as issuer", async () => {
  vi.stubEnv("WAITRON_PRODUCER_NAME", "PRODUCER PERSON");
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", "00000000T");
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", "1 Example Street, 00000 Nowhere (Province), Spain");
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(200);
  const after = await snapshot();
  expect(after.records[1]!.sistemaInformatico).toMatchObject({
    NombreRazon: "PRODUCER PERSON",
    NIF: "00000000T",
  });
  expect(after.records[1]!.nombreRazonEmisor).toBe(before.records[0]!.nombreRazonEmisor);
  expect(after.records[1]!.idEmisorFactura).toBe(before.records[0]!.idEmisorFactura);
});

it("refuses a production correction while no producer is set, writing nothing", async () => {
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
    return { ...body, caseId: filingCase.id, registroId: original.id, actionKey: "http-prod" };
  });
  environment = "production";
  const before = await snapshot();
  const res = await send(decision);
  expect(await res.json()).toMatchObject({ error: { code: "sif.producer_unset" } });
  expect(await snapshot()).toEqual(before);
});
