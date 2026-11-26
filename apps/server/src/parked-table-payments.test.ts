import { randomUUID } from "node:crypto";
import { workingOrders } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { HeldOrder } from "./working-order-held-read.js";
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
    counterZone = (await inTx(venue, (tx) => offerProducts(tx))).zoneId;
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
      id = (await seatedWith(venue, "Seafood rice")).tabId;
    } else {
      id = randomUUID();
      const parked = await app.request("/api/working-orders", {
        method: "POST",
        headers: { cookie: venue.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          dining: "eat_in",
          id,
          zoneId: counterZone,
          lines: [{ menuItemId: venue.offerFor("Seafood rice"), quantity: "1" }],
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
    const response = await app.request(`/api/working-orders/${id}/payments`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        dining: "eat_in",
        submissionId: id,
        kind: "share",
        shareOf: 1,
        method,
        applied: "35.00",
        tip: "0.00",
        ...(method === "cash" ? { tendered: "35.00" } : { entry: "manual" }),
        expectedEdit: retrieved.expectedEdit,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const outcome = await response.json();
    expect(outcome).toMatchObject({ invoice: { total: "35.00" } });
  });
});

it.each(["missing", "stale"] as const)(
  "refuses a %s table edit observation before taking cash",
  async (kind) => {
    const { tabId: id } = await seatedWith(venue, "Seafood rice");
    const read = await venue.app.request(`/api/working-orders/${id}`, {
      headers: { cookie: venue.cookie },
    });
    expect(read.status).toBe(200);
    const retrieved = (await read.json()) as HeldOrder;
    if (kind === "stale")
      await venue.db
        .update(workingOrders)
        .set({ editorVersion: retrieved.expectedEdit!.editorVersion + 1 })
        .where(eq(workingOrders.id, id));
    const response = await venue.app.request(`/api/working-orders/${id}/payments`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        dining: "eat_in",
        submissionId: id,
        kind: "share",
        shareOf: 1,
        method: "cash",
        tendered: "35.00",
        applied: "35.00",
        tip: "0.00",
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

describe("a Counter order paid for by item, with the edit state the till can read", () => {
  async function parkedCounterOrder(): Promise<{ id: string; lineIds: string[] }> {
    const id = randomUUID();
    const parked = await venue.app.request("/api/working-orders", {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        dining: "eat_in",
        id,
        zoneId: counterZone,
        lines: [
          { menuItemId: venue.offerFor("Seafood rice"), quantity: "1" },
          { menuItemId: venue.offerFor("Steak"), quantity: "1" },
        ],
        label: "Parked order",
      }),
    });
    expect(parked.status, await parked.clone().text()).toBe(200);
    const read = await venue.app.request(`/api/working-orders/${id}`, {
      headers: { cookie: venue.cookie },
    });
    expect(read.status).toBe(200);
    const held = (await read.json()) as HeldOrder;
    expect(held.expectedEdit).toBeNull();
    return { id, lineIds: held.lines.map((line) => line.workingOrderLineId!) };
  }

  const payForSeafoodRice = (id: string, lineId: string, expectedEdit: unknown) =>
    venue.app.request(`/api/working-orders/${id}/item-payments`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: randomUUID(),
        picks: [{ lineId }],
        expectedEdits: [expectedEdit],
        method: "cash",
        tendered: "35.00",
        applied: "35.00",
        tip: "0.00",
      }),
    });

  it("refuses the held read's answer, which carries no edit state for an order with no party", async () => {
    const { id, lineIds } = await parkedCounterOrder();

    const response = await payForSeafoodRice(id, lineIds[0]!, null);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("moves the dish to a paid bill of its own with the edit state the bill read answers", async () => {
    const { id, lineIds } = await parkedCounterOrder();
    const found = await venue.app.request(`/api/bills/${id}`, {
      headers: { cookie: venue.cookie },
    });
    expect(found.status).toBe(200);
    const bill = (await found.json()) as { partyId: string | null; edit: { billId: string } };
    expect(bill.partyId).toBeNull();
    expect(bill.edit.billId).toBe(id);

    const response = await payForSeafoodRice(id, lineIds[0]!, bill.edit);

    expect(response.status, await response.clone().text()).toBe(200);
    const paid = (await response.json()) as {
      billId: string;
      payment: { invoice: { total: string } };
      sourceBalance: { total: string; outstanding: string };
    };
    expect(paid.billId).not.toBe(id);
    expect(paid.payment).toMatchObject({ invoice: { total: "35.00" } });
    expect(paid.sourceBalance).toMatchObject({ total: "25.00", outstanding: "25.00" });
  });
});
