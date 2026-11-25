import { withIssuanceTransaction } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { readRawJsonBody } from "@waitron/server-kit";
import type { Hono } from "hono";
import { captureKitchenActivity } from "./attendance-capture.js";
import { moveDishes, mergeBills } from "./bill-actions.js";
import { invalid } from "./bill-allocation.js";
import { parseBillEditExpecteds, parseBillEditExpected } from "./bill-editing.js";
import { billNameZoneSubject, setBillName } from "./bill-identities.js";
import { asObject } from "./bill-payments-api.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import { refuseTakenOff } from "./floor-today-table.js";
import { sendingCfg } from "./made-here.js";
import { previewBillMoveAllergy, moveBill } from "./move-bill.js";
import { requestCfg } from "./request-config.js";
import { recheckFireSession } from "./till-order-commands.js";
import { named } from "./till-order-zones.js";
import {
  requireTabParam,
  requireLineIds,
  requireOtherBill,
  billCommand,
  requireMoveTarget,
  moveCommand,
} from "./till-request-fields.js";
import { run, runBodyLines } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import type { OrderAttendance, TillSaleDeps } from "./working-order-context.js";
import { checkZones } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillBillMoveRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  fiscal: TillSaleDeps,
): void {
  // The path is the bill the dishes leave.
  app.post("/api/bills/:id/move-dishes", (c) =>
    runBodyLines(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const fromBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lineIds = requireLineIds(body.lineIds);
      const toBillId = body.toBillId === null ? null : requireOtherBill(body.toBillId, "toBillId");
      const command = billCommand(personId, body);
      const saleCfg = sendingCfg(cfg, c, session.device);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [
            { orderId: fromBillId },
            ...(toBillId === null ? [] : [{ orderId: toBillId }]),
          ]);
          const moved = await moveDishes(tx, cfg, fromBillId, toBillId, lineIds, {
            admission: deps.admission,
            ...command,
            expectedEdits: parseBillEditExpecteds(body.expectedEdits),
            invoiceChoice: body.invoiceChoice,
          });
          const invoice = await issueIfFullyPaid(tx, fiscal, saleCfg, fromBillId, personId);
          await captureKitchenActivity(
            tx,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
            personId,
            [fromBillId, moved.billId],
          );
          return { ...moved, ...(invoice === null ? {} : { invoice }) };
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.put("/api/bills/:id/name", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      // The wire always carries a name; null or "" clears it.
      if (body.name === undefined) throw invalid("name");
      const command = {
        ...billCommand(session.personId, body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
      };
      const named = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [await billNameZoneSubject(tx, billId)]);
        return setBillName(tx, billId, body.name, command);
      });
      return c.json(named);
    }),
  );

  // The path is the bill merged INTO.
  app.post("/api/bills/:id/merge", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const intoBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const fromBillId = requireOtherBill(body.fromBillId, "fromBillId");
      const command = { ...billCommand(personId, body), invoiceChoice: body.invoiceChoice };
      await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        await checkZones(tx, session, [{ orderId: intoBillId }, { orderId: fromBillId }]);
        let attendance: OrderAttendance | undefined;
        if (deps.attendance !== undefined) {
          const reading = deps.clock.now();
          attendance = {
            recorder: deps.attendance,
            clock: {
              now: () => reading,
              anchor: (trusted) => deps.clock.anchor(trusted),
              currentAnchor: () => deps.clock.currentAnchor(),
            },
          };
        }
        await mergeBills(
          tx,
          cfg,
          intoBillId,
          fromBillId,
          {
            admission: deps.admission,
            ...command,
            expectedEdits: parseBillEditExpecteds(body.expectedEdits),
          },
          attendance,
        );
        await captureKitchenActivity(tx, attendance, personId, [intoBillId, fromBillId]);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/bills/:id/move/allergy-preview", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const to = requireMoveTarget(body.to);
      if (!("tableId" in to)) throw invalid("to");
      const command = moveCommand(session.personId, body);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const current = await recheckFireSession(tx, session);
          await checkZones(tx, current, [{ orderId: billId }, { tableId: to.tableId }]);
          return previewBillMoveAllergy(tx, billId, to.tableId, command);
        }),
      );
    }),
  );

  app.post("/api/bills/:id/move", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const to = requireMoveTarget(body.to);
      const command = moveCommand(personId, body);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          const current =
            command.allergy === undefined ? session : await recheckFireSession(tx, session);
          await checkZones(tx, current, [
            { orderId: billId },
            ...named(
              "tableId" in to && { tableId: to.tableId },
              "counter" in to && to.counter.zoneId !== null && { zoneId: to.counter.zoneId },
            ),
          ]);
          const moved = await moveBill(
            tx,
            sendCfg,
            billId,
            to,
            command,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
            // Only a move that regroups the bill gets here, so no other needs the economic write this requires.
            (id) => issueIfFullyPaid(tx, fiscal, sendCfg, id, personId),
          );
          if ("tableId" in to) await refuseTakenOff(tx, [to.tableId]);
          return moved;
        },
        log,
      );
      return c.json(result);
    }),
  );
}
