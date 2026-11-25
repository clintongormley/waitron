import type { RecipientIdentifierType } from "@waitron/country-packs";
import { type Transaction, withTransaction, workingOrders } from "@waitron/db";
import type { PinThrottle } from "@waitron/identity";
import {
  readJsonBody,
  requireUuidParam,
  requireBodyUuid,
  requireString,
} from "@waitron/server-kit";
import { type ExtraSelection, type OptionSelection, AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { canEmailInvoice } from "./invoice-email-contact.js";
import { parseLateSend, withLateSendCheck } from "./late-send.js";
import { sendingCfg } from "./made-here.js";
import { requireDining, switchOrderDining } from "./order-dining.js";
import type { BillEditExpected } from "./order-drafts.js";
import { resolveInvoicePrinter } from "./receipt-print.js";
import { requestCfg } from "./request-config.js";
import { SET_MENU_DRAFT_LINE } from "./set-menu-bill.js";
import { resolveHttpOrderZone, named } from "./till-order-zones.js";
import { requireUuidId, requireRevision } from "./till-request-fields.js";
import { runBodyCourse, run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { placeOrder } from "./working-order-counter.js";
import { listHeldOrders, getHeldOrder, getPlacedCounterOrder } from "./working-order-held-read.js";
import {
  updateHeldOrder,
  setWorkingOrderLabel,
  abandonHeldOrder,
} from "./working-order-held-write.js";
import { setOrderInvoiceChoice, setOrderReceiptLanguage } from "./working-order-invoice.js";
import { parkOrder } from "./working-order-open.js";
import type { LineExtras } from "./working-order-pricing.js";
import { gateZones, visibleOrders, checkZones } from "./zone-access.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillWorkingOrderRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
  fiscal: TillSaleDeps,
  readEmailTransport: (tx: Transaction) => Promise<boolean>,
): void {
  // Idempotent on the client-minted `body.id`: a re-sent park collides on the primary key and
  // replays the existing open order's `{ id, orderNumber }`.
  app.post("/api/working-orders", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{
        id: string;
        lines: ({
          menuItemId: string;
          quantity: string;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
        } & LineExtras)[];
        zoneId?: string;
        label?: string;
        kitchenNote?: string | null;
        lateSend?: unknown;
        dining?: unknown;
      }>(c);
      // The client mints `body.id`, which becomes the stored primary key; this screen is the only
      // refusal of a malformed one.
      requireUuidParam(body.id, "WorkingOrderId");
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const lateSend = parseLateSend(body.lateSend);
      const dining = requireDining(body.dining);
      const zoneId = await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId);
      await gateZones(
        deps,
        session,
        named(zoneId !== undefined && { zoneId }, { orderId: body.id }),
      );
      const result = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        parkOrder(
          { db: deps.db },
          cfg,
          {
            id: body.id,
            lines: body.lines,
            zoneId,
            label: body.label,
            kitchenNote: body.kitchenNote,
            operatorId: personId,
            lateSend: late,
            dining,
          },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        ),
      );
      return c.json(result);
    }),
  );

  app.get("/api/working-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const orders = await listHeldOrders({ db: deps.db });
      return c.json(await visibleOrders(deps, session, orders));
    }),
  );

  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const order = await getHeldOrder({ db: deps.db }, id);
      return c.json(order);
    }),
  );

  app.get("/api/working-orders/:id/placed", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      return c.json(await getPlacedCounterOrder({ db: deps.db }, id));
    }),
  );

  app.put("/api/working-orders/:id", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        lines: ({
          menuItemId: string;
          quantity: string;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
          setMenuId?: unknown;
          setMenuReservedLineId?: unknown;
          setMenuReservedPlace?: unknown;
        } & LineExtras)[];
        label?: string;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
        lateSend?: unknown;
        dining?: unknown;
      }>(c);
      const expected = requireRevision(body.revision);
      const lines = body.lines.map((line, position) => {
        const { setMenuId, setMenuReservedLineId, setMenuReservedPlace, ...dish } = line;
        if (
          setMenuId === undefined &&
          setMenuReservedLineId === undefined &&
          setMenuReservedPlace === undefined
        )
          return dish;
        const field = (name: string) => `lines[${position}].${name}`;
        const menuId = requireBodyUuid(setMenuId, field("setMenuId")).toLowerCase();
        const menuVersionId = requireBodyUuid(
          dish.menuVersionId,
          field("menuVersionId"),
        ).toLowerCase();
        if (typeof dish.quantity !== "string" || !/^1(?:\.0{1,3})?$/.test(dish.quantity))
          throw new AppError("management.request_invalid", { field: field("quantity") });
        const place = setMenuReservedPlace;
        let reserved = null;
        if (setMenuReservedLineId !== undefined || place !== undefined) {
          const setMenuLineId = requireBodyUuid(
            setMenuReservedLineId,
            field("setMenuReservedLineId"),
          ).toLowerCase();
          if (typeof place !== "number" || !Number.isSafeInteger(place) || place < 0)
            throw new AppError("management.request_invalid", {
              field: field("setMenuReservedPlace"),
            });
          reserved = { setMenuLineId, place };
        }
        return {
          ...dish,
          menuVersionId,
          [SET_MENU_DRAFT_LINE]: {
            setMenuId: menuId,
            position,
            held: false,
            reserved,
          },
        };
      });
      const lateSend = parseLateSend(body.lateSend);
      const dining = requireDining(body.dining);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const saved = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        updateHeldOrder(
          { db: deps.db, admission: deps.admission },
          sendCfg,
          id,
          {
            lines,
            label: body.label,
            revision: expected,
            operatorId: personId,
            expectedEdit: body.expectedEdit,
            lateSend: late,
            dining,
          },
          { fiscal, saleCfg: sendCfg },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        ),
      );
      return c.json(saved);
    }),
  );

  app.put("/api/working-orders/:id/label", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        label?: unknown;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const revision = await setWorkingOrderLabel(
        deps.db,
        id,
        {
          label: requireString(body.label, "label"),
          revision: requireRevision(body.revision),
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  app.put("/api/working-orders/:id/dining", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        dining?: unknown;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const dining = requireDining(body.dining);
      const revision = await withTransaction(deps.db, (tx) =>
        switchOrderDining(
          tx,
          id,
          dining,
          requireRevision(body.revision),
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        ),
      );
      return c.json({ revision });
    }),
  );

  app.put("/api/working-orders/:id/invoice-choice", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        revision?: unknown;
        invoiceType: "F1" | "F2";
        expectedEdit: BillEditExpected | null;
        delivery?: unknown;
        recipient: {
          identifierType?: RecipientIdentifierType;
          identifierCountryCode?: string;
          taxId: string;
          legalName: string;
          address: string;
          countryCode: string;
        } | null;
      }>(c);
      const delivery = body.delivery;
      const emailAvailable =
        delivery !== null &&
        typeof delivery === "object" &&
        "medium" in delivery &&
        delivery.medium === "email"
          ? (await withTransaction(deps.db, async (tx) => deps.invoiceEmailAvailable?.(tx))) ===
            true
          : false;
      const revision = await setOrderInvoiceChoice(
        deps.db,
        deps.backend,
        cfg,
        id,
        {
          revision: requireRevision(body.revision),
          invoiceType: body.invoiceType,
          recipient: body.recipient,
          delivery,
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        { personId: session.personId, emailAvailable },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  app.get("/api/invoice-delivery-options", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const orderId = requireUuidId(
        requireString(c.req.query("orderId"), "orderId"),
        "working_order.not_found",
      );
      const asked = c.req.query("zoneId");
      const zoneId = asked === undefined ? undefined : requireUuidParam(asked, "ServiceZoneId");
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const [saved] = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(eq(workingOrders.id, orderId));
        // The till sends its service zone even for a saved bill; a saved bill's own zone is checked
        // through orderId.
        await checkZones(
          tx,
          session,
          named({ orderId }, saved === undefined && zoneId !== undefined && { zoneId }),
        );
        const printer = await resolveInvoicePrinter(tx, requestCfg(deps.cfg, session).origin);
        const transport = await readEmailTransport(tx);
        const emailAvailable = await canEmailInvoice(
          tx,
          saved === undefined
            ? { kind: "new-order", zoneId, profileId: session.device.deviceProfileId }
            : { kind: "order", orderId },
          transport,
        );
        return {
          // Only an A4 invoice printer is offered at payment; a receipt one is reached from the sale.
          invoicePrinter: printer?.kind === "a4" ? { id: printer.id, name: printer.name } : null,
          emailAvailable,
          emailNeedsReceiptContact: transport && !emailAvailable,
        };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/working-orders/:id/receipt-language", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        revision?: unknown;
        language?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const revision = await setOrderReceiptLanguage(
        deps.db,
        id,
        {
          revision: requireRevision(body.revision),
          language: body.language,
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ expectedEdit: BillEditExpected | null }>(c);
      await abandonHeldOrder(
        { db: deps.db },
        cfg,
        id,
        { operatorId: session.personId, expectedEdit: body.expectedEdit },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/place", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        expectedEdit: BillEditExpected | null;
        lateSend?: unknown;
      }>(c);
      const lateSend = parseLateSend(body.lateSend);
      const result = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        placeOrder(
          {
            db: deps.db,
            backend: deps.backend,
            admission: deps.admission,
            clock: deps.clock,
            log,
            attendance: deps.attendance,
          },
          sendingCfg(cfg, c, session.device),
          id,
          personId,
          body.expectedEdit,
          late,
        ),
      );
      return c.json(result);
    }),
  );
}
