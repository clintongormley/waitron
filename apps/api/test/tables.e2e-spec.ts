import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants, locations } from "@waitron/db";

describe("Tables (e2e)", () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let locationIdA: string;
  let locationIdB: string;
  let tableId: string;

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
      .send({ email: "ta@test.com", password: "pw", name: "A", tenantName: "Tables Tenant A" });
    tokenA = resA.body.accessToken;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "tb@test.com", password: "pw", name: "B", tenantName: "Tables Tenant B" });
    tokenB = resB.body.accessToken;

    const locA = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Location A" });
    locationIdA = locA.body.id;

    const locB = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Location B" });
    locationIdB = locB.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /locations/:id/tables", () => {
    it("should create a table", async () => {
      const res = await request(app.getHttpServer())
        .post(`/locations/${locationIdA}/tables`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ number: "T1", capacity: 4 })
        .expect(201);

      expect(res.body.number).toBe("T1");
      expect(res.body.capacity).toBe(4);
      expect(res.body.qrCodeId).toBeDefined();
      expect(res.body.status).toBe("available");
      tableId = res.body.id;
    });

    it("tenant B cannot create table in tenant A location", () => {
      return request(app.getHttpServer())
        .post(`/locations/${locationIdA}/tables`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ number: "T2", capacity: 2 })
        .expect(404);
    });
  });

  describe("GET /locations/:id/tables", () => {
    it("should list tables for the location", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationIdA}/tables`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].number).toBe("T1");
    });
  });

  describe("GET /locations/:id/tables/:id", () => {
    it("should return a specific table", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationIdA}/tables/${tableId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.id).toBe(tableId);
    });
  });

  describe("PATCH /locations/:id/tables/:id", () => {
    it("should update a table", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/locations/${locationIdA}/tables/${tableId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "occupied" })
        .expect(200);

      expect(res.body.status).toBe("occupied");
    });
  });

  describe("GET /locations/:id/tables/:id/qr", () => {
    it("should return a PNG QR code image", async () => {
      const res = await request(app.getHttpServer())
        .get(`/locations/${locationIdA}/tables/${tableId}/qr`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.headers["content-type"]).toMatch(/image\/png/);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe("DELETE /locations/:id/tables/:id", () => {
    it("should delete a table", async () => {
      await request(app.getHttpServer())
        .delete(`/locations/${locationIdA}/tables/${tableId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(204);

      return request(app.getHttpServer())
        .get(`/locations/${locationIdA}/tables/${tableId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);
    });
  });
});
