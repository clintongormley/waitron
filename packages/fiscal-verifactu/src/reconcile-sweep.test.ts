import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { randomUUID } from "node:crypto";
import { insertPendingAlta, seedPendingEnvios, seedPinnedChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { envios } from "./schema/envios.js";
import { readActiveConflicts } from "./conflict-evidence.js";
import { drain } from "./drain.js";
import { createReconciliationSweep } from "./reconcile-sweep.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const START = new Date("2027-02-01T12:00:00Z");
const RETRY = 300_000;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const seeded = await seedPendingEnvios(suite.db, { count: 0 });
  const ids: string[] = [];
  for (const [index, fecha] of [
    [1, "2026-12-31"],
    [2, "2027-01-01"],
    [3, "2027-01-02"],
  ] as const) {
    const row = await insertPendingAlta(suite.db, {
      ...seeded,
      secuencia: index,
      huella: String(index).padStart(64, "0"),
      fecha,
      entorno: "production",
    });
    ids.push(row.registroId);
    await suite.db.insert(envios).values({ registroId: row.registroId });
  }
  const aeat = createFakeAeat({ serverNow: START, consultaPageSize: 1 });
  const client = aeat.client();
  await drain(
    {
      db: suite.db,
      resolveClient: staticResolver(client),
      environment: "production",
      skipRetryMs: RETRY,
    },
    START,
  );
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`update envios set estado = 'pendiente'`);
    await tx.execute(sql`delete from acks`);
  });
  const deps = {
    db: suite.db,
    clock: seeded.clock,
    retryMs: RETRY,
    scope: {
      nodeId: seeded.nodeId,
      historyNodeIds: [seeded.nodeId],
      taxpayerId: seeded.nif,
      environment: "production" as const,
    },
    resolveClient: staticResolver(client),
  };
  return { seeded, ids, client, deps };
}

async function acknowledgements() {
  return (
    await suite.db.execute<{ registro_id: string }>(
      sql`select registro_id from acks order by registro_id`,
    )
  ).rows.map((row) => row.registro_id);
}

describe("a scoped startup and daily reconciliation sweep", () => {
  it("recovers lost acknowledgements in every stored month across a year boundary", async () => {
    const { ids, deps } = await fixture();
    const sweep = createReconciliationSweep(deps);

    const result = await sweep(START);

    expect(
      result.periods.map(({ year, month, outcome, result: found }) => ({
        year,
        month,
        outcome,
        checked: found?.checked,
      })),
    ).toEqual([
      { year: "2026", month: "12", outcome: "observed", checked: 1 },
      { year: "2027", month: "01", outcome: "observed", checked: 2 },
    ]);
    expect(await acknowledgements()).toEqual([...ids].sort());
    expect(result.nextDueAt).toEqual(new Date("2027-02-02T12:00:00Z"));
  });

  it("does not repeat complete lookups before the next day, then recovers a newly lost ack", async () => {
    const { ids, deps } = await fixture();
    const sweep = createReconciliationSweep(deps);
    await sweep(START);
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update envios set estado = 'pendiente' where registro_id = ${ids[2]}`);
      await tx.execute(sql`delete from acks where registro_id = ${ids[2]}`);
    });

    expect((await sweep(new Date("2027-02-02T11:59:59.999Z"))).periods).toEqual([]);
    expect(await acknowledgements()).toHaveLength(2);
    const result = await sweep(new Date("2027-02-02T12:00:00Z"));
    expect(result.periods).toHaveLength(2);
    expect(await acknowledgements()).toEqual([...ids].sort());
  });

  it("does not postpone checks for a month when the box clock steps backward", async () => {
    const { ids, deps } = await fixture();
    const sweep = createReconciliationSweep(deps);
    await sweep(START);
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update envios set estado = 'pendiente' where registro_id = ${ids[2]}`);
      await tx.execute(sql`delete from acks where registro_id = ${ids[2]}`);
    });

    const result = await sweep(new Date("2027-01-01T12:00:00Z"));

    expect(result.periods.map(({ outcome }) => outcome)).toEqual(["observed", "observed"]);
    expect(await acknowledgements()).toEqual([...ids].sort());
    expect(result.nextDueAt).toEqual(new Date("2027-01-02T12:00:00Z"));
  });

  it("retries an incomplete month without discarding another month's recovered acknowledgements", async () => {
    const { ids, deps, client } = await fixture();
    let available = false;
    const transport: VerifactuClient = {
      submit: client.submit.bind(client),
      consultar: (header, filter) =>
        !available && filter.Periodo === "01" && filter.ClavePaginacion !== undefined
          ? Promise.reject(new Error("page unavailable"))
          : client.consultar(header, filter),
    };
    const sweep = createReconciliationSweep({ ...deps, resolveClient: staticResolver(transport) });

    const first = await sweep(START);

    expect(first.periods.map(({ month, outcome }) => ({ month, outcome }))).toEqual([
      { month: "12", outcome: "observed" },
      { month: "01", outcome: "unknown" },
    ]);
    expect(first.nextDueAt).toEqual(new Date("2027-02-01T12:05:00Z"));
    expect(await acknowledgements()).toEqual([ids[0]]);
    available = true;
    expect((await sweep(new Date("2027-02-01T12:04:59.999Z"))).periods).toEqual([]);
    const retried = await sweep(new Date("2027-02-01T12:05:00Z"));
    expect(retried.periods.map(({ month, outcome }) => ({ month, outcome }))).toEqual([
      { month: "01", outcome: "observed" },
    ]);
    expect(await acknowledgements()).toEqual([...ids].sort());
    expect(retried.nextDueAt).toEqual(new Date("2027-02-02T12:00:00Z"));
  });

  it("reports unavailable certificate resolution as unknown and does not alter deliveries", async () => {
    const { deps } = await fixture();
    const before = (await suite.db.execute(sql`select * from envios order by registro_id`)).rows;
    const sweep = createReconciliationSweep({
      ...deps,
      resolveClient: async () => {
        throw new Error("certificate unavailable");
      },
    });

    const result = await sweep(START);

    expect(result.periods.map(({ outcome }) => outcome)).toEqual(["unknown", "unknown"]);
    expect(result.nextDueAt).toEqual(new Date("2027-02-01T12:05:00Z"));
    expect(await acknowledgements()).toEqual([]);
    expect((await suite.db.execute(sql`select * from envios order by registro_id`)).rows).toEqual(
      before,
    );
  });

  it("retries a month with a live filing claim instead of treating its checked count as a completed observation", async () => {
    const { deps, ids } = await fixture();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update envios set estado = 'enviando' where registro_id = ${ids[2]}`),
    );
    const sweep = createReconciliationSweep(deps);

    const result = await sweep(START);

    expect(result.periods.map(({ month, outcome }) => ({ month, outcome }))).toEqual([
      { month: "12", outcome: "observed" },
      { month: "01", outcome: "unknown" },
    ]);
    expect(result.periods[1]?.result?.deferred).toEqual([ids[2]]);
    expect(result.nextDueAt).toEqual(new Date("2027-02-01T12:05:00Z"));
    expect(await acknowledgements()).toHaveLength(2);
  });

  it.each(["node", "taxpayer", "environment"] as const)(
    "makes a foreign-only %s scope wait without resolving a certificate",
    async (different) => {
      const { deps } = await fixture();
      let resolved = 0;
      const sweep = createReconciliationSweep({
        ...deps,
        scope: {
          nodeId: different === "node" ? "another-node" : deps.scope.nodeId,
          historyNodeIds: [different === "node" ? "another-node" : deps.scope.nodeId],
          taxpayerId: different === "taxpayer" ? "B87654324" : deps.scope.taxpayerId,
          environment: different === "environment" ? "preproduction" : "production",
        },
        resolveClient: async () => {
          resolved += 1;
          return deps.resolveClient();
        },
      });

      expect(await sweep(START)).toEqual({
        periods: [],
        nextDueAt: new Date("2027-02-02T12:00:00Z"),
      });
      expect(resolved).toBe(0);
      expect(await acknowledgements()).toEqual([]);
    },
  );

  it("shares one in-flight sweep so overlapping triggers cannot overwrite each other's corrections", async () => {
    const { deps, client, ids } = await fixture();
    const entered = gate();
    const release = gate();
    let held = false;
    const sweep = createReconciliationSweep({
      ...deps,
      resolveClient: staticResolver({
        submit: client.submit.bind(client),
        consultar: async (header, filter) => {
          if (!held) {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return client.consultar(header, filter);
        },
      }),
    });
    const first = sweep(START);
    try {
      await entered.promise;
      const second = sweep(START);
      release.resolve();
      expect(await second).toBe(await first);
      expect(await acknowledgements()).toEqual([...ids].sort());
    } finally {
      release.resolve();
      await first;
    }
  });
});

it("abandons an in-flight lookup and starts no later month after stepdown", async () => {
  const { deps, client } = await fixture();
  const controller = new AbortController();
  const started = gate();
  const held = gate();
  const months: string[] = [];
  const delayed: VerifactuClient = {
    ...client,
    consultar: async (header, filter) => {
      months.push(filter.Periodo);
      started.resolve();
      await held.promise;
      return client.consultar(header, filter);
    },
  };
  const sweep = createReconciliationSweep({ ...deps, resolveClient: staticResolver(delayed) });
  const pending = sweep(START, controller.signal);
  try {
    await started.promise;
    controller.abort();
  } finally {
    held.resolve();
  }
  await pending;
  expect(months).toEqual(["12"]);
  expect(await acknowledgements()).toEqual([]);
  expect((await suite.db.execute(sql`select estado from envios order by rowid`)).rows).toEqual([
    { estado: "pendiente" },
    { estado: "pendiente" },
    { estado: "pendiente" },
  ]);
});

it("looks up empty months between its oldest local period and the current month", async () => {
  const { deps, client } = await fixture();
  const asked = new Set<string>();
  const sweep = createReconciliationSweep({
    ...deps,
    includeCurrentPeriod: true,
    resolveClient: staticResolver({
      ...client,
      consultar: async (header, filter) => {
        asked.add(`${filter.Ejercicio}-${filter.Periodo}`);
        return client.consultar(header, filter);
      },
    }),
  });
  const result = await sweep(new Date("2027-03-01T12:00:00Z"));
  expect([...asked]).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
  expect(result.periods.map(({ month, outcome }) => ({ month, outcome }))).toEqual([
    { month: "12", outcome: "observed" },
    { month: "01", outcome: "observed" },
    { month: "02", outcome: "observed" },
    { month: "03", outcome: "observed" },
  ]);
});

it("detects an outside invoice in a fully empty intervening month", async () => {
  const { deps, client } = await fixture();
  const header = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: deps.scope.taxpayerId } };
  const template = (await client.consultar(header, { Ejercicio: "2026", Periodo: "12" }))
    .registros[0]!;
  const sweep = createReconciliationSweep({
    ...deps,
    includeCurrentPeriod: true,
    resolveClient: staticResolver({
      ...client,
      consultar: async (h, filter) => {
        const response = await client.consultar(h, filter);
        return filter.Periodo !== "02"
          ? response
          : {
              ...response,
              registros: [
                {
                  ...template,
                  IDFactura: {
                    ...template.IDFactura,
                    NumSerieFactura: "S1/99",
                    FechaExpedicionFactura: "19-02-2027",
                  },
                  DatosRegistroFacturacion: {
                    ...template.DatosRegistroFacturacion,
                    RefExterna: "outside-empty-month",
                    Huella: "E".repeat(64),
                  },
                },
              ],
            };
      },
    }),
  });
  await sweep(new Date("2027-03-01T12:00:00Z"));
  const conflicts = await withTransaction(suite.db, (tx) =>
    readActiveConflicts(tx, deps.scope.nodeId),
  );
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]!.evidence).toHaveProperty("invoice", {
    IDEmisorFactura: deps.scope.taxpayerId,
    NumSerieFactura: "S1/99",
    FechaExpedicionFactura: "19-02-2027",
  });
});

it("a month only the old box filed in is still a candidate", async () => {
  const old = await seedPendingEnvios(suite.db, { count: 1 });
  const { chain: spare } = await seedPinnedChain(suite.db, old, {
    sifId: randomUUID(),
    firstSecuencia: 50,
    rows: [],
  });
  const aeat = createFakeAeat({ serverNow: START });
  const sweepFor = (historyNodeIds: readonly string[]) =>
    createReconciliationSweep({
      db: suite.db,
      clock: old.clock,
      retryMs: RETRY,
      scope: {
        nodeId: spare.nodeId,
        taxpayerId: old.nif,
        environment: "production",
        historyNodeIds,
      },
      resolveClient: staticResolver(aeat.client()),
    });

  const taken = await sweepFor([spare.nodeId, old.nodeId])(START);
  expect(
    taken.periods.map(({ year, month, result }) => ({ year, month, checked: result?.checked })),
  ).toEqual([{ year: "2026", month: "07", checked: 1 }]);

  // The control: without the old box in its history, the spare box has no month to check.
  expect((await sweepFor([spare.nodeId])(START)).periods).toEqual([]);
});
