import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { sales, saleSettlements, tenders, tenderRefunds, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError, nodeId, saleId } from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { steadyClock, staticResolver } from "../test/write-path-fixtures.js";
import { pendingAcks, writeAck } from "./acks.js";
import { appendToChain, readChainHead } from "./chain.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { heldRecords, listFilingCases, openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import type { RemedyKind } from "./record-remedy.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const T0 = new Date("2026-07-20T17:21:00Z");
const HELD_AT = new Date("2026-07-20T17:22:00Z");
const NOW = new Date("2026-07-20T17:23:00Z");
const KIND = "release-brake" satisfies RemedyKind;
let node: SeededNode;
let token: string;
let personId: string;
let writable: boolean;
let environment: "production" | "preproduction";
let runtimeNode: SeededNode["nodeId"];
let body: Record<string, unknown>;
let ids: string[];
let aeat: ReturnType<typeof createFakeAeat>;

function drainAt(now: Date) {
  return drain(
    {
      db: suite.db,
      environment: "preproduction",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: staticResolver(aeat.client()),
    },
    now,
  );
}

async function append(number: number) {
  const saleId = await seedSale(suite.db, node, number);
  return withTransaction(suite.db, async (tx) => {
    const record = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, saleId, number, number, "preproduction"),
    );
    await tx.insert(envios).values({ registroId: record.id, proximoIntentoEn: T0 });
    return record.id;
  });
}

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  writable = true;
  environment = "preproduction";
  runtimeNode = node.nodeId;
  aeat = createFakeAeat({ serverNow: T0, tiempoEsperaInicial: 5 });
  personId = await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: "Administrator", role: "admin" });
    token = (await startManagementSession(tx, { personId: person!.id })).token;
    await setFreshManagementSignIn(tx, token);
    return person!.id;
  });
  ids = [];
  for (let i = 1; i <= 3; i++) {
    ids.push(await append(i));
    aeat.reject(`89890001K|A/${i}|20-07-2026`, 1100, "Synthetic refusal");
  }
  expect((await drainAt(T0)).recordsHalted).toBe(3);
  ids.push(await append(4), await append(5));
  expect((await drainAt(HELD_AT)).recordsHalted).toBe(2);
  const cases = await withTransaction(suite.db, listFilingCases);
  body = {
    kind: KIND,
    registroId: ids[3],
    caseId: cases[2]!.id,
    actionKey: "manual-brake-1",
    reason: "Retry the first held record after explicit review",
  };
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

async function snapshot() {
  return {
    records: await suite.db
      .select()
      .from(registrosFacturacion)
      .orderBy(registrosFacturacion.secuencia),
    deliveries: await suite.db.select().from(envios).orderBy(envios.registroId),
    cases: await withTransaction(suite.db, listFilingCases),
    held: await withTransaction(suite.db, heldRecords),
    acks: await pendingAcks(suite.db),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
    sales: await suite.db.select().from(sales),
    tenders: await suite.db.select().from(tenders),
    refunds: await suite.db.select().from(tenderRefunds),
    settlements: await suite.db.select().from(saleSettlements),
  };
}

it("makes only the first brake-held record due now and audits a note without resolving the refusal", async () => {
  const before = await snapshot();
  expect(before.held).toEqual([
    { registroId: ids[3], caseId: body.caseId },
    { registroId: ids[4], caseId: body.caseId },
  ]);
  const response = await send();
  expect(response.status).toBe(200);
  const result = (await response.json()) as { registroId: string; eventId: string };
  expect(result.registroId).toBe(ids[3]);
  const after = await snapshot();
  expect(after.records).toEqual(before.records);
  expect(after.head).toEqual(before.head);
  expect(after.sales).toEqual(before.sales);
  expect(after.tenders).toEqual(before.tenders);
  expect(after.refunds).toEqual(before.refunds);
  expect(after.settlements).toEqual(before.settlements);
  expect(after.deliveries.filter((r) => r.registroId !== ids[3])).toEqual(
    before.deliveries.filter((r) => r.registroId !== ids[3]),
  );
  expect(after.deliveries.find((r) => r.registroId === ids[3])).toEqual({
    ...before.deliveries.find((r) => r.registroId === ids[3]),
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
  expect(after.acks).toEqual(before.acks.filter((a) => a.recordId !== ids[3]));
  expect(after.cases.slice(0, 2)).toEqual(before.cases.slice(0, 2));
  expect(after.cases[2]).toEqual({
    ...before.cases[2],
    status: "open",
    events: [
      {
        id: result.eventId,
        caseId: body.caseId,
        actionKey: body.actionKey,
        kind: "note",
        personId,
        action: expect.any(String),
        remedyRegistroId: null,
        recordedAt: NOW,
      },
    ],
  });
  expect(JSON.parse(after.cases[2]!.events[0]!.action)).toEqual(body);
});

it("sends the released record before the hourly probe and releases the successor only after acceptance", async () => {
  expect((await send()).status).toBe(200);
  const first = await drainAt(NOW);
  expect(first.recordsAccepted).toBe(1);
  expect(first.recordsHalted).toBe(0);
  const next = await drainAt(new Date(NOW.getTime() + 60_000));
  expect(next.recordsAccepted).toBe(1);
  const after = await snapshot();
  expect(
    after.deliveries.filter((r) => ids.slice(3).includes(r.registroId)).map((r) => r.estado),
  ).toEqual(["aceptado", "aceptado"]);
  expect(after.cases.map((c) => c.status)).toEqual(["open", "open", "open"]);
});

it("keeps the successor held when the manually released record is refused with the same code", async () => {
  aeat.reject("89890001K|A/4|20-07-2026", 1100, "Synthetic continued refusal");
  expect((await send()).status).toBe(200);
  expect((await drainAt(NOW)).recordsHalted).toBe(1);
  expect((await drainAt(new Date(NOW.getTime() + 60_000))).recordsAccepted).toBe(0);
  expect((await snapshot()).deliveries.find((r) => r.registroId === ids[4])!.estado).toBe(
    "detenido",
  );
});

it.each(["registroId", "caseId", "reason"])("refuses a changed %s on replay", async (key) => {
  expect((await send()).status).toBe(200);
  const before = await snapshot();
  const changed = { ...body, [key]: "different" };
  const response = await send(changed);
  expect(response.status).toBe(key === "registroId" ? 400 : 409);
  expect(await snapshot()).toEqual(before);
});

it("replays reordered simultaneous requests and later submissions without another delivery change", async () => {
  const replies = await Promise.all([
    send(),
    send(Object.fromEntries(Object.entries(body).reverse())),
  ]);
  expect(replies.map((r) => r.status)).toEqual([200, 200]);
  expect(await replies[0]!.json()).toEqual(await replies[1]!.json());
  await drainAt(NOW);
  const before = await snapshot();
  expect((await send()).status).toBe(200);
  expect(await snapshot()).toEqual(before);
});

it.each(["pendiente", "enviando", "aceptado", "aceptado_con_errores", "rechazado", "retenido"])(
  "refuses a %s target without changing it",
  async (estado) => {
    await suite.db.update(envios).set({ estado }).where(eq(envios.registroId, ids[3]!));
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([
  "pending predecessor",
  "sending predecessor",
  "own case",
  "later held record",
  "wrong case",
  "broken run",
  "different code",
  "missing code",
  "missing record",
  "foreign node",
  "foreign environment",
])("refuses %s without releasing or recording an action", async (scenario) => {
  if (scenario === "pending predecessor" || scenario === "sending predecessor")
    await suite.db
      .update(envios)
      .set({ estado: scenario === "pending predecessor" ? "pendiente" : "enviando" })
      .where(eq(envios.registroId, ids[0]!));
  if (scenario === "own case")
    await withTransaction(suite.db, (tx) =>
      openFilingCase(tx, {
        registroId: ids[3]!,
        cause: "fiscal.huella_divergente",
        evidence: { codigo: 3000, mensaje: null, csv: null },
        now: NOW,
      }),
    );
  if (scenario === "later held record") body.registroId = ids[4];
  if (scenario === "wrong case")
    body.caseId = (await withTransaction(suite.db, listFilingCases))[0]!.id;
  if (scenario === "broken run")
    await suite.db.update(envios).set({ estado: "aceptado" }).where(eq(envios.registroId, ids[0]!));
  if (scenario === "different code" || scenario === "missing code")
    await suite.db
      .update(envios)
      .set({ codigoError: scenario === "different code" ? "1161" : null })
      .where(eq(envios.registroId, ids[0]!));
  if (scenario === "missing record") body.registroId = "missing";
  if (scenario === "foreign node") runtimeNode = nodeId("00000000-0000-4000-8000-000000000001");
  if (scenario === "foreign environment") environment = "production";
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["blank reason", "missing case", "extra field", "numeric key"])(
  "refuses %s as malformed input",
  async (scenario) => {
    if (scenario === "blank reason") body.reason = " ";
    if (scenario === "missing case") delete body.caseId;
    if (scenario === "extra field") body.enabledRemedies = [KIND];
    if (scenario === "numeric key") body.actionKey = 1;
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "fiscal.remedy_request_invalid" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it.each([false, true])(
  "requires policy, permission and writable host on replay=%s",
  async (replay) => {
    if (replay) expect((await send()).status).toBe(200);
    const before = await snapshot();
    const disabled = await send(body, []);
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({ error: { code: "fiscal.remedy_disabled" } });
    expect((await send(body, null)).status).toBe(409);
    expect((await send(body, [KIND], false)).status).toBe(409);
    writable = false;
    expect((await send()).status).toBe(409);
    writable = true;
    await setBuiltInRoleForTest(suite.db, personId, "staff");
    const denied = await send();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("does not turn a retry note into a second resolution when the holding case already has a legal decision", async () => {
  await withTransaction(suite.db, (tx) =>
    recordCaseEvent(tx, {
      caseId: body.caseId as string,
      actionKey: "prior-resolution",
      kind: "resolved",
      personId,
      action: "Earlier explicit decision",
      now: HELD_AT,
    }),
  );
  const response = await send();
  expect(response.status).toBe(200);
  const after = await snapshot();
  expect(after.cases[2]!.status).toBe("resolved");
  expect(after.cases[2]!.events.map((e) => e.kind)).toEqual(["resolved", "note"]);
});

async function refuseFourth(
  cause: "fiscal.registro_rechazado" | "fiscal.huella_divergente" = "fiscal.registro_rechazado",
) {
  return withTransaction(suite.db, async (tx) => {
    await tx
      .update(envios)
      .set({ estado: "rechazado", codigoError: "1100" })
      .where(eq(envios.registroId, ids[3]!));
    await writeAck(tx, ids[3]!, NOW);
    return openFilingCase(tx, {
      registroId: ids[3]!,
      cause,
      evidence: { codigo: 1100, mensaje: null, csv: null },
      now: NOW,
    });
  });
}

it.each(["pendiente", "enviando", "detenido"])(
  "keeps the brake behind an older %s record even with three later matching refusals",
  async (estado) => {
    const holdingCase = await refuseFourth();
    await suite.db.update(envios).set({ estado }).where(eq(envios.registroId, ids[0]!));
    body = { ...body, registroId: ids[4], caseId: holdingCase.id };
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses to attach a brake decision to a different kind of case on its predecessor", async () => {
  const holdingCase = await refuseFourth("fiscal.huella_divergente");
  body = { ...body, registroId: ids[4], caseId: holdingCase.id };
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it.each(["refused original", "accepted original", "absent-original marker"])(
  "respects the ordinary cancellation hold for %s",
  async (scenario) => {
    await refuseFourth();
    const [original] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, ids[0]!));
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(envios)
        .set({ estado: "rechazado", codigoError: "1100" })
        .where(eq(envios.registroId, ids[4]!));
      await writeAck(tx, ids[4]!, NOW);
      const holdingCase = await openFilingCase(tx, {
        registroId: ids[4]!,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1100, mensaje: null, csv: null },
        now: NOW,
      });
      if (scenario === "accepted original")
        await tx.update(envios).set({ estado: "aceptado" }).where(eq(envios.registroId, ids[0]!));
      const pending = anulacionFor(node, saleId(original!.saleId), 1, 6, "preproduction");
      if (scenario === "absent-original marker") pending.input.SinRegistroPrevio = "S";
      const record = await appendToChain(tx, node.nodeId, pending);
      await tx.insert(envios).values({
        registroId: record.id,
        estado: "detenido",
        intentos: 1,
        enviadoEn: HELD_AT,
        proximoIntentoEn: NOW,
      });
      await writeAck(tx, record.id, NOW);
      body = { ...body, registroId: record.id, caseId: holdingCase.id };
    });
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(scenario === "refused original" ? 400 : 200);
    if (scenario === "refused original") {
      expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
      expect(await snapshot()).toEqual(before);
    } else {
      expect(
        (await snapshot()).deliveries.find((r) => r.registroId === body.registroId),
      ).toMatchObject({ estado: "pendiente" });
      aeat = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
      if (scenario === "accepted original") {
        const raw = await suite.db.execute<Record<string, unknown>>(
          sql`select * from registros_facturacion where id = ${ids[0]}`,
        );
        const record = fromRegistroRow(decodeRegistroRow(raw.rows[0]!));
        if (!("TipoFactura" in record)) throw new Error("expected original alta");
        const reply = await aeat
          .client()
          .submit({ ObligadoEmision: { NIF: "89890001K", NombreRazon: "Waitron SL" } }, [
            { RegistroAlta: record },
          ]);
        expect(reply.RespuestaLinea[0]!.EstadoRegistro).toBe("Correcto");
      }
      expect((await drainAt(NOW)).recordsAccepted).toBe(1);
    }
  },
);

it("rolls delivery and acknowledgement changes back when the audit event cannot be stored", async () => {
  await suite.db.execute(
    sql`create trigger refuse_brake_event before insert on filing_case_events begin select raise(abort, 'synthetic audit failure'); end`,
  );
  try {
    const before = await snapshot();
    const response = await send();
    expect(response.status).toBe(500);
    expect(await snapshot()).toEqual(before);
  } finally {
    await suite.db.execute(sql`drop trigger refuse_brake_event`);
  }
});

it("refuses a second administrator's reuse of the first administrator's action key", async () => {
  expect((await send()).status).toBe(200);
  token = await withTransaction(suite.db, async (tx) => {
    const [other] = await seedPersons(tx, { displayName: "Second administrator", role: "admin" });
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

it.each(["node", "environment"])("keeps the current host %s check on replay", async (field) => {
  expect((await send()).status).toBe(200);
  if (field === "node") runtimeNode = nodeId("00000000-0000-4000-8000-000000000001");
  else environment = "production";
  const before = await snapshot();
  const response = await send();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
  expect(await snapshot()).toEqual(before);
});

it("a refused record of the box this one took over from can be remedied here", async () => {
  const successor = await seedNode(suite.db, "B");
  await recordTakeover(suite.db, node.nodeId, successor.nodeId);
  runtimeNode = successor.nodeId;
  const before = await snapshot();

  const response = await send();

  expect(response.status).toBe(200);
  const after = await snapshot();
  expect(after.records).toEqual(before.records);
  expect(after.deliveries.find((r) => r.registroId === ids[3])).toEqual({
    ...before.deliveries.find((r) => r.registroId === ids[3]),
    estado: "pendiente",
    proximoIntentoEn: NOW,
  });
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
