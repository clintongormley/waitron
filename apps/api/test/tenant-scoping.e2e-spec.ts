import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Tenant Scoping (e2e)", () => {
  let app: INestApplication;
  let tenantAToken: string;
  let tenantBToken: string;

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
      .send({
        email: "a@test.com",
        password: "password",
        name: "Owner A",
        tenantName: "Restaurant A",
      });
    tenantAToken = resA.body.accessToken;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "b@test.com",
        password: "password",
        name: "Owner B",
        tenantName: "Restaurant B",
      });
    tenantBToken = resB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /auth/me should return only the authenticated user's tenant", async () => {
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.tenantId).toBeDefined();
    expect(res.body.email).toBe("a@test.com");
  });

  it("should not leak data between tenants", async () => {
    const resA = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    const resB = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(200);

    expect(resA.body.tenantId).not.toBe(resB.body.tenantId);
  });

  it("should reject unauthenticated requests", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });
});
