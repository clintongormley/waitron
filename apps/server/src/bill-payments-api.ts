import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { listActivePersonsWithPermission, type PinThrottle } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { readRawJsonBody } from "@waitron/server-kit";
import { invalid } from "./bill-allocation.js";
import {
  getBillBalance,
  previewBillPayment,
  takeBillPayment,
  takeReaderBillPayment,
} from "./bill-payments.js";
import type { BillPaymentAsk, BillPaymentRequest } from "./bill-payments.js";
import { refundBillPayment, refundProvidersOf, refundTender } from "./bill-refunds.js";
import type { BillRefundRequest } from "./bill-refunds.js";
import { assertTakesTender } from "./device-session.js";
import type { Logger } from "./logger.js";
import {
  overridePinAttempts,
  parseOverrideField,
  parseReason,
  resolveCardCollector,
} from "./till-api.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { sendingCfg } from "./made-here.js";
import { requestCfg } from "./request-config.js";
import { isUuid, requireSession } from "./till-session.js";
import "./errors.js";
import { gateZones } from "./zone-access.js";

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

function moneyField(value: unknown, field: string): string {
  if (typeof value !== "string" || !MONEY.test(value)) throw invalid(field);
  return value;
}

export function optionalMoney(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : moneyField(value, field);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid(field);
  return value as T;
}

export function asObject(raw: unknown): Record<string, unknown> {
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

export function submissionIdOf(body: Record<string, unknown>): string {
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
  const reason = parseReason(body.reason);
  const override = parseOverrideField(body.override);
  if (body.manualConfirmed !== undefined && typeof body.manualConfirmed !== "boolean") {
    throw invalid("manualConfirmed");
  }
  return {
    submissionId,
    appliedAmount,
    tipAmount,
    reason,
    ...(override === undefined ? {} : { override }),
    ...(body.manualConfirmed === undefined ? {} : { manualConfirmed: body.manualConfirmed }),
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

/**
 * The bill payment routes (bill payments design §3.6, §5.1, §6, §7), behind the till session. A
 * payment, and the invoice it completes, names the requesting device.
 */
export function mountBillPaymentsApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, log };

  app.get("/api/working-orders/:id/payments", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireBillParam(c.req.param("id"));
      await gateZones(deps, session, [{ orderId: id }]);
      return c.json(await getBillBalance(deps, id));
    }),
  );

  app.post("/api/working-orders/:id/payments/preview", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const id = requireBillParam(c.req.param("id"));
      await gateZones(deps, session, [{ orderId: id }]);
      const ask = parseAsk(asObject(await readRawJsonBody<unknown>(c)));
      return c.json(await previewBillPayment(fiscal, cfg, id, ask));
    }),
  );

  app.post("/api/working-orders/:id/payments", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { permission: "sale.take_payment" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireBillParam(c.req.param("id"));
      await gateZones(deps, session, [{ orderId: id }]);
      const body = asObject(await readRawJsonBody<unknown>(c));
      const request = parseRequest(body);
      if (request.entry !== "reader") {
        const saleCfg = sendingCfg(cfg, c, session.device);
        assertTakesTender(session.device, request.method === "cash" ? "cash" : "hand-keyed-card");
        return c.json(await takeBillPayment(fiscal, saleCfg, id, request, personId));
      }
      // The guards `/api/pay` runs before a reader is asked, in its order. A card outcome is data,
      // answered 200 even for a decline.
      const device = session.device;
      assertTakesTender(device, "reader-card");
      const readerId = parseReaderId(body);
      if (request.simulationOutcome !== undefined && deps.cardProvider?.provider !== "simulator") {
        throw invalid("simulationOutcome");
      }
      const saleCfg = sendingCfg(cfg, c, device);
      const { provider, reader } = await resolveCardCollector(deps, device.deviceId, readerId);
      return c.json(
        await takeReaderBillPayment(
          {
            ...fiscal,
            provider,
            ...(reader === undefined ? {} : { readerRef: reader.providerRef }),
            deviceProfileId: device.deviceProfileId,
          },
          saleCfg,
          id,
          request,
          personId,
        ),
      );
    }),
  );

  // Like the drawer's list: any operator may see who could approve their refund.
  app.get("/api/refund-authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await withTransaction(deps.db, (tx) => listActivePersonsWithPermission(tx, "sale.refund")),
      );
    }),
  );

  // The refund names the requesting device. Cash opens a drawer only where
  // `enqueueBillRefundDrawer` finds one this device may open; a connected card goes through its
  // provider, while a separately charged card needs staff confirmation and a manager PIN.
  app.post("/api/working-orders/:id/payments/:paymentId/refunds", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireBillParam(c.req.param("id"));
      await gateZones(deps, session, [{ orderId: id }]);
      const paymentId = c.req.param("paymentId");
      // The tender the payment was taken with, as a payment of it would need.
      const tender = await refundTender(deps.db, id, paymentId);
      assertTakesTender(session.device, tender);
      const refund = parseRefund(asObject(await readRawJsonBody<unknown>(c)));
      const saleCfg = sendingCfg(cfg, c, session.device);
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
          { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
          tender,
        ),
      );
    }),
  );
}
