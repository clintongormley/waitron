import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import {
  BACKOFF_MAX_MS,
  BRAKE_PROBE_INTERVAL_MS,
  DEFAULT_SKIP_RETRY_MS,
  RECUPERACION_ENVIANDO_MS,
  drain,
  type DrainDeps,
} from "./drain.js";

// After the box's clock steps back, times the drain stored before the step sit ahead of the
// clock by the step's length. Each case stores a time as if the clock had been 400 days ahead,
// with a control just inside the limit that time may legitimately lie ahead by.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const NOW = new Date("2026-07-21T00:01:00Z");
const STEP_MS = 400 * 24 * 60 * 60 * 1000;
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function deps(client: VerifactuClient, environment: DrainDeps["environment"] = "production") {
  return {
    db: suite.db,
    resolveClient: staticResolver(client),
    environment,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  } satisfies DrainDeps;
}

function aeat() {
  return createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
}

async function states(ids: string[]) {
  return (
    await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id in ${ids} order by registro_id
    `)
  ).rows.map((row) => row.estado);
}

describe("drain after the clock steps back — a record's retry time", () => {
  it("files a chain's records together when their retry times lie further ahead than the longest retry wait", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await suite.db.execute(sql`update envios set proximo_intento_en = ${ahead(STEP_MS)}`);

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.batchesSent).toBe(1);
    expect(result.recordsSubmitted).toBe(2);
    expect(await states(seeded.registroIds)).toEqual(["aceptado", "aceptado"]);
  });

  it("files a record whose retry time lies one millisecond further ahead than the longest retry wait", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await suite.db.execute(
      sql`update envios set proximo_intento_en = ${ahead(BACKOFF_MAX_MS + 1)}`,
    );

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
    expect(await states(seeded.registroIds)).toEqual(["aceptado"]);
  });

  it("waits for a retry time that lies exactly the longest retry wait ahead", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await suite.db.execute(sql`update envios set proximo_intento_en = ${ahead(BACKOFF_MAX_MS)}`);

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt?.toISOString()).toBe(ahead(BACKOFF_MAX_MS));
    expect(await states(seeded.registroIds)).toEqual(["pendiente"]);
  });

  it("reports the skip retry, not the stored time, for a due record another environment's guard refuses", async () => {
    await seedPendingEnvios(suite.db, { count: 1, entorno: "preproduction" });
    await suite.db.execute(sql`update envios set proximo_intento_en = ${ahead(STEP_MS)}`);

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(0);
    expect(result.incidentsRaised).toBe(1);
    expect(result.nextDueAt?.toISOString()).toBe(ahead(DEFAULT_SKIP_RETRY_MS));
  });
});

describe("drain after the clock steps back — a claim left sending", () => {
  async function claimedAt(at: string) {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await suite.db.execute(
      sql`update envios set estado = 'enviando', enviado_en = ${at}, intentos = 1`,
    );
    return seeded;
  }

  it("takes back and files a claim stamped further ahead than the recovery wait", async () => {
    const seeded = await claimedAt(ahead(STEP_MS));

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
    expect(await states(seeded.registroIds)).toEqual(["aceptado"]);
  });

  it("takes back a claim stamped one millisecond further ahead than the recovery wait", async () => {
    const seeded = await claimedAt(ahead(RECUPERACION_ENVIANDO_MS + 1));

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
    expect(await states(seeded.registroIds)).toEqual(["aceptado"]);
  });

  it("leaves a claim stamped exactly the recovery wait ahead", async () => {
    const seeded = await claimedAt(ahead(RECUPERACION_ENVIANDO_MS));

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(0);
    expect(await states(seeded.registroIds)).toEqual(["enviando"]);
  });
});

describe("drain after the clock steps back — AEAT's sending wait", () => {
  // Not the 60 seconds the drain assumes when none is stored, so a reset that ignored the stored
  // wait would show.
  const WAIT_MS = 300_000;

  async function gateAt(at: string) {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await suite.db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, ${at}, ${WAIT_MS / 1000})
    `);
    return seeded;
  }

  async function storedGate() {
    return (
      await suite.db.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(
        sql`select proximo_envio_en, tiempo_espera_seg from envio_flujo`,
      )
    ).rows;
  }

  it("waits one full stored wait from now, sending nothing before it, when the gate lies further ahead than that wait", async () => {
    const seeded = await gateAt(ahead(STEP_MS));
    const client = aeat().client();

    const first = await drain(deps(client), NOW);

    expect(first.recordsSubmitted).toBe(0);
    expect(first.nextDueAt?.toISOString()).toBe(ahead(WAIT_MS));
    expect(await storedGate()).toEqual([
      { proximo_envio_en: ahead(WAIT_MS), tiempo_espera_seg: WAIT_MS / 1000 },
    ]);

    const early = await drain(deps(client), new Date(ahead(1000)));

    expect(early.recordsSubmitted).toBe(0);
    expect(await states(seeded.registroIds)).toEqual(["pendiente"]);

    const second = await drain(deps(client), new Date(ahead(WAIT_MS)));

    expect(second.recordsSubmitted).toBe(1);
    expect(await states(seeded.registroIds)).toEqual(["aceptado"]);
  });

  it("resets a gate one millisecond further ahead than its wait", async () => {
    await gateAt(ahead(WAIT_MS + 1));

    const result = await drain(deps(aeat().client()), NOW);

    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt?.toISOString()).toBe(ahead(WAIT_MS));
    expect(await storedGate()).toEqual([
      { proximo_envio_en: ahead(WAIT_MS), tiempo_espera_seg: WAIT_MS / 1000 },
    ]);
  });

  for (const [label, gateMs] of [
    ["exactly one wait", WAIT_MS],
    ["less than one wait", 100_000],
  ] as const) {
    it(`keeps a gate that lies ${label} ahead`, async () => {
      const seeded = await gateAt(ahead(gateMs));

      const result = await drain(deps(aeat().client()), NOW);

      expect(result.recordsSubmitted).toBe(0);
      expect(result.nextDueAt?.toISOString()).toBe(ahead(gateMs));
      expect(await states(seeded.registroIds)).toEqual(["pendiente"]);
      expect(await storedGate()).toEqual([
        { proximo_envio_en: ahead(gateMs), tiempo_espera_seg: WAIT_MS / 1000 },
      ]);
    });
  }
});

describe("drain after the clock steps back — a held chain's hourly probe", () => {
  // Three refusals with one code hold the fourth record (`SAME_CODE_REFUSAL_LIMIT`); the held
  // record is then probed an hour after the chain's last send.
  async function heldWithLastSendAt(at: string) {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    for (const key of seeded.facturaKeys) fake.reject(key, 1100, "Rechazo");
    await drain(deps(fake.client()), new Date("2026-07-21T00:00:10Z"));
    const held = (await appendPendingAlta(suite.db, seeded, 4)).registroId;
    await suite.db.execute(sql`delete from envio_flujo`);
    await drain(deps(fake.client()), new Date("2026-07-21T00:00:20Z"));
    expect(await states([held])).toEqual(["detenido"]);
    await suite.db.execute(sql`update envios set enviado_en = ${at}`);
    await suite.db.execute(sql`delete from envio_flujo`);
    return { fake, held };
  }

  it("probes a held record whose chain's last send lies further ahead than the probe interval", async () => {
    const { fake, held } = await heldWithLastSendAt(ahead(STEP_MS));

    const result = await drain(deps(fake.client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
    const sent = await suite.db.execute<{ enviado_en: string }>(
      sql`select enviado_en from envios where registro_id = ${held}`,
    );
    expect(sent.rows[0]!.enviado_en).toBe(NOW.toISOString());
  });

  it("probes when the chain's last send lies one millisecond further ahead than the probe interval", async () => {
    const { fake } = await heldWithLastSendAt(ahead(BRAKE_PROBE_INTERVAL_MS + 1));

    const result = await drain(deps(fake.client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
  });

  it("does not probe when the chain's last send lies exactly the probe interval ahead", async () => {
    const { fake } = await heldWithLastSendAt(ahead(BRAKE_PROBE_INTERVAL_MS));

    const result = await drain(deps(fake.client()), NOW);

    expect(result.recordsSubmitted).toBe(0);
  });
});
