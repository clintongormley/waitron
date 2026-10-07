import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorize, canUseDeviceProfile, persons } from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import type { Logger } from "./logger.js";
import { requireRevision, type Run, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value))
    throw new AppError("management.request_invalid", { field });
  return value.toLowerCase();
}

async function actor(
  tx: Transaction,
  deps: TillApiDeps,
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  await authorize(tx, { sessionId: session.sessionId, permission: "sale.take_payment" });
  const [person] = await tx
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, session.personId));
  if (person?.status !== "active")
    throw new AppError("person.suspended", { personId: session.personId });
  const device = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  const scope = await VENUE_SERVICE.readProfileZones(tx, deps.cfg, device.deviceProfileId);
  if (scope.departmentId === null) throw new AppError("department_transfer.not_allowed", {});
  return {
    departmentId: scope.departmentId,
    personId: session.personId,
    profileId: device.deviceProfileId,
    device,
  };
}

export function mountDepartmentTransferApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
): void {
  app.post("/api/working-orders/:id/department-transfers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const tabId = uuid(c.req.param("id"), "tabId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      const destinationId = uuid(body.destinationDepartmentId, "destinationDepartmentId");
      const result = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        await checkZones(tx, deps.cfg, sender, [{ orderId: tabId }]);
        return VENUE_SERVICE.requestDepartmentTransfer(tx, deps.cfg, tabId, destinationId, sender);
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/withdraw", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const result = await withTransaction(deps.db, async (tx) => {
        const sender = await actor(tx, deps, session);
        const request = await VENUE_SERVICE.readDepartmentTransfer(tx, deps.cfg, requestId, sender);
        await checkZones(tx, deps.cfg, sender, [{ orderId: request.tabId }]);
        return VENUE_SERVICE.withdrawDepartmentTransfer(tx, deps.cfg, requestId, sender);
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/accept", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      const tabRevision = requireRevision(body.revision);
      const zoneId = uuid(body.zoneId, "zoneId");
      const tableId =
        body.tableId === undefined || body.tableId === null ? null : uuid(body.tableId, "tableId");
      const result = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        await checkZones(tx, deps.cfg, receiver, [{ zoneId }]);
        return VENUE_SERVICE.acceptDepartmentTransfer(tx, deps.cfg, requestId, receiver, {
          tabRevision,
          zoneId,
          tableId,
        });
      });
      return c.json(result);
    }),
  );
  app.post("/api/department-transfers/:id/decline", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const requestId = uuid(c.req.param("id"), "requestId");
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (typeof body.reason !== "string" || !body.reason.trim())
        throw new AppError("department_transfer.reason_required", {});
      const reason = body.reason;
      const result = await withTransaction(deps.db, async (tx) => {
        const receiver = await actor(tx, deps, session);
        return VENUE_SERVICE.declineDepartmentTransfer(tx, deps.cfg, requestId, receiver, reason);
      });
      return c.json(result);
    }),
  );
}
