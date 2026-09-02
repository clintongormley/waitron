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
import { MANAGEMENT_COOKIE } from "./management-session.js";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres, not PGlite — mandatory for THIS surface (CLAUDE.md §4). These routes read and write
// under RLS as `app_user` (enrol INSERTs a device, requireDevice SELECTs+UPDATEs it, the management
// group reads/revokes under the tenant-isolation policy), and the two proofs this suite is FOR — that
// `device.manage` gates the management routes, and that revocation (`active = false`) instantly stops
// the device cookie — are exactly what PGlite's all-superuser, single-backend connection FALSE-passes:
// a superuser bypasses FORCE RLS, so a "gate refused it" / "revoked device is invisible" there proves
// nothing. Each test provisions its OWN tenant, so its device/queue reads are that test's alone and
// order-independent across the shared clone.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });
const noopLog: Logger = () => {};

// The accountable operator every placing amendment is attributed to (a plain uuid, no FK — the shape
// working-order.rls.test.ts uses).
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
      throw new Error("device-api.rls.test: anchor() is not used here");
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
      Promise.reject(new Error("device-api.rls.test: resolveClient must never be called")),
  });
});

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling RLS suites use.
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
 * column is flipped to `ticket_then_pay` (as the owner, RLS bypassed) so the DB agrees with `cfg`, the
 * way `boot.ts`/`modeVenue` wire them.
 */
async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
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
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  await suite.admin.execute(
    sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
  );

  const seeded = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
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
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
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
  await placeOrder({ db: suite.admin, backend, clock }, venue.cfg, orderId, OPERATOR);
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    select ti.id from ticket_items ti
    join working_order_lines wol on wol.id = ti.working_order_line_id and wol.tenant_id = ti.tenant_id
    where ti.working_order_id = ${orderId}
    order by wol.line_no`);
  return { orderId, items: rows.map((r) => r.id) };
}

/** Move a ticket item to a DIFFERENT station (owner SQL, RLS bypassed) — manufactures a "foreign
 *  station" item the device bound to the default station may not bump. */
async function moveItemToStation(itemId: string, stationId: string): Promise<void> {
  await suite.admin.execute(
    sql`update ticket_items set station_id = ${stationId} where id = ${itemId}`,
  );
}

/** Seed a layout profile for the venue (owner SQL) — a real `(tenant_id, id)` a device binding can name. */
async function seedProfile(cfg: TillConfig): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into layout_profiles (tenant_id, name, definition)
    values (${cfg.tenantId}, 'Perfil A', ${JSON.stringify({ formFactor: "tablet" })}::jsonb)
    returning id`);
  return rows[0]!.id;
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

/** The enrolled device row's binding columns, read as the superuser (RLS bypassed). */
async function deviceBindings(deviceId: string): Promise<Record<string, unknown>> {
  const { rows } = await suite.admin.execute<Record<string, unknown>>(sql`
    select till_id, layout_profile_id, receipt_printer_id, has_cash_drawer, card_provider, card_reader_id
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

/** JSON request helper. `cookie: null` sends none; omitted sends none too (each caller is explicit). */
async function send(
  app: Hono,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined && opts.cookie !== null) headers["cookie"] = opts.cookie;
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

/** Mint a pairing code from `codeBody` via the management route, then enrol a device with it (unauth).
 *  The ONE enrol path both `enrolAt` (kds_station) and `enrolHandheld` funnel through, so the two kinds
 *  cannot drift. Returns the device id + the cookie jar. */
async function enrolWithCode(
  app: Hono,
  managerCookie: string,
  codeBody: { kind: string; stationId?: string; tillId?: string; label: string },
): Promise<{ deviceId: string; jar: string }> {
  const codeRes = await send(app, "POST", "/management-api/device-codes", {
    cookie: managerCookie,
    body: codeBody,
  });
  expect(codeRes.status).toBe(201);
  const { code } = (await codeRes.json()) as { code: string };

  const enrol = await send(app, "POST", "/api/device/enrol", { body: { code } });
  expect(enrol.status).toBe(200);
  const deviceId = ((await enrol.json()) as { deviceId: string }).deviceId;
  return { deviceId, jar: deviceCookieFrom(enrol) };
}

/** Mint a pairing code for a station via the management route, then enrol a device with it (unauth).
 *  Returns the device id + the cookie jar. */
function enrolAt(
  app: Hono,
  managerCookie: string,
  stationId: string,
): Promise<{ deviceId: string; jar: string }> {
  return enrolWithCode(app, managerCookie, {
    kind: "kds_station",
    stationId,
    label: "Pantalla Cocina",
  });
}

/** Mint a HANDHELD pairing code (no station — Task 2: `kindRequiresStation("handheld")` is false; but a
 *  handheld IS sale-capable, so it carries the venue's till_id — SP-A.2 §16.4), then enrol a device with
 *  it (unauth). Returns the device id + the cookie jar. */
function enrolHandheld(
  app: Hono,
  managerCookie: string,
  tillId: string,
): Promise<{ deviceId: string; jar: string }> {
  return enrolWithCode(app, managerCookie, { kind: "handheld", tillId, label: "Waiter phone" });
}

describe("Device API over real Postgres", () => {
  it("enrol → authenticated station read → bump own item → foreign 403 → revoke stops the cookie", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);

    // A SECOND station in the same venue; one of the fired items is moved here to become "foreign".
    const fria = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createStation(tx, venue.cfg, { name: "Fría", isDefault: false });
    });
    const { items } = await fireOrder(venue);
    const [ownItem, foreignItem] = items;
    await moveItemToStation(foreignItem!, fria.id);

    // Enrol a device bound to the DEFAULT station (unauthenticated). The body echoes the non-secret
    // fields the manager chose (spec §3b) — deviceId, kind, stationId, label — while the bearer token
    // rides ONLY in the Set-Cookie header and is NEVER echoed in the body.
    const codeRes = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: { kind: "kds_station", stationId: venue.defaultStationId, label: "Pantalla Cocina" },
    });
    const { code } = (await codeRes.json()) as { code: string };
    const enrol = await send(app, "POST", "/api/device/enrol", { body: { code } });
    expect(enrol.status).toBe(200);
    const enrolBody = (await enrol.json()) as Record<string, unknown>;
    expect(enrolBody).toMatchObject({
      deviceId: expect.any(String),
      kind: "kds_station",
      stationId: venue.defaultStationId,
      label: "Pantalla Cocina",
    });
    expect(enrolBody).not.toHaveProperty("token"); // positive no-echo: the secret is never in the body
    const setCookie = enrol.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${DEVICE_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    const jar = deviceCookieFrom(enrol);

    // Authenticated station read: the device sees its OWN bound station and that station's queue (the
    // fired café line shows; the agua line was moved to Fría, so it does not).
    const stationRes = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(stationRes.status).toBe(200);
    const station = (await stationRes.json()) as {
      station: { id: string; queue: { items: { id: string }[] }[] };
    };
    expect(station.station.id).toBe(venue.defaultStationId);
    const queuedItemIds = station.station.queue.flatMap((g) => g.items.map((i) => i.id));
    expect(queuedItemIds).toContain(ownItem);
    expect(queuedItemIds).not.toContain(foreignItem);

    // Bump the device's OWN item one step → 204.
    const bump = await send(app, "POST", `/api/device/ticket-items/${ownItem}/advance`, {
      cookie: jar,
      body: { to: "preparing" },
    });
    expect(bump.status).toBe(204);

    // Bumping a FOREIGN station's item is refused 403, naming the item's real station (not the device's).
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

    // REVOCATION BY DELETION: the device works until revoked. `POST …/revoke` sets `active = false`, and
    // the very next request on the SAME cookie is `device.unauthorized` (401) — instant, no token TTL to
    // wait out. Deleting the `eq(devices.active, true)` filter from `requireDevice` (device-session.ts)
    // makes this final read 200 instead of 401 (a revoked device would still authenticate) — the guard's
    // deletion receipt; restoring it turns the test green again.
    const deviceId = enrolBody.deviceId as string;
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

  it("POST /api/device/enrol is lenient about the transcribed code (a lowercased code enrols)", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const codeRes = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: { kind: "kds_station", stationId: venue.defaultStationId, label: "P" },
    });
    const { code } = (await codeRes.json()) as { code: string };
    const enrol = await send(app, "POST", "/api/device/enrol", {
      body: { code: code.toLowerCase() },
    });
    expect(enrol.status).toBe(200);
    // The lowercased code still authenticates: the device it enrolled reads its station.
    const jar = deviceCookieFrom(enrol);
    const stationRes = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(stationRes.status).toBe(200);
  });

  it("POST /api/device/enrol with an unknown code → 400 device.pairing_invalid; a missing code → 400", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const unknown = await send(app, "POST", "/api/device/enrol", { body: { code: "BADCODE9" } });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_invalid" },
    });
    const missing = await send(app, "POST", "/api/device/enrol", { body: {} });
    expect(missing.status).toBe(400);
    expect(
      (await missing.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });

    // A null body is coerced to `{}` and reaches the code screen as a clean 400, never a TypeError.
    const nullBody = await send(app, "POST", "/api/device/enrol", { body: null });
    expect(nullBody.status).toBe(400);
    expect(
      (await nullBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });
  });

  it("POST /api/device/enrol with an EMPTY or MALFORMED body → 400 management.request_invalid, never a 500", async () => {
    // hono's `c.req.json()` THROWS a `SyntaxError` on an empty or malformed body — BEFORE any `?? {}`
    // could run — so without a defensive parse the throw reaches `run` as a NON-AppError and becomes an
    // opaque `server.internal` 500 (the `?? {}` only ever caught a literal JSON `null`). The guarded
    // parse coerces a parse failure to `{}`, so the body flows to the `code` screen → a clean 400. This
    // is the receipt for that fix: BEFORE it, both requests below were 500.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);

    // An EMPTY body (the `send` helper omits the body and content-type entirely).
    const empty = await app.request("/api/device/enrol", { method: "POST" });
    expect(empty.status).toBe(400);
    expect(
      (await empty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });

    // A MALFORMED body (`"{"`) — sent raw, since `send` would JSON.stringify it into valid JSON.
    const malformed = await app.request("/api/device/enrol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(
      (await malformed.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });
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
    const { jar } = await enrolAt(app, venue.managerCookie, venue.defaultStationId);

    // A queued item cannot skip straight to `ready` — advanceTicketItem refuses it, mapped 409.
    const skip = await send(app, "POST", `/api/device/ticket-items/${items[0]}/advance`, {
      cookie: jar,
      body: { to: "ready" },
    });
    expect(skip.status).toBe(409);
    expect((await skip.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ticket.invalid_transition" },
    });

    // A non-uuid item id names no item — screened to the same 409 (never a 22P02 500).
    const malformed = await send(app, "POST", "/api/device/ticket-items/not-a-uuid/advance", {
      cookie: jar,
      body: { to: "preparing" },
    });
    expect(malformed.status).toBe(409);
  });

  it("advance with an EMPTY, MALFORMED, or null body degrades to 409 ticket.invalid_transition, never a 500", async () => {
    // Same defensive-parse fix as enrol: a valid device + a valid item id, but the body is degenerate.
    // hono's `c.req.json()` THROWS a `SyntaxError` on an empty/malformed body (→ opaque 500 without the
    // `.catch`) and returns `null` for a literal JSON `null` (→ a `null.to` TypeError 500 without the
    // `?? {}`). The guarded parse coerces all three to `{}`, so `to` is undefined and reaches
    // `advanceTicketItem`'s transition screen → the SAME 409 an absent/garbage target gives. BEFORE the
    // fix the empty/malformed requests were 500 (the original route had no `?? {}` at all, so null was
    // a 500 too).
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { items } = await fireOrder(venue);
    const { jar } = await enrolAt(app, venue.managerCookie, venue.defaultStationId);

    // An EMPTY body on a real, own-station item.
    const empty = await app.request(`/api/device/ticket-items/${items[0]}/advance`, {
      method: "POST",
      headers: { cookie: jar },
    });
    expect(empty.status).toBe(409);
    expect((await empty.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ticket.invalid_transition" },
    });

    // A MALFORMED body (`"{"`) — sent raw.
    const malformedBody = await app.request(`/api/device/ticket-items/${items[0]}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: "{",
    });
    expect(malformedBody.status).toBe(409);
    expect((await malformedBody.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ticket.invalid_transition" },
    });

    // A literal JSON `null` body (`send` serialises `null` to the 4-byte `"null"`): parses to `null`
    // without throwing, so the `?? {}` — not the `.catch` — is what saves it from a `null.to` 500.
    const nullBody = await send(app, "POST", `/api/device/ticket-items/${items[0]}/advance`, {
      cookie: jar,
      body: null,
    });
    expect(nullBody.status).toBe(409);
    expect((await nullBody.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ticket.invalid_transition" },
    });
  });

  it("the management routes require device.manage — 401 unauthenticated, 403 for a staff session", async () => {
    // Prove the `device.manage` gate BY DELETION. A `staff`-role session holds no `device.manage`, so
    // `authorizeManager` (inside device-api's `gated`) throws `authorization.not_permitted` before any
    // op runs on all three management routes. Deleting the `authorizeManager(...)` call from
    // `device-api.ts`'s `gated` helper makes every staff request below succeed (device-codes → 201,
    // devices → 200, revoke → 404 for the dummy id), flipping the `toBe(403)` assertions green→red;
    // restoring it turns them green again.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const DUMMY = "00000000-0000-0000-0000-000000000000";
    const codeBody = { kind: "kds_station", stationId: venue.defaultStationId, label: "P" };

    // Unauthenticated (no cookie) → 401 management_session.required on every management route.
    for (const res of [
      await send(app, "POST", "/management-api/device-codes", { body: codeBody }),
      await send(app, "GET", "/management-api/devices", {}),
      await send(app, "POST", `/management-api/devices/${DUMMY}/revoke`, {}),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });
    }

    // A staff-role session → 403 authorization.not_permitted on every management route.
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    };
    await expect403(
      await send(app, "POST", "/management-api/device-codes", {
        cookie: venue.staffCookie,
        body: codeBody,
      }),
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

  it("GET /management-api/devices lists this tenant's enrolled devices", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { deviceId } = await enrolAt(app, venue.managerCookie, venue.defaultStationId);
    const res = await send(app, "GET", "/management-api/devices", { cookie: venue.managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      id: string;
      kind: string;
      stationId: string;
      label: string;
      active: boolean;
    }[];
    const mine = rows.find((r) => r.id === deviceId)!;
    expect(mine).toMatchObject({
      kind: "kds_station",
      stationId: venue.defaultStationId,
      label: "Pantalla Cocina",
      active: true,
    });
  });

  it("device-codes screens the body: a bad kind, a malformed station, and an unknown station", async () => {
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const post = (body: unknown) =>
      send(app, "POST", "/management-api/device-codes", { cookie: venue.managerCookie, body });

    // A kind the enum does not carry → request-shape 400 naming the field.
    const badKind = await post({
      kind: "trusted_till",
      stationId: venue.defaultStationId,
      label: "P",
    });
    expect(badKind.status).toBe(400);
    expect(
      (await badKind.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "kind" } } });

    // A non-uuid station id → request-shape 400 (never a 22P02 500 in requireLiveStation).
    const badStation = await post({ kind: "kds_station", stationId: "not-a-uuid", label: "P" });
    expect(badStation.status).toBe(400);
    expect(
      (await badStation.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "stationId" } },
    });

    // A well-formed but unknown station → 404 station.not_found (requireLiveStation, inside the verb).
    const missing = randomUUID();
    const unknownStation = await post({ kind: "kds_station", stationId: missing, label: "P" });
    expect(unknownStation.status).toBe(404);
    expect((await unknownStation.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "station.not_found" },
    });

    // A malformed (non-uuid) tillId on a sale-capable kind → request-shape 400 naming the field, BEFORE
    // the verb's gate — the route screens the SHAPE of a present binding (a non-uuid would 22P02 at the
    // bare-uuid column). An absent binding is passed through as null, not screened (proven elsewhere).
    const badTill = await post({ kind: "till", tillId: "not-a-uuid", label: "P" });
    expect(badTill.status).toBe(400);
    expect(
      (await badTill.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "tillId" } } });

    // A non-boolean hasCashDrawer → request-shape 400 naming the field.
    const badDrawer = await post({
      kind: "till",
      tillId: venue.cfg.tillId,
      hasCashDrawer: "yes",
      label: "P",
    });
    expect(badDrawer.status).toBe(400);
    expect(
      (await badDrawer.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "hasCashDrawer" } },
    });

    // A missing label → request-shape 400 naming the field.
    const noLabel = await post({ kind: "kds_station", stationId: venue.defaultStationId });
    expect(noLabel.status).toBe(400);
    expect(
      (await noLabel.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "label" } } });

    // A null body is coerced to `{}` and reaches the kind screen as a clean 400, never a TypeError.
    const nullBody = await post(null);
    expect(nullBody.status).toBe(400);
    expect(
      (await nullBody.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "kind" } } });

    // An EMPTY body (no body, no content-type) with a valid manager session reaches the gated handler,
    // where `c.req.json()` THROWS — the guarded parse coerces it to `{}` → the kind screen → a clean 400,
    // never an opaque 500 (the same fix the enrol route carries; without it this was a 500).
    const empty = await app.request("/management-api/device-codes", {
      method: "POST",
      headers: { cookie: venue.managerCookie },
    });
    expect(empty.status).toBe(400);
    expect(
      (await empty.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "kind" } } });

    // A MALFORMED body (`"{"`) — sent raw so it is not valid JSON — is likewise coerced to `{}` → 400.
    const malformed = await app.request("/management-api/device-codes", {
      method: "POST",
      headers: { cookie: venue.managerCookie, "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(
      (await malformed.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "kind" } } });
  });

  it("mints a handheld code with no station (but WITH a till — it is sale-capable)", async () => {
    // A `handheld` code binds to no station (Task 2: `kindRequiresStation("handheld")` is false), so a
    // body carrying NO `stationId` mints a code — the route makes the station conditional on the kind.
    // THE PROOF: reverting the route to the unconditional `requireBodyUuid(body.stationId, …)` rejects
    // this missing station as `management.request_invalid` (400), flipping the assertion red; restoring
    // the conditional turns it green again. A handheld IS sale-capable, so the body carries a `tillId`
    // (SP-A.2 §16.4) — omitting it would be `device.till_required`, exercised by the gate test below.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const res = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: { kind: "handheld", tillId: venue.cfg.tillId, label: "Waiter phone" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).code).toEqual(expect.any(String));
  });

  it("device-codes reads the binding fields and enrolment stamps them; the gate + FK map to 400", async () => {
    // The route reads the profile/till/hardware body fields and passes them to generatePairingCode; the
    // enrolled device carries them (SP-A.2 §16). Proven end to end through HTTP: mint a `till` code with
    // every binding, enrol, and read the device row back. Then the two failure mappings the route's
    // STATUS map owns: the till gate (device.till_required) and the binding-FK translation
    // (device.binding_invalid) both surface as 400.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const profileId = await seedProfile(venue.cfg);
    const printerId = await seedPrinter(venue.cfg);

    const codeRes = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: {
        kind: "till",
        tillId: venue.cfg.tillId,
        layoutProfileId: profileId,
        receiptPrinterId: printerId,
        hasCashDrawer: true,
        cardProvider: "sumup",
        cardReaderId: "reader-xyz",
        label: "Caja 1",
      },
    });
    expect(codeRes.status).toBe(201);
    const { code } = (await codeRes.json()) as { code: string };
    const enrol = await send(app, "POST", "/api/device/enrol", { body: { code } });
    expect(enrol.status).toBe(200);
    const deviceId = ((await enrol.json()) as { deviceId: string }).deviceId;
    expect(await deviceBindings(deviceId)).toMatchObject({
      till_id: venue.cfg.tillId,
      layout_profile_id: profileId,
      receipt_printer_id: printerId,
      has_cash_drawer: true,
      card_provider: "sumup",
      card_reader_id: "reader-xyz",
    });

    // The till gate through the route: a sale-capable `till` code with no till_id → 400 till_required.
    const noTill = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: { kind: "till", label: "Caja 2" },
    });
    expect(noTill.status).toBe(400);
    expect((await noTill.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.till_required" },
    });

    // The binding-FK translation through the route: a nonexistent layout_profile_id → 400 binding_invalid.
    const badProfile = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: {
        kind: "till",
        tillId: venue.cfg.tillId,
        layoutProfileId: randomUUID(),
        label: "Caja 3",
      },
    });
    expect(badProfile.status).toBe(400);
    expect(
      (await badProfile.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "device.binding_invalid", params: { field: "layoutProfileId" } },
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

  it("rate-limits enrol: the (cap+1)th attempt is 429 BEFORE the DB (no code consumed), then the window resets", async () => {
    // The redemption rate-limit (spec §8): a per-process, GLOBAL fixed-window counter checked at the TOP
    // of the enrol handler, before the body is parsed and before the pairing-code DELETE. A CONTROLLABLE
    // clock (`now`) plus an IN-PROCESS pre-fill of the baked-in `ENROL_RATE_MAX` (30) to two below the cap
    // (the `limiter.check()` loop below) lets the two junk HTTP attempts bring the counter exactly to the
    // cap and the valid third attempt be the (cap+1)th → 429 — proving the behaviour without a real sleep
    // (CLAUDE.md §4) and without `ENROL_RATE_MAX` DB round trips. The mgmt route that mints the code is NOT
    // throttled — the limiter is on `/api/device/enrol` alone.
    const venue = await setupVenue();
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const app = mountApp(venue.cfg, limiter);

    // Mint ONE valid code up front. It must SURVIVE the throttled attempt below (the guard short-circuits
    // before the DELETE), so it can still redeem once the window resets.
    const codeRes = await send(app, "POST", "/management-api/device-codes", {
      cookie: venue.managerCookie,
      body: { kind: "kds_station", stationId: venue.defaultStationId, label: "Pantalla Cocina" },
    });
    const { code } = (await codeRes.json()) as { code: string };

    // The cap is now the baked-in production `ENROL_RATE_MAX` (no longer injectable). Pre-fill the window
    // to TWO below the cap IN-PROCESS (no HTTP, no DB) so the two junk HTTP attempts below bring it exactly
    // to the cap and the valid third attempt is the (cap+1)th — the same boundary the old tight limiter
    // tested, without `ENROL_RATE_MAX` DB round trips.
    for (let i = 0; i < ENROL_RATE_MAX - 2; i++) limiter.check();

    // Two junk attempts fill the window. Each COUNTS toward the cap — the check runs before body parsing,
    // so even an invalid code is throttled — yet each still reaches the handler and returns the normal 400.
    for (const junk of ["BADCODE1", "BADCODE2"]) {
      const r = await send(app, "POST", "/api/device/enrol", { body: { code: junk } });
      expect(r.status).toBe(400);
      expect((await r.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "device.pairing_invalid" },
      });
    }

    // The THIRD attempt in the SAME window — with the VALID code — is refused 429 BEFORE any DB work, so
    // the code is NOT consumed. THE GUARD: deleting `enrolLimiter.check()` from device-api.ts's enrol
    // route makes this redeem the code and return 200, flipping the assertion red; restoring it green.
    const limited = await send(app, "POST", "/api/device/enrol", { body: { code } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_rate_limited" },
    });

    // Advance PAST the window: the counter resets, and the SAME valid code STILL redeems — proving both
    // that the throttled attempt consumed nothing (the row survived) and that the window reset.
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const ok = await send(app, "POST", "/api/device/enrol", { body: { code } });
    expect(ok.status).toBe(200);
    const jar = deviceCookieFrom(ok);
    const stationRes = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(stationRes.status).toBe(200);
  });

  it("GET /api/device/me reports an enrolled handheld's kind", async () => {
    // The client boot probe (Task 7): `requireDevice` resolves the device cookie to its binding, and the
    // route echoes it back so the till client can pick which shell to render. A handheld binds to no
    // station, so `stationId` is null.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { deviceId, jar } = await enrolHandheld(app, venue.managerCookie, venue.cfg.tillId);
    const res = await send(app, "GET", "/api/device/me", { cookie: jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deviceId, kind: "handheld", stationId: null });
  });

  it("GET /api/device/station 401s an enrolled handheld — it is bound to no station", async () => {
    // I4 (whole-branch review): before the handheld kind existed, EVERY device was a `kds_station`,
    // always station-bound, so `GET /api/device/station`'s `stationId === null` branch was unreachable
    // (and was `/* v8 ignore */`d). A `handheld` binds to no station (`stationId` is null), and
    // `requireDevice` authenticates ANY active device regardless of kind, so a handheld now REACHES that
    // branch — it throws `device.unauthorized` (401), the honest "this device has no station queue". The
    // branch is now genuinely reachable and tested, no longer ignored.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const { jar } = await enrolHandheld(app, venue.managerCookie, venue.cfg.tillId);
    const res = await send(app, "GET", "/api/device/station", { cookie: jar });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });

  it("GET /api/device/me 401s a request with no device cookie", async () => {
    // No cookie folds straight through `requireDevice` to `device.unauthorized` (401) — the route adds no
    // handling of its own.
    const venue = await setupVenue();
    const app = mountApp(venue.cfg);
    const res = await send(app, "GET", "/api/device/me", { cookie: null });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.unauthorized" },
    });
  });
});
