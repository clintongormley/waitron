import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendCancellation,
  appendPendingAlta,
  seedPendingEnvios,
  seedSecondChain,
} from "../test/drain-fixtures.js";
import { recordConflictEvidence } from "./conflict-evidence.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import { readFilingOverview } from "./filing-overview.js";
import { envios } from "./schema/envios.js";
import { fiscalLookupConflicts } from "./schema/lookup-conflicts.js";
import { fiscalSeriesConflicts } from "./schema/series-conflicts.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const RECIPIENT_NAME = "Recipient-Never-Shown";
const REF_EXTERNA = "RefExterna-Never-Shown";
const DUPLICATE_REQUEST = "DuplicateRequest-Never-Shown";
const LOOKUP_REFERENCE = "LookupReference-Never-Shown";
const PERSON = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = new Date("2026-07-21T03:00:00.000Z");
const LOOKED_UP_AT = new Date("2026-07-21T04:00:00.000Z");
const SENT_AT = new Date("2026-07-21T02:00:00.000Z");

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

function huellaOf(secuencia: number): string {
  return String(secuencia).padStart(64, "0");
}

async function setEnvio(
  registroId: string,
  values: Partial<typeof envios.$inferInsert>,
): Promise<void> {
  await suite.db.update(envios).set(values).where(eq(envios.registroId, registroId));
}

async function openCase(
  registroId: string,
  cause: Parameters<typeof openFilingCase>[1]["cause"],
  openedAt: string,
) {
  return inTx((tx) =>
    openFilingCase(tx, {
      registroId,
      cause,
      evidence: { codigo: 1161, mensaje: `AEAT on ${cause}`, csv: `CSV-${cause}` },
      now: new Date(openedAt),
    }),
  );
}

/**
 * One chain: accepted, sending, pending, refused (with a case and two records held behind it),
 * a diverged record (case, reply evidence and a lookup), a set-aside cancellation (case), and a
 * record whose case was resolved. A second chain holds one record with no case. Cases open in that
 * order, at times running backwards, so an order by time would reverse them.
 */
async function seedOverview() {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const accepted = seeded.registroIds[0]!;
  const sending = (
    await appendPendingAlta(suite.db, seeded, 2, { generadoEn: "2026-07-20T20:00:00+01:00" })
  ).registroId;
  await appendPendingAlta(suite.db, seeded, 3, { generadoEn: "2026-07-20T20:30:00+01:00" });
  const refused = (
    await appendPendingAlta(suite.db, seeded, 4, {
      destinatarios: { IDDestinatario: [{ NombreRazon: RECIPIENT_NAME, NIF: "B12345674" }] },
    })
  ).registroId;
  const heldFirst = (await appendPendingAlta(suite.db, seeded, 5)).registroId;
  const heldSecond = (await appendPendingAlta(suite.db, seeded, 6)).registroId;
  const diverged = (await appendPendingAlta(suite.db, seeded, 7)).registroId;
  const cancellation = await appendCancellation(suite.db, seeded, accepted, 8);
  const resolved = (await appendPendingAlta(suite.db, seeded, 9)).registroId;
  const heldAlone = (await seedSecondChain(suite.db, seeded, 10)).registroId;

  await setEnvio(accepted, {
    estado: "aceptado",
    confirmadoEn: new Date("2026-07-21T01:00:00.000Z"),
  });
  await setEnvio(sending, { estado: "enviando" });
  await setEnvio(refused, { estado: "rechazado" });
  for (const id of [heldFirst, heldSecond, heldAlone]) await setEnvio(id, { estado: "detenido" });
  await setEnvio(diverged, {
    estado: "detenido",
    codigoError: "3000",
    mensajeError: "Registro duplicado.",
    enviadoEn: SENT_AT,
  });
  await setEnvio(cancellation, { estado: "retenido" });
  await setEnvio(resolved, {
    estado: "aceptado",
    confirmadoEn: new Date("2026-07-21T05:00:00.000Z"),
  });

  await openCase(refused, "fiscal.registro_rechazado", "2026-07-21T09:00:00.000Z");
  const divergedCase = await openCase(
    diverged,
    "fiscal.huella_divergente",
    "2026-07-21T08:00:00.000Z",
  );
  await openCase(cancellation, "fiscal.anulacion_retenida", "2026-07-21T07:00:00.000Z");
  const resolvedCase = await openCase(
    resolved,
    "fiscal.registro_rechazado",
    "2026-07-21T06:00:00.000Z",
  );
  await inTx((tx) =>
    recordCaseEvent(tx, {
      caseId: resolvedCase.id,
      actionKey: "resolve-1",
      kind: "resolved",
      personId: PERSON,
      action: "Resolved for the test",
      now: new Date("2026-07-21T10:00:00.000Z"),
    }),
  );

  const invoice = {
    IDEmisorFactura: seeded.nif,
    NumSerieFactura: "S7/1",
    FechaExpedicionFactura: "20-07-2026",
  };
  await inTx((tx) =>
    recordConflictEvidence(tx, {
      registroId: diverged,
      caseId: divergedCase.id,
      attempt: 1,
      cause: "fiscal.huella_divergente",
      evidence: {
        line: {
          IDFactura: invoice,
          Operacion: { TipoOperacion: "Alta" },
          RefExterna: REF_EXTERNA,
          EstadoRegistro: "Incorrecto",
          CodigoErrorRegistro: 3000,
          DescripcionErrorRegistro: "Registro duplicado.",
          RegistroDuplicado: {
            IdPeticionRegistroDuplicado: DUPLICATE_REQUEST,
            EstadoRegistroDuplicado: "Correcta",
          },
        },
        csv: "CSV-REPLY",
        comparison: {
          kind: "lookup-mismatch",
          storedFingerprint: "A".repeat(64),
          storedSystem: { taxId: "B00000000", softwareId: "XX", installation: "77" },
        },
      },
      now: OBSERVED_AT,
    }),
  );
  await suite.db.insert(fiscalLookupConflicts).values({
    registroId: diverged,
    caseId: divergedCase.id,
    evidence: {
      source: "consulta",
      invoice,
      reference: LOOKUP_REFERENCE,
      state: "Correcto",
      fingerprint: "B".repeat(64),
      system: null,
    },
    recordedAt: LOOKED_UP_AT,
  });

  const [series] = await suite.db
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, seeded.nodeId), eq(invoiceSeries.code, "S1")));
  await suite.db.insert(fiscalSeriesConflicts).values({
    sifId: seeded.sifId,
    seriesId: series!.id,
    invoiceIdentity: "S1/99",
    recordedAt: new Date("2026-07-21T11:00:00.000Z"),
    evidence: {
      source: "consulta",
      invoice: {
        IDEmisorFactura: seeded.nif,
        NumSerieFactura: "S1/99",
        FechaExpedicionFactura: "20-07-2026",
      },
      reference: LOOKUP_REFERENCE,
      state: "Correcto",
      fingerprint: "D".repeat(64),
      system: { taxId: "B99999999", softwareId: "ZZ", installation: "5" },
    },
  });

  const [sif] = await suite.db
    .select({ numeroInstalacion: registroSif.numeroInstalacion })
    .from(registroSif)
    .where(eq(registroSif.id, seeded.sifId));
  return {
    seeded,
    installation: sif!.numeroInstalacion,
    refused,
    diverged,
    cancellation,
    resolved,
  };
}

/** Every object's keys in the answer, by the path that reaches it (`[]` for an array's items). */
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

describe("readFilingOverview", () => {
  it("counts each submission state and gives the oldest waiting record's generation time", async () => {
    const { seeded } = await seedOverview();

    const overview = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }),
    );

    expect(overview.progress).toEqual({
      counts: {
        pendiente: 1,
        enviando: 1,
        aceptado: 2,
        aceptado_con_errores: 0,
        rechazado: 1,
        detenido: 4,
        retenido: 1,
      },
      // The sending record's; every record not waiting was generated earlier.
      oldestWaitingGeneratedAt: "2026-07-20T19:00:00.000Z",
      lastConfirmedAt: "2026-07-21T05:00:00.000Z",
    });
  });

  it("lists the open cases newest first with what was held behind each, and counts held records with no case", async () => {
    const { seeded, installation, refused, diverged, cancellation } = await seedOverview();

    const overview = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }),
    );

    expect(overview.cases.map((each) => each.registroId)).toEqual([
      cancellation,
      diverged,
      refused,
    ]);
    expect(overview.totalCases).toBe(3);
    expect(overview.cases.map((each) => each.heldBehind)).toEqual([0, 0, 2]);
    expect(overview.heldWithoutCase).toBe(1);
    // The values the read builds or converts; which keys appear is the field-list case's.
    expect(overview.cases[1]).toMatchObject({
      openedAt: "2026-07-21T08:00:00.000Z",
      evidence: {
        codigo: 1161,
        mensaje: "AEAT on fiscal.huella_divergente",
        csv: "CSV-fiscal.huella_divergente",
      },
      record: {
        huella: huellaOf(7),
        anteriorHuella: huellaOf(6),
        fechaHoraHusoGenRegistro: "2026-07-20T18:20:30.000Z",
        numeroInstalacion: installation,
      },
      submission: { enviadoEn: SENT_AT.toISOString() },
      conflicts: [
        {
          attempt: 1,
          cause: "fiscal.huella_divergente",
          recordedAt: OBSERVED_AT.toISOString(),
          line: {
            IDFactura: {
              IDEmisorFactura: seeded.nif,
              NumSerieFactura: "S7/1",
              FechaExpedicionFactura: "20-07-2026",
            },
            EstadoRegistro: "Incorrecto",
            CodigoErrorRegistro: 3000,
            DescripcionErrorRegistro: "Registro duplicado.",
            RegistroDuplicado: {
              EstadoRegistroDuplicado: "Correcta",
              CodigoErrorRegistro: null,
              DescripcionErrorRegistro: null,
            },
          },
          comparison: {
            kind: "lookup-mismatch",
            storedFingerprint: "A".repeat(64),
            storedSystem: { taxId: "B00000000", softwareId: "XX", installation: "77" },
          },
        },
      ],
      lookups: [
        {
          recordedAt: LOOKED_UP_AT.toISOString(),
          invoice: {
            IDEmisorFactura: seeded.nif,
            NumSerieFactura: "S7/1",
            FechaExpedicionFactura: "20-07-2026",
          },
          state: "Correcto",
          fingerprint: "B".repeat(64),
          system: null,
        },
      ],
    });
  });

  it("gives this node's active conflicts, the diverged record and the live series' invoice this box did not issue, each with where it was found, and none for no node", async () => {
    const { seeded, installation } = await seedOverview();

    const forNode = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }),
    );
    const forNone = await inTx((tx) => readFilingOverview(tx, { nodeId: null, limit: 200 }));

    expect(forNode.activeConflicts).toEqual([
      {
        source: "record",
        invoiceNumber: "S7/1",
        installationName: installation,
        cause: "fiscal.huella_divergente",
        observedAt: OBSERVED_AT.toISOString(),
        evidence: {
          line: expect.objectContaining({ EstadoRegistro: "Incorrecto" }),
          comparison: expect.objectContaining({ kind: "lookup-mismatch" }),
        },
      },
      {
        source: "series",
        invoiceNumber: "S1/99",
        installationName: installation,
        cause: "fiscal.huella_divergente",
        observedAt: "2026-07-21T11:00:00.000Z",
        evidence: {
          invoice: {
            IDEmisorFactura: seeded.nif,
            NumSerieFactura: "S1/99",
            FechaExpedicionFactura: "20-07-2026",
          },
          state: "Correcto",
          fingerprint: "D".repeat(64),
          system: { taxId: "B99999999", softwareId: "ZZ", installation: "5" },
        },
      },
    ]);
    expect(forNone.activeConflicts).toEqual([]);
  });

  it("names only the listed fields, at every level, and carries no recipient or AEAT request reference", async () => {
    const { seeded } = await seedOverview();

    const overview = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }),
    );

    const invoice = ["IDEmisorFactura", "NumSerieFactura", "FechaExpedicionFactura"];
    const system = ["taxId", "softwareId", "installation"];
    const line = [
      "IDFactura",
      "EstadoRegistro",
      "CodigoErrorRegistro",
      "DescripcionErrorRegistro",
      "RegistroDuplicado",
    ];
    const duplicate = [
      "EstadoRegistroDuplicado",
      "CodigoErrorRegistro",
      "DescripcionErrorRegistro",
    ];
    const comparison = ["kind", "storedFingerprint", "storedSystem"];
    const lookup = ["invoice", "state", "fingerprint", "system"];
    const expected: Record<string, string[]> = {
      "": ["readAt", "progress", "cases", "totalCases", "heldWithoutCase", "activeConflicts"],
      ".progress": ["counts", "oldestWaitingGeneratedAt", "lastConfirmedAt"],
      ".progress.counts": [
        "pendiente",
        "enviando",
        "aceptado",
        "aceptado_con_errores",
        "rechazado",
        "detenido",
        "retenido",
      ],
      ".cases[]": [
        "registroId",
        "cause",
        "openedAt",
        "evidence",
        "record",
        "submission",
        "conflicts",
        "lookups",
        "heldBehind",
      ],
      ".cases[].evidence": ["codigo", "mensaje", "csv"],
      ".cases[].record": [
        "tipoRegistro",
        "idEmisorFactura",
        "numSerieFactura",
        "fechaExpedicionFactura",
        "tipoFactura",
        "importeTotal",
        "cuotaTotal",
        "huella",
        "anteriorHuella",
        "fechaHoraHusoGenRegistro",
        "numeroInstalacion",
      ],
      ".cases[].submission": ["estado", "codigoError", "mensajeError", "enviadoEn"],
      ".cases[].conflicts[]": ["attempt", "cause", "recordedAt", "line", "comparison"],
      ".cases[].conflicts[].line": line,
      ".cases[].conflicts[].line.IDFactura": invoice,
      ".cases[].conflicts[].line.RegistroDuplicado": duplicate,
      ".cases[].conflicts[].comparison": comparison,
      ".cases[].conflicts[].comparison.storedSystem": system,
      ".cases[].lookups[]": ["recordedAt", ...lookup],
      ".cases[].lookups[].invoice": invoice,
      ".activeConflicts[]": [
        "source",
        "invoiceNumber",
        "installationName",
        "cause",
        "observedAt",
        "evidence",
      ],
      ".activeConflicts[].evidence": ["line", "comparison", ...lookup],
      ".activeConflicts[].evidence.line": line,
      ".activeConflicts[].evidence.line.IDFactura": invoice,
      ".activeConflicts[].evidence.line.RegistroDuplicado": duplicate,
      ".activeConflicts[].evidence.comparison": comparison,
      ".activeConflicts[].evidence.comparison.storedSystem": system,
      ".activeConflicts[].evidence.invoice": invoice,
      ".activeConflicts[].evidence.system": system,
    };
    const found = Object.fromEntries(
      [...keySets(overview)].map(([path, keys]) => [path, [...keys].sort()]),
    );
    expect(found).toEqual(
      Object.fromEntries(Object.entries(expected).map(([path, keys]) => [path, [...keys].sort()])),
    );
    const text = JSON.stringify(overview);
    for (const hidden of [RECIPIENT_NAME, REF_EXTERNA, DUPLICATE_REQUEST, LOOKUP_REFERENCE])
      expect(text).not.toContain(hidden);
  });

  it("gives the listed cases their observations when the newest case is resolved and the limit cuts the list", async () => {
    const { seeded, cancellation, diverged } = await seedOverview();

    const overview = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 2 }),
    );

    expect(overview.cases.map((each) => each.registroId)).toEqual([cancellation, diverged]);
    expect(overview.cases[1]!.conflicts.map((each) => each.recordedAt)).toEqual([
      OBSERVED_AT.toISOString(),
    ]);
    expect(overview.cases[1]!.lookups.map((each) => each.recordedAt)).toEqual([
      LOOKED_UP_AT.toISOString(),
    ]);
  });

  it("returns the newest 200 of 201 open cases and the total, and every case with no limit", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 201 });
    for (const registroId of seeded.registroIds)
      await openCase(registroId, "fiscal.registro_rechazado", "2026-07-21T09:00:00.000Z");

    const bounded = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }),
    );
    const unbounded = await inTx((tx) =>
      readFilingOverview(tx, { nodeId: seeded.nodeId, limit: null }),
    );

    expect(bounded.totalCases).toBe(201);
    expect(bounded.cases.map((each) => each.registroId)).toEqual(
      seeded.registroIds.slice(1).reverse(),
    );
    expect(unbounded.totalCases).toBe(201);
    expect(unbounded.cases.map((each) => each.registroId)).toEqual(
      [...seeded.registroIds].reverse(),
    );
  });
});
