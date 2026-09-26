// Side-effect only: keeps the codes this file throws reachable from it. See the note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { deviceProfiles, devices, ticketItems, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import { kindOfFormFactor, listDeviceProfiles } from "@waitron/layouts";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { readDeviceCookie, requireDevice, setDeviceCookie } from "./device-session.js";
import { requireDeviceBinding } from "./device.js";
import { acceptDeviceJoinRequest, createJoinRequest, readJoinStatus } from "./join-requests.js";
import type { PairingMode } from "./pairing-mode.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { requireBodyUuid, requireNullableBodyUuid, requireString } from "@waitron/server-kit";
import { advanceTicketItem, listStationQueue, type TicketState } from "./working-order.js";
import { isUuid } from "./till-session.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

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
}

const DEVICE_MANAGE_PERMISSION: Permission = "device.manage";

/**
 * CLIENT faults only: a non-AppError becomes an opaque `server.internal` 500, and a code absent here
 * takes the boundary's 400 default. A code this surface does not throw itself is mapped to the status
 * its own surface gives it, so a code has one status wherever it is answered.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "device.unauthorized": 401,
  "device.forbidden_station": 403,
  // The knock's own three refusals. `pairing_closed` is a 403 rather than a 401: the door is shut, not
  // the caller unknown, and the device's next step is a person, not a credential.
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  // A wrong number denies the request (the row is already gone), so this is a plain request fault.
  "device.join_mismatch": 400,
  "join_request.not_found": 404,
  // `register_name_taken` is a conflict the operator resolves by renaming the device.
  "device.station_required": 400,
  "device.register_required": 400,
  "device.register_name_taken": 409,
  "device.till_required": 400,
  "device.binding_invalid": 400,
  "device_profile.not_found": 404,
  "device.not_found": 404,
  "station.not_found": 404,
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
      // REAL join + accept verbs, so demo mode exercises the production path. The window is not
      // consulted, so `noteRefused` never fires in dev.
      const auto = deps.devMode === true;
      if (!auto && !deps.pairingMode.isOpen()) {
        deps.pairingMode.noteRefused();
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const made = await withTransaction(deps.db, async (tx) => {
        const request = await createJoinRequest(tx, deps.cfg, { kind: "device", label: name });
        if (auto) {
          // Accept in the SAME transaction, so a later throw (no till profile, or a register-name
          // collision) rolls the just-minted request back rather than leaving a pending row nobody can
          // approve. `listDeviceProfiles` is name-ordered, so the first `till` is the default.
          const till = (await listDeviceProfiles(tx)).find(
            (profile) => profile.formFactor === "till",
          );
          if (till === undefined) throw new AppError("device_profile.not_found", {});
          await acceptDeviceJoinRequest(tx, deps.cfg, request.joinId, {
            choice: request.verificationNumber,
            profileId: till.id,
          });
        }
        return request;
      });
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
      const status = await withTransaction(deps.db, async (tx) => {
        return readJoinStatus(tx, deps.cfg, joinId, token);
      });
      return c.json({ status }, 200);
    }),
  );

  // ── Who am I? (DEVICE-GUARDED) ───────────────────────────────────────────────────────────────────────
  app.get("/api/device/me", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, devMode: deps.devMode }, c);
      // Non-secret config only: the reader's credentials never ride this response.
      return c.json({
        deviceId: device.deviceId,
        // The name has no other source on the till, so it rides this payload.
        formFactor: device.formFactor,
        name: device.label,
        stationId: device.stationId,
        tillId: device.tillId,
        receiptPrinterId: device.receiptPrinterId,
      });
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
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, deps.cfg, id, { stationId });
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
        await advanceTicketItem(tx, deps.cfg, id, to);
      });
      return c.body(null, 204);
    }),
  );

  // ── List the devices (device.manage) ───────────────────────────────────────────────────────
  app.get("/management-api/devices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // The inner join always matches: `device_profile_id` is NOT NULL with a RESTRICT FK.
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: devices.id,
            formFactor: deviceProfiles.formFactor,
            stationId: devices.stationId,
            deviceProfileId: devices.deviceProfileId,
            label: devices.label,
            active: devices.active,
            lastSeenAt: devices.lastSeenAt,
            enrolledAt: devices.enrolledAt,
          })
          .from(devices)
          .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
          .orderBy(desc(devices.enrolledAt)),
      );
      return c.json(
        rows.map(({ formFactor, ...row }) => ({ ...row, kind: kindOfFormFactor(formFactor) })),
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

  // ── Reassign a device's device profile (device.manage) ────────────────────────────────────────
  app.post("/management-api/devices/:id/assign-device-profile", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // `device_profile_id` is NOT NULL, so this route REASSIGNS and cannot clear the binding.
      const body = await readJsonBody<{ deviceProfileId?: unknown }>(c);
      const deviceProfileId = requireBodyUuid(body.deviceProfileId, "deviceProfileId");
      // The FK still refuses a dangling write; the pre-read turns that into an error the operator can
      // act on (see the helper).
      const updated = await gated(sessionId, async (tx) => {
        await requireDeviceBinding(tx, { deviceProfileId });
        return tx
          .update(devices)
          .set({ deviceProfileId })
          .where(ownDeviceById(id))
          .returning({ id: devices.id });
      });
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.body(null, 204);
    }),
  );

  // ── Set a device's static hardware bindings (device.manage) ──────────────────────────────────────
  // A PATCH: only a NAMED field is written.
  app.patch("/management-api/devices/:id/hardware", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      const body = await readJsonBody<{
        receiptPrinterId?: unknown;
      }>(c);
      const set: {
        receiptPrinterId?: string | null;
      } = {};
      if ("receiptPrinterId" in body) {
        set.receiptPrinterId = requireNullableBodyUuid(body.receiptPrinterId, "receiptPrinterId");
      }
      // A PATCH that names no hardware field is a request-shape fault rather than an empty
      // `UPDATE … SET`.
      if (Object.keys(set).length === 0) {
        throw new AppError("management.request_invalid", { field: "hardware" });
      }
      const updated = await gated(sessionId, async (tx) => {
        if (set.receiptPrinterId !== undefined) {
          await requireDeviceBinding(tx, { receiptPrinterId: set.receiptPrinterId });
        }
        return tx.update(devices).set(set).where(ownDeviceById(id)).returning({
          id: devices.id,
          receiptPrinterId: devices.receiptPrinterId,
        });
      });
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.json(updated[0], 200);
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
                tillId: devices.tillId,
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
