// A stand-in for boot's `core.seatTable` (apps/server/src/parties.ts), which a module cannot import.
// It reproduces the table read, the `table.not_found`/`table.inactive`/`tab.already_open` guards on
// a table a party holds, and these writes of seating: a party, the `working_orders` insert whose id
// is the tab id, the party's membership of the table, and clearing the table's manual status. It
// records no main bill for the party. The order number is a counter; the verbs ignore it.
//
// `table.inactive`/`tab.already_open` are apps/server's codes, declared here so the package's
// production errors.ts does not claim them.
import "@waitron/shared";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { diningTables, parties, partyTables, workingOrders, type Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";

declare module "@waitron/shared" {
  interface ErrorParams {
    "table.inactive": { tableId: string };
    "tab.already_open": { tableId: string };
  }
}

/** The `TillConfig` fields the real `seatTable` stamps on a `working_orders` row. */
export interface FakeCoreConfig {
  tillId: string;
  nodeId: string;
}

let nextOrderNumber = 0;

export function fakeCore(cfg: FakeCoreConfig): CoreServices {
  return {
    async seatTable(tx: Transaction, req) {
      const [table] = await tx
        .select({ active: diningTables.active })
        .from(diningTables)
        .where(eq(diningTables.id, req.tableId));
      if (table === undefined) throw new AppError("table.not_found", { tableId: req.tableId });
      if (!table.active) throw new AppError("table.inactive", { tableId: req.tableId });
      const [held] = await tx
        .select({ id: partyTables.id })
        .from(partyTables)
        .where(and(eq(partyTables.tableId, req.tableId), isNull(partyTables.leftAt)));
      if (held !== undefined) throw new AppError("tab.already_open", { tableId: req.tableId });
      const [party] = await tx
        .insert(parties)
        .values({ guestCount: req.guestCount, openedBy: req.operatorId })
        .returning({ id: parties.id });
      const tabId = randomUUID();
      nextOrderNumber += 1;
      await tx.insert(workingOrders).values({
        id: tabId,
        tillId: cfg.tillId,
        nodeId: cfg.nodeId,
        orderNumber: nextOrderNumber,
        partyId: party!.id,
      });
      await tx.insert(partyTables).values({ partyId: party!.id, tableId: req.tableId });
      await tx.update(diningTables).set({ statusId: null }).where(eq(diningTables.id, req.tableId));
      return { tabId, partyId: party!.id };
    },
  };
}
