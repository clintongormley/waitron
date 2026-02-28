import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Orders (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let locationId: string;
  let tableId: string;
  let qrCodeId: string;
  let categoryId: string;
  let itemId: string;
  let modifierId: string;
  let orderId: string;

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
      .send({ email: "orders@test.com", password: "pw", name: "Chef", tenantName: "Orders Tenant" });
    token = res.body.accessToken;

    // Tenant B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "ordersB@test.com", password: "pw", name: "B", tenantName: "Orders Tenant B" });
    tokenB = resB.body.accessToken;

    // Location
    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bistro" });
    locationId = loc.body.id;

    // Table
    const tbl = await request(app.getHttpServer())
      .post(`/locations/${locationId}/tables`)
      .set("Authorization", `Bearer ${token}`)
      .send({ number: "T1", capacity: 4 });
    tableId = tbl.body.id;
    qrCodeId = tbl.body.qrCodeId;

    // Menu category
    const cat = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Mains" }, sortOrder: 1 });
    categoryId = cat.body.id;

    // Menu item (1200 cents)
    const item = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Burger" }, priceCents: 1200 });
    itemId = item.body.id;

    // Modifier (300 cents)
    const mod = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/modifiers`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Extra cheese" }, priceCents: 300 });
    modifierId = mod.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create orders ─────────────────────────────────────────

  it("POST creates a dine-in order with items and computes total", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        tableId,
        type: "dine_in",
        customerName: "Table 1",
        items: [
          { menuItemId: itemId, quantity: 2 }, // 2 × 1200 = 2400
        ],
      })
      .expect(201);

    expect(res.body.type).toBe("dine_in");
    expect(res.body.status).toBe("pending");
    expect(res.body.totalCents).toBe(2400);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].unitPriceCents).toBe(1200);
    expect(res.body.items[0].quantity).toBe(2);
    orderId = res.body.id;
  });

  it("POST creates a takeaway order (no table)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "takeaway",
        customerName: "Jane",
        items: [
          { menuItemId: itemId, quantity: 1, modifierIds: [modifierId] }, // 1200 + 300 = 1500
        ],
      })
      .expect(201);

    expect(res.body.type).toBe("takeaway");
    expect(res.body.tableId).toBeNull();
    expect(res.body.totalCents).toBe(1500);
    expect(res.body.items[0].unitPriceCents).toBe(1500);
    expect(res.body.items[0].modifierIds).toContain(modifierId);
  });

  it("POST computes total with modifiers correctly", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "dine_in",
        tableId,
        items: [
          { menuItemId: itemId, quantity: 3, modifierIds: [modifierId] }, // 3 × (1200+300) = 4500
        ],
      })
      .expect(201);

    expect(res.body.totalCents).toBe(4500);
  });

  // ── List and fetch ────────────────────────────────────────

  it("GET lists all orders for the location", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it("GET ?status= filters by status", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/orders?status=pending`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.every((o: any) => o.status === "pending")).toBe(true);
  });

  it("GET :id returns order with items", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(orderId);
    expect(res.body.items).toHaveLength(1);
  });

  // ── Status lifecycle ──────────────────────────────────────

  it("PATCH /status progresses through lifecycle", async () => {
    for (const status of ["confirmed", "preparing", "ready", "served", "paid"] as const) {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status })
        .expect(200);
      expect(res.body.status).toBe(status);
    }
  });

  // ── Public QR endpoint ───────────────────────────────────

  it("GET /table/:qrId resolves table + location + menu (no auth)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/table/${qrCodeId}`)
      .expect(200);

    expect(res.body.table.id).toBe(tableId);
    expect(res.body.location.id).toBe(locationId);
    expect(res.body.menu).toHaveLength(1);
    expect(res.body.menu[0].category.id).toBe(categoryId);
    expect(res.body.menu[0].items).toHaveLength(1);
    expect(res.body.menu[0].items[0].id).toBe(itemId);
  });

  it("GET /table/:qrId excludes unavailable items", async () => {
    // Mark item unavailable
    await request(app.getHttpServer())
      .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/availability`)
      .set("Authorization", `Bearer ${token}`)
      .send({ available: false });

    const res = await request(app.getHttpServer())
      .get(`/table/${qrCodeId}`)
      .expect(200);

    expect(res.body.menu[0].items).toHaveLength(0);

    // Restore
    await request(app.getHttpServer())
      .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/availability`)
      .set("Authorization", `Bearer ${token}`)
      .send({ available: true });
  });

  it("GET /table/:qrId returns 404 for unknown QR code", async () => {
    await request(app.getHttpServer())
      .get("/table/00000000-0000-0000-0000-000000000000")
      .expect(404);
  });

  // ── Tenant isolation ─────────────────────────────────────

  it("tenant B cannot access tenant A orders", async () => {
    return request(app.getHttpServer())
      .get(`/locations/${locationId}/orders`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });
});
