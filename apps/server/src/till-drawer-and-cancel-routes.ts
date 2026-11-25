import { type Database, withTransaction } from "@waitron/db";
import { type PinThrottle, listActivePersonsWithPermission, authorize } from "@waitron/identity";
import { readJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { assertDeviceCapability } from "./device-session.js";
import { overrideToCheck, withPinCheckAhead, withCheck } from "./pin-check-ahead.js";
import { resolveDrawerPrinter, enqueueManualDrawerOpen } from "./receipt-print.js";
import { requestCfg } from "./request-config.js";
import { splitAfterPrint } from "./split-after-print.js";
import {
  parseDrawerOverride,
  overridePinAttempts,
  requireUuidId,
  parseOverrideField,
} from "./till-request-fields.js";
import { run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession, assertRequestDevice, canonicaliseUuid } from "./till-session.js";
import { cancelPlacedOrder } from "./working-order-counter.js";
import { gateZones } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

async function drawerOverrideToCheck(
  db: Database,
  sessionId: string,
  body: { override?: { personId?: unknown; pin?: unknown } },
): Promise<{ personId: string; pin: string } | undefined> {
  let override;
  try {
    override = parseDrawerOverride(body.override);
  } catch {
    return undefined;
  }
  return overrideToCheck(db, { sessionId, permission: "cash.drawer" }, override);
}

export function mountTillDrawerAndCancelRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  // Session-gated, not permission-gated: any operator may list who could authorize an override.
  app.get("/api/drawer/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const authorizers = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        return listActivePersonsWithPermission(tx, "cash.drawer");
      });
      return c.json(authorizers);
    }),
  );

  app.post("/api/drawer/open", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const device = session.device;
      await assertDeviceCapability(deps, c, "open-cash-drawer", "drawer_open", device);
      await assertRequestDevice(deps, c, session);
      const body = await readJsonBody<{
        override?: { personId?: unknown; pin?: unknown };
        expectedPrinterId?: unknown;
      }>(c);
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await drawerOverrideToCheck(deps.db, sessionId, body);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          const { authorizedBy, viaOverride } = await authorize(
            tx,
            {
              sessionId,
              permission: "cash.drawer",
              override: withCheck(parseDrawerOverride(body.override), checked),
            },
            attempts,
          );

          const printer = await resolveDrawerPrinter(tx, cfg.origin);
          if (printer === undefined) {
            throw new AppError("drawer.no_printer", { deviceId: session.deviceId });
          }
          if (
            body.expectedPrinterId !== undefined &&
            canonicaliseUuid(body.expectedPrinterId) !== printer.id
          ) {
            throw new AppError("drawer.assignment_changed", {});
          }
          if (!printer.hasCashDrawer) {
            throw new AppError("drawer.not_attached", { printerId: printer.id });
          }
          await enqueueManualDrawerOpen(tx, cfg, printer.id, personId, authorizedBy, viaOverride);
        }),
      );
      return c.body(null, 200);
    }),
  );

  // Like the refund's list: any operator may see who could approve their cancel and credit.
  app.get("/api/cancel-credit-authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await deps.db.withWriteLock(() => listActivePersonsWithPermission(deps.db, "sale.rectify")),
      );
    }),
  );

  app.post("/api/working-orders/:id/cancel", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ reason: string; override?: unknown }>(c);
      if (typeof body.reason !== "string")
        throw new AppError("working_order.reason_required", { workingOrderId: id });
      const override = parseOverrideField(body.override);
      await cancelPlacedOrder(
        {
          db: deps.db,
          backend: deps.backend,
          admission: deps.admission,
          clock: deps.clock,
          log,
          attendance: deps.attendance,
        },
        cfg,
        id,
        body.reason,
        { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
        override,
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/split-after-print", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ override?: unknown }>(c);
      const override = parseOverrideField(body.override);
      return c.json(
        await splitAfterPrint(
          {
            db: deps.db,
            backend: deps.backend,
            admission: deps.admission,
            clock: deps.clock,
            log,
            attendance: deps.attendance,
          },
          cfg,
          id,
          { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
          override,
        ),
      );
    }),
  );
}
