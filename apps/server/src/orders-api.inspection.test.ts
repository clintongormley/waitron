import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { send } from "./testing/bill-venue.js";
import { sessionHolding } from "./testing/session-holding.js";
import { placedIssuedBill, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

describe("a session holding only invoice.inspect", () => {
  let inspector: string;
  let nobody: string;
  let billId: string;
  beforeAll(async () => {
    inspector = (await sessionHolding(venue.db, ["invoice.inspect"])).cookie;
    nobody = (await sessionHolding(venue.db, [])).cookie;
    billId = await placedIssuedBill(venue, "Seafood rice");
  });

  const routes: [
    string,
    "GET" | "POST",
    () => string,
    () => Record<string, unknown> | undefined,
  ][] = [
    ["the list", "GET", () => "/management-api/orders", () => undefined],
    ["the staff filter", "GET", () => "/management-api/orders/staff", () => undefined],
    ["the printers", "GET", () => "/management-api/orders/printers", () => undefined],
    ["a bill's detail", "GET", () => `/management-api/orders/${billId}`, () => undefined],
    [
      "a reprint",
      "POST",
      () => `/management-api/orders/${billId}/reprint`,
      () => ({ printerId: venue.printerId }),
    ],
    [
      "a printed invoice delivery",
      "POST",
      () => `/management-api/orders/${billId}/invoice-deliveries`,
      () => ({ medium: "print", requestKey: randomUUID(), printerId: venue.printerId }),
    ],
    [
      "an emailed invoice delivery",
      "POST",
      () => `/management-api/orders/${billId}/invoice-deliveries`,
      () => ({ medium: "email", requestKey: randomUUID(), recipient: "guest@example.com" }),
    ],
    [
      "a delivery retry",
      "POST",
      () => `/management-api/orders/${billId}/invoice-deliveries/${randomUUID()}/retry`,
      () => ({ requestKey: randomUUID() }),
    ],
    ["the invoice PDF", "POST", () => `/management-api/orders/${billId}/invoice-pdf`, () => ({})],
  ];

  it.each(routes)("is refused %s", async (_name, method, path, body) => {
    const answer = await send(venue.orders, inspector, method, path(), body());
    expect(answer).toMatchObject({
      status: 403,
      json: { code: "authorization.inspection_only" },
    });
  });

  it("leaves a session with no permission at all seeing today's bills and reprinting one", async () => {
    const list = await send(venue.orders, nobody, "GET", "/management-api/orders");
    expect(list.status).toBe(200);
    expect((list.json as { rows: { id: string }[] }).rows.map((row) => row.id)).toContain(billId);
    const reprint = await send(
      venue.orders,
      nobody,
      "POST",
      `/management-api/orders/${billId}/reprint`,
      { printerId: venue.printerId },
    );
    expect(reprint.status).toBe(202);
  });

  it("leaves a session holding invoice.inspect beside report.view seeing the list", async () => {
    const manager = (await sessionHolding(venue.db, ["invoice.inspect", "report.view"])).cookie;
    const list = await send(venue.orders, manager, "GET", "/management-api/orders");
    expect(list.status).toBe(200);
    expect((list.json as { rows: { id: string }[] }).rows.map((row) => row.id)).toContain(billId);
  });
});
