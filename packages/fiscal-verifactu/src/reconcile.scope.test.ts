import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { insertPendingAlta, seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { envios } from "./schema/envios.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { reconcile } from "./reconcile.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const PERIOD = { year: "2026", month: "07" };
const NOW = new Date("2026-07-21T00:01:00Z");

async function snapshot() {
  return {
    deliveries: (await suite.db.execute(sql`select * from envios order by registro_id`)).rows,
    acknowledgements: (await suite.db.execute(sql`select * from acks order by registro_id`)).rows,
    incidents: (await suite.db.execute(sql`select * from incidents order by id`)).rows,
    cases: (await suite.db.execute(sql`select * from filing_cases order by id`)).rows,
    records: (await suite.db.execute(sql`select * from registros_facturacion order by id`)).rows,
    heads: (await suite.db.execute(sql`select * from cadenas order by node_id`)).rows,
  };
}

describe("a runtime reconciliation's node, taxpayer and environment", () => {
  it("resubmits only its own accepted record when the authority has no trace", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const otherNode = await seedSecondChain(suite.db, seeded, 2);
    const excluded = [otherNode.registroId];
    for (const [index, entorno, nif] of [
      [3, "preproduction", seeded.nif],
      [4, null, seeded.nif],
      [5, "production", "B87654324"],
    ] as const) {
      const row = await insertPendingAlta(suite.db, {
        ...seeded,
        secuencia: index,
        huella: String(index).padStart(64, "0"),
        fecha: "2026-07-20",
        entorno,
        nif,
      });
      excluded.push(row.registroId);
      await suite.db.insert(envios).values({ registroId: row.registroId });
    }
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update envios set estado = 'aceptado', csv = 'kept-csv'`),
    );
    const before = await snapshot();
    const aeat = createFakeAeat({ serverNow: NOW });
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(aeat.client()),
      clock: seeded.clock,
      scope: {
        nodeId: seeded.nodeId,
        historyNodeIds: [seeded.nodeId],
        taxpayerId: seeded.nif,
        environment: "production" as const,
      },
    };

    const result = await reconcile(deps, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.noTrace).toEqual([
      { recordId: seeded.registroIds[0], localState: "aceptado", reportedState: null },
    ]);
    const after = await snapshot();
    expect(after.deliveries.filter((row) => excluded.includes(String(row.registro_id)))).toEqual(
      before.deliveries.filter((row) => excluded.includes(String(row.registro_id))),
    );
    expect(after.deliveries.find((row) => row.registro_id === seeded.registroIds[0])).toMatchObject(
      {
        estado: "pendiente",
        csv: null,
        reconciled_resubmit_at: seeded.clock.now().instant.toISOString(),
      },
    );
    expect(after.records).toEqual(before.records);
    expect(after.heads).toEqual(before.heads);
    expect(after.incidents).toEqual(before.incidents);
    expect(after.cases).toEqual(before.cases);
  });

  it.each(["node", "taxpayer", "environment"] as const)(
    "does not open a transport when only another %s has deliveries",
    async (different) => {
      const seeded = await seedPendingEnvios(suite.db, { count: 1 });
      const before = await snapshot();
      let opened = 0;
      const aeat = createFakeAeat({ serverNow: NOW });
      const deps = {
        db: suite.db,
        resolveClient: async () => {
          opened += 1;
          return aeat.client();
        },
        clock: seeded.clock,
        scope: {
          nodeId: different === "node" ? "another-node" : seeded.nodeId,
          historyNodeIds: [different === "node" ? "another-node" : seeded.nodeId],
          taxpayerId: different === "taxpayer" ? "B87654324" : seeded.nif,
          environment:
            different === "environment" ? ("preproduction" as const) : ("production" as const),
        },
      };

      expect(await reconcile(deps, PERIOD)).toEqual({
        year: "2026",
        month: "07",
        checked: 0,
        lostAck: [],
        noTrace: [],
        drift: [],
        incidentsRaised: 0,
      });
      expect(opened).toBe(0);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("recovers every matching lost acknowledgement after all authority pages", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const aeat = createFakeAeat({ serverNow: NOW, consultaPageSize: 1 });
    const client = aeat.client();
    await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(client),
        environment: "production",
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      },
      NOW,
    );
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update envios set estado = 'pendiente'`);
      await tx.execute(sql`delete from acks`);
    });
    const before = await snapshot();
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(client),
      clock: seeded.clock,
      scope: {
        nodeId: seeded.nodeId,
        historyNodeIds: [seeded.nodeId],
        taxpayerId: seeded.nif,
        environment: "production" as const,
      },
    };

    const result = await reconcile(deps, PERIOD);

    expect(result.checked).toBe(3);
    expect(result.lostAck.map((row) => row.recordId).sort()).toEqual(
      [...seeded.registroIds].sort(),
    );
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    const after = await snapshot();
    expect(after.acknowledgements).toHaveLength(3);
    expect(after.deliveries.map((row) => row.estado)).toEqual(["aceptado", "aceptado", "aceptado"]);
    expect(after.records).toEqual(before.records);
    expect(after.heads).toEqual(before.heads);
  });
});
