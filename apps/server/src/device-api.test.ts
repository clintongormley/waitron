/** The device join, enrolment and management surface end to end. */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceMadeHereStations,
  devices,
  deviceProfiles,
  kitchenStations,
  printJobs,
  printers,
  stationPrinters,
  watchers,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { mountDeviceApi } from "./device-api.js";
import { listApprovedProfiles, switchActiveProfile } from "./device.js";
import {
  ENROL_RATE_MAX,
  ENROL_RATE_WINDOW_MS,
  createEnrolRateLimiter,
  type EnrolRateLimiter,
} from "./enrol-rate-limit.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { PENDING_CAP, acceptDeviceJoinRequest, denyJoinRequest } from "./join-requests.js";
import { createPairingMode, type PairingMode } from "./pairing-mode.js";
import type { Logger } from "./logger.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";
import { VENUE_SERVICE } from "./modules.js";
import { decimal } from "@waitron/shared";
import {
  deviceProfileAdmissionRoles,
  hashPin,
  loginWithPin,
  persons,
  sessions,
} from "@waitron/identity";
import { payments } from "@waitron/payments";
import { deleteDeviceProfile, setProfilePrinterLists } from "@waitron/layouts";
import "./errors.js";
import { createWatcher, removeWatcher } from "./watchers.js";
import type { WatcherBoard } from "./watcher-board.js";
import { enrolDeviceForTest, listOnProfile } from "./testing/enrol.js";
import { BASIC_ACTIONS, deviceRequestCfg } from "./testing/session-device.js";

// Every test provisions its OWN tenant, and `tenants` is a singleton (id = 1), so the per-test reset
// is what makes that legal twice in one file: `useVenueDb` empties every data table after each `it`.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const noopLog: Logger = () => {};

// The accountable operator every placing amendment is attributed to (a plain uuid, no FK).
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored. */
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
      throw new Error("device-api.test: anchor() is not used here");
    },
    currentAnchor: () => null,
  };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("device-api.test: resolveClient must never be called")),
  });
});

/** Park + place a two-line order (café, agua) so both lines FIRE to the default station, returning the
 *  ticket item ids in `line_no` order. The per-line bump / foreign-station targets. */
async function fireOrder(venue: Venue): Promise<{ orderId: string; items: string[] }> {
  const orderId = randomUUID();
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([
      { productId: venue.cafeId, quantity: "1" },
      { productId: venue.aguaId, quantity: "1" },
    ]),
    label: "Mesa 7",
  });
  await placeOrder(
    { db: suite.db, backend, clock },
    await deviceRequestCfg(suite.db, venue.cfg),
    orderId,
    OPERATOR,
  );
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    select ti.id from ticket_items ti
    join working_order_lines wol on wol.id = ti.working_order_line_id
    where ti.working_order_id = ${orderId}
    order by wol.line_no`);
  return { orderId, items: rows.map((r) => r.id) };
}

/** Move a ticket item to a DIFFERENT station — manufactures a "foreign
 *  station" item the device bound to the default station may not bump. */
async function moveItemToStation(itemId: string, stationId: string): Promise<void> {
  await suite.db.execute(
    sql`update ticket_items set station_id = ${stationId} where id = ${itemId}`,
  );
}

/** Seed a `cloud_poll` printer for the venue — needs only a poll id, so no print agent has to be
 *  seeded to satisfy the transport CHECK. Through the table definition: `printers.id` comes from a
 *  `$defaultFn` raw SQL never reaches. */
async function seedPrinter(cfg: TillConfig): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: cfg.locationId,
      name: "Recibos",
      transport: "cloud_poll",
      pollId: "poll-abc",
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function deviceBindings(deviceId: string): Promise<{
  deviceProfileId: string;
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
}> {
  const [row] = await suite.db
    .select({
      deviceProfileId: devices.deviceProfileId,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row!;
}

async function seedNamedPrinters(cfg: TillConfig, names: string[]): Promise<string[]> {
  const rows = await suite.db
    .insert(printers)
    .values(
      names.map((name) => ({
        locationId: cfg.locationId,
        name,
        transport: "network_tcp" as const,
        host: "10.0.0.7",
      })),
    )
    .returning({ id: printers.id });
  return rows.map((row) => row.id);
}

/** An open till session on `deviceId` for a new staff member, as the cookie the till sends. */
async function openTillSession(deviceId: string): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Server", pinHash: hashPin("4321"), role: "staff" })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
  );
  return `${SESSION_COOKIE}=${session.token}`;
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
  // `enrolRateLimiter` omitted → the default limiter, which no ordinary suite trips. The window
  // defaults to a FRESH shut holder, so a suite that never opens it cannot knock.
  mountDeviceApi(
    app,
    { db: suite.db, cfg, secureCookies: false, enrolRateLimiter, pairingMode },
    noopLog,
  );
  return app;
}

/** A device API mounted with an explicit `devMode` flag. */
function mountDevApp(cfg: TillConfig, devMode: boolean): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  windows.set(app, pairingMode);
  mountDeviceApi(app, { db: suite.db, cfg, secureCookies: false, devMode, pairingMode }, noopLog);
  return app;
}

/** JSON request helper. `cookie: null` sends none; omitted sends none too (each caller is explicit).
 *  `host` overrides the request `Host` header. */
async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT",
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

/** A per-file counter keeps the unique name from colliding with the profiles a single test seeds
 *  alongside it. */
let profileCounter = 0;
async function seedProfile(
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
  capabilities: string[] = [],
): Promise<string> {
  profileCounter += 1;
  // Through the table definition: `device_profiles.id`, `created_at` and `updated_at` are
  // `$defaultFn` generators raw SQL never reaches, and the column's own write mapping is what
  // serialises `capabilities`.
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({
      name: `Profile ${profileCounter}`,
      formFactor,
      capabilities: [...BASIC_ACTIONS, ...capabilities],
    })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/**
 * Knock on `app` with an OPEN window, then accept the request directly on `suite.db` under the
 * name it knocked with — the two halves of production enrolment, the first through the real route (so the cookie
 * under test is the one the route set) and the second through the verb, because the accept route is
 * `join-api.ts`'s. Returns the joiner's cookie jar and the id the accept carried onto the `devices` row.
 */
async function knockAndAccept(
  app: Hono,
  venue: Venue,
  input: { name: string; profileId: string; stationId?: string },
): Promise<{ deviceId: string; jar: string; formFactor: string }> {
  windows.get(app)!.open();
  const res = await send(app, "POST", "/api/device/join", { body: { name: input.name } });
  expect(res.status).toBe(200);
  const knock = (await res.json()) as { joinId: string };
  const accepted = await withTransaction(suite.db, async (tx) => {
    await listOnProfile(tx, input.profileId, input);
    return acceptDeviceJoinRequest(tx, venue.cfg, knock.joinId, {
      label: input.name,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
    });
  });
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
  name = "Pantalla Cocina",
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const profileId = await seedProfile("kds");
  const { deviceId, jar } = await knockAndAccept(app, venue, {
    name,
    profileId,
    stationId,
  });
  return { deviceId, jar, profileId };
}

/** Enrol a `till` device. Returns the device id + the cookie jar. */
async function enrolTill(
  app: Hono,
  venue: Venue,
  name = "Caja nueva",
): Promise<{ deviceId: string; jar: string; profileId: string; formFactor: string }> {
  const profileId = await seedProfile("till");
  const { deviceId, jar, formFactor } = await knockAndAccept(app, venue, { name, profileId });
  return { deviceId, jar, profileId, formFactor };
}

/** Enrol a `handheld` device. Returns the device id + jar. */
async function enrolHandheld(
  app: Hono,
  venue: Venue,
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const profileId = await seedProfile("phone-portrait");
  const { deviceId, jar } = await knockAndAccept(app, venue, {
    name: "Waiter phone",
    profileId,
  });
  return { deviceId, jar, profileId };
}

/** A kitchen screen showing a new watcher named `name`. */
async function enrolWatching(venue: Venue, name = "Pass") {
  const watcher = await withTransaction(suite.db, (tx) =>
    createWatcher(tx, venue.cfg, {
      name,
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: false,
    }),
  );
  const { deviceId } = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Pass screen",
    profileId: await seedProfile("kds"),
    watcherId: watcher.id,
  });
  return { deviceId, watcherId: watcher.id };
}

async function switchStationOff(stationId: string): Promise<void> {
  await suite.db
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, stationId));
}

describe("POST /api/device/join", () => {
  it("refuses with device.pairing_closed when the window is shut, and touches NO row", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, undefined, mode);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.pairing_closed",
    );
    // The refusal happens before any DB work: no row, so a flood cannot fill the pending cap.
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
    );
    expect(rows[0]!.n).toBe(0);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("mints a request, sets the cookie and returns the number when the window is open", async () => {
    const venue = await setupVenue(suite.db);
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
    // The row is pending and carries the number that came back.
    const { rows } = await suite.db.execute<{ label: string; verification_number: string }>(
      sql`select label, verification_number from join_requests
           where id = ${body.joinId as string}`,
    );
    expect(rows[0]).toMatchObject({
      label: "Bar till",
      verification_number: body.verificationNumber,
    });
  });

  it("requires a name", async () => {
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
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
    // The window is SHUT, so a limiter running second would answer 403; the 429 proves it runs FIRST.
    const venue = await setupVenue(suite.db);
    const limiter = createEnrolRateLimiter({ now: () => 1_000 });
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, limiter, mode);
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();

    const res = await send(app, "POST", "/api/device/join", { body: { name: "Bar till" } });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device.join_rate_limited",
    );
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("scopes the cookie Domain to the tenant host, host-only otherwise", async () => {
    const venue = await setupVenue(suite.db);
    const app = new Hono();
    const mode = createPairingMode();
    mode.open();
    mountDeviceApi(
      app,
      {
        db: suite.db,
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
    const venue = await setupVenue(suite.db);
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

  it("does not count requests a shut window stranded against the cap", async () => {
    const venue = await setupVenue(suite.db);
    let offset = 0;
    const mode = createPairingMode({ now: () => Date.now() + offset });
    const app = mountApp(venue.cfg, undefined, mode);
    const first = mode.open();
    for (let i = 0; i < PENDING_CAP; i++) {
      const ok = await send(app, "POST", "/api/device/join", { body: { name: `Caja ${i}` } });
      expect(ok.status).toBe(200);
    }
    // Shut and reopened on the holder alone, so only the knock itself can discard the old ten.
    mode.release(first.holdId);
    offset += 1_000;
    mode.open();
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    expect(res.status).toBe(200);
    const { rows } = await suite.db.execute<{ label: string }>(
      sql`select label from join_requests `,
    );
    expect(rows).toEqual([{ label: "Caja nueva" }]);
  });

  /** A knock admitted while the window is open whose body is held back until `finish` is called;
   *  `reading` resolves once the route has started reading it, i.e. after the window check. */
  function withheldKnock(app: Hono): {
    reading: Promise<void>;
    finish: () => void;
    response: Promise<Response>;
  } {
    let started!: () => void;
    let finish!: () => void;
    const reading = new Promise<void>((resolve) => (started = resolve));
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"name":'));
        finish = () => {
          controller.enqueue(encoder.encode('"Late till"}'));
          controller.close();
        };
      },
      pull() {
        started();
      },
    });
    const response = Promise.resolve(
      app.request(
        new Request("http://localhost/api/device/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          duplex: "half",
        } as RequestInit),
      ),
    );
    return { reading, finish: () => finish(), response };
  }

  it.each([
    { reopened: true, label: "shut and reopened" },
    { reopened: false, label: "shut" },
  ])(
    "refuses a knock admitted before the window $label while its body arrived, and keeps no row",
    async ({ reopened }) => {
      const venue = await setupVenue(suite.db);
      let offset = 0;
      const mode = createPairingMode({ now: () => Date.now() + offset });
      const app = mountApp(venue.cfg, undefined, mode);
      const first = mode.open();
      const knock = withheldKnock(app);
      await knock.reading;
      mode.release(first.holdId);
      if (reopened) {
        offset += 1_000;
        mode.open();
      }
      knock.finish();
      const res = await knock.response;
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "device.pairing_closed",
      );
      expect(res.headers.get("set-cookie")).toBeNull();
      const { rows } = await suite.db.execute<{ n: number }>(
        sql`select count(*) as n from join_requests `,
      );
      expect(rows[0]!.n).toBe(0);
    },
  );

  it("admits a knock whose body arrives while the same open period goes on", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const app = mountApp(venue.cfg, undefined, mode);
    const first = mode.open();
    const knock = withheldKnock(app);
    await knock.reading;
    // A second hold taken and the first released: the window never shut, so this is one period.
    mode.open();
    mode.release(first.holdId);
    knock.finish();
    const res = await knock.response;
    expect(res.status).toBe(200);
    const { rows } = await suite.db.execute<{ label: string }>(
      sql`select label from join_requests `,
    );
    expect(rows).toEqual([{ label: "Late till" }]);
  });
});

describe("devMode auto-accept", () => {
  it("auto-accepts a knock with the venue's default till profile, and the cookie works immediately", async () => {
    // The window is NEVER opened (mountDevApp builds a fresh shut holder), so in production this knock
    // would 403. devMode skips the window check and accepts the request in the same transaction with the venue's
    // provisioned default `till` profile, so the joiner's cookie is a working device cookie at once — no
    // window, no approval step.
    const venue = await setupVenue(suite.db);
    const app = mountDevApp(venue.cfg, true);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(res.status).toBe(200);

    const me = await send(app, "GET", "/api/device/me", { cookie: deviceCookieFrom(res) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: "Dev till", formFactor: "till" });

    // The request row is CONSUMED by the accept — it is now a device, not a pending join.
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("a disabled device's browser comes back as the same device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountDevApp(venue.cfg, true);
    const first = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    const { joinId } = (await first.json()) as { joinId: string };
    await suite.db.execute(sql`update devices set active = 0 where id = ${joinId}`);

    const again = await send(app, "POST", "/api/device/join", {
      body: { name: "Dev till" },
      cookie: deviceCookieFrom(first),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { joinId: string }).joinId).toBe(joinId);
    const me = await send(app, "GET", "/api/device/me", { cookie: deviceCookieFrom(again) });
    expect(await me.json()).toMatchObject({ deviceId: joinId, name: "Dev till" });
    const { rows } = await suite.db.execute<{ n: number }>(sql`select count(*) as n from devices`);
    expect(rows[0]!.n).toBe(1);
  });

  it("404s device_profile.not_found when the venue has no default till profile, rolling the request back", async () => {
    const venue = await setupVenue(suite.db);
    // Remove the provisioned default `till` profile (no device references it yet, so the RESTRICT FK is
    // not tripped). Auto-accept then has no default to resolve.
    await suite.db.execute(sql`delete from device_profiles where form_factor = 'till'`);
    const app = mountDevApp(venue.cfg, true);
    const res = await send(app, "POST", "/api/device/join", { body: { name: "Dev till" } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "device_profile.not_found",
    );
    // The throw is inside the same transaction as the mint, so the just-created request is rolled back —
    // no orphan pending row nobody can approve.
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("outside devMode the same knock still needs an open window (403)", async () => {
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    expect(knock.status).toBe(200);
    const jar = deviceCookieFrom(knock);
    const { joinId } = (await knock.json()) as { joinId: string };

    const pending = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });

    const profileId = await seedProfile("till");
    await withTransaction(suite.db, async (tx) => {
      return acceptDeviceJoinRequest(tx, venue.cfg, joinId, {
        label: "Caja nueva",
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

  it("is not_approved once the window has shut", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    const { holdId } = mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    const jar = deviceCookieFrom(knock);
    const pending = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(await pending.json()).toEqual({ status: "pending" });
    mode.release(holdId);
    const shut = await send(app, "GET", "/api/device/join/status", { cookie: jar });
    expect(shut.status).toBe(200);
    expect(await shut.json()).toEqual({ status: "not_approved" });
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("is not_approved after a deny, and for a cookie that names nothing", async () => {
    const venue = await setupVenue(suite.db);
    const mode = createPairingMode();
    mode.open();
    const app = mountApp(venue.cfg, undefined, mode);
    const knock = await send(app, "POST", "/api/device/join", { body: { name: "Caja nueva" } });
    const jar = deviceCookieFrom(knock);
    const { joinId } = (await knock.json()) as { joinId: string };

    await withTransaction(suite.db, async (tx) => {
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
    const venue = await setupVenue(suite.db);
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

describe("Device API — the device-guarded routes", () => {
  it("enrols, sets the cookie, and /me reports the device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, jar } = await enrolTill(app, venue, "Caja del bar");

    const me = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      deviceId,
      formFactor: "till",
      name: "Caja del bar",
      stationId: null,
    });
  });

  it("the bound station's read carries its kitchen notices, and the display acknowledges its own only", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const fria = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Fría", isDefault: false }),
    );
    const { orderId } = await fireOrder(venue);
    // One notice at the display's own station and one at another, as a void of each line records.
    await withTransaction(suite.db, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        select id from working_order_lines where working_order_id = ${orderId} order by line_no`);
      await VENUE_SERVICE.recordKitchenNotices(
        tx,
        venue.cfg,
        orderId,
        [
          {
            workingOrderLineId: rows[0]!.id,
            stationId: venue.defaultStationId,
            quantity: decimal("1"),
            wasStarted: false,
          },
          {
            workingOrderLineId: rows[1]!.id,
            stationId: fria.id,
            quantity: decimal("1"),
            wasStarted: false,
          },
        ],
        "void",
      );
    });
    const foreignNotice = (
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listStationNotices(tx, venue.cfg, fria.id),
      )
    )[0]!.id;
    const { jar } = await enrolKds(app, venue, venue.defaultStationId);
    const notices = async () => {
      const res = await send(app, "GET", "/api/device/station", { cookie: jar });
      expect(res.status).toBe(200);
      return ((await res.json()) as { station: { notices: { id: string; kind: string }[] } })
        .station.notices;
    };

    const [own] = await notices();
    expect(own).toMatchObject({ kind: "void", stationId: venue.defaultStationId });
    const foreign = await send(
      app,
      "POST",
      `/api/device/kitchen-notices/${foreignNotice}/acknowledge`,
      {
        cookie: jar,
      },
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ error: { code: "kitchen_notice.not_found" } });

    const ack = await send(app, "POST", `/api/device/kitchen-notices/${own!.id}/acknowledge`, {
      cookie: jar,
    });
    expect(ack.status).toBe(204);
    expect(await notices()).toEqual([]);
    expect(
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listStationNotices(tx, venue.cfg, fria.id),
      ),
    ).toHaveLength(1);

    const malformed = await send(
      app,
      "POST",
      "/api/device/kitchen-notices/not-a-uuid/acknowledge",
      {
        cookie: jar,
      },
    );
    expect(malformed.status).toBe(404);
    const noCookie = await send(app, "POST", `/api/device/kitchen-notices/${own!.id}/acknowledge`, {
      cookie: null,
    });
    expect(noCookie.status).toBe(401);
    // A handheld is bound to no station, so it has no notices to clear.
    const handheld = await enrolHandheld(app, venue);
    const fromHandheld = await send(
      app,
      "POST",
      `/api/device/kitchen-notices/${foreignNotice}/acknowledge`,
      { cookie: handheld.jar },
    );
    expect(fromHandheld.status).toBe(401);
    expect(await fromHandheld.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("enrol → authenticated station read → bump own item → foreign 403 → revoke stops the cookie", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);

    const fria = await withTransaction(suite.db, async (tx) => {
      return createStation(tx, venue.cfg, { name: "Fría", isDefault: false });
    });
    const { items } = await fireOrder(venue);
    const [ownItem, foreignItem] = items;
    await moveItemToStation(foreignItem!, fria.id);

    const { deviceId, jar } = await enrolKds(app, venue, venue.defaultStationId);

    const ownPrinter = await seedPrinter(venue.cfg);
    const foreignPrinter = await seedPrinter(venue.cfg);
    await suite.db.insert(stationPrinters).values([
      { stationId: venue.defaultStationId, printerId: ownPrinter },
      { stationId: fria.id, printerId: foreignPrinter },
    ]);
    for (const printerId of [ownPrinter, foreignPrinter]) {
      await suite.db.insert(printJobs).values({
        locationId: venue.cfg.locationId,
        printerId,
        payload: Uint8Array.of(1),
        status: "failed",
        attempts: 5,
        createdAt: "2026-10-02T18:00:00.000Z",
      });
    }

    const stationRes = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(stationRes.status).toBe(200);
    const station = (await stationRes.json()) as {
      station: {
        id: string;
        queue: { items: { id: string }[] }[];
        printersDown: { printerId: string }[];
      };
    };
    expect(station.station.id).toBe(venue.defaultStationId);
    expect(station.station.printersDown).toMatchObject([{ printerId: ownPrinter }]);
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

  it("carries the rest of the order in an enabled kitchen device's station queue", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const other = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Fría", isDefault: false }),
    );
    const { orderId, items } = await fireOrder(venue);
    await moveItemToStation(items[1]!, other.id);
    await suite.db
      .update(kitchenStations)
      .set({ showsRestOfOrder: true })
      .where(eq(kitchenStations.id, venue.defaultStationId));
    const { jar } = await enrolKds(app, venue, venue.defaultStationId);

    const res = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: {
        queue: {
          orderId: string;
          elsewhere?: { id: string; stationName: string; soldInEach: boolean }[];
        }[];
      };
    };
    expect(body.station.queue.find((group) => group.orderId === orderId)?.elsewhere).toEqual([
      expect.objectContaining({ id: items[1], stationName: "Fría", soldInEach: true }),
    ]);
  });

  it("the device routes refuse a missing / malformed cookie with 401 device.unauthorized", async () => {
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
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
    const venue = await setupVenue(suite.db);
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

  it("GET /management-api/devices names what each kitchen screen shows, and whether it is switched on", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const [liveStation, offStation] = await withTransaction(suite.db, async (tx) => [
      await createStation(tx, venue.cfg, { name: "Plancha" }),
      await createStation(tx, venue.cfg, { name: "Horno" }),
    ]);
    const live = await enrolKds(app, venue, liveStation!.id, "Pantalla plancha");
    const off = await enrolKds(app, venue, offStation!.id, "Pantalla horno");
    await switchStationOff(offStation!.id);
    const watching = await enrolWatching(venue, "Pase");
    await withTransaction(suite.db, (tx) => removeWatcher(tx, venue.cfg, watching.watcherId));
    const till = await enrolTill(app, venue, "Caja");

    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; binding: unknown }[];
    const bindingOf = (id: string) => rows.find((r) => r.id === id)?.binding;
    expect(bindingOf(live.deviceId)).toEqual({ name: "Plancha", active: true });
    expect(bindingOf(off.deviceId)).toEqual({ name: "Horno", active: false });
    expect(bindingOf(watching.deviceId)).toEqual({ name: "Pase", active: false });
    expect(bindingOf(till.deviceId)).toBeNull();
  });

  it("GET /management-api/devices says whether each device's profile was retired", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const kept = await enrolTill(app, venue, "Caja viva");
    const gone = await enrolTill(app, venue, "Caja retirada");
    const revoke = await send(app, "POST", `/management-api/devices/${gone.deviceId}/revoke`, {
      cookie: venue.managerCookie,
    });
    expect(revoke.status).toBe(204);
    // Only a disabled device holds the profile, so deleting it retires the row.
    await withTransaction(suite.db, (tx) =>
      deleteDeviceProfile(tx, {
        managementSessionId: venue.managerCookie.split("=")[1]!,
        id: gone.profileId,
      }),
    );
    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; profileRetired: unknown }[];
    expect(rows.find((r) => r.id === kept.deviceId)?.profileRetired).toBe(false);
    expect(rows.find((r) => r.id === gone.deviceId)?.profileRetired).toBe(true);
  });

  it("revoke of an unknown / malformed device id → 404 device.not_found", async () => {
    const venue = await setupVenue(suite.db);
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
});

describe("PATCH /management-api/devices/:id (device.manage)", () => {
  type EditBody = {
    name: string;
    profileId: string;
    stationId: string | null;
    watcherId: string | null;
    receiptPrinterId: string | null;
    paymentSlipPrinterId: string | null;
    madeHereStationIds: string[];
  };

  /** The device's stored settings as an edit body, so a case changes only its own field. */
  async function storedBody(deviceId: string): Promise<EditBody> {
    const [row] = await suite.db
      .select({
        name: devices.label,
        profileId: devices.deviceProfileId,
        stationId: devices.stationId,
        watcherId: devices.watcherId,
        receiptPrinterId: devices.receiptPrinterId,
        paymentSlipPrinterId: devices.paymentSlipPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    const madeHere = await suite.db
      .select({ stationId: deviceMadeHereStations.stationId })
      .from(deviceMadeHereStations)
      .where(eq(deviceMadeHereStations.deviceId, deviceId));
    return { ...row!, madeHereStationIds: madeHere.map((r) => r.stationId) };
  }

  async function edit(
    app: Hono,
    cookie: string,
    deviceId: string,
    changes: Partial<Record<keyof EditBody, unknown>> = {},
  ): Promise<Response> {
    return send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie,
      body: { ...(await storedBody(deviceId)), ...changes },
    });
  }

  async function labelOf(deviceId: string): Promise<string> {
    const [row] = await suite.db
      .select({ label: devices.label })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return row!.label;
  }

  /** A till on a profile listing receipt [Bar, Counter] and slip [Bar, Counter]. */
  async function tillOnListedProfile(venue: Venue, app: Hono, name = "Caja") {
    const [bar, counter] = await seedNamedPrinters(venue.cfg, ["Bar", "Counter"]);
    const profileId = await seedProfile("till");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [bar!, counter!],
        paymentSlipPrinterIds: [bar!, counter!],
      }),
    );
    const { deviceId } = await knockAndAccept(app, venue, { name, profileId });
    return { bar: bar!, counter: counter!, profileId, deviceId };
  }

  it("renames a device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, { name: "Barra 2" });
    expect(res.status).toBe(204);
    expect(await labelOf(deviceId)).toBe("Barra 2");
  });

  it("renames a device whose receipt printer has since been switched off", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await tillOnListedProfile(venue, app);
    expect(await deviceBindings(t.deviceId)).toMatchObject({ receiptPrinterId: t.bar });
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, t.bar));

    const res = await edit(app, venue.managerCookie, t.deviceId, { name: "Barra 2" });
    expect(res.status).toBe(204);
    expect(await labelOf(t.deviceId)).toBe("Barra 2");
    expect(await deviceBindings(t.deviceId)).toMatchObject({
      receiptPrinterId: t.bar,
      paymentSlipPrinterId: t.bar,
    });
  });

  it("refuses a blank name on edit", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, { name: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "name" } },
    });
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("refuses the name of another active device as device.name_taken", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    await enrolTill(app, venue, "Barra");
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, { name: "Barra" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "device.name_taken" } });
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("a name differing only by surrounding spaces clashes", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    await enrolTill(app, venue, "Barra");
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, { name: " Barra " });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "device.name_taken" } });
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("reuses a revoked device's name", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const old = await enrolTill(app, venue, "Barra");
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, old.deviceId));
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, { name: "Barra" });
    expect(res.status).toBe(204);
    expect(await labelOf(deviceId)).toBe("Barra");
  });

  it("refuses a revoked, unknown or malformed device as device.not_found", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const body = await storedBody(deviceId);
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    for (const id of [deviceId, randomUUID(), "not-a-uuid"]) {
      const res = await send(app, "PATCH", `/management-api/devices/${id}`, {
        cookie: venue.managerCookie,
        body: { ...body, name: "Renamed" },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "device.not_found" } });
    }
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("refuses an unknown device as device.not_found before reading the body", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const res = await send(app, "PATCH", `/management-api/devices/${randomUUID()}`, {
      cookie: venue.managerCookie,
      body: {},
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "device.not_found" } });
  });

  it("refuses a revoked device as device.not_found even with a blank name", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const body = await storedBody(deviceId);
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: { ...body, name: "   " },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "device.not_found" } });
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("changes the profile and moves the printers to the new profile's first in the same request", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const [p1, p2, p3] = await seedNamedPrinters(venue.cfg, ["Bar", "Counter", "Portable"]);
    const from = await seedProfile("till");
    const to = await seedProfile("till");
    await withTransaction(suite.db, async (tx) => {
      await setProfilePrinterLists(tx, from, {
        receiptPrinterIds: [p1!],
        paymentSlipPrinterIds: [p1!],
      });
      await setProfilePrinterLists(tx, to, {
        receiptPrinterIds: [p2!, p1!],
        paymentSlipPrinterIds: [p3!, p1!],
      });
    });
    const { deviceId } = await knockAndAccept(app, venue, { name: "Caja", profileId: from });
    expect(await deviceBindings(deviceId)).toMatchObject({
      receiptPrinterId: p1,
      paymentSlipPrinterId: p1,
    });

    const res = await edit(app, venue.managerCookie, deviceId, {
      name: "Barra",
      profileId: to,
      receiptPrinterId: p2,
      paymentSlipPrinterId: p3,
    });
    expect(res.status).toBe(204);
    expect(await deviceBindings(deviceId)).toMatchObject({
      deviceProfileId: to,
      receiptPrinterId: p2,
      paymentSlipPrinterId: p3,
    });
    expect(await labelOf(deviceId)).toBe("Barra");
  });

  it("keeps the printers when the profile is unchanged", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await tillOnListedProfile(venue, app);
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: t.counter, paymentSlipPrinterId: null })
      .where(eq(devices.id, t.deviceId));

    const res = await edit(app, venue.managerCookie, t.deviceId);
    expect(res.status).toBe(204);
    expect(await deviceBindings(t.deviceId)).toMatchObject({
      deviceProfileId: t.profileId,
      receiptPrinterId: t.counter,
      paymentSlipPrinterId: null,
    });
  });

  it("refuses a printer not on the (new) profile with device.binding_invalid and changes nothing", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await tillOnListedProfile(venue, app);
    const [elsewhere] = await seedNamedPrinters(venue.cfg, ["Terraza"]);
    const other = await seedProfile("till");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, other, {
        receiptPrinterIds: [elsewhere!],
        paymentSlipPrinterIds: [elsewhere!],
      }),
    );

    // The body keeps the old profile's receipt printer, which the new profile does not list.
    const res = await edit(app, venue.managerCookie, t.deviceId, {
      name: "Renamed",
      profileId: other,
      paymentSlipPrinterId: elsewhere,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "device.binding_invalid", params: { field: "receiptPrinterId" } },
    });
    expect(await labelOf(t.deviceId)).toBe("Caja");
    expect(await deviceBindings(t.deviceId)).toEqual({
      deviceProfileId: t.profileId,
      receiptPrinterId: t.bar,
      paymentSlipPrinterId: t.bar,
    });
  });

  it("refuses a profile that names no row as device_profile.not_found, device untouched", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, profileId } = await enrolTill(app, venue, "Caja");
    const res = await edit(app, venue.managerCookie, deviceId, {
      name: "Renamed",
      profileId: randomUUID(),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "device_profile.not_found" } });
    expect((await deviceBindings(deviceId)).deviceProfileId).toBe(profileId);
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("a kitchen screen's profile without a station or watcher is device.station_required", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolKds(app, venue, venue.defaultStationId);
    const res = await edit(app, venue.managerCookie, deviceId, {
      name: "Renamed",
      stationId: null,
      watcherId: null,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "device.station_required" } });
    expect(await storedBody(deviceId)).toMatchObject({
      name: "Pantalla Cocina",
      stationId: venue.defaultStationId,
    });
  });

  it("renames a kitchen screen whose station has since been switched off, keeping the station", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const off = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Off" }),
    );
    const { deviceId } = await enrolKds(app, venue, off.id);
    expect(
      (
        await edit(app, venue.managerCookie, deviceId, {
          madeHereStationIds: [venue.defaultStationId],
        })
      ).status,
    ).toBe(204);
    await switchStationOff(off.id);

    // As the dashboard sends a kitchen screen's save: without the made-here stations.
    const { madeHereStationIds: before, ...rest } = await storedBody(deviceId);
    expect(before).toEqual([venue.defaultStationId]);
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: { ...rest, name: "Renamed" },
    });
    expect(res.status).toBe(204);
    expect(await storedBody(deviceId)).toMatchObject({
      name: "Renamed",
      stationId: off.id,
      watcherId: null,
      madeHereStationIds: [venue.defaultStationId],
    });
  });

  it("renames a kitchen screen whose watcher has since been disabled, keeping the watcher", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, watcherId } = await enrolWatching(venue);
    expect(
      (
        await edit(app, venue.managerCookie, deviceId, {
          madeHereStationIds: [venue.defaultStationId],
        })
      ).status,
    ).toBe(204);
    await withTransaction(suite.db, (tx) => removeWatcher(tx, venue.cfg, watcherId));

    // As the dashboard sends a kitchen screen's save: without the made-here stations.
    const { madeHereStationIds: before, ...rest } = await storedBody(deviceId);
    expect(before).toEqual([venue.defaultStationId]);
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: { ...rest, name: "Renamed" },
    });
    expect(res.status).toBe(204);
    expect(await storedBody(deviceId)).toMatchObject({
      name: "Renamed",
      stationId: null,
      watcherId,
      madeHereStationIds: [venue.defaultStationId],
    });
  });

  it("refuses switching a kitchen screen to a switched-off station that is not its own", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolKds(app, venue, venue.defaultStationId);
    const off = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Off" }),
    );
    await switchStationOff(off.id);

    const res = await edit(app, venue.managerCookie, deviceId, {
      name: "Renamed",
      stationId: off.id,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "station.not_found", params: { stationId: off.id } },
    });
    expect(await storedBody(deviceId)).toMatchObject({
      name: "Pantalla Cocina",
      stationId: venue.defaultStationId,
    });
  });

  it("refuses switching a kitchen screen to a disabled watcher that is not its own", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, watcherId } = await enrolWatching(venue);
    const other = await withTransaction(suite.db, async (tx) => {
      const made = await createWatcher(tx, venue.cfg, {
        name: "Other",
        everyStation: true,
        stationIds: [],
        everyZone: true,
        zoneIds: [],
        runsPass: false,
      });
      await removeWatcher(tx, venue.cfg, made.id, true);
      return made;
    });
    const [stored] = await suite.db
      .select({ active: watchers.active })
      .from(watchers)
      .where(eq(watchers.id, other.id));
    expect(stored).toEqual({ active: false });

    const res = await edit(app, venue.managerCookie, deviceId, {
      name: "Renamed",
      watcherId: other.id,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "watcher.not_found", params: { watcherId: other.id } },
    });
    expect(await storedBody(deviceId)).toMatchObject({ name: "Pass screen", watcherId });
  });

  describe("a kitchen screen's station or watcher, chosen from its profile's lists", () => {
    async function kitchenProfile(venue: Venue) {
      const [grill, cold, pastry] = await withTransaction(suite.db, async (tx) => [
        await createStation(tx, venue.cfg, { name: "Grill" }),
        await createStation(tx, venue.cfg, { name: "Cold" }),
        await createStation(tx, venue.cfg, { name: "Pastry" }),
      ]);
      const profileId = await seedProfile("kds", ["prepare-orders"]);
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.setProfileKitchenLists(tx, venue.cfg, profileId, {
          stationIds: [grill!.id, cold!.id],
          watcherIds: [],
        }),
      );
      return { profileId, grill: grill!.id, cold: cold!.id, pastry: pastry!.id };
    }

    it("gives two screens on one Kitchen profile different listed stations, and refuses a third", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const { profileId, grill, cold, pastry } = await kitchenProfile(venue);
      const first = await knockAndAccept(app, venue, {
        name: "Screen 1",
        profileId,
        stationId: grill,
      });
      const second = await knockAndAccept(app, venue, {
        name: "Screen 2",
        profileId,
        stationId: grill,
      });

      expect(
        (await edit(app, venue.managerCookie, second.deviceId, { stationId: cold })).status,
      ).toBe(204);
      const refused = await edit(app, venue.managerCookie, first.deviceId, { stationId: pastry });
      expect({ status: refused.status, body: await refused.json() }).toEqual({
        status: 400,
        body: { error: { code: "station.not_allowed", params: { stationId: pastry } } },
      });
      expect(await storedBody(first.deviceId)).toMatchObject({ stationId: grill });
      expect(await storedBody(second.deviceId)).toMatchObject({ stationId: cold });
    });

    it("gives a screen a listed watcher, which then shows that watcher's stations only, and refuses one not listed", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const { profileId, grill } = await kitchenProfile(venue);
      const [pass, bar] = await withTransaction(suite.db, async (tx) => [
        await createWatcher(tx, venue.cfg, {
          name: "Pass",
          everyStation: false,
          stationIds: [venue.defaultStationId],
          everyZone: true,
          zoneIds: [],
          runsPass: false,
        }),
        await createWatcher(tx, venue.cfg, {
          name: "Bar pass",
          everyStation: true,
          stationIds: [],
          everyZone: true,
          zoneIds: [],
          runsPass: false,
        }),
      ]);
      await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.setProfileKitchenLists(tx, venue.cfg, profileId, {
          stationIds: [grill],
          watcherIds: [pass!.id],
        }),
      );
      const screen = await knockAndAccept(app, venue, {
        name: "Screen",
        profileId,
        stationId: grill,
      });

      const unlisted = await edit(app, venue.managerCookie, screen.deviceId, {
        stationId: null,
        watcherId: bar!.id,
      });
      expect({ status: unlisted.status, body: await unlisted.json() }).toEqual({
        status: 400,
        body: { error: { code: "watcher.not_allowed", params: { watcherId: bar!.id } } },
      });
      expect(
        (
          await edit(app, venue.managerCookie, screen.deviceId, {
            stationId: null,
            watcherId: pass!.id,
          })
        ).status,
      ).toBe(204);

      const { items } = await fireOrder(venue);
      await moveItemToStation(items[1]!, grill);
      const board = await send(app, "GET", "/api/device/watcher", { cookie: screen.jar });
      expect(board.status).toBe(200);
      const shown = ((await board.json()) as WatcherBoard).orders.flatMap((order) =>
        [...order.courses, ...order.groups].flatMap((part) => part.items.map((item) => item.id)),
      );
      expect(shown).toEqual([items[0]]);
    });
  });

  it("sets the made-here stations, and the management GET lists them", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue);
    const bar = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Bar" }),
    );
    const res = await edit(app, venue.managerCookie, deviceId, { madeHereStationIds: [bar.id] });
    expect(res.status).toBe(204);
    const get = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(get.status).toBe(200);
    expect(
      ((await get.json()) as { id: string; madeHereStationIds: string[] }[]).find(
        (d) => d.id === deviceId,
      )?.madeHereStationIds,
    ).toEqual([bar.id]);
  });

  it("refuses a stored made-here station since switched off as station.not_found when the body sends it", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const off = await withTransaction(suite.db, (tx) =>
      createStation(tx, venue.cfg, { name: "Off" }),
    );
    expect(
      (await edit(app, venue.managerCookie, deviceId, { madeHereStationIds: [off.id] })).status,
    ).toBe(204);
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, off.id));

    const res = await edit(app, venue.managerCookie, deviceId, { name: "Renamed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "station.not_found" } });
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("leaves the made-here stations untouched when the field is absent, one since switched off included", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const [bar, off] = await withTransaction(suite.db, async (tx) => [
      await createStation(tx, venue.cfg, { name: "Bar" }),
      await createStation(tx, venue.cfg, { name: "Off" }),
    ]);
    expect(
      (
        await edit(app, venue.managerCookie, deviceId, {
          madeHereStationIds: [bar!.id, off!.id],
        })
      ).status,
    ).toBe(204);
    await suite.db
      .update(kitchenStations)
      .set({ active: false })
      .where(eq(kitchenStations.id, off!.id));

    const { madeHereStationIds: before, ...rest } = await storedBody(deviceId);
    expect(before).toHaveLength(2);
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: { ...rest, name: "Renamed" },
    });
    expect(res.status).toBe(204);
    expect(await labelOf(deviceId)).toBe("Renamed");
    expect([...(await storedBody(deviceId)).madeHereStationIds].sort()).toEqual(
      [bar!.id, off!.id].sort(),
    );
  });

  it("refuses a malformed body field as management.request_invalid naming it", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const cases: [Partial<Record<keyof EditBody, unknown>>, string][] = [
      [{ profileId: undefined }, "profileId"],
      [{ profileId: null }, "profileId"],
      [{ stationId: "bad" }, "stationId"],
      [{ watcherId: "bad" }, "watcherId"],
      [{ receiptPrinterId: undefined }, "receiptPrinterId"],
      [{ paymentSlipPrinterId: "bad" }, "paymentSlipPrinterId"],
      [{ madeHereStationIds: null }, "madeHereStationIds"],
      [{ madeHereStationIds: ["bad"] }, "madeHereStationIds"],
    ];
    for (const [changes, field] of cases) {
      const res = await edit(app, venue.managerCookie, deviceId, { name: "Renamed", ...changes });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await labelOf(deviceId)).toBe("Caja");
  });

  it("needs device.manage — 401 unauthenticated, 403 for a staff session", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja");
    const body = { ...(await storedBody(deviceId)), name: "Renamed" };
    const path = `/management-api/devices/${deviceId}`;

    const anonymous = await send(app, "PATCH", path, { body });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    const staff = await send(app, "PATCH", path, { cookie: venue.staffCookie, body });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await labelOf(deviceId)).toBe("Caja");

    const malformed = await send(app, "PATCH", "/management-api/devices/not-a-uuid", {
      cookie: venue.staffCookie,
      body: {},
    });
    expect(malformed.status).toBe(403);
    expect(await malformed.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

describe("GET /api/device/me + station (SP-A.2 §16)", () => {
  it("exposes a watcher's binding on the device and management surfaces", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({ name: "Watch KDS", formFactor: "kds", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    const watcher = await withTransaction(suite.db, (tx) =>
      createWatcher(tx, venue.cfg, {
        name: "Pass",
        everyStation: true,
        stationIds: [],
        everyZone: true,
        zoneIds: [],
        runsPass: false,
      }),
    );
    const joined = await enrolDeviceForTest(suite.db, venue.cfg, {
      name: "Pass screen",
      profileId: profile!.id,
      watcherId: watcher.id,
    });
    const me = await send(app, "GET", "/api/device/me", {
      cookie: `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}`,
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ stationId: null, watcherId: watcher.id });
    const managed = await send(app, "GET", "/management-api/devices", {
      cookie: venue.managerCookie,
    });
    expect(managed.status).toBe(200);
    expect(
      ((await managed.json()) as { id: string; watcherId: string | null }[]).find(
        (d) => d.id === joined.deviceId,
      ),
    ).toMatchObject({ watcherId: watcher.id });
  });
  it("reports an enrolled handheld's formFactor + name, station null", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, jar } = await enrolHandheld(app, venue);
    const res = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deviceId,
      formFactor: "phone-portrait",
      name: "Waiter phone",
      stationId: null,
    });
  });

  it("echoes the printer stored on the device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);
    const { deviceId, jar, profileId } = await enrolTill(app, venue, "Caja hw");
    const [profile] = await suite.db
      .select({ name: deviceProfiles.name })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, profileId));
    const profileName = profile!.name;
    await suite.db.execute(sql`
      update devices
         set receipt_printer_id = ${printerId}
       where id = ${deviceId}`);

    const res = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deviceId,
      formFactor: "till",
      name: "Caja hw",
      stationId: null,
      watcherId: null,
      receiptPrinterId: printerId,
      paymentSlipPrinterId: null,
      // The printer is stored on the device but is on none of its profile's lists.
      printerChoices: { receipt: [], paymentSlip: [] },
      profileId,
      approvedProfiles: [{ id: profileId, name: profileName }],
    });
  });

  it("GET /api/device/station 401s an enrolled handheld — it is bound to no station", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { jar } = await enrolHandheld(app, venue);
    const res = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });

  it("GET /api/device/me 401s a request with no device cookie", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/api/device/me", { cookie: null });
    expect(res.status).toBe(401);
  });
});

describe("a device's current printers", () => {
  /** A till on a profile listing receipt [Counter, Bar] and slip [Portable, Bar]. */
  async function listedTill(venue: Venue, app: Hono) {
    const [bar, counter, portable] = await seedNamedPrinters(venue.cfg, [
      "Bar",
      "Counter",
      "Portable",
    ]);
    const profileId = await seedProfile("till");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [counter!, bar!],
        paymentSlipPrinterIds: [portable!, bar!],
      }),
    );
    const { deviceId, jar } = await knockAndAccept(app, venue, { name: "Caja", profileId });
    const session = await openTillSession(deviceId);
    return { bar: bar!, counter: counter!, portable: portable!, deviceId, jar, session };
  }

  it("switches the slip printer to another listed one", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    const res = await send(app, "PUT", "/api/device/printers", {
      cookie: `${t.jar}; ${t.session}`,
      body: { paymentSlipPrinterId: t.bar },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receiptPrinterId: t.counter, paymentSlipPrinterId: t.bar });
    expect(await deviceBindings(t.deviceId)).toMatchObject({
      receiptPrinterId: t.counter,
      paymentSlipPrinterId: t.bar,
    });

    const off = await send(app, "PUT", "/api/device/printers", {
      cookie: `${t.jar}; ${t.session}`,
      body: { receiptPrinterId: null },
    });
    expect(await off.json()).toEqual({ receiptPrinterId: null, paymentSlipPrinterId: t.bar });
  });

  it("lists each device with its current receipt and slip printers", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.find((r) => r.id === t.deviceId)).toMatchObject({
      receiptPrinterId: t.counter,
      paymentSlipPrinterId: t.portable,
    });
  });

  it("refuses a printer not on the list, naming the field, and stores neither choice", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    for (const [body, field] of [
      [{ receiptPrinterId: t.portable }, "receiptPrinterId"],
      [{ receiptPrinterId: t.bar, paymentSlipPrinterId: t.counter }, "paymentSlipPrinterId"],
    ] as const) {
      const res = await send(app, "PUT", "/api/device/printers", {
        cookie: `${t.jar}; ${t.session}`,
        body,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "device.binding_invalid", params: { field } },
      });
    }
    expect(await deviceBindings(t.deviceId)).toMatchObject({
      receiptPrinterId: t.counter,
      paymentSlipPrinterId: t.portable,
    });
  });

  it("refuses a malformed printer id as a request fault", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    const res = await send(app, "PUT", "/api/device/printers", {
      cookie: `${t.jar}; ${t.session}`,
      body: { paymentSlipPrinterId: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "paymentSlipPrinterId" } },
    });
  });

  it("switches the session's device, and needs an open session on an active device", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    const noSession = await send(app, "PUT", "/api/device/printers", {
      cookie: t.jar,
      body: { paymentSlipPrinterId: t.bar },
    });
    expect(noSession.status).toBe(401);
    expect(await noSession.json()).toMatchObject({ error: { code: "session.required" } });
    expect((await deviceBindings(t.deviceId)).paymentSlipPrinterId).toBe(t.portable);

    // No device cookie: the session names the device.
    const sessionOnly = await send(app, "PUT", "/api/device/printers", {
      cookie: t.session,
      body: { paymentSlipPrinterId: t.bar },
    });
    expect(sessionOnly.status).toBe(200);
    expect((await deviceBindings(t.deviceId)).paymentSlipPrinterId).toBe(t.bar);

    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, t.deviceId));
    const revoked = await send(app, "PUT", "/api/device/printers", {
      cookie: t.session,
      body: { paymentSlipPrinterId: t.portable },
    });
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    expect((await deviceBindings(t.deviceId)).paymentSlipPrinterId).toBe(t.bar);
  });

  it("GET /api/device/me reports the current printers and the active usable choices in list order", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const t = await listedTill(venue, app);
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, t.portable));
    const res = await send(app, "GET", "/api/device/me", { cookie: t.jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      receiptPrinterId: t.counter,
      paymentSlipPrinterId: t.portable,
      printerChoices: {
        receipt: [
          { id: t.counter, name: "Counter" },
          { id: t.bar, name: "Bar" },
        ],
        paymentSlip: [{ id: t.bar, name: "Bar" }],
      },
    });
  });
});

describe("PUT /api/device/battery", () => {
  /** A device API whose clock reads `clock.at`, so a test can move time past the one-minute limit. */
  function mountClockedApp(cfg: TillConfig, clock: { at: Date }): Hono {
    const app = new Hono();
    const pairingMode = createPairingMode();
    windows.set(app, pairingMode);
    mountDeviceApi(
      app,
      { db: suite.db, cfg, secureCookies: false, pairingMode, now: () => clock.at },
      noopLog,
    );
    return app;
  }

  async function storedBattery(deviceId: string) {
    const [row] = await suite.db
      .select({
        level: devices.batteryLevel,
        charging: devices.batteryCharging,
        reportedAt: devices.batteryReportedAt,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return row!;
  }

  /** Sends one report and holds that the route answered it with 204. */
  async function report(app: Hono, jar: string, body: { level: number; charging: boolean }) {
    const res = await send(app, "PUT", "/api/device/battery", { cookie: jar, body });
    expect(res.status).toBe(204);
  }

  const T0 = new Date("2026-10-04T10:00:00.000Z");
  const later = (ms: number) => new Date(T0.getTime() + ms);

  it("stores a report's level, charging state and time", async () => {
    const venue = await setupVenue(suite.db);
    const clock = { at: T0 };
    const app = mountClockedApp(venue.cfg, clock);
    const { deviceId, jar } = await enrolHandheld(app, venue);
    await report(app, jar, { level: 82, charging: false });
    expect(await storedBattery(deviceId)).toEqual({
      level: 82,
      charging: false,
      reportedAt: T0.toISOString(),
    });
  });

  it("keeps the first report when a second, with the same charging state, comes within a minute", async () => {
    const venue = await setupVenue(suite.db);
    const clock = { at: T0 };
    const app = mountClockedApp(venue.cfg, clock);
    const { deviceId, jar } = await enrolHandheld(app, venue);
    await report(app, jar, { level: 82, charging: false });
    clock.at = later(30_000);
    await report(app, jar, { level: 81, charging: false });
    expect(await storedBattery(deviceId)).toEqual({
      level: 82,
      charging: false,
      reportedAt: T0.toISOString(),
    });
  });

  it("stores a report within a minute when the charging state changed", async () => {
    const venue = await setupVenue(suite.db);
    const clock = { at: T0 };
    const app = mountClockedApp(venue.cfg, clock);
    const { deviceId, jar } = await enrolHandheld(app, venue);
    await report(app, jar, { level: 82, charging: false });
    clock.at = later(30_000);
    await report(app, jar, { level: 82, charging: true });
    expect(await storedBattery(deviceId)).toEqual({
      level: 82,
      charging: true,
      reportedAt: later(30_000).toISOString(),
    });
  });

  it("stores a report with the same charging state once a minute has passed", async () => {
    const venue = await setupVenue(suite.db);
    const clock = { at: T0 };
    const app = mountClockedApp(venue.cfg, clock);
    const { deviceId, jar } = await enrolHandheld(app, venue);
    await report(app, jar, { level: 82, charging: false });
    clock.at = later(61_000);
    await report(app, jar, { level: 79, charging: false });
    expect(await storedBattery(deviceId)).toEqual({
      level: 79,
      charging: false,
      reportedAt: later(61_000).toISOString(),
    });
  });

  it.each([
    ["level", { level: 101, charging: false }],
    ["level", { level: -1, charging: false }],
    ["level", { level: 50.5, charging: false }],
    ["level", { level: "50", charging: false }],
    ["charging", { level: 50, charging: "yes" }],
  ])("refuses a bad %s (%j) naming the field, and stores nothing", async (field, body) => {
    const venue = await setupVenue(suite.db);
    const app = mountClockedApp(venue.cfg, { at: T0 });
    const { deviceId, jar } = await enrolHandheld(app, venue);
    const res = await send(app, "PUT", "/api/device/battery", { cookie: jar, body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(await storedBattery(deviceId)).toEqual({
      level: null,
      charging: null,
      reportedAt: null,
    });
  });

  it("refuses a caller with no device cookie as device.unauthorized", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountClockedApp(venue.cfg, { at: T0 });
    const res = await send(app, "PUT", "/api/device/battery", {
      body: { level: 50, charging: false },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("the management list carries each device's battery report, null before one is stored", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountClockedApp(venue.cfg, { at: T0 });
    const reporter = await enrolHandheld(app, venue);
    const silent = await enrolTill(app, venue, "Caja muda");
    await report(app, reporter.jar, { level: 64, charging: true });
    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.find((r) => r.id === reporter.deviceId)).toMatchObject({
      batteryLevel: 64,
      batteryCharging: true,
      batteryReportedAt: T0.toISOString(),
    });
    expect(rows.find((r) => r.id === silent.deviceId)).toMatchObject({
      batteryLevel: null,
      batteryCharging: null,
      batteryReportedAt: null,
    });
  });
});

describe("join rate limiter (spec §8)", () => {
  it("rate-limits the knock: the (cap+1)th is 429 BEFORE the DB, then the window resets", async () => {
    const venue = await setupVenue(suite.db);
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
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from join_requests `,
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
    const venue = await setupVenue(suite.db);
    const app = mountDevApp(venue.cfg, true);
    // Enrol through a NON-dev mount: a devMode knock auto-accepts as a till, and this case needs a KDS
    // bound to a station.
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
    expect(body).not.toHaveProperty("tills");
    expect(body).not.toHaveProperty("stations");
    expect(body).not.toHaveProperty("deviceProfiles");
  });

  it("lists only ACTIVE devices — a revoked device is omitted", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountDevApp(venue.cfg, true);
    // Enrol through a non-dev mount: a devMode knock auto-accepts as a till.
    const enrolApp = mountApp(venue.cfg);
    const live = await enrolKds(enrolApp, venue, venue.defaultStationId);
    const doomed = await enrolKds(enrolApp, venue, venue.defaultStationId, "Pantalla Pase");
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
    const venue = await setupVenue(suite.db);
    expect((await send(mountDevApp(venue.cfg, false), "GET", "/api/dev/devices")).status).toBe(404);
    expect((await send(mountApp(venue.cfg), "GET", "/api/dev/devices")).status).toBe(404);
  });
});

describe("deleted routes are gone (404)", () => {
  it("POST /api/dev/devices and POST /api/device/reset no longer exist, even under devMode", async () => {
    const venue = await setupVenue(suite.db);
    const devApp = mountDevApp(venue.cfg, true);
    expect((await send(devApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(devApp, "POST", "/api/device/reset", {})).status).toBe(404);
    const prodApp = mountApp(venue.cfg);
    expect((await send(prodApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(prodApp, "POST", "/api/device/reset", {})).status).toBe(404);
  });

  it("PATCH /management-api/devices/:id/hardware no longer exists", async () => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja hw");
    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.managerCookie,
      body: { receiptPrinterId: null },
    });
    expect(res.status).toBe(404);
  });

  // Each body is one the removed route accepted for this device, so a live route would answer 204.
  it.each([
    ["POST", "assign-device-profile"],
    ["PUT", "made-here"],
  ] as const)("%s /management-api/devices/:id/%s no longer exists", async (method, tail) => {
    const venue = await setupVenue(suite.db);
    const app = mountApp(venue.cfg);
    const { deviceId, profileId } = await enrolTill(app, venue, `Caja ${tail}`);
    const res = await send(app, method, `/management-api/devices/${deviceId}/${tail}`, {
      cookie: venue.managerCookie,
      body: tail === "made-here" ? { stationIds: [] } : { deviceProfileId: profileId },
    });
    expect(res.status).toBe(404);
  });

  // The pairing-code flow's three routes. The mint route is the one a stale dashboard would still
  // call, so its 404 is what tells the operator the mechanism is gone rather than merely refusing.
  it.each([
    ["POST", "/api/device/enrol"],
    ["POST", "/api/device/enrol/verify"],
    ["POST", "/management-api/device-codes"],
  ])("%s %s", async (method, path) => {
    const venue = await setupVenue(suite.db);
    const res = await send(mountApp(venue.cfg), method as "POST", path, { body: {} });
    expect(res.status).toBe(404);
  });
});

describe("a device's approved profiles and switching its active one", () => {
  type Device = { deviceId: string; jar: string; profileId: string };

  async function approved(deviceId: string): Promise<string[]> {
    return withTransaction(suite.db, (tx) => listApprovedProfiles(tx, deviceId));
  }

  /** The manager's edit, as the dashboard sends it: every stored field plus `changes`. */
  async function manage(
    app: Hono,
    venue: Venue,
    deviceId: string,
    changes: Record<string, unknown>,
  ): Promise<Response> {
    const [row] = await suite.db
      .select({
        name: devices.label,
        profileId: devices.deviceProfileId,
        stationId: devices.stationId,
        watcherId: devices.watcherId,
        receiptPrinterId: devices.receiptPrinterId,
        paymentSlipPrinterId: devices.paymentSlipPrinterId,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return send(app, "PATCH", `/management-api/devices/${deviceId}`, {
      cookie: venue.managerCookie,
      body: { ...row!, ...changes },
    });
  }

  async function approve(app: Hono, venue: Venue, deviceId: string, ids: string[]) {
    const res = await manage(app, venue, deviceId, { approvedProfileIds: ids });
    expect(res.status).toBe(204);
  }

  /** A signed-in person of `role` on the device, as the cookie the till sends. */
  async function signIn(
    deviceId: string,
    role: "staff" | "manager" = "staff",
  ): Promise<{ cookie: string; personId: string }> {
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: `Person ${randomUUID()}`, pinHash: hashPin("4321"), role })
      .returning({ id: persons.id });
    const session = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" }),
    );
    return { cookie: `${SESSION_COOKIE}=${session.token}`, personId: person!.id };
  }

  function switchTo(app: Hono, cookie: string | null, profileId: unknown): Promise<Response> {
    return send(app, "POST", "/api/device/active-profile", { cookie, body: { profileId } });
  }

  /** Admits only `role` to `profileId`. */
  async function admitOnly(profileId: string, role: "staff" | "manager"): Promise<void> {
    await suite.db.insert(deviceProfileAdmissionRoles).values({ deviceProfileId: profileId, role });
  }

  /** An `attempting` card payment started on `deviceId`. */
  async function paymentInProgress(venue: Venue, deviceId: string, state = "attempting" as const) {
    const orderId = randomUUID();
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
    await parkOrder({ db: suite.db }, venue.cfg, {
      id: orderId,
      zoneId: offers.zoneId,
      lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
      label: "Mesa 1",
    });
    const [row] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: orderId,
        source: "device",
        deviceId,
        provider: "stripe",
        paymentRef: randomUUID(),
        amount: 150,
        state,
      })
      .returning({ id: payments.id });
    return row!.id;
  }

  async function openSessionsOn(deviceId: string): Promise<string[]> {
    const rows = await suite.db
      .select({ personId: sessions.personId })
      .from(sessions)
      .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.endedAt)));
    return rows.map((row) => row.personId).sort();
  }

  async function captureCode(run: () => Promise<unknown>): Promise<string | undefined> {
    try {
      await run();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  async function till(app: Hono, venue: Venue, name = "Caja"): Promise<Device> {
    const { deviceId, jar, profileId } = await enrolTill(app, venue, name);
    return { deviceId, jar, profileId };
  }

  describe("approval", () => {
    it("a freshly enrolled device lists exactly its active profile as approved", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
      const listed = await send(app, "GET", "/management-api/devices", {
        cookie: venue.managerCookie,
      });
      const rows = (await listed.json()) as { id: string; approvedProfileIds: string[] }[];
      expect(rows.find((r) => r.id === t.deviceId)?.approvedProfileIds).toEqual([t.profileId]);
    });

    it("approving two alternatives keeps the active profile approved", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const [a, b] = [await seedProfile("till"), await seedProfile("till")];
      await approve(app, venue, t.deviceId, [a, b]);
      expect(new Set(await approved(t.deviceId))).toEqual(new Set([t.profileId, a, b]));
      expect((await approved(t.deviceId))[0]).toBe(t.profileId);
      expect((await deviceBindings(t.deviceId)).deviceProfileId).toBe(t.profileId);
    });

    it("an edit without approvedProfileIds leaves the approved set alone", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      await approve(app, venue, t.deviceId, [a]);
      expect((await manage(app, venue, t.deviceId, { name: "Renamed" })).status).toBe(204);
      expect(await approved(t.deviceId)).toEqual([t.profileId, a]);
    });

    it("an empty list withdraws every alternative, never the active profile", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      await approve(app, venue, t.deviceId, [a]);
      await approve(app, venue, t.deviceId, []);
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
    });

    it("refuses an unknown profile as device_profile.not_found, changing nothing", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      const res = await manage(app, venue, t.deviceId, {
        name: "Renamed",
        approvedProfileIds: [a, randomUUID()],
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "device_profile.not_found" } });
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
      const [row] = await suite.db
        .select({ label: devices.label })
        .from(devices)
        .where(eq(devices.id, t.deviceId));
      expect(row!.label).toBe("Caja");
    });

    it("names the approvals field when an approved profile is unknown", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const res = await manage(app, venue, t.deviceId, { approvedProfileIds: [randomUUID()] });
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 404,
        body: {
          error: { code: "device_profile.not_found", params: { field: "approvedProfileIds" } },
        },
      });
    });

    it("refuses a profile of another form factor as device_profile.incompatible, changing nothing", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      for (const formFactor of ["kds", "phone-portrait"] as const) {
        const other = await seedProfile(formFactor);
        const res = await manage(app, venue, t.deviceId, { approvedProfileIds: [other] });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "device_profile.incompatible", params: { field: "approvedProfileIds" } },
        });
      }
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
    });

    it("refuses a malformed list as management.request_invalid", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      for (const bad of [null, "x", ["not-a-uuid"], {}]) {
        const res = await manage(app, venue, t.deviceId, { approvedProfileIds: bad });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "approvedProfileIds" } },
        });
      }
    });

    it("activating a profile not yet approved approves it, and the one it replaces stays approved", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const next = await seedProfile("till");
      expect((await manage(app, venue, t.deviceId, { profileId: next })).status).toBe(204);
      expect((await deviceBindings(t.deviceId)).deviceProfileId).toBe(next);
      expect(await approved(t.deviceId)).toEqual([next, t.profileId]);
    });

    it("activating with approvedProfileIds approves exactly the new active profile and that list", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const [next, a] = [await seedProfile("till"), await seedProfile("till")];
      const res = await manage(app, venue, t.deviceId, {
        profileId: next,
        approvedProfileIds: [a],
      });
      expect(res.status).toBe(204);
      expect(await approved(t.deviceId)).toEqual([next, a]);
    });

    it("refuses to change the active profile during a payment on the device, changing nothing", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const next = await seedProfile("till");
      await paymentInProgress(venue, t.deviceId);
      const res = await manage(app, venue, t.deviceId, {
        name: "Renamed",
        profileId: next,
        approvedProfileIds: [],
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "device.payment_in_progress" } });
      expect((await deviceBindings(t.deviceId)).deviceProfileId).toBe(t.profileId);
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
    });

    it("still renames a device and approves alternatives during a payment on it", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      await paymentInProgress(venue, t.deviceId);
      const res = await manage(app, venue, t.deviceId, {
        name: "Renamed",
        approvedProfileIds: [a],
      });
      expect(res.status).toBe(204);
      expect(await approved(t.deviceId)).toEqual([t.profileId, a]);
    });

    it("activating a profile ends the sessions of people it does not admit", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const next = await seedProfile("till");
      await admitOnly(next, "manager");
      await signIn(t.deviceId, "staff");
      const manager = await signIn(t.deviceId, "manager");
      expect((await manage(app, venue, t.deviceId, { profileId: next })).status).toBe(204);
      expect(await openSessionsOn(t.deviceId)).toEqual([manager.personId]);
    });

    it("lists neither a retired alternative nor one whose form factor no longer matches", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const [kept, retired, changed] = [
        await seedProfile("till"),
        await seedProfile("till"),
        await seedProfile("till"),
      ];
      await approve(app, venue, t.deviceId, [kept, retired, changed]);
      await suite.db
        .update(deviceProfiles)
        .set({ retiredAt: new Date().toISOString() })
        .where(eq(deviceProfiles.id, retired));
      await suite.db
        .update(deviceProfiles)
        .set({ formFactor: "phone-portrait" })
        .where(eq(deviceProfiles.id, changed));
      expect(await approved(t.deviceId)).toEqual([t.profileId, kept]);
    });

    it("forgets a device's approvals when the profile is deleted", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      await approve(app, venue, t.deviceId, [a]);
      await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, a));
      expect(await approved(t.deviceId)).toEqual([t.profileId]);
    });
  });

  describe("GET /api/device/me", () => {
    it("names the device's approved profiles, its active one first", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const a = await seedProfile("till");
      await approve(app, venue, t.deviceId, [a]);
      const names = await suite.db
        .select({ id: deviceProfiles.id, name: deviceProfiles.name })
        .from(deviceProfiles);
      const nameOf = (id: string) => names.find((row) => row.id === id)!.name;
      const res = await send(app, "GET", "/api/device/me", { cookie: t.jar });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        profileId: t.profileId,
        approvedProfiles: [
          { id: t.profileId, name: nameOf(t.profileId) },
          { id: a, name: nameOf(a) },
        ],
      });
    });
  });

  describe("POST /api/device/active-profile", () => {
    /** A till on profile `from`, with `to` approved; `from` lists [Bar, Counter] for receipts and
     * [Bar] for slips, and the device holds Counter and Bar. */
    async function switchable(app: Hono, venue: Venue) {
      const [bar, counter, kitchen] = await seedNamedPrinters(venue.cfg, [
        "Bar",
        "Counter",
        "Kitchen",
      ]);
      const from = await seedProfile("till");
      const to = await seedProfile("till");
      await withTransaction(suite.db, async (tx) => {
        await setProfilePrinterLists(tx, from, {
          receiptPrinterIds: [bar!, counter!],
          paymentSlipPrinterIds: [bar!],
        });
        // Counter stays on the new profile's receipt list; Bar is not on its slip list.
        await setProfilePrinterLists(tx, to, {
          receiptPrinterIds: [kitchen!, counter!],
          paymentSlipPrinterIds: [kitchen!],
        });
      });
      const { deviceId, jar } = await knockAndAccept(app, venue, { name: "Caja", profileId: from });
      await suite.db
        .update(devices)
        .set({ receiptPrinterId: counter!, paymentSlipPrinterId: bar! })
        .where(eq(devices.id, deviceId));
      await approve(app, venue, deviceId, [to]);
      return { deviceId, jar, from, to, bar: bar!, counter: counter!, kitchen: kitchen! };
    }

    it("switches to an approved profile, keeping a printer the new profile lists and moving the other to its first", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId);
      const res = await switchTo(app, me.cookie, s.to);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        activeProfileId: s.to,
        receiptPrinterId: s.counter,
        paymentSlipPrinterId: s.kitchen,
      });
      expect(await deviceBindings(s.deviceId)).toEqual({
        deviceProfileId: s.to,
        receiptPrinterId: s.counter,
        paymentSlipPrinterId: s.kitchen,
      });
      // The profile it left stays approved, so the device can switch back.
      expect(new Set(await approved(s.deviceId))).toEqual(new Set([s.from, s.to]));
      expect((await switchTo(app, me.cookie, s.from)).status).toBe(200);
      expect((await deviceBindings(s.deviceId)).deviceProfileId).toBe(s.from);
    });

    it("selecting the active profile again changes nothing", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      // A printer the profile does not list stays held: nothing is re-chosen.
      await suite.db
        .update(devices)
        .set({ receiptPrinterId: s.kitchen })
        .where(eq(devices.id, s.deviceId));
      const me = await signIn(s.deviceId);
      const other = await signIn(s.deviceId);
      await admitOnly(s.from, "manager");
      const res = await switchTo(app, me.cookie, s.from);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        activeProfileId: s.from,
        receiptPrinterId: s.kitchen,
        paymentSlipPrinterId: s.bar,
      });
      expect(await deviceBindings(s.deviceId)).toEqual({
        deviceProfileId: s.from,
        receiptPrinterId: s.kitchen,
        paymentSlipPrinterId: s.bar,
      });
      expect(await openSessionsOn(s.deviceId)).toEqual([me.personId, other.personId].sort());
    });

    it("ends the sessions of people the new profile does not admit, and keeps the others", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId, "manager");
      const otherManager = await signIn(s.deviceId, "manager");
      const staff = await signIn(s.deviceId, "staff");
      await admitOnly(s.to, "manager");
      expect((await switchTo(app, me.cookie, s.to)).status).toBe(200);
      expect(await openSessionsOn(s.deviceId)).toEqual([me.personId, otherManager.personId].sort());
      // The ended session can no longer act on the device.
      const after = await send(app, "PUT", "/api/device/printers", {
        cookie: staff.cookie,
        body: { receiptPrinterId: null },
      });
      expect(after.status).toBe(401);
      expect(await after.json()).toMatchObject({ error: { code: "session.required" } });
    });

    it("refuses a profile the device is not approved for, profile and printers untouched", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId);
      const before = await deviceBindings(s.deviceId);
      for (const target of [await seedProfile("till"), randomUUID()]) {
        const res = await switchTo(app, me.cookie, target);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "device_profile.not_approved" } });
      }
      expect(await deviceBindings(s.deviceId)).toEqual(before);
    });

    it("refuses an approval withdrawn while an old client still offers it", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId);
      const offered = await send(app, "GET", "/api/device/me", { cookie: s.jar });
      expect(
        ((await offered.json()) as { approvedProfiles: { id: string }[] }).approvedProfiles,
      ).toContainEqual(expect.objectContaining({ id: s.to }));
      await approve(app, venue, s.deviceId, []);
      const res = await switchTo(app, me.cookie, s.to);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "device_profile.not_approved" } });
      expect((await deviceBindings(s.deviceId)).deviceProfileId).toBe(s.from);
    });

    it("refuses a person the new profile does not admit, profile, printers and sessions untouched", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId, "staff");
      await admitOnly(s.to, "manager");
      const before = await deviceBindings(s.deviceId);
      const res = await switchTo(app, me.cookie, s.to);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "device_profile.not_admitted" } });
      expect(await deviceBindings(s.deviceId)).toEqual(before);
      expect(await openSessionsOn(s.deviceId)).toEqual([me.personId]);
    });

    it.each(["attempting", "initiated"] as const)(
      "refuses during a payment %s on the device, profile and printers untouched",
      async (state) => {
        const venue = await setupVenue(suite.db);
        const app = mountApp(venue.cfg);
        const s = await switchable(app, venue);
        const me = await signIn(s.deviceId);
        await paymentInProgress(venue, s.deviceId, state as "attempting");
        const before = await deviceBindings(s.deviceId);
        const res = await switchTo(app, me.cookie, s.to);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: "device.payment_in_progress" } });
        expect(await deviceBindings(s.deviceId)).toEqual(before);
      },
    );

    it("switches once the device's payment has finished, and a payment on another device does not stop it", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const other = await till(app, venue, "Otra caja");
      const me = await signIn(s.deviceId);
      const done = await paymentInProgress(venue, s.deviceId);
      await suite.db.update(payments).set({ state: "captured" }).where(eq(payments.id, done));
      await paymentInProgress(venue, other.deviceId);
      expect((await switchTo(app, me.cookie, s.to)).status).toBe(200);
    });

    it("refuses switching a screen moved onto a kitchen profile, with someone still signed in, to one that does not list its station", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const t = await till(app, venue);
      const me = await signIn(t.deviceId);
      const [listing, other] = [await seedProfile("kds"), await seedProfile("kds")];
      await withTransaction(suite.db, (tx) =>
        listOnProfile(tx, listing, { stationId: venue.defaultStationId }),
      );
      const moved = await manage(app, venue, t.deviceId, {
        profileId: listing,
        stationId: venue.defaultStationId,
        approvedProfileIds: [other],
      });
      expect(moved.status).toBe(204);
      // A kitchen profile with no role set admits every role, so the move left the session open.
      expect(await openSessionsOn(t.deviceId)).toEqual([me.personId]);

      const res = await switchTo(app, me.cookie, other);
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 400,
        body: {
          error: { code: "station.not_allowed", params: { stationId: venue.defaultStationId } },
        },
      });
      expect((await deviceBindings(t.deviceId)).deviceProfileId).toBe(listing);
    });

    it("a shared display with nobody signed in cannot switch", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const kds = await enrolKds(app, venue, venue.defaultStationId);
      const res = await switchTo(app, kds.jar, kds.profileId);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
      expect((await deviceBindings(kds.deviceId)).deviceProfileId).toBe(kds.profileId);
    });

    it("refuses a session that ended, or a device revoked, after the request was authenticated", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId);
      const [session] = await suite.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.personId, me.personId));
      const input = {
        deviceId: s.deviceId,
        sessionId: session!.id,
        personId: me.personId,
        profileId: s.to,
      };
      await suite.db
        .update(sessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(sessions.id, session!.id));
      const ended = await captureCode(() =>
        withTransaction(suite.db, (tx) => switchActiveProfile(tx, input)),
      );
      expect(ended).toBe("session.required");
      await suite.db.update(sessions).set({ endedAt: null }).where(eq(sessions.id, session!.id));
      await suite.db.update(devices).set({ active: false }).where(eq(devices.id, s.deviceId));
      const revoked = await captureCode(() =>
        withTransaction(suite.db, (tx) => switchActiveProfile(tx, input)),
      );
      expect(revoked).toBe("device.unauthorized");
      expect((await deviceBindings(s.deviceId)).deviceProfileId).toBe(s.from);
    });

    it("refuses a body without a profile id as management.request_invalid", async () => {
      const venue = await setupVenue(suite.db);
      const app = mountApp(venue.cfg);
      const s = await switchable(app, venue);
      const me = await signIn(s.deviceId);
      for (const bad of [undefined, null, "not-a-uuid"]) {
        const res = await switchTo(app, me.cookie, bad);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field: "profileId" } },
        });
      }
    });
  });
});
