import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { send } from "./testing/bill-venue.js";
import { provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

it("returns a fixed table page with matching total and default business dates", async () => {
  const answer = await send(
    venue.orders,
    venue.supervisorDashboard,
    "GET",
    "/management-api/orders",
  );
  expect(answer.status).toBe(200);
  expect(answer.json).toEqual({
    rows: [],
    total: 0,
    page: 0,
    pageSize: 50,
    from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

it.each([
  ["page=-1", "page"],
  ["page=0.5", "page"],
  ["page=9007199254740991", "page"],
  ["sortKey=staff", "sortKey"],
  ["sortDirection=sideways", "sortDirection"],
  ["limit=50", "limit"],
  ["after=anything", "after"],
  ["pageSize=100", "pageSize"],
])("refuses unsupported paging input %s", async (query, field) => {
  const answer = await send(
    venue.orders,
    venue.supervisorDashboard,
    "GET",
    `/management-api/orders?${query}`,
  );
  expect(answer).toMatchObject({
    status: 400,
    json: { code: "management.request_invalid", params: { field } },
  });
});
