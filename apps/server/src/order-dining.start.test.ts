import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sales, ticketItems, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining, DiningPolicy } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";

// A new order takes its way of selling from its department; a request naming a way the order does
// not have is refused before anything is sent, priced or paid (A1522, Decisions 3 and 11).
let venue: BillVenue;
let counterZoneId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counterZoneId = (await withTransaction(db, (tx) => offerProducts(tx, venue.cfg))).zoneId;
  },
});

/** Every department sells this way, starting a till-choice order as `startsAs`. */
async function departmentsSell(dining: DiningPolicy, startsAs: Dining = "eat_in"): Promise<void> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
      await setDepartmentSalePolicyField(tx, id, "diningStartsAs", startsAs);
    }
  });
}

beforeEach(() => departmentsSell("eat_in"));

async function diningOf(orderId: string): Promise<string | undefined> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ dining: workingOrders.dining })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId)),
  );
  return row?.dining;
}

/** The sales filed for the order and the kitchen tickets its lines were given. */
async function effectsOf(orderId: string): Promise<{ sales: number; ticketItems: number }> {
  return inTx(venue, async (tx) => {
    const filed = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, orderId));
    const lineIds = (
      await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
    ).map((line) => line.id);
    const tickets =
      lineIds.length === 0
        ? []
        : await tx
            .select({ id: ticketItems.id })
            .from(ticketItems)
            .where(inArray(ticketItems.workingOrderLineId, lineIds));
    return { sales: filed.length, ticketItems: tickets.length };
  });
}

const cana = () => [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }];

function park(body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    id: randomUUID(),
    lines: cana(),
    zoneId: counterZoneId,
    ...body,
  });
}

/** A counter order parked eaten here and then set to takeaway directly, as its department allows. */
async function parkedTakeaway(): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: cana(),
    zoneId: counterZoneId,
    operatorId: venue.operatorId,
  });
  await inTx(venue, (tx) =>
    tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, id)),
  );
  return id;
}

async function revisionOf(id: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id)),
  );
  return row!.revision;
}

describe("a new order's way of selling", () => {
  it("parks an order in a takeaway department as takeaway", async () => {
    await departmentsSell("takeaway");
    const parked = await park({});
    expect(parked.status).toBe(200);
    expect(await diningOf(parked.json.id as string)).toBe("takeaway");
  });

  it("refuses a park asking to eat in, in a takeaway department, and parks nothing", async () => {
    await departmentsSell("takeaway");
    const id = randomUUID();
    const parked = await park({ id, dining: "eat_in" });
    expect(parked.status).toBe(409);
    expect(parked.json).toEqual({ code: "order.dining_fixed", params: { dining: "takeaway" } });
    expect(await diningOf(id)).toBeUndefined();
  });

  it.each([
    ["takeaway", "takeaway"],
    [undefined, "takeaway"],
  ] as const)(
    "sells a walk-up in a till-choice department asked %s as %s",
    async (dining, expected) => {
      await departmentsSell("till_choice", "takeaway");
      const workingOrderId = randomUUID();
      const sold = await send(venue.app, venue.cookie, "POST", "/api/sales", {
        workingOrderId,
        lines: cana(),
        zoneId: counterZoneId,
        tender: { method: "cash", amount: "3.00" },
        ...(dining === undefined ? {} : { dining }),
      });
      expect(sold.status).toBe(200);
      expect(await diningOf(workingOrderId)).toBe(expected);
    },
  );

  it("sells a walk-up asked to eat in, in a till-choice department starting takeaway", async () => {
    await departmentsSell("till_choice", "takeaway");
    const workingOrderId = randomUUID();
    const sold = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId,
      lines: cana(),
      zoneId: counterZoneId,
      tender: { method: "cash", amount: "3.00" },
      dining: "eat_in",
    });
    expect(sold.status).toBe(200);
    expect(await diningOf(workingOrderId)).toBe("eat_in");
  });

  it("starts a table order eaten here in a till-choice department starting takeaway", async () => {
    await departmentsSell("till_choice", "takeaway");
    const { tabId } = await seatedWith(venue);
    expect(await diningOf(tabId)).toBe("eat_in");
  });

  it.each([null, "", "delivery", 1])(
    "refuses a request whose dining is %j as malformed",
    async (dining) => {
      const parked = await park({ dining });
      expect(parked.status).toBe(400);
      expect(parked.json).toEqual({
        code: "management.request_invalid",
        params: { field: "dining" },
      });
    },
  );
});

describe("a request naming a way an existing order does not have", () => {
  beforeEach(() => departmentsSell("till_choice"));

  it("refuses a cash sale of a takeaway order shown as eaten here", async () => {
    const id = await parkedTakeaway();
    const sold = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "3.00" },
      dining: "eat_in",
    });
    expect(sold.status).toBe(409);
    expect(sold.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision: await revisionOf(id) },
    });
    expect(await effectsOf(id)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("refuses a card pay of a takeaway order shown as eaten here", async () => {
    const id = await parkedTakeaway();
    const calls = venue.card.collectCalls.length;
    const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      dining: "eat_in",
    });
    expect(paid.status).toBe(409);
    expect(paid.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision: await revisionOf(id) },
    });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(await effectsOf(id)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("refuses saving a takeaway order shown as eaten here", async () => {
    const id = await parkedTakeaway();
    const revision = await revisionOf(id);
    const saved = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: [...cana(), ...cana()],
      revision,
      dining: "eat_in",
    });
    expect(saved.status).toBe(409);
    expect(saved.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision },
    });
    const lines = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(lines).toHaveLength(1);
    expect(await effectsOf(id)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("accepts a cash sale of a takeaway order shown as takeaway", async () => {
    const id = await parkedTakeaway();
    const sold = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      lines: [],
      tender: { method: "cash", amount: "3.00" },
      dining: "takeaway",
    });
    expect(sold.status).toBe(200);
    expect((await effectsOf(id)).sales).toBe(1);
  });

  it("refuses a round sent as eaten here to a table bill set to takeaway", async () => {
    const { partyId, tabId } = await seatedWith(venue);
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, tabId)),
    );
    const draftPath = `/api/parties/${partyId}/drafts`;
    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      draftPath,
      await observedDraftCommandBody(venue.db, "PUT", draftPath, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: cana(),
      }),
    );
    expect(saved.status).toBe(200);
    const draft = saved.json.draft as { id: string; revision: number; lines: { id: string }[] };
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );
    const submitPath = `${draftPath}/${draft.id}/submit`;
    const submitted = await send(
      venue.app,
      venue.cookie,
      "POST",
      submitPath,
      await observedDraftCommandBody(venue.db, "POST", submitPath, {
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedPartyRevision: party!.revision,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
        dining: "eat_in",
      }),
    );
    expect(submitted.status).toBe(409);
    expect(submitted.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: tabId, revision: await revisionOf(tabId) },
    });
    expect(await effectsOf(tabId)).toEqual({ sales: 0, ticketItems: 0 });
  });
});
