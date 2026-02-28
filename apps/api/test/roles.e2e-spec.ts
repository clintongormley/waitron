import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Role Guards (e2e)", () => {
  let app: INestApplication;
  let ownerToken: string;

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
      .send({
        email: "roletest@test.com",
        password: "password",
        name: "Role Tester",
        tenantName: "Role Restaurant",
      });
    ownerToken = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("owner should access owner-restricted endpoint", async () => {
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
  });
});
