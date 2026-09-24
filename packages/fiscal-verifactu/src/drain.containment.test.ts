import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { AppError } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEFAULT_SKIP_RETRY_MS, RECUPERACION_ENVIANDO_MS, drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";

// A `now` a minute after the fixtures' fixed `2026-07-21T00:00:00Z`, so the seeded rows are due.
const NOW = new Date("2026-07-21T00:01:00Z");
const SKIP_RETRY_MS = DEFAULT_SKIP_RETRY_MS;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);

/**
 * A client that records whether it was asked for at all. The resolver DECRYPTS the venue's AEAT
 * certificate, so these tests make the RESOLVER the subject: they catch a pass that reaches for a
 * private key it has no work for.
 */
function recordingResolver(): { resolveClient: () => Promise<VerifactuClient>; asked: number } {
  const client: VerifactuClient = {
    submit: () => Promise.reject(new Error("submission is not this test's subject")),
    consultar: () => Promise.reject(new Error("consulta is not this test's subject")),
  };
  const state = {
    asked: 0,
    resolveClient: () => {
      state.asked += 1;
      return Promise.resolve(client);
    },
  };
  return state;
}

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

/** A second database, for the one case whose subject is an EMPTY one. */
const idle = useVenueDb({
  migrations: TEST_MIGRATIONS,
  // Wrapped: `seedTenantWithSif` resolves to the seeded till, and `setup` returns `Promise<void>`.
  setup: async (db) => {
    await seedTenantWithSif(db);
  },
});

/**
 * A third, for the one case that CLOSES its database as the experiment. `resetPerTest: false`
 * because the helper's `afterEach` would fail on the closed database; `StoreHandle.close` is
 * idempotent, so the helper's own `afterAll` close is a no-op.
 */
const solo = useVenueDb({ migrations: TEST_MIGRATIONS, resetPerTest: false });

describe("drain resolves a client only when it has work", () => {
  it("never asks the resolver when nothing is due", async () => {
    // `idle` is seeded with a venue, a till and a SIF, but no envios.
    const resolver = recordingResolver();
    const result = await drain(
      {
        db: idle.db,
        resolveClient: resolver.resolveClient,
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );
    expect(resolver.asked).toBe(0);
    expect(result.tenantsWithWork).toBe(0);
  });

  it("reports a pass whose client cannot be resolved, rather than throwing out of the sweep", async () => {
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });

    const result = await drain(
      {
        db: pg.db,
        resolveClient: () =>
          // Any `AppError` this package owns will do: the subject is a structured code being
          // reported, not this particular failure.
          Promise.reject(new AppError("sif.not_registered", { nodeId: failingSeed.nodeId })),
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped).toEqual([{ errorCode: "sif.not_registered" }]);
    // Counted anyway, so the host can tell this apart from a pass with no work.
    expect(result.tenantsWithWork).toBe(1);
  });

  it("reports the skip-retry interval when the pass was skipped", async () => {
    // Without folding in `now + skipRetryMs` a skipped pass would report `null`, and a host
    // sleeping on it stops polling for good. Not `now` either: see `DrainResult.nextDueAt` in
    // `packages/fiscal/src/backend.ts` (fold, never assign).
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });

    const result = await drain(
      {
        db: pg.db,
        resolveClient: () =>
          Promise.reject(new AppError("sif.not_registered", { nodeId: failingSeed.nodeId })),
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped).toEqual([{ errorCode: "sif.not_registered" }]);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // What this case pins is the skip arm's own instant; the minimum over two instants is pinned in
  // `drain.test.ts`'s "drain — nextDueAt is folded as a minimum, never assigned" describe.
  it("honours an explicit skipRetryMs rather than a package constant", async () => {
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });

    const result = await drain(
      {
        db: pg.db,
        resolveClient: () =>
          Promise.reject(new AppError("sif.not_registered", { nodeId: failingSeed.nodeId })),
        skipRetryMs: 90_000,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped).toEqual([{ errorCode: "sif.not_registered" }]);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 90_000));
  });

  it("reports a failure when drainDue itself throws, not only when the resolver does", async () => {
    // Proves the try/catch in `drain()` wraps `drainDue` too, not only `resolveClient`. A rejecting
    // `submit` would not prove it: `drainDue` contains that failure itself. Closing the database
    // inside a succeeding `resolveClient` makes `drainDue`'s first statement throw instead.
    const soloDb = solo.db;
    await seedPendingEnvios(soloDb, { count: 1 });

    const result = await drain(
      {
        db: soloDb,
        resolveClient: async () => {
          await soloDb.close();
          return {
            submit: () => Promise.reject(new Error("unreachable")),
            consultar: () => Promise.reject(new Error("unreachable")),
          };
        },
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    // `codeOf`'s fallback: the driver's own error on a closed database is not an `AppError`.
    expect(result.skipped).toEqual([{ errorCode: "unknown" }]);
  });
});

/**
 * The due-work gate's two thresholds, each probed on BOTH sides, through `drain`'s
 * `tenantsWithWork` since `workIsDue` is not exported.
 *
 * Each case probes "not due" first: the due half claims and rewrites the row.
 */
describe("the due-work gate's thresholds", () => {
  it("counts a pendiente row whose next attempt falls exactly on this instant, and not one a millisecond later", async () => {
    // `<=`, not `<`: `claimBatch` makes the same comparison, so `<` here would leave a claimable
    // row sitting for a whole pass.
    await seedPendingEnvios(pg.db, { count: 1 });
    await pg.db.execute(sql`
      update envios set estado = 'pendiente', proximo_intento_en = ${NOW.toISOString()}
    `);

    const early = recordingResolver();
    const notYet = await drain(
      {
        db: pg.db,
        resolveClient: early.resolveClient,
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      new Date(NOW.getTime() - 1),
    );
    expect(notYet.tenantsWithWork).toBe(0);
    expect(early.asked).toBe(0);

    const onTime = recordingResolver();
    const due = await drain(
      {
        db: pg.db,
        resolveClient: onTime.resolveClient,
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );
    expect(due.tenantsWithWork).toBe(1);
    expect(onTime.asked).toBe(1);
  });

  it("counts a lone enviando row past RECUPERACION_ENVIANDO_MS, and not one exactly at it", async () => {
    // `<`, not `<=`, the same cutoff `recoverStaleClaims` computes. A lone `enviando` row is the
    // only shape in which this disjunct decides the answer on its own.
    await seedPendingEnvios(pg.db, { count: 1 });
    await pg.db.execute(sql`
      update envios set estado = 'enviando',
        enviado_en = ${new Date(NOW.getTime() - RECUPERACION_ENVIANDO_MS).toISOString()}
    `);

    const exact = recordingResolver();
    const notYet = await drain(
      {
        db: pg.db,
        resolveClient: exact.resolveClient,
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );
    expect(notYet.tenantsWithWork).toBe(0);
    expect(exact.asked).toBe(0);

    await pg.db.execute(sql`
      update envios set estado = 'enviando',
        enviado_en = ${new Date(NOW.getTime() - RECUPERACION_ENVIANDO_MS - 1).toISOString()}
    `);

    const stale = recordingResolver();
    const due = await drain(
      {
        db: pg.db,
        resolveClient: stale.resolveClient,
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );
    expect(due.tenantsWithWork).toBe(1);
    expect(stale.asked).toBe(1);
  });
});
