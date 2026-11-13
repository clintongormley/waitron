import { expect, it } from "vitest";
import { rewriteTicketBills } from "./fk9-ticket-fixtures.mjs";

it("drops copied bill keys from literal ticket inserts, leaving line ownership intact", () => {
  const result = rewriteTicketBills(
    "await tx.insert(ticketItems).values([{ workingOrderId: B, workingOrderLineId: L, stationId: S }]);",
    "sample.test.ts",
  );
  expect(result.reports).toEqual([]);
  expect(result.text).not.toContain("workingOrderId: B");
  expect(result.text).toContain("workingOrderLineId: L");
  expect(rewriteTicketBills(result.text, "sample.test.ts")).toEqual(result);
});

it.each([false, true])(
  "reads through the line without duplicating an existing join (%s)",
  (joined) => {
    const source =
      "const rows = await tx.select({ id: ticketItems.id }).from(ticketItems)" +
      (joined
        ? ".innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))"
        : "") +
      ".where(eq(ticketItems.workingOrderId, B));";
    const result = rewriteTicketBills(source, "sample.test.ts");
    expect(result.reports).toEqual([]);
    expect(result.text).toContain("eq(workingOrderLines.workingOrderId, B)");
    expect(result.text.match(/innerJoin\(workingOrderLines/g)).toHaveLength(1);
    expect(rewriteTicketBills(result.text, "sample.test.ts")).toEqual(result);
  },
);

it("preserves flat select-all fixture snapshots when adding the join", () => {
  const result = rewriteTicketBills(
    "const rows = await tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, B));",
    "sample.test.ts",
  );
  expect(result.text).toContain("...getTableColumns(ticketItems)");
  expect(result.text).toContain("workingOrderId: workingOrderLines.workingOrderId");
});

it.each([
  "await tx.insert(ticketItems).values(rows);",
  'tx.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.workingOrderId, B));',
  "sql`select id from ticket_items where working_order_id = ${B}`",
])("reports an unsupported query for hand editing: %s", (source) => {
  const result = rewriteTicketBills(source, "sample.test.ts");
  expect(result.text).toBe(source);
  expect(result.reports.length).toBeGreaterThan(0);
});

it("shares a server fixture's complete ticket/bill read", () => {
  const result = rewriteTicketBills(
    "const rows = await tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, B));",
    "apps/server/src/sample.test.ts",
  );
  expect(result.text).toContain("ticketItemsWithBill(tx)");
  expect(result.text).toContain('"./testing/ticket-items-with-bill.js"');
  expect(result.text).not.toContain("getTableColumns");
  expect(rewriteTicketBills(result.text, "apps/server/src/sample.test.ts")).toEqual(result);
});
