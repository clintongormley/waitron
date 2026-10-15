import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, asc, eq } from "drizzle-orm";
import { AppError, isUuid, isValidEmail } from "@waitron/shared";
import {
  printers,
  receiptReprints,
  sales,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { currentBusinessDay } from "@waitron/reporting";
import { authorizeManager, resolveManagementSession, roleHasPermission } from "@waitron/identity";
import {
  codeOf,
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireEnum,
  requireManagementSession,
  requireRange,
} from "@waitron/server-kit";
import { queryFlag, resolveVenueClock } from "./report-api.js";
import {
  DEFAULT_ORDER_PAGE_SIZE,
  MAX_ORDER_PAGE_SIZE,
  ORDER_STATUS_FILTERS,
  listOrderStaff,
  isNumberSearch,
  listOrders,
  optionalSearch,
  orderInvoicePrinters,
  readOrderDetail,
  type OrderCursor,
  type OrderListFilter,
} from "./orders-list.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { reprintOrderReceipt } from "./orders-reprint.js";
import { readInvoiceForDownload } from "./orders-invoice-pdf.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { assertDeviceCapability } from "./device-session.js";
import { expireInvoiceDeliveryClaims } from "./invoice-delivery.js";
import {
  requestPrintDelivery,
  requestEmailDelivery,
  retryEmailDelivery,
} from "./invoice-delivery-actions.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "device.forbidden_action": 403,
  "management.request_invalid": 400,
  "working_order.not_found": 404,
  "printer.not_found": 404,
  "invoice_delivery.full_invoice_required": 409,
  "invoice_delivery.active": 409,
  "invoice_delivery.printer_invalid": 409,
  "invoice_delivery.email_unavailable": 409,
  "invoice_delivery.not_found": 404,
  "submission.id_reused": 409,
};
const run = createErrorBoundary(STATUS, "orders.failed");

const CURSOR = /^(?:(\d{1,16})_)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_(.+)$/;
const PAGE_SIZE = /^[1-9]\d{0,2}$/;
const TEXT_MAX = 100;

const invalid = (field: string) => new AppError("management.request_invalid", { field });

function optionalText(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > TEXT_MAX) throw invalid(field);
  return trimmed === "" ? undefined : trimmed;
}

/** A ranked cursor belongs to a word search, and a word search takes only a ranked cursor. */
function requireCursor(
  raw: string | undefined,
  search: string | undefined,
): OrderCursor | undefined {
  if (raw === undefined) return undefined;
  const match = CURSOR.exec(raw);
  if (match === null || !isUuid(match[3]!)) throw invalid("after");
  const words = search !== undefined && !isNumberSearch(search);
  if (words !== (match[1] !== undefined)) throw invalid("after");
  const cursor = { at: match[2]!, id: match[3]!.toLowerCase() };
  return words ? { rank: Number(match[1]), ...cursor } : cursor;
}

/** Each refusal names the query field, so the screen can show it under that control. */
export function parseOrdersQuery(query: (name: string) => string | undefined): {
  dates: "any" | { from: string; to: string } | undefined;
  // `scope` comes from the session, never from the request.
  filter: Omit<OrderListFilter, "dates" | "scope">;
} {
  const status = requireEnum(query("status") ?? "all", "status", ORDER_STATUS_FILTERS);
  const from = query("from");
  const to = query("to");
  const anyDate = queryFlag(query("anyDate"), "anyDate");
  if (anyDate && (from !== undefined || to !== undefined)) throw invalid("anyDate");
  const dates = anyDate
    ? "any"
    : from === undefined && to === undefined
      ? undefined
      : requireRange(from, to);
  const staff = query("staff");
  if (staff !== undefined && !isUuid(staff)) throw invalid("staff");
  const limit = query("limit");
  if (limit !== undefined && (!PAGE_SIZE.test(limit) || Number(limit) > MAX_ORDER_PAGE_SIZE))
    throw invalid("limit");
  const search = optionalSearch(query("q"));
  return {
    dates,
    filter: {
      status,
      credited: queryFlag(query("credited"), "credited"),
      staffId: staff?.toLowerCase(),
      table: optionalText(query("table"), "table"),
      search,
      limit: limit === undefined ? DEFAULT_ORDER_PAGE_SIZE : Number(limit),
      after: requireCursor(query("after"), search),
    },
  };
}

export interface OrdersApiDeps {
  db: Database;
  backend: FiscalBackend;
  cfg: { nodeId: string };
  till: TillConfig;
  devMode?: boolean;
  /** Whether a mail transport is set up to email invoices. */
  invoiceEmailAvailable: () => Promise<boolean>;
}

export function mountOrdersApi(app: Hono, deps: OrdersApiDeps, log: Logger): void {
  const orderScope = (
    role: Parameters<typeof roleHasPermission>[0],
    clock: Awaited<ReturnType<typeof resolveVenueClock>>,
  ): OrderListFilter["scope"] => {
    const today = currentBusinessDay(clock);
    return roleHasPermission(role, "report.view")
      ? "all"
      : { today: { from: today, to: today, ...clock } };
  };

  /** The session's person; without `report.view`, only once their Orders list shows the order. */
  const visibleOrderPerson = async (
    tx: Transaction,
    sessionId: string,
    id: string,
  ): Promise<string> => {
    const { personId, role } = await resolveManagementSession(tx, sessionId);
    if (!roleHasPermission(role, "report.view")) {
      const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
      const { rows } = await listOrders(tx, {
        status: "all",
        dates: "any",
        credited: false,
        limit: 1,
        only: id,
        scope: orderScope(role, clock),
      });
      if (rows.length === 0) throw new AppError("working_order.not_found", { workingOrderId: id });
    }
    return personId;
  };

  /** For a read: a failed check reads as no mail. */
  const readEmailTransport = (): Promise<boolean> =>
    deps.invoiceEmailAvailable().catch((error: unknown) => {
      log("warn", "invoice_delivery.email_check_failed", { errorCode: codeOf(error) });
      return false;
    });

  /** The sale filed for bill `id`, once the session's person holds `report.export`. */
  const exportableSale = async (
    tx: Transaction,
    sessionId: string,
    id: string,
  ): Promise<{ saleId: string; personId: string }> => {
    const { authorizedBy } = await authorizeManager(tx, {
      managementSessionId: sessionId,
      permission: "report.export",
    });
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, id));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
    return { saleId: sale.id, personId: authorizedBy };
  };

  /** Finished bills outside today's business day require `report.view`. */
  const scoped = <T>(
    sessionId: string,
    fn: (
      tx: Transaction,
      scope: OrderListFilter["scope"],
      clock: Awaited<ReturnType<typeof resolveVenueClock>>,
    ) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const { role } = await resolveManagementSession(tx, sessionId);
      const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
      return fn(tx, orderScope(role, clock), clock);
    });

  app.get("/management-api/orders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { dates, filter } = parseOrdersQuery((name) => c.req.query(name));
      const answer = await scoped(sessionId, async (tx, scope, clock) => {
        let range: { from: string; to: string } | null = null;
        let window: OrderListFilter["dates"] = "any";
        if (dates !== "any") {
          const today = currentBusinessDay(clock);
          range = dates ?? { from: today, to: today };
          window = { ...range, ...clock };
        }
        const page = await listOrders(tx, { ...filter, dates: window, scope });
        return { ...page, range };
      });
      return c.json({
        rows: answer.rows,
        next:
          answer.next === null
            ? null
            : `${answer.next.rank === undefined ? "" : `${answer.next.rank}_`}${answer.next.at}_${answer.next.id}`,
        from: answer.range?.from ?? null,
        to: answer.range?.to ?? null,
      });
    }),
  );

  // Registered before `/:id`, which would otherwise take "staff" as an id.
  app.get("/management-api/orders/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json({ staff: await scoped(sessionId, (tx) => listOrderStaff(tx)) });
    }),
  );

  app.get("/management-api/orders/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await scoped(sessionId, (tx) =>
        tx
          .select({ id: printers.id, name: printers.name })
          .from(printers)
          .where(and(eq(printers.locationId, deps.till.locationId), eq(printers.active, true)))
          .orderBy(asc(printers.name), asc(printers.id)),
      );
      return c.json(rows);
    }),
  );

  app.get("/management-api/orders/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const transport = await readEmailTransport();
      return c.json(
        await scoped(sessionId, async (tx, scope) => {
          await expireInvoiceDeliveryClaims(tx);
          return readOrderDetail(tx, id, scope, transport);
        }),
      );
    }),
  );

  app.post("/management-api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const body = await readJsonBody<Record<string, unknown>>(c);
      const printerId = requireBodyUuid(body.printerId, "printerId");
      await assertDeviceCapability(deps, c, "print-receipt", "reprint");
      const queued = await withTransaction(deps.db, async (tx) => {
        const personId = await visibleOrderPerson(tx, sessionId, id);
        return reprintOrderReceipt(tx, deps, id, printerId, personId);
      });
      return c.json(queued, 202);
    }),
  );

  app.post("/management-api/orders/:id/invoice-deliveries", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (body.medium !== "print" && body.medium !== "email") throw invalid("medium");
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      if (body.medium === "email") {
        if (typeof body.recipient !== "string" || !isValidEmail(body.recipient))
          throw invalid("recipient");
        const recipient = body.recipient.trim();
        const transport = await deps.invoiceEmailAvailable();
        const attempt = await withTransaction(deps.db, async (tx) => {
          const { saleId, personId } = await exportableSale(tx, sessionId, id);
          return requestEmailDelivery(tx, saleId, { requestKey, personId, recipient, transport });
        });
        return c.json(attempt);
      }
      const printerId = requireBodyUuid(body.printerId, "printerId");
      await assertDeviceCapability(deps, c, "print-receipt", "invoice_delivery");
      const attempt = await withTransaction(deps.db, async (tx) => {
        const personId = await visibleOrderPerson(tx, sessionId, id);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return requestPrintDelivery(
          tx,
          {
            backend: deps.backend,
            cfg: deps.till,
            onReceiptCopy: async (copy) => {
              await tx.insert(receiptReprints).values({ ...copy, personId });
            },
          },
          { id: sale.id, workingOrderId: id },
          orderInvoicePrinters(tx),
          { requestKey, personId, printerId },
        );
      });
      return c.json(attempt);
    }),
  );

  app.post("/management-api/orders/:id/invoice-deliveries/:deliveryId/retry", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const body = await readJsonBody<Record<string, unknown>>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const transport = await deps.invoiceEmailAvailable();
      const attempt = await withTransaction(deps.db, async (tx) => {
        const { saleId, personId } = await exportableSale(tx, sessionId, id);
        return retryEmailDelivery(tx, saleId, c.req.param("deliveryId"), {
          requestKey,
          personId,
          transport,
        });
      });
      return c.json(attempt);
    }),
  );

  app.post("/management-api/orders/:id/invoice-pdf", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const { document, fileName } = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "report.export",
        });
        return readInvoiceForDownload(tx, deps, id, authorizedBy);
      });
      const bytes = await renderInvoicePdf(document);
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      });
    }),
  );
}
