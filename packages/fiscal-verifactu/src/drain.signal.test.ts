import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedIndependentChain, seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const NOW = new Date("2026-07-21T00:01:00Z");
const EARLIER_GATE = new Date("2026-07-21T00:00:00Z");
/** The wait every answer below gives, distinct from the seeded 120 so a stored one is AEAT's. */
const AEAT_WAIT_SEG = 7;

/** Nine records due at a cap of three: three full batches, sent back to back in one pass. */
async function seedThreeBatches(): Promise<void> {
  await seedPendingEnvios(suite.db, { count: 9 });
  await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, ${EARLIER_GATE.toISOString()}, 120)
  `);
}

/** The fake AEAT, answering with `AEAT_WAIT_SEG`; `onSubmit` runs while each answer is held. */
function client(onSubmit: () => void = () => {}): VerifactuClient {
  const real = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") }).client();
  return {
    ...real,
    submit: async (cabecera, registros) => {
      onSubmit();
      return { ...(await real.submit(cabecera, registros)), TiempoEsperaEnvio: AEAT_WAIT_SEG };
    },
  };
}

function deps(resolved: VerifactuClient, signal?: AbortSignal): DrainDeps {
  return {
    db: suite.db,
    resolveClient: staticResolver(resolved),
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    environment: "production",
    maxRegistrosPorEnvio: 3,
    ...(signal === undefined ? {} : { signal }),
  };
}

async function estados(): Promise<Record<string, number>> {
  const { rows } = await withTransaction(suite.db, (tx) =>
    tx.execute<{ estado: string; n: number }>(
      sql`select estado, count(*) as n from envios group by estado`,
    ),
  );
  return Object.fromEntries(rows.map((row) => [row.estado, row.n]));
}

async function flujo(): Promise<{ proximo_envio_en: string; tiempo_espera_seg: number }[]> {
  const { rows } = await withTransaction(suite.db, (tx) =>
    tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(
      sql`select proximo_envio_en, tiempo_espera_seg from envio_flujo`,
    ),
  );
  return rows;
}

describe("drain — told to stop", () => {
  beforeEach(seedThreeBatches);

  it("control: with no signal, all three batches go in one pass", async () => {
    const result = await drain(deps(client()), NOW);

    expect(result.batchesSent).toBe(3);
    expect(await estados()).toEqual({ aceptado: 9 });
  });

  it("a signal raised while the first batch's answer is held sends no second batch, and the first is stored as answered", async () => {
    const controller = new AbortController();
    const result = await drain(
      deps(
        client(() => controller.abort()),
        controller.signal,
      ),
      NOW,
    );

    expect(result.batchesSent).toBe(1);
    expect(result.recordsAccepted).toBe(3);
    expect(await estados()).toEqual({ aceptado: 3, pendiente: 6 });
  });

  it("a signal seen after a send stores the wait AEAT set", async () => {
    const controller = new AbortController();
    await drain(
      deps(
        client(() => controller.abort()),
        controller.signal,
      ),
      NOW,
    );

    expect(await flujo()).toEqual([
      {
        proximo_envio_en: new Date(NOW.getTime() + AEAT_WAIT_SEG * 1000).toISOString(),
        tiempo_espera_seg: AEAT_WAIT_SEG,
      },
    ]);
  });

  it("a signal seen before the first send leaves envio_flujo unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    let submits = 0;

    const result = await drain(
      deps(
        client(() => (submits += 1)),
        controller.signal,
      ),
      NOW,
    );

    expect(submits).toBe(0);
    expect(result.batchesSent).toBe(0);
    expect(await estados()).toEqual({ pendiente: 9 });
    expect(await flujo()).toEqual([
      { proximo_envio_en: EARLIER_GATE.toISOString(), tiempo_espera_seg: 120 },
    ]);
  });
});

describe("drain — told to stop between a claim that found nothing sendable and its retry", () => {
  /**
   * Three rows the environment guard refuses fill the cap-3 claim window, and a healthy row on
   * another chain sorts after them, so only the retry inside one round reaches it.
   */
  beforeEach(async () => {
    await seedPendingEnvios(suite.db, { count: 3, entorno: null });
    await seedIndependentChain(suite.db, {
      sifId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      secuencia: 1,
      entorno: "production",
    });
    await suite.db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, ${EARLIER_GATE.toISOString()}, 120)
    `);
  });

  it("control: with no signal, the retry reaches and sends the healthy row", async () => {
    const result = await drain(deps(client()), NOW);

    expect(result.recordsSubmitted).toBe(1);
  });

  it("claims and sends nothing more, and leaves envio_flujo unchanged", async () => {
    // Reads false at the round's first check only: aborted from then on, as a signal raised while
    // the first claim ran would be.
    let reads = 0;
    const signal = {
      get aborted() {
        reads += 1;
        return reads > 1;
      },
    } as AbortSignal;
    let submits = 0;

    const result = await drain(
      deps(
        client(() => (submits += 1)),
        signal,
      ),
      NOW,
    );

    expect(submits).toBe(0);
    expect(result.batchesSent).toBe(0);
    expect(await estados()).toEqual({ pendiente: 4 });
    expect(await flujo()).toEqual([
      { proximo_envio_en: EARLIER_GATE.toISOString(), tiempo_espera_seg: 120 },
    ]);
  });
});

describe("drain — told to stop at a retry after a batch was sent", () => {
  /** At a cap of one: a healthy row sorting first, one the environment guard refuses, then the
   * healthy row sorting last that only a retry reaches. */
  beforeEach(async () => {
    await seedPendingEnvios(suite.db, { count: 1, entorno: null });
    await seedIndependentChain(suite.db, {
      sifId: "00000000-0000-4000-8000-000000000000",
      secuencia: 1,
      entorno: "production",
    });
    await seedIndependentChain(suite.db, {
      sifId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      secuencia: 1,
      entorno: "production",
    });
    await suite.db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, ${EARLIER_GATE.toISOString()}, 120)
    `);
  });

  function capOne(resolved: VerifactuClient, signal?: AbortSignal): DrainDeps {
    return { ...deps(resolved, signal), maxRegistrosPorEnvio: 1 };
  }

  it("control: with no signal, both healthy rows are sent", async () => {
    const result = await drain(capOne(client()), NOW);

    expect(result.batchesSent).toBe(2);
  });

  it("sends nothing more and stores the wait AEAT set", async () => {
    // Aborted from the second read after a send: the next round's first check passes, and the
    // retry inside that round is the first to see it.
    let submits = 0;
    let readsSinceSubmit = 0;
    const signal = {
      get aborted() {
        readsSinceSubmit += 1;
        return submits > 0 && readsSinceSubmit > 1;
      },
    } as AbortSignal;

    const result = await drain(
      capOne(
        client(() => {
          submits += 1;
          readsSinceSubmit = 0;
        }),
        signal,
      ),
      NOW,
    );

    expect(submits).toBe(1);
    expect(result.batchesSent).toBe(1);
    expect(await estados()).toEqual({ aceptado: 1, pendiente: 2 });
    expect(await flujo()).toEqual([
      {
        proximo_envio_en: new Date(NOW.getTime() + AEAT_WAIT_SEG * 1000).toISOString(),
        tiempo_espera_seg: AEAT_WAIT_SEG,
      },
    ]);
  });
});
