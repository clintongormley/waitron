import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, tills, withTransaction, workingOrders } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { PAYMENTS_MIGRATIONS, insertInitiated } from "@waitron/payments";
import { decimal } from "@waitron/shared";
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

const suite = useVenueDb({
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
    nodeId: "11111111-1111-4111-8111-111111111111",
    environment: "preproduction",
    // The HMAC double ignores the secret key; verification depends only on `webhookSecret`.
    makeStripe: () => verifyingStripe(),
  };
}

interface SeededPayment {
  sessionId: string;
  webhookSecret: string;
}

async function seedInitiated(
  db: Database,
  opts: { webhookSecret: string; secretKey?: string; amount?: string; sessionId?: string },
): Promise<SeededPayment> {
  await seedTenant(db);
  const sessionId = opts.sessionId ?? `cs_${randomUUID()}`;
  // Through the table definitions: `$defaultFn` generators and the locale list's write mapping are
  // never reached by a raw insert.
  const [loc] = await db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  const [till] = await db
    .insert(tills)
    .values({ locationId: loc!.id, name: "Till 1" })
    .returning({ id: tills.id });
  const [wo] = await db
    .insert(workingOrders)
    .values({ tillId: till!.id, orderNumber: 1 })
    .returning({ id: workingOrders.id });
  await withTransaction(db, (tx) =>
    insertInitiated(tx, {
      workingOrderId: wo!.id,
      provider: "stripe",
      paymentRef: randomUUID(),
      externalRef: sessionId,
      amount: decimal(opts.amount ?? "12.10"),
    }),
  );
  await withTransaction(db, (tx) =>
    putCredential(tx, ring, {
      purpose: "payments.stripe",
      value: {
        secretKey: opts.secretKey ?? "sk_test_seed",
        webhookSecret: opts.webhookSecret,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
  return { sessionId, webhookSecret: opts.webhookSecret };
}

function completedEvent(sessionId: string, amountTotalMinor = 1210): string {
  return stripeSessionEvent({
    type: "checkout.session.completed",
    sessionId,
    amountTotalMinor,
    created: 1_740_000_000,
  });
}

async function paymentState(db: Database, sessionId: string): Promise<string | undefined> {
  const rows = await db.execute<{ state: string }>(
    sql`select state from payments where external_ref = ${sessionId}`,
  );
  return rows.rows[0]?.state;
}

async function settledAt(db: Database, sessionId: string): Promise<string | null | undefined> {
  const rows = await db.execute<{ settled_at: string | null }>(
    sql`select settled_at from payments where external_ref = ${sessionId}`,
  );
  return rows.rows[0]?.settled_at;
}

/** POSTs a webhook to the single `/webhooks/stripe` route with the given signature header. */
async function post(app: Hono, body: string, signature: string): Promise<Response> {
  return app.request("/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

describe("POST /webhooks/stripe — a verified checkout.session.completed", () => {
  it("settles the initiated payment to captured and answers 2xx", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_good" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(seeded.sessionId);
    const res = await post(app, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("captured");
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
    const res = await post(app, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("failed");
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
    const res = await post(app, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("initiated");
  });
});

describe("the signature is the sole gate", () => {
  it("refuses a bad signature with 400 and settles nothing", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_gate" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent(seeded.sessionId);
    // A signature computed with the WRONG secret — the header a forger without the secret produces.
    const res = await post(app, body, signStripeBody(body, "whsec_not_the_secret"));

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("initiated");
  });

  it("refuses a request carrying no Stripe-Signature header at all with 400", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_noheader" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    // No `stripe-signature` header — an empty signature can never verify.
    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      body: completedEvent(seeded.sessionId),
    });

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("initiated");
  });

  it("reads the RAW body — a whitespace-irregular body signed over its exact bytes verifies", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_raw" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    // Extra whitespace a JSON round-trip (`JSON.stringify(JSON.parse(x))`) would strip. If the route
    // parsed and re-serialised the body, the HMAC over these exact bytes would no longer match.
    const spaced = `{"type":"checkout.session.completed",  "created":1740000000,  "data":{"object":{"id":"${seeded.sessionId}","amount_total":1210}}}`;

    // (a) signed over the exact spaced bytes → verifies, because the route reads them verbatim.
    const ok = await post(app, spaced, signStripeBody(spaced, seeded.webhookSecret));
    expect(ok.status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("captured");
  });

  it("byte-exactness bites: the same body signed over its RE-SERIALISED form is refused 400", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_reser" });
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const spaced = `{"type":"checkout.session.completed",  "created":1740000000,  "data":{"object":{"id":"${seeded.sessionId}","amount_total":1210}}}`;
    // The control for the test above: a signature over the normalised bytes must not verify.
    const normalised = JSON.stringify(JSON.parse(spaced));
    const res = await post(app, spaced, signStripeBody(normalised, seeded.webhookSecret));

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("initiated");
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
    const res = await post(app, body, signStripeBody(body, seeded.webhookSecret));

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

    expect((await post(app, body, sig)).status).toBe(200);
    const firstSettledAt = await settledAt(suite.db, seeded.sessionId);

    // A redelivery reports 2xx again and leaves `settled_at` untouched.
    expect((await post(app, body, sig)).status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("captured");
    expect(await settledAt(suite.db, seeded.sessionId)).toBe(firstSettledAt);
  });
});

describe("the webhook shares the app with /health", () => {
  it("mounts alongside the health route — both respond on one app", async () => {
    const seeded = await seedInitiated(suite.db, { webhookSecret: "whsec_shared_app" });
    const app = healthApp(createHealthState(new Date("2026-08-02T00:00:00Z")), () => new Date());
    mountWebhook(app, deps(suite.db), collect([]));

    // 503: this health state has never passed.
    expect((await app.request("/health")).status).toBe(503);

    const body = completedEvent(seeded.sessionId);
    expect((await post(app, body, signStripeBody(body, seeded.webhookSecret))).status).toBe(200);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("captured");
  });
});

describe("permanent client errors are 400 (a retry can never fix them)", () => {
  it("answers 404 for the old per-taxpayer path — the segment is gone, not ignored", async () => {
    const app = new Hono();
    mountWebhook(app, deps(suite.db), collect([]));

    const body = completedEvent("cs_old_path");
    const res = await app.request("/webhooks/stripe/anything", {
      method: "POST",
      body,
      headers: { "stripe-signature": signStripeBody(body, "whsec_any") },
    });

    expect(res.status).toBe(404);
  });

  it("answers 400 for a wrong-environment key and settles nothing", async () => {
    // A live key sealed on this pre-production host: a provisioning mistake a retry can never fix.
    const seeded = await seedInitiated(suite.db, {
      webhookSecret: "whsec_envmix",
      secretKey: "sk_live_wrongenv",
    });
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    const body = completedEvent(seeded.sessionId);
    const res = await post(app, body, signStripeBody(body, seeded.webhookSecret));

    expect(res.status).toBe(400);
    expect(await paymentState(suite.db, seeded.sessionId)).toBe("initiated");
    expect(lines.map((l) => l.event)).toContain("payment.credential_environment_mismatch");
  });
});

describe("a transient failure is surfaced 5xx so Stripe retries — the distinction holds", () => {
  it("answers 500 when the path tenant has no payments.stripe credential at all", async () => {
    // No Stripe credential yet can be a provisioning race that resolves on Stripe's retry. The
    // control for the 400 cases above.
    await seedTenant(suite.db);
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountWebhook(app, deps(suite.db), collect(lines));

    const body = completedEvent("cs_no_credential");
    const res = await post(app, body, signStripeBody(body, "whsec_whatever"));

    expect(res.status).toBe(500);
    const failed = lines.find((l) => l.event === "webhook.failed");
    expect(failed?.fields).toMatchObject({ errorCode: "credentials.missing" });
  });
});

describe("hostedWebhookSecretFrom", () => {
  const REF = { purpose: "payments.stripe" };

  // Driven directly: `putCredential` refuses a payload without `webhookSecret`, so no such row
  // can be sealed through the vault.
  it("fails loudly on a payload sealed without a webhookSecret, rather than passing undefined on", () => {
    expect(() => hostedWebhookSecretFrom({ secretKey: "sk_test_x" }, REF)).toThrow(
      /server.credential_unusable/,
    );
  });

  it("returns the secret when present", () => {
    expect(hostedWebhookSecretFrom({ webhookSecret: "whsec_x" }, REF)).toBe("whsec_x");
  });
});
