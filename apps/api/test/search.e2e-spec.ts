import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";
import { SearchService } from "../src/search/search.service";

describe("Search (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let tenantId: string;
  let searchService: SearchService;

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
      .send({ email: "search@test.com", password: "pw", name: "Host", tenantName: "Search Tenant" });
    token = res.body.accessToken;
    tenantId = res.body.user ? undefined : undefined; // get from /auth/me

    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    tenantId = me.body.tenantId;

    // Tenant B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "searchB@test.com", password: "pw", name: "B", tenantName: "Search Tenant B" });
    tokenB = resB.body.accessToken;

    searchService = app.get(SearchService);

    // Seed search documents
    await searchService.index({
      tenantId,
      entityType: "menu_item",
      entityId: "00000000-0000-0000-0000-000000000001",
      text: "Caesar Salad with croutons and parmesan",
      metadata: { name: "Caesar Salad", priceCents: 1200 },
    });
    await searchService.index({
      tenantId,
      entityType: "menu_item",
      entityId: "00000000-0000-0000-0000-000000000002",
      text: "Beef Burger with fries and salad",
      metadata: { name: "Beef Burger", priceCents: 1500 },
    });
    await searchService.index({
      tenantId,
      entityType: "booking",
      entityId: "00000000-0000-0000-0000-000000000003",
      text: "Alice Johnson party of 4",
      metadata: { customerName: "Alice Johnson" },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /search?q= returns matching documents", async () => {
    const res = await request(app.getHttpServer())
      .get("/search?q=salad")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const names = res.body.map((r: any) => r.metadata.name);
    expect(names).toContain("Caesar Salad");
  });

  it("GET /search?q=&type= filters by entity type", async () => {
    const res = await request(app.getHttpServer())
      .get("/search?q=salad&type=menu_item")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.every((r: any) => r.entityType === "menu_item")).toBe(true);
  });

  it("GET /search returns results across entity types", async () => {
    const res = await request(app.getHttpServer())
      .get("/search?q=Alice")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].entityType).toBe("booking");
  });

  it("GET /search returns empty for no matches", async () => {
    const res = await request(app.getHttpServer())
      .get("/search?q=xyznonexistent")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  it("results are tenant-isolated — tenant B sees no results for tenant A data", async () => {
    const res = await request(app.getHttpServer())
      .get("/search?q=salad")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  it("indexDocument upserts — re-indexing replaces old content", async () => {
    const id = "00000000-0000-0000-0000-000000000004";
    await searchService.index({
      tenantId,
      entityType: "menu_item",
      entityId: id,
      text: "Chocolate Cake",
      metadata: { name: "Chocolate Cake" },
    });

    // Re-index with updated text
    await searchService.index({
      tenantId,
      entityType: "menu_item",
      entityId: id,
      text: "Vanilla Cheesecake",
      metadata: { name: "Vanilla Cheesecake" },
    });

    const old = await searchService.search(tenantId, "chocolate");
    expect(old.find((r) => r.entityId === id)).toBeUndefined();

    const updated = await searchService.search(tenantId, "cheesecake");
    expect(updated.find((r) => r.entityId === id)).toBeDefined();

    // Cleanup
    await searchService.delete(id, "menu_item");
  });

  it("deleteDocument removes a document from search", async () => {
    const id = "00000000-0000-0000-0000-000000000005";
    await searchService.index({
      tenantId,
      entityType: "order",
      entityId: id,
      text: "Takeaway pepperoni pizza",
      metadata: { type: "takeaway" },
    });

    await searchService.delete(id, "order");

    const results = await searchService.search(tenantId, "pepperoni");
    expect(results.find((r) => r.entityId === id)).toBeUndefined();
  });
});
