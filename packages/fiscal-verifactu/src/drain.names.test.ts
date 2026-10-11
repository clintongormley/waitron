import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { Cabecera, EnvioRegistro, RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendPendingAlta,
  seedPendingEnvios,
  seedPinnedChain,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";

/**
 * A rename of the taxpayer leaves records carrying the old name and records carrying the new one
 * in the outbox together. One envío's `Cabecera` is built from its first record, so an envío must
 * carry one name only.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const OLD = "Waitron SL";
const NEW = "Waitron Restauración SL";

interface Sent {
  cabecera: string;
  records: { name: string; ref: string }[];
}

function recording(client: VerifactuClient, sent: Sent[]): VerifactuClient {
  return {
    ...client,
    submit: (cabecera: Cabecera, registros: EnvioRegistro[]) => {
      sent.push({
        cabecera: cabecera.ObligadoEmision.NombreRazon,
        // Every record these cases seed is an alta.
        records: registros.map((registro) => {
          const record = (registro as { RegistroAlta: RegistroAlta }).RegistroAlta;
          return { name: record.NombreRazonEmisor, ref: record.RefExterna ?? "" };
        }),
      });
      return client.submit(cabecera, registros);
    },
  };
}

/** One chain whose records carry `names` in order, all due. */
async function seedNamed(names: string[]): Promise<{ seeded: SeededDrain; ids: string[] }> {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  expect(names[0]).toBe(OLD);
  const ids = [seeded.registroIds[0]!];
  for (const [index, name] of names.slice(1).entries()) {
    const { registroId } = await appendPendingAlta(suite.db, seeded, index + 2, {
      nombreRazonEmisor: name,
    });
    ids.push(registroId);
  }
  return { seeded, ids };
}

function depsFor(sent: Sent[], maxRegistrosPorEnvio?: number): DrainDeps {
  const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  return {
    db: suite.db,
    resolveClient: staticResolver(recording(aeat.client(), sent)),
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    environment: "production",
    ...(maxRegistrosPorEnvio === undefined ? {} : { maxRegistrosPorEnvio }),
  };
}

async function estados(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const { rows } = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id = ${id}
    `);
    out.push(rows[0]!.estado);
  }
  return out;
}

async function incidentCodes(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ code: string }>(sql`select code from incidents`);
  return rows.map((row) => row.code);
}

/** Pinned `registro_sif` ids, so a case chooses which chain `order by sif_id` reads first. */
const sortsFirst = (tag: string): string => `00000000-0000-4000-8000-${tag.padStart(12, "0")}`;
const sortsLast = (tag: string): string => `ffffffff-ffff-4fff-8fff-${tag.padStart(12, "0")}`;

/** A generation instant on the seeded day, before the fake AEAT's `serverNow`. */
const generatedAt = (minute: number): string =>
  `2026-07-20T18:${String(minute).padStart(2, "0")}:00.000Z`;

/** Runs passes at each `nextDueAt` until none is reported, or `passes` have run. */
async function drainUntilQuiet(deps: DrainDeps, from: Date, passes = 10): Promise<void> {
  let at = from;
  for (let pass = 0; pass < passes; pass += 1) {
    const result = await drain(deps, at);
    if (result.nextDueAt === null) return;
    at = result.nextDueAt;
  }
}

/** The refs among `ids`, in the order they reached AEAT. */
function sentOrder(sent: Sent[], ids: string[]): string[] {
  return sent
    .flatMap((envio) => envio.records.map((record) => record.ref))
    .filter((ref) => ids.includes(ref));
}

function mixedEnvios(sent: Sent[]): Sent[] {
  return sent.filter((envio) => envio.records.some((record) => record.name !== envio.cabecera));
}

async function closeGateUntil(at: Date): Promise<void> {
  await suite.db.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, ${at.toISOString()}, 60)
  `);
}

describe("drain — one taxpayer name per envío", () => {
  afterEach(async () => {
    await suite.db.execute(sql`delete from envios`);
    await suite.db.execute(sql`delete from envio_flujo`);
    await suite.db.execute(sql`delete from incidents`);
  });

  it("sends the old name's records first and leaves the new name's pending, with no incident, for the next pass", async () => {
    const { ids } = await seedNamed([OLD, NEW]);
    const sent: Sent[] = [];
    const deps = depsFor(sent);

    const first = await drain(deps, NOW);

    expect(sent).toEqual([{ cabecera: OLD, records: [{ name: OLD, ref: ids[0] }] }]);
    expect(await estados(ids)).toEqual(["aceptado", "pendiente"]);
    expect(await incidentCodes()).toEqual([]);
    expect(first.nextDueAt).not.toBeNull();

    const second = await drain(deps, first.nextDueAt!);

    expect(second.batchesSent).toBe(1);
    expect(sent[1]).toEqual({ cabecera: NEW, records: [{ name: NEW, ref: ids[1] }] });
    expect(await estados(ids)).toEqual(["aceptado", "aceptado"]);
    expect(await incidentCodes()).toEqual([]);
  });

  it("still sends a run of one name together in one envío", async () => {
    const { ids } = await seedNamed([OLD, OLD, NEW]);
    const sent: Sent[] = [];

    await drain(depsFor(sent), NOW);

    expect(sent).toEqual([
      {
        cabecera: OLD,
        records: [
          { name: OLD, ref: ids[0] },
          { name: OLD, ref: ids[1] },
        ],
      },
    ]);
    expect(await estados(ids)).toEqual(["aceptado", "aceptado", "pendiente"]);
  });

  it("sends a full envío of one name before the wait has passed", async () => {
    const gate = new Date("2026-07-21T00:05:00Z");
    await closeGateUntil(gate);
    const { ids } = await seedNamed([OLD, OLD, OLD, NEW]);
    const sent: Sent[] = [];

    const result = await drain(depsFor(sent, 3), NOW);

    expect(sent.map((envio) => envio.records.map((record) => record.ref))).toEqual([
      ids.slice(0, 3),
    ]);
    expect(sent[0]!.cabecera).toBe(OLD);
    expect(await estados(ids)).toEqual(["aceptado", "aceptado", "aceptado", "pendiente"]);
    expect(result.nextDueAt).not.toBeNull();
  });

  it("sends nothing before the wait when a name change would cut the full envío short", async () => {
    const gate = new Date("2026-07-21T00:05:00Z");
    await closeGateUntil(gate);
    const { ids } = await seedNamed([OLD, OLD, NEW, NEW]);
    const sent: Sent[] = [];

    const result = await drain(depsFor(sent, 3), NOW);

    expect(sent).toEqual([]);
    expect(result.batchesSent).toBe(0);
    expect(result.nextDueAt).toEqual(gate);
    expect(await estados(ids)).toEqual(["pendiente", "pendiente", "pendiente", "pendiente"]);
    expect(await incidentCodes()).toEqual([]);

    const after = await drain(depsFor(sent, 3), gate);

    expect(after.batchesSent).toBe(1);
    expect(sent).toEqual([
      {
        cabecera: OLD,
        records: [
          { name: OLD, ref: ids[0] },
          { name: OLD, ref: ids[1] },
        ],
      },
    ]);
    expect(await estados(ids)).toEqual(["aceptado", "aceptado", "pendiente", "pendiente"]);
  });

  it("sends no short envío after a full one in the same pass when a name change cuts the next one", async () => {
    const { ids } = await seedNamed([OLD, OLD, OLD, NEW, OLD, OLD]);
    const sent: Sent[] = [];

    const result = await drain(depsFor(sent, 3), NOW);

    expect(sent.map((envio) => envio.records.map((record) => record.ref))).toEqual([
      ids.slice(0, 3),
    ]);
    expect(result.batchesSent).toBe(1);
    expect(await estados(ids)).toEqual([
      "aceptado",
      "aceptado",
      "aceptado",
      "pendiente",
      "pendiente",
      "pendiente",
    ]);
    expect(await incidentCodes()).toEqual([]);
    // The fake AEAT's first wait is 60 s.
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("sends a later chain's older-name records while an earlier chain gets a new-name sale before every pass", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const early = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsFirst("a1"),
      firstSecuencia: 100,
      rows: [],
    });
    const late = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsLast("a1"),
      firstSecuencia: 200,
      rows: [
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(0) },
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(1) },
      ],
    });
    const sent: Sent[] = [];
    const deps = depsFor(sent, 3);

    let at = NOW;
    for (let pass = 0; pass < 12; pass += 1) {
      await appendPendingAlta(suite.db, early.chain, 100 + pass, {
        nombreRazonEmisor: NEW,
        generadoEn: generatedAt(10 + pass),
      });
      const result = await drain(deps, at);
      at = result.nextDueAt ?? at;
    }

    expect(sent[0]).toEqual({
      cabecera: OLD,
      records: late.registroIds.map((ref) => ({ name: OLD, ref })),
    });
    expect(await estados(late.registroIds)).toEqual(["aceptado", "aceptado"]);
    expect(mixedEnvios(sent)).toEqual([]);
    expect(await incidentCodes()).toEqual([]);
  });

  it("sends two chains that both carry [old, old, new, new] in chain order, one name per envío", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const first = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsFirst("b1"),
      firstSecuencia: 100,
      rows: [
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(0) },
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(2) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(10) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(12) },
      ],
    });
    const second = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsLast("b1"),
      firstSecuencia: 200,
      rows: [
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(1) },
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(3) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(11) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(13) },
      ],
    });
    const sent: Sent[] = [];

    await drainUntilQuiet(depsFor(sent, 3), NOW);

    expect(sentOrder(sent, first.registroIds)).toEqual(first.registroIds);
    expect(sentOrder(sent, second.registroIds)).toEqual(second.registroIds);
    expect(mixedEnvios(sent)).toEqual([]);
    expect(await estados([...first.registroIds, ...second.registroIds])).toEqual(
      Array.from({ length: 8 }, () => "aceptado"),
    );
    expect(await incidentCodes()).toEqual([]);
  });

  it("keeps a chain's new-name record behind its own old-name record when another chain's new-name record was generated first", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const renamedMidChain = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsFirst("d1"),
      firstSecuencia: 100,
      rows: [
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(5) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(6) },
      ],
    });
    const newOnly = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsLast("d1"),
      firstSecuencia: 200,
      rows: [{ nombreRazonEmisor: NEW, generadoEn: generatedAt(0) }],
    });
    const sent: Sent[] = [];

    await drainUntilQuiet(depsFor(sent, 3), NOW);

    expect(sent[0]).toEqual({
      cabecera: NEW,
      records: [{ name: NEW, ref: newOnly.registroIds[0] }],
    });
    expect(sentOrder(sent, renamedMidChain.registroIds)).toEqual(renamedMidChain.registroIds);
    expect(mixedEnvios(sent)).toEqual([]);
    expect(await estados([...renamedMidChain.registroIds, ...newOnly.registroIds])).toEqual([
      "aceptado",
      "aceptado",
      "aceptado",
    ]);
  });

  it("takes the name from a record that can go when a later record on its chain was stamped earlier", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const stampedOutOfOrder = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsFirst("e1"),
      firstSecuencia: 100,
      rows: [
        { nombreRazonEmisor: OLD, generadoEn: generatedAt(5) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(0) },
      ],
    });
    const sent: Sent[] = [];

    const result = await drain(depsFor(sent, 3), NOW);

    expect(result.batchesSent).toBe(1);
    expect(sent).toEqual([
      { cabecera: OLD, records: [{ name: OLD, ref: stampedOutOfOrder.registroIds[0] }] },
    ]);
    expect(await estados(stampedOutOfOrder.registroIds)).toEqual(["aceptado", "pendiente"]);
  });

  it("before the wait, looks past a chain the environment guard refused rather than deferring on its name", async () => {
    const gate = new Date("2026-07-21T00:05:00Z");
    await closeGateUntil(gate);
    const seeded = await seedPendingEnvios(suite.db, { count: 0 });
    const refused = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsFirst("c1"),
      firstSecuencia: 100,
      entorno: "preproduction",
      rows: [{ nombreRazonEmisor: OLD, generadoEn: generatedAt(0) }],
    });
    const renamed = await seedPinnedChain(suite.db, seeded, {
      sifId: sortsLast("c1"),
      firstSecuencia: 200,
      rows: [
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(10) },
        { nombreRazonEmisor: NEW, generadoEn: generatedAt(11) },
      ],
    });
    const sent: Sent[] = [];

    const result = await drain(depsFor(sent, 2), NOW);

    expect(sent).toEqual([
      { cabecera: NEW, records: renamed.registroIds.map((ref) => ({ name: NEW, ref })) },
    ]);
    expect(result.batchesSent).toBe(1);
    expect(await estados(refused.registroIds)).toEqual(["pendiente"]);
    expect(await incidentCodes()).toEqual(["fiscal.environment_mismatch"]);
  });
});
