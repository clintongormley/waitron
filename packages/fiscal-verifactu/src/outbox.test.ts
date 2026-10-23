import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { readOutbox, retryWaitingRecords } from "./outbox.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

function harness() {
  const authority = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const state = { down: false };
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      if (state.down) throw new Error("network down");
      return authority.fetch(input, init);
    },
  });
  const deps = {
    db: suite.db,
    environment: "production" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: async () => client,
  };
  return { state, deps };
}

const read = () => withTransaction(suite.db, (tx) => readOutbox(tx));
const press = (now: Date) => withTransaction(suite.db, (tx) => retryWaitingRecords(tx, now));

async function envioRow(registroId: string) {
  const rows = await suite.db.execute<Record<string, unknown>>(
    sql`select * from envios where registro_id = ${registroId}`,
  );
  return rows.rows[0]!;
}

async function allEnvios() {
  return (
    await suite.db.execute<Record<string, unknown>>(sql`select * from envios order by registro_id`)
  ).rows;
}

async function flujo() {
  return (await suite.db.execute<Record<string, unknown>>(sql`select * from envio_flujo`)).rows;
}

describe("readOutbox", () => {
  it("reads nothing on a box that has sent nothing", async () => {
    expect(await read()).toEqual({ lastAcceptedAt: null, waiting: 0 });
  });

  it("reads the time of the latest acceptance", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const { deps } = harness();
    const first = new Date("2026-07-21T00:01:00Z");
    expect((await drain(deps, first)).recordsAccepted).toBe(1);
    expect(await read()).toEqual({ lastAcceptedAt: first.toISOString(), waiting: 0 });

    await appendPendingAlta(suite.db, seeded, 2);
    const later = new Date("2026-07-21T01:00:00Z");
    expect((await drain(deps, later)).recordsAccepted).toBe(1);
    expect(await read()).toEqual({ lastAcceptedAt: later.toISOString(), waiting: 0 });
  });

  it("counts an acceptance with errors", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1, futureDated: true });
    const { deps } = harness();
    const at = new Date("2026-07-21T00:01:00Z");
    await drain(deps, at);
    expect((await envioRow(seeded.registroIds[0]!)).estado).toBe("aceptado_con_errores");
    expect((await read()).lastAcceptedAt).toBe(at.toISOString());
  });
});

describe("retryWaitingRecords", () => {
  it("ends the later waits of the records a failed pass backed off, and changes nothing else", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const { state, deps } = harness();
    state.down = true;
    await drain(deps, new Date("2026-07-21T00:01:00Z"));
    expect(await read()).toEqual({ lastAcceptedAt: null, waiting: 3 });

    const now = new Date("2026-07-21T00:01:30Z");
    const before = await allEnvios();
    const flujoBefore = await flujo();
    for (const row of before) expect(String(row.proximo_intento_en) > now.toISOString()).toBe(true);

    expect(await press(now)).toEqual({ waiting: 3, cleared: 3 });

    const after = await allEnvios();
    expect(after).toEqual(before.map((row) => ({ ...row, proximo_intento_en: now.toISOString() })));
    expect(after.map((row) => row.registro_id)).toEqual([...seeded.registroIds].sort());
    expect(await flujo()).toEqual(flujoBefore);

    expect(await press(now)).toEqual({ waiting: 3, cleared: 0 });
  });

  it("counts the records added after a failure and clears only the backed-off one", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const { state, deps } = harness();
    state.down = true;
    await drain(deps, new Date("2026-07-21T00:01:00Z"));
    await appendPendingAlta(suite.db, seeded, 2);
    await appendPendingAlta(suite.db, seeded, 3);

    expect((await read()).waiting).toBe(3);
    expect(await press(new Date("2026-07-21T00:01:30Z"))).toEqual({ waiting: 3, cleared: 1 });
  });

  it("counts a record already due on a chain with no failure, and does not change it", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const before = await envioRow(seeded.registroIds[0]!);
    const now = new Date("2026-07-21T00:05:00Z");
    expect((await read()).waiting).toBe(1);
    expect(await press(now)).toEqual({ waiting: 1, cleared: 0 });
    expect(await envioRow(seeded.registroIds[0]!)).toEqual(before);
  });

  it("leaves alone every row outside the set, and compares chains by their own sif", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 5 });
    const [aceptado, enviando, retenido, detenido, behind] = seeded.registroIds as [
      string,
      string,
      string,
      string,
      string,
    ];
    const later = "2026-07-21T05:00:00.000Z";
    await suite.db.execute(sql`
      update envios set estado = 'aceptado', confirmado_en = '2026-07-21T00:00:30.000Z',
        proximo_intento_en = ${later}
      where registro_id = ${aceptado}
    `);
    await suite.db.execute(sql`
      update envios set estado = 'enviando', enviado_en = '2026-07-21T00:00:40.000Z',
        proximo_intento_en = ${later}
      where registro_id = ${enviando}
    `);
    await suite.db.execute(sql`
      update envios set estado = 'retenido', proximo_intento_en = ${later}
      where registro_id = ${retenido}
    `);
    await suite.db.execute(sql`
      update envios set estado = 'detenido', incidencia = 1, enviado_en = '2026-07-21T00:00:50.000Z',
        proximo_intento_en = ${later}
      where registro_id = ${detenido}
    `);
    await suite.db.execute(sql`
      update envios set intentos = 1, incidencia = 1, proximo_intento_en = ${later}
      where registro_id = ${behind}
    `);
    const other = await seedSecondChain(suite.db, seeded, 6);
    await suite.db.execute(sql`
      update envios set intentos = 1, incidencia = 1, proximo_intento_en = ${later}
      where registro_id = ${other.registroId}
    `);

    const untouched = [aceptado, enviando, retenido, detenido, behind];
    const before = [];
    for (const id of untouched) before.push(await envioRow(id));
    const otherBefore = await envioRow(other.registroId);
    const now = new Date("2026-07-21T00:02:00Z");

    expect((await read()).waiting).toBe(1);
    expect(await press(now)).toEqual({ waiting: 1, cleared: 1 });

    const after = [];
    for (const id of untouched) after.push(await envioRow(id));
    expect(after).toEqual(before);
    expect(await envioRow(other.registroId)).toEqual({
      ...otherBefore,
      proximo_intento_en: now.toISOString(),
    });
  });

  it("counts and clears a waiting record earlier on its chain than a held one", async () => {
    // A reconcile resubmission can put a record back to `pendiente` before a later held one.
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const [earlier, detenido, behind] = seeded.registroIds as [string, string, string];
    const later = "2026-07-21T05:00:00.000Z";
    await suite.db.execute(sql`
      update envios set intentos = 1, incidencia = 1, proximo_intento_en = ${later}
      where registro_id in (${earlier}, ${behind})
    `);
    await suite.db.execute(sql`
      update envios set estado = 'detenido', incidencia = 1, enviado_en = '2026-07-21T00:00:50.000Z',
        proximo_intento_en = ${later}
      where registro_id = ${detenido}
    `);
    const behindBefore = await envioRow(behind);
    const earlierBefore = await envioRow(earlier);
    const now = new Date("2026-07-21T00:02:00Z");

    expect((await read()).waiting).toBe(1);
    expect(await press(now)).toEqual({ waiting: 1, cleared: 1 });

    expect(await envioRow(earlier)).toEqual({
      ...earlierBefore,
      proximo_intento_en: now.toISOString(),
    });
    expect(await envioRow(behind)).toEqual(behindBefore);
  });
});
