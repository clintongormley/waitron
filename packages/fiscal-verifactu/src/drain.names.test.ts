import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { Cabecera, EnvioRegistro, RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios, type SeededDrain } from "../test/drain-fixtures.js";
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
    expect(result.nextDueAt).not.toBeNull();
  });
});
