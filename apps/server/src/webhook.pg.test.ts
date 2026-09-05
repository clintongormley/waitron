import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { insertInitiated, resolvePaymentTenant } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { mountWebhook } from "./webhook.js";
import type { WebhookDeps } from "./webhook.js";
import {
  signStripeBody,
  stripeSessionEvent,
  verifyingStripe,
} from "./testing/fake-stripe-webhook.js";

// A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes those
// grants the ceiling. Everything the route does below (read the credential, resolve the tenant across the
// #26 seam, settle under `withTenant`) is exercised as the deployment role's view of the world.
// PGlite (webhook.test.ts) runs every connection as a superuser and cannot show any of it.
const PROBE_ROLE = "server_webhook_probe";
const PROBE_PASSWORD = "probe";
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

// A clone of the full-manifest template; the probe connections below authenticate as the
// cluster-wide `server_webhook_probe` role the package globalSetup creates (in place of the per-file
// `probeRole` this suite used before the shared container).
const suite = useTemplateDb({ template: "manifest" });
const ring = loadKeyRing(KEY_ENV);

// The settling node's origin id, and the all-zero uuid capture defaults to when app.node_id is unset.
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO = "00000000-0000-0000-0000-000000000000";

function deps(db: Database, nodeId: string = NODE_A): WebhookDeps {
  return { db, ring, nodeId, environment: "preproduction", makeStripe: () => verifyingStripe() };
}

/** The origin_id captured for this tenant's most recent `payments` op=update in sync_log (the
 * settlement's initiated->captured UPDATE). Read on the privileged admin connection. */
async function paymentUpdateOrigin(db: Database, tenantId: TenantId): Promise<string | null> {
  const r = await db.execute<{ v: string | null }>(
    sql`select origin_id::text as v from sync_log
        where table_name = 'payments' and op = 'update' and tenant_id = ${tenantId}
        order by seq desc limit 1`,
  );
  return r.rows[0]?.v ?? null;
}

interface SeededPayment {
  tenantId: TenantId;
  sessionId: string;
}

/** Seeds a tenant, an open working order, one `initiated` stripe payment (external_ref = a fresh
 * session id) and a `payments.stripe` credential — all as the superuser admin (pure
 * setup). The route then acts on it as the non-superuser probe. */
async function seedInitiated(admin: Database, webhookSecret: string): Promise<SeededPayment> {
  const tenantId = await seedTenant(admin);
  const sessionId = `cs_${randomUUID()}`;
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`);
  const till = await admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
  const wo = await admin.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, order_number) values (${tenantId}, ${till.rows[0]!.id}, 1) returning id`);
  await withTenant(admin, tenantId, (tx) =>
    insertInitiated(tx, {
      tenantId,
      workingOrderId: wo.rows[0]!.id,
      provider: "stripe",
      paymentRef: randomUUID(),
      externalRef: sessionId,
      amount: decimal("12.10"),
    }),
  );
  await withTenant(admin, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_probe",
        webhookSecret,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
  return { tenantId, sessionId };
}

function completedEvent(sessionId: string): string {
  return stripeSessionEvent({
    type: "checkout.session.completed",
    sessionId,
    amountTotalMinor: 1210,
    created: 1_740_000_000,
  });
}

async function stateOf(
  db: Database,
  tenantId: TenantId,
  sessionId: string,
): Promise<string | undefined> {
  const rows = await db.execute<{ state: string }>(
    sql`select state from payments where tenant_id = ${tenantId} and external_ref = ${sessionId}`,
  );
  return rows.rows[0]?.state;
}

describe("the webhook resolves and settles as the non-superuser deployment role", () => {
  it("crosses the #26 seam, settles under withTenant, and is idempotent — all as app_user", async () => {
    // A SECOND tenant with its own initiated payment, so "resolve crosses exactly one tenant" is a
    // real claim: the seam must return THIS session's owner, not merely some tenant.
    const other = await seedInitiated(suite.admin, "whsec_other");
    const seeded = await seedInitiated(suite.admin, "whsec_probe");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The seam, exercised as app_user: without the SECURITY DEFINER function (or its grant) this
      // returns null under RLS with no `app.tenant_id` set. Under PGlite a superuser would see the
      // row regardless, proving nothing.
      expect(await resolvePaymentTenant(probe, "stripe", seeded.sessionId)).toBe(
        String(seeded.tenantId),
      );
      expect(await resolvePaymentTenant(probe, "stripe", other.sessionId)).toBe(
        String(other.tenantId),
      );

      const app = new Hono();
      mountWebhook(app, deps(probe), () => {});

      const body = completedEvent(seeded.sessionId);
      const sig = signStripeBody(body, "whsec_probe");

      // The settle runs `readCredential` + `settleInitiated` under `withTenant` as app_user: SELECT
      // on tenant_credentials and UPDATE on payments both had to succeed as the deployment role.
      const first = await app.request(`/webhooks/stripe/${seeded.tenantId}`, {
        method: "POST",
        body,
        headers: { "stripe-signature": sig },
      });
      expect(first.status).toBe(200);
      expect(await stateOf(suite.admin, seeded.tenantId, seeded.sessionId)).toBe("captured");
      // The other tenant's row is untouched — the settle was scoped to the resolved/path tenant.
      expect(await stateOf(suite.admin, other.tenantId, other.sessionId)).toBe("initiated");

      // At-least-once redelivery, still as app_user: idempotent, 2xx, still captured.
      const second = await app.request(`/webhooks/stripe/${seeded.tenantId}`, {
        method: "POST",
        body,
        headers: { "stripe-signature": sig },
      });
      expect(second.status).toBe(200);
      expect(await stateOf(suite.admin, seeded.tenantId, seeded.sessionId)).toBe("captured");
    } finally {
      await probe.close();
    }
  });

  it("stamps the settling node's origin on the enrolled payments UPDATE captured to sync_log (all-zero without the fix)", async () => {
    // Guard-by-deletion of FIX 1: settleWebhook threads { nodeId: deps.nodeId } into its settle
    // withTenant, so the enrolled `payments` UPDATE (initiated -> captured, the Stripe settlement)
    // captures NODE_A as sync_log.origin_id. Drop that 4th arg and app.node_id is unset -> capture
    // falls back to the all-zero origin, which the pull loop (?originId=<peer>) NEVER replicates, so a
    // card settlement is lost on failover. Mirrors sync-origin.test.ts's payments-UPDATE case,
    // which the design audit had for the reconcile sweep but missed for this webhook writer.
    const seeded = await seedInitiated(suite.admin, "whsec_origin");
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const app = new Hono();
      mountWebhook(app, deps(probe, NODE_A), () => {});
      const body = completedEvent(seeded.sessionId);
      const res = await app.request(`/webhooks/stripe/${seeded.tenantId}`, {
        method: "POST",
        body,
        headers: { "stripe-signature": signStripeBody(body, "whsec_origin") },
      });
      expect(res.status).toBe(200);
      expect(await stateOf(suite.admin, seeded.tenantId, seeded.sessionId)).toBe("captured");
      expect(await paymentUpdateOrigin(suite.admin, seeded.tenantId)).toBe(NODE_A);

      // Control (the two directions visibly differ, CLAUDE.md §1): the SAME settle under the all-zero
      // node id captures the all-zero origin — so the captured origin tracks deps.nodeId, not a constant.
      const zeroSeed = await seedInitiated(suite.admin, "whsec_zero");
      const zeroApp = new Hono();
      mountWebhook(zeroApp, deps(probe, ZERO), () => {});
      const zeroBody = completedEvent(zeroSeed.sessionId);
      const zeroRes = await zeroApp.request(`/webhooks/stripe/${zeroSeed.tenantId}`, {
        method: "POST",
        body: zeroBody,
        headers: { "stripe-signature": signStripeBody(zeroBody, "whsec_zero") },
      });
      expect(zeroRes.status).toBe(200);
      expect(await paymentUpdateOrigin(suite.admin, zeroSeed.tenantId)).toBe(ZERO);
    } finally {
      await probe.close();
    }
  });
});
