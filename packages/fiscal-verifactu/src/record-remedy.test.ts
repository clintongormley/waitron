import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain, readChainHead } from "./chain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { applyRecordCorrection, type RecordCorrectionRequest } from "./record-remedy.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { envios } from "./schema/envios.js";
import { filingCaseEvents } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { cadenas } from "./schema/cadenas.js";
import { altaFor, anulacionFor, seedNode, seedSale, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-20T19:20:35+02:00");
let node: SeededNode;
let token: string;
let personId: string;
let request: RecordCorrectionRequest;

beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  node = await seedNode(suite.db);
  const saleId = await seedSale(suite.db, node, 1);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Administrator", role: "admin", pinHash: hashPin("2468") })
      .returning();
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
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
    const pending = altaFor(node, saleId, 1, 5, "preproduction");
    request = {
      caseId: filingCase.id,
      registroId: original.id,
      actionKey: "correction-1",
      reason: "Correct the internal record description",
      pending: {
        ...pending,
        correctsRegistroId: original.id,
        input: {
          ...pending.input,
          Subsanacion: "S",
          RechazoPrevio: "X",
          DescripcionOperacion: "Corrected restaurant service",
        },
      },
    };
  });
});

function apply(enabled = true, value = request) {
  return withTransaction(suite.db, (tx) =>
    applyRecordCorrection(tx, {
      managementSessionId: token,
      nodeId: node.nodeId,
      environment: "preproduction",
      enabledRemedies: new Set(enabled ? ["record-correction"] : []),
      request: value,
      now: NOW,
    }),
  );
}

async function snapshot() {
  return {
    records: await suite.db.select().from(registrosFacturacion),
    deliveries: await suite.db.select().from(envios),
    cases: await withTransaction(suite.db, listFilingCases),
    head: await withTransaction(suite.db, (tx) => readChainHead(tx, node.nodeId)),
  };
}

it("appends a correction and resolution together, preserving original delivery facts and invoice bytes", async () => {
  const before = await snapshot();
  const result = await apply();
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.records[0]).toEqual(before.records[0]);
  expect(after.records[1]).toMatchObject({
    id: result.registroId,
    correctsRegistroId: request.registroId,
    numSerieFactura: "A/1",
    descripcionOperacion: "Corrected restaurant service",
    anteriorHuella: before.records[0]!.huella,
  });
  expect(after.deliveries.find((row) => row.registroId === request.registroId)).toEqual(
    before.deliveries[0],
  );
  expect(after.deliveries.find((row) => row.registroId === result.registroId)).toMatchObject({
    estado: "pendiente",
    intentos: 0,
  });
  expect(after.cases).toHaveLength(1);
  expect(after.cases[0]).toMatchObject({
    status: "resolved",
    events: [
      { id: result.eventId, kind: "resolved", personId, remedyRegistroId: result.registroId },
    ],
  });
  expect(after.head.ultimoRegistroId).toBe(result.registroId);
});

it("returns the committed result on a retry without appending or resolving twice, independent of object key order", async () => {
  const result = await apply();
  const before = await snapshot();
  const reordered = {
    ...request,
    pending: {
      ...request.pending,
      input: Object.fromEntries(
        Object.entries(request.pending.input).reverse(),
      ) as typeof request.pending.input,
    },
  };
  expect(await apply(true, reordered)).toEqual(result);
  expect(await snapshot()).toEqual(before);
});

it("refuses changed content under a committed action key without appending another correction", async () => {
  await apply();
  const before = await snapshot();
  await expect(apply(true, { ...request, reason: "A different decision" })).rejects.toMatchObject({
    code: "filing_case.action_mismatch",
  });
  expect(await snapshot()).toEqual(before);
});

it.each(["staff", "supervisor", "manager"] as const)(
  "refuses a %s even when the remedy is enabled",
  async (role) => {
    await suite.db.update(persons).set({ role }).where(eq(persons.id, personId));
    const before = await snapshot();
    await expect(apply()).rejects.toMatchObject({ code: "authorization.not_permitted" });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a disabled remedy for an administrator without changing the case or chain", async () => {
  const before = await snapshot();
  await expect(apply(false)).rejects.toMatchObject({ code: "fiscal.remedy_disabled" });
  expect(await snapshot()).toEqual(before);
});

it.each(["pendiente", "enviando", "detenido"])(
  "refuses an unknown original outcome (%s)",
  async (estado) => {
    await suite.db.update(envios).set({ estado }).where(eq(envios.registroId, request.registroId));
    const before = await snapshot();
    await expect(apply()).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a case belonging to a different existing record", async () => {
  const otherSale = await seedSale(suite.db, node, 2);
  const otherCase = await withTransaction(suite.db, async (tx) => {
    const other = await appendToChain(
      tx,
      node.nodeId,
      altaFor(node, otherSale, 2, 2, "preproduction"),
    );
    return openFilingCase(tx, {
      registroId: other.id,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    });
  });
  const before = await snapshot();
  await expect(apply(true, { ...request, caseId: otherCase.id })).rejects.toMatchObject({
    code: "fiscal.remedy_invalid",
  });
  expect(await snapshot()).toEqual(before);
});

it("rolls back the appended correction when the case already has a resolution", async () => {
  await suite.db.insert(filingCaseEvents).values({
    caseId: request.caseId,
    actionKey: "earlier-resolution",
    kind: "resolved",
    personId,
    action: "Earlier decision",
    recordedAt: NOW,
  });
  const before = await snapshot();
  await expect(apply()).rejects.toMatchObject({ code: "filing_case.already_resolved" });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])("refuses a different trusted node on %s replay", async (replay) => {
  if (replay) await apply();
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) =>
      applyRecordCorrection(tx, {
        managementSessionId: token,
        nodeId: "other-node" as typeof node.nodeId,
        environment: "preproduction",
        enabledRemedies: new Set(["record-correction"]),
        request,
        now: NOW,
      }),
    ),
  ).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
  expect(await snapshot()).toEqual(before);
});

it.each([false, true])(
  "refuses a different deployment environment on %s replay",
  async (replay) => {
    if (replay) await apply();
    const before = await snapshot();
    await expect(
      withTransaction(suite.db, (tx) =>
        applyRecordCorrection(tx, {
          managementSessionId: token,
          nodeId: node.nodeId,
          environment: "production",
          enabledRemedies: new Set(["record-correction"]),
          request,
          now: NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
    expect(await snapshot()).toEqual(before);
  },
);

it("reports a malformed synthetic predecessor while preserving it and appending the correction", async () => {
  const [original] = await suite.db.select().from(registrosFacturacion);
  const saleId = await seedSale(suite.db, node, 2);
  await withTransaction(suite.db, async (tx) => {
    const [inserted] = await tx
      .insert(registrosFacturacion)
      .values({
        ...original!,
        id: crypto.randomUUID(),
        saleId,
        secuencia: 2,
        numSerieFactura: "A/2",
        primerRegistro: false,
        anteriorIdEmisorFactura: original!.idEmisorFactura,
        anteriorNumSerieFactura: "A/1",
        anteriorFechaExpedicionFactura: original!.fechaExpedicionFactura,
        anteriorHuella: original!.huella,
        huella: "F".repeat(64),
      })
      .returning();
    await tx
      .update(cadenas)
      .set({ secuencia: 2, ultimoRegistroId: inserted!.id, ultimaHuella: inserted!.huella })
      .where(eq(cadenas.nodeId, node.nodeId));
  });
  const before = await snapshot();
  const result = await apply();
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({ id: result.registroId, anteriorHuella: "F".repeat(64) });
  const reports = await suite.db.select().from(incidents);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    code: "chain.verification_failed",
    severity: "error",
    saleId: request.pending.saleId,
    params: {
      issues: [{ issueCode: "predecessor-hash-mismatch", recordId: before.records[1]!.id }],
    },
  });
});

it("corrects an accepted-with-errors delivery without changing its original acknowledgement facts", async () => {
  await suite.db
    .update(envios)
    .set({
      estado: "aceptado_con_errores",
      codigoError: "2000",
      csv: "ORIGINAL-CSV",
      confirmadoEn: NOW,
    })
    .where(eq(envios.registroId, request.registroId));
  const before = await snapshot();
  await apply();
  expect((await snapshot()).deliveries[0]).toEqual(before.deliveries[0]);
});

it("returns one saved result to concurrent retries of the same administrator action", async () => {
  const [first, second] = await Promise.all([apply(), apply()]);
  expect(second).toEqual(first);
  const after = await snapshot();
  expect(after.records).toHaveLength(2);
  expect(after.cases[0]!.events).toHaveLength(1);
});

it("refuses a prepared payload for a different environment", async () => {
  const before = await snapshot();
  await expect(
    apply(true, { ...request, pending: { ...request.pending, entorno: "production" } }),
  ).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
  expect(await snapshot()).toEqual(before);
});

it("refuses an original from another deployment even when the prepared payload matches the caller", async () => {
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) =>
      applyRecordCorrection(tx, {
        managementSessionId: token,
        nodeId: node.nodeId,
        environment: "production",
        enabledRemedies: new Set(["record-correction"]),
        request: { ...request, pending: { ...request.pending, entorno: "production" } },
        now: NOW,
      }),
    ),
  ).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
  expect(await snapshot()).toEqual(before);
});

it("requires live administrator authority and enabled policy even when replaying a committed result", async () => {
  await apply();
  const before = await snapshot();
  await expect(apply(false)).rejects.toMatchObject({ code: "fiscal.remedy_disabled" });
  await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
  await expect(apply()).rejects.toMatchObject({ code: "authorization.not_permitted" });
  expect(await snapshot()).toEqual(before);
});

it.each(["actionKey", "reason"] as const)(
  "refuses an empty %s without appending",
  async (field) => {
    const before = await snapshot();
    await expect(apply(true, { ...request, [field]: "  " })).rejects.toMatchObject({
      code: "fiscal.remedy_request_invalid",
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("resolves successive version cases without rewriting the earlier case, events or records", async () => {
  const first = await apply();
  await suite.db
    .update(envios)
    .set({ estado: "rechazado", codigoError: "1161" })
    .where(eq(envios.registroId, first.registroId));
  const before = await snapshot();
  const nextCase = await withTransaction(suite.db, (tx) =>
    openFilingCase(tx, {
      registroId: first.registroId,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1161, mensaje: null, csv: null },
      now: NOW,
    }),
  );
  const next = {
    ...request,
    caseId: nextCase.id,
    registroId: first.registroId,
    actionKey: "correction-2",
    pending: {
      ...request.pending,
      correctsRegistroId: first.registroId,
      input: {
        ...request.pending.input,
        DescripcionOperacion: "Second corrected restaurant service",
        generadoEn: new Date(NOW.getTime() + 1000),
      },
    },
  };
  const second = await apply(true, next);
  const after = await snapshot();
  expect(after.records.slice(0, 2)).toEqual(before.records);
  expect(after.records[2]).toMatchObject({
    id: second.registroId,
    correctsRegistroId: first.registroId,
    numSerieFactura: "A/1",
    descripcionOperacion: "Second corrected restaurant service",
  });
  expect(after.cases[0]).toEqual(before.cases[0]);
  expect(after.cases[1]).toMatchObject({
    status: "resolved",
    events: [{ id: second.eventId, remedyRegistroId: second.registroId }],
  });
});

it("refuses a replacement pointer to a later version even when node, sale and invoice identity all match", async () => {
  const later = await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, request.pending),
  );
  const before = await snapshot();
  await expect(
    apply(true, {
      ...request,
      pending: { ...request.pending, correctsRegistroId: later.id },
    }),
  ).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
  expect(await snapshot()).toEqual(before);
});

it("refuses a synthetic held absent-original cancellation rather than treating it as an ordinary held cancellation", async () => {
  await withTransaction(suite.db, async (tx) => {
    const pending = anulacionFor(node, request.pending.saleId, 1, 2, "preproduction");
    const appended = await appendToChain(tx, node.nodeId, {
      ...pending,
      input: { ...pending.input, SinRegistroPrevio: "S" },
    });
    await tx.insert(envios).values({ registroId: appended.id, estado: "retenido" });
  });
  const before = await snapshot();
  await expect(apply()).rejects.toMatchObject({ code: "fiscal.remedy_invalid" });
  expect(await snapshot()).toEqual(before);
});

it("refuses a record of a box outside this box's takeover history before reading the case", async () => {
  const unrelated = await seedNode(suite.db, "C");
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) =>
      applyRecordCorrection(tx, {
        managementSessionId: token,
        nodeId: unrelated.nodeId,
        environment: "preproduction",
        enabledRemedies: new Set(["record-correction"]),
        request: { ...request, caseId: "missing-case" },
        now: NOW,
      }),
    ),
  ).rejects.toMatchObject({
    code: "fiscal.remedy_invalid",
    params: { registroId: request.registroId },
  });
  expect(await snapshot()).toEqual(before);
});
