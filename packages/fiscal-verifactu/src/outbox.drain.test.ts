import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { retryWaitingRecords } from "./outbox.js";
import { FISCAL_SLOT } from "./slot.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const at = (time: string) => new Date(`2026-07-21T${time}Z`);

function harness(options: { maxRegistrosPorEnvio?: number } = {}) {
  const authority = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const state: {
    submits: number;
    down: boolean;
    loseReply: boolean;
    gate: Promise<void> | null;
    entered: () => void;
  } = { submits: 0, down: false, loseReply: false, gate: null, entered: () => {} };
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      if (String(init?.body).includes("RegFactuSistemaFacturacion")) state.submits += 1;
      if (state.gate !== null) {
        const gate = state.gate;
        state.gate = null;
        state.entered();
        await gate;
      }
      if (state.down) throw new Error("network down");
      const response = await authority.fetch(input, init);
      if (state.loseReply) throw new Error("network down");
      return response;
    },
  });
  const deps = {
    db: suite.db,
    environment: "production" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: async () => client,
    ...options,
  };
  return { authority, state, deps };
}

const press = (now: Date) => withTransaction(suite.db, (tx) => retryWaitingRecords(tx, now));

async function envioRow(registroId: string) {
  const rows = await suite.db.execute<Record<string, unknown>>(
    sql`select * from envios where registro_id = ${registroId}`,
  );
  return rows.rows[0]!;
}

async function flujo() {
  return (await suite.db.execute<Record<string, unknown>>(sql`select * from envio_flujo`)).rows;
}

/** Three records, two failed sends: each record backs off an hour (to 01:02:01) while AEAT's
 * wait ends at 00:03:01. */
async function failedTwiceWithAnHoursBackOff() {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const h = harness();
  h.state.down = true;
  await drain(h.deps, at("00:01:00"));
  await suite.db.execute(sql`update envios set intentos = 6`);
  await drain(h.deps, at("00:02:01"));
  h.state.down = false;
  for (const id of seeded.registroIds) {
    expect((await envioRow(id)).proximo_intento_en).toBe(at("01:02:01").toISOString());
  }
  return { seeded, ...h };
}

describe("the fiscal slot's outbox seat", () => {
  it("reads an empty outbox through the module's contribution", async () => {
    const read = FISCAL_SLOT.outbox!.read;
    expect(await withTransaction(suite.db, (tx) => read(tx))).toEqual({
      lastAcceptedAt: null,
      waiting: 0,
    });
  });
});

describe("the drain after a press", () => {
  it("does not send before AEAT's wait, and sends once it has passed", async () => {
    const { state, deps } = await failedTwiceWithAnHoursBackOff();
    const flujoBefore = await flujo();
    expect(await press(at("00:02:30"))).toEqual({ waiting: 3, cleared: 3 });
    expect(await flujo()).toEqual(flujoBefore);

    const submitsBefore = state.submits;
    const early = await drain(deps, at("00:02:31"));
    expect(early.batchesSent).toBe(0);
    expect(state.submits).toBe(submitsBefore);
    expect(early.nextDueAt).toEqual(at("00:03:01"));

    const due = await drain(deps, at("00:03:02"));
    expect(state.submits).toBe(submitsBefore + 1);
    expect(due.recordsAccepted).toBe(3);
  });

  it("control: the same history without the press sends nothing after AEAT's wait", async () => {
    const { state, deps } = await failedTwiceWithAnHoursBackOff();
    const submitsBefore = state.submits;
    await drain(deps, at("00:02:31"));
    const pass = await drain(deps, at("00:03:02"));
    expect(pass.batchesSent).toBe(0);
    expect(state.submits).toBe(submitsBefore);
  });

  it("sends the records queued behind a backed-off one with it", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const { state, deps } = harness();
    state.down = true;
    await drain(deps, at("00:01:00"));
    await suite.db.execute(sql`update envios set intentos = 6`);
    await drain(deps, at("00:02:01"));
    state.down = false;
    await appendPendingAlta(suite.db, seeded, 2);
    await appendPendingAlta(suite.db, seeded, 3);

    expect(await press(at("00:02:30"))).toEqual({ waiting: 3, cleared: 1 });
    const submitsBefore = state.submits;
    const pass = await drain(deps, at("00:03:02"));
    expect(state.submits).toBe(submitsBefore + 1);
    expect(pass.recordsAccepted).toBe(3);
  });

  it.each([true, false])(
    "with the batch cap at 2, a press=%s before AEAT's wait sends a full batch by AEAT's rule",
    async (pressed) => {
      const seeded = await seedPendingEnvios(suite.db, { count: 3 });
      const { state, deps } = harness({ maxRegistrosPorEnvio: 2 });
      state.down = true;
      await drain(deps, at("00:01:00"));
      state.down = false;
      if (pressed) expect(await press(at("00:01:10"))).toEqual({ waiting: 3, cleared: 2 });

      const submitsBefore = state.submits;
      const pass = await drain(deps, at("00:01:11"));
      if (pressed) {
        expect(pass.batchesSent).toBe(1);
        expect(pass.recordsSubmitted).toBe(2);
        expect(state.submits).toBe(submitsBefore + 1);
        const estados = [];
        for (const id of seeded.registroIds) estados.push((await envioRow(id)).estado);
        expect(estados.filter((estado) => estado === "aceptado")).toHaveLength(2);
        expect(estados.filter((estado) => estado === "pendiente")).toHaveLength(1);
      } else {
        expect(pass.batchesSent).toBe(0);
        expect(state.submits).toBe(submitsBefore);
      }
    },
  );

  it("leaves a held chain held, and its hourly retry still goes", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const { authority, state, deps } = harness();
    for (const key of seeded.facturaKeys) authority.reject(key, 1100, "Invalid test record");
    await drain(deps, at("00:01:00"));
    const fourth = await appendPendingAlta(suite.db, seeded, 4);
    await drain(deps, at("00:02:00"));
    expect((await envioRow(fourth.registroId)).estado).toBe("detenido");
    const fifth = await appendPendingAlta(suite.db, seeded, 5);
    const fifthWait = at("01:00:00").toISOString();
    await suite.db.execute(sql`
      update envios set proximo_intento_en = ${fifthWait}, intentos = 2
      where registro_id = ${fifth.registroId}
    `);

    expect(await press(at("00:03:30"))).toEqual({ waiting: 0, cleared: 0 });
    const submitsBefore = state.submits;
    const pass = await drain(deps, at("00:03:31"));
    expect(pass.batchesSent).toBe(0);
    expect(state.submits).toBe(submitsBefore);
    expect(await envioRow(fourth.registroId)).toMatchObject({
      estado: "detenido",
      enviado_en: at("00:02:00").toISOString(),
    });
    expect((await envioRow(fifth.registroId)).proximo_intento_en).toBe(fifthWait);

    const retry = await drain(deps, at("01:02:00"));
    expect(retry.recordsSubmitted).toBe(1);
    expect(state.submits).toBe(submitsBefore + 1);
  });

  it("leaves a batch being sent alone, and clears its wait once the send has failed", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const { state, deps } = harness();
    state.down = true;
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      state.entered = resolve;
    });
    const pass = drain(deps, at("00:01:00"));
    await entered;

    for (const id of seeded.registroIds) expect((await envioRow(id)).estado).toBe("enviando");
    expect((await press(at("00:01:01"))).cleared).toBe(0);
    expect((await press(at("00:01:01"))).cleared).toBe(0);

    release();
    expect((await pass).recordsAccepted).toBe(0);
    for (const id of seeded.registroIds) {
      expect(await envioRow(id)).toMatchObject({
        estado: "pendiente",
        proximo_intento_en: at("00:02:00").toISOString(),
      });
    }
    expect((await press(at("00:01:30"))).cleared).toBe(2);
  });

  it("after every wait has ended, clears nothing and the pass after it sends", async () => {
    await seedPendingEnvios(suite.db, { count: 3 });
    const { state, deps } = harness();
    state.down = true;
    await drain(deps, at("00:01:00"));
    await drain(deps, at("00:02:00"));
    state.down = false;
    expect((await drain(deps, at("00:03:00"))).nextDueAt).toBeNull();

    expect(await press(at("00:05:00"))).toEqual({ waiting: 3, cleared: 0 });
    const submitsBefore = state.submits;
    const pass = await drain(deps, at("00:05:00"));
    expect(state.submits).toBe(submitsBefore + 1);
    expect(pass.recordsAccepted).toBe(3);
  });

  it("saves a record whose reply was lost once, when pressed and resent", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const { state, deps } = harness();
    state.loseReply = true;
    await drain(deps, at("00:01:00"));
    state.loseReply = false;
    const id = seeded.registroIds[0]!;
    expect(await envioRow(id)).toMatchObject({
      estado: "pendiente",
      proximo_intento_en: at("00:02:00").toISOString(),
    });

    expect(await press(at("00:01:30"))).toEqual({ waiting: 1, cleared: 1 });
    const pass = await drain(deps, at("00:02:01"));
    expect(pass.recordsAccepted).toBe(1);
    expect(state.submits).toBe(2);
    const rows = await suite.db.execute<Record<string, unknown>>(
      sql`select estado, codigo_error from envios where registro_id = ${id}`,
    );
    expect(rows.rows).toEqual([{ estado: "aceptado", codigo_error: null }]);
  });
});
