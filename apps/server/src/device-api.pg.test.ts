import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { mountDeviceApi } from "./device-api.js";
import {
  ENROL_RATE_MAX,
  ENROL_RATE_WINDOW_MS,
  createEnrolRateLimiter,
  type EnrolRateLimiter,
} from "./enrol-rate-limit.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { PENDING_CAP, acceptDeviceJoinRequest, denyJoinRequest } from "./join-requests.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS surface (CLAUDE.md §4). These routes read and write
// as `app_user` (enrol INSERTs a device, requireDevice SELECTs+UPDATEs it, the management group
// reads/revokes), so the table grants are enforced; PGlite connects as a superuser holding every
// privilege, where a missing GRANT passes and fails only at runtime. Each test provisions its OWN
// tenant, so its device/queue reads are that test's alone and order-independent across the shared
// clone.
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

// The accountable operator every placing amendment is attributed to (a plain uuid, no FK — the shape
// working-order.pg.test.ts uses).
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the stub the sibling fiscal suites use. */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("device-api.pg.test: anchor() is not used here");
    },
    currentAnchor: () => null,
  };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("device-api.pg.test: resolveClient must never be called")),
  });
});

/** Park + place a two-line order (café, agua) so both lines FIRE to the default station, returning the
 *  ticket item ids in `line_no` order (owner read). The per-line bump / foreign-station targets. */
async function fireOrder(venue: Venue): Promise<{ orderId: string; items: string[] }> {
  const orderId = randomUUID();
  await parkOrder({ db: suite.admin }, venue.cfg, {
    id: orderId,
    lines: [
      { productId: venue.cafeId, quantity: "1" },
      { productId: venue.aguaId, quantity: "1" },
    ],
    label: "Mesa 7",
  });
  await placeOrder(
    { db: suite.admin, backend, clock },
    venue.cfg,
    orderId,
    OPERATOR,
    venue.cfg.tillId,
  );
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select ti.id from ticket_items ti
    join working_order_lines wol on wol.id = ti.working_order_line_id and wol.tenant_id = ti.tenant_id
    where ti.working_order_id = ${orderId}
    order by wol.line_no`);
  return { orderId, items: rows.map((r) => r.id) };
}

/** Move a ticket item to a DIFFERENT station (owner SQL, fixture setup) — manufactures a "foreign
 *  station" item the device bound to the default station may not bump. */
async function moveItemToStation(itemId: string, stationId: string): Promise<void> {
  await suite.admin.execute(
    sql`update ticket_items set station_id = ${stationId} where id = ${itemId}`,
  );
}

/** Seed a `cloud_poll` printer for the venue (owner SQL) — needs only a poll id, so no print agent has
 *  to be seeded to satisfy the transport CHECK. A real `(tenant_id, id)` a device binding can name. */
async function seedPrinter(cfg: TillConfig): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into printers (tenant_id, location_id, name, transport, poll_id)
    values (${cfg.tenantId}, ${cfg.locationId}, 'Recibos', 'cloud_poll', 'poll-abc')
    returning id`);
  return rows[0]!.id;
}

/** The enrolled device row's binding columns, read as the superuser. */
async function deviceBindings(deviceId: string): Promise<Record<string, unknown>> {
  const { rows } = await suite.admin.execute<Record<string, unknown>>(sql`
    select till_id, device_profile_id, receipt_printer_id, has_cash_drawer
    from devices where id = ${deviceId}`);
  return rows[0]!;
}

/** The window each mounted app was given. A fixture opens the door on the app it was handed, so the
 *  call sites that only ever wanted "a device exists" do not each thread the holder through. */
const windows = new WeakMap<Hono, PairingMode>();

function mountApp(
  cfg: TillConfig,
  enrolRateLimiter?: EnrolRateLimiter,
  pairingMode: PairingMode = createPairingMode(),
): Hono {
  const app = new Hono();
  windows.set(app, pairingMode);
  // `enrolRateLimiter` omitted → mountDeviceApi builds the DEFAULT (generous 30/min) limiter, which no
  // ordinary suite trips. The rate-limit test below injects a limiter over a controllable clock (the cap
  // is the baked-in `ENROL_RATE_MAX` — no longer injectable — so it pre-fills the window in-process).
  // The window defaults to a FRESH shut holder, so a suite that never opens it cannot knock.
  mountDeviceApi(
    app,
    { db: suite.admin, cfg, secureCookies: false, enrolRateLimiter, pairingMode },
    noopLog,
  );
  return app;
}

/** A device API mounted with an explicit `devMode` flag — the SP-C dev per-tab device switcher surface
 *  (`GET /api/dev/devices`) exists ONLY when `devMode === true`, and 404s otherwise. The plain
 *  `mountApp` above omits the flag (undefined → dev routes not mounted), which is the fail-closed
 *  production shape. */
function mountDevApp(cfg: TillConfig, devMode: boolean): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  windows.set(app, pairingMode);
  mountDeviceApi(
    app,
    { db: suite.admin, cfg, secureCookies: false, devMode, pairingMode },
    noopLog,
  );
  return app;
}

/** JSON request helper. `cookie: null` sends none; omitted sends none too (each caller is explicit).
 *  `host` overrides the request `Host` header — the enrol/reset Domain-scoping tests drive
 *  `cookieDomainFor(c.req.header("host"), …)` through it. */
async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH",
  path: string,
  opts: { body?: unknown; cookie?: string | null; host?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined && opts.cookie !== null) headers["cookie"] = opts.cookie;
  if (opts.host !== undefined) headers["host"] = opts.host;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

/** The `<name>=<value>` cookie pair the enrol response set — the jar a device carries thereafter. */
function deviceCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  return setCookie!.split(";")[0]!;
}

/** Seed a `device_profiles` row of the given FORM FACTOR (a device is DEFINED by its profile since Task
 *  7). A per-suite counter keeps the tenant-unique name from colliding across the shared clone. */
let profileCounter = 0;
async function seedProfile(
  cfg: TillConfig,
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
  capabilities: string[] = [],
): Promise<string> {
  profileCounter += 1;
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor, capabilities)
    values (${cfg.tenantId}, ${`Profile ${profileCounter}`}, ${formFactor}, ${JSON.stringify(capabilities)}::jsonb)
    returning id`);
  return rows[0]!.id;
}

/**
 * Knock on `app` with an OPEN window, then accept the request directly on `suite.admin` with its own
 * number — the two halves of production enrolment, the first through the real route (so the cookie
 * under test is the one the route set) and the second through the verb, because the accept ROUTE is
 * Task 8's. Returns the joiner's cookie jar and the id the accept carried onto the `devices` row.
 */
async function knockAndAccept(
  app: Hono,
  venue: Venue,
  input: { name: string; profileId: string; stationId?: string; registerId?: string },
): Promise<{ deviceId: string; jar: string; formFactor: string }> {
  windows.get(app)!.open();
  const res = await send(app, "POST", "/api/device/join", { body: { name: input.name } });
  expect(res.status).toBe(200);
  const knock = (await res.json()) as { joinId: string; verificationNumber: string };
  const accepted = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return acceptDeviceJoinRequest(tx, venue.cfg, knock.joinId, {
      choice: knock.verificationNumber,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
      registerId: input.registerId ?? null,
    });
  });
  if (!accepted.ok) throw new Error("device-api.pg.test: the fixture's own number mismatched");
  return {
    deviceId: accepted.deviceId,
    jar: deviceCookieFrom(res),
    formFactor: accepted.formFactor,
  };
}

/** Enrol a `kds` device bound to `stationId`. Returns the device id + the cookie jar. */
async function enrolKds(
  app: Hono,
  venue: Venue,
  stationId: string,
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const profileId = await seedProfile(venue.cfg, "kds");
  const { deviceId, jar } = await knockAndAccept(app, venue, {
    name: "Pantalla Cocina",
    profileId,
    stationId,
  });
  return { deviceId, jar, profileId };
}

/** Enrol a `till` device (its profile auto-creates the register it rings against). Returns the device id
 *  + the cookie jar. */
async function enrolTill(
  app: Hono,
  venue: Venue,
  name = "Caja nueva",
): Promise<{ deviceId: string; jar: string; profileId: string; formFactor: string }> {
  const profileId = await seedProfile(venue.cfg, "till");
  const { deviceId, jar, formFactor } = await knockAndAccept(app, venue, { name, profileId });
  return { deviceId, jar, profileId, formFactor };
}

/** Enrol a `handheld` device bound to an EXISTING register (`registerId`). Returns the device id + jar. */
async function enrolHandheld(
  app: Hono,
  venue: Venue,
  registerId: string,
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const profileId = await seedProfile(venue.cfg, "phone-portrait");
  const { deviceId, jar } = await knockAndAccept(app, venue, {
    name: "Waiter phone",
    profileId,
    registerId,
  });
  return { deviceId, jar, profileId };
}

describe("POST /api/device/join", () => {
  it("refuses with device.pairing_closed when the window is shut, and touches NO row", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.pairing_closed",
    );
    // The refusal happens before any DB work: no row, so a flood cannot fill the pending cap or the
    // connection pool (CLAUDE.md §5 — nothing external may block a sale).
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from join_requests where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(rows[0]!.n).toBe(0);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mode.refusedRecently()).toBe(1);
  });

  it("mints a request, sets the cookie and returns the number when the window is open", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.verificationNumber).toMatch(/^\d{2}$/);
    expect(body.joinId).toMatch(/^[0-9a-f-]{36}$/);
    // The token leaves the process ONLY in the cookie, never in the body.
    expect(body).toEqual({ joinId: expect.any(String), verificationNumber: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("token");
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${DEVICE_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    // The cookie's SELECTOR is the join request's id — the id accept carries onto the devices row.
    expect(deviceCookieFrom(res)).toContain(`${DEVICE_COOKIE}=${body.joinId as string}.`);
    // The row is this tenant's, pending, and carries the number that came back.
    const { rows } = await suite.admin.execute<{ label: string; verification_number: string }>(
      sql`select label, verification_number from join_requests
           where tenant_id = ${venue.cfg.tenantId} and id = ${body.joinId as string}`,
    );
    expect(rows[0]).toMatchObject({
      label: "Bar till",
      verification_number: body.verificationNumber,
    });
  });

  it("requires a name", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: {} });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });
  });

  it("refuses an EMPTY or MALFORMED body with 400 management.request_invalid, never a 500", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);

    const empty = await app.request("/api/device/join", { method: "POST" });
    expect(empty.status).toBe(400);
    expect(
      (await empty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    const malformed = await app.request("/api/device/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("is rate limited BEFORE the window is consulted and before any DB work", async () => {
    // The window is SHUT, so a 403 would also be a plausible answer — the 429 is what proves the
    // limiter runs FIRST, and the absent `noteRefused` proves the window was never consulted.
    const venue = await setupVenue(suite.admin);
    const limiter = createEnrolRateLimiter({ now: () => 1_000 });
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, limiter, mode);
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();

    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.join_rate_limited",
    );
    expect(mode.refusedRecently()).toBe(0);
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from join_requests where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("scopes the cookie Domain to the tenant host, host-only otherwise", async () => {
    const venue = await setupVenue(suite.admin);
    const app = new Hono();
    const mode = createPairingMode();
    mode.open();
    mountDeviceApi(
      app,
      {
        db: suite.admin,
        cfg: venue.cfg,
        secureCookies: false,
        pairingMode: mode,
        tenantDomain: "deli.waitron.app",
      },
      noopLog,
    );
    const knock = (host: string): Promise<Response> =>
      send(app, "POST", "/api/device/join", { body: { name: `Caja ${host}` }, host });

    const scoped = await knock("box.deli.waitron.app");
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("set-cookie") ?? "").toMatch(/Domain=deli\.waitron\.app/i);

    const hostOnly = await knock("waitron.local");
    expect(hostOnly.status).toBe(200);
    expect(hostOnly.headers.get("set-cookie") ?? "").not.toMatch(/Domain=/i);
  });

  it("refuses the (cap+1)th pending knock with device.join_full (429)", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    for (let i = 0; i < PENDING_CAP; i++) {
      const ok = await send(app, "POST", "/api/device/join", { body: { name: `Caja ${i}` } });
      expect(ok.status).toBe(200);
    }
    const full = await send(app, "POST", "/api/device/join", { body: { name: "Uno más" } });
    expect(full.status).toBe(429);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe(
      "device.join_full",
    );
  });
});

describe("devMode auto-accept", () => {
  it("auto-accepts a knock with the venue's default till profile, and the cookie works immediately", async () => {
    // The window is NEVER opened (mountDevApp builds a fresh shut holder), so in production this knock
    // would 403. devMode holds it open and accepts the request in the same transaction with the venue's
    // provisioned default `till` profile, so the joiner's cookie is a working device cookie at once — no
    // window, no approval step.
    const venue = await setupVenue(suite.admin);
    const app = mountDevApp(venue.cfg, true);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(res.status).toBe(200);

    const me = await send(app, "GET", "/api/device/me", { cookie: deviceCookieFrom(res) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: "Dev till", formFactor: "till" });

    // The request row is CONSUMED by the accept — it is now a device, not a pending join.
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from join_requests where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("404s device_profile.not_found when the venue has no default till profile, rolling the request back", async () => {
    const venue = await setupVenue(suite.admin);
    // Remove the provisioned default `till` profile (no device references it yet, so the RESTRICT FK is
    // not tripped). Auto-accept then has no default to resolve.
    await suite.admin.execute(
      sql`delete from device_profiles where tenant_id = ${venue.cfg.tenantId} and form_factor = 'till'`,
    );
    const app = mountDevApp(venue.cfg, true);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device_profile.not_found",
    );
    // The throw is inside the same transaction as the mint, so the just-created request is rolled back —
    // no orphan pending row nobody can approve.
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from join_requests where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("outside devMode the same knock still needs an open window (403)", async () => {
    const venue = await setupVenue(suite.admin);
    const res = await send(mountDevApp(venue.cfg, false), "POST", "/api/device/join", {
      body: { name: "x" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.pairing_closed",
    );
  });
});

describe("GET /api/device/join/status", () => {
  it("is pending, then approved once accepted, on the SAME cookie", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    expect(knock.status).toBe(200);
    const jar = deviceCookieFrom(knock);
    const { joinId, verificationNumber } = (await knock.json()) as {
      joinId: string;
      verificationNumber: string;
    };

    const pending = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });

    const profileId = await seedProfile(venue.cfg, "till");
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return acceptDeviceJoinRequest(tx, venue.cfg, joinId, {
        choice: verificationNumber,
        profileId,
      });
    });

    // The SAME cookie, unchanged: the selector is the request's id, which accept carried onto the
    // devices row, so the joiner's cookie is set once at the knock and never re-issued.
    const approved = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "approved" });
    expect(approved.headers.get("set-cookie")).toBeNull();

    // And it is a working device cookie — no second enrolment step.
    const me = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(me.status).toBe(200);
    expect((await me.json()) as { deviceId: string }).toMatchObject({ deviceId: joinId });
  });

  it("is not_approved after a deny, and for a cookie that names nothing", async () => {
    const venue = await setupVenue(suite.admin);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    const jar = deviceCookieFrom(knock);
    const { joinId } = (await knock.json()) as { joinId: string };

    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return denyJoinRequest(tx, venue.cfg, joinId);
    });
    const denied = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({ status: "not_approved" });

    // A well-formed cookie naming no request and no device folds into the SAME answer — denied,
    // lapsed and never-existed are one recovery.
    const stranger = await send(app, "GET", "/api/device/join/status", {
      cookie: `${DEVICE_COOKIE}=${randomUUID()}.not-the-token`,
    });
    expect(stranger.status).toBe(200);
    expect(await stranger.json()).toEqual({ status: "not_approved" });
  });

  it("401s without a cookie, and for a cookie that is not `<uuid>.<token>`", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const none = await send(app, "GET", "/api/device/join/status", { cookie: null });
    expect(none.status).toBe(401);
    expect((await none.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });

    for (const raw of [
      "no-dot-at-all",
      ".leading-dot",
      `${randomUUID()}.`,
      "not-a-uuid.sometoken",
    ]) {
      const res = await send(app, "GET", "/api/device/join/status", {
        cookie: `${DEVICE_COOKIE}=${raw}`,
      });
      expect(res.status).toBe(401);
    }
  });
});

describe("Device API over real Postgres — the device-guarded routes", () => {
  it("enrols, sets the cookie, auto-creates a till's register, and /me reports it", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { deviceId, jar } = await enrolTill(app, venue, "Caja del bar");

    // The device row carries an auto-created register (a till device rings its own).
    const tillId = (await deviceBindings(deviceId)).till_id;
    expect(tillId).toEqual(expect.any(String));

    const me = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      deviceId,
      formFactor: "till",
      name: "Caja del bar",
      stationId: null,
      tillId,
    });
  });

  it("enrol → authenticated station read → bump own item → foreign 403 → revoke stops the cookie", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);

    const fria = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createStation(tx, venue.cfg, { name: "Fría", isDefault: false });
    });
    const { items } = await fireOrder(venue);
    const [ownItem, foreignItem] = items;
    await moveItemToStation(foreignItem!, fria.id);

    const { deviceId, jar } = await enrolKds(app, venue, venue.defaultStationId);

    const stationRes = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(stationRes.status).toBe(200);
    const station = (await stationRes.json()) as {
      station: { id: string; queue: { items: { id: string }[] }[] };
    };
    expect(station.station.id).toBe(venue.defaultStationId);
    const queuedItemIds = station.station.queue.flatMap((g) => g.items.map((i) => i.id));
    expect(queuedItemIds).toContain(ownItem);
    expect(queuedItemIds).not.toContain(foreignItem);

    const bump = await send(app, "POST", `/api/device/ticket-items/${ownItem}/advance`, {
      cookie: jar,
      body: { to: "preparing" },
    });
    expect(bump.status).toBe(204);

    const foreign = await send(app, "POST", `/api/device/ticket-items/${foreignItem}/advance`, {
      cookie: jar,
      body: { to: "preparing" },
    });
    expect(foreign.status).toBe(403);
    expect(
      (await foreign.json()) as { error: { code: string; params: { stationId: string } } },
    ).toMatchObject({
      error: { code: "device.forbidden_station", params: { stationId: fria.id } },
    });

    const revoke = await send(app, "POST", `/management-api/devices/${deviceId}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(revoke.status).toBe(204);

    const afterRevoke = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(afterRevoke.status).toBe(401);
    expect((await afterRevoke.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });

  it("the device routes refuse a missing / malformed cookie with 401 device.unauthorized", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const noCookie = await send(app, "GET", "/api/device/station", { cookie: null });
    expect(noCookie.status).toBe(401);
    expect((await noCookie.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
    const garbage = await send(app, "GET", "/api/device/station", {
      cookie: `${DEVICE_COOKIE}=not-a-valid-cookie`,
    });
    expect(garbage.status).toBe(401);
  });

  it("advance refuses a bad transition and a malformed item id with 409 ticket.invalid_transition", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { items } = await fireOrder(venue);
    const { jar } = await enrolKds(app, venue, venue.defaultStationId);

    const skip = await send(app, "POST", `/api/device/ticket-items/${items[0]}/advance`, {
      cookie: jar,
      body: { to: "ready" },
    });
    expect(skip.status).toBe(409);
    expect((await skip.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ticket.invalid_transition" },
    });

    const malformed = await send(app, "POST", "/api/device/ticket-items/not-a-uuid/advance", {
      cookie: jar,
      body: { to: "preparing" },
    });
    expect(malformed.status).toBe(409);
  });

  it("advance with an EMPTY, MALFORMED, or null body degrades to 409 ticket.invalid_transition, never a 500", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { items } = await fireOrder(venue);
    const { jar } = await enrolKds(app, venue, venue.defaultStationId);

    const empty = await app.request(`/api/device/ticket-items/${items[0]}/advance`, {
      method: "POST",
      headers: { cookie: jar },
    });
    expect(empty.status).toBe(409);

    const malformedBody = await app.request(`/api/device/ticket-items/${items[0]}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: "{",
    });
    expect(malformedBody.status).toBe(409);

    const nullBody = await send(app, "POST", `/api/device/ticket-items/${items[0]}/advance`, {
      cookie: jar,
      body: null,
    });
    expect(nullBody.status).toBe(409);
  });
});

describe("Device management routes (device.manage)", () => {
  it("require device.manage — 401 unauthenticated, 403 for a staff session", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const DUMMY = "00000000-0000-0000-0000-000000000000";

    for (const res of [
      await send(app, "GET", "/management-api/devices", {}),
      await send(app, "POST", `/management-api/devices/${DUMMY}/revoke`, {}),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });
    }

    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };
    await expect403(
      await send(app, "GET", "/management-api/devices", { cookie: venue.staffCookie }),
    );
    await expect403(
      await send(app, "POST", `/management-api/devices/${DUMMY}/revoke`, {
        cookie: venue.staffCookie,
      }),
    );
  });

  it("GET /management-api/devices lists this tenant's devices, kind derived from the profile", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { deviceId, profileId } = await enrolKds(app, venue, venue.defaultStationId);
    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      id: string;
      kind: string;
      stationId: string;
      deviceProfileId: string;
      label: string;
      active: boolean;
    }[];
    expect(rows.find((r) => r.id === deviceId)).toMatchObject({
      kind: "kds_station",
      stationId: venue.defaultStationId,
      deviceProfileId: profileId,
      label: "Pantalla Cocina",
      active: true,
    });
  });

  it("revoke of an unknown / malformed device id → 404 device.not_found", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const unknown = randomUUID();
    const res = await send(app, "POST", `/management-api/devices/${unknown}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(res.status).toBe(404);
    expect(
      (await res.json()) as { error: { code: string; params: { deviceId: string } } },
    ).toMatchObject({ error: { code: "device.not_found", params: { deviceId: unknown } } });

    const malformed = await send(app, "POST", "/management-api/devices/not-a-uuid/revoke", {
      cookie: venue.managerCookie,
    });
    expect(malformed.status).toBe(404);
  });

  it("contains cross-tenant management: A cannot list, revoke, or reassign B's device", async () => {
    // RUN, not read (CLAUDE.md §3/§4): enrol a device in venue B, then drive venue A's management mount
    // against B's globally-unique device id. Since RLS was dropped (#255) the by-id list/revoke/assign
    // must each carry their OWN tenant scope, or A reaches across the id into B's row. Proven against
    // real Postgres as `app_user`.
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const appA = mountApp(venueA.cfg);
    const appB = mountApp(venueB.cfg);
    const { deviceId, profileId } = await enrolTill(appB, venueB, "Caja B");

    // (1) A's LIST omits B's device entirely — an unscoped SELECT would return every tenant's rows.
    const list = await send(appA, "GET", "/management-api/devices", {
      cookie: venueA.managerCookie,
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === deviceId)).toBeUndefined();

    // (2) A's REVOKE 404s — an unscoped UPDATE would flip B's device inactive.
    const revoke = await send(appA, "POST", `/management-api/devices/${deviceId}/revoke`, {
      cookie: venueA.managerCookie,
    });
    expect(revoke.status).toBe(404);
    expect((await revoke.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.not_found" },
    });

    // (3) A's REASSIGN 404s. The target is a SECOND profile of B's tenant, so the composite FK
    // `(tenant_id, device_profile_id)` would NOT block an unscoped UPDATE — it would reassign B's device.
    // Only the tenant predicate stops it. (A's own profile would 400 on the FK instead, a weaker proof.)
    const targetOnB = await seedProfile(venueB.cfg, "till");
    const assign = await send(
      appA,
      "POST",
      `/management-api/devices/${deviceId}/assign-device-profile`,
      { cookie: venueA.managerCookie, body: { deviceProfileId: targetOnB } },
    );
    expect(assign.status).toBe(404);

    // B's device is intact: still active, still on its own enrol profile.
    const after = await suite.admin.execute<{ active: boolean; device_profile_id: string }>(
      sql`select active, device_profile_id from devices where id = ${deviceId}`,
    );
    expect(after.rows[0]).toMatchObject({ active: true, device_profile_id: profileId });
  });

  describe("assign-device-profile (reassign only — the profile is NOT NULL since Task 7)", () => {
    it("reassigns a device to another of this tenant's profiles", async () => {
      const venue = await setupVenue(suite.admin);
      const app = mountApp(venue.cfg);
      const { deviceId } = await enrolKds(app, venue, venue.defaultStationId);
      const target = await seedProfile(venue.cfg, "kds");

      const assign = await send(
        app,
        "POST",
        `/management-api/devices/${deviceId}/assign-device-profile`,
        { cookie: venue.managerCookie, body: { deviceProfileId: target } },
      );
      expect(assign.status).toBe(204);
      expect((await deviceBindings(deviceId)).device_profile_id).toBe(target);
    });

    it("rejects a nonexistent / cross-tenant / absent profile — device untouched", async () => {
      const venue = await setupVenue(suite.admin);
      const foreign = await setupVenue(suite.admin);
      const app = mountApp(venue.cfg);
      const foreignProfile = await seedProfile(foreign.cfg, "kds");
      const { deviceId, profileId } = await enrolKds(app, venue, venue.defaultStationId);

      for (const badProfile of [randomUUID(), foreignProfile]) {
        const res = await send(
          app,
          "POST",
          `/management-api/devices/${deviceId}/assign-device-profile`,
          { cookie: venue.managerCookie, body: { deviceProfileId: badProfile } },
        );
        expect(res.status).toBe(400);
        expect(
          (await res.json()) as { error: { code: string; params: { field: string } } },
        ).toMatchObject({
          error: { code: "device.binding_invalid", params: { field: "deviceProfileId" } },
        });
        expect((await deviceBindings(deviceId)).device_profile_id).toBe(profileId);
      }

      // An absent target is a request-shape 400 (the profile is required — it cannot be cleared).
      const absent = await send(
        app,
        "POST",
        `/management-api/devices/${deviceId}/assign-device-profile`,
        { cookie: venue.managerCookie, body: {} },
      );
      expect(absent.status).toBe(400);
      expect(
        (await absent.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "deviceProfileId" } },
      });
    });

    it("with an unknown or malformed device id → 404 device.not_found", async () => {
      const venue = await setupVenue(suite.admin);
      const app = mountApp(venue.cfg);
      const profileId = await seedProfile(venue.cfg, "kds");
      const unknown = randomUUID();
      const res = await send(
        app,
        "POST",
        `/management-api/devices/${unknown}/assign-device-profile`,
        { cookie: venue.managerCookie, body: { deviceProfileId: profileId } },
      );
      expect(res.status).toBe(404);

      const malformed = await send(
        app,
        "POST",
        "/management-api/devices/not-a-uuid/assign-device-profile",
        { cookie: venue.managerCookie, body: { deviceProfileId: profileId } },
      );
      expect(malformed.status).toBe(404);
    });
  });
});

describe("PATCH /management-api/devices/:id/hardware (device.manage)", () => {
  it("sets the receipt printer + cash drawer and returns the updated device", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja hw");

    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.managerCookie,
      body: {
        receiptPrinterId: printerId,
        hasCashDrawer: true,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: deviceId,
      receiptPrinterId: printerId,
      hasCashDrawer: true,
    });
    // The row itself carries the new bindings (read back as the superuser, bypassing the route).
    expect(await deviceBindings(deviceId)).toMatchObject({
      receipt_printer_id: printerId,
      has_cash_drawer: true,
    });
  });

  it("requires device.manage — 401 unauthenticated, 403 for a staff session", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja gate");

    const unauth = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      body: { hasCashDrawer: true },
    });
    expect(unauth.status).toBe(401);
    expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    const staff = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.staffCookie,
      body: { hasCashDrawer: true },
    });
    expect(staff.status).toBe(403);
    expect((await staff.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("404s an unknown or malformed device id", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const unknown = randomUUID();
    const res = await send(app, "PATCH", `/management-api/devices/${unknown}/hardware`, {
      cookie: venue.managerCookie,
      body: { hasCashDrawer: true },
    });
    expect(res.status).toBe(404);
    expect(
      (await res.json()) as { error: { code: string; params: { deviceId: string } } },
    ).toMatchObject({ error: { code: "device.not_found", params: { deviceId: unknown } } });

    const malformed = await send(app, "PATCH", "/management-api/devices/not-a-uuid/hardware", {
      cookie: venue.managerCookie,
      body: { hasCashDrawer: true },
    });
    expect(malformed.status).toBe(404);
  });

  it("404s a FOREIGN tenant's device — the update is tenant-scoped, not just by id", async () => {
    // Enrol a device in venue A, then PATCH it through venue B's mount (cfg B). A by-id write STILL
    // scopes to the tenant (CLAUDE.md §3), so B's UPDATE matches 0 rows and 404s rather than reaching
    // across the (globally-unique) id. RUN, not read: proven against real Postgres as `app_user`.
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const appA = mountApp(venueA.cfg);
    const appB = mountApp(venueB.cfg);
    const { deviceId } = await enrolTill(appA, venueA, "Caja A");

    const res = await send(appB, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venueB.managerCookie,
      body: { hasCashDrawer: true },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.not_found" },
    });
    // Venue A's device is untouched — B's scoped UPDATE never reached it.
    expect((await deviceBindings(deviceId)).has_cash_drawer).toBe(false);
  });

  it("rejects a receiptPrinterId naming no printer of this tenant with device.binding_invalid", async () => {
    const venue = await setupVenue(suite.admin);
    const foreign = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const foreignPrinter = await seedPrinter(foreign.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja fk");

    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.managerCookie,
      body: { receiptPrinterId: foreignPrinter },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "device.binding_invalid", params: { field: "receiptPrinterId" } },
    });
  });
});

describe("GET /api/device/me + station (SP-A.2 §16)", () => {
  it("reports an enrolled handheld's formFactor + name, station null", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { deviceId, jar } = await enrolHandheld(app, venue, venue.cfg.tillId);
    const res = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deviceId,
      formFactor: "phone-portrait",
      name: "Waiter phone",
      stationId: null,
      tillId: venue.cfg.tillId,
    });
  });

  it("echoes the device's hardware bindings (set as the dashboard would)", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);
    const { deviceId, jar } = await enrolTill(app, venue, "Caja hw");
    await suite.admin.execute(sql`
      update devices
         set receipt_printer_id = ${printerId}, has_cash_drawer = true
       where id = ${deviceId}`);
    const tillId = (await deviceBindings(deviceId)).till_id;

    const res = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deviceId,
      formFactor: "till",
      name: "Caja hw",
      stationId: null,
      tillId,
      receiptPrinterId: printerId,
      hasCashDrawer: true,
    });
  });

  it("GET /api/device/station 401s an enrolled handheld — it is bound to no station", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const { jar } = await enrolHandheld(app, venue, venue.cfg.tillId);
    const res = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });

  it("GET /api/device/me 401s a request with no device cookie", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/api/device/me", { cookie: null });
    expect(res.status).toBe(401);
  });
});

describe("join rate limiter (spec §8)", () => {
  it("rate-limits the knock: the (cap+1)th is 429 BEFORE the DB, then the window resets", async () => {
    const venue = await setupVenue(suite.admin);
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, limiter, mode);

    // Pre-fill the window in-process (the cap is the baked-in `ENROL_RATE_MAX`, not injectable),
    // leaving room for exactly two admitted knocks.
    for (let i = 0; i < ENROL_RATE_MAX - 2; i++) limiter.check();

    for (const name of ["Caja 1", "Caja 2"]) {
      const ok = await send(app, "POST", "/api/device/join", { body: { name } });
      expect(ok.status).toBe(200);
    }

    const limited = await send(app, "POST", "/api/device/join", { body: { name: "Caja 3" } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.join_rate_limited" },
    });
    // Refused before any DB work: only the two admitted knocks left rows.
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from join_requests where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(rows[0]!.n).toBe(2);

    // Past the window the counter resets and a knock is admitted again.
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const after = await send(app, "POST", "/api/device/join", { body: { name: "Caja 4" } });
    expect(after.status).toBe(200);
  });
});

describe("GET /api/dev/devices (dev-only chooser list)", () => {
  it("lists the venue's active devices (kind derived), no option-sources, no token", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountDevApp(venue.cfg, true);
    // Enrol through a NON-dev mount: a devMode knock now auto-accepts as a till (this task), so the full
    // knock+accept helper — which enrols a KDS bound to a station — runs against a production mount. The
    // dev list reads the same tenant's devices, so the route under test still sees the KDS device.
    const { deviceId } = await enrolKds(mountApp(venue.cfg), venue, venue.defaultStationId);

    const res = await send(app, "GET", "/api/dev/devices");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { devices: Record<string, unknown>[] };
    const device = body.devices.find((d) => d.id === deviceId)!;
    expect(device).toMatchObject({
      id: deviceId,
      kind: "kds_station",
      stationId: venue.defaultStationId,
      active: true,
    });
    expect(device).not.toHaveProperty("token");
    expect(device).not.toHaveProperty("tokenHash");
    // The mint option-sources the old chooser advertised are gone (the dev mint route was removed).
    expect(body).not.toHaveProperty("tills");
    expect(body).not.toHaveProperty("stations");
    expect(body).not.toHaveProperty("deviceProfiles");
  });

  it("lists only ACTIVE devices — a revoked device is omitted", async () => {
    const venue = await setupVenue(suite.admin);
    const app = mountDevApp(venue.cfg, true);
    // Enrol through a non-dev mount (a devMode knock auto-accepts as a till now); the dev list reads the
    // same tenant's devices.
    const enrolApp = mountApp(venue.cfg);
    const live = await enrolKds(enrolApp, venue, venue.defaultStationId);
    const doomed = await enrolKds(enrolApp, venue, venue.defaultStationId);
    expect(
      (
        await send(app, "POST", `/management-api/devices/${doomed.deviceId}/revoke`, {
          cookie: venue.managerCookie,
        })
      ).status,
    ).toBe(204);

    const body = (await (await send(app, "GET", "/api/dev/devices")).json()) as {
      devices: { id: string }[];
    };
    const ids = body.devices.map((d) => d.id);
    expect(ids).toContain(live.deviceId);
    expect(ids).not.toContain(doomed.deviceId);
  });

  it("is absent (404) when devMode is false / omitted", async () => {
    const venue = await setupVenue(suite.admin);
    expect((await send(mountDevApp(venue.cfg, false), "GET", "/api/dev/devices")).status).toBe(404);
    expect((await send(mountApp(venue.cfg), "GET", "/api/dev/devices")).status).toBe(404);
  });
});

describe("deleted routes are gone (404)", () => {
  it("POST /api/dev/devices and POST /api/device/reset no longer exist, even under devMode", async () => {
    const venue = await setupVenue(suite.admin);
    const devApp = mountDevApp(venue.cfg, true);
    expect((await send(devApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(devApp, "POST", "/api/device/reset", {})).status).toBe(404);
    const prodApp = mountApp(venue.cfg);
    expect((await send(prodApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(prodApp, "POST", "/api/device/reset", {})).status).toBe(404);
  });

  // The pairing-code flow's three routes. The mint route is the one a stale dashboard would still
  // call, so its 404 is what tells the operator the mechanism is gone rather than merely refusing.
  it.each([
    ["POST", "/api/device/enrol"],
    ["POST", "/api/device/enrol/verify"],
    ["POST", "/management-api/device-codes"],
  ])("%s %s", async (method, path) => {
    const venue = await setupVenue(suite.admin);
    const res = await send(mountApp(venue.cfg), method as "POST", path, { body: {} });
    expect(res.status).toBe(404);
  });
});
