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
 * One composed scheduler pass, with the real drain and reconcile duties, against a real migrated
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
        // No `envios` rows exist, so the drainer finds no work and never asks for a certificate.
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

    // `runDue` folds a duty's error into `TickResult.skipped` rather than throwing, so every `ok`
    // above stays true through a failure; a warning line is how a broken duty shows from outside.
    const nonInfo = lines
      .map((line) => JSON.parse(line) as { level: string; event: string })
      .filter((entry) => entry.level !== "info");
    expect(nonInfo).toEqual([]);

    // A `succeeded` row means the read, the insert and the update on `scheduled_runs` each landed.
    const rows = await suite.db.execute<{ count: string }>(
      sql`select count(*) as count from scheduled_runs
          where duty = ${RECONCILE_DUTY} and state = 'succeeded'`,
    );
    expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);

    // A clean sweep folds in a future time; a deferred or skipped pair would report `now` instead.
    expect(report.nextDueAt).not.toBeNull();
    expect(report.nextDueAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("does not enumerate a tenant provisioned for a different purpose", async () => {
    await seedTenant(suite.db);
    // Provisioned for `fiscal.aeat`, not `payments.stripe`: with no credential at all this would pass
    // even without `credentialProvisioned`'s `purpose` filter.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    expect(await credentialProvisioned(suite.db, "payments.stripe")).toBe(false);
  });
});
