import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Public Orders (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let locationId: string;
  let qrCodeId: string;
  let categoryId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const db = app.get(DATABASE_TOKEN);
    await db.delete(users);
    await db.delete(tenants);

    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "public@test.com", password: "pw", name: "Host", tenantName: "Public Tenant" });
    token = res.body.accessToken;

    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Public Location" });
    locationId = loc.body.id;

    const tbl = await request(app.getHttpServer())
      .post(`/locations/${locationId}/tables`)
      .set("Authorization", `Bearer ${token}`)
      .send({ number: "T1", capacity: 4 });
    qrCodeId = tbl.body.qrCodeId;

    const cat = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Mains" }, sortOrder: 1 });
    categoryId = cat.body.id;

    const item = await request(app.getHttpServer())
      .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: { en: "Burger" }, priceCents: 1200 });
    itemId = item.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /table/:qrId returns table + location + menu (no auth)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/table/${qrCodeId}`)
      .expect(200);

    expect(res.body.table.id).toBeDefined();
    expect(res.body.location.id).toBe(locationId);
    expect(res.body.menu).toHaveLength(1);
  });

  it("POST /table/:qrId/orders creates a dine-in order (no auth)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/table/${qrCodeId}/orders`)
      .send({
        customerName: "Alice",
        items: [{ menuItemId: itemId, quantity: 2 }],
      })
      .expect(201);

    expect(res.body.type).toBe("dine_in");
    expect(res.body.status).toBe("pending");
    expect(res.body.totalCents).toBe(2400);
  });

  it("GET /public/:locationId/menu returns location + menu (no auth)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/${locationId}/menu`)
      .expect(200);

    expect(res.body.location.id).toBe(locationId);
    expect(res.body.menu).toHaveLength(1);
    expect(res.body.menu[0].items[0].id).toBe(itemId);
  });

  it("POST /public/:locationId/orders creates a takeaway order (no auth)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/public/${locationId}/orders`)
      .send({
        customerName: "Bob",
        items: [{ menuItemId: itemId, quantity: 1 }],
      })
      .expect(201);

    expect(res.body.type).toBe("takeaway");
    expect(res.body.status).toBe("pending");
    expect(res.body.totalCents).toBe(1200);
    expect(res.body.tableId).toBeNull();
  });

  it("POST /table/:qrId/orders returns 404 for unknown QR", async () => {
    await request(app.getHttpServer())
      .post("/table/00000000-0000-0000-0000-000000000000/orders")
      .send({ customerName: "Test", items: [{ menuItemId: itemId, quantity: 1 }] })
      .expect(404);
  });
});
