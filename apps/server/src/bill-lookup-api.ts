import type { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import type { Logger } from "./logger.js";
import { listOrders } from "./orders-list.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { orderZoneCondition, type OrderZoneCondition } from "./zone-access.js";
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

/** A till sees only bills the collect route can settle, after the same filters as Orders. */
export async function lookUpBills(
  tx: Transaction,
  q: string,
  inZones?: OrderZoneCondition,
): Promise<BillLookupRow[]> {
  const { rows } = await listOrders(tx, {
    status: "unpaid",
    dates: "any",
    credited: false,
    search: q,
    limit: BILL_LOOKUP_LIMIT,
    collectable: true,
    scope: "all",
    ...(inZones === undefined ? {} : { orderIn: inZones }),
  });
  return rows.flatMap((row): BillLookupRow[] =>
    row.stillOwed === null ||
    (row.status !== "waiting_for_payment" && row.status !== "left_without_paying")
      ? []
      : [
          {
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
          },
        ],
  );
}

export function mountBillLookupApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/bills/lookup", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const q = c.req.query("q") ?? "";
      const typed = q.trim().length;
      if (typed === 0 || typed > 100)
        throw new AppError("management.request_invalid", { field: "q" });
      const bills = await withTransaction(deps.db, async (tx) =>
        lookUpBills(tx, q, await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId)),
      );
      return c.json({ bills });
    }),
  );
}
