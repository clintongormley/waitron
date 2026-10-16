import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  tenderRefunds,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { canUseDeviceProfile, type PinThrottle, type Override } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, centsToDecimal, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { asObject } from "./bill-payments-api.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { deviceBindingColumns, deviceProfileJoin, toDeviceBinding } from "./device-session.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { refundSettledTender, toTenderRefundView } from "./tender-refunds.js";
import {
  claimTenderRefund,
  resolveClaimedTenderRefund,
  tenderRefundIsLive,
} from "./tender-refund-sends.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import { overridePinAttempts, parseOverrideField, STATUS, type TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { assertSubjectZones } from "./zone-access.js";
import type { DeviceRequestConfig } from "./till-config.js";
import "./errors.js";

type Session = Awaited<ReturnType<typeof requireSession>>;
function pathId(value: string, kind: "sale" | "refund"): string {
  if (!isUuid(value))
    throw kind === "sale"
      ? new AppError("sale.not_found", { saleId: value })
      : new AppError("tender.refund_not_found", { refundId: value });
  return value.toLowerCase();
}

async function checkAccess(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  session: Session,
  saleId: string,
) {
  await assertStillSignedIn(tx, session);
  const [row] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(
      and(
        eq(devices.id, session.deviceId),
        eq(devices.locationId, cfg.locationId),
        isNull(deviceProfiles.retiredAt),
      ),
    );
  if (row === undefined) throw new AppError("device.unauthorized", {});
  const device = toDeviceBinding(session.deviceId, row);
  if (device.formFactor === "kds")
    throw new AppError("device.forbidden_action", { action: "refund" });
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  const scope = await resolveTransactionScope(tx, cfg, saleId);
  await assertSubjectZones(
    tx,
    cfg,
    device.deviceProfileId,
    scope.workingOrderIds.map((orderId) => ({ orderId })),
  );
}
async function readRefund(tx: Transaction, id: string) {
  const [row] = await tx.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
  if (row === undefined) throw new AppError("tender.refund_not_found", { refundId: id });
  return row;
}
function overrideOf(body: Record<string, unknown>): Override | undefined {
  if (body.override === null) throw invalid("override");
  return parseOverrideField(body.override);
}
function parseRequest(body: Record<string, unknown>): TenderRefundRequest {
  const strings = ["submissionId", "tenderId", "appliedAmount", "tipAmount", "reason"] as const;
  for (const field of strings) if (typeof body[field] !== "string") throw invalid(field);
  for (const field of ["cashConfirmed", "manualConfirmed"] as const)
    if (body[field] !== undefined && typeof body[field] !== "boolean") throw invalid(field);
  return {
    submissionId: body.submissionId as string,
    tenderId: body.tenderId as string,
    appliedAmount: body.appliedAmount as string,
    tipAmount: body.tipAmount as string,
    reason: body.reason as string,
    ...(body.cashConfirmed === undefined ? {} : { cashConfirmed: body.cashConfirmed as boolean }),
    ...(body.manualConfirmed === undefined
      ? {}
      : { manualConfirmed: body.manualConfirmed as boolean }),
    override: overrideOf(body),
  };
}

export function mountTenderRefundApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  const run = createErrorBoundary(
    {
      ...STATUS,
      "sale.not_found": 404,
      "tender.refund_not_found": 404,
      "submission.id_reused": 409,
      "tender.refund_in_progress": 409,
      "tender.refund_exceeds_payment": 409,
      "tender.refund_unavailable": 409,
    },
    "tender_refund.failed",
  );
  const commandDeps = {
    db: deps.db,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor: refundProvidersOf({ simulator: deps.cardProvider, pool: deps.pool }),
  };
  app.get("/api/transactions/:saleId/refundable-tenders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("saleId"), "sale");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkAccess(tx, cfg, session, id);
        return readRefundableTenders(tx, cfg, id);
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/refunds", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("saleId"), "sale");
      const req = parseRequest(asObject(await readRawJsonBody<unknown>(c)));
      return c.json(
        await refundSettledTender(commandDeps, cfg, id, req, {
          personId: session.personId,
          sessionId: session.sessionId,
          attempts: overridePinAttempts(pinThrottle, session.deviceId),
        }),
      );
    }),
  );
  app.get("/api/tender-refunds/:refundId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("refundId"), "refund");
      const result = await withTransaction(deps.db, async (tx) => {
        const row = await readRefund(tx, id);
        await checkAccess(tx, cfg, session, row.saleId);
        return toTenderRefundView(row);
      });
      return c.json(result);
    }),
  );
  app.post("/api/tender-refunds/:refundId/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("refundId"), "refund");
      const override = overrideOf(asObject(await readRawJsonBody<unknown>(c)));
      const row = await withTransaction(deps.db, async (tx) => {
        const found = await readRefund(tx, id);
        await checkAccess(tx, cfg, session, found.saleId);
        return found;
      });
      const req: TenderRefundRequest = {
        submissionId: row.submissionId,
        tenderId: row.tenderId,
        appliedAmount: centsToDecimal(row.appliedAmount),
        tipAmount: centsToDecimal(row.tipAmount),
        reason: row.reason,
        cashConfirmed: row.method === "cash",
        manualConfirmed: row.manual,
        override,
      };
      let release: (() => void) | undefined;
      try {
        const authorized = await withTenderRefundAuthorization(
          deps.db,
          cfg,
          row.saleId,
          req,
          {
            personId: session.personId,
            sessionId: session.sessionId,
            attempts: overridePinAttempts(pinThrottle, session.deviceId),
          },
          async (tx) => {
            const current = await readRefund(tx, id);
            if (
              current.state === "pending" &&
              current.method === "card" &&
              !current.manual &&
              !tenderRefundIsLive(deps.db, id)
            )
              release = claimTenderRefund(deps.db, id);
            return toTenderRefundView(current);
          },
        );
        if (release === undefined) return c.json(authorized);
        const held = release;
        release = undefined;
        return c.json(await resolveClaimedTenderRefund(commandDeps, id, "retry", held));
      } catch (error) {
        release?.();
        throw error;
      }
    }),
  );
}
