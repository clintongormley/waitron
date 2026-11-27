import { withIssuanceTransaction } from "@waitron/core";
import { withTransaction, workingOrders, workingOrderLines } from "@waitron/db";
import type { PinThrottle } from "@waitron/identity";
import type { AllergyCommand } from "@waitron/module";
import { readJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { invalid } from "./bill-allocation.js";
import { requireOrderBillEditor } from "./bill-editing.js";
import { issueIfFullyPaid } from "./bill-payment-settlement.js";
import { requireMakeAtStation } from "./dead-ends.js";
import { parseLateSend, withLateSendCheck } from "./late-send.js";
import { sendingCfg } from "./made-here.js";
import type { BillEditExpected } from "./order-drafts.js";
import { partyRevisionOfOrder } from "./parties.js";
import { requestCfg } from "./request-config.js";
import { moveDishesToStation } from "./station-move.js";
import { readTabLines } from "./stored-order-lines.js";
import { stationMoveRequest, recheckFireSession, allergyCommand } from "./till-order-commands.js";
import {
  requireUuidId,
  requireRevision,
  requireTabParam,
  requireLineNo,
} from "./till-request-fields.js";
import { run, runMoveStation, runBodyCourse } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { captureOrderService, readOrderRevision } from "./working-order-context.js";
import { bumpRevisionKeepingPayment, type OrderLinePatch } from "./working-order-edit-state.js";
import { updateOrderLine } from "./working-order-held-write.js";
import { unsentDishLines } from "./working-order-kitchen-fire.js";
import { setLineCourse, sendLines } from "./working-order-kitchen-service.js";
import { checkKitchenOrderZone, checkZones } from "./zone-access.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillOrderLineRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
  fiscal: TillSaleDeps,
): void {
  app.put("/api/working-orders/:id/make-at", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const body = await readJsonBody<{
        revision: unknown;
        lines: Record<string, string | null>;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const copy = requireRevision(body.revision);
      if (body.lines === null || typeof body.lines !== "object" || Array.isArray(body.lines))
        throw invalid("lines");
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const [order] = await tx
          .select({ status: workingOrders.status, revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (order === undefined || order.status !== "open")
          throw new AppError("working_order.not_open", { workingOrderId: id });
        if (copy !== order.revision)
          throw new AppError("working_order.out_of_date", {
            workingOrderId: id,
            revision: order.revision,
          });
        await requireOrderBillEditor(tx, id, {
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        });
        const entries = Object.entries(body.lines);
        const unsent = new Set((await unsentDishLines(tx, id)).map((line) => line.id));
        for (const [lineId, stationId] of entries) {
          if (!unsent.has(lineId)) throw invalid("lines");
          if (stationId !== null) {
            if (typeof stationId !== "string") throw invalid("lines");
            await requireMakeAtStation(tx, stationId);
          }
        }
        const previousChoices =
          deps.attendance === undefined
            ? []
            : await tx
                .select({ id: workingOrderLines.id, stationId: workingOrderLines.makeAtStationId })
                .from(workingOrderLines)
                .where(eq(workingOrderLines.workingOrderId, id));
        for (const [lineId, stationId] of entries)
          await tx
            .update(workingOrderLines)
            .set({ makeAtStationId: stationId })
            .where(eq(workingOrderLines.id, lineId));
        if (entries.length > 0) await bumpRevisionKeepingPayment(tx, [id]);
        if (
          entries.some(([lineId, stationId]) =>
            previousChoices.some((line) => line.id === lineId && line.stationId !== stationId),
          )
        )
          await captureOrderService(
            tx,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
            id,
            "make-at",
          );
        return copy + (entries.length > 0 ? 1 : 0);
      });
      return c.json({ revision });
    }),
  );

  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const tab = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        return {
          lines: await readTabLines(tx, id),
          revision: await readOrderRevision(tx, id),
        };
      });
      return c.json(tab);
    }),
  );

  app.post("/api/working-orders/:id/lines/move-station", (c) =>
    runMoveStation(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const request = stationMoveRequest(id, body);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkKitchenOrderZone(tx, session, id);
        return moveDishesToStation(
          tx,
          cfg,
          id,
          request,
          {
            deviceId: session.deviceId,
            personId: session.personId,
            kind: "order",
            expectedEdit: body.expectedEdit as BillEditExpected | null,
          },
          {
            attendance:
              deps.attendance === undefined
                ? undefined
                : { recorder: deps.attendance, clock: deps.clock },
          },
        );
      });
      return c.json(result);
    }),
  );

  // One line of any open order, edited from the copy at `revision` (plan D10).
  app.put("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const {
        revision,
        expectedEdit,
        lateSend: lateSendBody,
        ...patch
      } = await readJsonBody<
        OrderLinePatch & {
          revision?: unknown;
          expectedEdit: BillEditExpected | null;
          lateSend?: unknown;
        }
      >(c);
      const copy = requireRevision(revision);
      const lateSend = parseLateSend(lateSendBody);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const saved = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            await requireEconomicWrite(tx, deps.cfg, deps.admission);
            await checkZones(tx, session, [{ orderId: id }]);
            const revision = await updateOrderLine(
              tx,
              sendCfg,
              id,
              lineNo,
              patch,
              copy,
              { operatorId: personId, expectedEdit, admission: deps.admission },
              deps.attendance === undefined
                ? undefined
                : { recorder: deps.attendance, clock: deps.clock },
              late,
            );
            const invoice = await issueIfFullyPaid(tx, fiscal, sendCfg, id, personId);
            return {
              revision,
              party: await partyRevisionOfOrder(tx, id),
              ...(invoice === null ? {} : { invoice }),
            };
          },
          log,
        ),
      );
      return c.json(saved);
    }),
  );

  app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const body = await readJsonBody<{
        courseId?: string | null;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const courseId = body.courseId ?? null;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        await setLineCourse(
          tx,
          id,
          lineNo,
          courseId,
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
      });
      return c.body(null, 200);
    }),
  );

  // An omitted or empty `lineNos` releases every held line of the tab outside a held group.
  app.post("/api/working-orders/:id/lines/send", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{
        lineNos?: number[];
        expectedEdit: BillEditExpected | null;
        submissionId?: string;
        expectedPartyRevision?: number;
        allergy?: AllergyCommand["allergy"];
      }>(c);
      await withTransaction(deps.db, async (tx) => {
        const current = await recheckFireSession(tx, session);
        await checkZones(tx, current, [{ orderId: id }]);
        await sendLines(
          tx,
          requestCfg(deps.cfg, current),
          id,
          body.lineNos ?? [],
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
          allergyCommand(body),
        );
      });
      return c.body(null, 200);
    }),
  );
}
