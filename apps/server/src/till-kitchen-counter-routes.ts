import { withTransaction, ticketItems } from "@waitron/db";
import { readJsonBody, requireBodyUuid } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { submissionIdOf } from "./bill-payments-api.js";
import { reprintOrderTickets } from "./kitchen-ticket-reprint.js";
import type { TicketState } from "./kitchen-ticket-state.js";
import { listStationsToday } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { readScopedPassBoard } from "./pass-board.js";
import { passReleaseRefusal } from "./pass-release.js";
import { requestCfg } from "./request-config.js";
import { stationPrintersDown } from "./station-outputs-down.js";
import { requireUuidId } from "./till-request-fields.js";
import { run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { listCounterWaiting, handOverOrder } from "./working-order-counter.js";
import { bumpBillReady, advanceTicketItem } from "./working-order-kitchen-service.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { checkKitchenOrderZone, visiblePickupOrders } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

function mountBillReady(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.post("/api/orders/:id/ready", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const refused = passReleaseRefusal(session.device);
      if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
      const { personId } = session;
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTransaction(deps.db, async (tx) => {
        await checkKitchenOrderZone(tx, session, orderId);
        await bumpBillReady(
          tx,
          orderId,
          { personId },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.body(null, 200);
    }),
  );
}

export function mountTillKitchenCounterRoutes(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.get("/api/stations", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(await deps.db.withWriteLock(() => listStationsToday(deps.db)));
    }),
  );

  // The station's work, and the corrections to it (recalls, voids) a cook has not acknowledged.
  app.get("/api/stations/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
      const queue = await deps.db.withWriteLock(async () => ({
        items: await listStationQueue(deps.db, id),
        notices: await VENUE_SERVICE.listStationNotices(deps.db, id),
        printersDown: (await stationPrintersDown(deps.db, new Date(), [id])).map(
          ({ printerId, printerName, since }) => ({ printerId, printerName, since }),
        ),
      }));
      return c.json(queue);
    }),
  );

  app.post("/api/kitchen-notices/:id/acknowledge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c, { action: "prepare-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, id);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("ticket_item.not_found", { ticketItemId: id });
      const body = await readJsonBody<{ to?: string; stationId?: unknown }>(c);
      const stationId = requireBodyUuid(body.stationId, "stationId").toLowerCase();
      // `advanceTicketItem` refuses any target outside its transition table before the update runs.
      const to = body.to as TicketState;
      await withTransaction(deps.db, async (tx) => {
        // `advanceTicketItem` never checks the station, and a view can still show a dish another
        // station has since taken. An unknown item is left to the verb.
        const [item] = await tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.id, id));
        if (item !== undefined && item.stationId !== stationId) {
          throw new AppError("device.forbidden_station", { stationId: item.stationId });
        }
        await advanceTicketItem(
          tx,
          id,
          to,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
      });
      return c.body(null, 200);
    }),
  );

  app.get("/api/expo/board", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const board = await deps.db.withWriteLock(() =>
        readScopedPassBoard(deps.db, { stationIds: null, zoneIds: null }, { release: false }),
      );
      return c.json({ board });
    }),
  );

  mountBillReady(app, deps, log);

  app.get("/api/orders/counter-waiting", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const waiting = await listCounterWaiting({ db: deps.db });
      return c.json(await visiblePickupOrders(deps, session, waiting));
    }),
  );

  app.post("/api/orders/:id/collect", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "hand-over-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const submissionId = body.submissionId === undefined ? undefined : submissionIdOf(body);
      await withTransaction(deps.db, async (tx) => {
        await checkKitchenOrderZone(tx, session, id);
        return handOverOrder(
          tx,
          cfg,
          id,
          submissionId,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
      });
      return c.body(null, 200);
    }),
  );

  // Re-enqueues through the same outbox a fire uses, so a broken printer cannot make it hang.
  app.post("/api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTransaction(deps.db, async (tx) => {
        await checkKitchenOrderZone(tx, session, id);
        await reprintOrderTickets(tx, cfg, id);
      });
      return c.body(null, 200);
    }),
  );
}
