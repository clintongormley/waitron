import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { credentialProvisioned, loadKeyRing, putCredential } from "@waitron/credentials";
import { DEFAULTS, runDue } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import type Stripe from "stripe";
import { createLogger } from "./logger.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { runPass, RECONCILE_DUTY } from "./pass.js";
import { stripeAccountResolver } from "./stripe-account.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

/**
 * One composed scheduler pass against a real migrated database.
 *
 * Named `pass.db.test.ts` for the one thing that separates it from its sibling: it opens a migrated
 * database and runs the REAL drain and reconcile duties against it, where `pass.test.ts` hands
 * `runPass` inline fake duties and opens no database at all — `grep -c useVenueDb
 * apps/server/src/pass.test.ts` prints 0 (run 2026-09-22).
 *
 * ## The role this file was built around is gone, and is replaced by nothing
 *
 * **SQLite has no roles**, so both cases now run on the one venue handle. What is no longer checked
 * by anything: that the deployment role can reach the vault, the reconcile tables and the scheduler
 * ledger, and no further. The two cases keep their assertions unchanged; only the handle they run
 * on changed.
 *
 * The `nonInfo` assertion in the first case was doing double duty and now does single duty. It was
 * the outside-in signal for a MISSING GRANT, because `runDue` folds a permission-denied error into
 * `TickResult.skipped` and logs a warning instead of throwing. There is no permission-denied error
 * on this engine, so what the assertion still catches is any other cause of a skip or defer.
 *
 * ## Both cases were RED on a BROKEN PRODUCT FUNCTION, and both pass now
 *
 * `credentialProvisioned` (`packages/credentials/src/store.ts`) was `select credential_tenants(?)`.
 * That function was created by a PostgreSQL-only migration this branch deleted; the SQLite
 * credentials baseline creates the table and nothing else, and SQLite has no user-defined SQL
 * functions. The disposition document records this as "BLOCKER 2", and
 * `packages/credentials/src/credentials.test.ts` carried the same red cases from the other side.
 * It is an ordinary query now and both cases below pass unadjusted.
 *
 * They were kept, converted and red, rather than deleted, because this is the ONLY suite that runs
 * `runPass` against a real database — `pass.test.ts` beside it is all fakes — so deleting them
 * would have left the composed drain + reconcile + ledger pass covered by nothing.
 */
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const NOW = new Date("2026-07-26T09:00:00Z");

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

/** A settlement report that finds nothing — the audit's clean case. The point of this suite is the
 * database path a composed pass takes, not the audit's classification, which has its own suites. */
const emptyStripe = {
  balanceTransactions: {
    list: () => ({ autoPagingEach: () => Promise.resolve() }),
  },
  checkout: {
    sessions: {
      list: () => ({ autoPagingEach: () => Promise.resolve() }),
    },
  },
} as unknown as Stripe;

describe("one composed pass against a migrated database", () => {
  it("reads credentials, sweeps reconcile and writes the ledger", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_probe",
          webhookSecret: "whsec_probe",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );

    const probe = suite.db;
    expect(await credentialProvisioned(probe, "payments.stripe")).toBe(true);

    const reconciler = new StripeReconciler({
      db: probe,
      nodeId: "11111111-1111-4111-8111-111111111111", // origin not asserted here
      resolveAccount: stripeAccountResolver({
        db: probe,
        ring,
        environment: "preproduction",
        makeStripe: () => emptyStripe,
      }),
    });
    const duty = reconcilerAsDuty(reconciler);
    const lines: string[] = [];

    const report = await runPass(
      {
        // No `envios` rows exist, so the drainer finds no tenants and never asks for a
        // certificate. Its transport is covered by aeat-transport.test.ts against a real
        // handshake; what this asserts is that the composed pass runs.
        drain: (now) =>
          drain(
            {
              db: probe,
              resolveClient: () => Promise.reject(new Error("no due fiscal work in this suite")),
              skipRetryMs: DEFAULTS.skipRetryMs,
              environment: "production",
            },
            now,
          ),
        reconcile: (now) => runDue({ db: probe, duties: [duty], ...DEFAULTS }, now),
        awaitingCert: { current: false },
        monotonicMs: () => performance.now(),
        log: createLogger(
          (line) => lines.push(line),
          () => NOW,
        ),
      },
      NOW,
    );

    expect(report.duties.every((entry) => entry.ok)).toBe(true);

    // `runDue` catches a duty's error and folds it into `TickResult.skipped` rather than throwing,
    // so `report.duties.every(ok)` above stays `true` through a failure. Nothing above `info` is
    // what actually notices: a `drain.tenant_skipped` or `reconcile.pair_skipped` warning is how a
    // broken duty looks from the outside.
    const nonInfo = lines
      .map((line) => JSON.parse(line) as { level: string; event: string })
      .filter((entry) => entry.level !== "info");
    expect(nonInfo).toEqual([]);

    // The ledger is the proof that the pass reached the database at all: a `succeeded` row means
    // the read, the insert and the update on `scheduled_runs` each landed.
    const rows = await suite.db.execute<{ count: string }>(
      sql`select count(*) as count from scheduled_runs
          where duty = ${RECONCILE_DUTY} and state = 'succeeded'`,
    );
    expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);

    // The folded `nextDueAt` is the one composed output the row count above does not pin: it is
    // what the real loop (`loop.ts`'s `sleepMsFor`) sleeps on. A clean sweep with nothing deferred
    // or skipped folds in a FUTURE time — never `now` — so this fails the moment anything pushes a
    // pair into `deferred`/`skipped`, which reports `now` instead.
    expect(report.nextDueAt).not.toBeNull();
    expect(report.nextDueAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("does not enumerate a tenant provisioned for a different purpose", async () => {
    await seedTenant(suite.db);
    // Provisioned for `fiscal.aeat`, NOT `payments.stripe` — a tenant with no credential at ALL
    // would pass this assertion even if `credentialProvisioned`'s `purpose` predicate were deleted
    // outright. Giving it a DIFFERENT purpose's credential is what makes the filter, not merely the
    // row's absence, the thing this test depends on.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);
  });
});
