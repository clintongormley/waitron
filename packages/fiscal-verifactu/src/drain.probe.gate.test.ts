import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios, seedPinnedChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const PROBE = new Date("2026-07-21T01:03:00Z");
const GATE = new Date("2026-07-21T02:02:00Z");
const PINNED = "ffffffff-ffff-4fff-8fff-000000000001";

function deps(client: VerifactuClient): DrainDeps {
  return {
    db: suite.db,
    resolveClient: staticResolver(client),
    environment: "production",
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    maxRegistrosPorEnvio: 2,
  };
}

async function held() {
  const aeat = createFakeAeat({
    serverNow: new Date("2026-07-21T00:00:00Z"),
    tiempoEsperaInicial: 5,
  });
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) aeat.reject(key, 1100, "Rechazo");
  await drain(
    { ...deps(aeat.client()), maxRegistrosPorEnvio: 1000 },
    new Date("2026-07-21T00:01:00Z"),
  );
  const first = (await appendPendingAlta(suite.db, seeded, 4)).registroId;
  await drain(deps(aeat.client()), new Date("2026-07-21T00:02:00Z"));
  await suite.db.execute(sql`update envio_flujo set proximo_envio_en = ${GATE.toISOString()}`);
  const sent: string[][] = [];
  const client: VerifactuClient = {
    ...aeat.client(),
    submit: (header, records) => {
      sent.push(
        records.map((record) => {
          if (!("RegistroAlta" in record)) throw new Error("alta required");
          return record.RegistroAlta.RefExterna!;
        }),
      );
      return aeat.client().submit(header, records);
    },
  };
  return { seeded, first, client, sent };
}

async function attempts(ids: string[]) {
  return (
    await suite.db.execute<{
      id: string;
      state: string;
      attempts: number;
      sent: string | null;
    }>(sql`
    select registro_id as id, estado as state, intentos as attempts, enviado_en as sent
    from envios where registro_id in ${ids} order by registro_id
  `)
  ).rows;
}

describe("hourly probes respect the sending wait's full-batch exception", () => {
  it("does not count a pending successor that will be held as room in a full batch", async () => {
    const { seeded, first, client, sent } = await held();
    const extra = (await appendPendingAlta(suite.db, seeded, 5)).registroId;
    const before = await attempts([first, extra]);
    const result = await drain(deps(client), PROBE);
    expect(sent).toEqual([]);
    expect(result.batchesSent).toBe(0);
    expect(result.recordsHalted).toBe(0);
    expect(await attempts([first, extra])).toEqual(before);
    expect(result.nextDueAt).toEqual(GATE);
    await drain(deps(client), GATE);
    expect(sent).toEqual([[first]]);
  });

  it("does not count a differently named probe towards an ordinary batch", async () => {
    const { seeded, first, client, sent } = await held();
    const ordinary = await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: [{ nombreRazonEmisor: "A different name", generadoEn: "2026-07-20T18:10:00.000Z" }],
    });
    const before = await attempts([first, ordinary.registroIds[0]!]);
    const result = await drain(deps(client), PROBE);
    expect(sent).toEqual([]);
    expect(await attempts([first, ordinary.registroIds[0]!])).toEqual(before);
    expect(result.nextDueAt).toEqual(GATE);
  });

  it("can fill the early full batch with an ordinary record and a same-name probe", async () => {
    const { seeded, first, client, sent } = await held();
    const ordinary = await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: [{ nombreRazonEmisor: "Waitron SL", generadoEn: "2026-07-20T18:10:00.000Z" }],
    });
    const result = await drain(deps(client), PROBE);
    expect(sent).toEqual([[ordinary.registroIds[0]!, first]]);
    expect(result.recordsSubmitted).toBe(2);
  });
});
