// A test-scoped stand-in for boot's real `core.openTab` (apps/server/src/working-order.ts), which a
// module cannot import. It reproduces openTab's OBSERVABLE behaviour so the moved seat suites keep
// their assertions: the read of the dining table, the
// `table.not_found`/`table.inactive`/`tab.already_open` guards, the `working_orders` insert whose id
// IS the tab id, and the `dining_tables.tab_id` back-pointer.
// It does NOT allocate a real per-node order number — the verbs ignore it — so a counter suffices.
//
// The table read was a `SELECT … FOR UPDATE`, and the one thing that clause was FOR in a double is
// named in this header's old text: it was what `bookings-cas.test.ts` parked its second backend on
// to stage a genuine read-then-concurrent-cancel interleave. The clause is deleted, not translated
// — SQLite has no row locks and drizzle's SQLite query builder has no `.for()`, so it is a compile
// error here (`error TS2339: Property 'for' does not exist`, run
// `pnpm --filter @waitron/bookings typecheck` on this branch). What the real `openTab` relies on
// instead is that one write transaction runs on the venue file at a time; the pattern is stated
// once, with its measurement and its control, on `assertExtraListForWrite`
// (`packages/catalogue/src/extras.ts`).
//
// This double is now a WEAKER stand-in than it was, and the loss is `bookings-cas.test.ts`'s, not
// this file's: that suite's whole staging mechanism went with the clause. Its banner records what
// it no longer demonstrates. Nothing here can give it back — there is no interleave to stage on an
// engine that admits one writer.
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
