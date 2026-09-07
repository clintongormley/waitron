// A test-scoped stand-in for boot's real `core.openTab` (apps/server/src/working-order.ts), which a
// module cannot import. It reproduces openTab's OBSERVABLE behaviour so the moved seat suites keep
// their assertions: the `SELECT … FOR UPDATE` on the table (so bookings-cas.test.ts's two-backend
// race stages on the real lock), the `table.not_found`/`table.inactive`/`tab.already_open` guards,
// the `working_orders` insert whose id IS the tab id, and the `dining_tables.tab_id` back-pointer.
// It does NOT allocate a real per-node order number — the verbs ignore it — so a counter suffices.
//
// `table.inactive`/`tab.already_open` are apps/server-owned codes this double borrows to mimic
// openTab; declared here (a testing file, excluded from coverage) rather than in the package's prod
// errors.ts. TypeScript merges an identical duplicate across compilations, and this augmentation is
// unreachable from apps/server (which never imports src/testing), so there is no clash. `table.not_found`
// is @waitron/db's (a real cross-package thrower) — no re-declaration needed.
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

/** The `TillConfig` fields the real `openTab` reads to stamp a `working_orders` row; boot binds the
 * full config into `core`, so this double captures exactly these three. */
export interface FakeCoreConfig {
  tenantId: string;
  tillId: string;
  nodeId: string;
}

let nextOrderNumber = 0;

/** Build a {@link CoreServices} whose `openTab` behaves as the real one does (see the file header). */
export function fakeCore(cfg: FakeCoreConfig): CoreServices {
  return {
    async openTab(tx: Transaction, req: { tableId: string }) {
      const [table] = await tx
        .select({ active: diningTables.active, tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, req.tableId))
        .for("update");
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
        tenantId: cfg.tenantId,
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
