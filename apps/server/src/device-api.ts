// Side-effect only: keeps the codes this file throws reachable from it. See the note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  ticketItems,
  watchers,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorizeManager,
  endDeviceSessions,
  profilesAdmitting,
  type Permission,
} from "@waitron/identity";
import { kindOfFormFactor, listDeviceProfiles, type ProfilePrinterRole } from "@waitron/layouts";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import {
  assertProfileAction,
  parseDeviceCookie,
  readDeviceCookie,
  requireDevice,
  setDeviceCookie,
  sightingDue,
} from "./device-session.js";
import {
  approveDeviceProfiles,
  assertNoPaymentInProgress,
  endSessionsNotAdmitted,
  keepApprovedAfterSwitch,
  readApprovedAlternatives,
  readApprovedProfiles,
  requireDeviceName,
  resolveDeviceBinding,
  switchActiveProfile,
  updateDeviceSettings,
} from "./device.js";
import {
  readDeviceEquipment,
  readDevicesEquipment,
  releaseDevice,
  selectDeviceEquipment,
  type EquipmentRole,
} from "./device-equipment.js";
import { requestCfg } from "./request-config.js";
import {
  acceptDeviceJoinRequest,
  createJoinRequest,
  discardLapsedDeviceRequests,
  provenDisabledDevice,
  readJoinStatus,
} from "./join-requests.js";
import type { PairingMode } from "./pairing-mode.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { requireBodyUuid, requireNullableBodyUuid, requireString } from "@waitron/server-kit";
import { advanceTicketItem, listStationQueue, type TicketState } from "./working-order.js";
import { isUuid, requireSession, signedInPersonOn } from "./till-session.js";
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
  "device.forbidden_action": 403,
  "device_profile.not_approved": 403,
  "device_profile.not_admitted": 403,
  "device_profile.incompatible": 400,
  "device.payment_in_progress": 409,
  // The knock's own refusals. `pairing_closed` is a 403 rather than a 401: the door is shut, not
  // the caller unknown, and the device's next step is a person, not a credential.
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "device.join_stale": 409,
  // A wrong number denies the request (the row is already gone), so this is a plain request fault.
  "device.join_mismatch": 400,
  "join_request.not_found": 404,
  "device.station_required": 400,
  // A conflict the operator resolves by renaming the device.
  "device.name_taken": 409,
  "device.binding_invalid": 400,
  "device.equipment_held": 409,
  "reader.payment_in_progress": 409,
  "device_profile.not_found": 404,
  "device.not_found": 404,
  "station.not_found": 404,
  "watcher.not_found": 404,
  "station.not_allowed": 400,
  "watcher.not_allowed": 400,
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
      // A disabled device's browser still holds its cookie; proven, the knock comes back as that
      // device. Checked before the transaction, so scrypt does not hold the write lock.
      const returning = await provenDisabledDevice(deps.db, parseDeviceCookie(readDeviceCookie(c)));
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
        const request = await createJoinRequest(tx, deps.cfg, {
          kind: "device",
          label: name,
          returning,
        });
        // A number check on the request this one replaced must not approve this one. Dropped inside
        // the transaction: a rollback brings that request back unclaimed, which only asks for the
        // check again.
        if (returning !== null) deps.pairingMode.dropClaim(request.joinId);
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
      // no approval re-issues it; only a later knock does, and a disabled device's browser gets a new
      // one at each. Until approval it names no active device, so `requireDevice` finds nothing and
      // every other device route answers `device.unauthorized`: the token is inert by construction
      // rather than by a flag. The token itself leaves the process only here.
      setDeviceCookie(c, `${made.joinId}.${made.token}`, deps.secureCookies, deps.tenantDomain);
      return c.json({ joinId: made.joinId, verificationNumber: made.verificationNumber }, 200);
    }),
  );

  // ── Am I in yet? (the joiner's own cookie) ─────────────────────────────────────────────────────────
  // Pending, approved and not_approved are the only three answers, and the last folds denied, lapsed
  // and never-existed together: the joiner's recovery is to knock again in every case.
  app.get("/api/device/join/status", (c) =>
    run(c, log, async () => {
      // A cookie that is not `<uuid>.<token>` names nothing — refused HERE rather than passed to the
      // verb, so a malformed value never reaches a query. `device.unauthorized` carries no params, so
      // this confirms nothing to an unauthenticated caller.
      const parsed = parseDeviceCookie(readDeviceCookie(c));
      if (parsed === null) throw new AppError("device.unauthorized", {});
      const status = await readJoinStatus(
        deps.db,
        deps.cfg,
        parsed.id,
        parsed.token,
        deps.pairingMode,
      );
      return c.json({ status }, 200);
    }),
  );

  // ── Who am I? (DEVICE-GUARDED) ───────────────────────────────────────────────────────────────────────
  app.get("/api/device/me", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      const approvedProfiles = await withTransaction(deps.db, async (tx) => {
        const [active, ...alternatives] = await readApprovedProfiles(tx, device.deviceId);
        if (active === undefined) return [];
        const personId = await signedInPersonOn(tx, c, device.deviceId);
        if (personId === null) return [active, ...alternatives];
        const admitted = await profilesAdmitting(
          tx,
          personId,
          alternatives.map((profile) => profile.id),
        );
        return [active, ...alternatives.filter((profile) => admitted.includes(profile.id))];
      });
      // Non-secret config only: the reader's credentials never ride this response.
      return c.json({
        deviceId: device.deviceId,
        // The name has no other source on the till, so it rides this payload.
        formFactor: device.formFactor,
        name: device.label,
        stationId: device.stationId,
        watcherId: device.watcherId,
        profileId: device.deviceProfileId,
        // Its active profile first, then the approved ones the person signed in on it may use; every
        // approved one with nobody signed in. Display only: the switch checks both again.
        approvedProfiles,
      });
    }),
  );

  // ── The device's equipment (DEVICE-GUARDED read, SESSION-GUARDED choice) ────────────────────────
  app.get("/api/device/equipment", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      return c.json(
        await withTransaction(deps.db, (tx) => readDeviceEquipment(tx, device.deviceId)),
      );
    }),
  );

  // Any signed-in staff member may choose; a held item is taken by a scan or a confirmed list choice.
  app.put("/api/device/equipment", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession({ db: deps.db }, c);
      const choice = parseEquipmentChoice(await readJsonBody<Record<string, unknown>>(c));
      const equipment = await withTransaction(deps.db, async (tx) => {
        await selectDeviceEquipment(tx, { deviceId: device.deviceId, ...choice });
        return readDeviceEquipment(tx, device.deviceId);
      });
      return c.json(equipment, 200);
    }),
  );

  // ── Switch the session's device to another approved profile (SESSION-GUARDED) ──────────────────
  // A signed-in person is required, so a shared display with nobody signed in cannot switch.
  app.post("/api/device/active-profile", (c) =>
    run(c, log, async () => {
      const { personId, sessionId, device } = await requireSession({ db: deps.db }, c);
      const body = await readJsonBody<{ profileId?: unknown }>(c);
      const profileId = requireBodyUuid(body.profileId, "profileId");
      const switched = await withTransaction(deps.db, (tx) =>
        switchActiveProfile(tx, { deviceId: device.deviceId, sessionId, personId, profileId }),
      );
      return c.json(switched, 200);
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
      assertProfileAction(device, "prepare-orders");
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
  app.post("/api/device/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      assertProfileAction(device, "prepare-orders");
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
      const { rows, madeHere, alternatives, equipment } = await gated(sessionId, async (tx) => {
        const rows = await tx
          .select({
            id: devices.id,
            formFactor: deviceProfiles.formFactor,
            profileRetiredAt: deviceProfiles.retiredAt,
            stationId: devices.stationId,
            watcherId: devices.watcherId,
            deviceProfileId: devices.deviceProfileId,
            receiptPrinterId: devices.receiptPrinterId,
            paymentSlipPrinterId: devices.paymentSlipPrinterId,
            cashDrawerPrinterId: devices.cashDrawerPrinterId,
            label: devices.label,
            active: devices.active,
            lastSeenAt: devices.lastSeenAt,
            batteryLevel: devices.batteryLevel,
            batteryCharging: devices.batteryCharging,
            batteryReportedAt: devices.batteryReportedAt,
            enrolledAt: devices.enrolledAt,
            stationName: kitchenStations.name,
            stationActive: kitchenStations.active,
            watcherName: watchers.name,
            watcherActive: watchers.active,
          })
          .from(devices)
          .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
          .leftJoin(kitchenStations, eq(kitchenStations.id, devices.stationId))
          .leftJoin(watchers, eq(watchers.id, devices.watcherId))
          .orderBy(desc(devices.enrolledAt));
        return {
          rows,
          madeHere: await listMadeHereStations(tx),
          alternatives: await readApprovedAlternatives(tx),
          equipment: await readDevicesEquipment(
            tx,
            rows.map((row) => row.id),
          ),
        };
      });
      return c.json(
        rows.map(
          ({
            formFactor,
            profileRetiredAt,
            stationName,
            stationActive,
            watcherName,
            watcherActive,
            ...row
          }) => ({
            ...row,
            binding:
              stationName !== null
                ? { name: stationName, active: stationActive === true }
                : watcherName !== null
                  ? { name: watcherName, active: watcherActive === true }
                  : null,
            profileRetired: profileRetiredAt !== null,
            kind: kindOfFormFactor(formFactor),
            madeHereStationIds: madeHere.get(row.id) ?? [],
            approvedProfileIds: [
              row.deviceProfileId,
              ...(alternatives.get(row.id) ?? []).map((profile) => profile.id),
            ],
            equipment: equipment.get(row.id) ?? [],
          }),
        ),
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
      await gated(sessionId, async (tx) => {
        const updated = await tx
          .update(devices)
          .set({ active: false })
          .where(ownDeviceById(id))
          .returning({ id: devices.id });
        if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
        await endDeviceSessions(tx, id);
        await releaseDevice(tx, id);
      });
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
        cashDrawerPrinterId?: unknown;
        madeHereStationIds?: unknown;
        approvedProfileIds?: unknown;
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
            stationId: devices.stationId,
            watcherId: devices.watcherId,
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
        const chosen: Partial<Record<ProfilePrinterRole, string | null>> = {
          receipt: requireNullableBodyUuid(body.receiptPrinterId, "receiptPrinterId"),
          payment_slip: requireNullableBodyUuid(body.paymentSlipPrinterId, "paymentSlipPrinterId"),
        };
        // Absent leaves the stored drawer choice alone.
        if (body.cashDrawerPrinterId !== undefined) {
          chosen.cash_drawer = requireNullableBodyUuid(
            body.cashDrawerPrinterId,
            "cashDrawerPrinterId",
          );
        }
        // Absent leaves the stored stations alone: a kitchen screen's dialog does not show them.
        const madeHere = body.madeHereStationIds;
        if (madeHere !== undefined && (!Array.isArray(madeHere) || !madeHere.every(isUuid))) {
          throw new AppError("management.request_invalid", { field: "madeHereStationIds" });
        }
        // Absent leaves the stored approvals alone; the active profile is approved either way.
        const approvedIds = body.approvedProfileIds;
        if (
          approvedIds !== undefined &&
          (!Array.isArray(approvedIds) || !approvedIds.every(isUuid))
        ) {
          throw new AppError("management.request_invalid", { field: "approvedProfileIds" });
        }
        const switching = profileId !== device.deviceProfileId;
        if (switching) await assertNoPaymentInProgress(tx, id);
        const binding = await resolveDeviceBinding(tx, deps.cfg, {
          profileId,
          stationId,
          watcherId,
          kept: { stationId: device.stationId, watcherId: device.watcherId },
        });
        const held = await updateDeviceSettings(
          tx,
          { id, ...device },
          {
            label,
            profileId,
            stationId: binding.stationId,
            watcherId: binding.watcherId,
          },
        );
        // Only a choice that differs from the stored one is applied: a new choice must be switched
        // on, and a device may still hold a listed one since switched off.
        const current: Record<ProfilePrinterRole, string | null> = {
          receipt: held.receiptPrinterId,
          payment_slip: held.paymentSlipPrinterId,
          cash_drawer: held.cashDrawerPrinterId,
        };
        for (const role of ["receipt", "payment_slip", "cash_drawer"] as const) {
          const printerId = chosen[role];
          if (printerId === undefined || printerId === current[role]) continue;
          await selectDeviceEquipment(tx, {
            deviceId: id,
            role,
            selection: printerId === null ? "default" : { id: printerId },
            via: "manage",
          });
        }
        if (madeHere !== undefined) {
          await setMadeHereStations(tx, deps.cfg, id, madeHere as string[]);
        }
        await keepApprovedAfterSwitch(tx, id, device.deviceProfileId, profileId);
        if (approvedIds !== undefined) await approveDeviceProfiles(tx, id, approvedIds as string[]);
        if (switching) await endSessionsNotAdmitted(tx, id, profileId);
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

const EQUIPMENT_ROLES: readonly EquipmentRole[] = [
  "receipt",
  "payment_slip",
  "cash_drawer",
  "card_terminal",
];

/** `PUT /api/device/equipment`'s body, each field checked for shape. */
function parseEquipmentChoice(body: Record<string, unknown>): {
  role: EquipmentRole;
  selection: "default" | { id: string };
  via: "scan" | "list";
  takeOver: boolean;
} {
  const role = EQUIPMENT_ROLES.find((known) => known === body.role);
  if (role === undefined) throw new AppError("management.request_invalid", { field: "role" });
  const selection = body.selection;
  let chosen: "default" | { id: string };
  if (selection === "default") chosen = "default";
  else if (typeof selection === "object" && selection !== null && "id" in selection) {
    chosen = { id: requireBodyUuid(selection.id, "selection") };
  } else throw new AppError("management.request_invalid", { field: "selection" });
  if (body.via !== "scan" && body.via !== "list") {
    throw new AppError("management.request_invalid", { field: "via" });
  }
  if (body.takeOver !== undefined && typeof body.takeOver !== "boolean") {
    throw new AppError("management.request_invalid", { field: "takeOver" });
  }
  return { role, selection: chosen, via: body.via, takeOver: body.takeOver === true };
}
