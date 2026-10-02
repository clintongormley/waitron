import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isUuid } from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { currentBusinessDay } from "@waitron/reporting";
import { authorizeManager, resolveManagementSession, roleHasPermission } from "@waitron/identity";
import {
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
  UNFINISHED_FILTERS,
  listOrderStaff,
  listOrders,
  readOrderDetail,
  type OrderCursor,
  type OrderListFilter,
} from "./orders-list.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { reprintOrderReceipt } from "./orders-reprint.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "working_order.not_found": 404,
  "printer.not_found": 404,
  "sale.voided": 409,
};
const run = createErrorBoundary(STATUS, "report.failed");

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_(.+)$/;
const PAGE_SIZE = /^[1-9]\d{0,2}$/;
const TEXT_MAX = 100;

const invalid = (field: string) => new AppError("management.request_invalid", { field });

function optionalText(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > TEXT_MAX) throw invalid(field);
  return trimmed === "" ? undefined : trimmed;
}

function requireCursor(raw: string | undefined): OrderCursor | undefined {
  if (raw === undefined) return undefined;
  const match = CURSOR.exec(raw);
  if (match === null || !isUuid(match[2]!)) throw invalid("after");
  return { at: match[1]!, id: match[2]!.toLowerCase() };
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
  return {
    dates,
    filter: {
      status,
      credited: queryFlag(query("credited"), "credited"),
      staffId: staff?.toLowerCase(),
      table: optionalText(query("table"), "table"),
      search: optionalText(query("q"), "q"),
      limit: limit === undefined ? DEFAULT_ORDER_PAGE_SIZE : Number(limit),
      after: requireCursor(query("after")),
    },
  };
}

export interface OrdersApiDeps {
  db: Database;
  backend: FiscalBackend;
  cfg: { nodeId: string };
  till: TillConfig;
}

export function mountOrdersApi(app: Hono, deps: OrdersApiDeps, log: Logger): void {
  /** Every dashboard session may read orders, but only `report.view` permits finished bills. */
  const scoped = <T>(
    sessionId: string,
    fn: (tx: Transaction, scope: OrderListFilter["scope"]) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const { role } = await resolveManagementSession(tx, sessionId);
      return fn(tx, roleHasPermission(role, "report.view") ? "all" : "unfinished");
    });

  app.get("/management-api/orders", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { dates, filter } = parseOrdersQuery((name) => c.req.query(name));
      const answer = await scoped(sessionId, async (tx, scope) => {
        if (scope === "unfinished" && !UNFINISHED_FILTERS.includes(filter.status))
          throw invalid("status");
        let range: { from: string; to: string } | null = null;
        let window: OrderListFilter["dates"] = "any";
        if (dates !== "any") {
          const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
          const today = currentBusinessDay(clock);
          range = dates ?? { from: today, to: today };
          window = { ...range, ...clock };
        }
        const page = await listOrders(tx, { ...filter, dates: window, scope });
        return { ...page, range };
      });
      return c.json({
        rows: answer.rows,
        next: answer.next === null ? null : `${answer.next.at}_${answer.next.id}`,
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

  app.get("/management-api/orders/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      return c.json(await scoped(sessionId, (tx, scope) => readOrderDetail(tx, id, scope)));
    }),
  );

  app.post("/management-api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id").toLowerCase();
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const body = await readJsonBody<Record<string, unknown>>(c);
      const printerId = requireBodyUuid(body.printerId, "printerId");
      const queued = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "print.resend",
        });
        return reprintOrderReceipt(tx, deps, id, printerId, authorizedBy);
      });
      return c.json(queued, 202);
    }),
  );
}
