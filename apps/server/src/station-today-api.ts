import type { Hono } from "hono";
import { withTransaction, type Transaction } from "@waitron/db";
import {
  authorize,
  authorizeByPin,
  listActivePersonsWithPermission,
  type PinThrottle,
} from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { invalid } from "./bill-allocation.js";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { assertProfileAction, requireDevice } from "./device-session.js";
import { requestCfg } from "./request-config.js";
import { overridePinAttempts, parseOverrideField, type Run, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { openDishCount, openDishesChoice, withStationDishes } from "./station-closing.js";
import "./errors.js";

function stationId(value: string): string {
  if (!isUuid(value)) throw new AppError("station.not_found", { stationId: value });
  return value.toLowerCase();
}

/** Refuses a station the device's station screen does not show now. */
async function assertScreenShowsStation(
  tx: Transaction,
  cfg: Pick<TillApiDeps["cfg"], "locationId">,
  deviceId: string,
  id: string,
): Promise<void> {
  const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, cfg, deviceId)).find(
    (candidate) => candidate.kind === "station",
  );
  const shown =
    screen?.available === true &&
    screen.stations.some((station) => station.available && station.id === id);
  if (!shown) throw new AppError("device.forbidden_station", { stationId: id });
}

export function mountStationTodayApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  app.get("/api/device/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const device = await requireDevice(deps, c);
      assertProfileAction(device, "prepare-orders");
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, device);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await assertScreenShowsStation(tx, cfg, device.deviceId, id);
          const destinations = await VENUE_SERVICE.stationDestinations(tx, cfg, id, new Date());
          const authorizers = await listActivePersonsWithPermission(tx, "venue_service.manage");
          return {
            destinations,
            authorizers,
            openDishCount: await openDishCount(tx, cfg.locationId, id),
          };
        }),
      );
    }),
  );
  app.put("/api/device/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const device = await requireDevice(deps, c);
      assertProfileAction(device, "prepare-orders");
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, device);
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (body.state !== "open" && body.state !== "closed") throw invalid("state");
      const state = body.state;
      const choice = state === "closed" ? openDishesChoice(body.openDishes) : undefined;
      let destination: string | undefined;
      if (state === "closed") {
        if (typeof body.sendsToStationId !== "string" || !isUuid(body.sendsToStationId))
          throw invalid("sendsToStationId");
        destination = body.sendsToStationId.toLowerCase();
      }
      const authorizer = parseOverrideField(body.authorizer);
      if (authorizer === undefined)
        throw new AppError("authorization.not_permitted", { permission: "venue_service.manage" });
      const attempts = overridePinAttempts(pinThrottle, device.deviceId);
      await withPinCheckAhead(deps.db, authorizer, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await assertScreenShowsStation(tx, cfg, device.deviceId, id);
          const { authorizedBy } = await authorizeByPin(
            tx,
            {
              permission: "venue_service.manage",
              override: withCheck(authorizer, checked)!,
            },
            attempts,
          );
          if (state === "closed")
            await withStationDishes(
              tx,
              cfg,
              id,
              destination,
              choice,
              (at) => VENUE_SERVICE.closeStationForToday(tx, cfg, id, destination!, at),
              { deviceId: cfg.origin.deviceId, personId: authorizedBy },
            );
          else await VENUE_SERVICE.openStationForToday(tx, cfg, id, new Date());
        }),
      );
      return c.body(null, 204);
    }),
  );
  app.get("/api/service-day/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await withTransaction(deps.db, (tx) =>
          listActivePersonsWithPermission(tx, "venue_service.manage"),
        ),
      );
    }),
  );
  app.get("/api/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, session);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const destinations = await VENUE_SERVICE.stationDestinations(tx, cfg, id, new Date());
          return { destinations, openDishCount: await openDishCount(tx, cfg.locationId, id) };
        }),
      );
    }),
  );
  app.put("/api/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, session);
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (body.state !== "open" && body.state !== "closed") throw invalid("state");
      const state = body.state;
      const choice = state === "closed" ? openDishesChoice(body.openDishes) : undefined;
      let destination: string | undefined;
      if (state === "closed") {
        if (typeof body.sendsToStationId !== "string" || !isUuid(body.sendsToStationId))
          throw invalid("sendsToStationId");
        destination = body.sendsToStationId.toLowerCase();
      }
      const override = parseOverrideField(body.override);
      const authz = { sessionId: session.sessionId, permission: "venue_service.manage" };
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await overrideToCheck(deps.db, authz, override);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          const { authorizedBy } = await authorize(
            tx,
            { ...authz, override: withCheck(override, checked) },
            attempts,
          );
          if (state === "closed")
            await withStationDishes(
              tx,
              cfg,
              id,
              destination,
              choice,
              (at) => VENUE_SERVICE.closeStationForToday(tx, cfg, id, destination!, at),
              { deviceId: cfg.origin.deviceId, personId: authorizedBy },
            );
          else await VENUE_SERVICE.openStationForToday(tx, cfg, id, new Date());
        }),
      );
      return c.body(null, 204);
    }),
  );
}
