import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";

// The same pair of instants `drain.test.ts` uses: the fake AEAT's `serverNow`, and a `now` one
// minute later so the seeded rows are due.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const NOW = new Date("2026-07-21T00:01:00Z");
const SKIP_RETRY_MS = DEFAULT_SKIP_RETRY_MS;
const AFTER_SKIP_RETRY = new Date(NOW.getTime() + SKIP_RETRY_MS);

/**
 * A client that records which tenant asked for it. `drain` took ONE client for every tenant it
 * swept, so under per-tenant certificates it presented tenant B's invoices with tenant A's seal.
 * These tests are the ones that could have caught that, and they only can because they make the
 * RESOLVER the subject rather than the submission.
 */
function recordingResolver(): {
  resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
  asked: TenantId[];
} {
  const asked: TenantId[] = [];
  // Submission is not this resolver's subject; a rejection here is contained per tenant and lands in
  // `skipped`, which the test below does not read.
  const client: VerifactuClient = {
    submit: () => Promise.reject(new Error("submission is not this test's subject")),
    consultar: () => Promise.reject(new Error("consulta is not this test's subject")),
  };
  return {
    asked,
    resolveClient: (tenantId) => {
      asked.push(tenantId);
      return Promise.resolve(client);
    },
  };
}

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

describe("drain resolves one client per tenant", () => {
  it("never asks the resolver for a tenant with no due work", async () => {
    // The negative half, and it is not pedantry: the resolver DECRYPTS a certificate, so asking for
    // one per known tenant rather than per tenant-with-work would put every tenant's private key in
    // memory on every pass, for nothing. Asserted against a specific idle tenant rather than an
    // empty list, so the test does not depend on running before the seeding one.
    const { tenantId: idle } = await seedTenantWithSif(pg.db);
    const { resolveClient, asked } = recordingResolver();
    await drain(
      { db: pg.db, resolveClient, skipRetryMs: SKIP_RETRY_MS, environment: "production" },
      NOW,
    );
    expect(asked).not.toContain(idle);
  });

  it("reports a tenant whose client cannot be resolved, and keeps sweeping the rest", async () => {
    // Two tenants, each with a due `pendiente` row; the first tenant's resolver throws. Before this
    // change there was no try/catch around the per-tenant sweep at all, so one unresolvable
    // certificate aborted every OTHER tenant's legally-timed submission.
    //
    // `seedPendingEnvios` seeds its OWN tenant (through `seedTenantWithSif`), so two calls give two
    // tenants each with due work — no new fixture, and no second copy of a NOT NULL column list.
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });
    const failing = failingSeed.tenantId;
    const working = (await seedPendingEnvios(pg.db, { count: 1 })).tenantId;
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });

    const calls: TenantId[] = [];
    const result = await drain(
      {
        db: pg.db,
        resolveClient: (tenantId) => {
          calls.push(tenantId);
          if (tenantId === failing) {
            // `sif.not_registered` — a code this package already declares (./errors.ts), thrown
            // here as a stand-in for whatever a real `resolveClient` implementation can fail
            // with. The assertion below is on `codeOf`'s handling of a STRUCTURED code versus an
            // unstructured throw, not on any one specific failure mode, so any real `AppError`
            // this package owns serves; hand-syncing another package's (e.g. `apps/server`'s)
            // param shape into this test would silently rot the moment that shape changed.
            return Promise.reject(
              new AppError("sif.not_registered", {
                tenantId,
                tillId: failingSeed.tillId,
              }),
            );
          }
          // The fake AEAT, so the working tenant genuinely SUBMITS and is accepted. A client whose
          // submit rejected would prove nothing here: the assertion that matters is that real work
          // completed for the second tenant after the first one failed.
          return Promise.resolve(aeat.client());
        },
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(calls).toContain(failing);
    expect(calls).toContain(working);
    expect(result.skipped).toEqual([{ tenantId: failing, errorCode: "sif.not_registered" }]);
    // The load-bearing assertion, made order-free and tenant-specific. `envios_tenants_with_work`
    // carries no ORDER BY, so `failing`/`working` may be enumerated in either order. Reading an
    // AGGREGATE count (`result.recordsAccepted`) would force a reader to first work out that
    // `failing` can never contribute to it — true here only because its resolver rejects BEFORE
    // `drainTenant` ever runs for it — before trusting what the number proves. Querying the
    // WORKING tenant's own envío row directly instead proves, with no such detour, that THIS
    // tenant's due work reached AEAT and was accepted — the whole point of the containment.
    const workingRows = await withTenant(pg.db, working, (tx) =>
      tx.execute<{ estado: string }>(sql`select estado from envios where tenant_id = ${working}`),
    );
    expect(workingRows.rows.map((r) => r.estado)).toEqual(["aceptado"]);
  });

  it("reports the skip-retry interval when every due tenant this pass was skipped", async () => {
    // `nextDueAt` starts `null`, and only a tenant that reaches `drainTenant` ever advances it —
    // so a pass in which every due tenant was skipped would otherwise report `null`, meaning "no
    // work will ever be due", and a host sleeping on that stops polling for good.
    //
    // It is equally not `now`: a certificate a human has not provisioned yet produces the same
    // skip every pass, and `now` pins the host's loop at its 5-second MIN_TICK floor indefinitely
    // — the expected state of the first deployment, not a corner case.
    //
    // Asserted with `.some(...)` rather than an exact `toEqual` on the whole `skipped` array: this
    // suite shares one PGlite database across tests, so other tests' tenants may also be due. The
    // two facts this test owns — the failing tenant appearing among `skipped`, and `nextDueAt`
    // landing on the interval — hold regardless of what else got swept.
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });
    const failing = failingSeed.tenantId;

    const result = await drain(
      {
        db: pg.db,
        resolveClient: (tenantId) =>
          Promise.reject(
            new AppError("sif.not_registered", { tenantId, tillId: failingSeed.tillId }),
          ),
        skipRetryMs: SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped.some((s) => s.tenantId === failing)).toBe(true);
    expect(result.nextDueAt).toEqual(AFTER_SKIP_RETRY);
  });

  // THE FOLD. `drain` used to assign `now` on any skip, which was safe only because `now` is
  // earlier than every gate a successful tenant could compute. `now + skipRetryMs` is not, so it
  // is folded as a MINIMUM — otherwise a skipped tenant would delay a healthy tenant's own gate.
  //
  // The genuinely-successful-tenant version of this test moved to `drain.fold.test.ts`: wiring a
  // tenant that actually submits through the fake AEAT into THIS suite, alongside a skip, needs
  // fixture work beyond this task (the suite's own `pg.db` already carries permanently-pending
  // tenants from the tests above, and `recordingResolver`'s client rejects every submit — it
  // cannot produce a successful side at all). `drain.fold.test.ts` instead uses a tenant whose own
  // `envio_flujo` gate is hand-seeded 30s out — no network round trip needed to prove the fold.
  it("honours an explicit skipRetryMs rather than a package constant", async () => {
    // Pins that the value is READ from deps, not baked in — the assertion that would fail if the
    // fold quietly used DEFAULT_SKIP_RETRY_MS instead of what the caller passed. Every tenant
    // enumerated this pass (this test's own `failing`, plus any left permanently `pendiente` by
    // earlier tests in this shared database) is skipped by this unconditionally-rejecting resolver, so
    // `nextDueAt` folds from `null`, landing exactly on `now + 90_000` regardless of how many.
    const failingSeed = await seedPendingEnvios(pg.db, { count: 1 });
    const failing = failingSeed.tenantId;

    const result = await drain(
      {
        db: pg.db,
        resolveClient: (tenantId) =>
          Promise.reject(
            new AppError("sif.not_registered", { tenantId, tillId: failingSeed.tillId }),
          ),
        skipRetryMs: 90_000,
        environment: "production",
      },
      NOW,
    );

    expect(result.skipped.some((s) => s.tenantId === failing)).toBe(true);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 90_000));
  });

  it("reports a tenant when drainTenant itself throws, not only when the resolver does", async () => {
    // Narrower than the two tests above on purpose: those prove a REJECTED resolver is contained.
    // This one proves the try/catch in `drain()` wraps the WHOLE per-tenant unit — resolveClient
    // AND drainTenant — not merely the resolveClient call. A resolver that returns a client whose
    // `submit` rejects would NOT prove this: `drainTenant` already contains that failure in its
    // OWN inner try/catch (backs the batch off, never rethrows — see `drain.ts`'s own scope note
    // on that catch), so it can never reach this outer one either way, wrapped narrowly or not.
    //
    // What DOES escape `drainTenant` is its very FIRST statement, `recoverStaleClaims` (via
    // `withTenant` -> `db.transaction`), which runs before that inner containment exists at all.
    // Closing the database from inside a SUCCEEDING `resolveClient` — after `tenantsWithWork`'s
    // own enumeration has already completed and captured this tenant — makes that first statement
    // throw for real, with nothing inside `drainTenant` positioned to catch it.
    //
    // A dedicated, single-tenant PGlite instance, not the suite's own `pg.db`: this test closes
    // its database, which the rest of this suite cannot survive sharing.
    const soloDb = await createPgliteDb();
    await runMigrations(soloDb, CORE_MIGRATIONS);
    await runMigrations(soloDb, FISCAL_MIGRATIONS);
    const failing = (await seedPendingEnvios(soloDb, { count: 1 })).tenantId;

    const result = await drain(
      {
        db: soloDb,
        resolveClient: async () => {
          await soloDb.close();
          // Never actually reached: `drainTenant`'s first statement throws before this client is
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

    // `codeOf`'s fallback: PGlite's own error on a closed instance is not an `AppError`.
    expect(result.skipped).toEqual([{ tenantId: failing, errorCode: "unknown" }]);
  });
});
