import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DATABASE_TOKEN } from "../src/database/database.provider";
import { users, tenants } from "@waitron/db";

// Fixed future datetime to avoid timezone flakiness
const BOOKING_DATE = "2030-06-15";
const BOOKING_DATETIME = `${BOOKING_DATE}T18:00:00.000Z`;

describe("Bookings (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let locationId: string;
  let tableId: string;
  let bookingId: string;

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
      .send({ email: "bookings@test.com", password: "pw", name: "Host", tenantName: "Booking Tenant" });
    token = res.body.accessToken;

    // Tenant B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "bookingsB@test.com", password: "pw", name: "B", tenantName: "Booking Tenant B" });
    tokenB = resB.body.accessToken;

    // Location for tenant A
    const loc = await request(app.getHttpServer())
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "The Bistro" });
    locationId = loc.body.id;

    // Table at the location (capacity 4)
    const tbl = await request(app.getHttpServer())
      .post(`/locations/${locationId}/tables`)
      .set("Authorization", `Bearer ${token}`)
      .send({ number: "T1", capacity: 4 });
    tableId = tbl.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create ────────────────────────────────────────────────

  it("POST creates a booking and assigns a table", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Alice Smith",
        customerEmail: "alice@example.com",
        partySize: 2,
        datetime: BOOKING_DATETIME,
        durationMinutes: 90,
      })
      .expect(201);

    expect(res.body.customerName).toBe("Alice Smith");
    expect(res.body.status).toBe("pending");
    expect(res.body.tables).toHaveLength(1);
    expect(res.body.tables[0].id).toBe(tableId);
    bookingId = res.body.id;
  });

  it("POST rejects double-booking (same table, overlapping time)", async () => {
    await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Bob Jones",
        partySize: 4,
        datetime: BOOKING_DATETIME, // same slot
        durationMinutes: 90,
      })
      .expect(409);
  });

  it("POST allows booking after the first booking ends", async () => {
    // First booking ends at 19:30, so 19:30 should be available
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Carol Green",
        partySize: 2,
        datetime: `${BOOKING_DATE}T19:30:00.000Z`,
        durationMinutes: 60,
      })
      .expect(201);

    // Clean up this booking right away
    await request(app.getHttpServer())
      .delete(`/locations/${locationId}/bookings/${res.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });

  // ── List ─────────────────────────────────────────────────

  it("GET lists all bookings for the location", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET ?date= filters by date", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/bookings?date=${BOOKING_DATE}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(bookingId);
  });

  it("GET :id returns booking with tableIds", async () => {
    const res = await request(app.getHttpServer())
      .get(`/locations/${locationId}/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(bookingId);
    expect(res.body.tableIds).toContain(tableId);
  });

  // ── Status ───────────────────────────────────────────────

  it("PATCH /status confirms a booking", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/locations/${locationId}/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "confirmed" })
      .expect(200);
    expect(res.body.status).toBe("confirmed");
  });

  it("PATCH /status seats a booking", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/locations/${locationId}/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "seated" })
      .expect(200);
    expect(res.body.status).toBe("seated");
  });

  it("PATCH /status cancels a booking", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/locations/${locationId}/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" })
      .expect(200);
    expect(res.body.status).toBe("cancelled");
  });

  // After cancellation the slot should be free again
  it("POST allows new booking after cancellation frees the slot", async () => {
    const res = await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Dave White",
        partySize: 4,
        datetime: BOOKING_DATETIME,
        durationMinutes: 90,
      })
      .expect(201);

    expect(res.body.tables).toHaveLength(1);

    // Restore: cancel this booking so later tests are clean
    await request(app.getHttpServer())
      .patch(`/locations/${locationId}/bookings/${res.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });
  });

  // ── Availability ─────────────────────────────────────────

  it("GET /availability returns 26 time slots", async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/locations/${locationId}/availability?date=${BOOKING_DATE}&partySize=2`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(26);
    expect(res.body[0]).toHaveProperty("time");
    expect(res.body[0]).toHaveProperty("available");
  });

  it("GET /availability shows slot unavailable when table is booked", async () => {
    // Create an active booking at 18:00
    const b = await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Eve Brown",
        partySize: 2,
        datetime: BOOKING_DATETIME,
        durationMinutes: 90,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(
        `/locations/${locationId}/availability?date=${BOOKING_DATE}&partySize=2`,
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // 18:00 slot (index 18) should be unavailable
    const slot1800 = res.body.find((s: { time: string }) =>
      s.time.includes("T18:00"),
    );
    expect(slot1800.available).toBe(false);

    // 09:00 slot should be available
    const slot0900 = res.body.find((s: { time: string }) =>
      s.time.includes("T09:00"),
    );
    expect(slot0900.available).toBe(true);

    // Cleanup
    await request(app.getHttpServer())
      .delete(`/locations/${locationId}/bookings/${b.body.id}`)
      .set("Authorization", `Bearer ${token}`);
  });

  // ── Tenant isolation ─────────────────────────────────────

  it("tenant B cannot access tenant A bookings", async () => {
    return request(app.getHttpServer())
      .get(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  // ── Delete ───────────────────────────────────────────────

  it("DELETE removes a booking", async () => {
    // Create a fresh booking to delete
    const b = await request(app.getHttpServer())
      .post(`/locations/${locationId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        customerName: "Frank Black",
        partySize: 1,
        datetime: `${BOOKING_DATE}T10:00:00.000Z`,
        durationMinutes: 60,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/locations/${locationId}/bookings/${b.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/locations/${locationId}/bookings/${b.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});
