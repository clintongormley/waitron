import type { Context, Hono } from "hono";
import { kindOfFormFactor } from "@waitron/layouts";
import { AppError } from "@waitron/shared";
import { readRawJsonBody } from "@waitron/server-kit";
import { invalid } from "./bill-allocation.js";
import {
  getBillBalance,
  previewBillPayment,
  SaleTillRequired,
  takeBillPayment,
  takeReaderBillPayment,
} from "./bill-payments.js";
import type { BillPaymentAsk, BillPaymentRequest } from "./bill-payments.js";
import { refundBillPayment, refundProvidersOf } from "./bill-refunds.js";
import type { BillRefundRequest } from "./bill-refunds.js";
import { assertDeviceCapability, requireSaleTillId, tryReadDevice } from "./device-session.js";
import type { DeviceBinding } from "./device-session.js";
import type { Logger } from "./logger.js";
import { parseDrawerOverride, resolveCardCollector } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { isUuid, requireSession } from "./till-session.js";
import "./errors.js";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

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

function submissionIdOf(body: Record<string, unknown>): string {
  if (
    typeof body.submissionId !== "string" ||
    body.submissionId.length === 0 ||
    body.submissionId.length > 200
  ) {
    throw invalid("submissionId");
  }
  return body.submissionId;
}

function parseRequest(body: Record<string, unknown>): BillPaymentRequest {
  const request: BillPaymentRequest = {
    ...parseAsk(body),
    submissionId: submissionIdOf(body),
    applied: moneyField(body.applied, "applied"),
    tip: moneyField(body.tip, "tip"),
  };
  const readerOnly = ["readerId", "allowOffline", "simulationOutcome"] as const;
  if (request.method === "card") {
    request.entry = oneOf(body.entry, ["manual", "reader"] as const, "entry");
  } else if (body.entry !== undefined) {
    throw invalid("entry");
  }
  if (request.entry === "manual") {
    if (body.externalRef !== undefined) {
      if (typeof body.externalRef !== "string") throw invalid("externalRef");
      request.externalRef = body.externalRef;
    }
  } else if (body.externalRef !== undefined) {
    throw invalid("externalRef");
  }
  if (request.entry === "reader") {
    // Design §11.9: a bill payment is never accepted offline until the Tap to Pay work enables it.
    if (body.allowOffline !== undefined && body.allowOffline !== false) {
      throw invalid("allowOffline");
    }
    if (body.simulationOutcome !== undefined) {
      request.simulationOutcome = oneOf(
        body.simulationOutcome,
        ["captured", "declined"] as const,
        "simulationOutcome",
      );
    }
  } else {
    const stray = readerOnly.find((field) => body[field] !== undefined);
    if (stray !== undefined) throw invalid(stray);
  }
  return request;
}

function parseRefund(body: Record<string, unknown>): BillRefundRequest {
  const submissionId = submissionIdOf(body);
  const appliedAmount = moneyField(body.appliedAmount, "appliedAmount");
  const tipAmount = moneyField(body.tipAmount, "tipAmount");
  if (!/[1-9]/.test(appliedAmount) && !/[1-9]/.test(tipAmount)) throw invalid("appliedAmount");
  if (
    typeof body.reason !== "string" ||
    body.reason.trim().length === 0 ||
    body.reason.length > 500
  ) {
    throw invalid("reason");
  }
  if (
    body.override !== undefined &&
    body.override !== null &&
    (typeof body.override !== "object" || Array.isArray(body.override))
  ) {
    throw invalid("override");
  }
  const override = parseDrawerOverride(
    body.override as { personId?: unknown; pin?: unknown } | null | undefined,
  );
  return {
    submissionId,
    appliedAmount,
    tipAmount,
    reason: body.reason.trim(),
    ...(override === undefined ? {} : { override }),
  };
}

/** The reader a card is charged on: the one the body names, else the device's own. */
function parseReaderId(body: Record<string, unknown>): string | undefined {
  if (body.readerId === undefined) return undefined;
  if (typeof body.readerId !== "string" || !isUuid(body.readerId)) throw invalid("readerId");
  return body.readerId;
}

function requireBillParam(id: string): string {
  if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
  return id;
}

/** A sale made during a device's request files on that device's own till. */
async function deviceSaleCfg(deps: TillApiDeps, c: Context): Promise<TillConfig> {
  return deviceSaleCfgOf(deps, c, await tryReadDevice(deps, c));
}

async function deviceSaleCfgOf(
  deps: TillApiDeps,
  c: Context,
  device: DeviceBinding | null,
): Promise<TillConfig> {
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
 * The bill payment routes (bill payments design §3.6, §5.1, §6, §7), behind the till session. A
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
      const body = asObject(await readRawJsonBody<unknown>(c));
      const request = parseRequest(body);
      if (request.entry !== "reader") {
        const saleCfg = await deviceSaleCfg(deps, c);
        return c.json(await takeBillPayment(fiscal, saleCfg, id, request, personId));
      }
      // The guards `/api/pay` runs before a reader is asked, in its order. A card outcome is data,
      // answered 200 even for a decline.
      const device = await tryReadDevice(deps, c);
      await assertDeviceCapability(deps, c, "integrated-card-payment", "pay", device);
      const readerId = parseReaderId(body);
      if (request.simulationOutcome !== undefined && deps.cardProvider?.provider !== "simulator") {
        throw invalid("simulationOutcome");
      }
      const saleCfg = await deviceSaleCfgOf(deps, c, device);
      const { provider, reader } = await resolveCardCollector(deps, device?.deviceId, readerId);
      return c.json(
        await takeReaderBillPayment(
          {
            ...fiscal,
            provider,
            ...(reader === undefined ? {} : { readerRef: reader.providerRef }),
          },
          saleCfg,
          id,
          request,
          personId,
        ),
      );
    }),
  );

  // The refund is recorded on the device's own till, whose drawer gives the cash back. A card
  // refund goes back through the provider its payment was charged by.
  app.post("/api/working-orders/:id/payments/:paymentId/refunds", (c) =>
    run(c, log, async () => {
      const { personId, sessionId } = await requireSession(deps, c);
      const id = requireBillParam(c.req.param("id"));
      const paymentId = c.req.param("paymentId");
      const refund = parseRefund(asObject(await readRawJsonBody<unknown>(c)));
      const saleCfg = await deviceSaleCfg(deps, c);
      return c.json(
        await refundBillPayment(
          {
            ...fiscal,
            refundProviderFor: refundProvidersOf({
              simulator: deps.cardProvider,
              pool: deps.pool,
            }),
          },
          saleCfg,
          id,
          paymentId,
          refund,
          { personId, sessionId },
        ),
      );
    }),
  );
}
