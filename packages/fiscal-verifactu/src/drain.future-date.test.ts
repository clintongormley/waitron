import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { writeAck } from "./acks.js";
import { BRAKE_PROBE_INTERVAL_MS, DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

// AEAT's 1112 refuses a record dated in the future. A run of them starts no hold, so correctly
// dated records behind it keep filing (A1420, D11); a run of any other code still holds.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const FUTURE_DATE = 1112;
const FIRST_SEND = new Date("2026-07-21T00:00:10Z");
const at = (ms: number) => new Date(FIRST_SEND.getTime() + ms);

function deps(client: VerifactuClient) {
  return {
    db: suite.db,
    resolveClient: staticResolver(client),
    environment: "production",
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  } satisfies DrainDeps;
}

/** Drains at `now` with AEAT's sending wait cleared, so each pass may send. */
async function drainAt(client: VerifactuClient, now: Date) {
  await suite.db.execute(sql`delete from verifactu_sending_state`);
  return drain(deps(client), now);
}

async function envioOf(id: string) {
  const { rows } = await suite.db.execute<{ estado: string; intentos: number }>(
    sql`select estado, intentos from verifactu_submissions where registro_id = ${id}`,
  );
  return rows[0]!;
}

async function refusalsRepeated(now: Date) {
  return withTransaction(suite.db, async (tx) =>
    (await fiscalSubmissionSource.read({ tx, now })).filter(
      (alert) => alert.code === "fiscal.refusals_repeated",
    ),
  );
}

async function casesAndIncidents() {
  const cases = await suite.db.execute<{ registro_id: string; cause: string }>(
    sql`select registro_id, cause from filing_cases order by registro_id`,
  );
  const incidents = await suite.db.execute<{ params: string }>(
    sql`select params from incidents where code = 'fiscal.registro_rechazado'`,
  );
  return {
    cases: cases.rows,
    incidentRecords: incidents.rows
      .map((row) => (JSON.parse(row.params) as { registroId: string }).registroId)
      .sort(),
  };
}

/** Three records refused with `code` in one pass, then a correctly dated fourth sent after them. */
async function runThenFourth(code: number) {
  const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) fake.reject(key, code, "Rechazo");
  await drainAt(fake.client(), FIRST_SEND);
  const fourth = (await appendPendingAlta(suite.db, seeded, 4)).registroId;
  const result = await drainAt(fake.client(), at(10_000));
  return { fake, seeded, fourth, result };
}

describe("drain — a run of future-date refusals (1112)", () => {
  it("sends and files the record after three future-date refusals, with a case and an alert for each refusal and no hold", async () => {
    const { seeded, fourth, result } = await runThenFourth(FUTURE_DATE);

    expect(result.recordsSubmitted).toBe(1);
    expect(await envioOf(fourth)).toEqual({ estado: "aceptado", intentos: 1 });
    expect(await refusalsRepeated(at(10_000))).toEqual([]);
    const refused = [...seeded.registroIds].sort();
    expect(await casesAndIncidents()).toEqual({
      cases: refused.map((registro_id) => ({ registro_id, cause: "fiscal.registro_rechazado" })),
      incidentRecords: refused,
    });
  });

  it("holds the record after three refusals of any other code, and alerts (control)", async () => {
    const { fourth, result } = await runThenFourth(1100);

    expect(result.recordsSubmitted).toBe(0);
    expect((await envioOf(fourth)).estado).toBe("detenido");
    expect((await refusalsRepeated(at(10_000))).map((alert) => alert.code)).toEqual([
      "fiscal.refusals_repeated",
    ]);
  });

  it("sends each later future-dated record once, and sends none of them again an hour on", async () => {
    const { fake, seeded } = await runThenFourth(FUTURE_DATE);
    const later = [];
    for (const secuencia of [5, 6]) {
      const appended = await appendPendingAlta(suite.db, seeded, secuencia);
      fake.reject(appended.facturaKey, FUTURE_DATE, "Rechazo");
      later.push(appended.registroId);
    }

    const sent = await drainAt(fake.client(), at(20_000));
    const hourOn = await drainAt(fake.client(), at(20_000 + BRAKE_PROBE_INTERVAL_MS + 1));

    expect(sent.recordsSubmitted).toBe(2);
    expect(hourOn.recordsSubmitted).toBe(0);
    for (const id of [...seeded.registroIds, ...later]) {
      expect(await envioOf(id)).toEqual({ estado: "rechazado", intentos: 1 });
    }
  });

  it("still retries hourly and releases a chain held behind future-date refusals before the change", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    for (const key of seeded.facturaKeys) fake.reject(key, FUTURE_DATE, "Rechazo");
    await drainAt(fake.client(), FIRST_SEND);
    // The fourth as the claim hold left it before 1112 was exempt: claimed once, then held.
    const fourth = (await appendPendingAlta(suite.db, seeded, 4)).registroId;
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`
        update verifactu_submissions set estado = 'detenido', incidencia = true, intentos = 1,
          enviado_en = ${at(10_000).toISOString()}
        where registro_id = ${fourth}
      `);
      await writeAck(tx, fourth, at(10_000));
    });
    const fifth = (await appendPendingAlta(suite.db, seeded, 5)).registroId;

    const beforeRelease = await drainAt(fake.client(), at(20_000));

    expect(beforeRelease.recordsSubmitted).toBe(0);
    expect((await envioOf(fifth)).estado).toBe("detenido");

    const probe = await drainAt(fake.client(), at(10_000 + BRAKE_PROBE_INTERVAL_MS + 1));
    const released = await drainAt(fake.client(), at(20_000 + BRAKE_PROBE_INTERVAL_MS));

    expect(probe.recordsSubmitted + released.recordsSubmitted).toBe(2);
    expect(await envioOf(fourth)).toEqual({ estado: "aceptado", intentos: 2 });
    expect((await envioOf(fifth)).estado).toBe("aceptado");
  });
});
