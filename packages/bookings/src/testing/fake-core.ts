// A stand-in for boot's `core.openTab` (apps/server/src/working-order.ts), which a module cannot
// import. It reproduces the table read, the `table.not_found`/`table.inactive`/`tab.already_open`
// guards, the `working_orders` insert whose id is the tab id, and the `dining_tables.tab_id`
// back-pointer. The order number is a counter; the verbs ignore it.
//
// `table.inactive`/`tab.already_open` are apps/server's codes, declared here so the package's
// production errors.ts does not claim them.
import "@waitron/shared";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { diningTables, workingOrders, type Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";

declare module "@waitron/shared" {
  interface ErrorParams {
    "table.inactive": { tableId: string };
    "tab.already_open": { tableId: string };
  }
}

/** The `TillConfig` fields the real `openTab` stamps on a `working_orders` row. */
export interface FakeCoreConfig {
  tillId: string;
  nodeId: string;
}

let nextOrderNumber = 0;

export function fakeCore(cfg: FakeCoreConfig): CoreServices {
  return {
    async openTab(tx: Transaction, req: { tableId: string }) {
      const [table] = await tx
        .select({ active: diningTables.active, tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, req.tableId));
      if (table === undefined) throw new AppError("table.not_found", { tableId: req.tableId });
      if (!table.active) throw new AppError("table.inactive", { tableId: req.tableId });
      if (table.tabId !== null) {
        const [open] = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(and(eq(workingOrders.id, table.tabId), eq(workingOrders.status, "open")));
        if (open !== undefined) throw new AppError("tab.already_open", { tableId: req.tableId });
      }
      const tabId = randomUUID();
      nextOrderNumber += 1;
      await tx.insert(workingOrders).values({
        id: tabId,
        tillId: cfg.tillId,
        nodeId: cfg.nodeId,
        orderNumber: nextOrderNumber,
      });
      await tx
        .update(diningTables)
        .set({ tabId, statusId: null })
        .where(eq(diningTables.id, req.tableId));
      return { tabId, orderNumber: nextOrderNumber };
    },
  };
}
