import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sales, ticketItems, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining, DiningPolicy } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  departments,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { createTable } from "./testing/live-table.js";
import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  tabWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { createOpenOrder, parkOrder } from "./working-order.js";

// A new order takes its way of selling from its department; a request naming a way the order does
// not have is refused before anything is sent, priced or paid (A1522, Decisions 3 and 11).
let venue: BillVenue;
let counterZoneId: string;
let counter: ZoneOffers;
let tables: ZoneOffers;
let menu: Awaited<ReturnType<typeof seedTakeawayProducts>>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      menu = await seedTakeawayProducts(tx);
      counter = await offerProducts(tx);
      tables = await offerProducts(tx, { zone: "tables" });
    });
    counterZoneId = counter.zoneId;
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

const croquettes = () => [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }];

function counterPayment(
  id: string,
  payment: { method: "cash"; tendered: string } | { method: "card"; entry: "reader" },
  dining: Dining | undefined,
  lines = croquettes(),
) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "share",
    shareOf: 1,
    ...payment,
    dining,
    basket: { lines, zoneId: counterZoneId },
  });
}

function park(body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    dining: "eat_in",
    id: randomUUID(),
    lines: croquettes(),
    zoneId: counterZoneId,
    ...body,
  });
}

/** A counter order parked eaten here and then set to takeaway directly, as its department allows. */
async function parkedTakeaway(): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: croquettes(),
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
    const parked = await park({ dining: "takeaway" });
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

  it("sells a walk-up asked takeaway, in a till-choice department starting takeaway", async () => {
    await departmentsSell("till_choice", "takeaway");
    const workingOrderId = randomUUID();
    const sold = await counterPayment(
      workingOrderId,
      { method: "cash", tendered: "10.00" },
      "takeaway",
    );
    expect(sold.status).toBe(200);
    expect(await diningOf(workingOrderId)).toBe("takeaway");
  });

  it("refuses a walk-up that does not say its way, in a till-choice department, and records nothing", async () => {
    await departmentsSell("till_choice", "takeaway");
    const workingOrderId = randomUUID();
    const sold = await counterPayment(
      workingOrderId,
      { method: "cash", tendered: "10.00" },
      undefined,
    );
    expect(sold.status).toBe(400);
    expect(sold.json).toEqual({ code: "management.request_invalid", params: { field: "dining" } });
    expect(await diningOf(workingOrderId)).toBeUndefined();
    expect(await effectsOf(workingOrderId)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("sells a walk-up asked to eat in, in a till-choice department starting takeaway", async () => {
    await departmentsSell("till_choice", "takeaway");
    const workingOrderId = randomUUID();
    const sold = await counterPayment(
      workingOrderId,
      { method: "cash", tendered: "10.00" },
      "eat_in",
    );
    expect(sold.status).toBe(200);
    expect(await diningOf(workingOrderId)).toBe("eat_in");
  });

  it("starts a table order eaten here in a till-choice department starting takeaway", async () => {
    await departmentsSell("till_choice", "takeaway");
    const { tabId } = await seatedWith(venue);
    expect(await diningOf(tabId)).toBe("eat_in");
  });

  it("creates an order delivered to a table using the table's dining rule", async () => {
    await departmentsSell("takeaway");
    const tableId = await inTx(venue, async (tx) => {
      const terrace = await createDepartment(tx, { name: `Terrace ${randomUUID()}` });
      await setDepartmentSalePolicyField(tx, terrace.id, "dining", "eat_in");
      const zone = await createServiceZone(tx, {
        name: `Terrace ${randomUUID()}`,
        departmentId: terrace.id,
        orderStart: "table",
      });
      await offerProducts(tx, { zone: { zoneId: zone.id }, orderStart: "table" });
      return (await createTable(tx, { label: `T-${randomUUID()}`, zoneId: zone.id })).id;
    });
    const workingOrderId = randomUUID();
    await inTx(venue, (tx) =>
      createOpenOrder(tx, venue.cfg, workingOrderId, croquettes(), null, {
        dining: "eat_in",
        zoneId: counterZoneId,
        deliveryTableId: tableId,
      }),
    );
    expect(await diningOf(workingOrderId)).toBe("eat_in");
  });

  it("gives a bill split off a takeaway bill the same way", async () => {
    await departmentsSell("till_choice");
    const tabId = await tabWith(venue, "Croquettes", "Octopus");
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, tabId)),
    );
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId)),
    );
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 2))),
    );
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${order!.partyId}`,
    );
    const path = `/api/bills/${tabId}/move-dishes`;
    const moved = await send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await observedBillActionBody(venue.db, path, {
        partyId: order!.partyId,
        expectedPartyRevision: party!.revision,
        lineIds: [line!.id],
        toBillId: null,
      }),
    );
    expect(moved.status).toBe(200);
    const newBillId = moved.json.billId as string;
    expect(newBillId).not.toBe(tabId);
    expect(await diningOf(newBillId)).toBe("takeaway");
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

describe("the way a zone's offers say a new order starts", () => {
  async function contextDining(zoneId: string): Promise<unknown> {
    const answer = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/service-zones/${zoneId}/offers`,
    );
    expect(answer.status).toBe(200);
    return (answer.json.context as { dining: unknown }).dining;
  }

  it.each([
    ["eat_in", "takeaway", "eat_in"],
    ["takeaway", "eat_in", "takeaway"],
    ["till_choice", "takeaway", "takeaway"],
    ["till_choice", "eat_in", "eat_in"],
  ] as const)(
    "a counter zone in a %s department starting %s starts %s",
    async (policy, startsAs, starts) => {
      await departmentsSell(policy, startsAs);
      expect(await contextDining(counterZoneId)).toEqual({ policy, startsAs: starts });
    },
  );

  it("a table zone in a till-choice department starting takeaway starts eaten here", async () => {
    await departmentsSell("till_choice", "takeaway");
    expect(await contextDining(tables.zoneId)).toEqual({
      policy: "till_choice",
      startsAs: "eat_in",
    });
  });

  it("the menu-state poll carries the way after a department's setting is saved", async () => {
    const poll = async () => {
      const answer = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/menu-state?zoneId=${counterZoneId}`,
      );
      expect(answer.status).toBe(200);
      return answer.json.dining;
    };
    await departmentsSell("eat_in");
    expect(await poll()).toEqual({ policy: "eat_in", startsAs: "eat_in" });
    await departmentsSell("takeaway");
    expect(await poll()).toEqual({ policy: "takeaway", startsAs: "takeaway" });
    await departmentsSell("till_choice", "takeaway");
    expect(await poll()).toEqual({ policy: "till_choice", startsAs: "takeaway" });
  });

  it("the default zone's offers say the same", async () => {
    await departmentsSell("takeaway");
    const answer = await send(venue.app, venue.cookie, "GET", "/api/default-service-zone/offers");
    expect(answer.status).toBe(200);
    expect((answer.json.context as { dining: unknown }).dining).toEqual({
      policy: "takeaway",
      startsAs: "takeaway",
    });
  });

  it("answers null in a region that charges no takeaway VAT", async () => {
    await departmentsSell("takeaway");
    await venue.db.execute(sql`update taxpayer set country = 'GB'`);
    await venue.db.execute(
      sql`update settings set doc = json_set(doc, '$.fiscalTerritory', 'GB-vat') where module = 'venue'`,
    );
    try {
      expect(await contextDining(counterZoneId)).toBeNull();
      const poll = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/menu-state?zoneId=${counterZoneId}`,
      );
      expect(poll.json.dining).toBeNull();
    } finally {
      await venue.db.execute(sql`update taxpayer set country = 'ES'`);
      await venue.db.execute(
        sql`update settings set doc = json_set(doc, '$.fiscalTerritory', 'ES-common') where module = 'venue'`,
      );
    }
  });
});

describe("a request naming a way an existing order does not have", () => {
  beforeEach(() => departmentsSell("till_choice"));

  it("refuses a cash sale of a takeaway order shown as eaten here", async () => {
    const id = await parkedTakeaway();
    const sold = await counterPayment(id, { method: "cash", tendered: "10.00" }, "eat_in", []);
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
    const paid = await counterPayment(id, { method: "card", entry: "reader" }, "eat_in", []);
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
      lines: [...croquettes(), ...croquettes()],
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
    const sold = await counterPayment(id, { method: "cash", tendered: "10.00" }, "takeaway", []);
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
        lines: croquettes(),
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

describe("a request that does not say how the order is sold", () => {
  const refusal = { code: "management.request_invalid", params: { field: "dining" } };

  async function linesOf(id: string): Promise<number> {
    const lines = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    );
    return lines.length;
  }

  it("refuses a cash sale and records nothing", async () => {
    const workingOrderId = randomUUID();
    const sold = await counterPayment(
      workingOrderId,
      { method: "cash", tendered: "10.00" },
      undefined,
    );
    expect(sold.status).toBe(400);
    expect(sold.json).toEqual(refusal);
    expect(await diningOf(workingOrderId)).toBeUndefined();
    expect(await effectsOf(workingOrderId)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("refuses a card pay, asks the reader for nothing and records nothing", async () => {
    const id = await parkedTakeaway();
    const revision = await revisionOf(id);
    const calls = venue.card.collectCalls.length;
    const paid = await counterPayment(id, { method: "card", entry: "reader" }, undefined, []);
    expect(paid.status).toBe(400);
    expect(paid.json).toEqual(refusal);
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(await revisionOf(id)).toBe(revision);
    expect(await effectsOf(id)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("refuses a park and parks nothing", async () => {
    const id = randomUUID();
    const parked = await park({ id, dining: undefined });
    expect(parked.status).toBe(400);
    expect(parked.json).toEqual(refusal);
    expect(await diningOf(id)).toBeUndefined();
    expect(await linesOf(id)).toBe(0);
  });

  it("refuses saving an open order and leaves it as it was", async () => {
    const id = await parkedTakeaway();
    const revision = await revisionOf(id);
    const saved = await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${id}`, {
      lines: [...croquettes(), ...croquettes()],
      revision,
      dining: undefined,
    });
    expect(saved.status).toBe(400);
    expect(saved.json).toEqual(refusal);
    expect(await linesOf(id)).toBe(1);
    expect(await revisionOf(id)).toBe(revision);
    expect(await effectsOf(id)).toEqual({ sales: 0, ticketItems: 0 });
  });

  it("refuses sending a round and sends nothing", async () => {
    const { partyId, tabId } = await seatedWith(venue);
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
        lines: croquettes(),
      }),
    );
    expect(saved.status).toBe(200);
    const draft = saved.json.draft as { id: string; revision: number; lines: { id: string }[] };
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );
    const linesBefore = await linesOf(tabId);
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
        dining: undefined,
      }),
    );
    expect(submitted.status).toBe(400);
    expect(submitted.json).toEqual(refusal);
    expect(await linesOf(tabId)).toBe(linesBefore);
    expect(await effectsOf(tabId)).toEqual({ sales: 0, ticketItems: 0 });
  });
});

describe("the classes a line keeps", () => {
  beforeEach(() => departmentsSell("till_choice"));

  it("stores its served class as the takeaway class on every line of a takeaway order, an extra too", async () => {
    const parked = await park({
      dining: "takeaway",
      lines: [
        { menuItemId: counter.offerFor(menu.cola), quantity: "1" },
        { menuItemId: counter.offerFor(menu.cheese), quantity: "1" },
        {
          menuItemId: counter.offerFor(menu.burger),
          quantity: "1",
          extras: [
            { listId: menu.burgerExtras, picks: [{ productId: menu.lemonSoda, quantity: 1 }] },
          ],
        },
      ],
    });
    expect(parked.status).toBe(200);
    const rows = await inTx(venue, (tx) =>
      tx
        .select({
          productId: workingOrderLines.productId,
          vatClass: workingOrderLines.vatClass,
          takeawayVatClass: workingOrderLines.takeawayVatClass,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, parked.json.id as string))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(rows).toEqual([
      { productId: menu.cola, vatClass: "reduced", takeawayVatClass: "reduced" },
      { productId: menu.cheese, vatClass: "super_reduced", takeawayVatClass: "super_reduced" },
      { productId: menu.burger, vatClass: "general", takeawayVatClass: "general" },
      { productId: menu.lemonSoda, vatClass: "reduced", takeawayVatClass: "reduced" },
    ]);
  });
});
