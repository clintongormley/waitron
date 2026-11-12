import { and, eq, isNull, or } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  tenders,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  authorize,
  canUseDeviceProfile,
  roleHasPermission,
  verifyThrottledCredential,
  type Authorization,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";
import { MANUAL_PROVIDER, payments } from "@waitron/payments";
import { AppError, centsToDecimal } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import {
  assertTakesTender,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
  type TenderKind,
} from "./device-session.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { matchTenderRefundCapture } from "./tender-refund-capture.js";
import { assertStillSignedIn, canonicaliseUuid } from "./till-session.js";
import { assertSubjectZones } from "./zone-access.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import "./errors.js";

async function refundTenderKind(
  tx: Transaction,
  saleId: string,
  tenderId: string,
): Promise<TenderKind | undefined> {
  const id = canonicaliseUuid(tenderId);
  if (id === null) return undefined;
  const originals = await tx.select().from(tenders).where(eq(tenders.saleId, saleId));
  const tender = originals.find((row) => row.id === id);
  if (tender?.method === "cash") return "cash";
  if (tender?.method !== "card") return undefined;
  const captures = await tx
    .select()
    .from(payments)
    .where(
      or(
        eq(payments.saleId, saleId),
        tender.billPaymentId === null
          ? undefined
          : eq(payments.billPaymentId, tender.billPaymentId),
      ),
    );
  const capture = matchTenderRefundCapture(
    { ...tender, amount: centsToDecimal(tender.amount) },
    captures,
    originals.filter((row) => row.method === "card" && row.billPaymentId === null).length,
  );
  return capture === undefined
    ? undefined
    : capture.provider === MANUAL_PROVIDER
      ? "hand-keyed-card"
      : "reader-card";
}

// The body must call authorizeRefund before writing. PIN derivation runs ahead of the write lock;
// the session, device, zones and permission decision belong to the command's transaction.
export async function withTenderRefundAuthorization<T>(
  db: Database,
  cfg: DeviceRequestConfig,
  saleId: string,
  request: TenderRefundRequest,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  body: (
    tx: Transaction,
    authorizeRefund: (cancelledBy?: string) => Promise<Authorization>,
    checked: SecretCheck | undefined,
  ) => Promise<T>,
): Promise<T> {
  const confirmsManual =
    request.override !== undefined &&
    request.manualConfirmed === true &&
    (await refundTenderKind(db, saleId, request.tenderId)) === "hand-keyed-card";
  const toCheck = await overrideToCheck(
    db,
    { sessionId: operator.sessionId, permission: "sale.refund" },
    request.override,
    confirmsManual,
  );
  return withPinCheckAhead(db, toCheck, operator.attempts, (checked) =>
    withTransaction(db, async (tx) => {
      await assertStillSignedIn(tx, {
        deviceId: cfg.origin.deviceId,
        personId: operator.personId,
        sessionId: operator.sessionId,
      });
      const [row] = await tx
        .select(deviceBindingColumns)
        .from(devices)
        .innerJoin(deviceProfiles, deviceProfileJoin)
        .where(and(eq(devices.id, cfg.origin.deviceId), isNull(deviceProfiles.retiredAt)));
      if (row === undefined) throw new AppError("device.unauthorized", {});
      const device = toDeviceBinding(cfg.origin.deviceId, row);
      if (device.formFactor === "kds")
        throw new AppError("device.forbidden_action", { action: "refund" });
      if (!(await canUseDeviceProfile(tx, device.deviceProfileId, operator.personId)))
        throw new AppError("device_profile.not_admitted", {});
      const scope = await resolveTransactionScope(tx, saleId);
      await assertSubjectZones(
        tx,
        device.deviceProfileId,
        scope.workingOrderIds.map((orderId) => ({ orderId })),
      );
      const kind = await refundTenderKind(tx, saleId, request.tenderId);
      if (kind === undefined)
        throw new AppError("tender.refund_unavailable", { tenderId: request.tenderId });
      assertTakesTender(device, kind);
      const override = withCheck(request.override, checked);
      return body(
        tx,
        async (cancelledBy) => {
          let authorization: Authorization;
          try {
            authorization = await authorize(
              tx,
              { sessionId: operator.sessionId, permission: "sale.refund", override },
              operator.attempts,
            );
          } catch (error) {
            if (
              error instanceof AppError &&
              error.code === "authorization.not_permitted" &&
              request.override === undefined &&
              kind !== "hand-keyed-card" &&
              cancelledBy !== undefined
            )
              return {
                authorizedBy: cancelledBy,
                permission: "sale.refund",
                viaOverride: cancelledBy !== operator.personId,
              };
            throw error;
          }
          if (kind === "hand-keyed-card") {
            if (request.manualConfirmed !== true) throw invalid("manualConfirmed");
            if (!authorization.viaOverride) {
              if (override === undefined)
                throw new AppError("tender.manual_refund_pin_required", {
                  tenderId: request.tenderId,
                });
              const confirmer = await verifyThrottledCredential(
                tx,
                override.personId,
                override.pin,
                operator.attempts,
                override.checked,
              );
              if (!roleHasPermission(confirmer.role, "sale.refund"))
                throw new AppError("authorization.not_permitted", { permission: "sale.refund" });
              authorization = {
                ...authorization,
                authorizedBy: override.personId,
                viaOverride: true,
              };
            }
          }
          return authorization;
        },
        checked,
      );
    }),
  );
}
