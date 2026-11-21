import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { isUuid } from "@waitron/shared";
import type { Logger } from "./logger.js";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const VALID = /^[A-Za-z0-9._-]{1,64}$/;

/** A client-supplied id is accepted only if it is safe to embed in a structured log verbatim —
 * bounded length and a strict charset, so a hostile value cannot inject a newline and forge a line. */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return VALID.test(raw) ? raw : null;
}

// Recovery displays the log without a sign-in. Only these templates may carry concrete IDs.
const ID_ROUTES = new Set([
  "/api/orders/:id/ready",
  "/api/orders/:id/collect",
  "/api/orders/:id/reprint",
  "/api/working-orders/:id",
  "/api/working-orders/:id/cancel",
  "/api/working-orders/:id/collect",
  "/api/working-orders/:id/place",
  "/api/working-orders/:id/payment-slip",
  "/api/working-orders/:id/payments",
  "/api/working-orders/:id/payments/preview",
  "/api/working-orders/:id/payments/:paymentId/refunds",
  "/api/sales/:id",
  "/api/sales/:id/receipt",
  "/api/sales/:id/receipt/handover",
  "/api/sales/:id/receipt/retry",
  "/api/sales/:id/reprint",
  "/api/sales/:id/deliveries",
  "/api/sales/:id/deliveries/:deliveryId/retry",
  "/api/sales/:id/deliveries/:deliveryId/to-receipt",
  "/api/transactions/:saleId/receipt",
  "/api/transactions/:saleId/receipt-print",
  "/api/transactions/:saleId/receipt-print/handover",
  "/api/transactions/:saleId/receipt-print/retry",
  "/api/transactions/:saleId/reprint",
  "/api/transactions/:saleId/deliveries",
  "/api/transactions/:saleId/deliveries/:deliveryId/to-receipt",
  "/management-api/orders/:id",
  "/management-api/orders/:id/reprint",
  "/management-api/orders/:id/invoice-deliveries",
  "/management-api/orders/:id/invoice-deliveries/:deliveryId/retry",
  "/management-api/orders/:id/invoice-pdf",
]);

function loggedPath(c: Context, template: string): string {
  const path = ID_ROUTES.has(template)
    ? template.replace(/:(id|saleId|deliveryId)(?=\/|$)/g, (placeholder, name: string) => {
        const id = c.req.param(name);
        return id?.length === 36 && isUuid(id) ? id : placeholder;
      })
    : template;
  // A query key can also carry a secret, so keep only the indicator.
  return c.req.url.includes("?") ? `${path}?***` : path;
}

export function requestIdMiddleware(log: Logger, now: () => Date): MiddlewareHandler {
  return async (c, next) => {
    const id = sanitizeRequestId(c.req.header("x-request-id")) ?? randomUUID();
    c.set("requestId", id);
    const start = now().getTime();
    await next();
    c.header("x-request-id", id);
    const routePath = c.req.routePath;
    // The viewer polls both routes and would otherwise fill the tail it reads.
    if (
      c.res.ok &&
      c.req.method === "GET" &&
      c.req.header("x-waitron-live") === "1" &&
      (routePath === "/management-api/diagnostics/recent" ||
        routePath === "/management-api/diagnostics/verbosity")
    ) {
      return;
    }
    const errorCode = c.get("refusalCode");
    const level = errorCode === undefined ? "debug" : c.res.status >= 500 ? "error" : "warn";
    log(level, "http.request", {
      requestId: id,
      method: c.req.method,
      routePath: loggedPath(c, routePath),
      status: c.res.status,
      durationMs: now().getTime() - start,
      errorCode,
    });
  };
}
