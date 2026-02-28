import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

describe("Auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const db = app.get(DATABASE_TOKEN);
    await db.delete(users);
    await db.delete(tenants);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/register", () => {
    it("should register a new user and return JWT", () => {
      return request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "owner@test.com",
          password: "securepassword",
          name: "Test Owner",
          tenantName: "Test Restaurant",
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty("accessToken");
          expect(res.body.user.email).toBe("owner@test.com");
          expect(res.body.user.role).toBe("owner");
        });
    });
  });

  describe("POST /auth/login", () => {
    it("should login and return JWT", () => {
      return request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "owner@test.com",
          password: "securepassword",
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("accessToken");
        });
    });

    it("should reject invalid credentials", () => {
      return request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "owner@test.com",
          password: "wrongpassword",
        })
        .expect(401);
    });
  });
});
