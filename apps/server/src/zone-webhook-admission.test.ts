import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { PAYMENTS_MIGRATIONS, insertInitiated } from "@waitron/payments";
import { decimal, deviceOrigin, locationId } from "@waitron/shared";
import { TradingAdmission } from "./trading-admission.js";
import { mountWebhook, settleWebhook, type WebhookDeps } from "./webhook.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, PAYMENTS_MIGRATIONS],
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 19).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const webhookSecret = "whsec_zone_admission_synthetic";
const sdk = new Stripe("sk_test_zone_admission");
const log = () => {};

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function seed() {
  const db = suite.db;
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({
      name: "Counter",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      timeZone: "Europe/Madrid",
    })
    .returning();
  const nodeId = await seedNode(db, locationId(location!.id));
  const { deviceId } = await seedDevice(db, { locationId: location!.id });
  const [order] = await db
    .insert(workingOrders)
    .values({ source: "device", deviceId, locationId: location!.id, orderNumber: 1 })
    .returning();
  const sessionId = `cs_${randomUUID()}`;
  await withTransaction(db, async (tx) => {
    await insertInitiated(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId: order!.id,
      provider: "stripe",
      paymentRef: randomUUID(),
      externalRef: sessionId,
      amount: decimal("12.10"),
    });
    await putCredential(tx, ring, {
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_zone_admission",
        webhookSecret,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
      },
    });
  });
  const admission = new TradingAdmission();
  const deps: WebhookDeps = {
    db,
    ring,
    nodeId,
    admission,
    environment: "preproduction",
    makeStripe: (key) => new Stripe(key),
  };
  const app = new Hono();
  mountWebhook(app, deps, log);
  return { deps, admission, app, sessionId, locationId: location!.id };
}

function event(sessionId: string, type = "checkout.session.completed") {
  const body = JSON.stringify({
    id: "evt_zone_admission",
    object: "event",
    type,
    created: 1_792_020_600,
    data: { object: { id: sessionId, object: "checkout.session", amount_total: 1210 } },
  });
  return {
    body,
    signature: sdk.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret }),
  };
}

function post(app: Hono, signed: ReturnType<typeof event>) {
  return app.request("/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": signed.signature },
    body: signed.body,
  });
}

async function snapshot() {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const rows: Record<string, string> = {};
  for (const { name } of tables.rows) {
    rows[name] = JSON.stringify(
      (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows,
    );
  }
  return rows;
}

async function paymentRows() {
  return (await suite.db.execute(sql`select * from payments order by id`)).rows;
}

const closedReasons = ["unchecked", "missing", "invalid", "restart_required"] as const;
function close(admission: TradingAdmission, reason: (typeof closedReasons)[number]) {
  if (reason === "missing" || reason === "invalid") admission.repairOnly(reason);
  if (reason === "restart_required") admission.requireRestart();
}

describe("signed webhook settlement admission", () => {
  for (const type of ["checkout.session.completed", "checkout.session.expired"]) {
    it.each(closedReasons)(
      `${type} retries without changing stored evidence while %s`,
      async (reason) => {
        const fixture = await seed();
        close(fixture.admission, reason);
        const before = await snapshot();
        const response = await post(fixture.app, event(fixture.sessionId, type));
        expect(await snapshot()).toEqual(before);
        expect(response.status).toBe(500);
        expect(await response.text()).toBe("");
      },
    );
  }

  it.each(closedReasons)("direct settlement refuses %s without a route gate", async (reason) => {
    const fixture = await seed();
    close(fixture.admission, reason);
    const signed = event(fixture.sessionId);
    const before = await snapshot();
    await expect(
      settleWebhook(fixture.deps, signed.body, signed.signature, log),
    ).rejects.toMatchObject({
      code: "venue.time_zone_not_ready",
      params: { reason },
    });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["", "Invalid/Zone"])(
    "rechecks saved zone %j at the write boundary after admission",
    async (timeZone) => {
      const fixture = await seed();
      fixture.admission.admit();
      await suite.db
        .update(locations)
        .set({ timeZone })
        .where(eq(locations.id, fixture.locationId));
      const before = await snapshot();
      const response = await post(fixture.app, event(fixture.sessionId));
      expect(await snapshot()).toEqual(before);
      expect(response.status).toBe(500);
    },
  );

  it("rechecks admission after a verified settlement waits for the write queue", async () => {
    const fixture = await seed();
    fixture.admission.admit();
    const before = await snapshot();
    const release = gate();
    let queued = false;
    let transactions = 0;
    let holding: Promise<void> | undefined;
    const original = suite.db.withWriteLock.bind(suite.db);
    const spy = vi.spyOn(suite.db, "withWriteLock").mockImplementation((body) => {
      transactions += 1;
      // The first transaction reads credentials; hold the settlement behind a real queued writer.
      if (transactions === 2) {
        holding = original(() => release.promise);
        const settlement = original(body);
        queued = true;
        return settlement;
      }
      return original(body);
    });
    const response = post(fixture.app, event(fixture.sessionId));
    try {
      await vi.waitFor(() => expect(queued).toBe(true));
      fixture.admission.requireRestart();
    } finally {
      spy.mockRestore();
      release.resolve();
      await holding;
    }
    expect((await response).status).toBe(500);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["checkout.session.completed", "checkout.session.expired"])(
    "%s settles once after reopening and retains the provider instant on redelivery",
    async (type) => {
      const fixture = await seed();
      const signed = event(fixture.sessionId, type);
      const before = await snapshot();
      expect((await post(fixture.app, signed)).status).toBe(500);
      expect(await snapshot()).toEqual(before);
      fixture.admission.admit();
      expect((await post(fixture.app, signed)).status).toBe(200);
      expect(await paymentRows()).toHaveLength(1);
      expect((await paymentRows())[0]).toMatchObject({
        amount: 1210,
        state: type === "checkout.session.completed" ? "captured" : "failed",
        settled_at: type === "checkout.session.completed" ? "2026-10-14T23:30:00.000Z" : null,
        sale_id: null,
      });
      const settled = await snapshot();
      fixture.admission.requireRestart();
      expect((await post(fixture.app, signed)).status).toBe(500);
      expect(await snapshot()).toEqual(settled);
      fixture.admission.admit();
      expect((await post(fixture.app, signed)).status).toBe(200);
      expect(await snapshot()).toEqual(settled);
    },
  );

  it.each(["wrong secret", "changed body", "old signature"])(
    "keeps signature refusal ahead of admission: %s",
    async (fault) => {
      const fixture = await seed();
      const signed = event(fixture.sessionId);
      if (fault === "wrong secret") {
        signed.signature = sdk.webhooks.generateTestHeaderString({
          payload: signed.body,
          secret: "whsec_wrong",
        });
      } else if (fault === "changed body") {
        signed.body = signed.body.replace("1210", "9999");
      } else {
        signed.signature = sdk.webhooks.generateTestHeaderString({
          payload: signed.body,
          secret: webhookSecret,
          timestamp: Math.floor(Date.now() / 1000) - 3600,
        });
      }
      const before = await snapshot();
      expect((await post(fixture.app, signed)).status).toBe(400);
      expect(await snapshot()).toEqual(before);
      await expect(
        settleWebhook(fixture.deps, signed.body, signed.signature, log),
      ).rejects.toMatchObject({ code: "payment.webhook_signature_invalid" });
    },
  );

  it("acknowledges verified unrelated events while closed without changing rows", async () => {
    const fixture = await seed();
    const before = await snapshot();
    expect(
      (
        await post(
          fixture.app,
          event(fixture.sessionId, "checkout.session.async_payment_succeeded"),
        )
      ).status,
    ).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it("retains the verified unresolved-event acknowledgement while closed", async () => {
    const fixture = await seed();
    const before = await snapshot();
    expect((await post(fixture.app, event("cs_unknown"))).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});
