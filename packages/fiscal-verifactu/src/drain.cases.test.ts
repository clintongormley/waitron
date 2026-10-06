import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendPendingAlta,
  seedPendingEnvios,
  seedSecondChain,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, backoffMs, drain, type DrainDeps } from "./drain.js";
import { listFilingCases, recordCaseEvent } from "./filing-cases.js";
import { decodeRegistroRow, fromRegistroRow, type RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const FIRST = new Date("2026-07-21T00:01:00Z");
// Past the fake's 5-second wait after FIRST.
const SECOND = new Date("2026-07-21T00:01:30Z");
const PERSON = "33333333-3333-4333-8333-333333333333";

const fakeAeat = () => createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });

const deps = (client: VerifactuClient, extra: Partial<DrainDeps> = {}): DrainDeps => ({
  db: suite.db,
  resolveClient: staticResolver(client),
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
  ...extra,
});

/** Wraps a client so a test can read which records each envío carried, in order. */
function recording(client: VerifactuClient): { client: VerifactuClient; sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    client: {
      submit: (cabecera, registros) => {
        sent.push(
          registros.map(
            (r) =>
              ("RegistroAlta" in r ? r.RegistroAlta.RefExterna : r.RegistroAnulacion.RefExterna)!,
          ),
        );
        return client.submit(cabecera, registros);
      },
      consultar: (...args) => client.consultar(...args),
    },
  };
}

interface EnvioState {
  estado: string;
  csv: string | null;
  incidencia: boolean;
  proximo_intento_en: string;
}

async function envioOf(registroId: string): Promise<EnvioState> {
  const { rows } = await suite.db.execute<{
    estado: string;
    csv: string | null;
    incidencia: number;
    proximo_intento_en: string;
  }>(sql`
    select estado, csv, incidencia, proximo_intento_en from envios where registro_id = ${registroId}
  `);
  const row = rows[0]!;
  return { ...row, incidencia: row.incidencia === 1 };
}

async function ackOf(registroId: string): Promise<string | undefined> {
  const { rows } = await suite.db.execute<{ state: string }>(
    sql`select state from acks where registro_id = ${registroId}`,
  );
  return rows[0]?.state;
}

async function incidentCodes(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ code: string }>(
    sql`select code from incidents order by code`,
  );
  return rows.map((r) => r.code);
}

const cases = () => withTransaction(suite.db, (tx) => listFilingCases(tx));

/** AEAT already holds another fingerprint under the record's identity: a Route B conflict. */
async function collideAtAeat(
  aeat: ReturnType<typeof createFakeAeat>,
  seeded: SeededDrain,
  registroId: string,
): Promise<void> {
  const raw = await suite.db.execute<Record<string, unknown>>(sql`
    select * from registros_facturacion where id = ${registroId}
  `);
  const ours = fromRegistroRow(decodeRegistroRow<RegistroRow>(raw.rows[0]!)) as RegistroAlta;
  await aeat
    .client()
    .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
      { RegistroAlta: { ...ours, Huella: "D".repeat(64) } },
    ]);
}

/** A pending cancellation of `originalId`, appended to the original's own chain. */
async function appendCancellation(
  seeded: SeededDrain,
  originalId: string,
  secuencia: number,
): Promise<string> {
  const records = await suite.db.select().from(registrosFacturacion);
  const original = records.find((row) => row.id === originalId)!;
  const head = records
    .filter((row) => row.sifId === original.sifId)
    .sort((a, b) => b.secuencia - a.secuencia)[0]!;
  const id = newId();
  const huella = "C".repeat(63) + String(secuencia % 10);
  await suite.db.insert(registrosFacturacion).values({
    ...original,
    id,
    secuencia,
    tipoRegistro: "anulacion",
    tipoFactura: null,
    descripcionOperacion: null,
    desglose: null,
    cuotaTotal: null,
    importeTotal: null,
    primerRegistro: false,
    anteriorIdEmisorFactura: head.idEmisorFactura,
    anteriorNumSerieFactura: head.numSerieFactura,
    anteriorFechaExpedicionFactura: head.fechaExpedicionFactura,
    anteriorHuella: head.huella,
    huella,
  });
  await suite.db.execute(sql`
    update cadenas set secuencia = ${secuencia}, ultimo_registro_id = ${id}, ultima_huella = ${huella}
    where node_id = ${seeded.nodeId}
  `);
  await suite.db.insert(envios).values({ registroId: id, proximoIntentoEn: SERVER_NOW });
  return id;
}

describe("drain — a rejection is kept and does not hold its chain", () => {
  it("applies every line of a reply whose first line is a rejection, and opens a case for the rejected record", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    const [rejected, second, third] = seeded.registroIds;

    const result = await drain(deps(aeat.client()), FIRST);

    const csv = (await envioOf(second!)).csv;
    expect(csv).toEqual(expect.any(String));
    expect(await envioOf(rejected!)).toMatchObject({ estado: "rechazado", csv, incidencia: true });
    expect(await envioOf(second!)).toMatchObject({ estado: "aceptado", csv });
    expect(await envioOf(third!)).toMatchObject({ estado: "aceptado", csv });
    expect([await ackOf(rejected!), await ackOf(second!), await ackOf(third!)]).toEqual([
      "rejected",
      "accepted",
      "accepted",
    ]);
    expect(result.recordsAccepted).toBe(2);
    expect(result.recordsHalted).toBe(1);

    const opened = await cases();
    expect(opened).toEqual([
      expect.objectContaining({
        registroId: rejected,
        cause: "fiscal.registro_rechazado",
        evidence: { codigo: 1100, mensaje: "Campo obligatorio ausente", csv },
        openedAt: FIRST,
        estado: "rechazado",
        status: "open",
        events: [],
      }),
    ]);
  });

  it("claims and files a record created after its chain's rejection", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    await drain(deps(aeat.client()), FIRST);
    const successor = await appendPendingAlta(suite.db, seeded, 2);
    const wire = recording(aeat.client());

    const result = await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([[successor.registroId]]);
    expect(await envioOf(successor.registroId)).toMatchObject({
      estado: "aceptado",
      csv: expect.any(String),
    });
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);
  });
});

describe("drain — a conflict holds the records not yet sent behind it", () => {
  it("Route B: keeps a same-reply successor's own outcome, holds the unsent successor and a later one, with one case", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [conflicting, sameReply, unsent] = seeded.registroIds;
    await collideAtAeat(aeat, seeded, conflicting!);
    const wire = recording(aeat.client());

    // A cap of 2 sends the first two records; the third stays unsent.
    const first = await drain(deps(wire.client, { maxRegistrosPorEnvio: 2 }), FIRST);

    expect(wire.sent).toEqual([[conflicting, sameReply]]);
    const csv = (await envioOf(sameReply!)).csv;
    expect(csv).toEqual(expect.any(String));
    expect(await envioOf(conflicting!)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await envioOf(sameReply!)).toMatchObject({ estado: "aceptado", csv });
    expect(await envioOf(unsent!)).toMatchObject({
      estado: "detenido",
      csv: null,
      incidencia: true,
    });
    expect(await ackOf(unsent!)).toBe("halted");
    expect(first.recordsAccepted).toBe(1);
    expect(first.recordsHalted).toBe(2);

    const later = await appendPendingAlta(suite.db, seeded, 4);
    const second = await drain(deps(wire.client, { maxRegistrosPorEnvio: 2 }), SECOND);

    expect(wire.sent).toHaveLength(1);
    expect(await envioOf(later.registroId)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await ackOf(later.registroId)).toBe("halted");
    expect(second.recordsAccepted).toBe(0);
    expect(second.recordsHalted).toBe(1);
    expect(aeat.stored().some((s) => s.refExterna === unsent)).toBe(false);
    expect(aeat.stored().some((s) => s.refExterna === later.registroId)).toBe(false);

    const opened = await cases();
    expect(opened.map((c) => [c.registroId, c.cause, c.status])).toEqual([
      [conflicting, "fiscal.huella_divergente", "open"],
    ]);
    expect(opened[0]!.evidence).toEqual({
      codigo: 3000,
      mensaje: expect.any(String),
      csv,
    });
    expect(await incidentCodes()).toEqual(["fiscal.huella_divergente"]);

    const alerts = await withTransaction(suite.db, (tx) =>
      fiscalSubmissionSource.read({ tx, now: SECOND }),
    );
    expect(alerts.find((a) => a.code === "fiscal.submission_stopped")?.params).toEqual({
      count: 3,
    });
  });

  it("Route A: an annulled duplicate of a sale opens a fiscal.duplicado_anulado case and holds a later record, while a same-reply successor keeps its own line", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    await drain(deps(aeat.client()), FIRST);
    aeat.annul(seeded.facturaKeys[0]!);
    await suite.db.execute(sql`
      update envios set estado = 'pendiente', proximo_intento_en = ${FIRST.toISOString()}
      where registro_id = ${original}
    `);
    const sameReply = await appendPendingAlta(suite.db, seeded, 2);

    const result = await drain(deps(aeat.client()), SECOND);

    expect(await envioOf(original!)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await envioOf(sameReply.registroId)).toMatchObject({
      estado: "aceptado",
      csv: expect.any(String),
    });
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(1);
    expect((await cases()).map((c) => [c.registroId, c.cause])).toEqual([
      [original, "fiscal.duplicado_anulado"],
    ]);

    const later = await appendPendingAlta(suite.db, seeded, 3);
    const wire = recording(aeat.client());
    await drain(deps(wire.client), new Date(SECOND.getTime() + 60_000));
    expect(wire.sent).toEqual([]);
    expect(await envioOf(later.registroId)).toMatchObject({ estado: "detenido" });
    expect(await cases()).toHaveLength(1);
  });

  it("never holds a record that was in the same envío, even when the reply has no line for it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [conflicting, unanswered] = seeded.registroIds;
    await collideAtAeat(aeat, seeded, conflicting!);
    const real = aeat.client();
    const secondLineMisnamed: VerifactuClient = {
      submit: async (cabecera, registros) => {
        const respuesta = await real.submit(cabecera, registros);
        return {
          ...respuesta,
          RespuestaLinea: respuesta.RespuestaLinea.map((linea) =>
            linea.RefExterna === unanswered ? { ...linea, RefExterna: "not-in-this-batch" } : linea,
          ),
        };
      },
      consultar: (...args) => real.consultar(...args),
    };

    await drain(deps(secondLineMisnamed), FIRST);

    expect((await envioOf(conflicting!)).estado).toBe("detenido");
    expect(await envioOf(unanswered!)).toMatchObject({ estado: "enviando", incidencia: false });
    expect(await ackOf(unanswered!)).toBeUndefined();
  });
});

describe("drain — a cancellation whose original was not accepted", () => {
  it("holds a cancellation of a rejected original without sending it, and holds the later records behind it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    await drain(deps(aeat.client()), FIRST);
    const cancellation = await appendCancellation(seeded, original!, 2);
    const later = await appendPendingAlta(suite.db, seeded, 3);
    const wire = recording(aeat.client());

    const result = await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([]);
    expect(aeat.stored().some((s) => s.refExterna === cancellation)).toBe(false);
    expect(await envioOf(cancellation)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await ackOf(cancellation)).toBe("halted");
    expect(await envioOf(later.registroId)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(result.recordsSubmitted).toBe(0);
    expect(result.recordsHalted).toBe(2);
    expect((await cases()).map((c) => c.registroId)).toEqual([original]);
    expect(await incidentCodes()).toEqual(["fiscal.registro_rechazado"]);
  });

  it("holds a cancellation of an original held for a conflict without sending it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    await collideAtAeat(aeat, seeded, original!);
    await drain(deps(aeat.client()), FIRST);
    const cancellation = await appendCancellation(seeded, original!, 2);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([]);
    expect(await envioOf(cancellation)).toMatchObject({ estado: "detenido", incidencia: true });
    expect((await cases()).map((c) => c.registroId)).toEqual([original]);
  });
});

describe("drain — a duplicate whose lookup fails", () => {
  it("marks only that record unknown, saves every other line, its CSV and its case, and keeps its chain blocked", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [duplicate] = seeded.registroIds;
    await drain(deps(aeat.client()), FIRST);
    aeat.dropRegistroDuplicadoDetail(seeded.facturaKeys[0]!);
    await suite.db.execute(sql`
      update envios set estado = 'pendiente', csv = null, proximo_intento_en = ${FIRST.toISOString()}
      where registro_id = ${duplicate}
    `);
    const accepted = await seedSecondChain(suite.db, seeded, 5);
    const refused = await seedSecondChain(suite.db, seeded, 6);
    aeat.reject(refused.facturaKey, 1100, "Campo obligatorio ausente");
    const real = aeat.client();
    const lookupFails: VerifactuClient = {
      submit: (cabecera, registros) => real.submit(cabecera, registros),
      consultar: () => Promise.reject(new Error("AEAT unreachable")),
    };

    const result = await drain(deps(lookupFails), SECOND);

    const csv = (await envioOf(accepted.registroId)).csv;
    expect(csv).toEqual(expect.any(String));
    const retryAt = new Date(SECOND.getTime() + backoffMs(2));
    expect(await envioOf(duplicate!)).toEqual({
      estado: "pendiente",
      csv: null,
      incidencia: true,
      proximo_intento_en: retryAt.toISOString(),
    });
    expect(await envioOf(accepted.registroId)).toMatchObject({ estado: "aceptado", csv });
    expect(await envioOf(refused.registroId)).toMatchObject({ estado: "rechazado", csv });
    expect((await cases()).map((c) => [c.registroId, c.evidence])).toEqual([
      [refused.registroId, { codigo: 1100, mensaje: "Campo obligatorio ausente", csv }],
    ]);
    const { rows: unknown } = await suite.db.execute<{ severity: string; params: string }>(sql`
      select severity, params from incidents where code = 'fiscal.estado_desconocido'
    `);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.severity).toBe("warning");
    expect(JSON.parse(unknown[0]!.params)).toMatchObject({
      registroId: duplicate,
      codigo: 3000,
      csv,
    });
    expect(result.recordsAccepted).toBe(1);
    expect(result.nextDueAt).toEqual(retryAt);

    // The chain stays blocked until the unknown record's own retry, then both go in order.
    const successor = await appendPendingAlta(suite.db, seeded, 2);
    const wire = recording(real);
    await drain(deps(wire.client), new Date(SECOND.getTime() + 60_000));
    expect(wire.sent).toEqual([]);
    await drain(deps(wire.client), retryAt);
    expect(wire.sent).toEqual([[duplicate, successor.registroId]]);
    expect((await envioOf(duplicate!)).estado).toBe("aceptado");
    expect((await envioOf(successor.registroId)).estado).toBe("aceptado");
  });
});

describe("drain — an unknown outcome blocks later claims on its chain", () => {
  it("sends no later record of the chain until the unknown one's retry, then sends both in order", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [unknown] = seeded.registroIds;
    const real = aeat.client();
    const withoutStatus: VerifactuClient = {
      submit: async (cabecera, registros) => {
        const respuesta = await real.submit(cabecera, registros);
        return {
          ...respuesta,
          RespuestaLinea: respuesta.RespuestaLinea.map((l) => ({
            ...l,
            EstadoRegistro: undefined,
          })),
        };
      },
      consultar: (...args) => real.consultar(...args),
    };
    await drain(deps(withoutStatus), FIRST);
    const retryAt = new Date(FIRST.getTime() + backoffMs(1));
    const successor = await appendPendingAlta(suite.db, seeded, 2);
    const other = await seedSecondChain(suite.db, seeded, 5);
    const wire = recording(real);

    await drain(deps(wire.client), SECOND);
    expect(wire.sent).toEqual([[other.registroId]]);

    await drain(deps(wire.client), retryAt);
    expect(wire.sent).toEqual([[other.registroId], [unknown, successor.registroId]]);
    expect(await cases()).toEqual([]);
  });
});

describe("drain — a case commits with the outcome that opened it", () => {
  it("leaves no case, no estado change and no incident when the reply's transaction fails after them", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [rejected, accepted] = seeded.registroIds;
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    // Refuses the second line's accept, which is written after the first line's rejection, its
    // incident and its case.
    await suite.db.execute(sql`
      create trigger test_refuse_accept before update of estado on envios
      when new.estado = 'aceptado'
      begin select raise(abort, 'refused by test'); end
    `);
    try {
      await drain(deps(aeat.client()), FIRST);
    } finally {
      await suite.db.execute(sql`drop trigger test_refuse_accept`);
    }

    expect(await cases()).toEqual([]);
    expect(await incidentCodes()).toEqual([]);
    expect((await envioOf(rejected!)).estado).toBe("pendiente");
    expect((await envioOf(accepted!)).estado).toBe("pendiente");
    expect(await ackOf(rejected!)).toBeUndefined();
  });
});

describe("drain — resolving a case releases nothing", () => {
  it("keeps a later record held and the original's envío unchanged after its conflict case is resolved", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [conflicting] = seeded.registroIds;
    await collideAtAeat(aeat, seeded, conflicting!);
    await drain(deps(aeat.client()), FIRST);
    const [opened] = await cases();
    expect(opened?.registroId).toBe(conflicting);
    await withTransaction(suite.db, (tx) =>
      recordCaseEvent(tx, {
        caseId: opened!.id,
        actionKey: "resolve-1",
        kind: "resolved",
        personId: PERSON,
        action: "Checked with the adviser",
        now: SECOND,
      }),
    );
    const before = await suite.db.execute(
      sql`select * from envios where registro_id = ${conflicting}`,
    );
    const successor = await appendPendingAlta(suite.db, seeded, 2);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), new Date(SECOND.getTime() + 60_000));

    expect(wire.sent).toEqual([]);
    expect((await envioOf(successor.registroId)).estado).toBe("detenido");
    const after = await suite.db.execute(
      sql`select * from envios where registro_id = ${conflicting}`,
    );
    expect(after.rows).toEqual(before.rows);
    expect((await cases()).map((c) => c.status)).toEqual(["resolved"]);
  });
});
