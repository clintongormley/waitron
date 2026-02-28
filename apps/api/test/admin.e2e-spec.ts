import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";
import { eq } from "drizzle-orm";

describe("Admin (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;
  let ownerToken: string;
  let tenantAId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const db = app.get(DATABASE_TOKEN);
    await db.delete(users);
    await db.delete(tenants);

    // Register a normal tenant owner
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "owner@admin.test", password: "pw", name: "Owner", tenantName: "Tenant A" });
    ownerToken = resA.body.accessToken;

    // Get tenantId
    const meA = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`);
    tenantAId = meA.body.tenantId;

    // Register another tenant to have 2 tenants
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "ownerB@admin.test", password: "pw", name: "Owner B", tenantName: "Tenant B" });

    // Promote the first user to super_admin directly in DB
    await db
      .update(users)
      .set({ role: "super_admin", tenantId: null })
      .where(eq(users.email, "owner@admin.test"));

    // Re-login to get a token with the updated role
    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "owner@admin.test", password: "pw" });
    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /admin/stats returns platform stats", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.tenants).toBeGreaterThanOrEqual(1);
    expect(res.body.users).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.orders).toBe("number");
    expect(typeof res.body.bookings).toBe("number");
  });

  it("GET /admin/tenants lists all tenants", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const names = res.body.map((t: any) => t.name);
    expect(names).toContain("Tenant B");
  });

  it("GET /admin/tenants/:id returns specific tenant", async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenantAId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.id).toBe(tenantAId);
  });

  it("GET /admin/tenants/:id/users lists tenant users", async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenantAId}/users`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    // super_admin user has null tenantId so won't appear; Tenant A has 0 regular users now
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("regular owner cannot access admin endpoints", async () => {
    // ownerToken is now stale (user was promoted), use a fresh owner
    const resOwner = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "owner2@admin.test", password: "pw", name: "O2", tenantName: "Tenant C" });
    const ownerToken2 = resOwner.body.accessToken;

    await request(app.getHttpServer())
      .get("/admin/tenants")
      .set("Authorization", `Bearer ${ownerToken2}`)
      .expect(403);
  });

  it("unauthenticated request is rejected", async () => {
    await request(app.getHttpServer()).get("/admin/stats").expect(401);
  });
});
