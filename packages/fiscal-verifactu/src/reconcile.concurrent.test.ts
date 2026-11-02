import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { reconcile } from "./reconcile.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const PERIOD = { year: "2026", month: "07" };
const FIRST = new Date("2026-07-21T00:01:00Z");
const SECOND = new Date("2026-07-21T00:02:00Z");

async function fixture() {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const client = aeat.client();
  const send = (now: Date, transport: VerifactuClient = client) =>
    drain(
      {
        db: suite.db,
        resolveClient: staticResolver(transport),
        environment: "production",
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      },
      now,
    );
  await send(FIRST);
  return { seeded, client, send, aeat };
}

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

function afterLookup(client: VerifactuClient, change: () => Promise<void>): VerifactuClient {
  let changed = false;
  return {
    submit: client.submit.bind(client),
    consultar: async (...args) => {
      const response = await client.consultar(...args);
      if (!changed) {
        changed = true;
        await change();
      }
      return response;
    },
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function requeue() {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(
      sql`update envios set estado = 'pendiente', proximo_intento_en = ${FIRST.toISOString()}`,
    );
    await tx.execute(sql`delete from acks`);
  });
}

describe("reconciliation alongside filing", () => {
  it("keeps a newer accepted response after an earlier lookup reported no trace", async () => {
    const { seeded, client, send, aeat } = await fixture();
    for (const key of seeded.facturaKeys) aeat.forget(key);
    let newer: Awaited<ReturnType<typeof snapshot>> | undefined;
    let accepted = 0;
    const lookup = afterLookup(client, async () => {
      await requeue();
      accepted = (await send(SECOND)).recordsAccepted;
      newer = await snapshot();
    });

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(lookup), clock: seeded.clock },
      PERIOD,
    );

    expect(accepted).toBe(3);
    expect(newer!.acknowledgements).toHaveLength(3);
    expect(result.deferred?.sort()).toEqual([...seeded.registroIds].sort());
    expect(await snapshot()).toEqual(newer);
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
  });

  it("does not replace a filing response with the older lookup's lost acknowledgement", async () => {
    const { seeded, client, send } = await fixture();
    await requeue();
    let newer: Awaited<ReturnType<typeof snapshot>> | undefined;
    let sent: Awaited<ReturnType<typeof send>> | undefined;
    const lookup = afterLookup(client, async () => {
      sent = await send(SECOND);
      newer = await snapshot();
    });

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(lookup), clock: seeded.clock },
      PERIOD,
    );

    expect(sent).toMatchObject({ recordsSubmitted: 3, recordsAccepted: 3, skipped: [] });
    expect(newer!.acknowledgements).toHaveLength(3);
    expect(newer!.deliveries.every((row) => row.estado === "aceptado")).toBe(true);
    expect(newer!.deliveries.every((row) => row.intentos === 2)).toBe(true);
    expect(result.deferred?.sort()).toEqual([...seeded.registroIds].sort());
    expect(await snapshot()).toEqual(newer);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
  });

  it("recovers unchanged records while preserving another record's newer refusal", async () => {
    const { seeded, client } = await fixture();
    await requeue();
    const refused = seeded.registroIds[0]!;
    const before = await snapshot();
    const lookup = afterLookup(client, async () => {
      await withTransaction(suite.db, (tx) =>
        tx.execute(sql`update envios set estado = 'rechazado', codigo_error = '1161',
          mensaje_error = 'New filing refusal', intentos = intentos + 1
          where registro_id = ${refused}`),
      );
    });

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(lookup), clock: seeded.clock },
      PERIOD,
    );

    expect(result.lostAck.map((row) => row.recordId).sort()).toEqual(
      seeded.registroIds.slice(1).sort(),
    );
    expect(result.deferred).toEqual([refused]);
    const after = await snapshot();
    expect(after.deliveries.find((row) => row.registro_id === refused)).toMatchObject({
      estado: "rechazado",
      codigo_error: "1161",
      mensaje_error: "New filing refusal",
      intentos: 2,
    });
    expect(after.acknowledgements).toHaveLength(2);
    expect(after.acknowledgements.some((row) => row.registro_id === refused)).toBe(false);
    expect(after.records).toEqual(before.records);
    expect(after.heads).toEqual(before.heads);
    expect(after.incidents).toEqual([]);
    expect(after.cases).toEqual([]);
  });

  it("keeps a newer failed attempt even when its delivery state is still pending", async () => {
    const { seeded, client, send } = await fixture();
    await requeue();
    let newer: Awaited<ReturnType<typeof snapshot>> | undefined;
    let submits = 0;
    const lookup = afterLookup(client, async () => {
      await send(SECOND, {
        consultar: client.consultar.bind(client),
        submit: async () => {
          submits += 1;
          throw new Error("Filing response unavailable");
        },
      });
      newer = await snapshot();
    });

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(lookup), clock: seeded.clock },
      PERIOD,
    );

    expect(submits).toBe(1);
    expect(newer!.deliveries.every((row) => row.estado === "pendiente")).toBe(true);
    expect(newer!.deliveries.every((row) => row.intentos === 2)).toBe(true);
    expect(newer!.acknowledgements).toEqual([]);
    expect(result.deferred?.sort()).toEqual([...seeded.registroIds].sort());
    expect(await snapshot()).toEqual(newer);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
  });

  it("leaves a live filing claim alone until the drainer receives its reply", async () => {
    const { seeded, client, send } = await fixture();
    await requeue();
    const submitted = gate();
    const release = gate();
    const sending = send(SECOND, {
      consultar: client.consultar.bind(client),
      submit: async (...args) => {
        const response = await client.submit(...args);
        submitted.resolve();
        await release.promise;
        return response;
      },
    });
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    let during: Awaited<ReturnType<typeof snapshot>> | undefined;
    let result: Awaited<ReturnType<typeof reconcile>> | undefined;
    let sent: Awaited<typeof sending> | undefined;
    try {
      await Promise.race([
        submitted.promise,
        sending.then(() => {
          throw new Error("Drain ended without reaching its held response");
        }),
      ]);
      before = await snapshot();
      result = await reconcile(
        { db: suite.db, resolveClient: staticResolver(client), clock: seeded.clock },
        PERIOD,
      );
      during = await snapshot();
    } finally {
      release.resolve();
      sent = await sending;
    }

    expect(before!.deliveries.every((row) => row.estado === "enviando")).toBe(true);
    expect(before!.acknowledgements).toEqual([]);
    expect(during).toEqual(before);
    expect(result!.deferred?.sort()).toEqual([...seeded.registroIds].sort());
    expect(result!.lostAck).toEqual([]);
    expect(result!.noTrace).toEqual([]);
    expect(result!.drift).toEqual([]);
    expect(result!.incidentsRaised).toBe(0);
    expect(sent).toMatchObject({ recordsAccepted: 3, skipped: [] });
    const finished = await snapshot();
    expect(finished.deliveries.every((row) => row.estado === "aceptado")).toBe(true);
    expect(finished.acknowledgements).toHaveLength(3);
    expect(finished.records).toEqual(before!.records);
    expect(finished.heads).toEqual(before!.heads);
  });

  it("defers records whose delivery rows disappeared during the lookup", async () => {
    const { seeded, client } = await fixture();
    await requeue();
    let newer: Awaited<ReturnType<typeof snapshot>> | undefined;
    const lookup = afterLookup(client, async () => {
      await withTransaction(suite.db, (tx) => tx.execute(sql`delete from envios`));
      newer = await snapshot();
    });

    const result = await reconcile(
      { db: suite.db, resolveClient: staticResolver(lookup), clock: seeded.clock },
      PERIOD,
    );

    expect(newer!.deliveries).toEqual([]);
    expect(newer!.acknowledgements).toEqual([]);
    expect(result.deferred?.sort()).toEqual([...seeded.registroIds].sort());
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await snapshot()).toEqual(newer);
  });
});
