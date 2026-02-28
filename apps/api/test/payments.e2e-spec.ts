import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Payments (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let locationId: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const db = app.get(DATABASE_TOKEN);
    await db.delete(users);
    await db.delete(tenants);

    // Tenant A
    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "payments@test.com", password: "pw", name: "Host", tenantName: "Payments Tenant" });
    token = res.body.accessToken;

    // Tenant B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "paymentsB@test.com", password: "pw", name: "B", tenantName: "Payments Tenant B" });
    tokenB = resB.body.accessToken;

    // Location + menu + order
    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Pay Here" });
    locationId = loc.body.id;

    const cat = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Food" }, sortOrder: 1 });

    const item = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories/${cat.body.id}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Salad" }, priceCents: 800 });

    const order = await request(app.getHttpServer())
      .post(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "takeaway",
        customerName: "Alice",
        items: [{ menuItemId: item.body.id, quantity: 1 }],
      });
    orderId = order.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create intent (mock provider) ──────────────────────

  it("POST /payments/create-intent creates a payment with mock provider", async () => {
    const res = await request(app.getHttpServer())
      .post("/payments/create-intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, locationId, provider: "mock" })
      .expect(201);

    expect(res.body.payment.orderId).toBe(orderId);
    expect(res.body.payment.amountCents).toBe(800);
    expect(res.body.payment.provider).toBe("mock");
    expect(res.body.payment.status).toBe("pending");
    expect(res.body.clientSecret).toMatch(/^mock_secret_/);
    paymentId = res.body.payment.id;
  });

  it("POST idempotency — second intent for same order is allowed", async () => {
    const res = await request(app.getHttpServer())
      .post("/payments/create-intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, locationId, provider: "mock" })
      .expect(201);

    expect(res.body.payment.id).not.toBe(paymentId);
  });

  // ── Fetch payments for order ────────────────────────────

  it("GET /payments/orders/:locationId/:orderId returns payments", async () => {
    const res = await request(app.getHttpServer())
      .get(`/payments/orders/${locationId}/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].orderId).toBe(orderId);
  });

  // ── Refund ──────────────────────────────────────────────

  it("POST /payments/refund/:locationId/:paymentId refunds a payment", async () => {
    const res = await request(app.getHttpServer())
      .post(`/payments/refund/${locationId}/${paymentId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(res.body.status).toBe("refunded");
  });

  // ── Mock webhook ────────────────────────────────────────

  it("POST /payments/webhook/stripe processes mock webhook payload", async () => {
    // Create a fresh payment to update via webhook
    const intentRes = await request(app.getHttpServer())
      .post("/payments/create-intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, locationId, provider: "mock" });
    const ref = intentRes.body.payment.providerReference;

    const res = await request(app.getHttpServer())
      .post("/payments/webhook/stripe")
      .send({ type: "payment_intent.succeeded", providerReference: ref, status: "succeeded" })
      .expect(201);

    expect(res.body.received).toBe(true);
  });

  // ── Tenant isolation ────────────────────────────────────

  it("tenant B cannot access tenant A order payments", async () => {
    return request(app.getHttpServer())
      .get(`/payments/orders/${locationId}/${orderId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });
});
