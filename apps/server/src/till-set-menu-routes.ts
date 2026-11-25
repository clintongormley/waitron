import { type Transaction, withTransaction } from "@waitron/db";
import { type Logger, requireBodyUuid, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { requireOrderBillEditor } from "./bill-editing.js";
import { asObject } from "./bill-payments-api.js";
import type { BillEditExpected } from "./order-drafts.js";
import { partyOfOrder, partyRevision, checkAndBumpParty } from "./parties.js";
import { requestCfg } from "./request-config.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { setSetMenuCount, removeSetMenuLines } from "./set-menu-count.js";
import { assertTabOpen } from "./stored-order-lines.js";
import { requireTabParam, requireRevision } from "./till-request-fields.js";
import { run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { checkZones } from "./zone-access.js";

export function mountTillSetMenuRoutes(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.get("/api/bills/:id/set-menus", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: billId }]);
        const revision = await assertTabOpen(tx, billId);
        const partyId = await partyOfOrder(tx, billId);
        return {
          setMenus: await readBillSetMenus(tx, billId),
          partyRevision: partyId === null ? revision : await partyRevision(tx, partyId),
        };
      });
      return c.json(result);
    }),
  );

  function changeSetMenus(
    session: Awaited<ReturnType<typeof requireSession>>,
    billId: string,
    expected: number,
    expectedEdit: BillEditExpected | null,
    change: (tx: Transaction) => Promise<Awaited<ReturnType<typeof readBillSetMenus>>>,
  ) {
    return withTransaction(deps.db, async (tx) => {
      await requireEconomicWrite(tx, deps.cfg, deps.admission);
      await checkZones(tx, session, [{ orderId: billId }]);
      const revision = await assertTabOpen(tx, billId);
      const partyId = await partyOfOrder(tx, billId);
      await requireOrderBillEditor(tx, billId, { operatorId: session.personId, expectedEdit });
      if (partyId === null && revision !== expected)
        throw new AppError("working_order.out_of_date", { workingOrderId: billId, revision });
      const next =
        partyId === null ? revision + 1 : await checkAndBumpParty(tx, partyId, expected, "open");
      return { setMenus: await change(tx), partyRevision: next };
    });
  }

  app.put("/api/bills/:id/set-menus/:setMenuId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const menuId = requireBodyUuid(c.req.param("setMenuId"), "setMenuId").toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expected = requireRevision(body.expectedPartyRevision, "expectedPartyRevision");
      const count = body.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 99)
        throw new AppError("management.request_invalid", { field: "count" });
      const result = await changeSetMenus(
        session,
        billId,
        expected,
        body.expectedEdit as BillEditExpected | null,
        (tx) => setSetMenuCount(tx, cfg, billId, menuId, count, session.personId),
      );
      return c.json(result);
    }),
  );

  app.delete("/api/bills/:id/set-menu-lines/:lineId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const lineId = requireBodyUuid(c.req.param("lineId"), "lineId").toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expected = requireRevision(body.expectedPartyRevision, "expectedPartyRevision");
      const result = await changeSetMenus(
        session,
        billId,
        expected,
        body.expectedEdit as BillEditExpected | null,
        (tx) => removeSetMenuLines(tx, billId, [lineId]),
      );
      return c.json(result);
    }),
  );
}
