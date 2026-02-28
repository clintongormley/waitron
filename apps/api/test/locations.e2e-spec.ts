import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants, locations } from "@waitron/db";

describe("Locations (e2e)", () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let locationId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const db = app.get(DATABASE_TOKEN);
    await db.delete(users);
    await db.delete(tenants);

    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "loca@test.com", password: "pw", name: "A", tenantName: "Tenant A" });
    tokenA = resA.body.accessToken;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "locb@test.com", password: "pw", name: "B", tenantName: "Tenant B" });
    tokenB = resB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /locations", () => {
    it("should create a location", async () => {
      const res = await request(app.getHttpServer())
        .post("/locations")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Main Branch", address: "123 Main St", timezone: "America/New_York", currency: "USD" })
        .expect(201);

      expect(res.body.name).toBe("Main Branch");
      expect(res.body.id).toBeDefined();
      locationId = res.body.id;
    });

    it("should reject unauthenticated requests", () => {
      return request(app.getHttpServer())
        .post("/locations")
        .send({ name: "Bad" })
        .expect(401);
    });
  });

  describe("GET /locations", () => {
    it("should list only tenant A locations", async () => {
      const res = await request(app.getHttpServer())
        .get("/locations")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Main Branch");
    });

    it("tenant B should see no locations", async () => {
      const res = await request(app.getHttpServer())
        .get("/locations")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  describe("GET /locations/:id", () => {
    it("should return a specific location", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.id).toBe(locationId);
    });

    it("tenant B cannot access tenant A location", async () => {
      return request(app.getHttpServer())
        .get(`/locations/${locationId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe("PATCH /locations/:id", () => {
    it("should update a location", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Updated Branch" })
        .expect(200);

      expect(res.body.name).toBe("Updated Branch");
    });
  });

  describe("DELETE /locations/:id", () => {
    it("should delete a location", async () => {
      await request(app.getHttpServer())
        .delete(`/locations/${locationId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(204);

      return request(app.getHttpServer())
        .get(`/locations/${locationId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);
    });
  });
});
