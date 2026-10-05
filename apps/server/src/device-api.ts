// Side-effect only: keeps the codes this file throws reachable from it. See the note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { deviceProfiles, devices, ticketItems, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import {
  chooseDevicePrinter,
  firstUsablePrinters,
  kindOfFormFactor,
  listDeviceProfiles,
  printerChoices,
  type PrinterRole,
} from "@waitron/layouts";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { readDeviceCookie, requireDevice, setDeviceCookie, sightingDue } from "./device-session.js";
import { mapDeviceNameTaken, requireDeviceName, resolveDeviceBinding } from "./device.js";
import { requestCfg } from "./request-config.js";
import {
  acceptDeviceJoinRequest,
  createJoinRequest,
  discardLapsedDeviceRequests,
  readJoinStatus,
} from "./join-requests.js";
import type { PairingMode } from "./pairing-mode.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { requireBodyUuid, requireNullableBodyUuid, requireString } from "@waitron/server-kit";
import { advanceTicketItem, listStationQueue, type TicketState } from "./working-order.js";
import { isUuid, requireSession } from "./till-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { stationPrintersDown } from "./station-outputs-down.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";
import { listMadeHereStations, setMadeHereStations } from "./made-here.js";
import { listWatcherQueue, markWatcherItems } from "./watcher-board.js";
import { parseWatcherDoneBody } from "./watcher-done-body.js";

/**
 * `cfg` is the FULL `TillConfig` because the verbs this surface calls are typed on it; the routes
 * touch none of its fiscal ids.
 */
export interface DeviceApiDeps {
  db: Database;
  cfg: TillConfig;
  secureCookies: boolean;
  /**
   * The venue-wide window during which a knock is admitted (`pairing-mode.ts`). REQUIRED, not optional:
   * a mount with no window would admit every knock on an unauthenticated, row-creating route.
   */
  pairingMode: PairingMode;
  /**
   * Injected only by tests, over a controllable clock; production gets `createEnrolRateLimiter()`.
   * See `enrol-rate-limit.ts` for why the limit is in-memory rather than in the database.
   */
  enrolRateLimiter?: EnrolRateLimiter;
  /**
   * When `true`, mounts the dev-only device switcher list (`GET /api/dev/devices`); otherwise that
   * route does not exist.
   */
  devMode?: boolean;
  /**
   * Passed to `setDeviceCookie`, which resolves the cookie's `Domain` per request from it and the
   * host; absent, or a host outside it, gives a host-only cookie.
   */
  tenantDomain?: string;
  /** The battery route's clock; tests inject one to step past the one-minute limit. */
  now?: () => Date;
}

const DEVICE_MANAGE_PERMISSION: Permission = "device.manage";

/**
 * CLIENT faults only: a non-AppError becomes an opaque `server.internal` 500, and a code absent here
 * takes the boundary's 400 default. A code this surface does not throw itself is mapped to the status
 * its own surface gives it, so a code has one status wherever it is answered.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "device.unauthorized": 401,
  "session.required": 401,
  "device.forbidden_station": 403,
  // The knock's own three refusals. `pairing_closed` is a 403 rather than a 401: the door is shut, not
  // the caller unknown, and the device's next step is a person, not a credential.
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  // A wrong number denies the request (the row is already gone), so this is a plain request fault.
  "device.join_mismatch": 400,
  "join_request.not_found": 404,
  "device.station_required": 400,
  // A conflict the operator resolves by renaming the device.
  "device.name_taken": 409,
  "device.binding_invalid": 400,
  "device_profile.not_found": 404,
  "device.not_found": 404,
  "station.not_found": 404,
  "watcher.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "ticket.invalid_transition": 409,
  "ticket.item_held": 409,
  "kitchen_notice.not_found": 404,
};

const run = createErrorBoundary(STATUS, "device.failed");

/**
 * Joining is UNAUTHENTICATED; outside devMode, approval is an ADMIN act on another surface
 * (`join-api.ts`), never anything a device can do for itself. The token leaves ONLY in the cookie,
 * never the body.
 */
export function mountDeviceApi(app: Hono, deps: DeviceApiDeps, log: Logger): void {
  // Built ONCE here, so it is one bucket for the whole mounted API.
  const enrolLimiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: DEVICE_MANAGE_PERMISSION,
      });
      return fn(tx);
    });

  const ownDeviceById = (id: string) => eq(devices.id, id);

  // ── Knock (UNAUTHENTICATED) ────────────────────────────────────────────────────────────────────────
  app.post("/api/device/join", (c) =>
    run(c, log, async () => {
      // Rate limit, then the window, BOTH before the body is parsed and before any DB work, so a flood
      // on this unauthenticated route creates no row. The window runs second, so a flood is refused as
      // a flood rather than reported as a shut door.
      enrolLimiter.check();
      // devMode accepts the knock immediately with the venue's default `till` profile, through the
      // real join and accept verbs, without a window, a number check or a claim.
      const auto = deps.devMode === true;
      const admittedIn = deps.pairingMode.openSince();
      if (!auto && admittedIn === null) {
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      let dropped: string[] = [];
      const made = await withTransaction(deps.db, async (tx) => {
        // The window can shut, and open again, while the body arrives; a knock admitted in an
        // earlier open period must not land in a later one as a fresh request (open periods are told
        // apart by their start time, to the millisecond).
        if (!auto && deps.pairingMode.openSince() !== admittedIn) {
          throw new AppError("device.pairing_closed", {});
        }
        // Before the cap is counted, so requests a shut window stranded do not hold places in it.
        dropped = await discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
        const request = await createJoinRequest(tx, deps.cfg, { kind: "device", label: name });
        if (auto) {
          // Accept in the SAME transaction, so a later throw (no till profile, or a taken device
          // name) rolls the just-minted request back rather than leaving a pending row nobody can
          // approve. `listDeviceProfiles` is name-ordered, so the first `till` is the default.
          const till = (await listDeviceProfiles(tx)).find(
            (profile) => profile.formFactor === "till",
          );
          if (till === undefined) throw new AppError("device_profile.not_found", {});
          await acceptDeviceJoinRequest(tx, deps.cfg, request.joinId, {
            label: name,
            profileId: till.id,
          });
        }
        return request;
      });
      for (const id of dropped) deps.pairingMode.dropClaim(id);
      // The cookie's SELECTOR is the join request's id, which accept carries onto the devices row — so
      // this cookie is set once and never re-issued. Until then it names no device, so `requireDevice`
      // finds nothing and every other device route answers `device.unauthorized`: the token is inert by
      // construction rather than by a flag. The token itself leaves the process only here.
      setDeviceCookie(c, `${made.joinId}.${made.token}`, deps.secureCookies, deps.tenantDomain);
      return c.json({ joinId: made.joinId, verificationNumber: made.verificationNumber }, 200);
    }),
  );

  // ── Am I in yet? (the joiner's own cookie) ─────────────────────────────────────────────────────────
  // Pending, approved and not_approved are the only three answers, and the last folds denied, lapsed
  // and never-existed together: the joiner's recovery is to knock again in every case.
  app.get("/api/device/join/status", (c) =>
    run(c, log, async () => {
      const raw = readDeviceCookie(c);
      if (raw === null) throw new AppError("device.unauthorized", {});
      // A cookie that is not `<selector>.<token>` names nothing — refused HERE rather than passed to the
      // verb, so a malformed value never reaches a query. `device.unauthorized` carries no params, so
      // this confirms nothing to an unauthenticated caller.
      const dot = raw.indexOf(".");
      if (dot <= 0 || dot === raw.length - 1) throw new AppError("device.unauthorized", {});
      const joinId = raw.slice(0, dot);
      const token = raw.slice(dot + 1);
      // The selector goes into a by-id comparison that refuses nothing and would match nothing, so
      // this screen is what turns a non-uuid into a clean refusal.
      if (!isUuid(joinId)) throw new AppError("device.unauthorized", {});
      const status = await readJoinStatus(deps.db, deps.cfg, joinId, token, deps.pairingMode);
      return c.json({ status }, 200);
    }),
  );

  // ── Who am I? (DEVICE-GUARDED) ───────────────────────────────────────────────────────────────────────
  app.get("/api/device/me", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      const choices = await printerChoices(deps.db, device.deviceProfileId, device.locationId);
      // Non-secret config only: the reader's credentials never ride this response.
      return c.json({
        deviceId: device.deviceId,
        // The name has no other source on the till, so it rides this payload.
        formFactor: device.formFactor,
        name: device.label,
        stationId: device.stationId,
        watcherId: device.watcherId,
        receiptPrinterId: device.receiptPrinterId,
        paymentSlipPrinterId: device.paymentSlipPrinterId,
        printerChoices: choices,
      });
    }),
  );

  // ── Switch the session's device's current printers (SESSION-GUARDED) ─────────────────────────
  // Any signed-in staff member may switch; a named field is written, an absent one left alone.
  app.put("/api/device/printers", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession({ db: deps.db }, c);
      const body = await readJsonBody<{
        receiptPrinterId?: unknown;
        paymentSlipPrinterId?: unknown;
      }>(c);
      const choices: [PrinterRole, string | null][] = [];
      if (body.receiptPrinterId !== undefined)
        choices.push([
          "receipt",
          requireNullableBodyUuid(body.receiptPrinterId, "receiptPrinterId"),
        ]);
      if (body.paymentSlipPrinterId !== undefined)
        choices.push([
          "payment_slip",
          requireNullableBodyUuid(body.paymentSlipPrinterId, "paymentSlipPrinterId"),
        ]);
      const stored = await withTransaction(deps.db, async (tx) => {
        for (const [role, printerId] of choices) {
          const chosen = await chooseDevicePrinter(tx, device.deviceId, role, printerId);
          if (!chosen.ok) throw new AppError("device.binding_invalid", { field: chosen.field });
        }
        const [row] = await tx
          .select({
            receiptPrinterId: devices.receiptPrinterId,
            paymentSlipPrinterId: devices.paymentSlipPrinterId,
          })
          .from(devices)
          .where(ownDeviceById(device.deviceId));
        return row!;
      });
      return c.json(stored, 200);
    }),
  );

  // ── Report the device's battery (DEVICE-GUARDED) ─────────────────────────────────────────────
  app.put("/api/device/battery", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      const body = await readJsonBody<{ level?: unknown; charging?: unknown }>(c);
      const level = body.level;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100)
        throw new AppError("management.request_invalid", { field: "level" });
      if (typeof body.charging !== "boolean")
        throw new AppError("management.request_invalid", { field: "charging" });
      const charging = body.charging;
      const at = (deps.now?.() ?? new Date()).toISOString();
      await withTransaction(deps.db, async (tx) => {
        const [row] = await tx
          .select({ charging: devices.batteryCharging, reportedAt: devices.batteryReportedAt })
          .from(devices)
          .where(ownDeviceById(device.deviceId));
        // At most one stored report a minute, as for last-seen, unless the charger was plugged or
        // unplugged.
        if (
          row?.reportedAt != null &&
          row.charging === charging &&
          !sightingDue(row.reportedAt, at)
        )
          return;
        await tx
          .update(devices)
          .set({ batteryLevel: level, batteryCharging: charging, batteryReportedAt: at })
          .where(ownDeviceById(device.deviceId));
      });
      return c.body(null, 204);
    }),
  );

  app.get("/api/device/watcher", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      if (device.watcherId === null) throw new AppError("device.unauthorized", {});
      const watcherId = device.watcherId;
      return c.json(
        await withTransaction(deps.db, (tx) => listWatcherQueue(tx, deps.cfg, watcherId)),
      );
    }),
  );

  app.post("/api/device/watcher/done", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      if (device.watcherId === null) throw new AppError("device.unauthorized", {});
      const watcherId = device.watcherId;
      const cfg = requestCfg(deps.cfg, device);
      const body = parseWatcherDoneBody(await readJsonBody(c));
      const at = new Date();
      await withTransaction(deps.db, (tx) =>
        markWatcherItems(
          tx,
          cfg,
          watcherId,
          body.ticketItemIds,
          body.done,
          { deviceId: device.deviceId },
          at,
        ),
      );
      return c.body(null, 204);
    }),
  );

  // ── The bound station's queue (DEVICE-GUARDED) ───────────────────────────────────────────────────────
  app.get("/api/device/station", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      // `requireDevice` authenticates ANY active device, and a `handheld` binds to NO station, so a
      // handheld reaches this: the same 401 a missing cookie folds to, confirming neither the device's
      // existence nor its kind.
      if (device.stationId === null) throw new AppError("device.unauthorized", {});
      const stationId = device.stationId;
      const station = await withTransaction(deps.db, async (tx) => ({
        id: stationId,
        queue: await listStationQueue(tx, stationId),
        notices: await VENUE_SERVICE.listStationNotices(tx, deps.cfg, stationId),
        printersDown: (
          await stationPrintersDown(tx, deps.cfg.locationId, new Date(), stationId)
        ).map(({ printerId, printerName, since }) => ({ printerId, printerName, since })),
      }));
      return c.json({ station });
    }),
  );

  // ── Acknowledge one of the bound station's kitchen notices (DEVICE-GUARDED) ──────────────────────────
  // A notice at another station answers as an unknown one does: the display names only its own.
  app.post("/api/device/kitchen-notices/:id/acknowledge", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      if (device.stationId === null) throw new AppError("device.unauthorized", {});
      const stationId = device.stationId;
      const cfg = requestCfg(deps.cfg, device);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, cfg, id, { stationId });
      });
      return c.body(null, 204);
    }),
  );

  // ── Bump one of the bound station's items (DEVICE-GUARDED) ────────────────────────────────────────────
  // The `act-as-kds` capability flag is not enforced here; the route is gated by `requireDevice` and
  // station ownership.
  app.post("/api/device/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      const cfg = requestCfg(deps.cfg, device);
      const id = c.req.param("id");
      // A malformed id names no item exactly as an absent one does — screened to the SAME
      // `ticket.invalid_transition` the verb raises for an unknown item. The screen is the only
      // refusal; the `text` id column has none.
      if (!isUuid(id)) throw new AppError("ticket.invalid_transition", { ticketItemId: id });
      const body = await readJsonBody<{ to?: string }>(c);
      // `to` reaches `advanceTicketItem` as-is (cast): the verb owns target validation, refusing
      // "queued"/garbage/absent as `ticket.invalid_transition` before any enum reaches the column.
      const to = body.to as TicketState;
      await withTransaction(deps.db, async (tx) => {
        // `advanceTicketItem` NEVER checks the station, so the station-ownership guard is
        // the route's job: fetch the item's own station and refuse a foreign one BEFORE the bump.
        // An item that reads back undefined (unknown) is left to the verb →
        // `ticket.invalid_transition`.
        const [item] = await tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.id, id));
        if (item !== undefined && item.stationId !== device.stationId) {
          throw new AppError("device.forbidden_station", { stationId: item.stationId });
        }
        await advanceTicketItem(tx, cfg, id, to);
      });
      return c.body(null, 204);
    }),
  );

  // ── List the devices (device.manage) ───────────────────────────────────────────────────────
  app.get("/management-api/devices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // The inner join always matches: `device_profile_id` is NOT NULL with a RESTRICT FK.
      const { rows, madeHere } = await gated(sessionId, async (tx) => ({
        rows: await tx
          .select({
            id: devices.id,
            formFactor: deviceProfiles.formFactor,
            stationId: devices.stationId,
            watcherId: devices.watcherId,
            deviceProfileId: devices.deviceProfileId,
            receiptPrinterId: devices.receiptPrinterId,
            paymentSlipPrinterId: devices.paymentSlipPrinterId,
            label: devices.label,
            active: devices.active,
            lastSeenAt: devices.lastSeenAt,
            batteryLevel: devices.batteryLevel,
            batteryCharging: devices.batteryCharging,
            batteryReportedAt: devices.batteryReportedAt,
            enrolledAt: devices.enrolledAt,
          })
          .from(devices)
          .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
          .orderBy(desc(devices.enrolledAt)),
        madeHere: await listMadeHereStations(tx),
      }));
      return c.json(
        rows.map(({ formFactor, ...row }) => ({
          ...row,
          kind: kindOfFormFactor(formFactor),
          madeHereStationIds: madeHere.get(row.id) ?? [],
        })),
      );
    }),
  );

  // ── Revoke a device (device.manage) ──────────────────────────────────────────────────────────────────
  app.post("/management-api/devices/:id/revoke", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // A malformed id names no device, exactly as an absent one does.
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // Revoke flips `active = false`, NEVER a hard DELETE: a device is a durable identity.
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(devices)
          .set({ active: false })
          .where(ownDeviceById(id))
          .returning({ id: devices.id }),
      );
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.body(null, 204);
    }),
  );

  // ── Edit a device (device.manage) ────────────────────────────────────────────────────────────────────
  app.patch("/management-api/devices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // Parsed out here, screened inside the gate: an unauthorised caller is refused before anything
      // is said about its id or body.
      const body = await readJsonBody<{
        name?: unknown;
        profileId?: unknown;
        stationId?: unknown;
        watcherId?: unknown;
        receiptPrinterId?: unknown;
        paymentSlipPrinterId?: unknown;
        madeHereStationIds?: unknown;
      }>(c);
      await gated(sessionId, async (tx) => {
        if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
        const [device] = await tx
          .select({
            active: devices.active,
            locationId: devices.locationId,
            deviceProfileId: devices.deviceProfileId,
            receiptPrinterId: devices.receiptPrinterId,
            paymentSlipPrinterId: devices.paymentSlipPrinterId,
          })
          .from(devices)
          .where(ownDeviceById(id));
        if (device === undefined || !device.active) {
          throw new AppError("device.not_found", { deviceId: id });
        }
        const label = requireDeviceName(body.name);
        const profileId = requireBodyUuid(body.profileId, "profileId");
        const stationId =
          body.stationId == null ? null : requireBodyUuid(body.stationId, "stationId");
        const watcherId =
          body.watcherId == null ? null : requireBodyUuid(body.watcherId, "watcherId");
        const chosen: Record<PrinterRole, string | null> = {
          receipt: requireNullableBodyUuid(body.receiptPrinterId, "receiptPrinterId"),
          payment_slip: requireNullableBodyUuid(body.paymentSlipPrinterId, "paymentSlipPrinterId"),
        };
        const madeHere = body.madeHereStationIds;
        if (!Array.isArray(madeHere) || !madeHere.every(isUuid)) {
          throw new AppError("management.request_invalid", { field: "madeHereStationIds" });
        }
        const binding = await resolveDeviceBinding(tx, deps.cfg, {
          profileId,
          stationId,
          watcherId,
        });
        const held =
          profileId === device.deviceProfileId
            ? {
                receiptPrinterId: device.receiptPrinterId,
                paymentSlipPrinterId: device.paymentSlipPrinterId,
              }
            : await firstUsablePrinters(tx, profileId, device.locationId);
        try {
          await tx
            .update(devices)
            .set({
              label,
              deviceProfileId: profileId,
              stationId: binding.stationId,
              watcherId: binding.watcherId,
              ...held,
            })
            .where(ownDeviceById(id));
        } catch (error) {
          throw mapDeviceNameTaken(error);
        }
        // Only a printer that differs from the one held is checked: `chooseDevicePrinter` takes
        // switched-on printers only, and a device may still hold a listed one since switched off.
        const current: Record<PrinterRole, string | null> = {
          receipt: held.receiptPrinterId,
          payment_slip: held.paymentSlipPrinterId,
        };
        for (const role of ["receipt", "payment_slip"] as const) {
          if (chosen[role] === current[role]) continue;
          const result = await chooseDevicePrinter(tx, id, role, chosen[role]);
          if (!result.ok) throw new AppError("device.binding_invalid", { field: result.field });
        }
        await setMadeHereStations(tx, deps.cfg, id, madeHere as string[]);
      });
      return c.body(null, 204);
    }),
  );

  // ── Dev-only per-tab device switcher list ─────────────────────────────────────────────────────
  // Nothing here returns a token or reader credential.
  if (deps.devMode) {
    app.get("/api/dev/devices", (c) =>
      run(c, log, async () =>
        c.json(
          await withTransaction(deps.db, async (tx) => {
            // Active only: a revoked device is not one a browser can BECOME. NO token/tokenHash
            // column is selected.
            const deviceRows = await tx
              .select({
                id: devices.id,
                formFactor: deviceProfiles.formFactor,
                label: devices.label,
                stationId: devices.stationId,
                active: devices.active,
              })
              .from(devices)
              .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
              .where(eq(devices.active, true))
              .orderBy(desc(devices.enrolledAt));
            return {
              devices: deviceRows.map(({ formFactor, ...row }) => ({
                ...row,
                kind: kindOfFormFactor(formFactor),
              })),
            };
          }),
        ),
      ),
    );
  }
}
