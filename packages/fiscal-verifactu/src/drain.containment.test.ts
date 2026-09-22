import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { AppError } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEFAULT_SKIP_RETRY_MS, RECUPERACION_ENVIANDO_MS, drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";

/**
 * `drain()`'s first act is `workIsDue`, which used to ask the database for
 * `envios_work_due(<instant>::timestamptz)` — a PostgreSQL scalar function behind a PostgreSQL
 * cast, and this engine has neither. It is an ordinary query now (`./drain.ts`), and the five cases
 * that were red for that one reason went green without one of them being adjusted:
 * `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.containment.test.ts` reports
 * 7 passed, the two threshold cases at the foot of this file included.
 *
 * The measurement kept from when they were red, because it is what showed the two gaps were
 * SEPARATE and that closing either alone would only have moved the failure:
 *
 * - `select envios_work_due('2026-07-21T00:01:00Z'::timestamptz) as due` → `unrecognized token: ":"`
 * - the same statement with the cast removed → `no such function: envios_work_due`
 * - the control, `select count(*) as n from envios` → no error
 *
 * So the table was there and the connection sound; it was the function and the cast that were not.
 */

// A `now` a minute after the fixtures' fixed `2026-07-21T00:00:00Z`, so the seeded rows are due.
const NOW = new Date("2026-07-21T00:01:00Z");
const SKIP_RETRY_MS = DEFAULT_SKIP_RETRY_MS;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);

/**
 * A client that records whether it was asked for at all. The resolver DECRYPTS the venue's AEAT
 * certificate, so these tests make the RESOLVER the subject rather than the submission: what they
 * can catch is a pass that reaches for a private key it has no work for.
 */
function recordingResolver(): { resolveClient: () => Promise<VerifactuClient>; asked: number } {
  // Submission is not this resolver's subject; a rejection here is contained and lands in
  // `skipped`, which the test below does not read.
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

/**
 * A second database of its own, for the one case below whose subject is an EMPTY one.
 *
 * The dedicated instance this replaces was opened and closed inside the test body. The reason it
 * existed is unchanged — the tests sharing `pg` leave permanently-due rows behind, and "nothing is
 * due" has to be true of the whole database — but the helper owns the lifecycle now, so nothing in
 * this file opens or closes a file itself (CLAUDE.md §4).
 */
const idle = useVenueDb({
  migrations: TEST_MIGRATIONS,
  // Wrapped rather than passed straight through: `seedTenantWithSif` resolves to the seeded till,
  // and `setup` is typed `(db) => Promise<void>`. Nothing here reads the till.
  setup: async (db) => {
    await seedTenantWithSif(db);
  },
});

/**
 * A third, for the one case that CLOSES its database as the experiment.
 *
 * `resetPerTest: false` is required rather than tidy: the helper's `afterEach` empties the tables,
 * and a database the test just closed refuses that with `database is not open`, which would fail
 * the case for a reason unrelated to what it asserts. The helper's `afterAll` still closes and
 * removes it — `StoreHandle.close` is idempotent by construction
 * (`packages/store/src/index.ts:178`), so the second close is a no-op rather than a throw.
 */
const solo = useVenueDb({ migrations: TEST_MIGRATIONS, resetPerTest: false });

describe("drain resolves a client only when it has work", () => {
  it("never asks the resolver when nothing is due", async () => {
    // The negative half, and it is not pedantry: the resolver DECRYPTS a certificate, so resolving
    // one on a pass with no due work would put the venue's private key in memory for nothing.
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
    // A due `pendiente` row whose resolver throws. Before this change there was no try/catch around
    // the sweep at all, so one unresolvable certificate threw straight out of `drain` and the host's
    // pass reported nothing about the duty it had just failed to run.
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });

    const result = await drain(
      {
        db: pg.db,
        resolveClient: () =>
          // `sif.not_registered` — a code this package already declares (./errors.ts), thrown
          // here as a stand-in for whatever a real `resolveClient` implementation can fail
          // with. The assertion below is on `codeOf`'s handling of a STRUCTURED code versus an
          // unstructured throw, not on any one specific failure mode, so any real `AppError`
          // this package owns serves; hand-syncing another package's (e.g. `apps/server`'s)
          // param shape into this test would silently rot the moment that shape changed.
          Promise.reject(new AppError("sif.not_registered", { nodeId: failingSeed.nodeId })),
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped).toEqual([{ errorCode: "sif.not_registered" }]);
    // The pass still counted the work it found, so the host can tell this apart from a no-work
    // pass — what `apps/server`'s awaiting-certificate flag keys off.
    expect(result.tenantsWithWork).toBe(1);
  });

  it("reports the skip-retry interval when the pass was skipped", async () => {
    // `nextDueAt` starts `null`, and only a pass that reaches `drainDue` ever advances it — so a
    // pass that was skipped would otherwise report `null`, meaning "no work will ever be due", and
    // a host sleeping on that stops polling for good.
    //
    // It is equally not `now`: a certificate a human has not provisioned yet produces the same
    // skip every pass, and `now` pins the host's loop at its 5-second MIN_TICK floor indefinitely
    // — the expected state of the first deployment, not a corner case.
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

  // THE FOLD. `drain` used to assign `now` on any skip, which was safe only because `now` is
  // earlier than every gate the pass could compute. `now + skipRetryMs` is not, so it is folded as
  // a MINIMUM — otherwise an abandoned batch would delay a gate the same pass had already computed.
  //
  // The minimum itself — a pass folding TWO instants and reporting the earlier — is pinned in
  // `drain.test.ts`'s "nextDueAt is folded as a minimum, never assigned" describe, which needs a
  // failed submit rather than a skip. What this case pins is the skip arm's own instant.
  it("honours an explicit skipRetryMs rather than a package constant", async () => {
    // Pins that the value is READ from deps, not baked in — the assertion that would fail if the
    // fold quietly used DEFAULT_SKIP_RETRY_MS instead of what the caller passed.
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
    // Narrower than the two tests above on purpose: those prove a REJECTED resolver is contained.
    // This one proves the try/catch in `drain()` wraps the WHOLE unit — resolveClient AND
    // drainDue — not merely the resolveClient call. A resolver that returns a client whose
    // `submit` rejects would NOT prove this: `drainDue` already contains that failure in its
    // OWN inner try/catch (backs the batch off, never rethrows — see `drain.ts`'s own scope note
    // on that catch), so it can never reach this outer one either way, wrapped narrowly or not.
    //
    // What DOES escape `drainDue` is its very FIRST statement, `recoverStaleClaims` (via
    // `withTransaction` -> `db.transaction`), which runs before that inner containment exists at all.
    // Closing the database from inside a SUCCEEDING `resolveClient` — after the due-work check has
    // already run — makes that first statement throw for real, with nothing inside `drainDue`
    // positioned to catch it.
    //
    // A dedicated database, not the suite's own `pg.db`: this test closes its database, which the
    // rest of this suite cannot survive sharing. See `solo`'s own note above.
    const soloDb = solo.db;
    await seedPendingEnvios(soloDb, { count: 1 });

    const result = await drain(
      {
        db: soloDb,
        resolveClient: async () => {
          await soloDb.close();
          // Never actually reached: `drainDue`'s first statement throws before this client is
          // ever asked to do anything.
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
 * The due-work gate's two thresholds, each probed on BOTH sides.
 *
 * `workIsDue` (`./drain.ts`) is the only reader of either, and it is not exported, so these reach
 * it the way production does: through `drain`, reading `tenantsWithWork` — which `drain` increments
 * the moment the gate opens, before it resolves a client. Nothing else in this package pins these
 * two comparisons on this engine. The cases that used to, in `migrations.test.ts`, call the
 * PostgreSQL function `envios_work_due` directly and cannot survive its removal; they are left as
 * they are rather than rewritten here.
 *
 * Both halves of each case are deliberately ordered "not due" first: the due half runs `drainDue`,
 * which claims the row and rewrites it, so it cannot be followed by another read of the same row.
 */
describe("the due-work gate's thresholds", () => {
  it("counts a pendiente row whose next attempt falls exactly on this instant, and not one a millisecond later", async () => {
    // `<=`, not `<`. A row stamped exactly `now` is due NOW — `claimBatch` makes the same
    // comparison, so a gate reading `<` here would leave a claimable row sitting for a whole pass.
    // `proximo_intento_en` is written explicitly rather than taken from the fixture's own default,
    // so this case states the instant it is probing.
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
    // `<`, not `<=`, against a cutoff derived from RECUPERACION_ENVIANDO_MS — the same constant,
    // recomputed the same way, that `recoverStaleClaims` uses. Equal instants are NOT stale, which
    // is what keeps the gate from opening on a row that pass would then decline to recover.
    //
    // A lone `enviando` row, with no `pendiente` row beside it: that is the only shape in which
    // this disjunct decides the answer on its own.
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
