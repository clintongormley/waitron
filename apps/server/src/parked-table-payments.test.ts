import { randomUUID } from "node:crypto";
import { billEditStates } from "@waitron/db";
import type { HeldOrder } from "./working-order.js";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { offerProducts } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, seatedWith, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
let counterZone: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counterZone = (await inTx(venue, (tx) => offerProducts(tx, venue.cfg))).zoneId;
  },
});

describe("parked bills paid with their retrieved edit observation", () => {
  it.each([
    ["counter", "cash"],
    ["counter", "card"],
    ["table", "cash"],
    ["table", "card"],
  ] as const)("pays a retrieved %s bill with %s", async (origin, method) => {
    const app = venue.app;
    let id: string;
    if (origin === "table") {
      id = (await seatedWith(venue, "Paella")).tabId;
    } else {
      id = randomUUID();
      const parked = await app.request("/api/working-orders", {
        method: "POST",
        headers: { cookie: venue.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          id,
          zoneId: counterZone,
          lines: [{ menuItemId: venue.offerFor("Paella"), quantity: "1" }],
          label: "Parked order",
        }),
      });
      expect(parked.status, await parked.clone().text()).toBe(200);
    }
    const retrievedResponse = await app.request(`/api/working-orders/${id}`, {
      headers: { cookie: venue.cookie },
    });
    expect(retrievedResponse.status).toBe(200);
    const retrieved = (await retrievedResponse.json()) as HeldOrder;
    expect(retrieved.id).toBe(id);
    expect(retrieved).toHaveProperty("expectedEdit");
    if (origin === "counter") expect(retrieved.expectedEdit).toBeNull();
    else
      expect(retrieved.expectedEdit).toMatchObject({
        billId: id,
        editorVersion: expect.any(Number),
        draftId: null,
        draftRevision: null,
      });
    const response = await app.request("/api/sales", {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        workingOrderId: id,
        lines: retrieved.lines,
        tender: { method, amount: "35.00" },
        expectedEdit: retrieved.expectedEdit,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const outcome = await response.json();
    expect(outcome).toMatchObject({ total: "35.00" });
  });
});

it.each(["missing", "stale"] as const)(
  "refuses a %s table edit observation before taking cash",
  async (kind) => {
    const { tabId: id } = await seatedWith(venue, "Paella");
    const read = await venue.app.request(`/api/working-orders/${id}`, {
      headers: { cookie: venue.cookie },
    });
    expect(read.status).toBe(200);
    const retrieved = (await read.json()) as HeldOrder;
    if (kind === "stale")
      await venue.db
        .insert(billEditStates)
        .values({ billId: id, editorVersion: retrieved.expectedEdit!.editorVersion + 1 })
        .onConflictDoUpdate({
          target: billEditStates.billId,
          set: { editorVersion: retrieved.expectedEdit!.editorVersion + 1 },
        });
    const response = await venue.app.request("/api/sales", {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        workingOrderId: id,
        lines: retrieved.lines,
        tender: { method: "cash", amount: "35.00" },
        expectedEdit: kind === "missing" ? null : retrieved.expectedEdit,
      }),
    });
    expect(response.status).toBe(kind === "missing" ? 400 : 409);
    expect(await response.json()).toMatchObject({
      error: { code: kind === "missing" ? "management.request_invalid" : "draft.out_of_date" },
    });
    const balance = await venue.app.request(`/api/working-orders/${id}/payments`, {
      headers: { cookie: venue.cookie },
    });
    expect(balance.status).toBe(200);
    expect(await balance.json()).toMatchObject({ received: "0.00", outstanding: "35.00" });
  },
);
