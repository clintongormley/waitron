import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Menu (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let locationId: string;
  let categoryId: string;
  let itemId: string;
  let modifierId: string;

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
      .send({ email: "menu@test.com", password: "pw", name: "Chef", tenantName: "Menu Tenant" });
    token = res.body.accessToken;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "menuB@test.com", password: "pw", name: "B", tenantName: "Menu Tenant B" });
    tokenB = resB.body.accessToken;

    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Restaurant" });
    locationId = loc.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Categories ────────────────────────────────────────────

  describe("Menu Categories", () => {
    it("POST creates a category with i18n name", async () => {
      const res = await request(app.getHttpServer())
        .post(`/locations/${locationId}/menu-categories`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: { en: "Starters", es: "Entradas" }, sortOrder: 1 })
        .expect(201);

      expect(res.body.name).toEqual({ en: "Starters", es: "Entradas" });
      expect(res.body.sortOrder).toBe(1);
      categoryId = res.body.id;
    });

    it("GET lists categories for the location", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationId}/menu-categories`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it("tenant B cannot access tenant A categories", async () => {
      return request(app.getHttpServer())
        .get(`/locations/${locationId}/menu-categories`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("PATCH updates a category", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/menu-categories/${categoryId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: { en: "Appetizers" } })
        .expect(200);
      expect(res.body.name).toEqual({ en: "Appetizers" });
    });
  });

  // ── Items ─────────────────────────────────────────────────

  describe("Menu Items", () => {
    const itemBase = `/locations/${() => locationId}/menu-categories/${() => categoryId}/menu-items`;

    it("POST creates an item with i18n content and price", async () => {
      const res = await request(app.getHttpServer())
        .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: { en: "Caesar Salad", es: "Ensalada César" },
          description: { en: "With croutons" },
          priceCents: 1200,
        })
        .expect(201);

      expect(res.body.name).toEqual({ en: "Caesar Salad", es: "Ensalada César" });
      expect(res.body.priceCents).toBe(1200);
      expect(res.body.available).toBe(true);
      itemId = res.body.id;
    });

    it("GET lists items for the category", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationId}/menu-categories/${categoryId}/menu-items`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it("PATCH updates an item", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ priceCents: 1500 })
        .expect(200);
      expect(res.body.priceCents).toBe(1500);
    });

    it("PATCH /availability toggles availability off", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/availability`)
        .set("Authorization", `Bearer ${token}`)
        .send({ available: false })
        .expect(200);
      expect(res.body.available).toBe(false);
    });

    it("PATCH /availability toggles availability on", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/availability`)
        .set("Authorization", `Bearer ${token}`)
        .send({ available: true })
        .expect(200);
      expect(res.body.available).toBe(true);
    });
  });

  // ── Modifiers ─────────────────────────────────────────────

  describe("Menu Modifiers", () => {
    it("POST creates a modifier with price", async () => {
      const res = await request(app.getHttpServer())
        .post(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/modifiers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: { en: "Extra cheese" }, priceCents: 150 })
        .expect(201);

      expect(res.body.name).toEqual({ en: "Extra cheese" });
      expect(res.body.priceCents).toBe(150);
      modifierId = res.body.id;
    });

    it("GET lists modifiers for the item", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/modifiers`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it("PATCH updates a modifier", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/modifiers/${modifierId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ priceCents: 200 })
        .expect(200);
      expect(res.body.priceCents).toBe(200);
    });

    it("DELETE removes a modifier", async () => {
      await request(app.getHttpServer())
        .delete(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}/modifiers/${modifierId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);
    });
  });

  // ── Cleanup ───────────────────────────────────────────────

  describe("Cleanup", () => {
    it("DELETE removes the item", async () => {
      await request(app.getHttpServer())
        .delete(`/locations/${locationId}/menu-categories/${categoryId}/menu-items/${itemId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);
    });

    it("DELETE removes the category", async () => {
      await request(app.getHttpServer())
        .delete(`/locations/${locationId}/menu-categories/${categoryId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);
    });
  });
});
