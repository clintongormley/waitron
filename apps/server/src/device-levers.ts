import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { readRawJsonBody } from "@waitron/server-kit";
import { withTransaction, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { ProfileAction } from "@waitron/layouts";
import { assertProfileAction, requireDevice, type DeviceBinding } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { asObject } from "./bill-payments-api.js";
import { groupCommand, requirePartyParam } from "./till-api.js";
import { isUuid } from "./till-session.js";
import { orderWatchZones, partyWatchZones } from "./watch-zones.js";
import { passReleaseRefusal } from "./pass-release.js";
import { bumpBillReady } from "./working-order.js";
import { bumpGroupReady } from "./order-groups.js";
import type { TradingContext } from "./trading-context.js";
import type { Logger } from "./logger.js";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;

/** Serves kitchen displays only: a till keeps its session routes and their zone gate. */
export async function requireKitchenDisplay(
  deps: { db: Database; devMode?: boolean },
  c: Context,
  action: ProfileAction,
): Promise<DeviceBinding> {
  const device = await requireDevice(deps, c);
  if (device.formFactor !== "kds") throw new AppError("device.unauthorized", {});
  assertProfileAction(device, action);
  return device;
}

async function orderZone(tx: Transaction, orderId: string): Promise<string | null> {
  const [order] = await tx
    .select({
      id: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId: orderId });
  }
  return (await orderWatchZones(tx, [order])).get(order.id) ?? null;
}

/** A kitchen display's Ready actions use its pass screen's zones. */
export function mountDeviceLevers(
  app: Hono,
  deps: { db: Database; cfg: TradingContext; devMode?: boolean },
  log: Logger,
  run: Run,
): void {
  app.post("/api/device/orders/:id/ready", (c) =>
    run(c, log, async () => {
      const device = await requireKitchenDisplay(deps, c, "prepare-orders");
      const refused = passReleaseRefusal(device);
      if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
      const orderId = c.req.param("id").toLowerCase();
      if (!isUuid(orderId))
        throw new AppError("working_order.not_found", { workingOrderId: orderId });
      await withTransaction(deps.db, async (tx) => {
        const zoneId = await orderZone(tx, orderId);
        await VENUE_SERVICE.assertPassScreenZone(tx, device.deviceId, zoneId);
        await bumpBillReady(tx, orderId, { deviceId: device.deviceId });
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/device/parties/:id/groups/:gid/ready", (c) =>
    run(c, log, async () => {
      const device = await requireKitchenDisplay(deps, c, "prepare-orders");
      const refused = passReleaseRefusal(device);
      if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(device.deviceId, body);
      const answer = await withTransaction(deps.db, async (tx) => {
        const zoneId = (await partyWatchZones(tx, [partyId])).get(partyId) ?? null;
        await VENUE_SERVICE.assertPassScreenZone(tx, device.deviceId, zoneId);
        return bumpGroupReady(tx, partyId, groupId, args, { deviceId: device.deviceId });
      });
      return c.json(answer);
    }),
  );
}
