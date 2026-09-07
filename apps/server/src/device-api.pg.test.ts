import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { listDeviceProfiles } from "@waitron/layouts";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
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
import { DEV_PAIRING_CODE } from "./dev-pairing.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS surface (CLAUDE.md §4). These routes read and write
// as `app_user` (enrol INSERTs a device, requireDevice SELECTs+UPDATEs it, the management group
// reads/revokes), so the table grants are enforced; PGlite connects as a superuser holding every
// privilege, where a missing GRANT passes and fails only at runtime. Each test provisions its OWN
// tenant, so its device/queue reads are that test's alone and order-independent across the shared
// clone.
const LOCALE = "es-ES";
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

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue {
  cfg: TillConfig;
  /** The location's provisioned default kitchen station — where `placeOrder` fires items, and the
   *  station the KDS device below binds to. */
  defaultStationId: string;
  cafeId: string;
  aguaId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `device.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    // ticket_then_pay so `placeOrder` FIRES the lines to the kitchen (open → placed) without filing a
    // fiscal doc — the lightest fire path that puts real ticket items on the station queue.
    orderFlow: "ticket_then_pay",
  };
}

/**
 * Stand up a fresh provisioned venue (mode `ticket_then_pay`), seed a two-product catalogue, and mint a
 * manager + staff management session. The venue provisions with the DEFAULT `prepay`; the `order_flow`
 * column is flipped to `ticket_then_pay` (as the owner, fixture setup) so the DB agrees with `cfg`, the
 * way `boot.ts`/`modeVenue` wire them.
 */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  await suite.admin.execute(
    sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
  );

  const seeded = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
    const cafe = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);

    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: cfg.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: cfg.tenantId,
      personId: stf.rows[0]!.id,
    });
    return {
      cafeId: cafe.id,
      aguaId: agua.id,
      managerSid: managerSession.id,
      staffSid: staffSession.id,
    };
  });

  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select id from kitchen_stations where location_id = ${cfg.locationId} and is_default and active`);

  return {
    cfg,
    defaultStationId: rows[0]!.id,
    cafeId: seeded.cafeId,
    aguaId: seeded.aguaId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.staffSid}`,
  };
}

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
    select till_id, device_profile_id, receipt_printer_id, has_cash_drawer, card_provider, card_reader_id
    from devices where id = ${deviceId}`);
  return rows[0]!;
}

function mountApp(cfg: TillConfig, enrolRateLimiter?: EnrolRateLimiter): Hono {
  const app = new Hono();
  // `enrolRateLimiter` omitted → mountDeviceApi builds the DEFAULT (generous 30/min) limiter, which no
  // ordinary suite trips. The rate-limit test below injects a limiter over a controllable clock (the cap
  // is the baked-in `ENROL_RATE_MAX` — no longer injectable — so it pre-fills the window in-process).
  mountDeviceApi(app, { db: suite.admin, cfg, secureCookies: false, enrolRateLimiter }, noopLog);
  return app;
}

/** A device API mounted with an explicit `devMode` flag — the SP-C dev per-tab device switcher surface
 *  (`GET /api/dev/devices`) exists ONLY when `devMode === true`, and 404s otherwise; the flag also lets
 *  `POST /api/device/enrol` accept the fixed dev pairing code (a 200 that is a 400 without it). The plain
 *  `mountApp` above omits the flag (undefined → dev routes not mounted), which is the fail-closed
 *  production shape. */
function mountDevApp(cfg: TillConfig, devMode: boolean): Hono {
  const app = new Hono();
  mountDeviceApi(app, { db: suite.admin, cfg, secureCookies: false, devMode }, noopLog);
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

/** Mint a BARE pairing code via the management route (the code carries no device description now — the
 *  device describes itself at enrol). Returns the plaintext code. */
async function mintCode(app: Hono, managerCookie: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/device-codes", { cookie: managerCookie });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

/** Enrol a `kds` device bound to `stationId` (mint → enrol with a kds profile). Returns the device id +
 *  the cookie jar. */
async function enrolKds(
  app: Hono,
  venue: Venue,
  stationId: string,
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const code = await mintCode(app, venue.managerCookie);
  const profileId = await seedProfile(venue.cfg, "kds");
  const res = await send(app, "POST", "/api/device/enrol", {
    body: { code, name: "Pantalla Cocina", profileId, stationId },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { deviceId: string };
  return { deviceId: body.deviceId, jar: deviceCookieFrom(res), profileId };
}

/** Enrol a `till` device (its profile auto-creates the register it rings against). Returns the device id
 *  + the cookie jar. */
async function enrolTill(
  app: Hono,
  venue: Venue,
  name = "Caja nueva",
): Promise<{ deviceId: string; jar: string; profileId: string; formFactor: string }> {
  const code = await mintCode(app, venue.managerCookie);
  const profileId = await seedProfile(venue.cfg, "till");
  const res = await send(app, "POST", "/api/device/enrol", { body: { code, name, profileId } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { deviceId: string; formFactor: string };
  return {
    deviceId: body.deviceId,
    jar: deviceCookieFrom(res),
    profileId,
    formFactor: body.formFactor,
  };
}

/** Enrol a `handheld` device bound to an EXISTING register (`registerId`). Returns the device id + jar. */
async function enrolHandheld(
  app: Hono,
  venue: Venue,
  registerId: string,
): Promise<{ deviceId: string; jar: string; profileId: string }> {
  const code = await mintCode(app, venue.managerCookie);
  const profileId = await seedProfile(venue.cfg, "phone-portrait");
  const res = await send(app, "POST", "/api/device/enrol", {
    body: { code, name: "Waiter phone", profileId, registerId },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { deviceId: string };
  return { deviceId: body.deviceId, jar: deviceCookieFrom(res), profileId };
}

describe("Device API over real Postgres — verify + enrol", () => {
  it("verify returns the venue catalogue and does NOT consume the code (the same code then enrols)", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "till");
    const code = await mintCode(app, venue.managerCookie);

    // Verify reads the catalogue WITHOUT burning the code (a plain SELECT, no DELETE).
    const verify = await send(app, "POST", "/api/device/enrol/verify", { body: { code } });
    expect(verify.status).toBe(200);
    const catalogue = (await verify.json()) as {
      profiles: { id: string; name: string; formFactor: string }[];
      stations: { id: string; name: string }[];
      registers: { id: string; name: string }[];
    };
    expect(catalogue.profiles.map((p) => p.id)).toContain(profileId);
    expect(catalogue.profiles.find((p) => p.id === profileId)).toMatchObject({
      formFactor: "till",
    });
    expect(catalogue.stations.map((s) => s.id)).toContain(venue.defaultStationId);
    // The venue's provisioned till (Caja 1) is a register the operator can pick for a handheld.
    expect(catalogue.registers.map((r) => r.id)).toContain(venue.cfg.tillId);

    // The SAME code still enrols — verify consumed nothing.
    const enrol = await send(app, "POST", "/api/device/enrol", {
      body: { code, name: "Caja nueva", profileId },
    });
    expect(enrol.status).toBe(200);
    expect(await enrol.json()).toMatchObject({ name: "Caja nueva", formFactor: "till" });
  });

  it("enrol with a `till` profile sets the cookie, auto-creates the register, and /me reports it", async () => {
    const venue = await setupVenue();
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

  it("enrol echoes only { deviceId, name, formFactor } — the token rides ONLY in the Set-Cookie", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const code = await mintCode(app, venue.managerCookie);
    const profileId = await seedProfile(venue.cfg, "till");
    const enrol = await send(app, "POST", "/api/device/enrol", {
      body: { code, name: "Caja", profileId },
    });
    expect(enrol.status).toBe(200);
    const body = (await enrol.json()) as Record<string, unknown>;
    expect(body).toEqual({ deviceId: expect.any(String), name: "Caja", formFactor: "till" });
    expect(body).not.toHaveProperty("token"); // positive no-echo: the secret is never in the body
    const setCookie = enrol.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${DEVICE_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("enrol scopes the cookie Domain to the tenant host, host-only otherwise", async () => {
    const venue = await setupVenue();
    const app = new Hono();
    mountDeviceApi(
      app,
      { db: suite.admin, cfg: venue.cfg, secureCookies: false, tenantDomain: "deli.waitron.app" },
      noopLog,
    );
    const enrolOnce = async (host: string): Promise<Response> => {
      const code = await mintCode(app, venue.managerCookie);
      const profileId = await seedProfile(venue.cfg, "till");
      // A unique device name per enrol: a `till` device auto-creates a register named after it, so two
      // enrols sharing a name would collide on `device.register_name_taken` (409).
      return send(app, "POST", "/api/device/enrol", {
        body: { code, name: `Caja ${host}`, profileId },
        host,
      });
    };
    const scoped = await enrolOnce("box.deli.waitron.app");
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get("set-cookie") ?? "").toMatch(/Domain=deli\.waitron\.app/i);

    const hostOnly = await enrolOnce("waitron.local");
    expect(hostOnly.status).toBe(200);
    expect(hostOnly.headers.get("set-cookie") ?? "").not.toMatch(/Domain=/i);
  });

  it("enrol is lenient about the transcribed code (a lowercased code enrols)", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const code = await mintCode(app, venue.managerCookie);
    const profileId = await seedProfile(venue.cfg, "till");
    const enrol = await send(app, "POST", "/api/device/enrol", {
      body: { code: code.toLowerCase(), name: "Caja", profileId },
    });
    expect(enrol.status).toBe(200);
  });

  it("verify/enrol with an unknown code → 400 device.pairing_invalid; a missing field → 400", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg, "till");

    const unknownVerify = await send(app, "POST", "/api/device/enrol/verify", {
      body: { code: "BADCODE9" },
    });
    expect(unknownVerify.status).toBe(400);
    expect((await unknownVerify.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_invalid" },
    });

    const unknownEnrol = await send(app, "POST", "/api/device/enrol", {
      body: { code: "BADCODE9", name: "Caja", profileId },
    });
    expect(unknownEnrol.status).toBe(400);
    expect((await unknownEnrol.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_invalid" },
    });

    // A missing `code` → the shared string screen names the field, never a TypeError 500.
    const missingCode = await send(app, "POST", "/api/device/enrol/verify", { body: {} });
    expect(missingCode.status).toBe(400);
    expect(
      (await missingCode.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });

    // A missing `name`/`profileId` on enrol (with a real code) → the respective field screen.
    const code = await mintCode(app, venue.managerCookie);
    const noName = await send(app, "POST", "/api/device/enrol", { body: { code, profileId } });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    const code2 = await mintCode(app, venue.managerCookie);
    const noProfile = await send(app, "POST", "/api/device/enrol", {
      body: { code: code2, name: "Caja" },
    });
    expect(noProfile.status).toBe(400);
    expect(
      (await noProfile.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "profileId" } },
    });
  });

  it("verify/enrol with an EMPTY or MALFORMED body → 400 management.request_invalid, never a 500", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);

    for (const path of ["/api/device/enrol/verify", "/api/device/enrol"]) {
      const empty = await app.request(path, { method: "POST" });
      expect(empty.status).toBe(400);
      expect(
        (await empty.json()) as { error: { code: string; params: { field: string } } },
      ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });

      const malformed = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(malformed.status).toBe(400);
      expect((await malformed.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management.request_invalid" },
      });
    }
  });

  it("enrol with a kds profile but NO station → 400 device.station_required; a handheld with NO register → 400 device.register_required", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);

    const kdsCode = await mintCode(app, venue.managerCookie);
    const kdsProfile = await seedProfile(venue.cfg, "kds");
    const noStation = await send(app, "POST", "/api/device/enrol", {
      body: { code: kdsCode, name: "Pantalla", profileId: kdsProfile },
    });
    expect(noStation.status).toBe(400);
    expect((await noStation.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.station_required" },
    });

    const hhCode = await mintCode(app, venue.managerCookie);
    const hhProfile = await seedProfile(venue.cfg, "phone-portrait");
    const noRegister = await send(app, "POST", "/api/device/enrol", {
      body: { code: hhCode, name: "Waiter", profileId: hhProfile },
    });
    expect(noRegister.status).toBe(400);
    expect((await noRegister.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.register_required" },
    });
  });

  it("enrol with a well-formed but UNKNOWN profileId → 404 device_profile.not_found (not a 500), nothing created", async () => {
    // `profileId` is the operator's own choice from the verify catalogue, so a profile that is unknown
    // (or was deleted between verify and enrol) is a CLIENT-recoverable 404 — never the 500 a server
    // fault pages as. The consume-DELETE, register insert and device insert share ONE transaction, so
    // the throw rolls all of them back: no device, and no new register beyond the venue's provisioned one.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const code = await mintCode(app, venue.managerCookie);
    const res = await send(app, "POST", "/api/device/enrol", {
      body: { code, name: "Caja", profileId: randomUUID() },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device_profile.not_found" },
    });
    const devices = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from devices where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(devices.rows[0]!.n).toBe(0);
    // Only the venue's provisioned till exists — the rolled-back enrol minted no register.
    const tills = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tills where tenant_id = ${venue.cfg.tenantId}`,
    );
    expect(tills.rows[0]!.n).toBe(1);
  });

  it("enrol → authenticated station read → bump own item → foreign 403 → revoke stops the cookie", async () => {
    const venue = await setupVenue();
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
    const venue = await setupVenue();
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
    const venue = await setupVenue();
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
    const venue = await setupVenue();
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
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const DUMMY = "00000000-0000-0000-0000-000000000000";

    for (const res of [
      await send(app, "POST", "/management-api/device-codes", {}),
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
      await send(app, "POST", "/management-api/device-codes", { cookie: venue.staffCookie }),
    );
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
    const venue = await setupVenue();
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
    const venue = await setupVenue();
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
    const venueA = await setupVenue();
    const venueB = await setupVenue();
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
      const venue = await setupVenue();
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
      const venue = await setupVenue();
      const foreign = await setupVenue();
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
      const venue = await setupVenue();
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
  it("sets the hardware trio (+reader) and returns the updated device", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja hw");

    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.managerCookie,
      body: {
        receiptPrinterId: printerId,
        hasCashDrawer: true,
        cardProvider: "stripe_terminal",
        cardReaderId: "reader-9",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: deviceId,
      receiptPrinterId: printerId,
      hasCashDrawer: true,
      cardProvider: "stripe_terminal",
      cardReaderId: "reader-9",
    });
    // The row itself carries the new bindings (read back as the superuser, bypassing the route).
    expect(await deviceBindings(deviceId)).toMatchObject({
      receipt_printer_id: printerId,
      has_cash_drawer: true,
      card_provider: "stripe_terminal",
      card_reader_id: "reader-9",
    });
  });

  it("requires device.manage — 401 unauthenticated, 403 for a staff session", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja gate");

    const unauth = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      body: { cardProvider: "none" },
    });
    expect(unauth.status).toBe(401);
    expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    const staff = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.staffCookie,
      body: { cardProvider: "none" },
    });
    expect(staff.status).toBe(403);
    expect((await staff.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("rejects an unknown cardProvider with 400 management.request_invalid naming the field", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolTill(app, venue, "Caja bad");

    const res = await send(app, "PATCH", `/management-api/devices/${deviceId}/hardware`, {
      cookie: venue.managerCookie,
      body: { cardProvider: "paypal" },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "cardProvider" } },
    });
    // Nothing was written — the provider stayed at the enrol default.
    expect((await deviceBindings(deviceId)).card_provider).toBe("none");
  });

  it("404s an unknown or malformed device id", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const unknown = randomUUID();
    const res = await send(app, "PATCH", `/management-api/devices/${unknown}/hardware`, {
      cookie: venue.managerCookie,
      body: { cardProvider: "none" },
    });
    expect(res.status).toBe(404);
    expect(
      (await res.json()) as { error: { code: string; params: { deviceId: string } } },
    ).toMatchObject({ error: { code: "device.not_found", params: { deviceId: unknown } } });

    const malformed = await send(app, "PATCH", "/management-api/devices/not-a-uuid/hardware", {
      cookie: venue.managerCookie,
      body: { cardProvider: "none" },
    });
    expect(malformed.status).toBe(404);
  });

  it("404s a FOREIGN tenant's device — the update is tenant-scoped, not just by id", async () => {
    // Enrol a device in venue A, then PATCH it through venue B's mount (cfg B). A by-id write STILL
    // scopes to the tenant (CLAUDE.md §3), so B's UPDATE matches 0 rows and 404s rather than reaching
    // across the (globally-unique) id. RUN, not read: proven against real Postgres as `app_user`.
    const venueA = await setupVenue();
    const venueB = await setupVenue();
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
    const venue = await setupVenue();
    const foreign = await setupVenue();
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
    const venue = await setupVenue();
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
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);
    const { deviceId, jar } = await enrolTill(app, venue, "Caja hw");
    await suite.admin.execute(sql`
      update devices
         set receipt_printer_id = ${printerId}, has_cash_drawer = true,
             card_provider = 'sumup', card_reader_id = 'reader-xyz'
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
      cardProvider: "sumup",
      cardReaderId: "reader-xyz",
    });
  });

  it("GET /api/device/station 401s an enrolled handheld — it is bound to no station", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { jar } = await enrolHandheld(app, venue, venue.cfg.tillId);
    const res = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });

  it("GET /api/device/me 401s a request with no device cookie", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/api/device/me", { cookie: null });
    expect(res.status).toBe(401);
  });
});

describe("enrol rate limiter (spec §8)", () => {
  it("rate-limits enrol: the (cap+1)th attempt is 429 BEFORE the DB (no code consumed), then the window resets", async () => {
    const venue = await setupVenue();
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const app = mountApp(venue.cfg, limiter);
    const profileId = await seedProfile(venue.cfg, "till");
    const code = await mintCode(app, venue.managerCookie);

    for (let i = 0; i < ENROL_RATE_MAX - 2; i++) limiter.check();

    for (const junk of ["BADCODE1", "BADCODE2"]) {
      const r = await send(app, "POST", "/api/device/enrol", {
        body: { code: junk, name: "Caja", profileId },
      });
      expect(r.status).toBe(400);
      expect((await r.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "device.pairing_invalid" },
      });
    }

    const limited = await send(app, "POST", "/api/device/enrol", {
      body: { code, name: "Caja", profileId },
    });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_rate_limited" },
    });

    // Past the window: the counter resets and the SAME code STILL enrols — the throttled attempt
    // consumed nothing.
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const ok = await send(app, "POST", "/api/device/enrol", {
      body: { code, name: "Caja", profileId },
    });
    expect(ok.status).toBe(200);
  });

  it("rate-limits verify too: the (cap+1)th verify is 429 BEFORE the DB", async () => {
    const venue = await setupVenue();
    const limiter = createEnrolRateLimiter({ now: () => 1_000 });
    const app = mountApp(venue.cfg, limiter);
    const code = await mintCode(app, venue.managerCookie);

    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();

    const limited = await send(app, "POST", "/api/device/enrol/verify", { body: { code } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_rate_limited" },
    });
  });
});

describe("GET /api/dev/devices (dev-only chooser list)", () => {
  it("lists the venue's active devices (kind derived), no option-sources, no token", async () => {
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);
    const { deviceId } = await enrolKds(app, venue, venue.defaultStationId);

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
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);
    const live = await enrolKds(app, venue, venue.defaultStationId);
    const doomed = await enrolKds(app, venue, venue.defaultStationId);
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
    const venue = await setupVenue();
    expect((await send(mountDevApp(venue.cfg, false), "GET", "/api/dev/devices")).status).toBe(404);
    expect((await send(mountApp(venue.cfg), "GET", "/api/dev/devices")).status).toBe(404);
  });
});

describe("deleted routes are gone (404)", () => {
  it("POST /api/dev/devices and POST /api/device/reset no longer exist, even under devMode", async () => {
    const venue = await setupVenue();
    const devApp = mountDevApp(venue.cfg, true);
    expect((await send(devApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(devApp, "POST", "/api/device/reset", {})).status).toBe(404);
    const prodApp = mountApp(venue.cfg);
    expect((await send(prodApp, "POST", "/api/dev/devices", { body: {} })).status).toBe(404);
    expect((await send(prodApp, "POST", "/api/device/reset", {})).status).toBe(404);
  });
});

describe("POST /api/device/enrol/verify + enrol with the fixed dev code (dev-only)", () => {
  /** A `till` profile of this venue the dev enrol can bind — provisioning seeds the default set. */
  async function aTillProfileId(cfg: TillConfig): Promise<string> {
    const profiles = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return listDeviceProfiles(tx, cfg.tenantId);
    });
    return profiles.find((p) => p.formFactor === "till")!.id;
  }

  it("verify accepts DEMO under devMode and returns the catalogue without a real code row", async () => {
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);
    const res = await send(app, "POST", "/api/device/enrol/verify", {
      body: { code: DEV_PAIRING_CODE.toLowerCase() },
    });
    expect(res.status).toBe(200);
    const catalogue = (await res.json()) as { profiles: { formFactor: string }[] };
    expect(catalogue.profiles.some((p) => p.formFactor === "till")).toBe(true);
  });

  it("enrol runs the REAL path for DEMO under devMode (mints a fresh code, enrols the chosen profile)", async () => {
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);
    const profileId = await aTillProfileId(venue.cfg);
    const enrol = await send(app, "POST", "/api/device/enrol", {
      body: { code: DEV_PAIRING_CODE, name: "Mostrador dev", profileId },
    });
    expect(enrol.status).toBe(200);
    const deviceId = ((await enrol.json()) as { deviceId: string }).deviceId;
    expect((await deviceBindings(deviceId)).device_profile_id).toBe(profileId);
  });

  it("DEMO is reusable — a second fresh browser enrols a second device", async () => {
    const venue = await setupVenue();
    const app = mountDevApp(venue.cfg, true);
    const profileId = await aTillProfileId(venue.cfg);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const enrol = await send(app, "POST", "/api/device/enrol", {
        body: { code: DEV_PAIRING_CODE, name: `Mostrador ${i}`, profileId },
      });
      expect(enrol.status).toBe(200);
      ids.push(((await enrol.json()) as { deviceId: string }).deviceId);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it("DEMO is refused (400 device.pairing_invalid) outside devMode, on both routes", async () => {
    const venue = await setupVenue();
    const profileId = await aTillProfileId(venue.cfg);
    for (const app of [mountDevApp(venue.cfg, false), mountApp(venue.cfg)]) {
      const verify = await send(app, "POST", "/api/device/enrol/verify", {
        body: { code: DEV_PAIRING_CODE },
      });
      expect(verify.status).toBe(400);
      expect(((await verify.json()) as { error: { code: string } }).error.code).toBe(
        "device.pairing_invalid",
      );
      const enrol = await send(app, "POST", "/api/device/enrol", {
        body: { code: DEV_PAIRING_CODE, name: "X", profileId },
      });
      expect(enrol.status).toBe(400);
      expect(((await enrol.json()) as { error: { code: string } }).error.code).toBe(
        "device.pairing_invalid",
      );
    }
  });
});
