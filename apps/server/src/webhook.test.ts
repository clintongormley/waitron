import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { PAYMENTS_MIGRATIONS, insertInitiated } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { Logger, LogLevel } from "./logger.js";
import { createHealthState, healthApp } from "./health.js";
import { hostedWebhookSecretFrom, mountWebhook } from "./webhook.js";
import type { WebhookDeps } from "./webhook.js";
import {
  signStripeBody,
  stripeSessionEvent,
  verifyingStripe,
} from "./testing/fake-stripe-webhook.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

/** A collecting logger for asserting the structured lines the endpoint emits. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

function deps(db: Database): WebhookDeps {
  return {
    db,
    ring,
    // Value irrelevant on PGlite (superuser, no sync capture triggers here); the origin-capture guard
    // lives in webhook.rls.test.ts against the full manifest. Required by WebhookDeps.
    nodeId: "11111111-1111-4111-8111-111111111111",
    environment: "preproduction",
    // The secret key is ignored by the HMAC double — verification depends only on the per-tenant
    // webhookSecret the route selects and hands to the client.
    makeStripe: () => verifyingStripe(),
  };
}

interface SeededPayment {
  tenantId: TenantId;
  sessionId: string;
  webhookSecret: string;
}

/** Seeds a tenant with an open working order, one `initiated` stripe payment (external_ref =
 * sessionId), and a `payments.stripe` credential carrying `webhookSecret`. Run as the PGlite
 * superuser — RLS is bypassed, so this is pure setup. */
async function seedInitiated(
  db: Database,
  opts: { webhookSecret: string; secretKey?: string; amount?: string; sessionId?: string },
): Promise<SeededPayment> {
  const tenantId = await seedTenant(db);
  const sessionId = opts.sessionId ?? `cs_${randomUUID()}`;
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
  const wo = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, order_number) values (${tenantId}, ${till.rows[0]!.id}, 1) returning id`);
  await withTenant(db, tenantId, (tx) =>
    insertInitiated(tx, {
      tenantId,
      workingOrderId: wo.rows[0]!.id,
      provider: "stripe",
      paymentRef: randomUUID(),
      externalRef: sessionId,
      amount: decimal(opts.amount ?? "12.10"),
    }),
  );
  await withTenant(db, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "payments.stripe",
      value: {
        secretKey: opts.secretKey ?? "sk_test_seed",
        webhookSecret: opts.webhookSecret,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
  return { tenantId, sessionId, webhookSecret: opts.webhookSecret };
}

function completedEvent(sessionId: string, amountTotalMinor = 1210): string {
  return stripeSessionEvent({
    type: "checkout.session.completed",
    sessionId,
    amountTotalMinor,
    created: 1_740_000_000,
  });
}

async function paymentState(
  db: Database,
  tenantId: TenantId,
  sessionId: string,
): Promise<string | undefined> {
  const rows = await db.execute<{ state: string }>(
    sql`select state from payments where tenant_id = ${tenantId} and external_ref = ${sessionId}`,
  );
  return rows.rows[0]?.state;
}

async function settledAt(
  db: Database,
  tenantId: TenantId,
  sessionId: string,
): Promise<string | null | undefined> {
  const rows = await db.execute<{ settled_at: string | null }>(
    sql`select settled_at from payments where tenant_id = ${tenantId} and external_ref = ${sessionId}`,
  );
  return rows.rows[0]?.settled_at;
}

/** POSTs a webhook to a tenant's path with the given signature header. */
async function post(app: Hono, tenant: string, body: string, signature: string): Promise<Response> {
  return app.request(`/webhooks/stripe/${tenant}`, {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

describe("POST /webhooks/stripe/:tenantId — a verified checkout.session.completed", () => {
  it("settles the initiated payment to captured and answers 2xx", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_good" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(seeded.sessionId);
    const res = await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("captured");
  });

  it("advances an expired session to failed and answers 2xx", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_exp" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = stripeSessionEvent({
      type: "checkout.session.expired",
      sessionId: seeded.sessionId,
      amountTotalMinor: null,
      created: 1_740_000_000,
    });
    const res = await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("failed");
  });

  it("acks 2xx and settles nothing for a verified event type it does not act on", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_ignore" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = stripeSessionEvent({
      type: "checkout.session.async_payment_succeeded",
      sessionId: seeded.sessionId,
      amountTotalMinor: 1210,
      created: 1_740_000_000,
    });
    const res = await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("initiated");
  });
});

describe("the signature is the sole gate", () => {
  it("refuses a bad signature with 400 and settles nothing", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_gate" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(seeded.sessionId);
    // A signature computed with the WRONG secret — the header a forger without the secret produces.
    const res = await post(
      app,
      seeded.tenantId,
      body,
      signStripeBody(body, "whsec_not_the_secret"),
    );

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("initiated");
  });

  it("refuses a request carrying no Stripe-Signature header at all with 400", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_noheader" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    // No `stripe-signature` header — an empty signature can never verify.
    const res = await app.request(`/webhooks/stripe/${seeded.tenantId}`, {
      method: "POST",
      body: completedEvent(seeded.sessionId),
    });

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("initiated");
  });

  it("reads the RAW body — a whitespace-irregular body signed over its exact bytes verifies", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_raw" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    // Extra whitespace a JSON round-trip (`JSON.stringify(JSON.parse(x))`) would strip. If the route
    // parsed and re-serialised the body, the HMAC over these exact bytes would no longer match.
    const spaced = `{"type":"checkout.session.completed",  "created":1740000000,  "data":{"object":{"id":"${seeded.sessionId}","amount_total":1210}}}`;

    // (a) signed over the exact spaced bytes → verifies, because the route reads them verbatim.
    const ok = await post(
      app,
      seeded.tenantId,
      spaced,
      signStripeBody(spaced, seeded.webhookSecret),
    );
    expect(ok.status).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("captured");
  });

  it("byte-exactness bites: the same body signed over its RE-SERIALISED form is refused 400", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_reser" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const spaced = `{"type":"checkout.session.completed",  "created":1740000000,  "data":{"object":{"id":"${seeded.sessionId}","amount_total":1210}}}`;
    // The control for the test above: a signature over the NORMALISED bytes, posted with the spaced
    // body, verifies only if the route normalised too. It does not, so this is a 400 — proving the
    // 200 above came from the raw read, not from an incidental match.
    const normalised = JSON.stringify(JSON.parse(spaced));
    const res = await post(
      app,
      seeded.tenantId,
      spaced,
      signStripeBody(normalised, seeded.webhookSecret),
    );

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("initiated");
  });
});

describe("per-tenant secret selection", () => {
  it("each tenant verifies only its OWN signed body — a cross-tenant body is refused 400", async () => {
    const a = await seedInitiated(suite.db, { webhookSecret: "whsec_alpha" });
    const b = await seedInitiated(suite.db, { webhookSecret: "whsec_bravo" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(a.sessionId);
    const signedByA = signStripeBody(body, a.webhookSecret);

    // Positive control: A's own body on A's path verifies against A's secret.
    expect((await post(app, a.tenantId, body, signedByA)).status).toBe(200);

    // The guard: A's body posted to B's path loads B's secret, which does not verify A's signature.
    // Deleting the per-tenant selection (loading a single/fixed secret) makes this wrongly verify.
    const res = await post(
      app,
      b.tenantId,
      completedEvent(b.sessionId),
      signStripeBody(completedEvent(b.sessionId), a.webhookSecret),
    );
    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, b.tenantId, b.sessionId)).toBe("initiated");
  });
});

describe("the resolved-tenant cross-check", () => {
  it("refuses 400 when a body verifies for the path tenant but the session belongs to another", async () => {
    // A owns session cs_A. B carries the SAME secret (the only way A's session can verify on B's
    // path) — the standalone-account misconfiguration the cross-check exists to catch.
    const shared = "whsec_shared";
    const a = await seedInitiated(suite.db, { webhookSecret: shared });
    const b = await seedInitiated(suite.db, { webhookSecret: shared });
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    // A's session, signed with the shared secret, POSTed to B's path: verifies (secret matches),
    // then resolves to A ≠ B → mismatch. Deleting the cross-check settles A's row on B's request.
    const body = completedEvent(a.sessionId);
    const res = await post(app, b.tenantId, body, signStripeBody(body, shared));

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, a.tenantId, a.sessionId)).toBe("initiated");
    expect(lines.map((l) => l.event)).toContain("payment.webhook_tenant_mismatch");
  });
});

describe("no-op acknowledgements (2xx)", () => {
  it("acks 2xx and logs unresolved for a verified event with no local initiated row", async () => {
    // A provisioned tenant (so its secret verifies) but a session id it never minted.
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_unres" });
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    const unknownSession = "cs_never_minted";
    const body = completedEvent(unknownSession);
    const res = await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    const unresolved = lines.find((l) => l.event === "payment.webhook_unresolved");
    expect(unresolved?.fields).toMatchObject({ provider: "stripe", externalRef: unknownSession });
  });

  it("is idempotent under redelivery: a second delivery settles nothing new and stays 2xx", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_redeliver" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(seeded.sessionId);
    const sig = signStripeBody(body, seeded.webhookSecret);

    expect((await post(app, seeded.tenantId, body, sig)).status).toBe(200);
    const firstSettledAt = await settledAt(suite.db, seeded.tenantId, seeded.sessionId);

    // At-least-once redelivery: 2xx again, still captured, and `settled_at` untouched — the row was
    // already past `initiated`, so `settleInitiated` matched nothing (no second write).
    expect((await post(app, seeded.tenantId, body, sig)).status).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("captured");
    expect(await settledAt(suite.db, seeded.tenantId, seeded.sessionId)).toBe(firstSettledAt);
  });
});

describe("the webhook shares the app with /health", () => {
  it("mounts alongside the health route — both respond on one app", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_shared_app" });
    const app = healthApp(createHealthState(new Date("2026-08-02T00:00:00Z")), () => new Date());
    mountWebhook(app, deps(suite.db), collect([]));

    // /health still answers (503 — this state has never passed), proving the webhook mount did not
    // displace it.
    expect((await app.request("/health")).status).toBe(503);

    const body = completedEvent(seeded.sessionId);
    expect(
      (await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret))).status,
    ).toBe(200);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("captured");
  });
});

describe("permanent client errors are 400 (a retry can never fix them)", () => {
  it("answers 400 for a malformed :tenantId path and settles nothing", async () => {
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    // `brandTenantId` rejects a non-uuid segment before any DB access — the request is unroutable,
    // not transient, so 400 (not the 5xx retry-bias) and nothing is touched.
    const body = completedEvent("cs_bad_tenant");
    const res = await post(app, "not-a-uuid", body, signStripeBody(body, "whsec_any"));

    expect(res.status).toBe(400);
    expect(lines.map((l) => l.event)).toContain("shared.invalid_id");
  });

  it("answers 400 for a wrong-environment key and settles nothing", async () => {
    // A LIVE key sealed on this pre-production host: `stripeSecretKeyFrom` throws
    // `payment.credential_environment_mismatch` before verification — a provisioning mistake, not a
    // race, so a retry can never succeed. 400, not 5xx.
    const seeded = await seedInitiated(suite.db, {
      webhookSecret: "whsec_envmix",
      secretKey: "sk_live_wrongenv",
    });
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    const body = completedEvent(seeded.sessionId);
    const res = await post(app, seeded.tenantId, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.tenantId, seeded.sessionId)).toBe("initiated");
    expect(lines.map((l) => l.event)).toContain("payment.credential_environment_mismatch");
  });
});

describe("a transient failure is surfaced 5xx so Stripe retries — the distinction holds", () => {
  it("answers 500 when the path tenant has no payments.stripe credential at all", async () => {
    // A real tenant uuid with no Stripe credential: the vault's `credentials.missing` is a tenant
    // not-yet-provisioned — a mid-provisioning race that resolves itself on Stripe's retry, so 5xx
    // rather than a 400 that would drop the event. This is the control for the two 400 cases above.
    const tenantId = await seedTenant(suite.db);
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    const body = completedEvent("cs_no_credential");
    const res = await post(app, tenantId, body, signStripeBody(body, "whsec_whatever"));

    expect(res.status).toBe(500);
    const failed = lines.find((l) => l.event === "webhook.failed");
    expect(failed?.fields).toMatchObject({ errorCode: "credentials.missing" });
  });
});

describe("hostedWebhookSecretFrom", () => {
  const REF = { tenantId: "11111111-1111-1111-1111-111111111111", purpose: "payments.stripe" };

  // Driven directly, not through a forged row: `putCredential` validates every required field is a
  // non-empty string, so a payload sealed without `webhookSecret` cannot be written through the
  // vault — the same reasoning as `stripeSecretKeyFrom`'s own unit tests. The pure function IS the
  // read-side guard, so testing it directly tests the thing.
  it("fails loudly on a payload sealed without a webhookSecret, rather than passing undefined on", () => {
    expect(() => hostedWebhookSecretFrom({ secretKey: "sk_test_x" }, REF)).toThrow(
      /server.credential_unusable/,
    );
  });

  it("returns the secret when present", () => {
    expect(hostedWebhookSecretFrom({ webhookSecret: "whsec_x" }, REF)).toBe("whsec_x");
  });
});
