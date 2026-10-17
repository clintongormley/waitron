import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  ticketState,
  workingOrders,
  workingOrderLines,
  workingOrderStatus,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { canUseDeviceProfile, type PinThrottle } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { readRawJsonBody, requireBodyUuid } from "@waitron/server-kit";
import { approverToCheck } from "./adjustments-api.js";
import { invalid } from "./bill-allocation.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import { asObject, submissionIdOf } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { readCancellationContext, type CancellationContext } from "./line-cancel-context.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import type { Logger } from "./logger.js";
import { madeHereSinkFor, replayPrepayMadeHere, sendingCfg } from "./made-here.js";
import { partyRevision } from "./parties.js";
import { withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import {
  overridePinAttempts,
  parseDrawerOverride,
  requireRevision,
  type Run,
  type TillApiDeps,
} from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

async function admittedSession(
  tx: Transaction,
  deps: TillApiDeps,
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  await assertStillSignedIn(tx, session);
  const device = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  if (device.locationId !== deps.cfg.locationId) throw new AppError("device.unauthorized", {});
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  return { ...session, device };
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw invalid(field);
  return value as T;
}

function parseContext(raw: unknown): CancellationContext {
  const field = "expectedContext";
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid(field);
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.components) || value.components.length === 0) throw invalid(field);
  const quantity = (value: unknown, nullable = false) => {
    if (nullable && value === null) return null;
    if (typeof value !== "string" || !/^\d{1,12}\.\d{3}$/.test(value)) throw invalid(field);
    return value;
  };
  const components = value.components.map((raw: unknown) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid(field);
    const item = raw as Record<string, unknown>;
    if (
      item.firedAt !== null &&
      (typeof item.firedAt !== "string" || !Number.isFinite(Date.parse(item.firedAt)))
    )
      throw invalid(field);
    return {
      id: item.id === null ? null : requireBodyUuid(item.id, field).toLowerCase(),
      lineId: requireBodyUuid(item.lineId, field).toLowerCase(),
      state: item.state === null ? null : oneOf(item.state, ticketState.enumValues, field),
      firedAt: item.firedAt as string | null,
      quantity: quantity(item.quantity)!,
      kitchenQuantity: quantity(item.kitchenQuantity, true),
      servedQuantity: quantity(item.servedQuantity)!,
      cancelledQuantity: quantity(item.cancelledQuantity)!,
    };
  });
  return {
    billStatus: oneOf(value.billStatus, workingOrderStatus.enumValues, field),
    stage: oneOf(value.stage, ["not_started", "started"], field),
    components,
  };
}

function parseAsk(body: Record<string, unknown>): CancelItemAsk {
  const outcome = oneOf(body.outcome, ["remove_charge", "keep_charge"], "outcome");
  if (typeof body.quantity !== "string") throw invalid("quantity");
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500))
    throw invalid("note");
  if (
    body.approver !== undefined &&
    (body.approver === null || typeof body.approver !== "object" || Array.isArray(body.approver))
  )
    throw invalid("approver");
  const approver = parseDrawerOverride(
    body.approver as { personId?: unknown; pin?: unknown } | undefined,
  );
  const reasonId =
    body.reasonId === undefined
      ? undefined
      : requireBodyUuid(body.reasonId, "reasonId").toLowerCase();
  if (outcome === "remove_charge" && reasonId === undefined) throw invalid("reasonId");
  return {
    quantity: body.quantity,
    outcome,
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    expectedBillRevision: requireRevision(body.expectedBillRevision, "expectedBillRevision"),
    expectedContext: parseContext(body.expectedContext),
    submissionId: submissionIdOf(body),
    reasonId,
    note: body.note as string | undefined,
    approver:
      approver === undefined
        ? undefined
        : { ...approver, personId: approver.personId.toLowerCase() },
  };
}

export function mountLineCancelApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, log };
  app.get("/api/parties/:id/lines/:lineId/cancellation", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders", passive: true });
      const partyId = requireBodyUuid(c.req.param("id"), "partyId").toLowerCase();
      const lineId = requireBodyUuid(c.req.param("lineId"), "lineId").toLowerCase();
      const answer = await withTransaction(deps.db, async (tx) => {
        const current = await admittedSession(tx, deps, session);
        await checkZones(tx, deps.cfg, current, [{ partyId }]);
        const context = await readCancellationContext(tx, partyId, lineId);
        const [bill] = await tx
          .select({ id: workingOrders.id, revision: workingOrders.revision })
          .from(workingOrderLines)
          .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
          .where(eq(workingOrderLines.id, lineId));
        return {
          context,
          revision: await partyRevision(tx, partyId),
          billRevision: bill!.revision,
          billId: bill!.id,
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/lines/:lineId/cancel-item", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requireBodyUuid(c.req.param("id"), "partyId").toLowerCase();
      const lineId = requireBodyUuid(c.req.param("lineId"), "lineId").toLowerCase();
      const ask = parseAsk(asObject(await readRawJsonBody<unknown>(c)));
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const [line] = await deps.db
        .select({ billId: workingOrderLines.workingOrderId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lineId));
      const toCheck =
        ask.outcome !== "remove_charge" || line === undefined
          ? undefined
          : await approverToCheck(
              deps.db,
              {
                orderId: line.billId,
                expectedRevision: ask.expectedBillRevision,
                lineId,
                reasonId: ask.reasonId!,
                action: "cancel",
                quantity: ask.quantity,
                note: ask.note ?? null,
                operatorId: session.personId,
              },
              ask.approver,
              deps.venueLocale,
            );
      const answer = await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          const current = await admittedSession(tx, deps, session);
          const cfg = sendingCfg(requestCfg(deps.cfg, current), c, current.device);
          await checkZones(tx, deps.cfg, current, [{ partyId }]);
          const applied = await cancelItem(
            tx,
            cfg,
            partyId,
            lineId,
            { ...ask, approver: withCheck(ask.approver, checked) },
            session.personId,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
            {
              venueLocale: deps.venueLocale,
              attempts,
              completeAdjustment: async (billId) => {
                await issueIfFullyPaid(tx, fiscal, cfg, billId, session.personId);
                await replayPrepayMadeHere(tx, { madeHereSink: madeHereSinkFor(c) }, billId);
              },
            },
          );
          return applied;
        }),
      );
      return c.json(answer);
    }),
  );
}
