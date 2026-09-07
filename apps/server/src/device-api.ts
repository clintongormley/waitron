// Side-effect only: loads this host's errors.ts augmentation for the codes THIS file throws directly —
// `device.forbidden_station` and `device.not_found` (the route-owned faults), `device.binding_invalid`
// (the assign-device-profile route's composite-FK translation for a bad `deviceProfileId`, the SAME
// code the enrol path raises), `management.request_invalid` (the body/id screens) and `ticket.invalid_transition`
// (the malformed-item-id screen). The device
// pairing/auth codes (`device.pairing_invalid`/`device.pairing_expired`/`device.unauthorized`) and
// `station.not_found` reach here through the value imports of the verbs/guard that throw them
// (`device.js`, `device-session.js`, `working-order.js`); `device.pairing_rate_limited` reaches here
// through the value import of `createEnrolRateLimiter` (`enrol-rate-limit.js`, which throws it); and
// the management-session/authorization codes through `@waitron/identity`; the mgmt siblings
// (`purchasing-api.ts`) rely on the same transitive reachability. See the note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, deviceProfiles, devices, ticketItems, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import { kindOfFormFactor } from "@waitron/layouts";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { requireDevice, setDeviceCookie } from "./device-session.js";
import {
  bindingFkField,
  enrolDevice,
  generatePairingCode,
  readEnrolCatalogue,
  verifyPairingCode,
} from "./device.js";
import { isDevPairingCode } from "./dev-pairing.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import {
  requireBodyUuid,
  requireEnum,
  requireNullableBodyUuid,
  requireNullableString,
  requireString,
} from "./request-screens.js";
import { advanceTicketItem, listStationQueue, type TicketState } from "./working-order.js";
import { isUuid } from "./till-session.js";
import { CARD_PROVIDERS } from "./till-config.js";
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
  /**
   * When `true`, mounts the SP-C dev-only per-tab device switcher list (`GET /api/dev/devices`); outside
   * dev it DOES NOT EXIST (404) — the same fail-closed shape as the `DEV_DEVICE_HEADER` override. It ALSO
   * makes the always-mounted `POST /api/device/enrol/verify` and `POST /api/device/enrol` accept the
   * fixed dev pairing code (`dev-pairing.ts`) — a behaviour switch on production routes, not a mount gate:
   * verify returns the catalogue without a real code row, and enrol mints a fresh real code then runs the
   * REAL `enrolDevice` under it; outside dev that code is just an invalid one. OPTIONAL so every existing
   * `DeviceApiDeps`/`mountDeviceApi` construction (boot, tests) compiles unchanged: undefined means the
   * dev route is not mounted, so the default is production, and the routes gate on `deps.devMode === true`.
   */
  devMode?: boolean;
  /**
   * The venue's registrable domain (till-reroute §3.5; see ServerConfig.tenantDomain for the
   * invariant) — passed straight to `setDeviceCookie`, which resolves the effective `Domain` per request
   * from it and the host. OPTIONAL: absent OR a host outside it → host-only, the loopback-dev default.
   * Boot wires `config.tenantDomain`.
   */
  tenantDomain?: string;
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
 *    500), `device.station_required` (ENROLLING a kds-profile device with NO station — a validation
 *    failure `enrolDevice` raises before any write, 400; the code is a bare token now, so this is an
 *    enrol-time fault, not a mint one). Two enrol-time siblings — `device.register_required` (a
 *    handheld-profile device enrolled with no register) and `device.register_name_taken` (a
 *    `till`-profile device whose auto-created register collides on name at the venue, `enrolDevice`
 *    translating the `tills_tenant_location_name_key` 23505, the ONE 409 of the enrol-validation set).
 *    `device.till_required` is not thrown here (it is the SALE-path guard, device-session.ts) but is
 *    mapped to the SAME 400 till-api.ts gives it, so the code has one status everywhere.
 *    `device.binding_invalid` (a request naming a till/printer/profile id that is not this tenant's —
 *    the composite-FK 23503 translated by constraint name, OR the enrol path's explicit register read
 *    finding no such row of this venue, 400), `device.not_found` (the manager-facing revoke of an
 *    absent device id, 404) and `station.not_found` (ENROLLING against an unknown/foreign/retired
 *    station that WAS supplied, 404, via `requireLiveStation`).
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
  // The three enrol-time binding-validation faults `enrolDevice` raises before/at the device write, all
  // request-shape 400s naming the problem (never a value) — a kds profile enrolled with no station
  // (`station_required`), a handheld profile with no register (`register_required`), and the
  // binding-FK/explicit-read translation for a named id that is no row of this tenant/venue
  // (`binding_invalid`, which names the FIELD, so it reads as a malformed request, unlike the 404
  // `station.not_found` a supplied-but-unknown station takes). `register_name_taken` is the ONE 409 of
  // the three: a `till` profile whose auto-created register collides on name at the venue is a conflict
  // the operator resolves by renaming, the `ticket.item_held` conflict shape.
  "device.station_required": 400,
  "device.register_required": 400,
  "device.register_name_taken": 409,
  // `device.till_required` is the SALE-path guard (a till-less device cannot ring — device-session.ts),
  // not thrown by any route on THIS surface, but mapped identically to till-api.ts's 400 so the code has
  // one status everywhere it is answered.
  "device.till_required": 400,
  "device.binding_invalid": 400,
  // The enrol path named a profileId that is no profile of this tenant (unknown or just-deleted). Since
  // `profileId` is a CLIENT choice from the verify catalogue, this is a 404 the operator recovers from by
  // re-picking — the device-profile store's own code, reused (the management surface maps it the same).
  // (`device.profile_missing` is retired here — its only thrower, the deleted dev-till mint, is gone.)
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
};

// The one error boundary every device route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `device.failed` log tag.
const run = createErrorBoundary(STATUS, "device.failed");

/**
 * Mounts the device route groups on an existing Hono app — the `mountTillApi`/`mountManagementApi`
 * convention, attached to the SAME app. Every handler is wrapped in `run` so the whole surface maps
 * errors identically:
 *
 *  1. UNAUTHENTICATED enrolment, a TWO-STEP flow — mirrors the till's `POST /api/session` in carrying no
 *     prior-session guard, running as `app_user` under the tenant. `POST /api/device/enrol/verify`
 *     verifies a code WITHOUT consuming it and returns the venue's catalogue (profiles/stations/registers)
 *     so the device can describe itself; `POST /api/device/enrol` then redeems the SAME code with the
 *     operator's choices, enrols the device and sets the trusted device cookie from the token the verb
 *     mints. The token leaves ONLY in the cookie (never the body). Both are rate-limited FIRST (§8).
 *  2. DEVICE-GUARDED routes (`GET /api/device/me`, `GET /api/device/station`, `POST
 *     /api/device/ticket-items/:id/advance`) — each calls `requireDevice` FIRST (401 otherwise) and
 *     resolves to the CALLER's own device: `me` returns that device's identity, while the station
 *     routes scope every read/bump to the device's OWN bound station (a bump of another station's item
 *     is `device.forbidden_station`, 403).
 *  3. `device.manage`-GATED management routes (`POST /management-api/device-codes`, `GET
 *     /management-api/devices`, `POST /management-api/devices/:id/revoke`, `POST
 *     /management-api/devices/:id/assign-device-profile`, `PATCH /management-api/devices/:id/hardware`)
 *     — each calls `requireManagementSession` (401),
 *     then funnels its DB work through the local `gated` helper, which `authorizeManager`s `device.manage`
 *     (403) before the op runs, in exactly one place.
 *  4. DEV-ONLY route, mounted only under `devMode` (404 otherwise): the `?dev` switcher's device list
 *     (`GET /api/dev/devices`). Under `devMode` the verify/enrol routes of group 1 additionally accept
 *     the fixed dev pairing code (`dev-pairing.ts`): verify returns the catalogue without a real code row,
 *     and enrol mints a fresh real code then runs the REAL `enrolDevice` under it (the production path,
 *     no operator mint required). Outside dev the code is just an invalid one.
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

  // A by-id device predicate that ALSO scopes to this tenant — the one place the by-id management
  // writes build their `.where`. Since RLS was dropped (#255) `withTenant` no longer isolates by
  // tenant, so a by-id read OR write must carry its own `tenant_id` scope (CLAUDE.md §3;
  // till-reroute-S3): a globally-unique device UUID is NOT the query's isolation boundary, so a
  // request scoped to tenant A must update/read zero of tenant B's rows (→ 404 / omitted), never
  // reassign or revoke a foreign device.
  const ownDeviceById = (id: string) =>
    and(eq(devices.tenantId, deps.cfg.tenantId), eq(devices.id, id));

  // A present-but-optional body UUID: absent OR explicit `null` → `null` (the field does not apply to
  // this profile's form factor); a present value must be UUID-SHAPED (a non-uuid would `22P02` at the
  // bare-uuid column) → `management.request_invalid` naming the field. `enrolDevice` decides whether the
  // field is REQUIRED for the chosen profile (`device.station_required` / `device.register_required`).
  const optionalUuid = (v: unknown, field: string): string | null =>
    v === undefined || v === null ? null : requireBodyUuid(v, field);

  // ── Verify a pairing code (UNAUTHENTICATED, does NOT consume it) ───────────────────────────────────
  // The FIRST step of enrolment: the device sends its code, and — without burning it — gets back the
  // venue's catalogue (profiles/stations/registers) so the operator can describe this device before the
  // consuming `POST /api/device/enrol`. Rate-limited FIRST (the enrol convention, §8): a flood is refused
  // 429 with ZERO DB work, so it cannot starve the sale path (CLAUDE.md §5).
  app.post("/api/device/enrol/verify", (c) =>
    run(c, log, async () => {
      enrolLimiter.check();
      const body = await readJsonBody<{ code?: unknown }>(c);
      const code = requireString(body.code, "code");
      // In devMode ONLY, the fixed dev code is valid and returns the catalogue WITHOUT a real code row.
      // Outside devMode the word is hashed like any other and misses — `device.pairing_invalid`.
      const devDemo = deps.devMode === true && isDevPairingCode(code);
      const catalogue = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return devDemo ? readEnrolCatalogue(tx, deps.cfg) : verifyPairingCode(tx, deps.cfg, code);
      });
      return c.json(catalogue, 200);
    }),
  );

  // ── Enrol (UNAUTHENTICATED, consumes the code) ─────────────────────────────────────────────────────
  app.post("/api/device/enrol", (c) =>
    run(c, log, async () => {
      // Rate-limit FIRST — before the body is parsed and before `enrolDevice`'s locking DELETE — so an
      // enrol flood is refused (429 `device.pairing_rate_limited`) with ZERO DB work: no connection is
      // drawn from the pool and no pairing code is touched, which is what keeps a flood on this
      // unauthenticated route from starving the sale path (CLAUDE.md §5, "nothing may block a sale").
      // Defense-in-depth over the code's own ~40-bit / single-use / 15-min-TTL controls (enrol-rate-limit.ts).
      enrolLimiter.check();
      // Read via `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque
      // 500) and flows to the string screens → a clean `management.request_invalid` 400 naming the field.
      const body = await readJsonBody<{
        code?: unknown;
        name?: unknown;
        profileId?: unknown;
        stationId?: unknown;
        registerId?: unknown;
      }>(c);
      const code = requireString(body.code, "code");
      const name = requireString(body.name, "name");
      const profileId = requireBodyUuid(body.profileId, "profileId");
      const stationId = optionalUuid(body.stationId, "stationId");
      const registerId = optionalUuid(body.registerId, "registerId");
      // In devMode ONLY, the fixed dev code runs the REAL enrol path: mint a fresh real code in the SAME
      // tenant tx, then `enrolDevice` under it with the operator's chosen profile/binding. Outside
      // devMode the word is hashed like any other and misses in `enrolDevice`'s DELETE →
      // `device.pairing_invalid`.
      const devDemo = deps.devMode === true && isDevPairingCode(code);
      const enrolled = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const effectiveCode = devDemo ? (await generatePairingCode(tx, deps.cfg)).code : code;
        return enrolDevice(tx, deps.cfg, {
          code: effectiveCode,
          name,
          profileId,
          stationId,
          registerId,
        });
      });
      // The cookie is `${deviceId}.${token}` — a selector plus the scrypt-checked validator. The token
      // is the ONLY secret and leaves the process ONLY here, in the Set-Cookie header; it is NEVER echoed
      // in the body. The `name`/`formFactor` the verb returns are non-secret and the enrol-confirmation
      // view wants them inline (spec §3b: the response is `{ deviceId, name, formFactor }`).
      setDeviceCookie(
        c,
        `${enrolled.deviceId}.${enrolled.token}`,
        deps.secureCookies,
        deps.tenantDomain,
      );
      return c.json(
        {
          deviceId: enrolled.deviceId,
          name: enrolled.name,
          formFactor: enrolled.formFactor,
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
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg, devMode: deps.devMode }, c);
      // Echo the binding verbatim, incl. the SP-A.2 §16 till/hardware fields so the client can
      // (SP-B) boot into its hardware. The canvas is no longer a device field — it resolves through the
      // device profile (`GET /api/till`) after the Task 10 cutover. All non-secret config — the reader's
      // credentials stay in the vault and never ride this response.
      return c.json({
        deviceId: device.deviceId,
        // The device's FORM FACTOR (the kind is derived from it via `kindOfFormFactor`; there is no
        // kind column any more) and its NAME (the human `label`) — the till's login screen shows the
        // name, and boot branches its shell off the form factor. The name has no other source on the
        // till, so it rides this payload (RULING 2).
        formFactor: device.formFactor,
        name: device.label,
        stationId: device.stationId,
        tillId: device.tillId,
        receiptPrinterId: device.receiptPrinterId,
        hasCashDrawer: device.hasCashDrawer,
        cardProvider: device.cardProvider,
        cardReaderId: device.cardReaderId,
      });
    }),
  );

  // ── The bound station's queue (DEVICE-GUARDED) ───────────────────────────────────────────────────────
  app.get("/api/device/station", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg, devMode: deps.devMode }, c);
      // A `kds_station` device is ALWAYS station-bound: enrolDevice required its station and
      // `requireLiveStation` confirmed it live at enrol. But `requireDevice` authenticates ANY active
      // device regardless of kind, and a `handheld` binds to NO station (`kindOfFormFactor` maps it to
      // `handheld`, not `kds_station`), so a handheld cookie now REACHES this
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
  // Capability note (SP-A.2 §16, Task 14; device-profile §5.3, Task 9): the `act-as-kds` capability flag
  // is DECLARED in `DEFAULT_PROFILE_CAPABILITIES.kds`, but route-level enforcement here is deliberately
  // DEFERRED. Existing `kds_station` devices carry `deviceProfileId = null`, so an
  // `assertDeviceCapability(deps, c, "act-as-kds", …)` would refuse them (a device with no profile
  // declares no capabilities) — a regression on the bump path. This route is already `requireDevice` +
  // station-ownership gated (only a `kds_station` device bound to the station reaches it), so the flag
  // adds no protection here today; wiring it awaits KDS devices being provisioned with a kds profile.
  app.post("/api/device/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const device = await requireDevice({ db: deps.db, cfg: deps.cfg, devMode: deps.devMode }, c);
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
        // `advanceTicketItem` NEVER checks the station (KDS-1), so the station-ownership guard is
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

  // ── Mint a pairing code (device.manage) ───────────────────────────────────────────────────────────
  app.post("/management-api/device-codes", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // The code is a BARE bearer token — no body. The device describes itself (kind, station, till,
      // profile, hardware) when it redeems the code and enrols (Tasks 7-8); this route only authorises
      // a manager and mints. `generatePairingCode` returns `{ code }`.
      const result = await gated(sessionId, (tx) => generatePairingCode(tx, deps.cfg));
      return c.json(result, 201);
    }),
  );

  // ── List this tenant's devices (device.manage) ───────────────────────────────────────────────────────
  app.get("/management-api/devices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // The deployment holds one tenant per database. Newest enrolment first. The device KIND has no
      // column any more — it is DERIVED from the device's profile form factor (`kindOfFormFactor`), read
      // through an inner join on the tenant-consistent (tenant_id, device_profile_id), which always
      // matches since `device_profile_id` is NOT NULL with a RESTRICT FK.
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
          .innerJoin(
            deviceProfiles,
            and(
              eq(deviceProfiles.tenantId, devices.tenantId),
              eq(deviceProfiles.id, devices.deviceProfileId),
            ),
          )
          // Scope the list to THIS tenant explicitly — since RLS was dropped (#255) `withTenant` no
          // longer isolates SELECTs, so without this a manager sees (and, via the by-id writes below,
          // could reassign/revoke) every tenant's devices in a multi-tenant DB (CLAUDE.md §3).
          .where(eq(devices.tenantId, deps.cfg.tenantId))
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
      // A malformed id names no device — a clean `device.not_found` (404), never a `22P02` 500. Screened
      // before `gated` the way `purchasing-api.ts` screens its `:id` before the tenant transaction.
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // Revoke = flip `active = false` (instant — `requireDevice` rejects it), NEVER a hard
      // DELETE: a device is a durable identity and app_user holds no DELETE on `devices`. 0 rows
      // updated (unknown id) → `device.not_found`.
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
  // Since the Task 10 cutover this is the ONLY device-binding reassign route: the profile is the sole
  // canvas + capabilities binding (the direct `assign-canvas` route was removed with the canvas column).
  app.post("/management-api/devices/:id/assign-device-profile", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // A malformed id names no device — a clean `device.not_found` (404), never a `22P02` 500. The
      // same id screen the revoke route above runs before `gated`.
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // Read via `readJsonBody` (empty/malformed/`null` → `{}`, never an opaque 500), then screen the
      // target: a device is DEFINED by its profile (`device_profile_id` is NOT NULL since Task 7), so
      // this route REASSIGNS to another profile and cannot clear the binding — the target is a REQUIRED
      // UUID SHAPE (a non-uuid would `22P02` at the bare-uuid column; an absent one is a clean
      // `management.request_invalid` 400 naming the field), the shared `requireBodyUuid` screen.
      const body = await readJsonBody<{ deviceProfileId?: unknown }>(c);
      const deviceProfileId = requireBodyUuid(body.deviceProfileId, "deviceProfileId");
      // A non-null target must be one of THIS tenant's own device profiles. Rather than
      // a read-then-write pre-check (which leaves a delete-between-check-and-update race surfacing a
      // raw FK 500), let the composite FK `devices_device_profile_fk (tenant_id, device_profile_id)` be
      // the guard: tenant-isolated (a cross-tenant id looks for `(this_tenant, id)` and misses — never
      // binds, never leaks) AND atomic with the UPDATE (no window). A 23503 on it → `device.binding_invalid`
      // naming the field, the SAME code+shape the enrol path raises via the same `bindingFkField` helper.
      // Any other error rethrows raw.
      let updated: { id: string }[];
      try {
        updated = await gated(sessionId, (tx) =>
          tx
            .update(devices)
            .set({ deviceProfileId })
            .where(ownDeviceById(id))
            .returning({ id: devices.id }),
        );
      } catch (error) {
        if (bindingFkField(error) === "deviceProfileId") {
          throw new AppError("device.binding_invalid", { field: "deviceProfileId" });
        }
        throw error;
      }
      // 0 rows updated (unknown device id) → `device.not_found`, the revoke idiom.
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.body(null, 204);
    }),
  );

  // ── Set a device's static hardware bindings (device.manage) ──────────────────────────────────────
  // The per-device hardware editor's write (Task 14): the receipt printer, its cash-drawer flag, the
  // card provider and the provider's reader id — the SP-A.2 §16.3 static hardware that used to be
  // stamped on the pairing code and now lives on the enrolled device. A PATCH: each field is optional
  // and only a NAMED field is written, so the editor can send just what it changed.
  app.patch("/management-api/devices/:id/hardware", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // A malformed id names no device — a clean `device.not_found` (404), never a `22P02` 500. The
      // same id screen the revoke / assign-device-profile routes run before `gated`.
      if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
      // Read via `readJsonBody` (empty/malformed/`null` → `{}`, never an opaque 500), then screen each
      // NAMED field to its column shape before it reaches the DB (never a downstream 22xxx 500):
      // `receiptPrinterId`/`cardReaderId` accept an explicit `null` to CLEAR them; `hasCashDrawer` must
      // be a boolean; `cardProvider` is the ONE value-domain screen — an unknown provider is
      // `management.request_invalid` (the column is plain `text`, so the route is its authority).
      const body = await readJsonBody<{
        receiptPrinterId?: unknown;
        hasCashDrawer?: unknown;
        cardProvider?: unknown;
        cardReaderId?: unknown;
      }>(c);
      const set: {
        receiptPrinterId?: string | null;
        hasCashDrawer?: boolean;
        cardProvider?: string;
        cardReaderId?: string | null;
      } = {};
      if ("receiptPrinterId" in body) {
        set.receiptPrinterId = requireNullableBodyUuid(body.receiptPrinterId, "receiptPrinterId");
      }
      if ("hasCashDrawer" in body) {
        if (typeof body.hasCashDrawer !== "boolean") {
          throw new AppError("management.request_invalid", { field: "hasCashDrawer" });
        }
        set.hasCashDrawer = body.hasCashDrawer;
      }
      if ("cardProvider" in body) {
        set.cardProvider = requireEnum(body.cardProvider, "cardProvider", CARD_PROVIDERS);
      }
      if ("cardReaderId" in body) {
        set.cardReaderId = requireNullableString(body.cardReaderId, "cardReaderId");
      }
      // A PATCH that names no hardware field changes nothing — a request-shape fault rather than an
      // empty `UPDATE … SET` (invalid SQL). The editor always names the hardware it manages.
      if (Object.keys(set).length === 0) {
        throw new AppError("management.request_invalid", { field: "hardware" });
      }
      // Tenant + id scope — a by-id write STILL scopes to the tenant (CLAUDE.md §3: one-tenant-per-db
      // is not the query's isolation boundary), so another tenant's device id updates 0 rows → 404, the
      // assign-device-profile / revoke by-id idiom. A `receiptPrinterId` naming no printer of this
      // tenant reaches the composite `devices_receipt_printer_fk` and is translated to
      // `device.binding_invalid` naming the field (the same `bindingFkField` helper + shape the reassign
      // route uses); any other error rethrows raw.
      let updated: {
        id: string;
        receiptPrinterId: string | null;
        hasCashDrawer: boolean;
        cardProvider: string;
        cardReaderId: string | null;
      }[];
      try {
        updated = await gated(sessionId, (tx) =>
          tx.update(devices).set(set).where(ownDeviceById(id)).returning({
            id: devices.id,
            receiptPrinterId: devices.receiptPrinterId,
            hasCashDrawer: devices.hasCashDrawer,
            cardProvider: devices.cardProvider,
            cardReaderId: devices.cardReaderId,
          }),
        );
      } catch (error) {
        if (bindingFkField(error) === "receiptPrinterId") {
          throw new AppError("device.binding_invalid", { field: "receiptPrinterId" });
        }
        throw error;
      }
      if (updated.length === 0) throw new AppError("device.not_found", { deviceId: id });
      return c.json(updated[0], 200);
    }),
  );

  // ── Dev-only per-tab device switcher list (SP-C) ─────────────────────────────────────────────────────
  // Mounted ONLY in devMode, so outside dev this route DOES NOT EXIST (404) — the same fail-closed shape
  // as the override header. The chooser lists the venue's active devices so a browser can adopt one via
  // the dev-override header; the mint-and-adopt and reset routes it used to sit beside are gone (the
  // enrol flow's `DEMO` code covers dev enrolment). The read runs under `withTenant` + `asAppUser`;
  // nothing here returns a token or reader credential.
  if (deps.devMode) {
    app.get("/api/dev/devices", (c) =>
      run(c, log, async () =>
        c.json(
          await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
            await asAppUser(tx);
            // Active-only projection — the switcher chooses among devices a browser can BECOME, and a
            // revoked device is not one. NO token/tokenHash column is selected: the credential never
            // leaves the enrol Set-Cookie header (§device-session), so this list carries only bindings.
            // The device KIND is derived from the profile's form factor (`kindOfFormFactor`) through an
            // inner join on the tenant-consistent (tenant_id, device_profile_id), always matching since
            // `device_profile_id` is NOT NULL with a RESTRICT FK.
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
              .innerJoin(
                deviceProfiles,
                and(
                  eq(deviceProfiles.tenantId, devices.tenantId),
                  eq(deviceProfiles.id, devices.deviceProfileId),
                ),
              )
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
