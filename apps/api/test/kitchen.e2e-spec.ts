import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Kitchen (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let locationId: string;
  let stationId: string;
  let categoryId: string;
  let itemId: string;
  let orderId: string;
  let ticketId: string;

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
      .send({ email: "kitchen@test.com", password: "pw", name: "Chef", tenantName: "Kitchen Tenant" });
    token = res.body.accessToken;

    // Tenant B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "kitchenB@test.com", password: "pw", name: "B", tenantName: "Kitchen Tenant B" });
    tokenB = resB.body.accessToken;

    // Location
    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Kitchen" });
    locationId = loc.body.id;

    // Menu
    const cat = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Mains" }, sortOrder: 1 });
    categoryId = cat.body.id;

    const item = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Steak" }, priceCents: 2500 });
    itemId = item.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Stations ─────────────────────────────────────────────

  it("POST creates a kitchen station", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/kitchen/stations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Grill", sortOrder: 1 })
      .expect(201);

    expect(res.body.name).toBe("Grill");
    stationId = res.body.id;
  });

  it("GET lists stations for the location", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/stations`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(stationId);
  });

  it("POST assigns a menu item to a station", async () => {
    await request(app.getHttpServer())
      .post(`/locations/${locationId}/kitchen/stations/${stationId}/items/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });

  // ── Tickets ───────────────────────────────────────────────

  it("PATCH order status to confirmed generates a kitchen ticket", async () => {
    // Create an order
    const order = await request(app.getHttpServer())
      .post(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "dine_in",
        items: [{ menuItemId: itemId, quantity: 1 }],
      })
      .expect(201);
    orderId = order.body.id;

    // Confirm the order — should generate ticket for Grill station
    await request(app.getHttpServer())
      .patch(`/locations/${locationId}/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "confirmed" })
      .expect(200);

    // Fetch tickets
    const tickets = await request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/tickets`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(tickets.body.length).toBeGreaterThanOrEqual(1);
    const ticket = tickets.body.find((t: any) => t.orderId === orderId);
    expect(ticket).toBeDefined();
    expect(ticket.stationId).toBe(stationId);
    expect(ticket.status).toBe("pending");
    ticketId = ticket.id;
  });

  it("GET /tickets?station= filters by station", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/tickets?station=${stationId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.every((t: any) => t.stationId === stationId)).toBe(true);
  });

  it("GET /tickets?status= filters by status", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/tickets?status=pending`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.every((t: any) => t.status === "pending")).toBe(true);
  });

  it("PATCH ticket status to in_progress starts the ticket", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/locations/${locationId}/kitchen/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" })
      .expect(200);
    expect(res.body.status).toBe("in_progress");
    expect(res.body.startedAt).not.toBeNull();
  });

  it("PATCH ticket status to ready completes the ticket and advances order", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/locations/${locationId}/kitchen/tickets/${ticketId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ready" })
      .expect(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.completedAt).not.toBeNull();

    // Order should automatically advance to 'ready' since all tickets are done
    const order = await request(app.getHttpServer())
      .get(`/locations/${locationId}/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(order.body.status).toBe("ready");
  });

  // ── Tenant isolation ──────────────────────────────────────

  it("tenant B cannot access tenant A kitchen stations", async () => {
    return request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/stations`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  // ── Cleanup ───────────────────────────────────────────────

  it("DELETE removes a station", async () => {
    const extra = await request(app.getHttpServer())
      .post(`/locations/${locationId}/kitchen/stations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Cold Station" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/locations/${locationId}/kitchen/stations/${extra.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/locations/${locationId}/kitchen/stations`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((s: any) => s.id === extra.body.id)).toBeUndefined();
  });
});
