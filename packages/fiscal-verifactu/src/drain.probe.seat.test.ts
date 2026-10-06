import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RespuestaLinea, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";
import { listFilingCases } from "./filing-cases.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const T0 = new Date("2026-07-21T00:01:00Z");
const T = new Date("2026-07-21T00:02:00Z");
const PROBE_AT = new Date("2026-07-21T01:02:00Z");
const RUN_CODE = 1100;
const SEAT_CSV = "CSV-SEAT-0001";

const deps = (client: VerifactuClient): DrainDeps => ({
  db: suite.db,
  resolveClient: staticResolver(client),
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
});

/**
 * A client seat that answers every record of an envío with the line `shape` gives it, built as the
 * `RespuestaSuministro` object `@waitron/verifactu`'s parser returns, with no SOAP in between.
 */
function seat(
  shape: Pick<
    RespuestaLinea,
    "EstadoRegistro" | "CodigoErrorRegistro" | "DescripcionErrorRegistro"
  >,
): { client: VerifactuClient; sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    client: {
      submit: (_cabecera, registros) => {
        const altas = registros.map((r) => {
          if (!("RegistroAlta" in r)) throw new Error("this seat answers altas only");
          return r.RegistroAlta;
        });
        sent.push(altas.map((alta) => alta.RefExterna!));
        return Promise.resolve({
          CSV: SEAT_CSV,
          EstadoEnvio: "ParcialmenteCorrecto",
          TiempoEsperaEnvio: 5,
          TiempoEsperaEnvioRaw: "5",
          RespuestaLinea: altas.map((alta) => ({
            IDFactura: alta.IDFactura,
            RefExterna: alta.RefExterna,
            ...shape,
          })),
        });
      },
      consultar: () => Promise.reject(new Error("this seat answers no lookup")),
    },
  };
}

async function estadoOf(registroId: string): Promise<{ estado: string; csv: string | null }> {
  const { rows } = await suite.db.execute<{ estado: string; csv: string | null }>(sql`
    select estado, csv from envios where registro_id = ${registroId}
  `);
  return rows[0]!;
}

async function incidentCodes(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ code: string }>(
    sql`select code from incidents order by detected_at, code`,
  );
  return rows.map((r) => r.code);
}

async function refusalAlerts(now: Date) {
  const alerts = await withTransaction(suite.db, (tx) => fiscalSubmissionSource.read({ tx, now }));
  return alerts.filter((a) => a.code === "fiscal.refusals_repeated").map((a) => a.params);
}

/** The run of three same-code refusals through the fake AEAT, then two records held behind it. */
async function brakeHold(): Promise<{ first: string; second: string }> {
  const aeat = createFakeAeat({ serverNow: SERVER_NOW, tiempoEsperaInicial: 5 });
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) aeat.reject(key, RUN_CODE, `Rechazo ${RUN_CODE}`);
  await drain(deps(aeat.client()), T0);
  const first = (await appendPendingAlta(suite.db, seeded, 4)).registroId;
  const second = (await appendPendingAlta(suite.db, seeded, 5)).registroId;
  await drain(deps(aeat.client()), T);
  return { first, second };
}

const RUN_REFUSALS = [
  "fiscal.registro_rechazado",
  "fiscal.registro_rechazado",
  "fiscal.registro_rechazado",
];

describe("drain — the hourly probe's answers from a hand-built client seat (no SOAP)", () => {
  it("a refusal with the run's code keeps the chain held and records no incident", async () => {
    const { first, second } = await brakeHold();
    const wire = seat({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: RUN_CODE,
      DescripcionErrorRegistro: "Rechazo",
    });

    await drain(deps(wire.client), PROBE_AT);

    expect(wire.sent).toEqual([[first]]);
    expect(await estadoOf(first)).toEqual({ estado: "rechazado", csv: SEAT_CSV });
    expect((await estadoOf(second)).estado).toBe("detenido");
    expect(await incidentCodes()).toEqual(RUN_REFUSALS);
    expect(await refusalAlerts(PROBE_AT)).toEqual([{ codigo: String(RUN_CODE), count: 4 }]);
    const cases = await withTransaction(suite.db, (tx) => listFilingCases(tx));
    expect(cases.find((c) => c.registroId === first)?.evidence).toEqual({
      codigo: RUN_CODE,
      mensaje: "Rechazo",
      csv: SEAT_CSV,
    });
  });

  it("a refusal with another code records its incident and releases the record behind it", async () => {
    const { first, second } = await brakeHold();
    const wire = seat({
      EstadoRegistro: "Incorrecto",
      CodigoErrorRegistro: 1200,
      DescripcionErrorRegistro: "Otro",
    });

    await drain(deps(wire.client), PROBE_AT);

    expect(await estadoOf(first)).toEqual({ estado: "rechazado", csv: SEAT_CSV });
    expect((await estadoOf(second)).estado).toBe("pendiente");
    expect(await incidentCodes()).toEqual([...RUN_REFUSALS, "fiscal.registro_rechazado"]);
    expect(await refusalAlerts(PROBE_AT)).toEqual([]);
  });

  it("an accept settles the probe with its CSV and releases the record behind it", async () => {
    const { first, second } = await brakeHold();
    const wire = seat({ EstadoRegistro: "Correcto" });

    await drain(deps(wire.client), PROBE_AT);

    expect(await estadoOf(first)).toEqual({ estado: "aceptado", csv: SEAT_CSV });
    expect((await estadoOf(second)).estado).toBe("pendiente");
    expect(await refusalAlerts(PROBE_AT)).toEqual([]);
  });

  it("an unreadable line keeps the probe held and records the unknown state with the CSV", async () => {
    const { first, second } = await brakeHold();
    const wire = seat({ EstadoRegistro: undefined });

    await drain(deps(wire.client), PROBE_AT);

    expect(await estadoOf(first)).toEqual({ estado: "detenido", csv: null });
    expect((await estadoOf(second)).estado).toBe("detenido");
    const { rows } = await suite.db.execute<{ params: string }>(sql`
      select params from incidents where code = 'fiscal.estado_desconocido'
    `);
    expect(rows.map((r) => JSON.parse(r.params) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ registroId: first, csv: SEAT_CSV }),
    ]);
    expect(await refusalAlerts(PROBE_AT)).toEqual([{ codigo: String(RUN_CODE), count: 3 }]);
  });
});
