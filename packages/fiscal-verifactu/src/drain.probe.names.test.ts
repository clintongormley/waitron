import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios, seedPinnedChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS, type DrainDeps } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const T0 = new Date("2026-07-21T00:01:00Z");
const T = new Date("2026-07-21T00:02:00Z");
const PROBE = new Date("2026-07-21T01:02:00Z");
const OLD = "Waitron SL";
const NEW = "Waitron Restauración SL";
const PINNED = "ffffffff-ffff-4fff-8fff-000000000001";

function deps(client: VerifactuClient, maxRegistrosPorEnvio = 1000): DrainDeps {
  return {
    db: suite.db,
    resolveClient: staticResolver(client),
    environment: "production",
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    maxRegistrosPorEnvio,
  };
}

async function held(name: string) {
  const aeat = createFakeAeat({
    serverNow: new Date("2026-07-21T00:00:00Z"),
    tiempoEsperaInicial: 5,
  });
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  for (const key of seeded.facturaKeys) aeat.reject(key, 1100, "Rechazo");
  await drain(deps(aeat.client()), T0);
  const first = await appendPendingAlta(suite.db, seeded, 4, { nombreRazonEmisor: name });
  await drain(deps(aeat.client()), T);
  return { aeat, seeded, first: first.registroId };
}

function capture(client: VerifactuClient) {
  const sent: { name: string; records: { name: string; id: string }[] }[] = [];
  const wire: VerifactuClient = {
    ...client,
    submit: (header, records) => {
      sent.push({
        name: header.ObligadoEmision.NombreRazon,
        records: records.map((record) => {
          if (!("RegistroAlta" in record)) throw new Error("alta required");
          return {
            name: record.RegistroAlta.NombreRazonEmisor,
            id: record.RegistroAlta.RefExterna!,
          };
        }),
      });
      return client.submit(header, records);
    },
  };
  return { wire, sent };
}

async function advance(client: VerifactuClient, max = 1000, from = PROBE) {
  let at = from;
  for (let i = 0; i < 6; i += 1) {
    const result = await drain(deps(client, max), at);
    if (result.nextDueAt === null) break;
    at = result.nextDueAt;
  }
}

describe("hourly probes after a taxpayer-name change", () => {
  it("keeps an ordinary old-name record separate from a new-name probe", async () => {
    const { aeat, seeded, first } = await held(NEW);
    const ordinary = await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: [{ nombreRazonEmisor: OLD, generadoEn: "2026-07-20T18:10:00.000Z" }],
    });
    const { wire, sent } = capture(aeat.client());
    await advance(wire);
    expect(sent).toEqual([
      { name: OLD, records: [{ name: OLD, id: ordinary.registroIds[0]! }] },
      { name: NEW, records: [{ name: NEW, id: first }] },
    ]);
  });

  it("keeps two differently named due probes in separate envíos", async () => {
    const { aeat, seeded, first } = await held(NEW);
    const other = await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: Array.from({ length: 3 }, () => ({
        nombreRazonEmisor: OLD,
        generadoEn: "2026-07-20T18:10:00.000Z",
      })),
    });
    for (const key of other.chain.facturaKeys) aeat.reject(key, 1100, "Rechazo");
    await drain(deps(aeat.client()), new Date("2026-07-21T00:02:05Z"));
    const oldProbe = await appendPendingAlta(suite.db, other.chain, 103, {
      nombreRazonEmisor: OLD,
    });
    await drain(deps(aeat.client()), new Date("2026-07-21T00:02:10Z"));
    const { wire, sent } = capture(aeat.client());
    await advance(wire, 1000, new Date("2026-07-21T01:02:10Z"));
    expect(sent.flatMap((batch) => batch.records.map((record) => record.id)).sort()).toEqual(
      [first, oldProbe.registroId].sort(),
    );
    expect(
      sent.filter((batch) => batch.records.some((record) => record.name !== batch.name)),
    ).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it("does not stamp an unsent probe when a mixed-name ordinary window is deferred", async () => {
    const { aeat, seeded, first } = await held(NEW);
    await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: [OLD, NEW].map((nombreRazonEmisor) => ({
        nombreRazonEmisor,
        generadoEn: "2026-07-20T18:10:00.000Z",
      })),
    });
    await suite.db.execute(
      sql`update envio_flujo set proximo_envio_en = '2026-07-21T01:03:00.000Z'`,
    );
    const { wire, sent } = capture(aeat.client());
    await drain(deps(wire, 2), PROBE);
    expect(sent).toEqual([]);
    const { rows } = await suite.db.execute<{ sent: string; attempts: number }>(sql`
      select enviado_en as sent, intentos as attempts from envios where registro_id = ${first}
    `);
    expect(rows).toEqual([{ sent: "2026-07-21T00:02:00.000Z", attempts: 1 }]);
    await advance(wire, 2);
    expect(sent.flatMap((batch) => batch.records.map((record) => record.id))).toContain(first);
  });

  it("sends the earliest-generated probe's taxpayer name first", async () => {
    const { aeat, seeded, first } = await held(NEW);
    const other = await seedPinnedChain(suite.db, seeded, {
      sifId: PINNED,
      firstSecuencia: 100,
      rows: Array.from({ length: 3 }, () => ({
        nombreRazonEmisor: OLD,
        generadoEn: "2026-07-20T18:10:00.000Z",
      })),
    });
    for (const key of other.chain.facturaKeys) aeat.reject(key, 1100, "Rechazo");
    await drain(deps(aeat.client()), new Date("2026-07-21T00:02:05Z"));
    const older = await appendPendingAlta(suite.db, other.chain, 103, {
      nombreRazonEmisor: OLD,
      generadoEn: "2026-07-20T18:15:00.000Z",
    });
    await drain(deps(aeat.client()), new Date("2026-07-21T00:02:10Z"));
    const { wire, sent } = capture(aeat.client());
    await advance(wire, 1000, new Date("2026-07-21T01:02:10Z"));
    expect(sent).toEqual([
      { name: OLD, records: [{ name: OLD, id: older.registroId }] },
      { name: NEW, records: [{ name: NEW, id: first }] },
    ]);
  });
});
