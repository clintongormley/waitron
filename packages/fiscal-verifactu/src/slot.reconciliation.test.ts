import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { drain } from "./drain.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { mtlsFetch } from "./aeat-transport.js";
import { FISCAL_SLOT } from "./slot.js";

vi.mock("./aeat-transport.js", async (original) => ({
  ...(await original<typeof import("./aeat-transport.js")>()),
  mtlsFetch: vi.fn(() => {
    throw new Error("no real authority network in tests");
  }),
}));
afterEach(() => vi.mocked(mtlsFetch).mockReset());
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:00:00Z");
const RETRY = 300_000;
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

async function fixture() {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const authority = createFakeAeat({ serverNow: NOW, tiempoEsperaInicial: 5 });
  await drain(
    {
      db: suite.db,
      resolveClient: staticResolver(authority.client()),
      environment: "production",
      skipRetryMs: RETRY,
    },
    NOW,
  );
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(sql`update envios set estado = 'pendiente'`);
    await tx.execute(sql`delete from acks`);
  });
  await sealAeatSecret(
    { db: suite.db, ring, nodeId: seeded.nodeId },
    {
      pfxBase64: Buffer.from("test certificate").toString("base64"),
      passphrase: "test",
      certKind: "sello",
    },
  );
  const deps = {
    db: suite.db,
    ring,
    nodeId: seeded.nodeId,
    clock: seeded.clock,
    environment: "production" as const,
    skipRetryMs: RETRY,
  };
  return { seeded, authority, deps };
}

async function states() {
  return (await suite.db.execute(sql`select estado from envios order by registro_id`)).rows;
}

describe("the module-owned runtime reconciliation seat", () => {
  it("recovers a lost acknowledgement through the real SOAP client and closes its transport", async () => {
    const { authority, deps } = await fixture();
    const close = vi.fn(async () => {});
    vi.mocked(mtlsFetch).mockReturnValue({ fetch: authority.fetch, close });
    expect(FISCAL_SLOT.createReconciliation).toBeTypeOf("function");
    const run = FISCAL_SLOT.createReconciliation!(deps);
    const result = await run(NOW);
    expect(await states()).toEqual([{ estado: "aceptado" }]);
    expect((await suite.db.execute(sql`select count(*) as n from acks`)).rows).toEqual([{ n: 1 }]);
    expect(result.nextDueAt).toEqual(new Date("2026-07-22T00:00:00Z"));
    expect(close).toHaveBeenCalledTimes(1);
    await run(new Date("2026-07-21T00:01:00Z"));
    expect(mtlsFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused lookup unknown, releases its pool, and retries with a fresh transport", async () => {
    const { authority, deps } = await fixture();
    const failedClose = vi.fn(async () => {}),
      goodClose = vi.fn(async () => {});
    vi.mocked(mtlsFetch)
      .mockReturnValueOnce({
        fetch: async () => {
          throw new Error("offline");
        },
        close: failedClose,
      })
      .mockReturnValueOnce({ fetch: authority.fetch, close: goodClose });
    expect(FISCAL_SLOT.createReconciliation).toBeTypeOf("function");
    const run = FISCAL_SLOT.createReconciliation!(deps);
    const unknown = await run(NOW);
    expect(unknown.nextDueAt).toEqual(new Date("2026-07-21T00:05:00Z"));
    expect(await states()).toEqual([{ estado: "pendiente" }]);
    expect(failedClose).toHaveBeenCalledTimes(1);
    await run(new Date("2026-07-21T00:05:00Z"));
    expect(await states()).toEqual([{ estado: "aceptado" }]);
    expect(goodClose).toHaveBeenCalledTimes(1);
  });

  it("uses the venue taxpayer instead of choosing an issuer from stored monthly rows", async () => {
    const { deps } = await fixture();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update tenants set tax_id = '89890001K' where id = 1`),
    );
    expect(FISCAL_SLOT.createReconciliation).toBeTypeOf("function");
    await FISCAL_SLOT.createReconciliation!(deps)(NOW);
    expect(await states()).toEqual([{ estado: "pendiente" }]);
    expect(mtlsFetch).not.toHaveBeenCalled();
  });
});

it("refuses a missing venue taxpayer without opening an authority transport", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 0 });
  await withTransaction(suite.db, (tx) => tx.execute(sql`delete from tenants`));
  const run = FISCAL_SLOT.createReconciliation!({
    db: suite.db,
    ring,
    nodeId: seeded.nodeId,
    clock: seeded.clock,
    environment: "production",
    skipRetryMs: RETRY,
  });
  await expect(run(NOW)).rejects.toThrow("reconciliation requires the venue taxpayer");
  expect(mtlsFetch).not.toHaveBeenCalled();
});

it.each(["node", "environment"])(
  "excludes another %s from the runtime lookup",
  async (different) => {
    const { deps } = await fixture();
    const run = FISCAL_SLOT.createReconciliation!({
      ...deps,
      nodeId: different === "node" ? "another-node" : deps.nodeId,
      environment: different === "environment" ? "preproduction" : deps.environment,
    });
    await run(NOW);
    expect(await states()).toEqual([{ estado: "pendiente" }]);
    expect(mtlsFetch).not.toHaveBeenCalled();
  },
);

it("shares a pending lookup and keeps its transports separate from a concurrent submission", async () => {
  const { authority, deps } = await fixture();
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const lookupClose = vi.fn(async () => {}),
    drainClose = vi.fn(async () => {});
  let started = false;
  vi.mocked(mtlsFetch)
    .mockReturnValueOnce({
      fetch: async (input, init) => {
        started = true;
        await held;
        return authority.fetch(input, init);
      },
      close: lookupClose,
    })
    .mockReturnValueOnce({ fetch: authority.fetch, close: drainClose });
  const run = FISCAL_SLOT.createReconciliation!(deps);
  const first = run(NOW),
    second = run(NOW);
  try {
    expect(first).toBe(second);
    await vi.waitFor(() => expect(started).toBe(true));
    const sent = await FISCAL_SLOT.drain(deps, new Date("2026-07-21T00:00:05Z"));
    expect(sent.recordsAccepted).toBe(1);
    expect(await states()).toEqual([{ estado: "aceptado" }]);
    expect(drainClose).toHaveBeenCalledTimes(1);
    expect(lookupClose).not.toHaveBeenCalled();
  } finally {
    release();
    await first;
  }
  expect(lookupClose).toHaveBeenCalledTimes(1);
  expect(mtlsFetch).toHaveBeenCalledTimes(2);
});

it("reports unknown then observed without calling either a freshness guarantee", async () => {
  const { authority, deps } = await fixture();
  const log = vi.fn();
  vi.mocked(mtlsFetch)
    .mockReturnValueOnce({
      fetch: async () => {
        throw new Error("offline");
      },
      close: async () => {},
    })
    .mockReturnValueOnce({ fetch: authority.fetch, close: async () => {} });
  const run = FISCAL_SLOT.createReconciliation!({ ...deps, log });
  await run(NOW);
  expect(log).toHaveBeenCalledWith(
    "warn",
    "fiscal.reconciliation_observed",
    expect.objectContaining({
      year: "2026",
      month: "07",
      outcome: "unknown",
      errorCode: "unknown",
    }),
  );
  await run(new Date("2026-07-21T00:05:00Z"));
  expect(log).toHaveBeenCalledWith(
    "info",
    "fiscal.reconciliation_observed",
    expect.objectContaining({
      year: "2026",
      month: "07",
      outcome: "observed",
      checked: 1,
      deferred: 0,
    }),
  );
  expect(await states()).toEqual([{ estado: "aceptado" }]);
});

it("restarts the scoped schedule if the venue taxpayer changes", async () => {
  const { authority, deps } = await fixture();
  vi.mocked(mtlsFetch).mockReturnValue({ fetch: authority.fetch, close: async () => {} });
  const run = FISCAL_SLOT.createReconciliation!(deps);
  await run(NOW);
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`update tenants set tax_id = '89890001K' where id = 1`),
  );
  const result = await run(new Date("2026-07-21T00:01:00Z"));
  expect(result.nextDueAt).toEqual(new Date("2026-07-22T00:01:00Z"));
  expect(mtlsFetch).toHaveBeenCalledTimes(1);
});

it("still closes the transport if the observation log throws", async () => {
  const { authority, deps } = await fixture();
  const close = vi.fn(async () => {});
  vi.mocked(mtlsFetch).mockReturnValue({ fetch: authority.fetch, close });
  const failure = new Error("log failed");
  const run = FISCAL_SLOT.createReconciliation!({
    ...deps,
    log: () => {
      throw failure;
    },
  });
  await expect(run(NOW)).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await states()).toEqual([{ estado: "aceptado" }]);
});
