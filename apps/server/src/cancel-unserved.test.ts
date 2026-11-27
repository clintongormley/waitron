import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  orderAmendments,
  personRoles,
  readLiveSeriesIdTx,
  roles,
  saleVoids,
  workingOrderLines,
  workingOrders,
  writeNodeMembership,
} from "@waitron/db";
import { recordReplacement, recordSubstitution } from "@waitron/core";
import { createExtraList, writeProductModifiers } from "@waitron/menu";
import { filedRecordsOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import {
  acceptedByAeat,
  refusedByAeat,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId, type SaleId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { cancelItemHttp, cancelReasonId } from "./testing/cancel-line.js";
import { inTx, seatedWith, send, statusOf, type Answer } from "./testing/bill-venue.js";
import { departed, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import { takeOver } from "./testing/taken-over.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

let venue: OrderVenue;
/** Steak's extras list, offering Croquettes at 1.00. */
let extraListId: string;
let croquettesId: string;
/** A person whose only role grants `sale.void`, and one whose only role grants `sale.rectify`. */
let voider: string;
let rectifier: string;
const PIN = "4321";
const REASON = "Wrong table";

async function personHolding(permission: string): Promise<string> {
  return inTx(venue, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: `Holds ${permission}`,
      pinHash: hashPin(PIN),
    });
    const [role] = await tx
      .insert(roles)
      .values({
        name: `Only ${permission}`,
        nameFolded: `only ${permission}`,
        permissions: [permission],
      })
      .returning({ id: roles.id });
    await tx.delete(personRoles).where(eq(personRoles.personId, person!.id));
    await tx.insert(personRoles).values({ personId: person!.id, roleId: role!.id });
    return person!.id;
  });
}

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      const ids = new Map(
        db
          .all<{ id: string; name: string }>(sql`select id, name from products`)
          .map((row) => [row.name, row.id]),
      );
      croquettesId = ids.get("Croquettes")!;
      const extras = await createExtraList(
        tx,
        {
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: croquettesId, maxQuantity: 1, preselected: false, price: "1.00" }],
        },
        venue.cfg.locale,
      );
      extraListId = extras.id;
      await writeProductModifiers(tx, ids.get("Steak")!, [{ kind: "extras", id: extras.id }]);
      await offerProducts(tx, { zone: "tables" });
    });
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
    voider = await personHolding("sale.void");
    rectifier = await personHolding("sale.rectify");
  },
});

type Party = { partyId: string; tabId: string };

/** A party seated with the dishes, sent to the kitchen, none served, its bill printed anyway. */
async function printedUnserved(
  ...lines: (string | { name: string; extras: unknown[] })[]
): Promise<Party> {
  const names = lines.filter((line): line is string => typeof line === "string");
  const party =
    names.length === lines.length
      ? await seatedWith(venue, ...names)
      : await seatedWithLines(lines);
  return printAnyway(party);
}

async function printAnyway(party: Party): Promise<Party> {
  const ticket = await fixture.printBill(venue, party, party.tabId, true);
  expect(ticket.status, JSON.stringify(ticket.json)).toBe(200);
  return party;
}

async function seatedWithLines(lines: (string | { name: string; extras: unknown[] })[]) {
  const party = await seatedWith(venue);
  const ordered = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/parties/${party.partyId}/groups`,
    {
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: fixture.revisionOf(venue, party.partyId),
      groups: [
        {
          lines: lines.map((line) =>
            typeof line === "string"
              ? { menuItemId: venue.offerFor(line), quantity: "1" }
              : { menuItemId: venue.offerFor(line.name), quantity: "1", extras: line.extras },
          ),
          release: "fire",
        },
      ],
    },
  );
  expect(ordered.status, JSON.stringify(ordered.json)).toBe(200);
  return party;
}

/** The receipt refused by AEAT and replaced; answers the replacement's id. */
async function replacedAfterRefusal(saleId: SaleId): Promise<SaleId> {
  await inTx(venue, (tx) => refusedByAeat(tx, saleId));
  return sendReplacement(saleId);
}

/** Fiscal filing's Send the replacement on the receipt `saleId`; answers the replacement's id. */
function sendReplacement(saleId: SaleId): Promise<SaleId> {
  return inTx(venue, async (tx) => {
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    const replaced = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
      correctsSaleId: saleId,
      authz: { sessionId: session.id },
      clock: venue.clock,
    });
    return replaced.saleId;
  });
}

/** Stamps the bill handed over, as a counter handover does before the order is moved to a table. */
function handOver(billId: string): void {
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  venue.db.run(sql`update working_orders set collected_at = ${minuteAgo} where id = ${billId}`);
}

function cancel(billId: string, cookie = venue.supervisorTill, app = venue.app): Promise<Answer> {
  return send(app, cookie, "POST", `/api/working-orders/${billId}/cancel`, { reason: REASON });
}

function cancelApprovedBy(billId: string, personId: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/cancel`, {
    reason: REASON,
    override: { personId, pin: PIN },
  });
}

async function saleOf(billId: string): Promise<SaleId> {
  return brandSaleId((await fixture.invoiceOf(venue, billId)).id);
}

function voidsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ reason: saleVoids.reason, voidedBy: saleVoids.voidedBy })
      .from(saleVoids)
      .where(eq(saleVoids.saleId, saleId)),
  );
}

/** Everything a cancel writes: the cancellation, any corrective, records and amendments. */
function written() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from sale_voids) as voids,
      (select count(*) from verifactu_records) as records,
      (select count(*) from order_amendments) as amendments,
      (select count(*) from working_orders where status = 'abandoned') as abandoned
  `)[0];
}

async function expectRefused(
  billId: string,
  answer: () => Promise<Answer>,
  refusal: { status: number; code: string },
): Promise<Answer> {
  const before = written();
  const answered = await answer();
  expect({ status: answered.status, code: answered.json.code }).toEqual(refusal);
  expect(written()).toEqual(before);
  expect(await statusOf(venue, billId)).toBe("placed");
  return answered;
}

describe("Nothing was served on a printed bill nobody paid", () => {
  it("files a cancellation of the receipt, no corrective, and abandons the bill", async () => {
    const party = await printedUnserved("Tarta");
    const saleId = await saleOf(party.tabId);

    const answer = await cancel(party.tabId);

    expect(answer).toEqual({ status: 200, json: { filed: "cancellation" } });
    expect(await voidsOf(saleId)).toEqual([{ reason: REASON, voidedBy: venue.supervisorId }]);
    expect(await filedRecordsOf(venue.db, saleId)).toEqual([
      { kind: "invoice", state: "pendiente" },
      { kind: "cancellation", state: "pendiente" },
    ]);
    expect(await fixture.creditsOf(venue, saleId)).toEqual([]);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    const bills = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrders.id, status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.partyId, party.partyId)),
    );
    expect(bills).toEqual(
      expect.arrayContaining([
        { id: party.tabId, status: "abandoned" },
        { id: expect.not.stringMatching(party.tabId), status: "open" },
      ]),
    );
    const [last] = await inTx(venue, (tx) =>
      tx
        .select({ kind: orderAmendments.kind, reason: orderAmendments.reason })
        .from(orderAmendments)
        .where(eq(orderAmendments.workingOrderId, party.tabId))
        .orderBy(sql`${orderAmendments.sequenceNo} desc`)
        .limit(1),
    );
    expect(last).toEqual({ kind: "order_cancelled", reason: REASON });
    const row = await send(
      venue.orders,
      venue.supervisorDashboard,
      "GET",
      `/management-api/orders/${party.tabId}`,
    );
    expect((row.json as { row: { status: string } }).row.status).toBe("voided");
  });

  it("cancels a receipt AEAT accepted", async () => {
    const party = await printedUnserved("Tarta");
    const saleId = await saleOf(party.tabId);
    await inTx(venue, (tx) => acceptedByAeat(tx, saleId));

    const answer = await cancel(party.tabId);

    expect(answer).toEqual({ status: 200, json: { filed: "cancellation" } });
    expect(await filedRecordsOf(venue.db, saleId)).toEqual([
      { kind: "invoice", state: "aceptado" },
      { kind: "cancellation", state: "pendiente" },
    ]);
  });

  it("lets someone holding only sale.void approve it", async () => {
    const party = await printedUnserved("Tarta");

    const answer = await cancelApprovedBy(party.tabId, voider);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await voidsOf(await saleOf(party.tabId))).toEqual([
      { reason: REASON, voidedBy: voider },
    ]);
  });

  it("refuses someone holding only sale.rectify, naming sale.void, writing nothing", async () => {
    const party = await printedUnserved("Tarta");

    const answer = await expectRefused(
      party.tabId,
      () => cancelApprovedBy(party.tabId, rectifier),
      {
        status: 403,
        code: "authorization.not_permitted",
      },
    );
    expect(answer.json.params).toEqual({ permission: "sale.void" });
  });

  it("cancels a bill its party left without paying: the departure's own stops are not served", async () => {
    const party = await departed(venue, "Tarta");
    expect(await statusOf(venue, party.tabId)).toBe("placed");

    const answer = await cancel(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await voidsOf(await saleOf(party.tabId))).toHaveLength(1);
  });

  it("tells the kitchen to stop the dishes it is making", async () => {
    const party = await printedUnserved("Steak");

    expect((await cancel(party.tabId)).status).toBe(200);

    expect(
      venue.db.all(sql`select kind from kitchen_notices where working_order_id = ${party.tabId}`),
    ).toEqual([{ kind: "void" }]);
  });
});

describe("Nothing was served refuses a cancellation", () => {
  it("of a bill with a dish served, naming it", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    expect((await fixture.serve(venue, party, party.tabId, "Tarta")).status).toBe(200);
    await printAnyway(party);
    const [tarta] = await fixture.dishesOf(venue, party.tabId);

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
    expect(answer.json.params).toEqual({
      workingOrderId: party.tabId,
      dishes: [{ lineId: tarta!.id, dishName: "Tarta", quantity: "1.000" }],
    });
  });

  it("of a bill with only an extra served", async () => {
    const party = await printedUnserved({
      name: "Steak",
      extras: [{ listId: extraListId, picks: [{ productId: croquettesId, quantity: 1 }] }],
    });
    const extra = (await fixture.dishesOf(venue, party.tabId)).find(
      (line) => line.parentLineId !== null,
    )!;
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedQuantity: 1000, servedAt: new Date().toISOString() })
        .where(eq(workingOrderLines.id, extra.id)),
    );

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
    expect((answer.json.params as { dishes: { lineId: string }[] }).dishes).toEqual([
      expect.objectContaining({ lineId: extra.id }),
    ]);
  });

  it("of a bill with a dish taken off service and its charge kept", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    const kept = await cancelItemHttp(
      venue.db,
      venue.app,
      venue.supervisorTill,
      party.tabId,
      1,
      undefined,
      {
        outcome: "keep_charge",
        preparationStarted: true,
        reasonId: await inTx(venue, cancelReasonId),
      },
    );
    expect(kept.status, JSON.stringify(kept.json)).toBe(200);
    await printAnyway(party);

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
    expect((answer.json.params as { dishes: { dishName: string }[] }).dishes).toEqual([
      expect.objectContaining({ dishName: "Tarta" }),
    ]);
  });

  it("of a replaced receipt with a dish served, instead of crediting the replacement", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    expect((await fixture.serve(venue, party, party.tabId, "Tarta")).status).toBe(200);
    await printAnyway(party);
    await replacedAfterRefusal(await saleOf(party.tabId));

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
    expect((answer.json.params as { dishes: { dishName: string }[] }).dishes).toEqual([
      expect.objectContaining({ dishName: "Tarta" }),
    ]);
  });

  it("of a bill handed over before it came to the table, naming every dish", async () => {
    const party = await printedUnserved("Tarta", "Steak");
    handOver(party.tabId);

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
    expect(
      (answer.json.params as { dishes: { dishName: string; quantity: string }[] }).dishes,
    ).toEqual([
      expect.objectContaining({ dishName: "Tarta", quantity: "1.000" }),
      expect.objectContaining({ dishName: "Steak", quantity: "1.000" }),
    ]);
  });

  it("of a replaced receipt on a bill handed over, instead of crediting the replacement", async () => {
    const party = await printedUnserved("Tarta");
    await replacedAfterRefusal(await saleOf(party.tabId));
    handOver(party.tabId);

    await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
  });

  it("of a bill handed over before its party left without paying", async () => {
    const party = await seatedWith(venue, "Tarta");
    handOver(party.tabId);
    const departure = await send(
      venue.app,
      venue.supervisorTill,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        billId: party.tabId,
        expectedPartyRevision: fixture.revisionOf(venue, party.partyId),
        reason: "Se marcharon sin pagar",
      },
    );
    expect(departure.status, JSON.stringify(departure.json)).toBe(200);

    await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "bill.served_dishes",
    });
  });

  it("of a receipt a full invoice took the place of, as a replaced invoice is refused", async () => {
    const party = await printedUnserved("Tarta");
    const saleId = await saleOf(party.tabId);
    await inTx(venue, async (tx) =>
      recordSubstitution(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "full")),
        substitutedSaleIds: [saleId],
        counterparty: { taxId: "B12345674", legalName: "Customer SL", countryCode: "ES" },
        total: "5.00",
        lines: [
          {
            lineNo: 1,
            name: "Tarta",
            descriptions: { [venue.cfg.locale]: "Tarta" },
            quantity: "1",
            unitPrice: "4.55",
            vatRate: "10.00",
            lineTotal: "4.55",
          },
        ],
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        clock: venue.clock,
      }),
    );

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 400,
      code: "sale.correction_not_admitted",
    });
    expect(answer.json.params).toEqual({ reason: "replaced" });
    expect(await voidsOf(saleId)).toEqual([]);
  });

  it("of a receipt AEAT refused and that was never replaced, writing no cancellation", async () => {
    const party = await printedUnserved("Tarta");
    const saleId = await saleOf(party.tabId);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    const answer = await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "fiscal.original_refused",
    });
    expect(answer.json.params).toEqual({ saleId });
    expect(await voidsOf(saleId)).toEqual([]);
    expect(await filedRecordsOf(venue.db, saleId)).toEqual([
      { kind: "invoice", state: "rechazado" },
    ]);
  });

  it("on a box waiting for its time", async () => {
    const party = await printedUnserved("Tarta");
    const waiting = venue.appWith({
      backend: gateSeatOnStartClock(venue.backend, () => true),
      clockUnconfirmed: () => true,
    });

    await expectRefused(party.tabId, () => cancel(party.tabId, venue.supervisorTill, waiting), {
      status: 409,
      code: "clock.unconfirmed",
    });
  });

  it("on a box the held chart no longer names primary", async () => {
    const party = await printedUnserved("Tarta");
    await writeNodeMembership(venue.db, {
      body: {
        term: 2,
        nodes: [
          { nodeId: venue.cfg.nodeId, contactUrl: "https://this-box", standing: "sell-only" },
          { nodeId: randomUUID(), contactUrl: "https://new-box", standing: "serving-primary" },
        ],
      },
      signerNodeId: "new-box",
      signature: "sig-2",
      endorsements: [],
    });
    onTestFinished(() => {
      venue.db.run(sql`delete from node_membership`);
    });

    await expectRefused(party.tabId, () => cancel(party.tabId), {
      status: 409,
      code: "fiscal.chain_handed_over",
    });
  });
});

describe("Nothing was served files the corrective, as before, on any other printed bill", () => {
  it("one holding a payment: its approver needs sale.rectify", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    await fixture.payInCash(venue, party.tabId, "5.00");
    await printAnyway(party);

    const answer = await expectRefused(party.tabId, () => cancelApprovedBy(party.tabId, voider), {
      status: 403,
      code: "authorization.not_permitted",
    });
    expect(answer.json.params).toEqual({ permission: "sale.rectify" });
  });

  it("one whose payment was given back in full", async () => {
    const party = await seatedWith(venue, "Tarta");
    const paymentId = await fixture.payInCash(venue, party.tabId, "5.00");
    const givenBack = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(givenBack.status, JSON.stringify(givenBack.json)).toBe(200);
    await printAnyway(party);
    const saleId = await saleOf(party.tabId);

    const answer = await cancel(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await fixture.creditsOf(venue, saleId)).toHaveLength(1);
    expect(await voidsOf(saleId)).toEqual([]);
  });

  it("one whose payment was given back in full and whose receipt another box issued, which AEAT has not answered, credited at once", async () => {
    const party = await seatedWith(venue, "Tarta");
    const paymentId = await fixture.payInCash(venue, party.tabId, "5.00");
    const givenBack = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(givenBack.status, JSON.stringify(givenBack.json)).toBe(200);
    await printAnyway(party);
    const saleId = await saleOf(party.tabId);
    await takeOver(venue);
    const app = venue.appWith({});

    const credited = await cancel(party.tabId, venue.supervisorTill, app);

    expect(credited.status, JSON.stringify(credited.json)).toBe(200);
    expect(await fixture.creditsOf(venue, saleId)).toHaveLength(1);
    expect(await voidsOf(saleId)).toEqual([]);
  });

  it("one whose payment was given back in full and whose receipt AEAT refused, credited at once; Send the replacement then refuses it", async () => {
    const party = await seatedWith(venue, "Tarta");
    const paymentId = await fixture.payInCash(venue, party.tabId, "5.00");
    const givenBack = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(givenBack.status, JSON.stringify(givenBack.json)).toBe(200);
    await printAnyway(party);
    const saleId = await saleOf(party.tabId);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));

    const credited = await cancel(party.tabId);

    expect(credited.status, JSON.stringify(credited.json)).toBe(200);
    expect(await fixture.creditsOf(venue, saleId)).toHaveLength(1);
    expect(await voidsOf(saleId)).toEqual([]);
    await expect(sendReplacement(saleId)).rejects.toMatchObject({
      code: "sale.replacement_not_first",
      params: { saleId },
    });
  });

  it("one replaced after AEAT refused it, crediting the replacement", async () => {
    const party = await printedUnserved("Tarta");
    const saleId = await saleOf(party.tabId);
    const replacementId = await replacedAfterRefusal(saleId);

    const answer = await cancel(party.tabId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await fixture.creditsOf(venue, replacementId)).toHaveLength(1);
    expect(await voidsOf(saleId)).toEqual([]);
  });

  it("one naming a customer, which is refused as today", async () => {
    venue.db.run(sql`update taxpayer set taxpayer_domicile = 'Calle Fiscal 8, Madrid'`);
    onTestFinished(() => {
      venue.db.run(sql`update taxpayer set taxpayer_domicile = null`);
    });
    const party = await seatedWith(venue, "Tarta");
    const [bill] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, party.tabId)),
    );
    const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
      readBillEditState(tx, party.tabId),
    );
    const chosen = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${party.tabId}/invoice-choice`,
      {
        revision: bill!.revision,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Harbour Foods",
          address: "2 Main Street, 28013 Madrid, Madrid",
          countryCode: "ES",
        },
        expectedEdit: { billId: party.tabId, editorVersion, draftId, draftRevision },
      },
    );
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
    await printAnyway(party);

    await expectRefused(party.tabId, () => cancelApprovedBy(party.tabId, rectifier), {
      status: 409,
      code: "sale.correction_unsupported",
    });
  });
});
