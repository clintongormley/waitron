import { withIssuanceTransaction } from "@waitron/core";
import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { authorize, canUseDeviceProfile } from "@waitron/identity";
import { profileAllows } from "@waitron/layouts";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { parseBillEditExpected, parseBillEditExpecteds } from "./bill-editing.js";
import { asObject, optionalMoney } from "./bill-payments-api.js";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
  type DeviceBinding,
} from "./device-session.js";
import type { InvoiceRecipient } from "./invoice-selection.js";
import type { Logger } from "./logger.js";
import { sendingCfg } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import type { BillInvoiceDelivery } from "./parties.js";
import { requestCfg } from "./request-config.js";
import { requireRevision, type Run, type TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { closeBillByTransferTx, readTransferClosure } from "./transfer-close.js";
import type { CloseByTransferRequest } from "./transfer-close-types.js";
import { checkZones, inScope, readZoneScope } from "./zone-access.js";
import "./errors.js";

type Session = Awaited<ReturnType<typeof requireSession>>;
type Body = Omit<CloseByTransferRequest, "id">;

const FIELDS: readonly (keyof Body)[] = [
  "submissionId",
  "expectedRevision",
  "expectedEdit",
  "expectedTotal",
  "invoiceType",
  "recipient",
  "receiptLanguage",
  "delivery",
  "partyFinish",
];

function onlyFields(value: Record<string, unknown>, fields: readonly string[], prefix = ""): void {
  const stray = Object.keys(value).find((key) => !fields.includes(key));
  if (stray !== undefined) throw invalid(`${prefix}${stray}`);
}

function uuidField(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(field);
  return value as Record<string, unknown>;
}

function parseDelivery(value: unknown): BillInvoiceDelivery | null {
  if (value === null) return null;
  const delivery = object(value, "delivery");
  if (delivery.medium === "receipt") {
    onlyFields(delivery, ["medium"], "delivery.");
    return { medium: "receipt" };
  }
  if (delivery.medium === "a4") {
    onlyFields(delivery, ["medium", "pagePrinterId"], "delivery.");
    return {
      medium: "a4",
      pagePrinterId: uuidField(delivery.pagePrinterId, "delivery.pagePrinterId"),
    };
  }
  if (delivery.medium === "email") {
    onlyFields(delivery, ["medium", "recipient"], "delivery.");
    if (typeof delivery.recipient !== "string") throw invalid("delivery.recipient");
    return { medium: "email", recipient: delivery.recipient };
  }
  throw invalid("delivery.medium");
}

function parsePartyFinish(value: unknown): CloseByTransferRequest["partyFinish"] {
  if (value === null) return null;
  const finish = object(value, "partyFinish");
  onlyFields(finish, ["partyId", "expectedPartyRevision", "expectedEdits"], "partyFinish.");
  return {
    partyId: uuidField(finish.partyId, "partyFinish.partyId"),
    expectedPartyRevision: requireRevision(finish.expectedPartyRevision, "expectedPartyRevision"),
    expectedEdits: parseBillEditExpecteds(finish.expectedEdits),
  };
}

/** Every field is required; `null` stands only where the request type allows it. */
function parseClose(id: string, body: Record<string, unknown>): CloseByTransferRequest {
  onlyFields(body, FIELDS);
  const expectedTotal = optionalMoney(body.expectedTotal, "expectedTotal");
  if (expectedTotal === undefined) throw invalid("expectedTotal");
  if (body.invoiceType !== "F1" && body.invoiceType !== "F2") throw invalid("invoiceType");
  if (body.recipient !== null) object(body.recipient, "recipient");
  if (typeof body.receiptLanguage !== "string" || body.receiptLanguage === "")
    throw invalid("receiptLanguage");
  for (const field of ["expectedEdit", "delivery", "partyFinish"] as const)
    if (body[field] === undefined) throw invalid(field);
  return {
    id,
    submissionId: uuidField(body.submissionId, "submissionId"),
    expectedRevision: requireRevision(body.expectedRevision, "expectedRevision"),
    expectedEdit: body.expectedEdit === null ? null : parseBillEditExpected(body.expectedEdit),
    expectedTotal,
    invoiceType: body.invoiceType,
    recipient: body.recipient as InvoiceRecipient | null,
    receiptLanguage: body.receiptLanguage,
    delivery: parseDelivery(body.delivery),
    partyFinish: parsePartyFinish(body.partyFinish),
  };
}

/**
 * Run inside the write, because access may be withdrawn while the request waits in the queue: the
 * session, the active device on an unretired profile allowing the action, the person's admission to
 * that profile and `payment.take`, and the bill's zone.
 */
async function stillAllowed(tx: Transaction, session: Session, billId: string) {
  await assertStillSignedIn(tx, session);
  const [row] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(and(eq(devices.id, session.deviceId), isNull(deviceProfiles.retiredAt)));
  if (row === undefined) throw new AppError("device.unauthorized", {});
  const device = toDeviceBinding(session.deviceId, row);
  assertProfileAction(device, "close-by-transfer");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  await authorize(tx, { sessionId: session.sessionId, permission: "payment.take" });
  await checkZones(tx, { device }, [{ orderId: billId }]);
  return device;
}

/** A party is released only by a device that takes orders, in scope over every order it holds. */
function partyReleaseFor(device: DeviceBinding) {
  return async (tx: Transaction, orderIds: readonly string[]) => {
    if (!profileAllows(device, "take-orders")) return "authority" as const;
    const scope = await readZoneScope(tx, device.deviceProfileId);
    const zones = await VENUE_SERVICE.findOrderZones(tx, orderIds);
    return orderIds.every((id) => inScope(scope, zones.get(id)))
      ? ("allowed" as const)
      : ("scope" as const);
  };
}

/** Close one bill, final in Waitron, as a deferred payment. */
export function mountTransferCloseApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.post("/api/working-orders/:id/close-by-transfer", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, {
        permission: "payment.take",
        action: "close-by-transfer",
      });
      const rawId = c.req.param("id");
      if (!isUuid(rawId)) throw new AppError("working_order.not_open", { workingOrderId: rawId });
      const id = rawId.toLowerCase();
      const request = parseClose(id, asObject(await readRawJsonBody<unknown>(c)));
      // Awaited only while `since()` names a refusal: otherwise the close enters the write queue in
      // this turn.
      const diskBlockedBeforeQueue =
        deps.disk !== undefined && deps.disk.since() !== null && (await deps.disk.full());
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          const device = await stillAllowed(tx, session, id);
          return closeBillByTransferTx(
            tx,
            {
              db: deps.db,
              backend: deps.backend,
              clock: deps.clock,
              admission: deps.admission,
              log,
              attendance: deps.attendance,
              disk: deps.disk,
              diskBlockedBeforeQueue,
              admitPartyRelease: partyReleaseFor(device),
            },
            sendingCfg(requestCfg(deps.cfg, device), c, device),
            request,
            session.personId,
          );
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.get("/api/working-orders/:id/transfer-closure", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("working_order.not_found", { workingOrderId: id });
      const closure = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const found = await readTransferClosure(tx, id);
        if (found !== null) return found;
        const [bill] = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (bill === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return null;
      });
      return c.json({ closure });
    }),
  );
}
