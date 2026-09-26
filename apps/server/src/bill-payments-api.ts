import type { Context, Hono } from "hono";
import { kindOfFormFactor } from "@waitron/layouts";
import { AppError } from "@waitron/shared";
import { readRawJsonBody } from "@waitron/server-kit";
import {
  getBillBalance,
  previewBillPayment,
  SaleTillRequired,
  takeBillPayment,
} from "./bill-payments.js";
import type { BillPaymentAsk, BillPaymentRequest } from "./bill-payments.js";
import { requireSaleTillId, tryReadDevice } from "./device-session.js";
import type { Logger } from "./logger.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { isUuid, requireSession } from "./till-session.js";
import "./errors.js";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

function invalid(field: string): AppError {
  return new AppError("management.request_invalid", { field });
}

function moneyField(value: unknown, field: string): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw invalid(field);
  return value;
}

function optionalMoney(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : moneyField(value, field);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid(field);
  return value as T;
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid("body");
  return raw as Record<string, unknown>;
}

function parseLines(value: unknown): { lineNo: number; quantity?: string }[] {
  if (!Array.isArray(value)) throw invalid("lines");
  return value.map((entry: unknown) => {
    const line =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
    if (
      line === null ||
      typeof line.lineNo !== "number" ||
      !Number.isInteger(line.lineNo) ||
      line.lineNo < 1 ||
      (line.quantity !== undefined && typeof line.quantity !== "string")
    ) {
      throw invalid("lines");
    }
    return line.quantity === undefined
      ? { lineNo: line.lineNo }
      : { lineNo: line.lineNo, quantity: line.quantity as string };
  });
}

/** The ask a preview and a payment share, refused field by field as `management.request_invalid`. */
function parseAsk(body: Record<string, unknown>): BillPaymentAsk {
  const kind = oneOf(body.kind, ["items", "contribution", "share"] as const, "kind");
  const method = oneOf(body.method, ["cash", "card"] as const, "method");
  const ask: BillPaymentAsk = { kind, method };
  if (kind === "items") ask.lines = parseLines(body.lines);
  else if (body.lines !== undefined) throw invalid("lines");
  if (kind === "contribution") ask.amount = moneyField(body.amount, "amount");
  else if (body.amount !== undefined) throw invalid("amount");
  if (kind === "share") {
    if (typeof body.shareOf !== "number" || !Number.isInteger(body.shareOf) || body.shareOf < 1) {
      throw invalid("shareOf");
    }
    ask.shareOf = body.shareOf;
  } else if (body.shareOf !== undefined) throw invalid("shareOf");
  if (method === "cash") ask.tendered = moneyField(body.tendered, "tendered");
  else if (body.tendered !== undefined) throw invalid("tendered");
  const addedTip = optionalMoney(body.addedTip, "addedTip");
  if (addedTip !== undefined) ask.addedTip = addedTip;
  if (body.choice !== undefined) {
    ask.choice = oneOf(body.choice, ["full_with_tip", "use_pool"] as const, "choice");
  }
  return ask;
}

function parseRequest(body: Record<string, unknown>): BillPaymentRequest {
  if (
    typeof body.submissionId !== "string" ||
    body.submissionId.length === 0 ||
    body.submissionId.length > 200
  ) {
    throw invalid("submissionId");
  }
  const request: BillPaymentRequest = {
    ...parseAsk(body),
    submissionId: body.submissionId,
    applied: moneyField(body.applied, "applied"),
    tip: moneyField(body.tip, "tip"),
  };
  if (request.method === "card") {
    // A card on a reader is taken in three phases, which this route does not run yet.
    request.entry = oneOf(body.entry, ["manual"] as const, "entry");
    if (body.externalRef !== undefined) {
      if (typeof body.externalRef !== "string") throw invalid("externalRef");
      request.externalRef = body.externalRef;
    }
  } else if (body.entry !== undefined || body.externalRef !== undefined) {
    throw invalid(body.entry !== undefined ? "entry" : "externalRef");
  }
  return request;
}

function requireBillParam(id: string): string {
  if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
  return id;
}

/** A sale made during a device's request files on that device's own till. */
async function deviceSaleCfg(deps: TillApiDeps, c: Context): Promise<TillConfig> {
  const device = await tryReadDevice(deps, c);
  return {
    ...deps.cfg,
    tillId: await requireSaleTillId(deps, c, device),
    allowCashDrawer: device === null || kindOfFormFactor(device.formFactor) === "till",
  };
}

/**
 * Runs a line write that can leave a bill exactly paid, so that the invoice it issues is filed on
 * the requesting device's till. `write` runs first with no till, and again with the device's only
 * when an invoice is due: reading the device runs a scrypt verification, and opens a transaction
 * of its own, which the write queue refuses inside another (`packages/store/src/write-queue.ts`).
 */
export async function withSaleTillWhenIssuing<T>(
  deps: TillApiDeps,
  c: Context,
  write: (saleCfg: TillConfig | null) => Promise<T>,
): Promise<T> {
  try {
    return await write(null);
  } catch (error) {
    if (!(error instanceof SaleTillRequired)) throw error;
  }
  return write(await deviceSaleCfg(deps, c));
}

/**
 * The bill payment routes (bill payments design §3.6, §5.1, §7), behind the till session. A
 * payment is taken on the device's own till, which is the till its cash drawer and its invoice use.
 */
export function mountBillPaymentsApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock };

  app.get("/api/working-orders/:id/payments", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireBillParam(c.req.param("id"));
      return c.json(await getBillBalance(deps, id));
    }),
  );

  app.post("/api/working-orders/:id/payments/preview", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireBillParam(c.req.param("id"));
      const ask = parseAsk(asObject(await readRawJsonBody<unknown>(c)));
      return c.json(await previewBillPayment(fiscal, deps.cfg, id, ask));
    }),
  );

  app.post("/api/working-orders/:id/payments", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const id = requireBillParam(c.req.param("id"));
      const request = parseRequest(asObject(await readRawJsonBody<unknown>(c)));
      const saleCfg = await deviceSaleCfg(deps, c);
      return c.json(await takeBillPayment(fiscal, saleCfg, id, request, personId));
    }),
  );
}
