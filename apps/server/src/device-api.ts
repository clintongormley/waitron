// Side-effect only: loads this host's errors.ts augmentation for the codes THIS file throws directly —
// `device.forbidden_station` and `device.not_found` (the route-owned faults), `management.request_invalid`
// (the body/id screens) and `ticket.invalid_transition` (the malformed-item-id screen). The device
// pairing/auth codes (`device.pairing_invalid`/`device.pairing_expired`/`device.unauthorized`) and
// `station.not_found` reach here through the value imports of the verbs/guard that throw them
// (`device.js`, `device-session.js`, `working-order.js`); `device.pairing_rate_limited` reaches here
// through the value import of `createEnrolRateLimiter` (`enrol-rate-limit.js`, which throws it); and
// the management-session/authorization codes through `@waitron/identity`; the mgmt siblings
// (`purchasing-api.ts`) rely on the same transitive reachability. See the note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, deviceKind, devices, ticketItems, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { requireDevice, setDeviceCookie } from "./device-session.js";
import { enrolDevice, generatePairingCode, kindRequiresStation } from "./device.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { requireBodyUuid, requireEnum } from "./request-screens.js";
import { advanceTicketItem, listStationQueue, type TicketState } from "./working-order.js";
import { isUuid } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/**
 * Everything `mountDeviceApi` needs. `cfg` is the FULL `TillConfig` (the shape `mountTillApi` receives),
 * NOT a `{ tenantId }` subset: the verbs this surface calls are typed `cfg: TillConfig`
 * (`generatePairingCode` reads `cfg.tenantId`/`cfg.locationId` to stamp the code, `listStationQueue`
 * reads `cfg.nodeId` to scope the queue to this node), so the config has to carry those three fields and
 * a narrower object would not typecheck. The routes touch NONE of the fiscal ids on it. `secureCookies`
 * marks the enrolment cookie `Secure` only under TLS — the same value `boot.ts` hands the till and
 * management mounts (`config.tls !== undefined`), so the device cookie is never `Secure` on a
 * plain-HTTP loopback host where the browser would then never send it back.
 */
export interface DeviceApiDeps {
  db: Database;
  cfg: TillConfig;
  secureCookies: boolean;
  /**
   * The redemption rate-limiter for `POST /api/device/enrol` (spec §8). Optional and injected ONLY by
   * tests, which pass a limiter over a controllable clock to prove the window behaviour without a real
   * sleep; production omits it and `mountDeviceApi` builds the default per-process, GLOBAL enrol limiter
   * (`createEnrolRateLimiter()`, which bakes in `ENROL_RATE_MAX` per `ENROL_RATE_WINDOW_MS`). See
   * `enrol-rate-limit.ts` for why the limit is global-not-per-IP and in-memory-not-DB.
   */
  enrolRateLimiter?: EnrolRateLimiter;
}

/**
 * The ONE permission that gates every device MANAGEMENT route — one named constant referenced at each
 * gated route rather than an inline literal, so a future re-mapping is a one-line swap here (the seam
 * `purchasing-api.ts`'s `PURCHASE_WRITE_PERMISSION` follows). `device.manage` maps to `manager` + `admin`
 * (permissions.ts) — pairing a screen and revoking one are admin acts, never a till operator's.
 */
const DEVICE_MANAGE_PERMISSION: Permission = "device.manage";

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a genuine
 * SERVER fault reaches `run` as a NON-AppError and becomes an opaque `server.internal` 500. A registered
 * code absent from this table defaults to 400 via `run`.
 *
 *  - The device-auth + enrol codes: `device.unauthorized` (the guard's fold of missing/unknown/revoked,
 *    401), `device.forbidden_station` (a device bumping another station's item, 403), the pairing-code
 *    redemption faults (`device.pairing_invalid`/`device.pairing_expired`, 400),
 *    `device.pairing_rate_limited` (the enrol flood guard, the FIRST 429 in `apps/server` —
 *    `enrol-rate-limit.ts` throws it at the TOP of the enrol handler, before any DB work),
 *    `device.pairing_code_unavailable` (a mint whose digest collided with an outstanding code's, 409 —
 *    `generatePairingCode` maps the `device_pairing_codes_lookup_idx` 23505 rather than surfacing a raw
 *    500), `device.not_found` (the manager-facing revoke of an absent device id, 404) and
 *    `station.not_found` (minting a code against an unknown/foreign/retired station, 404, via
 *    `requireLiveStation`).
 *  - The management-gate codes, mirroring `purchasing-api.ts`: `management_session.*` (401) and
 *    `person.suspended`/`authorization.not_permitted` (403), thrown by `requireManagementSession` /
 *    `authorizeManager`, plus `management.request_invalid` (400) from the body/id screens.
 *  - `ticket.invalid_transition`/`ticket.item_held` (409): the advance route delegates to
 *    `advanceTicketItem`, which owns those, so they are mapped to the SAME 409 `till-api.ts` gives them
 *    rather than being silently downgraded to the map's 400 default.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "device.unauthorized": 401,
  "device.forbidden_station": 403,
  "device.pairing_invalid": 400,
  "device.pairing_expired": 400,
  "device.pairing_rate_limited": 429,
  "device.pairing_code_unavailable": 409,
  "device.not_found": 404,
  "station.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "ticket.invalid_transition": 409,
  "ticket.item_held": 409,
};

// The one error boundary every device route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `device.failed` log tag.
const run = createErrorBoundary(STATUS, "device.failed");

/** Screen a REQUIRED body field as a string, refusing an absent/wrong-typed one as
 * `management.request_invalid` naming the field (never a downstream `text`/500). */
function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}

/**
 * Mounts the three device route groups on an existing Hono app — the `mountTillApi`/`mountManagementApi`
 * convention, attached to the SAME app. Every handler is wrapped in `run` so the whole surface maps
 * errors identically:
 *
 *  1. UNAUTHENTICATED enrolment (`POST /api/device/enrol`) — mirrors the till's `POST /api/session`: no
 *     prior-session guard, redeems a pairing code as `app_user` under the tenant, and sets the trusted
 *     device cookie from the token the verb mints. The token leaves ONLY in the cookie (never the body).
 *  2. DEVICE-GUARDED routes (`GET /api/device/station`, `POST /api/device/ticket-items/:id/advance`) —
 *     each calls `requireDevice` FIRST (401 otherwise) and scopes every read/bump to the device's OWN
 *     bound station; a bump of another station's item is `device.forbidden_station` (403).
 *  3. `device.manage`-GATED management routes (`POST /management-api/device-codes`, `GET
 *     /management-api/devices`, `POST /management-api/devices/:id/revoke`) — each calls
 *     `requireManagementSession` (401), then funnels its DB work through the local `gated` helper, which
 *     `authorizeManager`s `device.manage` (403) before the op runs, in exactly one place.
 */
export function mountDeviceApi(app: Hono, deps: DeviceApiDeps, log: Logger): void {
  // The GLOBAL, in-memory, per-process redemption rate-limiter for the enrol route (spec §8). Built ONCE
  // here so it is one bucket for the whole mounted API — in production `mountDeviceApi` is called once at
  // boot, so "per-mount" is "per-process". A test may inject its own limiter (over a controllable clock);
  // production omits it and gets the default `createEnrolRateLimiter({ code })` (`ENROL_RATE_MAX` per
  // `ENROL_RATE_WINDOW_MS`), throwing this surface's own `device.pairing_rate_limited` (429).
  const enrolLimiter =
    deps.enrolRateLimiter ?? createEnrolRateLimiter({ code: "device.pairing_rate_limited" });

  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // `device.manage`, then run `fn`. Every management route funnels its DB work through here so the gate
  // is applied identically and in exactly one place (purchasing-api's `gated`, permission baked in).
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: DEVICE_MANAGE_PERMISSION,
      });
      return fn(tx);
    });

  // ── Enrol (UNAUTHENTICATED) ────────────────────────────────────────────────────────────────────────
  app.post("/api/device/enrol", (c) =>
    run(c, log, async () => {
      // Rate-limit FIRST — before the body is parsed and before `enrolDevice`'s locking DELETE — so an
      // enrol flood is refused (429 `device.pairing_rate_limited`) with ZERO DB work: no connection is
      // drawn from the pool and no pairing code is touched, which is what keeps a flood on this
      // unauthenticated route from starving the sale path (CLAUDE.md §5, "nothing may block a sale").
      // Defense-in-depth over the code's own ~40-bit / single-use / 15-min-TTL controls (enrol-rate-limit.ts).
      enrolLimiter.check();
      // Read via `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque
      // 500) and flows to the `code` screen → a clean `management.request_invalid` 400 naming the field
      // (the verb's `normalizePairingCode` would TypeError on a non-string, so the string screen must
      // run first).
      const body = await readJsonBody<{ code?: unknown }>(c);
      const code = requireString(body.code, "code");
      const enrolled = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return enrolDevice(tx, deps.cfg, { code });
      });
      // The cookie is `${deviceId}.${token}` — a selector plus the scrypt-checked validator. The token
      // is the ONLY secret and leaves the process ONLY here, in the Set-Cookie header; it is NEVER echoed
      // in the body. The other three fields the verb returns — `kind`, `stationId`, `label` — are
      // non-secret (the manager who minted the code chose them) and the T6 enrol-confirmation view wants
      // them inline (spec §3b: the response is `{ deviceId, kind, stationId, label }`).
      setDeviceCookie(c, `${enrolled.deviceId}.${enrolled.token}`, deps.secureCookies);
      return c.json(
        {
          deviceId: enrolled.deviceId,
          kind: enrolled.kind,
          stationId: enrolled.stationId,
          label: enrolled.label,
        },
        200,
      );
    }),
  );

  // ── Who am I? (DEVICE-GUARDED) ───────────────────────────────────────────────────────────────────────
  // The client boot probe (Task 7): `requireDevice` resolves the cookie to its binding, and the route
  // echoes it back so the till client can decide which shell to render for this device KIND. A missing
  // or invalid cookie folds through `requireDevice` to `device.unauthorized` (401) — no handling here.
  app.get("/api/device/me", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg }, c);
      return c.json({ deviceId: device.deviceId, kind: device.kind, stationId: device.stationId });
    }),
  );

  // ── The bound station's queue (DEVICE-GUARDED) ───────────────────────────────────────────────────────
  app.get("/api/device/station", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg }, c);
      // A `kds_station` device is ALWAYS station-bound: enrolDevice copies the code's station, itself a
      // live station `requireLiveStation` confirmed at mint. But `requireDevice` authenticates ANY active
      // device regardless of kind, and a `handheld` binds to NO station (`stationId` is null,
      // `kindRequiresStation("handheld")` is false — device.ts), so a handheld cookie now REACHES this
      // branch. It throws `device.unauthorized` (401) — the honest "this device has no station queue",
      // the same 401 a missing/invalid cookie folds to, confirming neither the device's existence nor its
      // kind. (Previously this was `/* v8 ignore */`d as unreachable, when every device was a station-
      // bound `kds_station`; the handheld kind makes it reachable and it is now covered by a test.)
      if (device.stationId === null) throw new AppError("device.unauthorized", {});
      const stationId = device.stationId;
      const queue = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listStationQueue(tx, deps.cfg, stationId);
      });
      return c.json({ station: { id: stationId, queue } });
    }),
  );

  // ── Bump one of the bound station's items (DEVICE-GUARDED) ────────────────────────────────────────────
  app.post("/api/device/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg }, c);
      const id = c.req.param("id");
      // A malformed id names no item exactly as an absent one does — screened to the SAME
      // `ticket.invalid_transition` the verb raises for an unknown item, never a `22P02` 500.
      if (!isUuid(id)) throw new AppError("ticket.invalid_transition", { ticketItemId: id });
      // Read via `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque
      // 500): `to` is then undefined and reaches `advanceTicketItem`'s transition screen — the SAME
      // `ticket.invalid_transition` an absent/garbage target gives, never a 500.
      const body = await readJsonBody<{ to?: string }>(c);
      // `to` reaches `advanceTicketItem` as-is (cast): the verb owns target validation, refusing
      // "queued"/garbage/absent as `ticket.invalid_transition` before any enum reaches the column.
      const to = body.to as TicketState;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        // `advanceTicketItem` NEVER checks the station (KDS-1), so the station-ownership guard is the
        // route's job: fetch the item's own station and refuse a foreign one BEFORE the bump. An item
        // that reads back undefined (unknown/RLS-hidden) is left to the verb → `ticket.invalid_transition`.
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

  // ── Mint a pairing code for a station (device.manage) ─────────────────────────────────────────────────
  app.post("/management-api/device-codes", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Read via `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque
      // 500) and flows to the field screens below → a clean `management.request_invalid` 400.
      const body = await readJsonBody<{ kind?: unknown; stationId?: unknown; label?: unknown }>(c);
      // `requireEnum` narrows `kind` to the `device_kind` pgEnum union (= `DeviceKind`) off
      // `deviceKind.enumValues`, so a future additive kind is accepted the moment the enum widens;
      // `requireBodyUuid` screens `stationId` to a UUID SHAPE (a non-uuid would `22P02` in
      // `requireLiveStation` → an opaque 500). Both refuse a bad value as `management.request_invalid`
      // naming the field — the SHARED request-screens the other gated surfaces validate through.
      const kind = requireEnum(body.kind, "kind", deviceKind.enumValues);
      // The station is conditional on the kind (Task 2's `kindRequiresStation`): a `kds_station` code
      // binds to a station so `stationId` is still required (a missing one 400s here); a `handheld` code
      // binds to none, so we pass `null` and never screen `stationId` at all.
      const stationId = kindRequiresStation(kind)
        ? requireBodyUuid(body.stationId, "stationId")
        : null;
      const label = requireString(body.label, "label");
      const result = await gated(sessionId, (tx) =>
        generatePairingCode(tx, deps.cfg, { kind, stationId, label }),
      );
      return c.json(result, 201);
    }),
  );

  // ── List this tenant's devices (device.manage) ───────────────────────────────────────────────────────
  app.get("/management-api/devices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // No explicit tenant filter — isolation is entirely `withTenant` + `asAppUser` RLS (the
      // differential proof is packages/db's devices.rls.test.ts). Newest enrolment first.
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: devices.id,
            kind: devices.deviceKind,
            stationId: devices.stationId,
            label: devices.label,
            active: devices.active,
            lastSeenAt: devices.lastSeenAt,
            enrolledAt: devices.enrolledAt,
          })
          .from(devices)
          .orderBy(desc(devices.enrolledAt)),
      );
      return c.json(rows);
    }),
  );

  // ── Revoke a device (device.manage) ──────────────────────────────────────────────────────────────────
  app.post("/management-api/devices/:id/revoke", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // A malformed id names no device — a clean `device.not_found` (404), never a `22P02` 500. Screened
      // before `gated` the way `purchasing-api.ts` screens its `:id` before the tenant transaction.
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // Revoke = flip `active = false` (instant — `requireDevice` rejects it), NEVER a hard DELETE: a
      // device is a durable identity and app_user holds no DELETE on `devices`. 0 rows updated (unknown
      // or RLS-hidden id) → `device.not_found`.
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(devices)
          .set({ active: false })
          .where(eq(devices.id, id))
          .returning({ id: devices.id }),
      );
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.body(null, 204);
    }),
  );
}
