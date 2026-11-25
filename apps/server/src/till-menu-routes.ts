import { withTransaction, workingOrders, workingOrderLines, ticketItems, newId } from "@waitron/db";
import { updateProduct, setOptionLabelAvailability } from "@waitron/menu";
import { requireUuidParam, readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { invalid } from "./bill-allocation.js";
import type { CounterPaymentBasket } from "./bill-payments.js";
import { findDeadEnds, availableStations } from "./dead-ends.js";
import { assertProfileAction } from "./device-session.js";
import { currentZoneDevice } from "./device-zones.js";
import { VENUE_SERVICE } from "./modules.js";
import { requestCfg } from "./request-config.js";
import { named, newOrderZoneIn } from "./till-order-zones.js";
import { run, runAvailability, runBodyCourse } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { readTillSetup, setupRevisionOf, completeTillSetup } from "./till-setup.js";
import { paysAfterSending } from "./working-order-context.js";
import { unsentDishLines } from "./working-order-kitchen-fire.js";
import { priceOrderLines } from "./working-order-pricing.js";
import { checkZones } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillMenuRoutes(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.get("/api/default-service-zone/offers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const device = await currentZoneDevice(tx, session);
        const selection = await VENUE_SERVICE.readDeviceZoneSelection(tx, device.deviceId);
        const counters = selection.zones.filter(
          (zone) =>
            zone.serviceMode !== "table_tab" &&
            (device.formFactor !== "till" || selection.selectedZoneIds.includes(zone.id)),
        );
        let context: Awaited<ReturnType<typeof VENUE_SERVICE.resolveZoneContext>>;
        if (device.formFactor === "till") {
          const zoneId =
            counters.find((zone) => zone.id === selection.startingZoneId)?.id ?? counters[0]?.id;
          if (zoneId === undefined)
            throw new AppError("device_profile.no_service_zone", {
              profileId: device.deviceProfileId,
            });
          context = await VENUE_SERVICE.resolveZoneContext(tx, zoneId);
        } else {
          context = await VENUE_SERVICE.resolveNewOrderZone(tx, {
            profileId: device.deviceProfileId,
          });
        }
        const policy = await VENUE_SERVICE.resolveSalePolicy(tx, context.zoneId);
        const takeawayVat = await VENUE_SERVICE.venueChargesTakeawayVat(tx);
        return {
          context: { ...context, dining: VENUE_SERVICE.diningStartOf(policy, takeawayVat) },
          zones: (await VENUE_SERVICE.listServiceZones(tx)).filter((zone) =>
            counters.some((counter) => counter.id === zone.id),
          ),
          ...(await VENUE_SERVICE.listZoneOffers(tx, context.zoneId)),
        };
      });
      return c.json(result);
    }),
  );

  // The offers available in one service zone. The zone decides both the visible menus and the
  // payment flow; the menu-item id in each offer is the selling identity and may price the same
  // product differently from another zone's menu.
  app.get("/api/service-zones/:zoneId/offers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ zoneId }]);
        const context = await VENUE_SERVICE.resolveZoneContext(tx, zoneId);
        const policy = await VENUE_SERVICE.resolveSalePolicy(tx, zoneId);
        const takeawayVat = await VENUE_SERVICE.venueChargesTakeawayVat(tx);
        return {
          context: { ...context, dining: VENUE_SERVICE.diningStartOf(policy, takeawayVat) },
          ...(await VENUE_SERVICE.listZoneOffers(tx, zoneId)),
        };
      });
      return c.json(result);
    }),
  );

  app.put("/api/service-zones/:zoneId/products/:productId/availability", (c) =>
    runAvailability(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const productId = requireUuidParam(c.req.param("productId"), "ProductId");
      const body = await readJsonBody<{ available: unknown }>(c);
      if (typeof body.available !== "boolean")
        throw new AppError("product.invalid", { field: "available" });
      const available = body.available;
      await withTransaction(deps.db, async (tx) => {
        const device = await currentZoneDevice(tx, session);
        assertProfileAction(device, "take-orders");
        await checkZones(tx, { device }, [{ zoneId }]);
        const { offers, setMenus } = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
          withDefault: false,
        });
        const listed = [...offers, ...setMenus.flatMap((menu) => menu.offers)];
        if (
          !listed.some(
            (offer) =>
              offer.productId === productId ||
              offer.variants.some((variant) => variant.id === productId) ||
              offer.offeredModifiers.some(
                (modifier) =>
                  modifier.kind === "extras" &&
                  modifier.items.some((item) => item.productId === productId),
              ),
          )
        )
          throw new AppError("product.not_found", { productId });
        await updateProduct(tx, productId, { available });
      });
      return c.json({ available });
    }),
  );

  app.put("/api/service-zones/:zoneId/options/:listId/labels/:labelId/availability", (c) =>
    runAvailability(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const optionListId = requireUuidParam(c.req.param("listId"), "OptionListId");
      const labelId = requireUuidParam(c.req.param("labelId"), "OptionLabelId");
      const body = await readJsonBody<{ available: unknown }>(c);
      if (typeof body.available !== "boolean")
        throw new AppError("options.invalid", { field: "available" });
      const available = body.available;
      await withTransaction(deps.db, async (tx) => {
        const device = await currentZoneDevice(tx, session);
        assertProfileAction(device, "take-orders");
        await checkZones(tx, { device }, [{ zoneId }]);
        const { offers, setMenus } = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
          withDefault: false,
        });
        const listed = [...offers, ...setMenus.flatMap((menu) => menu.offers)];
        if (
          !listed.some((offer) =>
            offer.offeredModifiers.some(
              (modifier) =>
                modifier.kind === "options" &&
                modifier.id === optionListId &&
                modifier.labels.some((label) => label.id === labelId),
            ),
          )
        )
          throw new AppError("options.not_found", { optionListId });
        await setOptionLabelAvailability(tx, optionListId, labelId, available);
      });
      return c.json({ available });
    }),
  );

  app.get("/api/menu-state", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { device } = session;
      const asked = c.req.query("zoneId");
      const zoneId = asked === undefined ? undefined : requireUuidParam(asked, "ServiceZoneId");
      const { state, setupRead } = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        if (zoneId !== undefined) await checkZones(tx, session, [{ zoneId }]);
        const zone =
          zoneId === undefined
            ? (
                await VENUE_SERVICE.resolveNewOrderZone(tx, {
                  profileId: device.deviceProfileId,
                })
              ).zoneId
            : (await VENUE_SERVICE.resolveZoneContext(tx, zoneId)).zoneId;
        const at = new Date();
        const menuState = await VENUE_SERVICE.menuState(tx, zone, at);
        const defaultMenuId = await VENUE_SERVICE.resolveDefaultMenu(
          tx,
          zone,
          at,
          menuState.menus.map((menu) => menu.menuId),
        );
        const setupRead = await readTillSetup(tx, deps, device);
        const dining = VENUE_SERVICE.diningStartOf(
          await VENUE_SERVICE.resolveSalePolicy(tx, zone),
          setupRead.setup.takeawayVat,
        );
        return { state: { ...menuState, defaultMenuId, dining }, setupRead };
      });
      return c.json({
        ...state,
        setupRevision: setupRevisionOf(
          completeTillSetup(setupRead, deps.cloudEmergency?.() ?? null),
        ),
      });
    }),
  );

  app.post("/api/dead-ends/sale", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{
        step: "pay" | "place" | "edit";
        lines: (CounterPaymentBasket["lines"][number] & { workingOrderLineId?: string })[];
        zoneId?: string;
        workingOrderId?: string;
      }>(c);
      if (!Array.isArray(body.lines) || !["pay", "place", "edit"].includes(body.step))
        throw invalid("lines");
      if (body.workingOrderId !== undefined)
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      if (body.zoneId !== undefined) requireUuidParam(body.zoneId, "ServiceZoneId");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(
          tx,
          session,
          named(
            body.zoneId !== undefined && { zoneId: body.zoneId },
            body.workingOrderId !== undefined && { orderId: body.workingOrderId },
          ),
        );
        const at = new Date();
        const order =
          body.workingOrderId === undefined
            ? undefined
            : (
                await tx
                  .select({
                    id: workingOrders.id,
                    partyId: workingOrders.partyId,
                    status: workingOrders.status,
                  })
                  .from(workingOrders)
                  .where(eq(workingOrders.id, body.workingOrderId))
              )[0];
        const context =
          order === undefined ? null : await VENUE_SERVICE.findOrderContext(tx, order.id);
        const zoneId =
          order === undefined
            ? await newOrderZoneIn(tx, session, body.lines.length, body.zoneId)
            : context?.zoneId;
        const mode =
          context?.serviceMode ??
          (zoneId === undefined
            ? "prepay"
            : (await VENUE_SERVICE.resolveZoneContext(tx, zoneId)).serviceMode);
        const unsentCount =
          order === undefined ? body.lines.length : (await unsentDishLines(tx, order.id)).length;
        const sends =
          body.step === "pay"
            ? unsentCount > 0 &&
              (mode === "prepay" ||
                (order?.partyId !== null && order?.partyId !== undefined
                  ? false
                  : paysAfterSending(mode)))
            : body.step === "place"
              ? unsentCount > 0
              : body.lines.length > 0;
        const alreadySent = new Set<string>();
        if (order !== undefined) {
          const rows = await tx
            .select({
              id: workingOrderLines.id,
              sentAt: workingOrderLines.sentAt,
              ticketId: ticketItems.id,
            })
            .from(workingOrderLines)
            .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
            .where(eq(workingOrderLines.workingOrderId, order.id));
          for (const row of rows)
            if (row.sentAt !== null || row.ticketId !== null) alreadySent.add(row.id);
        }
        const active = body.lines.flatMap((line, index) =>
          line.workingOrderLineId !== undefined && alreadySent.has(line.workingOrderLineId)
            ? []
            : [{ line, key: String(index) }],
        );
        const priced =
          sends && active.length > 0
            ? await priceOrderLines(
                tx,
                cfg,
                body.workingOrderId ?? newId(),
                active.map(({ line }) => line),
                zoneId ?? undefined,
                undefined,
                "ignore",
                "none",
              )
            : null;
        const parents = priced?.lineRows.filter((line) => line.parentLineId === null) ?? [];
        return {
          sends,
          deadEnds: sends
            ? await findDeadEnds(
                tx,
                zoneId ?? null,
                active.map(({ line, key }, index) => ({
                  key,
                  productId: parents[index]!.productId!,
                  quantity: line.quantity,
                  makeAt: line.makeAt ?? null,
                })),
                at,
              )
            : [],
          stations: await availableStations(tx, at),
        };
      });
      return c.json(answer);
    }),
  );
}
