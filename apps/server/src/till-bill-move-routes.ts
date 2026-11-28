import { withIssuanceTransaction } from "@waitron/core";
import { withTransaction, type Transaction } from "@waitron/db";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { captureKitchenActivity } from "./attendance-capture.js";
import { guardPathParty, moveDishes, mergeBills } from "./bill-actions.js";
import { invalid } from "./bill-allocation.js";
import {
  parseBillEditExpecteds,
  parseBillEditExpected,
  readBillEditState,
} from "./bill-editing.js";
import { billNameZoneSubject, setBillName } from "./bill-identities.js";
import { asObject } from "./bill-payments-api.js";
import { issueIfFullyPaid } from "./bill-payment-settlement.js";
import { refuseTakenOff } from "./floor-today-table.js";
import { sendingCfg } from "./made-here.js";
import { readSentWork } from "./kitchen-ticket-paper.js";
import { partyRevision } from "./parties.js";
import { previewBillMoveAllergy, moveBill, type OtherPartyRead } from "./move-bill.js";
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
  dishMoveTarget,
  otherPartyRead,
  parseClosedZoneConfirmation,
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
      const target = dishMoveTarget(body);
      const command = billCommand(personId, body);
      const attendance =
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock };
      const saleCfg = sendingCfg(cfg, c, session.device);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [
            { orderId: fromBillId },
            ...named(
              "billId" in target && target.billId !== null && { orderId: target.billId },
              "tableId" in target && { tableId: target.tableId },
            ),
          ]);
          const split = {
            ...command,
            admission: deps.admission,
            expectedEdits: parseBillEditExpecteds(body.expectedEdits),
            invoiceChoice: body.invoiceChoice,
          };
          const moved =
            "tableId" in target
              ? await moveDishesToTable(
                  tx,
                  saleCfg,
                  fromBillId,
                  target.tableId,
                  lineIds,
                  split,
                  {
                    ...otherPartyRead(body),
                    ...(body.closedZoneId === undefined
                      ? {}
                      : {
                          zoneConfirmation: parseClosedZoneConfirmation(
                            body.closedZoneId,
                            personId,
                          ),
                        }),
                  },
                  attendance,
                )
              : await moveDishes(tx, cfg, fromBillId, target.billId, lineIds, split);
          const invoice = await issueIfFullyPaid(tx, fiscal, saleCfg, fromBillId, personId);
          await captureKitchenActivity(tx, attendance, personId, [fromBillId, moved.billId]);
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

async function moveDishesToTable(
  tx: Transaction,
  cfg: Parameters<typeof moveBill>[1],
  fromBillId: string,
  tableId: string,
  lineIds: string[],
  split: Parameters<typeof moveDishes>[5],
  destination: OtherPartyRead & Pick<Parameters<typeof moveBill>[4], "zoneConfirmation">,
  attendance: OrderAttendance | undefined,
): Promise<{ billId: string }> {
  const { partyId } = await guardPathParty(tx, fromBillId, split, { bump: false });
  if (partyId === null) throw new AppError("bill.not_at_table", { workingOrderId: fromBillId });
  const before = await readSentWork(tx, fromBillId);
  const { billId } = await moveDishes(
    tx,
    cfg,
    fromBillId,
    null,
    lineIds,
    {
      ...split,
      expectedEdits: split.expectedEdits.filter((edit) => edit.billId === fromBillId),
    },
    { tellKitchen: false },
  );
  const movedEdit = await readBillEditState(tx, billId);
  const expectedEdits = [
    ...split.expectedEdits.filter((edit) => edit.billId !== fromBillId),
    movedEdit,
  ].sort((a, b) => (a.billId < b.billId ? -1 : 1));
  await moveBill(
    tx,
    cfg,
    billId,
    { tableId },
    {
      ...destination,
      operatorId: split.operatorId,
      partyId,
      expectedPartyRevision: await partyRevision(tx, partyId),
      expectedEdits,
    },
    attendance,
    undefined,
    { kitchenBefore: before },
  );
  await refuseTakenOff(tx, [tableId]);
  return { billId };
}
