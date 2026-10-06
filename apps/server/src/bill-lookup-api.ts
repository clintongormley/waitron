import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import type { Logger } from "./logger.js";
import { listOrders, type OrderCursor } from "./orders-list.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { orderFilter, type OrderFilter } from "./zone-access.js";
import "./errors.js";

export const BILL_LOOKUP_LIMIT = 20;

export interface BillLookupRow {
  workingOrderId: string;
  orderNumber: number | null;
  label: string | null;
  partyName: string | null;
  tables: string[];
  invoiceNumber: string | null;
  openedAt: string;
  departedAt: string | null;
  status: "waiting_for_payment" | "left_without_paying";
  stillOwed: string;
}

/**
 * A till sees only bills the collect route can settle, after the same filters as Orders. With
 * `visible`, a page is read again past the bills it hides until twenty show or none are left.
 */
export async function lookUpBills(
  tx: Transaction,
  q: string,
  visible?: OrderFilter,
): Promise<BillLookupRow[]> {
  const found: BillLookupRow[] = [];
  let after: OrderCursor | undefined;
  do {
    const page = await listOrders(tx, {
      status: "unpaid",
      dates: "any",
      credited: false,
      search: q,
      limit: BILL_LOOKUP_LIMIT,
      collectable: true,
      scope: "all",
      ...(after === undefined ? {} : { after }),
    });
    const shown = visible === undefined ? undefined : await visible(page.rows.map((row) => row.id));
    for (const row of page.rows) {
      if (shown !== undefined && !shown.has(row.id)) continue;
      if (row.stillOwed === null) continue;
      if (row.status !== "waiting_for_payment" && row.status !== "left_without_paying") continue;
      found.push({
        workingOrderId: row.id,
        orderNumber: row.orderNumber,
        label: row.label,
        partyName: row.partyName,
        tables: row.tables,
        invoiceNumber: row.invoiceNumber,
        openedAt: row.at,
        departedAt: row.departedAt,
        status: row.status,
        stillOwed: row.stillOwed,
      });
    }
    after = page.next ?? undefined;
  } while (visible !== undefined && found.length < BILL_LOOKUP_LIMIT && after !== undefined);
  return found.slice(0, BILL_LOOKUP_LIMIT);
}

export function mountBillLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/bills/lookup", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const q = c.req.query("q")?.trim() ?? "";
      if (q === "" || q.length > 100)
        throw new AppError("management.request_invalid", { field: "q" });
      const bills = await withTransaction(deps.db, async (tx) =>
        lookUpBills(tx, q, await orderFilter(tx, deps.cfg, session.device.deviceProfileId)),
      );
      return c.json({ bills });
    }),
  );
}
