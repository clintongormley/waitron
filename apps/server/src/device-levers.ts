import "./errors.js";
import type { Context, Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { readRawJsonBody, readJsonBody } from "@waitron/server-kit";
import { withTransaction, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { ProfileAction } from "@waitron/layouts";
import type { AllergyCommand } from "@waitron/module";
import {
  assertDeviceStillProven,
  assertProfileAction,
  requireDevice,
  type DeviceBinding,
} from "./device-session.js";
import { requestCfg } from "./request-config.js";
import { VENUE_SERVICE } from "./modules.js";
import { asObject } from "./bill-payments-api.js";
import { allergyCommand, groupCommand, requirePartyParam } from "./till-api.js";
import { isUuid } from "./till-session.js";
import { orderWatchZones, partyWatchZones } from "./watch-zones.js";
import {
  bumpCourseReady,
  fireCourse,
  markCourseAway,
  type OrderAttendance,
} from "./working-order.js";
import {
  bumpGroupReady,
  fireGroup,
  markGroupAway,
  type Firer,
  type PartyCommandArgs,
} from "./order-groups.js";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;

interface Lever {
  verb: "fire" | "ready" | "away";
  action: ProfileAction;
  course: (
    tx: Transaction,
    cfg: DeviceRequestConfig,
    orderId: string,
    courseId: string,
    firer: Firer,
    attendance?: OrderAttendance,
    command?: AllergyCommand,
  ) => Promise<void>;
  group: (
    tx: Transaction,
    cfg: DeviceRequestConfig,
    partyId: string,
    groupId: string,
    args: PartyCommandArgs,
    firer: Firer,
  ) => Promise<{ revision: number }>;
}

/** Only Fire records who acted; Ready and Away take the firer and ignore it. */
const LEVERS: readonly Lever[] = [
  {
    verb: "fire",
    action: "take-orders",
    course: fireCourse,
    group: fireGroup,
  },
  { verb: "ready", action: "prepare-orders", course: bumpCourseReady, group: bumpGroupReady },
  { verb: "away", action: "hand-over-orders", course: markCourseAway, group: markGroupAway },
];

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

async function recheckKitchenFire(
  tx: Transaction,
  cfg: TillConfig,
  device: DeviceBinding,
): Promise<DeviceBinding> {
  const current = await assertDeviceStillProven(tx, { device, tokenHash: null });
  if (current.formFactor !== "kds" || current.locationId !== cfg.locationId)
    throw new AppError("device.unauthorized", {});
  assertProfileAction(current, "take-orders");
  return current;
}

async function orderZone(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<string | null> {
  const [order] = await tx
    .select({
      id: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
    })
    .from(workingOrders)
    .where(and(eq(workingOrders.id, orderId), eq(workingOrders.locationId, cfg.locationId)));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId: orderId });
  }
  return (await orderWatchZones(tx, cfg, [order])).get(order.id) ?? null;
}

/** A kitchen display's Fire, Ready and Away, checked against its pass screen's zones. */
export function mountDeviceLevers(
  app: Hono,
  deps: { db: Database; cfg: TillConfig; devMode?: boolean },
  log: Logger,
  run: Run,
): void {
  for (const lever of LEVERS) {
    app.post(`/api/device/orders/:id/courses/:courseId/${lever.verb}`, (c) =>
      run(c, log, async () => {
        const device = await requireKitchenDisplay(deps, c, lever.action);
        const cfg = requestCfg(deps.cfg, device);
        const orderId = c.req.param("id").toLowerCase();
        if (!isUuid(orderId)) {
          throw new AppError("working_order.not_found", { workingOrderId: orderId });
        }
        const courseId = c.req.param("courseId");
        if (!isUuid(courseId)) throw new AppError("course.not_found", { courseId });
        let command: AllergyCommand | undefined;
        if (lever.verb === "fire") {
          const body = asObject(await readJsonBody<unknown>(c));
          if (body.allergy !== undefined)
            throw new AppError("allergy.invalid", { field: "allergy" });
          command = allergyCommand(body);
        }
        await withTransaction(deps.db, async (tx) => {
          const current =
            lever.verb === "fire" ? await recheckKitchenFire(tx, deps.cfg, device) : device;
          const zoneId = await orderZone(tx, deps.cfg, orderId);
          await VENUE_SERVICE.assertPassScreenZone(tx, deps.cfg, current.deviceId, zoneId);
          await lever.course(
            tx,
            lever.verb === "fire" ? requestCfg(deps.cfg, current) : cfg,
            orderId,
            courseId,
            { deviceId: current.deviceId },
            undefined,
            command,
          );
        });
        return c.body(null, 200);
      }),
    );

    app.post(`/api/device/parties/:id/groups/:gid/${lever.verb}`, (c) =>
      run(c, log, async () => {
        const device = await requireKitchenDisplay(deps, c, lever.action);
        const cfg = requestCfg(deps.cfg, device);
        const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
        const groupId = c.req.param("gid");
        if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
        const body = asObject(await readRawJsonBody<unknown>(c));
        // The device's id stands where a person's would: a retry from it replays, and its
        // submission id from anyone else is refused as reused.
        if (lever.verb === "fire" && body.allergy !== undefined)
          throw new AppError("allergy.invalid", { field: "allergy" });
        const args = groupCommand(device.deviceId, body);
        const answer = await withTransaction(deps.db, async (tx) => {
          const current =
            lever.verb === "fire" ? await recheckKitchenFire(tx, deps.cfg, device) : device;
          const zoneId = (await partyWatchZones(tx, deps.cfg, [partyId])).get(partyId) ?? null;
          await VENUE_SERVICE.assertPassScreenZone(tx, deps.cfg, current.deviceId, zoneId);
          return lever.group(
            tx,
            lever.verb === "fire" ? requestCfg(deps.cfg, current) : cfg,
            partyId,
            groupId,
            args,
            { deviceId: current.deviceId },
          );
        });
        return c.json(answer);
      }),
    );
  }
}
