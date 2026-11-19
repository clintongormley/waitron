import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { credentialProvisioned, loadKeyRing, putCredential } from "@waitron/credentials";
import { DEFAULTS, runDue } from "@waitron/payments";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import type Stripe from "stripe";
import { createLogger } from "./logger.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { drainJob, reconcileJob } from "./fiscal-jobs.js";
import { createHealthState } from "./health.js";
import { DEFAULT_DUTY_TIMINGS } from "./config.js";
import { stripeAccountResolver } from "./stripe-account.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";

/**
 * The real drain and reconcile jobs against a real migrated
 * database. `pass.test.ts` beside it uses fake duties and no database.
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

/** A settlement report that finds nothing: this suite is about the pass's database path, not the
 * audit's classification. */
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

describe("independent jobs against a migrated database", () => {
  it("reads credentials, sweeps reconcile and writes the ledger", async () => {
    await seedTaxpayer(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        personId: null,
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
      resolveAccount: stripeAccountResolver({
        db: probe,
        ring,
        environment: "preproduction",
        makeStripe: () => emptyStripe,
      }),
    });
    const duty = reconcilerAsDuty(reconciler);
    const lines: string[] = [];

    const health = createHealthState(NOW);
    const deps = {
      getRole: () => "primary" as const,
      health,
      timings: DEFAULT_DUTY_TIMINGS,
      monotonicMs: () => performance.now(),
      log: createLogger(
        (line) => lines.push(line),
        () => NOW,
      ),
    };
    const ctx = { now: NOW, signal: new AbortController().signal };
    const [filing, reconcile] = await Promise.all([
      drainJob({
        ...deps,
        awaitingCert: { current: false },
        drain: (now, signal) =>
          drain(
            {
              db: probe,
              resolveClient: () => Promise.reject(new Error("no due fiscal work in this suite")),
              skipRetryMs: DEFAULTS.skipRetryMs,
              environment: "production",
              signal,
            },
            now,
          ),
      }).pass(ctx),
      reconcileJob({
        ...deps,
        reconcile: (now) => runDue({ db: probe, duties: [duty], ...DEFAULTS }, now),
      }).pass(ctx),
    ]);

    expect(filing.degraded).toBe(false);
    expect(reconcile.degraded).toBe(false);

    const nonInfo = lines
      .map((line) => JSON.parse(line) as { level: string; event: string })
      .filter((entry) => entry.level !== "info");
    expect(nonInfo).toEqual([]);

    // A `succeeded` row means the read, the insert and the update on `reconciliation_runs` each landed.
    const rows = await suite.db.execute<{ count: string }>(
      sql`select count(*) as count from reconciliation_runs
          where duty = 'payments.reconcile.stripe' and state = 'succeeded'`,
    );
    expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);

    expect(reconcile.nextDueAt).not.toBeNull();
    expect(reconcile.nextDueAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("does not enumerate a taxpayer provisioned for a different purpose", async () => {
    await seedTaxpayer(suite.db);
    // Provisioned for `fiscal.aeat`, not `payments.stripe`: with no credential at all this would pass
    // even without `credentialProvisioned`'s `purpose` filter.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        personId: null,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);
  });
});
