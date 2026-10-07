import { and, asc, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { codeOf } from "@waitron/server-kit";
import {
  withTransaction,
  workingOrders,
  workingOrderLines,
  ticketItems,
  kitchenStations,
  type Transaction,
} from "@waitron/db";
import { authorize, canUseDeviceProfile, persons } from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, centsToDecimal, thousandthsToDecimal } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import type { Logger } from "./logger.js";
import { requireRevision, type Run, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value))
    throw new AppError("management.request_invalid", { field });
  return value.toLowerCase();
}

async function actor(
  tx: Transaction,
  deps: TillApiDeps,
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  await authorize(tx, { sessionId: session.sessionId, permission: "sale.take_payment" });
  const [person] = await tx
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, session.personId));
  if (person?.status !== "active")
    throw new AppError("person.suspended", { personId: session.personId });
  const device = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  const scope = await VENUE_SERVICE.readProfileZones(tx, deps.cfg, device.deviceProfileId);
  if (scope.departmentId === null) throw new AppError("department_transfer.not_allowed", {});
  return {
    departmentId: scope.departmentId,
    personId: session.personId,
    profileId: device.deviceProfileId,
    device,
  };
}

export function mountDepartmentTransferApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
): void {
  const bus = deps.liveEvents;
  if (bus !== undefined)
    app.get("/api/department-transfers/events", (c) =>
      run(c, log, async () => {
        const authenticate = async () => {
          const session = await requireSession(deps, c, { action: "take-orders", passive: true });
          await withTransaction(deps.db, (tx) => actor(tx, deps, session));
        };
        await authenticate();
        const response = streamSSE(c, async (stream) => {
          // Invalidation carries no identities: the queue and source history retain their own gates.
          let pending = false;
          let closed = false;
          let wake = (): void => {};
          const unsubscribe = bus.subscribe((event) => {
            if (event.kind === "close") closed = true;
            else if (
              event.change.resources.some(
                (resource) =>
                  resource.type === "department_transfer_requests" ||
                  resource.type === "department_transfer_desks" ||
                  resource.type === "department_transfer_destinations" ||
                  resource.type === "order_service_contexts",
              )
            )
              pending = true;
            else return;
            wake();
          });
          const timer = setInterval(() => wake(), 15_000);
          const cleanup = () => {
            closed = true;
            clearInterval(timer);
            unsubscribe();
            wake();
          };
          stream.onAbort(cleanup);
          try {
            await stream.writeSSE({ event: "ready", data: "{}" });
            while (!closed && !stream.aborted) {
              if (!pending)
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              if (closed || stream.aborted) break;
              try {
                await authenticate();
              } catch (error) {
                if (error instanceof AppError)
                  await stream.writeSSE({
                    event: "session-invalid",
                    data: JSON.stringify({ code: error.code }),
                  });
                else log("warn", "live.stream_failed", { errorCode: codeOf(error) });
                break;
              }
              if (closed || stream.aborted) break;
              const event = pending ? "change" : "keepalive";
              pending = false;
              await stream.writeSSE({ event, data: "{}" });
            }
          } catch (error) {
            log("warn", "live.stream_failed", { errorCode: codeOf(error) });
          } finally {
            cleanup();
          }
        });
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Accel-Buffering", "no");
        return response;
      }),
    );
  app.get("/api/department-transfers/destinations", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const destinations = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        return VENUE_SERVICE.listDepartmentTransferDestinations(tx, deps.cfg, sender);
      });
      return c.json({ destinations });
    }),
  );
  app.get("/api/department-transfers/incoming", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requests = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        return VENUE_SERVICE.listIncomingDepartmentTransfers(tx, deps.cfg, receiver);
      });
      return c.json({ count: requests.length, requests });
    }),
  );
  app.get("/api/working-orders/:id/department-transfers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const tabId = uuid(c.req.param("id"), "tabId");
      const requests = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        const rows = await VENUE_SERVICE.listSentDepartmentTransfers(tx, deps.cfg, tabId, sender);
        const context = await VENUE_SERVICE.getOrderContext(tx, deps.cfg, tabId);
        if (context.departmentId === sender.departmentId)
          await checkZones(tx, deps.cfg, sender, [{ orderId: tabId }]);
        // Resolution remains visible to the source after responsibility moves; it exposes no tab contents.
        return rows;
      });
      return c.json({ requests });
    }),
  );
  app.get("/api/department-transfers/sent", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requests = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        return VENUE_SERVICE.listDepartmentSentTransfers(tx, deps.cfg, sender);
      });
      return c.json({ requests });
    }),
  );
  app.get("/api/department-transfers/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const detail = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        const request = await VENUE_SERVICE.readIncomingDepartmentTransfer(
          tx,
          deps.cfg,
          requestId,
          receiver,
        );
        const [tab] = await tx
          .select({
            id: workingOrders.id,
            revision: workingOrders.revision,
            status: workingOrders.status,
            label: workingOrders.label,
            orderNumber: workingOrders.orderNumber,
            deliveryTableId: workingOrders.deliveryTableId,
          })
          .from(workingOrders)
          .where(
            and(
              eq(workingOrders.id, request.tabId),
              eq(workingOrders.locationId, deps.cfg.locationId),
            ),
          );
        if (tab === undefined || (tab.status !== "open" && tab.status !== "placed"))
          throw new AppError("department_transfer.tab_unavailable", { tabId: request.tabId });
        const storedLines = await tx
          .select({
            id: workingOrderLines.id,
            name: workingOrderLines.name,
            variantName: workingOrderLines.variantName,
            quantity: workingOrderLines.quantity,
            unitPriceGross: workingOrderLines.unitPriceGross,
            note: workingOrderLines.note,
            parentLineId: workingOrderLines.parentLineId,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, request.tabId))
          .orderBy(asc(workingOrderLines.lineNo));
        const lines = storedLines.map((line) => ({
          ...line,
          quantity: thousandthsToDecimal(line.quantity),
          unitPriceGross: centsToDecimal(line.unitPriceGross),
        }));
        const outstandingWork = await tx
          .select({
            id: ticketItems.id,
            lineId: ticketItems.workingOrderLineId,
            stationId: ticketItems.stationId,
            stationName: kitchenStations.name,
            state: ticketItems.state,
            note: ticketItems.note,
            firedAt: ticketItems.firedAt,
            awayAt: ticketItems.awayAt,
            courseId: ticketItems.courseId,
          })
          .from(ticketItems)
          .leftJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
          .where(
            and(
              eq(ticketItems.workingOrderId, request.tabId),
              eq(ticketItems.madeHere, false),
              isNull(ticketItems.awayAt),
            ),
          )
          .orderBy(asc(ticketItems.queuedAt), asc(ticketItems.id));
        return { request, tab, lines, outstandingWork };
      });
      return c.json(detail);
    }),
  );
  app.post("/api/working-orders/:id/department-transfers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const tabId = uuid(c.req.param("id"), "tabId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      const destinationId = uuid(body.destinationDepartmentId, "destinationDepartmentId");
      const result = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        await checkZones(tx, deps.cfg, sender, [{ orderId: tabId }]);
        return VENUE_SERVICE.requestDepartmentTransfer(tx, deps.cfg, tabId, destinationId, sender);
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/withdraw", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const result = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        const request = await VENUE_SERVICE.readDepartmentTransfer(tx, deps.cfg, requestId, sender);
        await checkZones(tx, deps.cfg, sender, [{ orderId: request.tabId }]);
        return VENUE_SERVICE.withdrawDepartmentTransfer(tx, deps.cfg, requestId, sender);
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/accept", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      const tabRevision = requireRevision(body.revision);
      const zoneId = uuid(body.zoneId, "zoneId");
      const tableId =
        body.tableId === undefined || body.tableId === null ? null : uuid(body.tableId, "tableId");
      const result = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        await checkZones(tx, deps.cfg, receiver, [{ zoneId }]);
        return VENUE_SERVICE.acceptDepartmentTransfer(tx, deps.cfg, requestId, receiver, {
          tabRevision,
          zoneId,
          tableId,
        });
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/decline", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (typeof body.reason !== "string" || !body.reason.trim())
        throw new AppError("department_transfer.reason_required", {});
      const reason = body.reason;
      const result = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        return VENUE_SERVICE.declineDepartmentTransfer(tx, deps.cfg, requestId, receiver, reason);
      });
      return c.json(result);
    }),
  );
}
