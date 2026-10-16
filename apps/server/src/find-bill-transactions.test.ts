import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  billPayments,
  invoiceSeries,
  locations,
  nodes,
  sales,
  saleSettlements,
  saleSubstitutions,
  tenders,
  tenderRefunds,
  workingOrders,
  parties,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { locationId } from "@waitron/shared";
import { readFindBills } from "./find-bill-bills.js";
import { parseBillsQuery, parseTransactionsQuery } from "./find-bill-query.js";
import { readFindTransactions, resolveTransactionScope } from "./find-bill-transactions.js";
import { VENUE_SERVICE } from "./modules.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import {
  collect,
  credit,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
let number: number;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
  number = 900000;
});
const query = (values: Record<string, string> = {}) =>
  parseTransactionsQuery(new URLSearchParams({ preset: "any", ...values }));
const list = (values: Record<string, string> = {}) =>
  inTx(venue, (tx) => readFindTransactions(tx, venue.cfg, query(values)));
const AT = "2026-10-15T12:00:00.000Z";

async function invoice(values: Partial<typeof sales.$inferInsert> = {}, settled = true) {
  const id = randomUUID();
  await inTx(venue, async (tx) => {
    await tx.insert(sales).values({
      id,
      source: "device",
      deviceId: venue.deviceId,
      seriesId: venue.seriesId,
      nodeId: venue.cfg.nodeId,
      invoiceNumber: ++number,
      issuedAt: AT,
      issuedOffsetMinutes: 120,
      total: 1210,
      vatBreakdown: [],
      locale: venue.cfg.locale,
      invoiceLocales: [venue.cfg.locale],
      fiscalBackend: "verifactu",
      fiscalState: "not_applicable",
      operatorId: venue.operatorId,
      ...values,
    });
    if (settled && values.correctsSaleId == null) {
      if ((values.total ?? 1210) > 0)
        await tx
          .insert(tenders)
          .values({ saleId: id, method: "cash", amount: values.total ?? 1210, settledAt: AT });
      await tx.insert(saleSettlements).values({ saleId: id, settledAt: AT });
    }
  });
  return id;
}
async function settle(id: string) {
  await inTx(venue, (tx) => tx.insert(saleSettlements).values({ saleId: id, settledAt: AT }));
}
async function tender(
  id: string,
  method: "cash" | "card" | "voucher" | "transfer" | "other",
  values: Partial<typeof tenders.$inferInsert> = {},
) {
  await inTx(venue, (tx) =>
    tx.insert(tenders).values({ saleId: id, method, amount: 1210, settledAt: AT, ...values }),
  );
}
async function attempt(
  orderId: string,
  saleId: string | null,
  cardLast4: string | null,
  values: Partial<typeof payments.$inferInsert> = {},
) {
  await inTx(venue, (tx) =>
    tx.insert(payments).values({
      workingOrderId: orderId,
      saleId,
      source: "device",
      deviceId: venue.deviceId,
      provider: "fake",
      paymentRef: randomUUID(),
      amount: 1210,
      state: "captured",
      cardLast4,
      ...values,
    }),
  );
}
async function saleOf(orderId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, orderId)),
  );
  return row!.id;
}

describe("Find Transactions SQL paging", () => {
  it("shows one method per captured last-four even when tenders and attempts repeat it", async () => {
    const order = await parked(venue, "Tarta");
    const id = await invoice({ workingOrderId: order }, false);
    await tender(id, "card", { amount: 600 });
    await tender(id, "card", { amount: 610 });
    await settle(id);
    await attempt(order, id, "0091");
    await attempt(order, id, "0091");
    expect(await list({ q: "0091" })).toMatchObject({
      total: 1,
      rows: [{ saleId: id, amount: "12.10", methods: [{ method: "card", last4: "0091" }] }],
    });
  });
  it("includes paid sales, unpaid full invoices and signed corrections but excludes voids and attempts", async () => {
    const paidOrder = await placedIssuedBill(venue, "Caña");
    expect((await collect(venue, paidOrder, "3.00")).status).toBe(200);
    const paid = await saleOf(paidOrder);
    await credit(venue, paidOrder, "1.00", "-1.21");
    const unpaidOrder = await parked(venue, "Tarta");
    const full = await invoice(
      {
        workingOrderId: unpaidOrder,
        counterpartyTaxId: "B12345674",
        counterpartyLegalName: "Cliente SL",
      },
      false,
    );
    const unfiled = await parked(venue, "Pulpo");
    await attempt(unfiled, null, "9999", { state: "attempting" });
    await attempt(unfiled, null, "9998", { state: "failed" });
    const voidedOrder = await placedIssuedBill(venue, "Croquetas");
    await voidInvoice(venue, voidedOrder);
    const unsettledF2 = await invoice({}, false);
    const rows = (await list()).rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.saleId === paid)).toMatchObject({
      transactionId: `sale:${paid}`,
      type: "sale",
      amount: "3.00",
    });
    expect(rows.find((r) => r.saleId === full)).toMatchObject({
      type: "full-invoice",
      methods: [],
      amount: "12.10",
    });
    expect(rows.find((r) => r.type === "correction")).toMatchObject({
      amount: "-1.21",
      workingOrderId: null,
      scopeOrderIds: [paidOrder],
    });
    expect(rows.some((r) => r.saleId === unsettledF2)).toBe(false);
    const bills = await inTx(venue, (tx) =>
      readFindBills(tx, venue.cfg, parseBillsQuery(new URLSearchParams())),
    );
    expect(bills.rows.some((r) => r.workingOrderId === unpaidOrder)).toBe(true);
  });

  it("pages 101 invoices with stable ties and exact counts despite repeated tenders and attempts", async () => {
    const order = await parked(venue, "Caña");
    const ids: string[] = [];
    for (let i = 0; i < 101; i++)
      ids.push(await invoice(i === 0 ? { workingOrderId: order } : {}, i !== 0));
    await tender(ids[0]!, "cash", { amount: 400, tipAmount: 100 });
    await tender(ids[0]!, "card", { amount: 500 });
    await tender(ids[0]!, "voucher", { amount: 410 });
    await settle(ids[0]!);
    await attempt(order, ids[0]!, "0091");
    await attempt(order, ids[0]!, "7777", { state: "failed" });
    const wanted = [...ids].sort().reverse();
    for (let page = 0; page < 3; page++) {
      const result = await list({ page: String(page) });
      expect(result).toMatchObject({ total: 101, page, pageSize: 50, openCount: 1, dates: null });
      expect(result.rows.map((r) => r.saleId)).toEqual(wanted.slice(page * 50, page * 50 + 50));
      expect(result.rows.every((r) => r.amount === "12.10")).toBe(true);
    }
    expect(await list({ page: "3" })).toMatchObject({ rows: [], total: 101, openCount: 1 });
    expect(await list({ q: "nobody" })).toMatchObject({ rows: [], total: 0, openCount: 1 });
    await inTx(venue, async (tx) => {
      const execute = vi.spyOn(tx, "execute");
      const result = await readFindTransactions(tx, venue.cfg, query({ page: "1" }));
      expect(result.rows).toHaveLength(50);
      const statements = execute.mock.calls.map(([s]) =>
        typeof s === "string"
          ? { sql: s, params: [] }
          : new SQLiteSyncDialect().sqlToQuery(s.getSQL()),
      );
      const bounded = statements.filter((s) => /limit \? offset \?/i.test(s.sql));
      expect(bounded).toHaveLength(1);
      expect(bounded[0]!.params.slice(-2)).toEqual([50, 50]);
      expect(statements.every((s) => /count\(\*\)|limit \? offset \?/i.test(s.sql))).toBe(true);
      execute.mockRestore();
    });
  });

  it("keeps every split card by bill-payment identity and ignores failed or unrelated attempts", async () => {
    const order = await parked(venue, "Caña");
    const sale = await invoice({ workingOrderId: order }, false);
    for (const last4 of ["3210", "0091"]) {
      const bp = randomUUID();
      await inTx(venue, (tx) =>
        tx.insert(billPayments).values({
          id: bp,
          workingOrderId: order,
          submissionId: randomUUID(),
          kind: "contribution",
          method: "card",
          tendered: null,
          applied: 400,
          tip: 0,
          fingerprint: "split-card",
          requestedBy: venue.operatorId,
          source: "device",
          deviceId: venue.deviceId,
          state: "received",
          createdAt: AT,
          receivedAt: AT,
        }),
      );
      await tender(sale, "card", { amount: 400, billPaymentId: bp });
      await attempt(order, null, last4, { billPaymentId: bp });
    }
    await tender(sale, "card", { amount: 410 });
    await settle(sale);
    await attempt(order, sale, "5555", { state: "failed" });
    // A whole-order card attempt is not metadata for the split tenders.
    await attempt(order, sale, "8888", { state: "attempting" });
    const expected = [
      { method: "card", last4: null },
      { method: "card", last4: "0091" },
      { method: "card", last4: "3210" },
    ];
    expect((await list()).rows).toHaveLength(1);
    expect((await list()).rows[0]!.methods).toEqual(expected);
    for (const q of ["0091", "3210"])
      expect((await list({ q })).rows.map((r) => r.saleId)).toEqual([sale]);
    for (const q of ["5555", "8888"]) expect((await list({ q })).total).toBe(0);
    const whole = await parked(venue, "Tarta");
    const wholeSale = await invoice({ workingOrderId: whole }, false);
    await tender(wholeSale, "card");
    await settle(wholeSale);
    await attempt(whole, wholeSale, "4321", { state: "settled" });
    expect((await list({ q: "4321" })).rows[0]!.methods).toEqual([
      { method: "card", last4: "4321" },
    ]);
  });

  it("filters dates, any tender, type and issuing staff before counts and paging", async () => {
    const id = await invoice(
      { counterpartyTaxId: "B12345674", operatorId: venue.supervisorId },
      false,
    );
    await tender(id, "cash", { amount: 600 });
    await tender(id, "card", { amount: 610 });
    await invoice({
      counterpartyTaxId: "B12345674",
      issuedAt: "2026-10-14T21:59:59.999Z",
      operatorId: venue.supervisorId,
    });
    await invoice({
      counterpartyTaxId: "B12345674",
      issuedAt: "2026-10-15T22:00:00.000Z",
      operatorId: venue.supervisorId,
    });
    const wrongType = await invoice({ operatorId: venue.supervisorId }, false);
    await tender(wrongType, "card");
    await settle(wrongType);
    const wrongStaff = await invoice({ counterpartyTaxId: "B12345674" }, false);
    await tender(wrongStaff, "card");
    const values = {
      preset: "custom",
      from: "2026-10-15",
      to: "2026-10-15",
      method: "card",
      type: "full-invoice",
      staffId: venue.supervisorId,
    };
    const result = await list(values);
    expect(result).toMatchObject({
      total: 1,
      dates: {
        from: "2026-10-15",
        to: "2026-10-15",
        startAt: "2026-10-14T22:00:00.000Z",
        endAt: "2026-10-15T22:00:00.000Z",
      },
    });
    expect(result.rows.map((r) => r.saleId)).toEqual([id]);
    expect((await list({ ...values, method: "cash" })).rows.map((r) => r.saleId)).toEqual([id]);
  });

  it("searches formatted invoices, customers and retained order/party/table names with shared word ranking", async () => {
    const [series] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code: "T1" })
        .returning({ id: invoiceSeries.id }),
    );
    const order = await parked(venue, "Caña");
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ label: "Álvaro García" }).where(eq(workingOrders.id, order)),
    );
    const id = await invoice({
      workingOrderId: order,
      seriesId: series!.id,
      invoiceNumber: 12,
      counterpartyLegalName: "Cliente Norte",
    });
    const party = await seatedWith(venue, "Tarta");
    const tableSale = await invoice({ workingOrderId: party.tabId });
    const tableNames = await inTx(venue, async (tx) =>
      tx.execute<{ name: string }>(
        sql`select d.label as name from party_tables pt join dining_tables d on d.id=pt.table_id where pt.party_id=${party.partyId}`,
      ),
    );
    for (const q of ["T1/12", "ALVARO gar", "cliente norte", "García "])
      expect((await list({ q })).rows.map((r) => r.saleId)).toEqual([id]);
    expect(tableNames.rows.length).toBeGreaterThan(0);
    expect((await list({ q: tableNames.rows[0]!.name })).rows.map((r) => r.saleId)).toEqual([
      tableSale,
    ]);
    expect((await list({ q: "gar " })).total).toBe(0);
    expect((await list({ q: "' OR 1=1 --" })).total).toBe(0);
    const exact = await invoice({ counterpartyLegalName: "Álvaro", total: 100 });
    expect(
      (await list({ q: "alvaro", sort: "amount", direction: "descending" })).rows.map(
        (r) => r.saleId,
      ),
    ).toEqual([exact, id]);
  });

  it("applies each date, method, type and staff predicate on its own to both rows and totals", async () => {
    const own = await invoice(
      { counterpartyTaxId: "B12345674", operatorId: venue.supervisorId },
      false,
    );
    await tender(own, "card");
    const cash = await invoice({ issuedAt: "2026-10-14T12:00:00.000Z" });
    const before = await invoice({ issuedAt: "2026-10-14T21:59:59.999Z" });
    const start = await invoice({ issuedAt: "2026-10-14T22:00:00.000Z" });
    const end = await invoice({ issuedAt: "2026-10-15T22:00:00.000Z" });
    const correction = await invoice({ correctsSaleId: cash, total: -100 });
    for (const [filter, wanted] of [
      [{ method: "card" }, [own]],
      [{ type: "full-invoice" }, [own]],
      [{ type: "correction" }, [correction]],
      [{ staffId: venue.supervisorId }, [own]],
      [{ preset: "custom", from: "2026-10-15", to: "2026-10-15" }, [own, start, correction]],
    ] as [Record<string, string>, string[]][]) {
      const result = await list(filter);
      expect(result.total).toBe(wanted.length);
      expect(new Set(result.rows.map((r) => r.saleId))).toEqual(new Set(wanted));
      expect(await list({ ...filter, page: "1" })).toMatchObject({
        rows: [],
        total: wanted.length,
      });
    }
    expect(new Set((await list({ method: "cash" })).rows.map((r) => r.saleId))).toEqual(
      new Set([cash, before, start, end]),
    );
  });

  it("keeps the closed party's retained table names after today's table label changes", async () => {
    const party = await seatedWith(venue, "Tarta");
    await inTx(venue, (tx) =>
      tx
        .update(parties)
        .set({ tableNames: ["Retained Terrace 7"], name: "Family Rowan" })
        .where(eq(parties.id, party.partyId)),
    );
    const id = await invoice({ workingOrderId: party.tabId });
    expect((await list({ q: "Retained Terrace 7" })).rows.map((r) => r.saleId)).toEqual([id]);
    expect((await list({ q: "Family Rowan" })).rows[0]).toMatchObject({
      saleId: id,
      tableName: "Family Rowan",
    });
  });

  it("sorts invoice series and numbers numerically, signed amounts, and nullable columns last in either direction", async () => {
    const [series] = await inTx(venue, (tx) =>
      tx
        .insert(invoiceSeries)
        .values({ nodeId: venue.cfg.nodeId, code: "T1" })
        .returning({ id: invoiceSeries.id }),
    );
    const orderZ = await parked(venue, "Caña");
    const orderA = await parked(venue, "Tarta");
    await inTx(venue, async (tx) => {
      await tx.update(workingOrders).set({ label: "Zed" }).where(eq(workingOrders.id, orderZ));
      await tx.update(workingOrders).set({ label: "Alpha" }).where(eq(workingOrders.id, orderA));
    });
    const ten = await invoice(
      {
        workingOrderId: orderZ,
        seriesId: series!.id,
        invoiceNumber: 10,
        total: 2000,
        counterpartyLegalName: "Zeta",
        operatorId: venue.supervisorId,
      },
      false,
    );
    const two = await invoice(
      {
        workingOrderId: orderA,
        seriesId: series!.id,
        invoiceNumber: 2,
        total: 100,
        issuedAt: "2026-10-14T12:00:00.000Z",
      },
      false,
    );
    const zero = await invoice({ total: 0, operatorId: null });
    await tender(ten, "card", { amount: 2000 });
    await settle(ten);
    await tender(two, "cash", { amount: 100 });
    await settle(two);
    const correction = await invoice({ correctsSaleId: ten, total: -121 });
    const ids = async (values: Record<string, string>) =>
      (await list(values)).rows.map((r) => r.saleId);
    expect(await ids({ sort: "invoice", direction: "ascending" })).toEqual([
      zero,
      correction,
      two,
      ten,
    ]);
    expect(await ids({ sort: "invoice", direction: "descending" })).toEqual([
      ten,
      two,
      correction,
      zero,
    ]);
    expect(await ids({ sort: "amount", direction: "ascending" })).toEqual([
      correction,
      zero,
      two,
      ten,
    ]);
    expect(await ids({ sort: "when", direction: "ascending" })).toEqual([
      two,
      ...[ten, zero, correction].sort().reverse(),
    ]);
    expect((await list({ sort: "type", direction: "ascending" })).rows[0]!.saleId).toBe(correction);
    for (const direction of ["ascending", "descending"]) {
      const methods = (await list({ sort: "method", direction })).rows;
      expect(methods.slice(0, 2).map((r) => r.saleId)).toEqual(
        direction === "ascending" ? [ten, two] : [two, ten],
      );
      expect(methods.slice(2).every((r) => r.methods.length === 0)).toBe(true);
      expect((await list({ sort: "staff", direction })).rows.at(-1)!.saleId).toBe(zero);
      const labels = (await list({ sort: "tableName", direction })).rows;
      expect(labels.slice(0, 3).map((r) => r.tableName)).toEqual(
        direction === "ascending" ? ["Alpha", "Zed", "Zed"] : ["Zed", "Zed", "Alpha"],
      );
      expect(labels.at(-1)!.saleId).toBe(zero);
    }
  });

  it("uses every original order's zone for corrections and multi-sale substitutions", async () => {
    const counter = await parked(venue, "Caña");
    const party = await seatedWith(venue, "Tarta");
    const own = await invoice({ workingOrderId: counter });
    const other = await invoice({ workingOrderId: party.tabId });
    const correction = await invoice({ correctsSaleId: other, total: -121 });
    const substitute = await invoice({ counterpartyTaxId: "B12345674" });
    await inTx(venue, async (tx) => {
      for (const id of [own, other])
        await tx
          .insert(saleSubstitutions)
          .values({ substitutionSaleId: substitute, substitutedSaleId: id });
    });
    const correctedSubstitute = await invoice({ correctsSaleId: substitute, total: -121 });
    const unzoned = await invoice();
    const condition = (id: ReturnType<typeof sql>) =>
      VENUE_SERVICE.orderInZones(venue.cfg, id, [venue.counterZone]);
    const result = await inTx(venue, (tx) =>
      readFindTransactions(tx, venue.cfg, query(), condition),
    );
    expect(new Set(result.rows.map((r) => r.saleId))).toEqual(new Set([own, unzoned]));
    expect(result.total).toBe(2);
    expect(result.openCount).toBe(1);
    expect((await list()).rows.find((r) => r.saleId === substitute)!.scopeOrderIds).toEqual(
      [counter, party.tabId].sort(),
    );
    expect(await inTx(venue, (tx) => resolveTransactionScope(tx, venue.cfg, correction))).toEqual({
      locationId: venue.cfg.locationId,
      workingOrderIds: [party.tabId],
    });
    expect(
      await inTx(venue, (tx) => resolveTransactionScope(tx, venue.cfg, correctedSubstitute)),
    ).toEqual({ locationId: venue.cfg.locationId, workingOrderIds: [counter, party.tabId].sort() });
    const empty = (id: ReturnType<typeof sql>) => VENUE_SERVICE.orderInZones(venue.cfg, id, []);
    expect(
      (await inTx(venue, (tx) => readFindTransactions(tx, venue.cfg, query(), empty))).rows.map(
        (r) => r.saleId,
      ),
    ).toEqual([unzoned]);
  });

  it("uses issuing-node location for orderless invoices and retains a missing historical operator", async () => {
    const missingPerson = randomUUID();
    const own = await invoice({ operatorId: missingPerson });
    const { elsewhere, node } = await inTx(venue, async (tx) => {
      const [current] = await tx
        .select()
        .from(locations)
        .where(eq(locations.id, venue.cfg.locationId));
      const [loc] = await tx
        .insert(locations)
        .values({ ...current!, id: randomUUID(), name: "Elsewhere" })
        .returning({ id: locations.id });
      const [n] = await tx
        .insert(nodes)
        .values({ name: "Remote", locationId: loc!.id })
        .returning({ id: nodes.id });
      return { elsewhere: loc!.id, node: n!.id };
    });
    const foreign = await invoice({ nodeId: node });
    expect((await list()).rows.map((r) => r.saleId)).toEqual([own]);
    expect((await list()).rows[0]!.staff).toEqual({ id: missingPerson, name: null });
    expect(await inTx(venue, (tx) => resolveTransactionScope(tx, venue.cfg, own))).toEqual({
      locationId: venue.cfg.locationId,
      workingOrderIds: [],
    });
    await expect(
      inTx(venue, (tx) => resolveTransactionScope(tx, venue.cfg, foreign)),
    ).rejects.toMatchObject({ code: "sale.not_found" });
    await expect(
      inTx(venue, (tx) => resolveTransactionScope(tx, venue.cfg, randomUUID())),
    ).rejects.toMatchObject({ code: "sale.not_found" });
    expect(
      (
        await inTx(venue, (tx) =>
          readFindTransactions(tx, { ...venue.cfg, locationId: locationId(elsewhere) }, query()),
        )
      ).rows.map((r) => r.saleId),
    ).toEqual([foreign]);
  });
});

describe("completed post-invoice refund Transactions", () => {
  async function returned(saleId: string, values: Partial<typeof tenderRefunds.$inferInsert> = {}) {
    return inTx(venue, async (tx) => {
      const [tender] = await tx.select().from(tenders).where(eq(tenders.saleId, saleId));
      const [row] = await tx
        .insert(tenderRefunds)
        .values({
          saleId,
          tenderId: tender!.id,
          submissionId: randomUUID(),
          fingerprint: randomUUID(),
          appliedAmount: 200,
          tipAmount: 30,
          reason: "Customer returned",
          authorizedBy: venue.supervisorId,
          requestedBy: venue.supervisorId,
          source: "device",
          deviceId: venue.deviceId,
          nodeId: venue.cfg.nodeId,
          locationId: venue.cfg.locationId,
          method: "cash",
          state: "completed",
          createdAt: AT,
          completedAt: "2026-10-16T09:00:00.000Z",
          ...values,
        })
        .returning();
      return row!;
    });
  }
  it("shows completed money once with its original invoice, completion date and returning staff", async () => {
    const saleId = await invoice({ counterpartyLegalName: "Cliente Norte" });
    const refund = await returned(saleId);
    const result = await list();
    expect(result.total).toBe(2);
    expect(result.rows[0]).toEqual({
      transactionId: `refund:${refund.id}`,
      refundId: refund.id,
      saleId,
      workingOrderId: null,
      scopeOrderIds: [],
      issuedAt: "2026-10-16T09:00:00.000Z",
      invoiceNumber: "A/900001",
      type: "refund",
      tableName: null,
      customerName: "Cliente Norte",
      methods: [{ method: "cash", last4: null }],
      staff: { id: venue.supervisorId, name: "Sofía" },
      amount: "-2.30",
    });
    expect(result.rows[1]).toMatchObject({
      transactionId: `sale:${saleId}`,
      refundId: null,
      amount: "12.10",
      type: "sale",
    });
  });
  it("excludes pending/failed attempts and filters completion dates, refund method, type and requester before counting", async () => {
    const saleId = await invoice();
    const cash = await returned(saleId);
    const card = await returned(saleId, {
      method: "card",
      manual: true,
      appliedAmount: 100,
      tipAmount: 0,
      requestedBy: venue.operatorId,
    });
    await returned(saleId, { state: "pending", completedAt: null });
    await returned(saleId, { state: "failed", completedAt: null, failedAt: AT });
    expect((await list()).total).toBe(3);
    for (const [filter, wanted] of [
      [{ type: "refund" }, [card.id, cash.id]],
      [{ type: "refund", method: "cash" }, [cash.id]],
      [{ type: "refund", method: "card" }, [card.id]],
      [{ staffId: venue.supervisorId }, [cash.id]],
      [{ preset: "custom", from: "2026-10-16", to: "2026-10-16" }, [card.id, cash.id]],
    ] as [Record<string, string>, string[]][]) {
      const result = await list(filter);
      expect(result.total).toBe(wanted.length);
      expect(new Set(result.rows.map((r) => r.refundId))).toEqual(new Set(wanted));
      expect(await list({ ...filter, page: "1" })).toMatchObject({
        rows: [],
        total: wanted.length,
      });
    }
    expect(
      (await list({ preset: "custom", from: "2026-10-15", to: "2026-10-15" })).rows.map(
        (r) => r.transactionId,
      ),
    ).toEqual([`sale:${saleId}`]);
  });
  it("searches only the refunded capture's last four while retaining original sale labels and customer", async () => {
    const order = await parked(venue, "Tarta");
    const saleId = await invoice(
      { workingOrderId: order, counterpartyLegalName: "Refund Customer" },
      false,
    );
    await tender(saleId, "card", { amount: 600 });
    await tender(saleId, "cash", { amount: 610 });
    await settle(saleId);
    await attempt(order, saleId, "3210", { provider: "fake", paymentRef: "capture-returned" });
    await attempt(order, saleId, "0091", { provider: "fake", paymentRef: "other-capture" });
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ label: "Retained table" }).where(eq(workingOrders.id, order)),
    );
    const refund = await returned(saleId, {
      method: "card",
      provider: "fake",
      providerPaymentRef: "capture-returned",
    });
    for (const q of ["3210", "Refund Customer", "Retained table", "A/900001"]) {
      expect((await list({ q, type: "refund" })).rows.map((r) => r.refundId)).toEqual([refund.id]);
    }
    expect((await list({ q: "0091", type: "refund" })).total).toBe(0);
    expect((await list({ type: "refund" })).rows[0]!.methods).toEqual([
      { method: "card", last4: "3210" },
    ]);
    expect((await list({ type: "refund", method: "cash" })).total).toBe(0);
  });
  it("keeps refund original-sale zone and location scope in addition to their distinct refund identity", async () => {
    const allowed = await parked(venue, "Caña");
    const party = await seatedWith(venue, "Tarta");
    const own = await invoice({ workingOrderId: allowed });
    const denied = await invoice({ workingOrderId: party.tabId });
    const a = await returned(own),
      b = await returned(denied);
    const condition = (id: ReturnType<typeof sql>) =>
      VENUE_SERVICE.orderInZones(venue.cfg, id, [venue.counterZone]);
    const result = await inTx(venue, (tx) =>
      readFindTransactions(tx, venue.cfg, query(), condition),
    );
    expect(result.rows.map((r) => r.transactionId)).toEqual([`refund:${a.id}`, `sale:${own}`]);
    expect(result.total).toBe(2);
    expect((await list({ type: "refund" })).rows.map((r) => r.refundId)).toContain(b.id);
    const otherLocation = await inTx(venue, async (tx) => {
      const [current] = await tx
        .select()
        .from(locations)
        .where(eq(locations.id, venue.cfg.locationId));
      const [other] = await tx
        .insert(locations)
        .values({ ...current!, id: randomUUID(), name: "Other" })
        .returning();
      return other!.id;
    });
    expect(
      await inTx(venue, (tx) =>
        readFindTransactions(tx, { ...venue.cfg, locationId: locationId(otherLocation) }, query()),
      ),
    ).toMatchObject({ rows: [], total: 0 });
  });
  it("pages across invoices and refunds without collapsing shared sale ids and sorts signed amounts", async () => {
    const saleId = await invoice();
    const ids: string[] = [];
    for (let i = 0; i < 51; i++)
      ids.push((await returned(saleId, { appliedAmount: i + 1, tipAmount: 0 })).id);
    const first = await list({ sort: "amount", direction: "ascending" });
    expect(first).toMatchObject({ total: 52, pageSize: 50, page: 0 });
    expect(first.rows.map((r) => r.refundId)).toEqual([...ids].reverse().slice(0, 50));
    expect(
      (await list({ sort: "amount", direction: "ascending", page: "1" })).rows.map(
        (r) => r.transactionId,
      ),
    ).toEqual([`refund:${ids[0]}`, `sale:${saleId}`]);
  });
});
