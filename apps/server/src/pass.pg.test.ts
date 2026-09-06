// Real PostgreSQL: exercises the database path through a non-superuser LOGIN and its grants.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { credentialTenants, loadKeyRing, putCredential } from "@waitron/credentials";
import { DEFAULTS, runDue } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import type Stripe from "stripe";
import { createLogger } from "./logger.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { runPass, RECONCILE_DUTY } from "./pass.js";
import { stripeAccountResolver } from "./stripe-account.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes the
// grants bite at all. Everything below is the deployment role's view of the world.
const PROBE_ROLE = "server_pass_probe";
const PROBE_PASSWORD = "probe";
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const NOW = new Date("2026-07-26T09:00:00Z");

// A clone of the full-manifest template; the probe connections below authenticate as the
// cluster-wide `server_pass_probe` role the package globalSetup creates (in place of the per-file
// `probeRole` this suite used before the shared container).
const suite = useTemplateDb({ template: "manifest" });
const ring = loadKeyRing(KEY_ENV);

/** A settlement report that finds nothing — the audit's clean case. The point of this suite is the
 * database path as the deployment role, not the audit's classification, which has its own suites. */
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

describe("one pass as the non-superuser deployment role", () => {
  it("reads credentials, sweeps reconcile and writes the ledger", async () => {
    const tenantId = await seedTenant(suite.admin);
    await withTenant(suite.admin, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_probe",
          webhookSecret: "whsec_probe",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The enrolment list, read cross-tenant through `credential_tenants` as the deployment role.
      // Under PGlite this would pass while proving nothing: a superuser sees the rows regardless of
      // whether the SECURITY DEFINER seam or its grant exists.
      const tenants = await credentialTenants(probe, "payments.stripe");
      expect(tenants).toContain(tenantId);

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
          // handshake; what this asserts is that the composed pass runs as app_user.
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
          reconcile: (now) => runDue({ db: probe, duties: [duty], ...DEFAULTS }, tenants, now),
          monotonicMs: () => performance.now(),
          log: createLogger(
            (line) => lines.push(line),
            () => NOW,
          ),
        },
        NOW,
      );

      expect(report.duties.every((entry) => entry.ok)).toBe(true);

      // A `drain.tenant_skipped` or `reconcile.pair_skipped` WARNING is exactly what a missing
      // grant looks like from the outside: `runDue` catches the underlying permission-denied error
      // per (tenant, duty) and folds it into `TickResult.skipped` rather than throwing, so
      // `report.duties.every(ok)` above stays `true` even when a grant is missing — see the ledger
      // count below, which is what actually catches that case. Nothing above `info` here is the
      // positive control: a real grants problem would show up as a warning line this asserts away.
      const nonInfo = lines
        .map((line) => JSON.parse(line) as { level: string; event: string })
        .filter((entry) => entry.level !== "info");
      expect(nonInfo).toEqual([]);

      // The ledger is the proof: SELECT, INSERT and UPDATE on `scheduled_runs` all had to succeed
      // as the deployment role, and a missing grant on any one of them is invisible under PGlite.
      const rows = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from scheduled_runs
            where tenant_id = ${tenantId} and duty = ${RECONCILE_DUTY} and state = 'succeeded'`,
      );
      expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);

      // The folded `nextDueAt` is the one composed output the row count above does not pin: it is
      // what the real loop (`loop.ts`'s `sleepMsFor`) sleeps on. A clean sweep with nothing deferred
      // or skipped folds in a FUTURE time — never `now` — so this fails the moment a grants problem
      // (or anything else) pushes a pair into `deferred`/`skipped`, which reports `now` instead.
      expect(report.nextDueAt).not.toBeNull();
      expect(report.nextDueAt!.getTime()).toBeGreaterThan(NOW.getTime());
    } finally {
      await probe.close();
    }
  });

  it("does not enumerate a tenant provisioned for a different purpose", async () => {
    const otherPurposeTenant = await seedTenant(suite.admin);
    // Provisioned for `fiscal.aeat`, NOT `payments.stripe` — a tenant with no credential at ALL
    // would pass this assertion even if `credential_tenants`'s `WHERE purpose = p_purpose` clause
    // were deleted outright. Giving it a DIFFERENT purpose's credential is what makes the filter,
    // not merely the row's absence, the thing this test depends on.
    await withTenant(suite.admin, otherPurposeTenant, (tx) =>
      putCredential(tx, ring, {
        tenantId: otherPurposeTenant,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The vault IS the enrolment list: a tenant provisioned for a different purpose is not
      // half-served under the wrong one.
      expect(await credentialTenants(probe, "payments.stripe")).not.toContain(otherPurposeTenant);
    } finally {
      await probe.close();
    }
  });
});
