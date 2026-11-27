import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { readVenueClock, withTransaction, type Transaction } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { readFindBill, readFindBills } from "./find-bill-bills.js";
import { findTransactionsRelation, readFindTransactions } from "./find-bill-transactions.js";
import { parseBillsQuery, parseTransactionsQuery } from "./find-bill-query.js";
import type { FindBillOptions } from "./find-bill-types.js";
import type { Logger } from "./logger.js";
import type { Run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { checkZones, orderZoneCondition, type OrderZoneCondition } from "./zone-access.js";
import "./errors.js";

export async function readFindBillOptions(
  tx: Transaction,
  inZones?: OrderZoneCondition,
): Promise<FindBillOptions> {
  const { rows: transactionStaff } = await tx.execute<{ id: string; name: string }>(
    sql`${findTransactionsRelation(inZones)} select distinct operator_id as id,coalesce(staff_name,operator_id) as name
    from transactions where operator_id is not null order by name,id`,
  );
  const { timeZone } = await readVenueClock(tx);
  return { timeZone, transactionStaff };
}

export function mountFindBillApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const query = parseBillsQuery(new URL(c.req.url).searchParams);
      const result = await withTransaction(deps.db, async (tx) =>
        readFindBills(tx, query, await orderZoneCondition(tx, session.device.deviceProfileId)),
      );
      return c.json(result);
    }),
  );
  app.get("/api/bills/:workingOrderId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const raw = c.req.param("workingOrderId");
      if (!isUuid(raw)) throw new AppError("working_order.not_found", { workingOrderId: raw });
      const id = raw.toLowerCase();
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const bill = await readFindBill(
          tx,
          id,
          await orderZoneCondition(tx, session.device.deviceProfileId),
        );
        return { ...bill, edit: await readBillEditState(tx, id) };
      });
      return c.json(result);
    }),
  );
  app.get("/api/transactions", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const query = parseTransactionsQuery(new URL(c.req.url).searchParams);
      const result = await withTransaction(deps.db, async (tx) =>
        readFindTransactions(
          tx,
          query,
          await orderZoneCondition(tx, session.device.deviceProfileId),
        ),
      );
      return c.json(result);
    }),
  );
  app.get("/api/find-bill/options", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const result = await withTransaction(deps.db, async (tx) =>
        readFindBillOptions(tx, await orderZoneCondition(tx, session.device.deviceProfileId)),
      );
      return c.json(result);
    }),
  );
}
