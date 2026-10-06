import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RespuestaLinea, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendCancellation,
  appendPendingAlta,
  collideAtAeat,
  seedPendingEnvios,
  seedSecondChain,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain, resetInFlightClaims, type DrainDeps } from "./drain.js";
import { listFilingCases, openFilingCase } from "./filing-cases.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The envío that carries the run of three refusals. */
const T0 = new Date("2026-07-21T00:01:00Z");
/** The pass that claims the records appended after the run and holds them. */
const T = new Date("2026-07-21T00:02:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const RUN_CODE = 1100;

const fakeAeat = () => createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });

const deps = (client: VerifactuClient, extra: Partial<DrainDeps> = {}): DrainDeps => ({
  db: suite.db,
  resolveClient: staticResolver(client),
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
  ...extra,
});

/** Wraps a client so a test can read which records each envío carried, in order. */
function recording(
  client: VerifactuClient,
  onSubmit: () => Promise<void> = () => Promise.resolve(),
): { client: VerifactuClient; sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    client: {
      submit: async (cabecera, registros) => {
        sent.push(
          registros.map(
            (r) =>
              ("RegistroAlta" in r ? r.RegistroAlta.RefExterna : r.RegistroAnulacion.RefExterna)!,
          ),
        );
        await onSubmit();
        return client.submit(cabecera, registros);
      },
      consultar: (...args) => client.consultar(...args),
    },
  };
}

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

const unreadable = (client: VerifactuClient) =>
  rewritingLines(client, (linea) => ({ ...linea, EstadoRegistro: undefined }));

const failingSubmit = (client: VerifactuClient): VerifactuClient => ({
  submit: () => Promise.reject(new Error("connection reset")),
  consultar: (...args) => client.consultar(...args),
});

type EnvioState = {
  estado: string;
  intentos: number;
  enviado_en: string | null;
  proximo_intento_en: string;
  csv: string | null;
};

async function envioOf(registroId: string): Promise<EnvioState> {
  const { rows } = await suite.db.execute<EnvioState>(sql`
    select estado, intentos, enviado_en, proximo_intento_en, csv from envios
    where registro_id = ${registroId}
  `);
  return rows[0]!;
}

async function estados(ids: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const id of ids) found.push((await envioOf(id)).estado);
  return found;
}

async function ackOf(registroId: string): Promise<string | undefined> {
  const { rows } = await suite.db.execute<{ state: string }>(
    sql`select state from acks where registro_id = ${registroId}`,
  );
  return rows[0]?.state;
}

async function incidentCodes(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ code: string }>(
    sql`select code from incidents order by detected_at, code`,
  );
  return rows.map((r) => r.code);
}

const cases = () => withTransaction(suite.db, (tx) => listFilingCases(tx));

async function refusalAlerts(now: Date) {
  const alerts = await withTransaction(suite.db, (tx) => fiscalSubmissionSource.read({ tx, now }));
  return alerts
    .filter((a) => a.code === "fiscal.refusals_repeated")
    .map((a) => ({ key: a.key, params: a.params }));
}

/**
 * Files three records refused with `RUN_CODE` in one envío at `T0`, then appends `heldCount`
 * records and holds them at `T`: W41s-3b's hold, as its own tests build it.
 */
async function brakeHold(
  aeat: ReturnType<typeof fakeAeat>,
  heldCount: number,
): Promise<{ seeded: SeededDrain; held: string[]; heldKeys: string[] }> {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) aeat.reject(key, RUN_CODE, `Rechazo ${RUN_CODE}`);
  await drain(deps(aeat.client()), T0);
  const held: string[] = [];
  const heldKeys: string[] = [];
  for (let offset = 0; offset < heldCount; offset += 1) {
    const record = await appendPendingAlta(suite.db, seeded, 4 + offset);
    held.push(record.registroId);
    heldKeys.push(record.facturaKey);
  }
  await drain(deps(aeat.client()), T);
  expect(await estados(held)).toEqual(held.map(() => "detenido"));
  return { seeded, held, heldKeys };
}

describe("drain — a chain stopped by the same-code brake sends its first held record once an hour (real client over the fake AEAT's SOAP)", () => {
  it("sends nothing for the chain before the hour, then exactly its first held record at the hour", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 2);
    const [first, second] = held;
    const wire = recording(aeat.client());

    await drain(deps(wire.client), at(59 * MINUTE));
    expect(wire.sent).toEqual([]);

    await drain(deps(wire.client), at(HOUR));
    expect(wire.sent).toEqual([[first]]);
    expect(await envioOf(second!)).toMatchObject({ estado: "pendiente" });
  });

  it("reports the probe's instant as the next due time when nothing else is due, and sends it with no other due row", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 1);
    const wire = recording(aeat.client());

    const quiet = await drain(deps(wire.client), at(MINUTE));

    expect(quiet.nextDueAt).toEqual(at(HOUR));
    expect(wire.sent).toEqual([]);

    const due = await drain(deps(wire.client), at(HOUR));
    expect(wire.sent).toEqual([held]);
    expect(due.tenantsWithWork).toBe(1);
  });

  it("reports the probe's instant, not the skip retry, after a pass that holds a new record on the stopped chain", async () => {
    const aeat = fakeAeat();
    const { seeded } = await brakeHold(aeat, 1);
    await appendPendingAlta(suite.db, seeded, 5);

    const result = await drain(deps(aeat.client()), at(10 * MINUTE));

    expect(result.recordsHalted).toBe(1);
    expect(result.nextDueAt).toEqual(at(HOUR));
  });

  it("an accepted probe settles its record with the CSV and releases the records held behind it, which go next in order", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 3);
    const [first, second, third] = held;
    expect(await refusalAlerts(at(MINUTE))).toHaveLength(1);
    expect((await envioOf(second!)).intentos).toBe(1);
    const wire = recording(aeat.client());

    const probe = await drain(deps(wire.client), at(HOUR));

    expect(wire.sent).toEqual([[first]]);
    expect(await envioOf(first!)).toMatchObject({ estado: "aceptado", csv: expect.any(String) });
    for (const id of [second!, third!]) {
      expect(await envioOf(id)).toMatchObject({
        estado: "pendiente",
        intentos: 0,
        proximo_intento_en: at(HOUR).toISOString(),
      });
      expect(await ackOf(id)).toBeUndefined();
    }
    expect(await refusalAlerts(at(HOUR))).toEqual([]);
    expect(probe.nextDueAt).not.toBeNull();
    expect(probe.nextDueAt!.getTime()).toBeGreaterThan(at(HOUR).getTime());
    expect(probe.nextDueAt!.getTime()).toBeLessThanOrEqual(at(HOUR).getTime() + 5_000);

    await drain(deps(wire.client), at(HOUR + MINUTE));

    expect(wire.sent).toEqual([[first], [second, third]]);
    expect(await estados([second!, third!])).toEqual(["aceptado", "aceptado"]);
  });

  it("a probe refused with the run's code opens its case without an incident, keeps the one alert under its key at every read, and the next held record goes an hour later", async () => {
    const aeat = fakeAeat();
    const { seeded, held, heldKeys } = await brakeHold(aeat, 2);
    const [first, second] = held;
    aeat.reject(heldKeys[0]!, RUN_CODE, `Rechazo ${RUN_CODE}`);
    const key = `fiscal.refusals_repeated:${seeded.sifId}`;
    expect(await refusalAlerts(at(MINUTE))).toEqual([
      { key, params: { codigo: String(RUN_CODE), count: 3 } },
    ]);
    const duringSend: unknown[] = [];
    const wire = recording(aeat.client(), async () => {
      duringSend.push(await refusalAlerts(at(HOUR)));
    });

    await drain(deps(wire.client), at(HOUR));

    expect(wire.sent).toEqual([[first]]);
    expect(duringSend).toEqual([[{ key, params: { codigo: String(RUN_CODE), count: 3 } }]]);
    expect(await envioOf(first!)).toMatchObject({ estado: "rechazado" });
    expect(await envioOf(second!)).toMatchObject({ estado: "detenido" });
    expect((await cases()).map((c) => c.registroId)).toEqual([...seeded.registroIds, first]);
    expect(await incidentCodes()).toEqual([
      "fiscal.registro_rechazado",
      "fiscal.registro_rechazado",
      "fiscal.registro_rechazado",
    ]);
    expect(await refusalAlerts(at(HOUR))).toEqual([
      { key, params: { codigo: String(RUN_CODE), count: 4 } },
    ]);

    await drain(deps(wire.client), at(HOUR + 59 * MINUTE));
    expect(wire.sent).toEqual([[first]]);

    await drain(deps(wire.client), at(2 * HOUR));
    expect(wire.sent).toEqual([[first], [second]]);
  });

  it("a probe refused with another code keeps its incident and case and releases the records behind it", async () => {
    const aeat = fakeAeat();
    const { seeded, held, heldKeys } = await brakeHold(aeat, 3);
    const [first, second, third] = held;
    aeat.reject(heldKeys[0]!, 1200, "Rechazo 1200");
    const wire = recording(aeat.client());

    await drain(deps(wire.client), at(HOUR));

    expect(await envioOf(first!)).toMatchObject({ estado: "rechazado" });
    expect(await estados([second!, third!])).toEqual(["pendiente", "pendiente"]);
    expect((await cases()).map((c) => c.registroId)).toEqual([...seeded.registroIds, first]);
    expect(await incidentCodes()).toEqual([
      "fiscal.registro_rechazado",
      "fiscal.registro_rechazado",
      "fiscal.registro_rechazado",
      "fiscal.registro_rechazado",
    ]);
    expect(await refusalAlerts(at(HOUR))).toEqual([]);

    await drain(deps(wire.client), at(HOUR + MINUTE));
    expect(wire.sent).toEqual([[first], [second, third]]);
    expect(await estados([second!, third!])).toEqual(["aceptado", "aceptado"]);
  });

  it("a probe whose answer is unreadable stays held, raises its unknown-state incident with the envío's CSV, and goes again an hour later", async () => {
    const aeat = fakeAeat();
    const { seeded, held, heldKeys } = await brakeHold(aeat, 2);
    const [first, second] = held;
    const key = `fiscal.refusals_repeated:${seeded.sifId}`;
    aeat.reject(heldKeys[0]!, RUN_CODE, `Rechazo ${RUN_CODE}`);
    // Accepted beside the probe, so the envío carries a CSV.
    const healthy = await seedSecondChain(suite.db, seeded, 100);
    const real = aeat.client();
    const wire = recording(
      rewritingLines(real, (linea) =>
        linea.RefExterna === first ? { ...linea, EstadoRegistro: undefined } : linea,
      ),
    );

    await drain(deps(wire.client), at(HOUR));

    expect(wire.sent).toEqual([[healthy.registroId, first]]);
    const csv = (await envioOf(healthy.registroId)).csv;
    expect(csv).toEqual(expect.any(String));
    // One attempt for the claim that held it, one for this probe.
    expect(await envioOf(first!)).toMatchObject({
      estado: "detenido",
      enviado_en: at(HOUR).toISOString(),
      intentos: 2,
    });
    expect(await ackOf(first!)).toBe("halted");
    expect(await envioOf(second!)).toMatchObject({ estado: "detenido" });
    const { rows } = await suite.db.execute<{ params: string }>(sql`
      select params from incidents where code = 'fiscal.estado_desconocido'
    `);
    expect(rows.map((r) => JSON.parse(r.params) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ registroId: first, csv }),
    ]);
    expect((await refusalAlerts(at(HOUR))).map((a) => a.key)).toEqual([key]);

    const later = recording(real);
    for (const minutes of [61, 90, 119]) {
      await drain(deps(later.client), at(minutes * MINUTE));
      expect(later.sent).toEqual([]);
      expect((await refusalAlerts(at(minutes * MINUTE))).map((a) => a.key)).toEqual([key]);
    }

    await drain(deps(later.client), at(2 * HOUR));

    expect(later.sent).toEqual([[first]]);
    expect(await envioOf(first!)).toMatchObject({ estado: "rechazado" });
    expect(await refusalAlerts(at(2 * HOUR))).toEqual([
      { key, params: { codigo: String(RUN_CODE), count: 4 } },
    ]);
  });

  it("a held probe whose unreadable answer is accepted an hour later releases the records behind it", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 2);
    const [first, second] = held;
    const real = aeat.client();
    await drain(deps(unreadable(real)), at(HOUR));
    const wire = recording(real);

    await drain(deps(wire.client), at(2 * HOUR));

    expect(wire.sent).toEqual([[first]]);
    expect(await envioOf(first!)).toMatchObject({ estado: "aceptado" });
    expect(await envioOf(second!)).toMatchObject({ estado: "pendiente" });
  });

  it("a probe whose send fails in transport stays held, not pending, and goes again an hour later", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 1);
    const [first] = held;
    const real = aeat.client();

    const failed = await drain(deps(failingSubmit(real)), at(HOUR));

    expect(failed.batchesSent).toBe(0);
    expect(await envioOf(first!)).toMatchObject({
      estado: "detenido",
      enviado_en: at(HOUR).toISOString(),
    });
    const wire = recording(real);
    await drain(deps(wire.client), at(HOUR + 5 * MINUTE));
    await drain(deps(wire.client), at(HOUR + 59 * MINUTE));
    expect(wire.sent).toEqual([]);

    await drain(deps(wire.client), at(2 * HOUR));
    expect(wire.sent).toEqual([[first]]);
  });

  it("reports the next hourly probe, and nothing earlier, as the next due time after a probe's send fails in transport", async () => {
    const aeat = fakeAeat();
    await brakeHold(aeat, 1);

    const failed = await drain(deps(failingSubmit(aeat.client())), at(HOUR));

    expect(failed.nextDueAt).toEqual(at(2 * HOUR));
  });

  it("a crash after the probe's claim does not resend it on restart, while an ordinary claim from the same envío is resent at once", async () => {
    const aeat = fakeAeat();
    const { seeded, held } = await brakeHold(aeat, 1);
    const [first] = held;
    const ordinary = await seedSecondChain(suite.db, seeded, 100);
    const real = aeat.client();
    // The crash: the send fails, and so does the transaction that would back the envío off.
    await suite.db.execute(sql`
      create trigger test_refuse_backoff before update of estado on envios
      when old.estado = 'enviando' and new.estado = 'pendiente'
      begin select raise(abort, 'refused by test'); end
    `);
    try {
      const crashed = await drain(deps(failingSubmit(real)), at(HOUR));
      expect(crashed.skipped).toHaveLength(1);
    } finally {
      await suite.db.execute(sql`drop trigger test_refuse_backoff`);
    }
    expect(await envioOf(ordinary.registroId)).toMatchObject({ estado: "enviando" });
    expect(await envioOf(first!)).toMatchObject({ estado: "detenido" });

    await resetInFlightClaims(suite.db, at(HOUR));
    const wire = recording(real);
    await drain(deps(wire.client), at(HOUR));

    expect(wire.sent).toEqual([[ordinary.registroId]]);

    await drain(deps(wire.client), at(2 * HOUR));
    expect(wire.sent).toEqual([[ordinary.registroId], [first]]);
  });

  it("released records meet the brake again: a first claim after the release reads as never sent", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    for (const key of seeded.facturaKeys) aeat.reject(key, RUN_CODE, `Rechazo ${RUN_CODE}`);
    const small = (client: VerifactuClient) => deps(client, { maxRegistrosPorEnvio: 4 });
    await drain(small(aeat.client()), T0);
    const held: { registroId: string; facturaKey: string }[] = [];
    for (let secuencia = 4; secuencia <= 9; secuencia += 1) {
      held.push(await appendPendingAlta(suite.db, seeded, secuencia));
    }
    await drain(small(aeat.client()), T);
    await drain(small(aeat.client()), at(MINUTE));
    const ids = held.map((h) => h.registroId);
    expect(await estados(ids)).toEqual(ids.map(() => "detenido"));
    for (const h of held.slice(0, 5)) aeat.reject(h.facturaKey, 1200, "Rechazo 1200");
    const wire = recording(aeat.client());

    await drain(small(wire.client), at(HOUR));

    expect(wire.sent).toEqual([[ids[0]], ids.slice(1, 5)]);
    expect(await estados(ids.slice(0, 5))).toEqual(ids.slice(0, 5).map(() => "rechazado"));
    expect(await envioOf(ids[5]!)).toMatchObject({ estado: "pendiente", intentos: 0 });

    await drain(small(wire.client), at(HOUR + MINUTE));

    expect(wire.sent).toHaveLength(2);
    expect(await envioOf(ids[5]!)).toMatchObject({ estado: "detenido", intentos: 1 });
  });

  it("a chain made releasable outside a reply is released, and sent, at the start of the next pass", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 2);
    const [first, second] = held;
    // Stands in for any path that settles the first held record without a reply of this drain.
    await suite.db.execute(sql`
      update envios set estado = 'aceptado' where registro_id = ${first!}
    `);
    const wire = recording(aeat.client());

    const result = await drain(deps(wire.client), at(MINUTE));

    expect(result.tenantsWithWork).toBe(1);
    expect(wire.sent).toEqual([[second]]);
  });

  it("keeps holding the records behind a record whose answer is still awaited", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 2);
    const [first, second] = held;
    // Stands in for a record before the held ones whose answer has not been read yet.
    await suite.db.execute(sql`
      update envios set estado = 'pendiente', proximo_intento_en = ${at(2 * HOUR).toISOString()}
      where registro_id = ${first!}
    `);

    await drain(deps(aeat.client()), at(MINUTE));

    expect(await envioOf(second!)).toMatchObject({ estado: "detenido" });
  });

  it("never puts a probe beside a full envío", async () => {
    const aeat = fakeAeat();
    const { seeded, held } = await brakeHold(aeat, 1);
    const healthy = await seedSecondChain(suite.db, seeded, 100);
    const wire = recording(aeat.client());

    await drain(deps(wire.client, { maxRegistrosPorEnvio: 1 }), at(HOUR));

    expect(wire.sent).toEqual([[healthy.registroId], held]);
  });

  it("does not release a held record behind a lone refusal with no run before it", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[2]!, RUN_CODE, "Rechazo");
    await drain(deps(aeat.client()), T0);
    const older = await appendPendingAlta(suite.db, seeded, 4);
    await suite.db.execute(sql`
      update envios set estado = 'detenido', incidencia = true, intentos = 1,
        enviado_en = ${T.toISOString()}
      where registro_id = ${older.registroId}
    `);
    const wire = recording(aeat.client());

    await drain(deps(wire.client), at(MINUTE));
    await drain(deps(wire.client), at(2 * HOUR));

    expect(wire.sent).toEqual([]);
    expect(await envioOf(older.registroId)).toMatchObject({ estado: "detenido" });
  });

  it("releases the held records only up to the first one that has a case of its own", async () => {
    const aeat = fakeAeat();
    const { held } = await brakeHold(aeat, 3);
    const [first, second, third] = held;
    await withTransaction(suite.db, (tx) =>
      openFilingCase(tx, {
        registroId: third!,
        cause: "fiscal.huella_divergente",
        evidence: { codigo: 3000, mensaje: null, csv: null },
        now: at(MINUTE),
      }),
    );
    const wire = recording(aeat.client());

    await drain(deps(wire.client), at(HOUR));
    await drain(deps(wire.client), at(HOUR + MINUTE));

    expect(wire.sent).toEqual([[first], [second]]);
    expect(await envioOf(third!)).toMatchObject({ estado: "detenido" });
  });

  it("waits for an earlier record of the chain whose answer is still awaited, whether it is waiting to retry or claimed in the same pass", async () => {
    const aeat = fakeAeat();
    const seeded = await seedPendingEnvios(suite.db, { count: 4 });
    const [awaited] = seeded.registroIds;
    for (const key of seeded.facturaKeys.slice(1)) aeat.reject(key, RUN_CODE, "Rechazo");
    const wire = recording(
      rewritingLines(aeat.client(), (linea) =>
        linea.RefExterna === awaited
          ? { IDFactura: linea.IDFactura, RefExterna: linea.RefExterna, EstadoRegistro: undefined }
          : linea,
      ),
    );
    await drain(deps(wire.client), T0);
    const held = await appendPendingAlta(suite.db, seeded, 5);
    // The unreadable record's retries, each doubling the wait: 00:02, 00:04, 00:08, 00:16, 00:32.
    for (const minute of [2, 4, 8, 16, 32]) {
      await drain(deps(wire.client), new Date(Date.UTC(2026, 6, 21, 0, minute)));
    }
    expect(await envioOf(held.registroId)).toMatchObject({ estado: "detenido" });
    expect(await envioOf(awaited!)).toMatchObject({
      estado: "pendiente",
      proximo_intento_en: "2026-07-21T01:04:00.000Z",
    });
    const before = wire.sent.length;

    await drain(deps(wire.client), at(HOUR));
    expect(wire.sent).toHaveLength(before);

    await drain(deps(wire.client), new Date("2026-07-21T01:04:00Z"));
    expect(wire.sent.slice(before)).toEqual([[awaited]]);
  });

  describe("controls: never probed, never released", () => {
    it("a chain whose earliest held record has a case of its own after the run is never probed", async () => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 4 });
      for (const key of seeded.facturaKeys.slice(0, 3)) aeat.reject(key, RUN_CODE, "Rechazo");
      const conflicting = seeded.registroIds[3]!;
      await collideAtAeat(suite.db, aeat, seeded, conflicting);
      await drain(deps(aeat.client()), T0);
      expect(await envioOf(conflicting)).toMatchObject({ estado: "detenido" });
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(2 * HOUR));

      expect(wire.sent).toEqual([]);
    });

    it("a record held behind a conflict whose own envío also carried a same-code run is never probed", async () => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 4 });
      const [conflicting] = seeded.registroIds;
      await collideAtAeat(suite.db, aeat, seeded, conflicting!);
      for (const key of seeded.facturaKeys.slice(1)) aeat.reject(key, RUN_CODE, "Rechazo");
      await drain(deps(aeat.client()), T0);
      expect(await estados(seeded.registroIds)).toEqual([
        "detenido",
        "rechazado",
        "rechazado",
        "rechazado",
      ]);
      const behind = await appendPendingAlta(suite.db, seeded, 5);
      await drain(deps(aeat.client()), T);
      expect(await envioOf(behind.registroId)).toMatchObject({ estado: "detenido" });
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(2 * HOUR));

      expect(wire.sent).toEqual([]);
    });

    it("a probe that meets a conflict is never probed again", async () => {
      const aeat = fakeAeat();
      const { seeded, held } = await brakeHold(aeat, 2);
      const [first, second] = held;
      await collideAtAeat(suite.db, aeat, seeded, first!);
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(HOUR));
      expect(wire.sent).toEqual([[first]]);
      expect(await envioOf(first!)).toMatchObject({ estado: "detenido" });
      expect((await cases()).find((c) => c.registroId === first)?.cause).toBe(
        "fiscal.huella_divergente",
      );

      await drain(deps(wire.client), at(3 * HOUR));
      expect(wire.sent).toEqual([[first]]);
      expect(await envioOf(second!)).toMatchObject({ estado: "detenido" });
    });

    it("a released record that then meets a conflict stays held", async () => {
      const aeat = fakeAeat();
      const { seeded, held, heldKeys } = await brakeHold(aeat, 2);
      const [first, second] = held;
      aeat.reject(heldKeys[0]!, 1200, "Rechazo 1200");
      await collideAtAeat(suite.db, aeat, seeded, second!);
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(HOUR));
      await drain(deps(wire.client), at(HOUR + MINUTE));

      expect(wire.sent).toEqual([[first], [second]]);
      expect(await envioOf(second!)).toMatchObject({ estado: "detenido" });

      await drain(deps(wire.client), at(3 * HOUR));
      expect(wire.sent).toHaveLength(2);
    });

    it("a chain whose earliest held record is a cancellation of a refused original is never probed", async () => {
      const aeat = fakeAeat();
      const seeded = await seedPendingEnvios(suite.db, { count: 3 });
      for (const key of seeded.facturaKeys) aeat.reject(key, RUN_CODE, "Rechazo");
      await drain(deps(aeat.client()), T0);
      const cancellation = await appendCancellation(suite.db, seeded, seeded.registroIds[2]!, 4);
      await drain(deps(aeat.client()), T);
      expect(await envioOf(cancellation)).toMatchObject({ estado: "detenido" });
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(2 * HOUR));

      expect(wire.sent).toEqual([]);
    });

    it("a cancellation of the refused probe, held behind it, is not released", async () => {
      const aeat = fakeAeat();
      const { seeded, held, heldKeys } = await brakeHold(aeat, 1);
      const [first] = held;
      const cancellation = await appendCancellation(suite.db, seeded, first!, 5);
      await drain(deps(aeat.client()), at(MINUTE));
      expect(await envioOf(cancellation)).toMatchObject({ estado: "detenido" });
      aeat.reject(heldKeys[0]!, 1200, "Rechazo 1200");
      const wire = recording(aeat.client());

      await drain(deps(wire.client), at(HOUR));

      expect(wire.sent).toEqual([[first]]);
      expect(await envioOf(cancellation)).toMatchObject({ estado: "detenido" });
      expect(await ackOf(cancellation)).toBe("halted");

      await drain(deps(wire.client), at(3 * HOUR));
      expect(wire.sent).toHaveLength(1);
    });

    it("keeps a healthy chain sending beside a stopped one", async () => {
      const aeat = fakeAeat();
      const { seeded } = await brakeHold(aeat, 1);
      const healthy = await seedSecondChain(suite.db, seeded, 100);
      const wire = recording(aeat.client());

      const result = await drain(deps(wire.client), at(30 * MINUTE));

      expect(wire.sent).toEqual([[healthy.registroId]]);
      expect(result.nextDueAt).toEqual(at(HOUR));
    });

    it("does not send, or count as due work, a probe whose environment disagrees with the host", async () => {
      const aeat = fakeAeat();
      const { held } = await brakeHold(aeat, 1);
      const wire = recording(aeat.client());

      const elsewhere = await drain(
        deps(wire.client, { environment: "preproduction" }),
        at(2 * HOUR),
      );

      expect(wire.sent).toEqual([]);
      expect(elsewhere.tenantsWithWork).toBe(0);
      expect(elsewhere.nextDueAt).toBeNull();
      expect(await incidentCodes()).toEqual([
        "fiscal.registro_rechazado",
        "fiscal.registro_rechazado",
        "fiscal.registro_rechazado",
      ]);

      await drain(deps(wire.client), at(2 * HOUR));
      expect(wire.sent).toEqual([held]);
    });
  });
});
