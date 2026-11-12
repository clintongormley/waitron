import { testTradingAdmission } from "./testing/trading-admission.js";
import { abandonHeldOrder } from "./testing/order-writer-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  workingOrders,
  workingOrderLines,
  billPayments,
  billPaymentRefunds,
  floorZones,
  sales,
  tenders,
  saleSettlements,
  lineServiceCancellations,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE } from "./modules.js";
import { readFindBills, readFindBill } from "./find-bill-bills.js";
import { parseBillsQuery } from "./find-bill-query.js";
import {
  provisionOrderVenue,
  parked,
  parkedBy,
  placedIssuedBill,
  collect,
  credit,
  departed,
  type OrderVenue,
} from "./testing/order-venue.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { closingEditsForTest, partyRevision } from "./testing/party-close-fixture.js";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";

import { readBillBalance, readPaymentsByBill, outstandingOf } from "./bill-payments.js";
import { readIssuedSales } from "./sale-due.js";
import { assignProductUnit, setProductVariants, units } from "@waitron/catalogue";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { readOrderStateCounts } from "./order-state-counts.js";
import { transferCloseKit } from "./testing/transfer-close-fixture.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
});
const query = (values: Record<string, string> = {}) => parseBillsQuery(new URLSearchParams(values));
const list = (values: Record<string, string> = {}) =>
  inTx(venue, (tx) => readFindBills(tx, query(values)));
async function named(label: string, ...names: string[]) {
  const id = await parked(venue, ...(names.length ? names : ["Caña"]));
  await inTx(venue, (tx) =>
    tx.update(workingOrders).set({ label }).where(eq(workingOrders.id, id)),
  );
  return id;
}
async function contribute(id: string, amount: string, tip = "0.00") {
  const result = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: (Number(amount) + Number(tip)).toFixed(2),
    applied: amount,
    addedTip: tip,
    tip,
  });
  expect(result.status, JSON.stringify(result.json)).toBe(200);
  return (result.json as { payment: { id: string } }).payment.id;
}

describe("Find Bills SQL paging", () => {
  it("counts whole portions and ignores extras and cancelled portions", async () => {
    const id = await named("Counted dishes", "Caña", "Tarta");
    let parentId!: string;
    await inTx(venue, async (tx) => {
      const lines = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      parentId = lines[0]!.id;
      await tx
        .update(workingOrderLines)
        .set({ quantity: 3000 })
        .where(eq(workingOrderLines.id, lines[0]!.id));
      await tx
        .update(workingOrderLines)
        .set({ parentLineId: lines[0]!.id })
        .where(eq(workingOrderLines.id, lines[1]!.id));
    });
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({ itemCount: 3 });
    await inTx(venue, (tx) =>
      tx.insert(lineServiceCancellations).values({
        lineId: parentId,
        quantity: 1000,
        cancelledAt: new Date().toISOString(),
        wasStarted: false,
        actorId: venue.operatorId,
      }),
    );
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({ itemCount: 2 });
    await inTx(venue, (tx) =>
      tx
        .update(lineServiceCancellations)
        .set({ quantity: 3000 })
        .where(eq(lineServiceCancellations.lineId, parentId)),
    );
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({ itemCount: 0 });
  });

  it.each([
    ["g", false, 0, 0, 150000, 0, 1],
    [null, true, 0, 0, 330000, 0, 1],
    [null, false, 3, 0, 3000, 0, 3],
    [null, false, 0, 3, 3000, 0, 1],
    [null, false, 3, null, 3000, 0, 1],
    [null, false, 0, null, 2500, 0, 1],
    ["g", false, 0, 0, 150000, 150000, 0],
  ] as const)(
    "counts inherited %s/measure %s, current %s/frozen %s, quantity %s/cancelled %s as %s",
    async (hardwareUnit, measure, precision, frozen, quantity, cancelled, want) => {
      const id = await named("Weighed dish", "Caña");
      await inTx(venue, async (tx) => {
        const [line] = await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id));
        const [gram] = await tx
          .insert(units)
          .values({
            staffName: "Gram",
            staffAbbreviation: "g",
            name: { en: "Gram" },
            abbreviation: { en: "g" },
            precision,
            hardwareUnit,
            measure,
          })
          .returning({ id: units.id });
        await assignProductUnit(tx, line!.productId!, gram!.id);
        const [variant] = await setProductVariants(
          tx,
          line!.productId!,
          [
            {
              name: "Large",
              customerName: null,
              kitchenName: null,
              image: null,
              unitPrice: "3.00",
              available: true,
            },
          ],
          "en",
        );
        await tx
          .update(workingOrderLines)
          .set({ productId: variant!.id, quantity, unitPrecision: frozen })
          .where(eq(workingOrderLines.id, line!.id));
        if (cancelled > 0)
          await tx.insert(lineServiceCancellations).values({
            lineId: line!.id,
            quantity: cancelled,
            cancelledAt: new Date().toISOString(),
            wasStarted: false,
            actorId: venue.operatorId,
          });
      });
      expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({ itemCount: want });
    },
  );

  it("sorts by item count before paging in both directions across fifty rows", async () => {
    const ids: string[] = [];
    for (let n = 1; n <= 51; n++) {
      const id = await named(`Count ${n}`);
      ids.push(id);
      await inTx(venue, (tx) =>
        tx
          .update(workingOrderLines)
          .set({ quantity: n * 1000 })
          .where(eq(workingOrderLines.workingOrderId, id)),
      );
    }
    for (const direction of ["ascending", "descending"]) {
      const expected = direction === "ascending" ? ids : [...ids].reverse();
      for (const page of [0, 1]) {
        const result = await list({ sort: "items", direction, page: String(page) });
        expect(result.total).toBe(51);
        expect(result.rows.map((r) => r.workingOrderId)).toEqual(
          expected.slice(page * 50, (page + 1) * 50),
        );
      }
    }
  });

  it("keeps an open draft outside Find a bill while the current order count includes it", async () => {
    const seated = await seatedWith(venue, "Tarta");
    await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, seated.partyId, venue.operatorId, {
        billId: seated.tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: venue.offerFor("Caña"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "3",
            courseId: null,
            noMerge: false,
          },
        ],
      }),
    );
    expect(await inTx(venue, (tx) => readFindBill(tx, seated.tabId))).toMatchObject({
      itemCount: 1,
    });
    expect(
      (await inTx(venue, (tx) => readOrderStateCounts(tx, [seated.tabId]))).get(seated.tabId),
    ).toMatchObject({ ordered: 4, unsent: 3 });
  });

  it("an issued but unsettled projection retains received bill payments until settlement", async () => {
    const id = await parked(venue, "Croquettes");
    await contribute(id, "4.00");
    const saleId = randomUUID();
    const at = "2026-10-15T12:00:00.000Z";
    await inTx(venue, (tx) =>
      tx.insert(sales).values({
        id: saleId,
        workingOrderId: id,
        source: "device",
        deviceId: venue.deviceId,
        seriesId: venue.seriesId,
        nodeId: venue.cfg.nodeId,
        invoiceNumber: 900001,
        issuedAt: at,
        issuedOffsetMinutes: 120,
        total: 1000,
        vatBreakdown: [],
        locale: venue.cfg.locale,
        invoiceLocales: [venue.cfg.locale],
        fiscalBackend: "verifactu",
        fiscalState: "not_applicable",
        operatorId: venue.operatorId,
      }),
    );
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({
      paid: "4.00",
      stillOwed: "6.00",
      state: "part-paid",
      collectionStatus: null,
    });
    await inTx(venue, async (tx) => {
      await tx.insert(tenders).values({ saleId, method: "cash", amount: 1000, settledAt: at });
      await tx.insert(saleSettlements).values({ saleId, settledAt: at });
    });
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({
      paid: "10.00",
      stillOwed: "0.00",
    });
  });
  it("a settled counter bill counts the applied tender without counting its tip as paid", async () => {
    const id = await parked(venue, "Croquettes");
    await contribute(id, "10.00", "2.00");
    expect(await inTx(venue, (tx) => readFindBill(tx, id))).toMatchObject({
      total: "10.00",
      paid: "10.00",
      stillOwed: "0.00",
      state: "paid-not-handed-over",
    });
  });
  it("pages 101 equal-time orders without loading their whole set into JavaScript", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 101; i++) ids.push(await named("Paginación"));
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ openedAt: "2026-10-01T12:00:00.000Z" })
        .where(inArray(workingOrders.id, ids)),
    );
    const wanted = [...ids].sort().reverse();
    const shown: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await list({ page: String(page) });
      expect(result).toMatchObject({ total: 101, page, pageSize: 50, openCount: 101 });
      expect(result.rows.map((row) => row.workingOrderId)).toEqual(
        wanted.slice(page * 50, page * 50 + 50),
      );
      shown.push(...result.rows.map((row) => row.workingOrderId));
    }
    expect(new Set(shown).size).toBe(101);
    expect(await list({ page: "3", q: "paginacion" })).toMatchObject({
      rows: [],
      total: 101,
      openCount: 101,
      page: 3,
    });
    await inTx(venue, async (tx) => {
      const execute = vi.spyOn(tx, "execute");
      const session = (
        tx as unknown as {
          session: { prepareQuery: (query: { sql: string; params: unknown[] }) => unknown };
        }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      const page = await readFindBills(tx, query({ page: "1" }));
      expect(page.rows).toHaveLength(50);
      const statements = execute.mock.calls.map(([statement]) =>
        typeof statement === "string"
          ? { sql: statement, params: [] }
          : new SQLiteSyncDialect().sqlToQuery(statement.getSQL()),
      );
      const bounded = statements.filter((s) => /limit \? offset \?/i.test(s.sql));
      expect(bounded).toHaveLength(1);
      expect(bounded[0]!.params.slice(-2)).toEqual([50, 50]);
      expect(statements.some((s) => /count\(\*\)/i.test(s.sql))).toBe(true);
      const hydration = prepared.mock.calls
        .map(([query]) => query)
        .filter(
          (query) =>
            query.sql.startsWith("select distinct") &&
            query.sql.includes('from "working_order_lines"'),
        );
      expect(hydration).toHaveLength(1);
      expect(hydration[0]!.params).toEqual(page.rows.map((row) => row.workingOrderId));
      prepared.mockRestore();
      execute.mockRestore();
    });
  });
  it("reports empty filtered totals without hiding the accessible open count", async () => {
    await named("Visible");
    expect(await list({ q: "missing" })).toMatchObject({ rows: [], total: 0, openCount: 1 });
    expect(await list({ state: "part-paid" })).toMatchObject({ rows: [], total: 0, openCount: 1 });
  });
  it("includes open and placed bills and paid counter orders awaiting handover", async () => {
    const held = await parked(venue, "Caña");
    const party = await seatedWith(venue, "Tarta");
    const placed = await parked(venue, "Octopus");
    await placeOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      placed,
      venue.operatorId,
    );
    const issued = await placedIssuedBill(venue, "Croquettes");
    expect((await collect(venue, issued, "10.00")).status).toBe(200);
    const abandoned = await parked(venue, "Caña");
    await abandonHeldOrder({ db: venue.db }, venue.cfg, abandoned);
    const rows = (await list()).rows;
    expect(new Set(rows.map((r) => r.workingOrderId))).toEqual(
      new Set([held, party.tabId, placed, issued]),
    );
    expect(rows.find((r) => r.workingOrderId === held)?.state).toBe("held");
    expect(rows.find((r) => r.workingOrderId === party.tabId)?.state).toBe("unpaid");
    expect(rows.find((r) => r.workingOrderId === placed)?.state).toBe("unpaid");
    expect(rows.find((r) => r.workingOrderId === issued)).toMatchObject({
      state: "paid-not-handed-over",
      total: "10.00",
      paid: "10.00",
      stillOwed: "0.00",
      collectionStatus: null,
    });
    const handover = await send(venue.app, venue.cookie, "POST", `/api/orders/${issued}/collect`, {
      submissionId: randomUUID(),
    });
    expect(handover.status).toBe(200);
    expect((await list()).rows.some((r) => r.workingOrderId === issued)).toBe(false);
    await expect(inTx(venue, (tx) => readFindBill(tx, issued))).rejects.toMatchObject({
      code: "working_order.not_found",
    });
  });
  it("leaves out a counter bill closed by transfer while its kitchen ticket waits, never as paid", async () => {
    const kit = transferCloseKit(venue, venue.counterZone);
    const byTransfer = await placedIssuedBill(venue, "Tarta");
    await kit.close(await kit.requestFor(byTransfer, "18.00", null));
    const paid = await placedIssuedBill(venue, "Croquettes");
    expect((await collect(venue, paid, "10.00")).status).toBe(200);
    expect(
      venue.db.all(sql`select id from ticket_items where working_order_id = ${byTransfer}`),
    ).not.toEqual([]);

    const found = await list();
    expect(found.rows.map((r) => r.workingOrderId)).toEqual([paid]);
    expect(found.openCount).toBe(1);
  });
  it("derives net applied payments, tips and completed refunds from the same balance facts", async () => {
    const id = (await seatedWith(venue, "Tarta")).tabId;
    const paymentId = await contribute(id, "10.00", "2.00");
    expect((await list()).rows[0]).toMatchObject({
      total: "18.00",
      paid: "10.00",
      stillOwed: "8.00",
      state: "part-paid",
    });
    const result = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "4.00",
        tipAmount: "0.00",
        reason: "Returned",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    const row = (await list()).rows[0]!;
    expect(row).toMatchObject({ paid: "6.00", stillOwed: "12.00", state: "part-paid" });
    await inTx(venue, async (tx) => {
      const balance = await readBillBalance(tx, id);
      const payments = await readPaymentsByBill(tx, [id]);
      expect(row.paid).toBe(balance.received);
      expect(row.stillOwed).toBe(outstandingOf(balance.total, payments.received.get(id)));
    });
  });
  it("finds a selected bill’s debt while its table stays open for another bill", async () => {
    const first = await seatedWith(venue, "Caña");
    const second = await seatedWith(venue, "Tarta");
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: second.partyId,
        into: first.partyId,
        tables: "join",
        operatorId: venue.operatorId,
      }),
    );
    const response = await send(
      venue.app,
      venue.supervisorTill,
      "POST",
      `/api/parties/${first.partyId}/unpaid-departure`,
      {
        billId: first.tabId,
        expectedPartyRevision: await partyRevision(store.db, first.partyId),
        expectedEdits: await closingEditsForTest(store.db, first.partyId),
        reason: "Guest left",
      },
    );
    expect(response).toMatchObject({ status: 200, json: { state: "open" } });
    const debt = await inTx(venue, (tx) => readFindBill(tx, first.tabId));
    expect(debt).toMatchObject({
      stillOwed: "3.00",
      state: "unpaid",
      orderStatus: "placed",
      collectionStatus: "left_without_paying",
    });
    expect(debt.departedAt).not.toBeNull();
    expect((await list()).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workingOrderId: first.tabId, stillOwed: "3.00" }),
      ]),
    );
  });

  it("reads issued debt and fresh selection independently of filters", async () => {
    const id = await placedIssuedBill(venue, "Caña");
    const row = await inTx(venue, (tx) => readFindBill(tx, id));
    expect(row).toMatchObject({
      total: "3.00",
      paid: "0.00",
      stillOwed: "3.00",
      state: "unpaid",
      orderStatus: "placed",
      collectionStatus: "waiting_for_payment",
    });
    expect(row.invoiceNumber).toMatch(/^A\//);
    await inTx(venue, async (tx) =>
      expect(row.stillOwed).toBe((await readIssuedSales(tx, [id])).get(id)?.amountDue),
    );
    await expect(inTx(venue, (tx) => readFindBill(tx, randomUUID()))).rejects.toMatchObject({
      code: "working_order.not_found",
    });
  });
  it("filters zone, any credited staff and state before counts, with no-zone allowed controls", async () => {
    const own = await parked(venue, "Caña", "Tarta");
    const other = await parkedBy(venue, venue.supervisorId, "Octopus");
    await parkedBy(venue, venue.operatorId, "Caña");
    const placed = await parkedBy(venue, venue.supervisorId, "Caña");
    await placeOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      placed,
      venue.supervisorId,
    );
    const party = await seatedWith(venue, "Caña");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ creditedTo: venue.supervisorId })
        .where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const unzoned = await inTx(venue, async (tx) => {
      const row = await seedWorkingOrder(tx, {
        source: "operator_script",
        nodeId: venue.cfg.nodeId,
        orderNumber: 999,
        label: "No context",
      });
      return row!.id;
    });
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, own)),
    );
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ creditedTo: venue.supervisorId })
        .where(eq(workingOrderLines.id, line!.id)),
    );
    expect(
      (await list({ zoneId: venue.counterZone, staffId: venue.supervisorId, state: "held" })).rows
        .map((r) => r.workingOrderId)
        .sort(),
    ).toEqual([own, other].sort());
    await inTx(venue, async (tx) => {
      const scope = (orderId: ReturnType<typeof sql>) => VENUE_SERVICE.orderInZones(orderId, []);
      expect(await readFindBills(tx, query(), scope)).toMatchObject({
        total: 1,
        openCount: 1,
        rows: [{ workingOrderId: unzoned, zoneId: null }],
      });
      await expect(readFindBill(tx, own, scope)).rejects.toMatchObject({
        code: "working_order.not_found",
      });
      expect((await readFindBill(tx, unzoned, scope)).workingOrderId).toBe(unzoned);
    });
  });
  it("retains missing-person credit, table names and exact row facts", async () => {
    const party = await seatedWith(venue, "Tarta", "Caña");
    const missing = randomUUID();
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ label: "Birthday", openedAt: "2026-10-01T02:00:00.000Z" })
        .where(eq(workingOrders.id, party.tabId));
      const [line] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, party.tabId));
      await tx
        .update(workingOrderLines)
        .set({ creditedTo: missing })
        .where(eq(workingOrderLines.id, line!.id));
    });
    const row = await inTx(venue, (tx) => readFindBill(tx, party.tabId));
    expect(row).toMatchObject({
      workingOrderId: party.tabId,
      partyId: party.partyId,
      label: "Birthday",
      itemCount: 2,
      total: "21.00",
      paid: "0.00",
      stillOwed: "21.00",
      earlierDay: true,
      orderStatus: "open",
      state: "unpaid",
      zoneId: venue.zoneId,
    });
    expect(row.zoneName).toBeTruthy();
    expect(row.tables).toHaveLength(1);
    expect(row.staff).toContainEqual({ id: missing, name: null });
    expect(row.staff).toContainEqual({ id: venue.operatorId, name: "Anna" });
    expect((await list({ staffId: missing })).total).toBe(1);
    expect((await list({ q: row.tables[0]! })).rows.map((r) => r.workingOrderId)).toContain(
      party.tabId,
    );
  });
  it("ranks accent-insensitive words, preserves trailing boundaries and never interpolates search SQL", async () => {
    const exact = await named("Café");
    const prefix = await named("Cafeteria");
    const inside = await named("Descafeinado");
    expect((await list({ q: "cafe" })).rows.map((r) => r.workingOrderId)).toEqual([
      exact,
      prefix,
      inside,
    ]);
    expect((await list({ q: "CAFÉ " })).rows.map((r) => r.workingOrderId)).toEqual([exact]);
    expect(await list({ q: "!!!" })).toMatchObject({ rows: [], total: 0, openCount: 3 });
    expect(await list({ q: "' OR 1=1 --" })).toMatchObject({ rows: [], total: 0 });
    const row = await inTx(venue, (tx) => readFindBill(tx, exact));
    expect(
      (await list({ q: String(row.orderNumber) })).rows.map((r) => r.workingOrderId),
    ).toContain(exact);
  });
  it("sorts money numerically both ways and leaves missing labels last", async () => {
    const two = await named("Alpha", "Caña");
    const ten = await named("Beta", "Croquettes");
    const empty = await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ lineTotal: 200 })
        .where(eq(workingOrderLines.workingOrderId, two));
      const row = await seedWorkingOrder(tx, {
        source: "operator_script",
        nodeId: venue.cfg.nodeId,
        orderNumber: 999,
      });
      return row!.id;
    });
    expect(
      (await list({ sort: "total", direction: "ascending" })).rows.map((r) => r.workingOrderId),
    ).toEqual([empty, two, ten]);
    expect(
      (await list({ sort: "total", direction: "descending" })).rows.map((r) => r.workingOrderId),
    ).toEqual([ten, two, empty]);
    expect(
      (await list({ sort: "tableName", direction: "ascending" })).rows.map((r) => r.workingOrderId),
    ).toEqual([two, ten, empty]);
    expect(
      (await list({ sort: "tableName", direction: "descending" })).rows.map(
        (r) => r.workingOrderId,
      ),
    ).toEqual([ten, two, empty]);
  });
  it("ignores pending, failed and declined payments and pending refunds in the received total", async () => {
    const id = await parked(venue, "Tarta");
    await inTx(venue, async (tx) => {
      const inserted = await tx
        .insert(billPayments)
        .values(
          [
            {
              state: "received" as const,
              receivedAt: new Date().toISOString(),
              applied: 1000,
              tip: 200,
              tendered: 1200,
            },
            { state: "pending" as const, applied: 300, tip: 0, tendered: 300 },
            {
              state: "failed" as const,
              failedAt: new Date().toISOString(),
              applied: 400,
              tip: 0,
              tendered: 400,
            },
            {
              state: "declined" as const,
              receivedAt: new Date().toISOString(),
              applied: 500,
              tip: 0,
              tendered: 500,
            },
          ].map((row) => ({
            ...row,
            workingOrderId: id,
            submissionId: randomUUID(),
            fingerprint: "f",
            kind: "contribution" as const,
            method: "cash" as const,
            requestedBy: venue.operatorId,
            ...venue.cfg.origin,
          })),
        )
        .returning({ id: billPayments.id });
      await tx.insert(billPaymentRefunds).values({
        billPaymentId: inserted[0]!.id,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 400,
        tipAmount: 0,
        reason: "Awaiting outcome",
        authorizedBy: venue.adminId,
        requestedBy: venue.operatorId,
        ...venue.cfg.origin,
        state: "pending",
      });
    });
    const row = await inTx(venue, (tx) => readFindBill(tx, id));
    expect(row).toMatchObject({
      total: "18.00",
      paid: "10.00",
      stillOwed: "8.00",
      state: "part-paid",
    });
    await inTx(venue, async (tx) => {
      expect((await readPaymentsByBill(tx, [id])).received.get(id)).toBe(row.paid);
      expect((await readBillBalance(tx, id)).reserved).toBe("3.00");
    });
  });
  it("counts settled linked tenders once and leaves finished table bills out", async () => {
    const counter = await parked(venue, "Croquettes");
    await contribute(counter, "4.00");
    await contribute(counter, "6.00");
    expect((await list()).rows).toEqual([
      expect.objectContaining({
        workingOrderId: counter,
        state: "paid-not-handed-over",
        total: "10.00",
        paid: "10.00",
        stillOwed: "0.00",
      }),
    ]);
    const party = await seatedWith(venue, "Tarta");
    await contribute(party.tabId, "18.00");
    expect((await list()).rows.map((row) => row.workingOrderId)).toEqual([counter]);
    await expect(inTx(venue, (tx) => readFindBill(tx, party.tabId))).rejects.toMatchObject({
      code: "working_order.not_found",
    });
  });
  it("sorts each semantic column in both directions with stable ties", async () => {
    const first = await parkedBy(venue, venue.supervisorId, "Caña");
    const second = await parkedBy(venue, venue.operatorId, "Tarta", "Caña");
    const third = await placedIssuedBill(venue, "Croquettes");
    await contribute(second, "1.00");
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ label: "Zulu", openedAt: "2026-10-12T12:00:00.000Z" })
        .where(eq(workingOrders.id, first));
      await tx
        .update(workingOrders)
        .set({ label: "Alpha", openedAt: "2026-10-13T12:00:00.000Z" })
        .where(eq(workingOrders.id, second));
      // A placed order's label and opened time cannot be rewritten. Its real opening is newest.
      await tx
        .update(floorZones)
        .set({ name: "Alpha zone" })
        .where(eq(floorZones.id, venue.counterZone));
    });
    const idDesc = [first, third].sort().reverse();
    const orders: Record<string, string[]> = {
      openedAt: [first, second, third],
      tableName: [second, first, third],
      staff: [...[second, third].sort().reverse(), first],
      items: [...idDesc, second],
      total: [first, third, second],
      paid: [...idDesc, second],
      state: [first, second, third],
      zone: [...[first, second, third].sort().reverse()],
    };
    for (const [sort, ascending] of Object.entries(orders)) {
      expect(
        (await list({ sort, direction: "ascending" })).rows.map((row) => row.workingOrderId),
        sort,
      ).toEqual(ascending);
      // Null table/name remains last; ties always keep the deterministic id direction.
      const descending =
        sort === "tableName"
          ? [first, second, third]
          : sort === "items" || sort === "paid"
            ? [second, ...idDesc]
            : sort === "staff"
              ? [first, ...[second, third].sort().reverse()]
              : sort === "zone"
                ? ascending
                : [...ascending].reverse();
      expect(
        (await list({ sort, direction: "descending" })).rows.map((row) => row.workingOrderId),
        sort,
      ).toEqual(descending);
    }
  });
  it("sorts and filters distinct recorded zones while keeping no-zone rows last", async () => {
    const counter = await parked(venue, "Caña");
    const party = await seatedWith(venue, "Tarta");
    const noZone = await inTx(venue, (tx) =>
      seedWorkingOrder(tx, {
        source: "operator_script",
        nodeId: venue.cfg.nodeId,
        orderNumber: 999,
      }),
    );
    await inTx(venue, async (tx) => {
      await tx.update(floorZones).set({ name: "Alpha" }).where(eq(floorZones.id, venue.zoneId));
      await tx.update(floorZones).set({ name: "Zulu" }).where(eq(floorZones.id, venue.counterZone));
    });
    expect(
      (await list({ sort: "zone", direction: "ascending" })).rows.map((row) => row.workingOrderId),
    ).toEqual([party.tabId, counter, noZone!.id]);
    expect(
      (await list({ sort: "zone", direction: "descending" })).rows.map((row) => row.workingOrderId),
    ).toEqual([counter, party.tabId, noZone!.id]);
    expect(await list({ zoneId: venue.zoneId })).toMatchObject({
      total: 1,
      openCount: 3,
      rows: [{ workingOrderId: party.tabId }],
    });
  });
  it("keeps original issued totals but reads corrected debt and departed receipt identity", async () => {
    const id = await placedIssuedBill(venue, "Caña");
    await credit(venue, id, "1.00", "-1.21");
    const row = await inTx(venue, (tx) => readFindBill(tx, id));
    expect(row).toMatchObject({
      total: "3.00",
      paid: "0.00",
      stillOwed: "1.79",
      collectionStatus: "waiting_for_payment",
    });
    expect((await list({ q: row.invoiceNumber! })).rows.map((r) => r.workingOrderId)).toEqual([id]);
    const party = await departed(venue, "Tarta");
    const debt = await inTx(venue, (tx) => readFindBill(tx, party.tabId));
    expect(debt).toMatchObject({
      partyId: party.partyId,
      collectionStatus: "left_without_paying",
      total: "18.00",
      stillOwed: "18.00",
    });
    expect(debt.departedAt).not.toBeNull();
    expect(debt.tables).toHaveLength(1);
    expect((await list({ q: debt.tables[0]! })).rows.map((r) => r.workingOrderId)).toEqual([
      party.tabId,
    ]);
  });
  it("marks earlier days at the venue business boundary rather than midnight", async () => {
    const id = await parked(venue, "Caña");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ openedAt: "2026-10-14T03:00:00.000Z" })
        .where(eq(workingOrders.id, id)),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-15T02:59:59.999Z"));
      expect((await inTx(venue, (tx) => readFindBill(tx, id))).earlierDay).toBe(false);
      vi.setSystemTime(new Date("2026-10-15T03:00:00.000Z"));
      expect((await inTx(venue, (tx) => readFindBill(tx, id))).earlierDay).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers collection only while the legacy collector can take a positive debt", async () => {
    const cleared = await placedIssuedBill(venue, "Caña");
    await credit(venue, cleared, "2.48", "-3.00");
    expect(await inTx(venue, (tx) => readFindBill(tx, cleared))).toMatchObject({
      stillOwed: "0.00",
      collectionStatus: null,
    });
    const pending = await placedIssuedBill(venue, "Tarta");
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: pending,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "cash",
        applied: 100,
        tip: 0,
        tendered: 100,
        state: "pending",
        requestedBy: venue.operatorId,
        ...venue.cfg.origin,
      }),
    );
    expect(await inTx(venue, (tx) => readFindBill(tx, pending))).toMatchObject({
      stillOwed: "18.00",
      collectionStatus: null,
    });
  });
});
