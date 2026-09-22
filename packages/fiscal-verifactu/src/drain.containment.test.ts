import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { AppError } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";

/**
 * **Every case in this file is RED, and none of them is red for a reason inside this file.**
 *
 * `drain()`'s first act is `workIsDue`, which asks the database for
 * `envios_work_due(<instant>::timestamptz)` (`./drain.ts:148`) — a PostgreSQL scalar function
 * behind a PostgreSQL cast, and this engine has neither. Measured against a database migrated by
 * `TEST_MIGRATIONS`, with a control in the other direction:
 *
 * - `select envios_work_due('2026-07-21T00:01:00Z'::timestamptz) as due` → `unrecognized token: ":"`
 * - the same statement with the cast removed → `no such function: envios_work_due`
 * - the control, `select count(*) as n from envios` → no error
 *
 * So the table is there and the connection is sound; it is the function and the cast that are not,
 * and removing only the cast would not be enough. Nothing in `packages/fiscal-verifactu/drizzle/`
 * or `packages/store` defines `envios_work_due` on this engine (grepped 2026-09-22). Converting
 * `drain.ts` is product work, not test work, so these cases are left failing rather than adjusted:
 * the moment `drain()` runs here, they should go green unchanged.
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
