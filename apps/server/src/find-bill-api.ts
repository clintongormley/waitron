import type { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { withTransaction, type Transaction } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { readLocationClock } from "@waitron/reporting";
import { findBillsRelation, readFindBill, readFindBills } from "./find-bill-bills.js";
import { findTransactionsRelation, readFindTransactions } from "./find-bill-transactions.js";
import { parseBillsQuery, parseTransactionsQuery } from "./find-bill-query.js";
import type { FindBillOptions } from "./find-bill-types.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { checkZones, orderZoneCondition, type OrderZoneCondition } from "./zone-access.js";
import "./errors.js";

export async function readFindBillOptions(
  tx: Transaction,
  cfg: TillConfig,
  inZones?: OrderZoneCondition,
): Promise<FindBillOptions> {
  const bills = findBillsRelation(cfg, inZones);
  const choices = async (relation: SQL, select: SQL) =>
    (await tx.execute<{ id: string; name: string }>(sql`${relation} ${select}`)).rows;
  const zones = await choices(
    bills,
    sql`select distinct zone_id as id,zone_name as name from bills where zone_id is not null order by name,id`,
  );
  const billStaff = await choices(
    bills,
    sql`select distinct l.credited_to as id,coalesce(p.display_name,l.credited_to) as name
    from bills b join working_order_lines l on l.working_order_id=b.id left join persons p on p.id=l.credited_to
    where l.credited_to is not null order by name,id`,
  );
  const transactionStaff = await choices(
    findTransactionsRelation(cfg, inZones),
    sql`select distinct operator_id as id,coalesce(staff_name,operator_id) as name
    from transactions where operator_id is not null order by name,id`,
  );
  const { timeZone } = await readLocationClock(tx, cfg.locationId);
  return { timeZone, zones, billStaff, transactionStaff };
}

export function mountFindBillApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.get("/api/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const query = parseBillsQuery(new URL(c.req.url).searchParams);
      const result = await withTransaction(deps.db, async (tx) => {
        if (query.zoneId !== undefined)
          await checkZones(tx, deps.cfg, session, [{ zoneId: query.zoneId }]);
        return readFindBills(
          tx,
          deps.cfg,
          query,
          await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId),
        );
      });
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
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const bill = await readFindBill(
          tx,
          deps.cfg,
          id,
          await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId),
        );
        return { ...bill, edit: bill.partyId === null ? null : await readBillEditState(tx, id) };
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
          deps.cfg,
          query,
          await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId),
        ),
      );
      return c.json(result);
    }),
  );
  app.get("/api/find-bill/options", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const result = await withTransaction(deps.db, async (tx) =>
        readFindBillOptions(
          tx,
          deps.cfg,
          await orderZoneCondition(tx, deps.cfg, session.device.deviceProfileId),
        ),
      );
      return c.json(result);
    }),
  );
}
