import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sales, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parkOrder } from "./working-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { provisionBillVenue, send, tendersOfBill } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("Counter payments through the bill window", () => {
  it.each([false, true])(
    "takes the first part and settles one EUR30 invoice (placed=%s)",
    async (placed) => {
      const venue = await provisionBillVenue(suite.db);
      const id = randomUUID();
      const deps = {
        db: suite.db,
        backend: venue.backend,
        clock: venue.clock,
        admission: testTradingAdmission(),
      };
      await parkOrder(deps, venue.cfg, {
        id,
        lines: [{ menuItemId: venue.offerFor("Botella tinto"), quantity: "1" }],
        zoneId: venue.zoneId,
        operatorId: venue.operatorId,
      });
      if (placed) await placeOrder(deps, venue.cfg, id, venue.operatorId);
      const [before] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      const linesBefore = await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      const path = `/api/working-orders/${id}/payments`;
      const first = {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "20.00",
        applied: "10.00",
        tip: "0.00",
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, id)),
      };
      const preview = await send(venue.app, venue.cookie, "POST", `${path}/preview`, {
        kind: first.kind,
        amount: first.amount,
        method: first.method,
        tendered: first.tendered,
        expectedEdit: first.expectedEdit,
      });
      expect(preview).toMatchObject({
        status: 200,
        json: { kind: "allocated", applied: "10.00", tip: "0.00", change: "10.00" },
      });
      const partial = await send(venue.app, venue.cookie, "POST", path, first);
      expect(partial).toMatchObject({
        status: 200,
        json: {
          payment: { state: "received", applied: "10.00", tendered: "20.00", change: "10.00" },
          balance: { total: "30.00", received: "10.00", outstanding: "20.00" },
        },
      });
      expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toEqual([]);
      const replay = await send(venue.app, venue.cookie, "POST", path, first);
      expect(replay.json).toEqual(partial.json);
      const last = await send(venue.app, venue.cookie, "POST", path, {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "20.00",
        method: "card",
        entry: "reader",
        applied: "20.00",
        tip: "0.00",
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, id)),
      });
      expect(last).toMatchObject({
        status: 200,
        json: {
          payment: { state: "received", applied: "20.00" },
          balance: { total: "30.00", received: "30.00", outstanding: "0.00" },
          invoice: { total: "30.00" },
        },
      });
      expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(
        1,
      );
      expect(
        (await tendersOfBill(venue, id)).map(({ method, amount }) => ({ method, amount })),
      ).toEqual([
        { method: "cash", amount: 1000 },
        { method: "card", amount: 2000 },
      ]);
      if (placed) {
        const [after] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
        expect(after).toMatchObject({
          orderNumber: before!.orderNumber,
          label: before!.label,
          collectedAt: before!.collectedAt,
        });
        const linesAfter = await suite.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id));
        expect(linesAfter.map(({ sentAt }) => ({ sentAt }))).toEqual(
          linesBefore.map(({ sentAt }) => ({ sentAt })),
        );
      }
    },
  );
});

it("refuses preview and a first part payment after a placed Counter bill is invoiced", async () => {
  const venue = await provisionBillVenue(suite.db);
  const id = randomUUID();
  const deps = {
    db: suite.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Botella tinto"), quantity: "1" }],
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId);
  await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
  const ask = {
    kind: "contribution",
    amount: "10.00",
    method: "cash",
    tendered: "10.00",
    expectedEdit: null,
  };
  const path = `/api/working-orders/${id}/payments`;
  const preview = await send(venue.app, venue.cookie, "POST", `${path}/preview`, ask);
  const taken = await send(venue.app, venue.cookie, "POST", path, {
    ...ask,
    submissionId: randomUUID(),
    applied: "10.00",
    tip: "0.00",
  });
  expect(preview).toMatchObject({ status: 409, json: { code: "working_order.not_open" } });
  expect(taken).toMatchObject({ status: 409, json: { code: "working_order.not_open" } });
  expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(1);
});
