import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { createClient } from "@waitron/verifactu";
import type { IDFactura, RespuestaLinea, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendCancellation,
  appendPendingAlta,
  collideAtAeat,
  seedIndependentChain,
  seedPendingEnvios,
  seedSecondChain,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, backoffMs, drain, type DrainDeps } from "./drain.js";
import { heldRecords, listFilingCases, recordCaseEvent } from "./filing-cases.js";
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

/** Wraps a client so each line of AEAT's reply passes through `rewrite` before the drain reads it. */
function rewritingLines(
  client: VerifactuClient,
  rewrite: (linea: RespuestaLinea) => RespuestaLinea,
): VerifactuClient {
  return {
    submit: async (cabecera, registros) => {
      const respuesta = await client.submit(cabecera, registros);
      return { ...respuesta, RespuestaLinea: respuesta.RespuestaLinea.map(rewrite) };
    },
    consultar: (...args) => client.consultar(...args),
  };
}

/** The reply's line for `registroId` carries a reference outside the envío. */
const misnaming = (client: VerifactuClient, registroId: string) =>
  rewritingLines(client, (linea) =>
    linea.RefExterna === registroId ? { ...linea, RefExterna: "not-in-this-batch" } : linea,
  );

/** Every line of the reply arrives without its status. */
const withoutStatus = (client: VerifactuClient) =>
  rewritingLines(client, (linea) => ({ ...linea, EstadoRegistro: undefined }));

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

describe("drain — a lone rejection is kept and does not hold its chain", () => {
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

describe("drain — a run of refusals with one code stops its chain", () => {
  const minutesAfterFirst = (minutes: number) => new Date(FIRST.getTime() + minutes * 60_000);
  const REFUSED = "fiscal.registro_rechazado";

  /** Seeds one record per entry and files them in one envío: a number is the code AEAT refuses
   * that record with, `null` lets it be accepted. */
  async function fileOneEnvio(
    aeat: ReturnType<typeof fakeAeat>,
    codes: (number | null)[],
    client: VerifactuClient = aeat.client(),
  ) {
    const seeded = await seedPendingEnvios(suite.db, { count: codes.length });
    codes.forEach((code, index) => {
      if (code !== null) aeat.reject(seeded.facturaKeys[index]!, code, `Rechazo ${code}`);
    });
    await drain(deps(client), FIRST);
    return seeded;
  }

  async function estados(ids: string[]): Promise<string[]> {
    return Promise.all(ids.map(async (id) => (await envioOf(id)).estado));
  }

  it("holds the next record, unsent, after three refusals with one code in one envío", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100]);
    expect(await estados(seeded.registroIds)).toEqual(["rechazado", "rechazado", "rechazado"]);
    const next = await appendPendingAlta(suite.db, seeded, 4);
    const wire = recording(aeat.client());

    const result = await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([]);
    expect(aeat.stored().some((s) => s.refExterna === next.registroId)).toBe(false);
    expect(await envioOf(next.registroId)).toMatchObject({
      estado: "detenido",
      csv: null,
      incidencia: true,
    });
    expect(await ackOf(next.registroId)).toBe("halted");
    expect(result.recordsHalted).toBe(1);
    expect(result.recordsSubmitted).toBe(0);
    expect(await cases()).toHaveLength(3);
    expect(await incidentCodes()).toEqual([REFUSED, REFUSED, REFUSED]);
  });

  it("holds the next record after three same-code refusals made one per envío", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Rechazo 1100");
    await drain(deps(aeat.client()), FIRST);
    const wire = recording(aeat.client());
    const second = await appendPendingAlta(suite.db, seeded, 2);
    aeat.reject(second.facturaKey, 1100, "Rechazo 1100");
    await drain(deps(wire.client), minutesAfterFirst(1));
    const third = await appendPendingAlta(suite.db, seeded, 3);
    aeat.reject(third.facturaKey, 1100, "Rechazo 1100");
    await drain(deps(wire.client), minutesAfterFirst(2));
    expect(wire.sent).toEqual([[second.registroId], [third.registroId]]);
    const fourth = await appendPendingAlta(suite.db, seeded, 4);

    const result = await drain(deps(wire.client), minutesAfterFirst(3));

    expect(wire.sent).toHaveLength(2);
    expect(await envioOf(fourth.registroId)).toMatchObject({
      estado: "detenido",
      incidencia: true,
    });
    expect(result.recordsHalted).toBe(1);
  });

  it("holds two records appended after the run in one pass, sending neither", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100]);
    const fourth = await appendPendingAlta(suite.db, seeded, 4);
    const fifth = await appendPendingAlta(suite.db, seeded, 5);
    const wire = recording(aeat.client());

    const result = await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([]);
    expect(await estados([fourth.registroId, fifth.registroId])).toEqual(["detenido", "detenido"]);
    expect(await ackOf(fifth.registroId)).toBe("halted");
    expect(result.recordsHalted).toBe(2);
    expect(await cases()).toHaveLength(3);
  });

  it("names the case of the run's last refusal for the record the run holds and the one held behind it", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100]);
    const fourth = await appendPendingAlta(suite.db, seeded, 4);
    const fifth = await appendPendingAlta(suite.db, seeded, 5);
    await drain(deps(aeat.client()), SECOND);
    const lastRefusal = (await cases()).find((c) => c.registroId === seeded.registroIds[2]);

    const held = await withTransaction(suite.db, (tx) => heldRecords(tx));

    expect(held).toEqual([
      { registroId: fourth.registroId, caseId: lastRefusal!.id },
      { registroId: fifth.registroId, caseId: lastRefusal!.id },
    ]);
  });

  it("holds the next record after a same-code run whose positions on the chain have gaps", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const fifth = await appendPendingAlta(suite.db, seeded, 5);
    const ninth = await appendPendingAlta(suite.db, seeded, 9);
    for (const key of [seeded.facturaKeys[0]!, fifth.facturaKey, ninth.facturaKey]) {
      aeat.reject(key, 1100, "Rechazo 1100");
    }
    await drain(deps(aeat.client()), FIRST);
    expect(await estados([seeded.registroIds[0]!, fifth.registroId, ninth.registroId])).toEqual([
      "rechazado",
      "rechazado",
      "rechazado",
    ]);
    const next = await appendPendingAlta(suite.db, seeded, 13);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([]);
    expect((await envioOf(next.registroId)).estado).toBe("detenido");
  });

  it("keeps another chain sending, even at a later position, while one chain is held", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100]);
    // On the run's node, so only the chain separates this record from the run below it.
    const other = await seedPendingEnvios(suite.db, {
      count: 1,
      identity: { locationId: seeded.locationId, nodeId: seeded.nodeId, nif: seeded.nif },
    });
    expect(other.sifId).not.toBe(seeded.sifId);
    const held = await appendPendingAlta(suite.db, seeded, 1_000_000);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([other.registroIds]);
    expect((await envioOf(other.registroIds[0]!)).estado).toBe("aceptado");
    expect((await envioOf(held.registroId)).estado).toBe("detenido");
  });

  it("sends the first record of a new chain on the same node after the old chain's run", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100]);
    const newChain = await seedPendingEnvios(suite.db, {
      count: 1,
      identity: { locationId: seeded.locationId, nodeId: seeded.nodeId, nif: seeded.nif },
    });
    expect(newChain.sifId).not.toBe(seeded.sifId);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([newChain.registroIds]);
  });

  it("lets every record of the run's own envío keep its own outcome, and an accept there lets the next record go", async () => {
    const aeat = fakeAeat();
    const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100, null]);
    const accepted = seeded.registroIds[3]!;
    expect(await envioOf(accepted)).toMatchObject({ estado: "aceptado", csv: expect.any(String) });
    const next = await appendPendingAlta(suite.db, seeded, 5);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([[next.registroId]]);
  });

  describe("controls: the next record is sent", () => {
    async function sendsNext(seeded: SeededDrain, aeat: ReturnType<typeof fakeAeat>) {
      const next = await appendPendingAlta(suite.db, seeded, seeded.registroIds.length + 1);
      const wire = recording(aeat.client());
      const result = await drain(deps(wire.client), SECOND);
      expect(wire.sent).toEqual([[next.registroId]]);
      expect(result.recordsHalted).toBe(0);
    }

    it("after a run of two refusals with one code", async () => {
      const aeat = fakeAeat();
      const seeded = await fileOneEnvio(aeat, [1100, 1100]);
      await sendsNext(seeded, aeat);
    });

    it("after three refusals whose oldest carries a different code", async () => {
      const aeat = fakeAeat();
      const seeded = await fileOneEnvio(aeat, [1101, 1100, 1100]);
      await sendsNext(seeded, aeat);
    });

    it("after three same-code refusals with an accept among the last three records", async () => {
      const aeat = fakeAeat();
      const seeded = await fileOneEnvio(aeat, [1100, 1100, null, 1100]);
      expect(await estados(seeded.registroIds)).toEqual([
        "rechazado",
        "rechazado",
        "aceptado",
        "rechazado",
      ]);
      await sendsNext(seeded, aeat);
    });

    it("after three refusals whose lines carry no code", async () => {
      const aeat = fakeAeat();
      const noCode = rewritingLines(aeat.client(), (linea) => ({
        ...linea,
        CodigoErrorRegistro: undefined,
      }));
      const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100], noCode);
      expect(await estados(seeded.registroIds)).toEqual(["rechazado", "rechazado", "rechazado"]);
      await sendsNext(seeded, aeat);
    });

    it("after three same-code refusals, one of whose lines carries no code", async () => {
      const aeat = fakeAeat();
      let lines = 0;
      const middleWithoutCode = rewritingLines(aeat.client(), (linea) =>
        (lines += 1) === 2 ? { ...linea, CodigoErrorRegistro: undefined } : linea,
      );
      const seeded = await fileOneEnvio(aeat, [1100, 1100, 1100], middleWithoutCode);
      expect(await estados(seeded.registroIds)).toEqual(["rechazado", "rechazado", "rechazado"]);
      const { rows } = await suite.db.execute<{ codigo_error: string | null }>(sql`
        select e.codigo_error from envios e join registros_facturacion r on r.id = e.registro_id
        order by r.secuencia
      `);
      expect(rows.map((row) => row.codigo_error)).toEqual(["1100", null, "1100"]);
      await sendsNext(seeded, aeat);
    });

    it("after three accepted records that carry one error code", async () => {
      const aeat = fakeAeat();
      const seeded = await fileOneEnvio(aeat, [null, null, null]);
      // No accept the drain writes keeps a code; set one directly, so only the records' state
      // separates them from a run of refusals.
      await suite.db.execute(sql`
        update envios set codigo_error = '1100' where registro_id in ${seeded.registroIds}
      `);
      expect(await estados(seeded.registroIds)).toEqual(["aceptado", "aceptado", "aceptado"]);
      await sendsNext(seeded, aeat);
    });

    it("after two same-code refusals either side of an accepted record that carries that code", async () => {
      const aeat = fakeAeat();
      const seeded = await fileOneEnvio(aeat, [1100, null, 1100]);
      await suite.db.execute(sql`
        update envios set codigo_error = '1100' where registro_id = ${seeded.registroIds[1]!}
      `);
      expect(await estados(seeded.registroIds)).toEqual(["rechazado", "aceptado", "rechazado"]);
      await sendsNext(seeded, aeat);
    });
  });

  describe("a record already sent to AEAT is never held by the run", () => {
    it("sends again, at its retry, a record whose line in the run's envío was unreadable", async () => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 5 });
      for (const key of seeded.facturaKeys.slice(0, 3)) aeat.reject(key, 1100, "Rechazo 1100");
      const unreadable = seeded.registroIds[3]!;
      const real = aeat.client();
      await drain(
        deps(
          rewritingLines(real, (linea) =>
            linea.RefExterna === unreadable ? { ...linea, EstadoRegistro: undefined } : linea,
          ),
        ),
        FIRST,
      );
      expect(await estados(seeded.registroIds)).toEqual([
        "rechazado",
        "rechazado",
        "rechazado",
        "pendiente",
        "aceptado",
      ]);
      const wire = recording(real);

      await drain(deps(wire.client), new Date(FIRST.getTime() + backoffMs(1)));

      expect(wire.sent).toEqual([[unreadable]]);
      expect((await envioOf(unreadable)).estado).not.toBe("detenido");
    });

    it("sends again, once its claim is recovered, a record the run's reply had no line for", async () => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 4 });
      for (const key of seeded.facturaKeys.slice(0, 3)) aeat.reject(key, 1100, "Rechazo 1100");
      const unanswered = seeded.registroIds[3]!;
      const real = aeat.client();
      await drain(deps(misnaming(real, unanswered)), FIRST);
      expect((await envioOf(unanswered)).estado).toBe("enviando");
      const wire = recording(real);

      await drain(deps(wire.client), new Date(FIRST.getTime() + RECUPERACION_ENVIANDO_MS + 1));

      expect(wire.sent).toEqual([[unanswered]]);
      expect((await envioOf(unanswered)).estado).not.toBe("detenido");
    });
  });

  describe("a record still awaiting its answer breaks the run for the records after it", () => {
    /** One envío of four, the first three refused with 1100 and the fourth's answer unknown in
     * the way `answerLost` makes it; then two records appended behind it. Every one is refused
     * with 1100 whenever it reaches AEAT. */
    async function runThenUnanswered(
      answerLost: (real: VerifactuClient, id: string) => VerifactuClient,
    ) {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 4 });
      for (const key of seeded.facturaKeys) aeat.reject(key, 1100, "Rechazo 1100");
      const fourth = seeded.registroIds[3]!;
      const real = aeat.client();
      await drain(deps(answerLost(real, fourth)), FIRST);
      const appended = [];
      for (const secuencia of [5, 6]) {
        const record = await appendPendingAlta(suite.db, seeded, secuencia);
        aeat.reject(record.facturaKey, 1100, "Rechazo 1100");
        appended.push(record.registroId);
      }
      return { aeat, seeded, real, fourth, appended };
    }

    it("sends the records appended after an unreadable answer together with its retry, and holds the next record once all three are refused", async () => {
      const { seeded, real, fourth, appended } = await runThenUnanswered((client, id) =>
        rewritingLines(client, (linea) =>
          linea.RefExterna === id ? { ...linea, EstadoRegistro: undefined } : linea,
        ),
      );
      expect((await envioOf(fourth)).estado).toBe("pendiente");
      const wire = recording(real);
      const retry = new Date(FIRST.getTime() + backoffMs(1));

      const result = await drain(deps(wire.client), retry);

      expect(wire.sent).toEqual([[fourth, ...appended]]);
      expect(result.recordsHalted).toBe(3);
      expect(await estados([fourth, ...appended])).toEqual(["rechazado", "rechazado", "rechazado"]);

      const seventh = await appendPendingAlta(suite.db, seeded, 7);
      const afterRetry = await drain(deps(wire.client), new Date(retry.getTime() + 60_000));

      expect(wire.sent).toHaveLength(1);
      expect(await envioOf(seventh.registroId)).toMatchObject({
        estado: "detenido",
        incidencia: true,
      });
      expect(afterRetry.recordsHalted).toBe(1);
    });

    it("sends the records appended after a missing answer together with its recovered claim", async () => {
      const { real, fourth, appended } = await runThenUnanswered(misnaming);
      expect((await envioOf(fourth)).estado).toBe("enviando");
      const wire = recording(real);

      await drain(deps(wire.client), new Date(FIRST.getTime() + RECUPERACION_ENVIANDO_MS + 1));

      expect(wire.sent).toEqual([[fourth, ...appended]]);
    });
  });
});

describe("drain — a conflict holds the records not yet sent behind it", () => {
  it("Route B: keeps a same-reply successor's own outcome, holds the unsent successor and a later one, with one case", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [conflicting, sameReply, unsent] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, conflicting!);
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

  it("does not hold a record of the same envío when the reply is applied, even when its line carries another reference", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [conflicting, unanswered] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, conflicting!);
    const real = aeat.client();
    const secondLineMisnamed = misnaming(real, unanswered!);

    await drain(deps(secondLineMisnamed), FIRST);

    expect((await envioOf(conflicting!)).estado).toBe("detenido");
    expect(await envioOf(unanswered!)).toMatchObject({ estado: "pendiente", incidencia: true });
    expect(await ackOf(unanswered!)).toBeUndefined();
  });

  it("holds an unanswered record of the conflict's envío at its next claim, once its retry is due, and never sends it again", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [conflicting, unanswered] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, conflicting!);
    const real = aeat.client();
    const secondLineMisnamed = misnaming(real, unanswered!);
    await drain(deps(secondLineMisnamed), FIRST);
    const wire = recording(real);

    // Past the unanswered record's retry (`backoffMs(1)`), so this pass claims it.
    const result = await drain(deps(wire.client), new Date(FIRST.getTime() + backoffMs(1)));

    expect(wire.sent).toEqual([]);
    expect(await envioOf(unanswered!)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await ackOf(unanswered!)).toBe("halted");
    expect(result.recordsSubmitted).toBe(0);
    expect(result.recordsHalted).toBe(1);
    const [opened] = await cases();
    expect(opened).toMatchObject({ registroId: conflicting, cause: "fiscal.huella_divergente" });
    expect(await withTransaction(suite.db, (tx) => heldRecords(tx))).toEqual([
      { registroId: unanswered, caseId: opened!.id },
    ]);
  });
  it("holds a record of the conflict's envío whose status was unreadable at its retry, and never sends it again", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [conflicting, unreadable] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, conflicting!);
    const real = aeat.client();
    const secondLineUnreadable = rewritingLines(real, (linea) =>
      linea.RefExterna === unreadable ? { ...linea, EstadoRegistro: undefined } : linea,
    );
    await drain(deps(secondLineUnreadable), FIRST);
    expect((await envioOf(unreadable!)).estado).toBe("pendiente");
    const wire = recording(real);

    const result = await drain(deps(wire.client), new Date(FIRST.getTime() + backoffMs(1)));

    expect(wire.sent).toEqual([]);
    expect(await envioOf(unreadable!)).toMatchObject({ estado: "detenido", incidencia: true });
    expect(await ackOf(unreadable!)).toBe("halted");
    expect(result.recordsHalted).toBe(1);
    const [opened] = await cases();
    expect(await withTransaction(suite.db, (tx) => heldRecords(tx))).toEqual([
      { registroId: unreadable, caseId: opened!.id },
    ]);
  });
});

describe("drain — a cancellation whose original was not accepted", () => {
  it("holds a cancellation of a rejected original without sending it, and holds the later records behind it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    await drain(deps(aeat.client()), FIRST);
    const cancellation = await appendCancellation(suite.db, seeded, original!, 2);
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

  it("holds a cancellation of an original held for a conflict by the chain rule, as any later record of that chain, without sending it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, original!);
    await drain(deps(aeat.client()), FIRST);
    const cancellation = await appendCancellation(suite.db, seeded, original!, 2);
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
      lookupFailed: true,
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
    await drain(deps(withoutStatus(real)), FIRST);
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

describe("drain — an unknown outcome says whether a duplicate lookup failed", () => {
  async function unknownParams(): Promise<Record<string, unknown>[]> {
    const { rows } = await suite.db.execute<{ params: string }>(sql`
      select params from incidents where code = 'fiscal.estado_desconocido'
    `);
    return rows.map((row) => JSON.parse(row.params) as Record<string, unknown>);
  }

  it("names no lookup when the reply line itself is unreadable", async () => {
    const aeat = fakeAeat();
    await seedPendingEnvios(suite.db, { count: 1 });

    await drain(deps(withoutStatus(aeat.client())), FIRST);

    const params = await unknownParams();
    expect(params).toHaveLength(1);
    expect(params[0]).not.toHaveProperty("lookupFailed");
  });

  it("says lookupFailed false when the lookup answered without the record", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [duplicate] = seeded.registroIds;
    await drain(deps(aeat.client()), FIRST);
    await suite.db.execute(sql`
      update envios set estado = 'pendiente', csv = null, proximo_intento_en = ${FIRST.toISOString()}
      where registro_id = ${duplicate}
    `);
    const real = aeat.client();
    const lookupFindsNothing: VerifactuClient = {
      submit: (cabecera, registros) => real.submit(cabecera, registros),
      consultar: async (...args) => ({ ...(await real.consultar(...args)), registros: [] }),
    };

    await drain(deps(lookupFindsNothing), SECOND);

    expect((await envioOf(duplicate!)).estado).toBe("pendiente");
    expect(await unknownParams()).toEqual([expect.objectContaining({ lookupFailed: false })]);
  });
});

describe("drain — a cancellation answered Anulada whose lookup finds nothing", () => {
  it("stays pending as unknown, opens no case and holds nothing behind it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    await drain(deps(aeat.client()), FIRST);
    aeat.annul(seeded.facturaKeys[0]!);
    const cancellation = await appendCancellation(suite.db, seeded, original!, 2);
    const real = aeat.client();
    const lookupFindsNothing: VerifactuClient = {
      submit: (cabecera, registros) => real.submit(cabecera, registros),
      consultar: async (...args) => ({ ...(await real.consultar(...args)), registros: [] }),
    };
    const wire = recording(lookupFindsNothing);

    const result = await drain(deps(wire.client), SECOND);

    expect(wire.sent).toEqual([[cancellation]]);
    const retryAt = new Date(SECOND.getTime() + backoffMs(1));
    expect(await envioOf(cancellation)).toMatchObject({
      estado: "pendiente",
      incidencia: true,
      proximo_intento_en: retryAt.toISOString(),
    });
    expect(await incidentCodes()).toEqual(["fiscal.estado_desconocido"]);
    const { rows: unknown } = await suite.db.execute<{ params: string }>(sql`
      select params from incidents where code = 'fiscal.estado_desconocido'
    `);
    expect(JSON.parse(unknown[0]!.params)).toMatchObject({
      registroId: cancellation,
      codigo: 3000,
      lookupFailed: false,
    });
    expect(await cases()).toEqual([]);
    expect(result.recordsHalted).toBe(0);

    const later = await appendPendingAlta(suite.db, seeded, 3);
    // Before the cancellation's retry, which keeps the later record waiting behind it.
    await drain(deps(wire.client), new Date(SECOND.getTime() + 30_000));
    expect(wire.sent).toEqual([[cancellation]]);
    expect(await envioOf(later.registroId)).toMatchObject({ estado: "pendiente" });
    expect(await withTransaction(suite.db, (tx) => heldRecords(tx))).toEqual([]);
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
    let result: Awaited<ReturnType<typeof drain>> | undefined;
    try {
      result = await drain(deps(aeat.client()), FIRST);
    } finally {
      await suite.db.execute(sql`drop trigger test_refuse_accept`);
    }

    expect(await cases()).toEqual([]);
    expect(await incidentCodes()).toEqual([]);
    expect((await envioOf(rejected!)).estado).toBe("pendiente");
    expect((await envioOf(accepted!)).estado).toBe("pendiente");
    expect(await ackOf(rejected!)).toBeUndefined();
    // The envío did reach AEAT, so it is counted as sent; the outcomes the failed transaction
    // wrote were never kept, so nothing is counted as accepted, held or raised.
    expect(result).toMatchObject({
      batchesSent: 1,
      recordsSubmitted: 2,
      recordsAccepted: 0,
      recordsHalted: 0,
      incidentsRaised: 0,
      nextDueAt: new Date(FIRST.getTime() + backoffMs(1)),
    });
  });
});

describe("drain — a claim that rolls back reports nothing it wrote", () => {
  it("counts no incident when the claim's transaction fails after raising one", async () => {
    const aeat = fakeAeat();
    // Refused for its environment, which raises an incident inside the claim's transaction.
    await seedPendingEnvios(suite.db, { count: 1, entorno: "preproduction" });
    // A sendable row, whose claim stamp the trigger below refuses.
    await seedIndependentChain(suite.db, {
      sifId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      secuencia: 1,
    });
    await suite.db.execute(sql`
      create trigger test_refuse_claim before update of estado on envios
      when new.estado = 'enviando'
      begin select raise(abort, 'refused by test'); end
    `);
    let result: Awaited<ReturnType<typeof drain>> | undefined;
    try {
      result = await drain(deps(aeat.client()), FIRST);
    } finally {
      await suite.db.execute(sql`drop trigger test_refuse_claim`);
    }

    expect(await incidentCodes()).toEqual([]);
    expect(result).toMatchObject({
      skipped: [{ errorCode: "unknown" }],
      batchesSent: 0,
      incidentsRaised: 0,
      recordsHalted: 0,
    });
  });
});

describe("drain — resolving a case releases nothing", () => {
  it("keeps a later record held and the original's envío unchanged after its conflict case is resolved", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [conflicting] = seeded.registroIds;
    await collideAtAeat(suite.db, aeat, seeded, conflicting!);
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

describe("drain — a reply line is applied only when its reference and its invoice match one record", () => {
  /** The `IDFactura` AEAT's reply carries for the record `facturaKey` (from the seeding fixtures). */
  const idOf = (facturaKey: string): IDFactura => {
    const [IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura] = facturaKey.split("|");
    return {
      IDEmisorFactura: IDEmisorFactura!,
      NumSerieFactura: NumSerieFactura!,
      FechaExpedicionFactura: FechaExpedicionFactura!,
    };
  };

  /** An invoice as `fiscal.estado_desconocido`'s params spell it. */
  const asParams = (id: IDFactura) => ({
    idEmisorFactura: id.IDEmisorFactura,
    numSerieFactura: id.NumSerieFactura,
    fechaExpedicionFactura: id.FechaExpedicionFactura,
  });

  async function unknownParamsOf(registroId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await suite.db.execute<{ params: string }>(sql`
      select params from incidents where code = 'fiscal.estado_desconocido'
    `);
    return rows
      .map((row) => JSON.parse(row.params) as Record<string, unknown>)
      .filter((params) => params["registroId"] === registroId);
  }

  /** Every line of AEAT's reply for `registroId` arrives twice. */
  function doublingLine(client: VerifactuClient, registroId: string): VerifactuClient {
    return {
      submit: async (cabecera, registros) => {
        const respuesta = await client.submit(cabecera, registros);
        return {
          ...respuesta,
          RespuestaLinea: respuesta.RespuestaLinea.flatMap((linea) =>
            linea.RefExterna === registroId ? [linea, { ...linea }] : [linea],
          ),
        };
      },
      consultar: (...args) => client.consultar(...args),
    };
  }

  it("applies neither line when another invoice's line carries a record's reference", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [rejected, accepted] = seeded.registroIds;
    aeat.reject(seeded.facturaKeys[0]!, 1100, "Campo obligatorio ausente");
    const acceptedLineMisnamed = rewritingLines(aeat.client(), (linea) =>
      linea.RefExterna === accepted ? { ...linea, RefExterna: rejected } : linea,
    );

    const result = await drain(deps(acceptedLineMisnamed), FIRST);

    const retry = new Date(FIRST.getTime() + backoffMs(1)).toISOString();
    for (const id of [rejected!, accepted!]) {
      expect(await envioOf(id)).toMatchObject({
        estado: "pendiente",
        incidencia: true,
        proximo_intento_en: retry,
      });
      expect(await ackOf(id)).toBeUndefined();
    }
    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsHalted).toBe(0);
    const csv = expect.any(String);
    const rejectedLine = {
      refExterna: rejected,
      tipoOperacion: "Alta",
      ...asParams(idOf(seeded.facturaKeys[0]!)),
      estado: "Incorrecto",
      codigo: 1100,
      mensaje: "Campo obligatorio ausente",
    };
    const acceptedLine = {
      refExterna: rejected,
      tipoOperacion: "Alta",
      ...asParams(idOf(seeded.facturaKeys[1]!)),
      estado: "Correcto",
      codigo: null,
      mensaje: null,
    };
    expect(await unknownParamsOf(rejected!)).toEqual([
      {
        registroId: rejected,
        estado: null,
        codigo: null,
        mensaje: null,
        csv,
        operacionEnviada: "Alta",
        identidadEnviada: asParams(idOf(seeded.facturaKeys[0]!)),
        lineasRespuesta: [rejectedLine, acceptedLine],
      },
    ]);
    expect(await unknownParamsOf(accepted!)).toEqual([
      {
        registroId: accepted,
        estado: null,
        codigo: null,
        mensaje: null,
        csv,
        operacionEnviada: "Alta",
        identidadEnviada: asParams(idOf(seeded.facturaKeys[1]!)),
        lineasRespuesta: [acceptedLine],
      },
    ]);
    expect(await incidentCodes()).toEqual([
      "fiscal.estado_desconocido",
      "fiscal.estado_desconocido",
    ]);
    expect(await cases()).toEqual([]);
  });

  it.each([
    ["issuer NIF", { IDEmisorFactura: "B00000000" }],
    ["invoice number", { NumSerieFactura: "OTHER/1" }],
    ["issue date", { FechaExpedicionFactura: "19-07-2026" }],
  ])(
    "leaves a record unknown when its own line names another invoice by %s",
    async (_field, differs) => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 2 });
      const [mismatched, matched] = seeded.registroIds;
      const client = rewritingLines(aeat.client(), (linea) =>
        linea.RefExterna === mismatched
          ? { ...linea, IDFactura: { ...linea.IDFactura, ...differs } }
          : linea,
      );

      const result = await drain(deps(client), FIRST);

      expect(await envioOf(mismatched!)).toMatchObject({ estado: "pendiente", incidencia: true });
      expect(await ackOf(mismatched!)).toBeUndefined();
      expect(await envioOf(matched!)).toMatchObject({ estado: "aceptado", incidencia: false });
      expect(await ackOf(matched!)).toBe("accepted");
      expect(result.recordsAccepted).toBe(1);
      expect(await unknownParamsOf(mismatched!)).toEqual([
        expect.objectContaining({
          identidadEnviada: asParams(idOf(seeded.facturaKeys[0]!)),
          lineasRespuesta: [
            expect.objectContaining({
              refExterna: mismatched,
              ...asParams({ ...idOf(seeded.facturaKeys[0]!), ...differs }),
              estado: "Correcto",
            }),
          ],
        }),
      ]);
      expect(await cases()).toEqual([]);
    },
  );

  it.each([
    ["a reference outside this envío", "not-in-this-batch"],
    ["no reference at all", undefined],
  ])(
    "leaves a record unknown when the only line naming its invoice carries %s",
    async (_label, refExterna) => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 2 });
      const [matched, unreferenced] = seeded.registroIds;
      const client = rewritingLines(aeat.client(), (linea) =>
        linea.RefExterna === unreferenced ? { ...linea, RefExterna: refExterna } : linea,
      );

      const result = await drain(deps(client), FIRST);

      expect(await envioOf(unreferenced!)).toMatchObject({ estado: "pendiente", incidencia: true });
      expect(await ackOf(unreferenced!)).toBeUndefined();
      expect(await envioOf(matched!)).toMatchObject({ estado: "aceptado" });
      expect(result.recordsAccepted).toBe(1);
      expect(await unknownParamsOf(unreferenced!)).toEqual([
        expect.objectContaining({
          identidadEnviada: asParams(idOf(seeded.facturaKeys[1]!)),
          lineasRespuesta: [
            expect.objectContaining({
              refExterna: refExterna ?? null,
              ...asParams(idOf(seeded.facturaKeys[1]!)),
            }),
          ],
        }),
      ]);
    },
  );

  it("leaves a record unknown when its line arrives twice, identical", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [doubled] = seeded.registroIds;

    const result = await drain(deps(doublingLine(aeat.client(), doubled!)), FIRST);

    expect(await envioOf(doubled!)).toMatchObject({ estado: "pendiente", incidencia: true });
    expect(await ackOf(doubled!)).toBeUndefined();
    expect(result.recordsAccepted).toBe(0);
    const params = await unknownParamsOf(doubled!);
    expect(params).toHaveLength(1);
    expect(params[0]!["lineasRespuesta"]).toHaveLength(2);
    expect(await incidentCodes()).toEqual(["fiscal.estado_desconocido"]);
  });

  it("sends no later record of a chain whose record was left unknown by a mismatched line until that record's retry", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [mismatched, matched] = seeded.registroIds;
    const real = aeat.client();
    const client = rewritingLines(real, (linea) =>
      linea.RefExterna === mismatched
        ? { ...linea, IDFactura: { ...linea.IDFactura, NumSerieFactura: "OTHER/1" } }
        : linea,
    );
    await drain(deps(client), FIRST);
    expect((await envioOf(matched!)).estado).toBe("aceptado");
    const later = await appendPendingAlta(suite.db, seeded, 3);
    const wire = recording(real);

    await drain(deps(wire.client), SECOND);
    expect(wire.sent).toEqual([]);

    await drain(deps(wire.client), new Date(FIRST.getTime() + backoffMs(1)));
    expect(wire.sent).toEqual([[mismatched, later.registroId]]);
  });

  /**
   * Answers through the real client and its XML parser: each line keeps the reference and invoice
   * the fake AEAT gave it, says `Correcto`, and carries `operacion` as its `Operacion` element.
   */
  function answeringWith(real: VerifactuClient, operacion: string): VerifactuClient {
    return {
      submit: async (cabecera, registros) => {
        const respuesta = await real.submit(cabecera, registros);
        const lineas = respuesta.RespuestaLinea.map(
          ({ IDFactura: id, RefExterna }) =>
            `<RespuestaLinea><IDFactura><IDEmisorFactura>${id.IDEmisorFactura}</IDEmisorFactura>` +
            `<NumSerieFactura>${id.NumSerieFactura}</NumSerieFactura>` +
            `<FechaExpedicionFactura>${id.FechaExpedicionFactura}</FechaExpedicionFactura>` +
            `</IDFactura>${operacion}<RefExterna>${RefExterna}</RefExterna>` +
            `<EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>`,
        );
        const xml =
          `<Envelope><Body><RespuestaRegFactuSistemaFacturacion><CSV>${respuesta.CSV}</CSV>` +
          `<EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>5</TiempoEsperaEnvio>` +
          `${lineas.join("")}</RespuestaRegFactuSistemaFacturacion></Body></Envelope>`;
        return createClient({
          endpoint: "https://aeat.invalid/",
          fetch: async () => new Response(xml),
        }).submit(cabecera, registros);
      },
      consultar: (...args) => real.consultar(...args),
    };
  }

  const tipo = (tipoOperacion: string) =>
    `<Operacion><TipoOperacion>${tipoOperacion}</TipoOperacion></Operacion>`;

  /** One record waiting to be sent as `operation`: a fresh alta, or the anulación of a filed one. */
  async function waitingAs(
    aeat: ReturnType<typeof fakeAeat>,
    operation: "Alta" | "Anulacion",
  ): Promise<{ id: string; now: Date; facturaKey: string }> {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const [original] = seeded.registroIds;
    const facturaKey = seeded.facturaKeys[0]!;
    if (operation === "Alta") return { id: original!, now: FIRST, facturaKey };
    await drain(deps(aeat.client()), FIRST);
    expect((await envioOf(original!)).estado).toBe("aceptado");
    const id = await appendCancellation(suite.db, seeded, original!, 2);
    return { id, now: SECOND, facturaKey };
  }

  it.each([
    ["registration", "Alta", "Anulacion"],
    ["cancellation", "Anulacion", "Alta"],
  ] as const)(
    "leaves a %s unknown when its only line says AEAT took it as the other operation",
    async (_kind, sent, answered) => {
      const aeat = fakeAeat();
      const { id, now, facturaKey } = await waitingAs(aeat, sent);

      const result = await drain(deps(answeringWith(aeat.client(), tipo(answered))), now);

      expect(await envioOf(id)).toMatchObject({
        estado: "pendiente",
        incidencia: true,
        proximo_intento_en: new Date(now.getTime() + backoffMs(1)).toISOString(),
      });
      expect(await ackOf(id)).toBeUndefined();
      expect(result.recordsAccepted).toBe(0);
      expect(await unknownParamsOf(id)).toEqual([
        {
          registroId: id,
          estado: null,
          codigo: null,
          mensaje: null,
          csv: expect.any(String),
          operacionEnviada: sent,
          identidadEnviada: asParams(idOf(facturaKey)),
          lineasRespuesta: [
            {
              refExterna: id,
              tipoOperacion: answered,
              ...asParams(idOf(facturaKey)),
              estado: "Correcto",
              codigo: null,
              mensaje: null,
            },
          ],
        },
      ]);
      expect(await incidentCodes()).toEqual(["fiscal.estado_desconocido"]);
      expect(await cases()).toEqual([]);
    },
  );

  it.each([
    ["registration whose line states Alta", "Alta", tipo("Alta")],
    ["cancellation whose line states Anulacion", "Anulacion", tipo("Anulacion")],
    ["registration whose line has no Operacion", "Alta", ""],
    [
      "registration whose Operacion has no TipoOperacion",
      "Alta",
      "<Operacion><Subsanacion>N</Subsanacion></Operacion>",
    ],
  ] as const)("applies the line of a %s", async (_label, sent, operacion) => {
    const aeat = fakeAeat();
    const { id, now } = await waitingAs(aeat, sent);

    const result = await drain(deps(answeringWith(aeat.client(), operacion)), now);

    expect(await envioOf(id)).toMatchObject({ estado: "aceptado", incidencia: false });
    expect(result.recordsAccepted).toBe(1);
    expect(await incidentCodes()).toEqual([]);
  });
});
