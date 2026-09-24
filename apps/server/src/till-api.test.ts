import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  canvases,
  deviceProfiles,
  floorZones,
  kitchenCourses,
  locations,
  tenantReceipts,
  tills,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { departments, preparationRoutes } from "@waitron/venue-service";
import {
  createPinThrottle,
  endSession,
  hashPin,
  hashSessionToken,
  loginWithPin,
  persons,
} from "@waitron/identity";
import { DEFAULT_CANVASES, DEFAULT_RECEIPT } from "@waitron/layouts";
import type { ReceiptConfig } from "@waitron/layouts";
import {
  addCatalogueToLocation,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createMenuItem,
  createMenuSection,
  createOptionList,
  createProduct,
  readContentLanguages,
  updateOptionList,
  setMenuItemExtraLists,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  AppError,
  SUPPORTED_LOCALES,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi, run } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE, requireSession } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import "./errors.js";

let cfg: TillConfig;
let ana: { id: string };
// The pre-login roster fixtures: `abel` is a second ACTIVE person whose name sorts BEFORE "Ana" but
// is inserted AFTER it, so `[abel, ana]` proves `listActiveStaff` sorts by name rather than by
// insertion order; `zoe` is SUSPENDED, so its absence proves the `status = 'active'` filter. The
// tenant's tax_id is generated (a fresh NIF each run), so `GET /api/till`'s `nif` is asserted against
// the value read back here, not a hardcoded one.
let abel: { id: string };
let venueTaxId: string;
// The one product seeded into the counter location's DEFAULT catalogue.
let aguaProduct: { id: string; catalogueId: string };
let eachUnit: {
  id: string;
  name: Record<string, string>;
  precision: number;
  hardwareUnit: string | null;
};
// A SECOND catalogue, attached to the location as a non-default accessible menu via
// `addCatalogueToLocation` (not `locations.catalogue_id`), with its own product — so the multi-menu
// `GET /api/products` response can be proven to carry BOTH the `menus` list (default flagged) and
// products drawn from every accessible catalogue, not just the default one.
let cervezaProduct: { id: string; catalogueId: string };
let counterZoneId: string;
let aguaOfferId: string;
let hiddenAguaOfferId: string;
// An enrolled `till` device's cookie: the sale routes resolve `till_id` from the device, so a
// happy-path place/sale call carries it to reach the route body.
let tillDeviceCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    // `seedTenant` sets legal_name = 'Test SL' and a generated tax_id; read the tax_id back so the
    // `GET /api/till` assertion can pin the exact NIF the route must echo.
    const tenant = await db.execute<{ tax_id: string }>(
      sql`select tax_id from tenants where id = 1`,
    );
    venueTaxId = tenant.rows[0]!.tax_id;
    // A location → till the session cookie references: `loginWithPin` inserts a `sessions` row with
    // a FK to `tills`, so the till `cfg.tillId` names must exist. The products are authored under the
    // BARE `es` key; `priceOrderLines` re-keys their descriptions to the location's `es-ES` before
    // the working-order-line insert fires `check_locales`, which demands the keys match EXACTLY.
    const [loc] = await db
      .insert(locations)
      .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
      .returning({ id: locations.id });
    // A default kitchen station so the place route's fire (placeOrder → fireLines) has a fallback.
    const defaultStationId = await seedKitchenStation(db, {
      locationId: brandLocationId(loc!.id),
    });
    const [till] = await db
      .insert(tills)
      .values({ locationId: loc!.id, name: "Till 1" })
      .returning({ id: tills.id });
    // A node the working-order routes need: `parkOrder`/`payWorkingOrder` write `working_orders.node_id`
    // (its FK `(node_id) → nodes(id)` requires a real row), and
    // `listHeldOrders` filters by it. `cfg.nodeId` names THIS row so every parked order is on-node.
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    // Ana's PIN is "5555"; anything else must not verify. Stored hashed via `hashPin`, never plain.
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    ana = { id: person!.id };
    // Abel: ACTIVE, inserted after Ana but sorts before her. Zoe: SUSPENDED, must be excluded.
    const [abelRow] = await db
      .insert(persons)
      .values({ displayName: "Abel", pinHash: hashPin("1111"), role: "staff" })
      .returning({ id: persons.id });
    abel = { id: abelRow!.id };
    await db
      .insert(persons)
      .values({ displayName: "Zoe", pinHash: hashPin("2222"), role: "staff", status: "suspended" });
    // One product in the location's DEFAULT catalogue (`assignCatalogueToLocation`), plus a second
    // product in a SECOND catalogue attached as a non-default accessible menu
    // (`addCatalogueToLocation`) — so `GET /api/products` returns a non-empty, multi-menu list.
    const { agua, cerveza, zoneId, offerId, hiddenOfferId } = await withTransaction(
      db,
      async (tx) => {
        const cat = await createCatalogue(tx, { name: "Carta" });
        const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
        const p = await createProduct(tx, {
          catalogueId: cat.id,
          categoryId: bebidas.id,
          name: "Agua mineral",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
          // An EU-14 allergen declaration on the seeded product, so `GET /api/products` has a non-null
          // `allergens` map to carry back — the field this route carries through unchanged.
          allergens: { sulphites: { presence: "may_contain" } },
        });
        await assignCatalogueToLocation(tx, loc!.id, cat.id);

        const cat2 = await createCatalogue(tx, { name: "Happy Hour" });
        const p2 = await createProduct(tx, {
          catalogueId: cat2.id,
          categoryId: bebidas.id,
          name: "Cerveza",
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "general",
        });
        await addCatalogueToLocation(tx, loc!.id, cat2.id);

        const [department] = await tx
          .insert(departments)
          .values({
            locationId: loc!.id,
            name: "Restaurant",
            tradingName: "Restaurant",
            defaultServiceMode: "prepay",
          })
          .returning({ id: departments.id });
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: loc!.id, name: "Counter" })
          .returning({ id: floorZones.id });
        // Three statements: `zone_service_policies_default_allowed_fk` is checked at each statement
        // and `zone_menus.zone_id` points back at the policy row, so the order is the one the comment
        // above that key in `packages/venue-service/src/schema/service.ts` gives.
        await tx.execute(sql`
        insert into zone_service_policies
          (location_id, zone_id, department_id, default_menu_id, is_counter_default)
        values (${loc!.id}, ${zone!.id}, ${department!.id}, null, true)`);
        await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id)
        values (${zone!.id}, ${cat.id})`);
        await tx.execute(sql`
        update zone_service_policies set default_menu_id = ${cat.id} where zone_id = ${zone!.id}`);
        const section = await createMenuSection(tx, {
          menuId: cat.id,
          name: { es: "Bebidas" },
        });
        const offer = await createMenuItem(tx, {
          menuId: cat.id,
          productId: p.id,
          sectionId: section.id,
          grossPrice: "1.75",
        });
        await tx.insert(preparationRoutes).values({
          locationId: loc!.id,
          productId: p.id,
          stationId: defaultStationId,
        });

        const hiddenMenu = await createCatalogue(tx, { name: "Staff" });
        const hiddenSection = await createMenuSection(tx, {
          menuId: hiddenMenu.id,
          name: { es: "Staff" },
        });
        const hiddenOffer = await createMenuItem(tx, {
          menuId: hiddenMenu.id,
          productId: p.id,
          sectionId: hiddenSection.id,
          grossPrice: "0.50",
        });

        return {
          agua: { ...p, catalogueId: cat.id },
          cerveza: { ...p2, catalogueId: cat2.id },
          zoneId: zone!.id,
          offerId: offer.id,
          hiddenOfferId: hiddenOffer.id,
        };
      },
    );
    aguaProduct = { id: agua.id, catalogueId: agua.catalogueId };
    cervezaProduct = { id: cerveza.id, catalogueId: cerveza.catalogueId };
    eachUnit = { ...agua.unit, hardwareUnit: null };
    counterZoneId = zoneId;
    aguaOfferId = offerId;
    hiddenAguaOfferId = hiddenOfferId;
    cfg = makeCfg(till!.id, loc!.id, nodeId);
  },
});

// Enrolled fresh in each `beforeEach` that needs it, because the `GET /api/till` canvas tests
// `delete from devices`, so a once-only device would not survive to a later describe.
async function enrolSaleTillDevice(): Promise<void> {
  tillDeviceCookie = await enrolTillDeviceCookie(suite.db);
}

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `seriesId` is unused by these routes, so it carries a
 * fresh uuid. */
function makeCfg(tillId: string, locationId: string, nodeId: string): TillConfig {
  return {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** The system wall clock, reported confident/anchored. The `place`/`cancel` routes call
 *  `deps.clock.now()` even under this suite's `prepay`, where no fiscal doc is filed. */
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
      throw new Error("till-api.test: anchor() is not used by placeOrder/cancelPlacedOrder");
    },
    currentAnchor: () => null,
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // An empty stub: this suite's `prepay` cfg never dispatches into the fiscal backend.
    backend: {} as FiscalBackend,
    clock: systemClock(),
    cfg,
    // FALSE so the Set-Cookie is issued over the non-TLS `app.request` — it must still carry HttpOnly
    // and SameSite=Strict, and must NOT carry Secure.
    secureCookies: false,
    // The venue's default UI locale; `GET /api/locales` echoes it as `venueDefault`.
    venueLocale: "es-ES",
    onboardingIntent: "prepare",
  };
}

/** Opens a real shift session for Ana — the same `withTransaction` + `loginWithPin` path the login
 * route runs — and returns its cookie token, so a test can hand `requireSession` or the logout
 * route a cookie that names a genuine row. */
async function openSession(db: Database): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      tillId: cfg.tillId,
      personId: ana.id,
      pin: "5555",
    });
  });
  return session.token;
}

/** Ends a session out of band, so a cookie can be made to name a CLOSED row. */
async function closeSession(db: Database, token: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await endSession(tx, token);
  });
}

/** Enrol a `till` device via join-and-accept, optionally bound to a `deviceProfileId`, and return
 * the `${DEVICE_COOKIE}=…` header value it carries. `GET /api/till` resolves the canvas and
 * capabilities through that profile. */
let tillDeviceCounter = 0;
async function enrolTillDeviceCookie(
  db: Database,
  deviceProfileId: string | null = null,
): Promise<string> {
  tillDeviceCounter += 1;
  // `resolveDeviceBinding` creates a register for a `till` device at accept, named after the device,
  // so each call names the device uniquely.
  const profileId =
    deviceProfileId ?? (await seedDeviceProfile(db, `Till profile ${tillDeviceCounter}`, [], null));
  const dev = await enrolDeviceForTest(db, cfg, {
    name: `Counter till ${tillDeviceCounter}`,
    profileId,
  });
  return `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}`;
}

/** Seed a `device_profiles` row — the bundle a device resolves its canvas + capabilities through. */
async function seedDeviceProfile(
  db: Database,
  name: string,
  capabilities: string[],
  canvasId: string | null,
  inactivityTimeoutSeconds: number | null = null,
): Promise<string> {
  const rows = await withTransaction(db, async (tx) => {
    // Through the table definition, not raw SQL: `device_profiles.id` is a `$defaultFn` generator,
    // which a raw insert never runs.
    return tx
      .insert(deviceProfiles)
      .values({ name, formFactor: "till", canvasId, capabilities, inactivityTimeoutSeconds })
      .returning({ id: deviceProfiles.id });
  });
  return rows[0]!.id;
}

describe("POST /api/session (log in) + DELETE /api/session (log out)", () => {
  it("POST opens a session and sets an httpOnly SameSite=Strict cookie; DELETE ends it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The login is DEVICE-GATED (§5/§6): the request carries an enrolled device cookie exactly as a
    // sale does, or it is refused `device.unauthorized` (proven by the dedicated test below).
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: ana.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    // The response carries the server-computed `canConfigureTill` capability so the till can gate
    // manager-only affordances client-side; Ana is `staff`, who does NOT hold `venue.configure`, so it is
    // false. `locale` is the operator's own UI-language preference — Ana has none, so null.
    expect(await res.json()).toEqual({
      personId: ana.id,
      canConfigureTill: false,
      locale: null,
    });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // secureCookies:false → no Secure attribute, so the cookie is usable over the non-TLS request.
    expect(cookie).not.toMatch(/Secure/i);

    const del = await app.request("/api/session", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    // DELETE actually stamped ended_at on the row the cookie named.
    // 1, not `true`: the engine has no boolean type, and the `flag` column helper's boolean mapping
    // (`packages/db/src/schema/columns.ts`) belongs to a declared COLUMN, not to a predicate written
    // in raw SQL. An unstamped row would come back 0, so the case still fails if DELETE wrote
    // nothing.
    const token = /waitron_till_session=([^;]+)/.exec(cookie)![1]!;
    const rows = await suite.db.execute<{ ended: number }>(
      sql`select ended_at is not null as ended from sessions where token_hash = ${hashSessionToken(token)}`,
    );
    expect(rows.rows).toEqual([{ ended: 1 }]);
  });

  it("POST computes canConfigureTill from the operator's ACTUAL role — true for a manager", async () => {
    // A manager holds `venue.configure`; with the staff case above this pins the role, not a constant.
    // Cleaned up so the roster's exact ordering assertions elsewhere stay untouched.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const [mgr] = await suite.db
      .insert(persons)
      .values({ displayName: "Marta", pinHash: hashPin("9999"), role: "manager" })
      .returning({ id: persons.id });
    const managerId = mgr!.id;

    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: managerId, pin: "9999" }),
    });
    expect(res.status).toBe(200);
    // Marta carries no locale preference either.
    expect(await res.json()).toEqual({
      personId: managerId,
      canConfigureTill: true,
      locale: null,
    });

    await suite.db.execute(sql`delete from sessions where person_id = ${managerId}`);
    await suite.db.execute(sql`delete from persons where id = ${managerId}`);
  });

  it("POST returns the operator's own locale preference when set (persons.locale)", async () => {
    // Cleaned up so the roster tests' exact ordering assertions stay untouched.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const [row] = await suite.db
      .insert(persons)
      .values({
        displayName: "Beatriz",
        pinHash: hashPin("7777"),
        role: "staff",
        locale: "en-GB",
      })
      .returning({ id: persons.id });
    const personId = row!.id;

    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId, pin: "7777" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personId, canConfigureTill: false, locale: "en-GB" });

    await suite.db.execute(sql`delete from sessions where person_id = ${personId}`);
    await suite.db.execute(sql`delete from persons where id = ${personId}`);
  });

  it("POST rejects a bad pin with 401 and a code", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A single wrong PIN on an enrolled device: below the free-attempt threshold, so it is a plain
    // `pin.invalid` (401), not yet a throttle.
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: ana.id, pin: "0000" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
  });

  it("POST with no enrolled device is refused device.unauthorized (login is device-gated, §5/§6)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No `waitron_device` cookie: the throttle keys off the device and the shift records the device's
    // register, so a device-less login is refused up front — the same fail-closed gate the sale routes
    // apply.
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: ana.id, pin: "5555" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("DELETE with no session cookie is an idempotent 200 no-op", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: nothing to end, but logout is idempotent — the cookie is cleared and the request
    // answered 200 rather than treated as an error.
    const del = await app.request("/api/session", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
  });

  it("DELETE with a NON-UUID cookie is an idempotent 200 that clears the cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A stale or garbage cookie is never an error: the route clears it and answers 200. Weaker than
    // its name: it does not pin the `isUuid` screen, since `endSession` hashes the value and matches
    // no row either way.
    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("DELETE naming an ALREADY-ended session is still an idempotent 200 that clears the cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A cookie naming a session that was already closed: `endSession` matches nothing, but logout
    // still answers 200 and clears the cookie.
    const token = await openSession(suite.db);
    await closeSession(suite.db, token);

    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    // The clear is a Set-Cookie that empties the value and expires it (deleteCookie → maxAge 0).
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });
});

describe("POST /api/session — wrong-PIN throttle (§5) + device register (§6)", () => {
  /** Count the `sessions` rows for a person — the differential proof that a throttled attempt
   *  never reached `loginWithPin` (a login would have inserted a row). */
  async function sessionCount(personId: string): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from sessions where person_id = ${personId}`,
    );
    return rows[0]!.n;
  }

  /** Parse the `deviceId` selector out of a `waitron_device=<id>.<token>` cookie header value. */
  function deviceIdOf(cookie: string): string {
    return /waitron_device=([^.]+)\./.exec(cookie)![1]!;
  }

  it("stamps the DEVICE's own register on the session, not deps.cfg.tillId (§6)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The till device auto-creates its OWN register at enrol (register B), distinct from the box's env
    // register A (`cfg.tillId`). The shift must name B.
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const deviceRow = await suite.db.execute<{ till_id: string }>(
      sql`select till_id from devices where id = ${deviceIdOf(deviceCookie)}`,
    );
    const deviceTillId = deviceRow.rows[0]!.till_id;
    expect(deviceTillId).not.toBe(cfg.tillId); // B ≠ A — a real divergence to detect

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: ana.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    const token = /waitron_till_session=([^;]+)/.exec(res.headers.get("set-cookie")!)![1]!;
    const sess = await suite.db.execute<{ till_id: string }>(
      sql`select till_id from sessions where token_hash = ${hashSessionToken(token)}`,
    );
    // The session records the DEVICE's register (B), never the env `cfg.tillId` (A).
    expect(sess.rows[0]!.till_id).toBe(deviceTillId);
    expect(sess.rows[0]!.till_id).not.toBe(cfg.tillId);

    await suite.db.execute(sql`delete from sessions where token_hash = ${hashSessionToken(token)}`);
  });

  it("throttles a (device, person) after the free failures: a further attempt is 429 pin.throttled and loginWithPin never runs", async () => {
    // A fixed injected clock (CLAUDE.md §4): the window opens at `now` and blocks a later `check` at the
    // same `now`, deterministically, with no real sleep.
    const now = 1_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId: ana.id, pin }),
      });

    // Four wrong PINs: three are free, the 4th failure opens the first (2s) wait window. Each still
    // answers a plain 401 `pin.invalid` (the throttle `check` runs BEFORE the failure it records).
    for (let i = 0; i < 4; i++) {
      const bad = await post("0000");
      expect(bad.status).toBe(401);
      expect(await bad.json()).toMatchObject({ error: { code: "pin.invalid" } });
    }

    // The next attempt is now inside the window. Using Ana's CORRECT PIN proves `loginWithPin` was NOT
    // reached: were it, a session would open (200). Instead it is 429 `pin.throttled` carrying
    // `retryAfterSeconds`, with NO session cookie and NO new session row.
    const before = await sessionCount(ana.id);
    const throttled = await post("5555");
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toMatchObject({
      error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } },
    });
    expect(throttled.headers.get("set-cookie")).toBeNull();
    expect(await sessionCount(ana.id)).toBe(before);
  });

  it("keys the throttle on the CANONICAL personId, so an alternate UUID spelling shares the bucket (§5)", async () => {
    // `canonicaliseUuid` (`till-session.ts`) folds an uppercase / dash-free spelling of Ana's id to
    // the same canonical value, so both spellings name the SAME person. The throttle must therefore key
    // on the canonical value, or a brute-forcer cycles spellings to get a fresh back-off bucket per
    // spelling and evades the window.
    const now = 5_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId, pin }),
      });

    // Four wrong PINs on the LOWERCASE (canonical) id open the wait window on this (device, person).
    for (let i = 0; i < 4; i++) expect((await post(ana.id, "0000")).status).toBe(401);

    // A DIFFERENT spelling of the SAME id — uppercase — with Ana's CORRECT PIN must ALSO be throttled
    // (429), NOT reach `loginWithPin` (a 200 would prove it did) nor land in a fresh bucket (a 401
    // `pin.invalid`). Keyed on the raw string, uppercase is a distinct bucket and this is a 200 — the
    // bypass the canonicalisation closes.
    const upper = await post(ana.id.toUpperCase(), "5555");
    expect(upper.status).toBe(429);
    expect(await upper.json()).toMatchObject({ error: { code: "pin.throttled" } });

    // And a dash-free spelling, which `canonicaliseUuid` folds the same way, shares the bucket.
    const dashless = await post(ana.id.replace(/-/g, ""), "5555");
    expect(dashless.status).toBe(429);
    expect(await dashless.json()).toMatchObject({ error: { code: "pin.throttled" } });
  });

  it("a successful login clears the throttle, so the streak restarts (§5)", async () => {
    const now = 2_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId: ana.id, pin }),
      });

    // Three wrong PINs (still free), then a correct PIN succeeds and CLEARS the streak.
    for (let i = 0; i < 3; i++) expect((await post("0000")).status).toBe(401);
    expect((await post("5555")).status).toBe(200);

    // After the clear, two more wrong PINs are BOTH plain 401 `pin.invalid`. Had the streak NOT reset,
    // the three pre-success failures plus the first post-success failure would open the window and this
    // SECOND post-success attempt would be 429 — so both being 401 is the decisive proof `clear` ran.
    expect((await post("0000")).status).toBe(401);
    const p2 = await post("0000");
    expect(p2.status).toBe(401);
    expect(await p2.json()).toMatchObject({ error: { code: "pin.invalid" } });

    await suite.db.execute(sql`delete from sessions where person_id = ${ana.id}`);
  });

  it("throttles per (device, person): a second person on the same device is unaffected (§5)", async () => {
    const now = 3_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId, pin }),
      });

    // Fully throttle (device, Ana).
    for (let i = 0; i < 4; i++) expect((await post(ana.id, "0000")).status).toBe(401);
    expect((await post(ana.id, "5555")).status).toBe(429); // Ana is locked out on this device

    // Abel — a DIFFERENT person on the SAME device — is independent: his correct PIN logs in (200).
    const abelOk = await post(abel.id, "1111");
    expect(abelOk.status).toBe(200);
    expect(await abelOk.json()).toMatchObject({ personId: abel.id });

    await suite.db.execute(sql`delete from sessions where person_id = ${abel.id}`);
  });
});

describe("the run wrapper (the shared error boundary Tasks 5 & 6 reuse)", () => {
  it("maps a registered but UNMAPPED AppError code to 400 (its default)", async () => {
    const app = new Hono();
    // `tenant.not_found` is a real code deliberately absent from STATUS, so it takes the `?? 400`
    // default.
    app.get("/boom", (c) =>
      run(c, collect([]), () =>
        Promise.reject(new AppError("tenant.not_found", { id: randomUUID() })),
      ),
    );
    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "tenant.not_found" } });
  });

  /* The two refusals the FISCAL FILING itself raises are not client faults, so they are listed in
   * STATUS rather than left to the 400 default that says "the till sent something wrong". 409 is
   * this table's "the state forbids it" family, and it keeps the structured code — which a 500
   * would drop — so the till can tell the operator this one is permanent and to stop retrying
   * (`apps/till/src/till-app.ts`, `sale.refused`). */
  it.each([["fiscal.record_invalid"], ["fiscal.foreign_recipient_unsupported"]])(
    "answers %s with 409, keeping the code the till needs to say the refusal is permanent",
    async (code) => {
      const app = new Hono();
      app.get("/refused", (c) =>
        run(c, collect([]), () =>
          Promise.reject(
            code === "fiscal.record_invalid"
              ? new AppError("fiscal.record_invalid", {
                  fields: ["NumSerieFactura"],
                  codes: ["NUMSERIE_CHARSET"],
                })
              : new AppError("fiscal.foreign_recipient_unsupported", { countryCode: "FR" }),
          ),
        ),
      );
      const res = await app.request("/refused");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code } });
    },
  );

  it("maps a non-AppError to an opaque 500 server.internal and logs it at error", async () => {
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    app.get("/crash", (c) => run(c, collect(lines), () => Promise.reject(new Error("boom"))));

    const res = await app.request("/crash");
    expect(res.status).toBe(500);
    // No message leaks — only the opaque code, and the structured line is logged at error level with
    // `codeOf`'s classification (an unclassified value → "unknown").
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    const failed = lines.find((l) => l.event === "till.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.fields).toMatchObject({ errorCode: "unknown" });
  });
});

describe("requireSession (validates an OPEN session for Tasks 5 & 6's protected routes)", () => {
  // A throwaway route standing in for the protected routes: it calls `requireSession` and echoes what
  // it resolved.
  function guardApp(db: Database): Hono {
    const app = new Hono();
    const d = { db, cfg };
    app.get("/whoami", (c) => run(c, collect([]), async () => c.json(await requireSession(d, c))));
    return app;
  }

  it("ACCEPTS an open session and returns the operator's personId + sessionId", async () => {
    const token = await openSession(suite.db);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personId: ana.id, sessionId: rows[0]!.id });
  });

  // Only the row id is presented here. The stored hash is 64 hex characters, which the guard's
  // UUID shape check refuses before any lookup, so a case presenting it would pass whatever the
  // lookup did, and it is left out.
  it("REJECTS (401 session.required) the row's own id — what a copy of the database holds", async () => {
    const token = await openSession(suite.db);
    const { rows } = await suite.db.execute<{ id: string }>(
      sql`select id from sessions where token_hash = ${hashSessionToken(token)}`,
    );
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${rows[0]!.id}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    // The other direction: the cookie's own token is accepted, and the guard hands back the row id.
    const ok = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ personId: ana.id, sessionId: rows[0]!.id });
  });

  it("REJECTS (401 session.required) when no cookie is present", async () => {
    const res = await guardApp(suite.db).request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a well-formed but nonexistent/forged session id", async () => {
    // A valid uuid the attacker guessed — never issued, so it names no row. A cookie is present, so a
    // mere presence check would WRONGLY accept it; the DB lookup is what refuses it.
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${randomUUID()}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie", async () => {
    // A forged, non-UUID cookie is a CLIENT fault and answers 401. Weaker than its name: it does not
    // pin the `isUuid` screen in `requireSession`, since the hashed value matches no row either way.
    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) an ENDED session — logging out invalidates the cookie", async () => {
    // Open a real session, then end it. Its token still names a row, but `ended_at IS NOT NULL`, so
    // the `IS NULL` filter excludes it: a logged-out cookie is as good as no cookie.
    const token = await openSession(suite.db);
    await closeSession(suite.db, token);

    const res = await guardApp(suite.db).request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("PUT /api/session/locale (set your OWN UI locale)", () => {
  // Log in a FRESH staff person rather than the shared `ana`, so the row this route MUTATES is
  // disposable and no sibling test's locale assertion (e.g. the login block's `locale: null` for Ana)
  // is disturbed. Cleaned up (session + person) in a finally so the suite stays order-independent (§4).
  async function loginFresh(pin: string): Promise<{ personId: string; token: string }> {
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName: "Locale User", pinHash: hashPin(pin), role: "staff" })
      .returning({ id: persons.id });
    const personId = row!.id;
    const session = await withTransaction(suite.db, async (tx) => {
      return loginWithPin(tx, { tillId: cfg.tillId, personId, pin });
    });
    return { personId, token: session.token };
  }
  async function cleanup(personId: string): Promise<void> {
    await suite.db.execute(sql`delete from sessions where person_id = ${personId}`);
    await suite.db.execute(sql`delete from persons where id = ${personId}`);
  }

  it("204s and writes the session person's persons.locale for a supported value", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6001");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify({ locale: "en-GB" }),
      });
      expect(res.status).toBe(204);
      // The operator's OWN row now carries the chosen locale (the write ran under the session's identity).
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBe("en-GB");
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) an unsupported value, leaving the row unchanged", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6002");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify({ locale: "ca-ES" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "locale.unsupported" } });
      // `setPersonLocale` validates BEFORE it writes, so an unsupported value never reaches the row.
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) a missing/null body — coerced to '' → the ONE rejection path", async () => {
    // A `null` JSON body → `?? {}` → an absent `locale` → the `typeof … ? … : ""` coercion → "", which
    // `assertSupportedLocale` rejects as `locale.unsupported` exactly like any other unsupported value.
    // There is no separate request-invalid branch — a missing/non-string locale is the same 400.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6003");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify(null),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "locale.unsupported" } });
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) an EMPTY or MALFORMED body, never a 500", async () => {
    // hono's `c.req.json()` THROWS a `SyntaxError` on an empty or malformed body, which would reach
    // `run` as an opaque 500. The guarded parse coerces it to `{}`, so the body takes the same
    // `locale.unsupported` path.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6004");
    try {
      // An EMPTY body under a JSON content-type.
      const empty = await app.request("/api/session/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: "",
      });
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({ error: { code: "locale.unsupported" } });

      // A MALFORMED body — not valid JSON at all.
      const malformed = await app.request("/api/session/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: "not json",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "locale.unsupported" } });

      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("401s (session.required) when no session cookie is sent", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/session/locale", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en-GB" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("GET /api/staff (pre-login roster) + GET /api/till (public boot info)", () => {
  it("GET /api/staff lists ACTIVE staff sorted by name, no cookie required, no secrets", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie at all — the lock screen calls this before any session exists.
    const res = await app.request("/api/staff");
    expect(res.status).toBe(200);
    const staff = await res.json();
    // Sorted by displayName (Abel before Ana, though Abel was inserted second), suspended Zoe absent.
    expect(staff).toEqual([
      { personId: abel.id, displayName: "Abel" },
      { personId: ana.id, displayName: "Ana" },
    ]);
    // The roster carries the login id + display name only — nothing a customer or a bystander at the
    // lock screen must not see (no pin material, no role, no status).
    expect(JSON.stringify(staff)).not.toMatch(/pin|secret|password|url|cert|role|status|hash/i);
  });

  it("GET /api/till returns locale + issuer identity + orderFlow + card fields, and no secret", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The receipt-issuer identity (legal name + NIF), the UI locale, the pay-timing mode and the card
    // fields. The tenant has authored no receipt or canvas, so `receipt` is the built-in default and
    // `canvas` is the `till` form-factor default, even for this cookieless request.
    expect(body).toEqual({
      locale: "es-ES",
      // The RECEIPT locale — the fiscal `cfg.locale`, DISTINCT from the UI `locale` above (both es-ES
      // for this ES venue, but sourced from different fields — the decoupling test below drives them apart).
      invoiceLocale: "es-ES",
      onboardingIntent: "prepare",
      venueName: "Test SL",
      nif: venueTaxId,
      orderFlow: "prepay",
      // The venue's KDS whole-ticket bump mode (KDS-1 §2e), read from the location — the seeded
      // location never set it, so the column default `line` reaches the wire (per-line bump only).
      bumpMode: "line",
      // The venue's KDS fire-control mode (KDS-2 §2c), read from the same location row — the seeded
      // location never set it, so the column default `waiter` reaches the wire (the tab screen fires).
      fireControl: "waiter",
      // The venue's ACTIVE kitchen courses (KDS-2 §5b) — the seeded location has none, so `[]` reaches
      // the wire (the tab course picker offers nothing then).
      courses: [],
      // Cookieless: no device → no default reader → `none`; the venue has no readers configured.
      cardProvider: "none",
      activeReaders: [],
      tipsEnabled: false,
      receipt: DEFAULT_RECEIPT,
      receiptPrintMode: "auto",
      // Cookieless: no device, so the boot read resolves the `till` form-factor default canvas
      // (`getCanvasForFormFactor` → DEFAULT_CANVASES.till) rather than leaving it absent (SP-B4).
      canvas: DEFAULT_CANVASES.till,
      // A cookieless request has no device profile, so no capabilities.
      capabilities: [],
      // The auto-logout timeout also rides the profile: no profile → null (the app default).
      inactivityTimeoutSeconds: null,
      // The node this till is talking to, and the venue's routable server list — empty here because
      // `node_membership` holds no row (the server-list test below writes one and removes it again).
      nodeId: cfg.nodeId,
      servers: [],
    });
    // Nothing sensitive: no pin, certificate, connection string or AEAT verification url reaches the
    // wire. `verificationUrl` is named exactly rather than a bare `url`, because `servers[].url` is a
    // BY-DESIGN wire key (the address the till is told to dial) that a bare alternative would trip on.
    expect(JSON.stringify(body)).not.toMatch(/pin|secret|password|verificationUrl|cert/i);
  });

  it("GET /api/till lists the venue's servers from the membership document, primary first, evicted and address-less nodes excluded", async () => {
    const app = new Hono();
    // The route reads `node_membership` itself, so the document goes into the DATABASE. Removed in the
    // `finally` below: every other test in this suite asserts `servers: []` off an empty table, so a
    // leftover row would make those pass or fail on this test's ordering (CLAUDE.md §4).
    await writeNodeMembership(
      suite.db,
      signedMembershipDoc(5, {
        signerNodeId: cfg.nodeId,
        nodes: [
          { nodeId: "b", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
          { nodeId: "c", contactUrl: "https://old.deli.test", standing: "evicted" },
          { nodeId: "d", contactUrl: "", standing: "sell-only" },
          { nodeId: "e", contactUrl: "https://spare.deli.test", standing: "sell-only" },
          { nodeId: cfg.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
        ],
      }),
    );
    try {
      mountTillApi(app, deps(suite.db), collect([]));
      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nodeId).toBe(cfg.nodeId);
      expect(body.servers).toEqual([
        { nodeId: cfg.nodeId, url: "https://box.deli.test", standing: "serving-primary" },
        { nodeId: "b", url: "https://cloud.deli.test", standing: "serving-secondary" },
        { nodeId: "e", url: "https://spare.deli.test", standing: "sell-only" },
      ]);
    } finally {
      await suite.db.execute(sql`delete from node_membership`);
    }
  });

  it("GET /api/till DECOUPLES the UI locale (venueLocale) from the receipt invoiceLocale (cfg.locale)", async () => {
    // Drive `cfg.locale` (fiscal/receipt) and `venueLocale` (display) APART to prove the route reads
    // each from its own source: the wire `locale` (UI) must follow `venueLocale`, and `invoiceLocale`
    // (the printed legal receipt's language) must follow the fiscal `cfg.locale` — NEVER the venue
    // default. This is decision 2 of the per-user-language spec: a supported fiscal `ca-ES` is dropped
    // by the UI venue-default derivation to `es-ES`, so binding the receipt to `venueLocale` would flip
    // a Catalan receipt to Spanish. (In production both are `es-ES` for an ES venue, so a
    // default-vs-default assertion could not tell a swapped source.)
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cfg: { ...cfg, locale: "ca-ES" }, venueLocale: "en-GB" },
      collect([]),
    );

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    expect((await res.json()) as { locale: string; invoiceLocale: string }).toMatchObject({
      locale: "en-GB",
      invoiceLocale: "ca-ES",
    });
  });

  it("GET /api/locales returns the supported list + the venue default, no session required", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie — the till app fetches the language catalogue before any session exists.
    const res = await app.request("/api/locales");
    expect(res.status).toBe(200);
    // The static catalogue verbatim (es-ES + en-GB) plus the geography-derived default for this ES
    // venue (`deps.venueLocale`, es-ES).
    expect(await res.json()).toEqual({ locales: SUPPORTED_LOCALES, venueDefault: "es-ES" });
  });

  it("GET /api/till echoes cfg.tipsEnabled, proving it reads config rather than a hardcoded value", async () => {
    // A default of `false` would pass even if the route hardcoded it, so drive `cfg.tipsEnabled` to
    // `true`. The per-device `cardProvider` is covered in `till-api.fiscal-sale-paths.test.ts`.
    const app = new Hono();
    mountTillApi(app, { ...deps(suite.db), cfg: { ...cfg, tipsEnabled: true } }, collect([]));

    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ cardProvider: "none", tipsEnabled: true });
  });

  it("GET /api/till surfaces the local simulator selected by boot", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      {
        ...deps(suite.db),
        cardProvider: { provider: "simulator" } as PaymentProvider,
      },
      collect([]),
    );
    const res = await app.request("/api/till");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cardProvider: "simulator" });
  });

  it("GET /api/till echoes a non-default bump_mode from the location, proving it reads the column", async () => {
    // The default `line` above would pass even if the route hardcoded it, so drive the location's
    // `bump_mode` to `ticket` and prove the boot read reflects it. Restored in `finally` so the shared
    // location stays `line` for the order-independent default assertion above (CLAUDE.md §4).
    await suite.db.execute(
      sql`update locations set bump_mode = 'ticket' where id = ${cfg.locationId}`,
    );
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ bumpMode: "ticket" });
    } finally {
      await suite.db.execute(
        sql`update locations set bump_mode = 'line' where id = ${cfg.locationId}`,
      );
    }
  });

  it("GET /api/till echoes a non-default fire_control from the location, proving it reads the column", async () => {
    // The default `waiter` above would pass even if the route hardcoded it, so drive the location's
    // `fire_control` to `kitchen` and prove the boot read reflects it — the same shape as the bump_mode
    // echo above. Restored in `finally` so the shared location stays `waiter` for the order-independent
    // default assertion above (CLAUDE.md §4).
    await suite.db.execute(
      sql`update locations set fire_control = 'kitchen' where id = ${cfg.locationId}`,
    );
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ fireControl: "kitchen" });
    } finally {
      await suite.db.execute(
        sql`update locations set fire_control = 'waiter' where id = ${cfg.locationId}`,
      );
    }
  });

  it("GET /api/till echoes the venue's ACTIVE kitchen courses in display order (KDS-2 §5b)", async () => {
    // Seed two courses out of display order, plus a deactivated one, to prove the boot read
    // returns the ACTIVE ones sorted by `display_order` (the coursing sequence the tab picker
    // offers) and drops the retired one. Cleaned up in `finally` so the shared-location default `[]`
    // case stays order-independent.
    await suite.db.insert(kitchenCourses).values([
      { locationId: cfg.locationId, name: "Postres", displayOrder: 2, active: true },
      { locationId: cfg.locationId, name: "Entrantes", displayOrder: 1, active: true },
      { locationId: cfg.locationId, name: "Retirado", displayOrder: 0, active: false },
    ]);
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { courses: { name: string; displayOrder: number }[] };
      // Active-only, by display_order: Entrantes (1) before Postres (2); the deactivated Retirado absent.
      expect(body.courses).toEqual([
        { id: expect.any(String), name: "Entrantes", displayOrder: 1 },
        { id: expect.any(String), name: "Postres", displayOrder: 2 },
      ]);
    } finally {
      await suite.db.execute(
        sql`delete from kitchen_courses where location_id = ${cfg.locationId}`,
      );
    }
  });

  it("GET /api/till returns the AUTHORED receipt (tenant_receipts), not the default, and no `layout` field", async () => {
    // An authored RECEIPT in `tenant_receipts` must come back via `getReceipt`, not the default.
    // Cleaned up in `finally` so the shared-tenant default case above stays order-independent.
    const authoredReceipt: ReceiptConfig = { footerMessage: "Hasta pronto" };
    await suite.db.insert(tenantReceipts).values({ receipt: authoredReceipt });
    try {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { receipt: ReceiptConfig };
      expect(body.receipt).toEqual(authoredReceipt); // from tenant_receipts
      expect(body).not.toHaveProperty("layout");
    } finally {
      await suite.db.execute(sql`delete from tenant_receipts `);
    }
  });

  it("GET /api/till surfaces the calling device's PROFILE canvas + capabilities (device-profile §5.3)", async () => {
    // A device whose PROFILE references a canvas gets that CanvasDef under `canvas`, and the profile's
    // capabilities under `capabilities`. Cleaned up in `finally` so the shared-tenant no-cookie
    // assertion above stays order-independent.
    const [prof] = await suite.db
      .insert(canvases)
      .values({ name: "Front counter", definition: DEFAULT_CANVASES.till })
      .returning({ id: canvases.id });
    const canvasId = prof!.id;
    const deviceProfileId = await seedDeviceProfile(
      suite.db,
      "Counter",
      ["integrated-card-payment", "open-cash-drawer"],
      canvasId,
      // The profile carries a non-null auto-logout timeout, so the boot payload must mirror it.
      300,
    );
    try {
      const cookie = await enrolTillDeviceCookie(suite.db, deviceProfileId);
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));

      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        canvas: unknown;
        capabilities: unknown;
        receipt: ReceiptConfig;
        inactivityTimeoutSeconds: unknown;
      };
      // The resolved CanvasDef, verbatim (the `getCanvas` definition) — through the profile.
      expect(body.canvas).toEqual(DEFAULT_CANVASES.till);
      // The profile's capabilities, as the explicit sibling.
      expect(body.capabilities).toEqual(["integrated-card-payment", "open-cash-drawer"]);
      // The profile's auto-logout timeout, mirrored onto the boot payload like `capabilities`.
      expect(body.inactivityTimeoutSeconds).toBe(300);
      // The tenant authored no receipt, so it stays the built-in default.
      expect(body.receipt).toEqual(DEFAULT_RECEIPT);
      expect(body).not.toHaveProperty("layout");
    } finally {
      await suite.db.execute(sql`delete from devices `);
      await suite.db.execute(sql`delete from device_profiles `);
      await suite.db.execute(sql`delete from canvases `);
    }
  });

  it("resolves the form-factor default canvas + the profile's capabilities when the profile's canvasId is NULL", async () => {
    // A "default canvas + these capabilities" profile (§5.2): canvas_id NULL, so the canvas falls back to
    // the form-factor default while the capabilities STILL come from the profile. Proves the two axes are
    // independent — a null canvas reference does not empty the capability set.
    const deviceProfileId = await seedDeviceProfile(
      suite.db,
      "Default+caps",
      ["open-cash-drawer"],
      null,
    );
    try {
      const cookie = await enrolTillDeviceCookie(suite.db, deviceProfileId);
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        canvas: unknown;
        capabilities: unknown;
        inactivityTimeoutSeconds: unknown;
      };
      expect(body.canvas).toEqual(DEFAULT_CANVASES.till);
      expect(body.capabilities).toEqual(["open-cash-drawer"]);
      // This profile was seeded with no timeout, so the boot payload carries null (the app default).
      expect(body.inactivityTimeoutSeconds).toBeNull();
    } finally {
      await suite.db.execute(sql`delete from devices `);
      await suite.db.execute(sql`delete from device_profiles `);
    }
  });

  it("falls back to the form-factor default canvas + `capabilities: []` for an enrolled device with NO profile (§5.3)", async () => {
    // A no-profile device renders the form-factor default canvas with an EMPTY capability set, so render
    // and firewall agree (§5.3).
    const cookie = await enrolTillDeviceCookie(suite.db, null);
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    try {
      const res = await app.request("/api/till", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        canvas: unknown;
        capabilities: unknown;
        receipt: ReceiptConfig;
        inactivityTimeoutSeconds: unknown;
      };
      // No profile → the built-in default canvas for a till device, and an empty capability set.
      expect(body.canvas).toEqual(DEFAULT_CANVASES.till);
      expect(body.capabilities).toEqual([]);
      // No profile → no timeout resolved, so the boot payload carries null (the app default).
      expect(body.inactivityTimeoutSeconds).toBeNull();
      expect(body.receipt).toEqual(DEFAULT_RECEIPT);
      expect(body).not.toHaveProperty("layout");
    } finally {
      await suite.db.execute(sql`delete from devices `);
    }
  });

  it("resolves the `till` form-factor default canvas + `capabilities: []` when the request carries no device cookie", async () => {
    // Cookieless: the boot read still resolves the `till` form-factor default canvas, so the counter
    // always has a canvas to render, and an empty capability set.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/till"); // no cookie header
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("canvas");
    expect((body as { canvas: unknown }).canvas).toEqual(DEFAULT_CANVASES.till);
    expect((body as { capabilities: unknown }).capabilities).toEqual([]);
    // Cookieless → no device, no profile, so the timeout resolves to null (the app default).
    expect((body as { inactivityTimeoutSeconds: unknown }).inactivityTimeoutSeconds).toBeNull();
    expect(body).not.toHaveProperty("layout");
  });
});

describe("GET /api/products (session-guarded catalogue)", () => {
  it("returns the configured default counter zone and its offers", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);

    const res = await app.request("/api/default-service-zone/offers", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      context: { zoneId: counterZoneId, serviceMode: "prepay" },
      zones: [{ id: counterZoneId, name: "Counter" }],
      offers: [{ id: aguaOfferId, grossPrice: "1.75" }],
    });
  });

  it("prefers the enrolled device's default service zone", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const deviceId = deviceCookie.slice(`${DEVICE_COOKIE}=`.length).split(".")[0]!;
    const [second] = await suite.db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: `Device zone ${deviceId}` })
      .returning({ id: floorZones.id });
    await suite.db.execute(sql`
      insert into zone_service_policies
        (location_id, zone_id, department_id, service_mode)
      select ${cfg.locationId}, ${second!.id}, department_id, 'prepay'
      from zone_service_policies
      where zone_id = ${counterZoneId}`);
    await suite.db.execute(sql`
      insert into zone_menus (zone_id, menu_id)
      values (${second!.id}, ${aguaProduct.catalogueId})`);
    await suite.db.execute(sql`
      insert into device_zone_defaults (device_id, zone_id)
      values (${deviceId}, ${second!.id})`);

    const res = await app.request("/api/default-service-zone/offers", {
      headers: { cookie: `${SESSION_COOKIE}=${token}; ${deviceCookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ context: { zoneId: second!.id } });
  });

  it("returns the offers allowed in an explicit service zone", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);

    const res = await app.request(`/api/service-zones/${counterZoneId}/offers`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      context: { zoneId: counterZoneId, serviceMode: "prepay" },
      defaultMenuId: aguaProduct.catalogueId,
      menus: [{ id: aguaProduct.catalogueId, name: "Carta", isDefault: true }],
      offers: [{ id: aguaOfferId, productId: aguaProduct.id, grossPrice: "1.75" }],
    });
  });

  it("REJECTS (401 session.required) when no cookie is present — proves the requireSession guard", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: the guard must refuse before any catalogue is read.
    const res = await app.request("/api/products");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("REJECTS (401 session.required) a NON-UUID cookie on the catalogue route", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // Through the real route: a non-UUID cookie is refused by the guard as 401 before any catalogue
    // read. Weaker than its name: it does not pin `requireSession`'s `isUuid` screen, since the hashed
    // value matches no row either way.
    const res = await app.request("/api/products", {
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("RETURNS the location's menus and available products when an open session's cookie is sent", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const token = await openSession(suite.db);
    const res = await app.request("/api/products", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    // The wrapped `{ menus, products }` shape: `menus` carries BOTH accessible catalogues — the
    // location's default ("Carta", `isDefault: true`) sorted first, then the non-default one attached
    // via `addCatalogueToLocation` ("Happy Hour") — and `products` carries a row from EACH of them,
    // proving the route reads across the whole accessible set rather than just the default catalogue.
    // The exact `AvailableProduct` shape: the resolved category NAME (not id), the EU-14 allergen
    // declaration carried through unchanged, and the menu tag (`catalogueId`/`catalogueName`).
    expect(await res.json()).toEqual({
      menus: [
        { id: aguaProduct.catalogueId, name: "Carta", isDefault: true },
        { id: cervezaProduct.catalogueId, name: "Happy Hour", isDefault: false },
      ],
      products: [
        {
          id: aguaProduct.id,
          name: "Agua mineral",
          customerName: null,
          pricingUnit: "each",
          unit: eachUnit,
          unitPrice: "1.50",
          vatClass: "general",
          category: "Bebidas",
          allergens: { sulphites: { presence: "may_contain" } },
          // No override and no recipe: vegan/vegetarian "unknown" — an unreviewed plate asserts no
          // positive diet claim.
          diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
          dietDerivation: null,
          dietOverride: null,
          dietaryDeclarations: [],
          courseId: null,
          catalogueId: aguaProduct.catalogueId,
          catalogueName: "Carta",
          // `offeredModifiers` is the extras-and-options walk the till draws from
          // (`readOfferedModifiers`), empty here because these seeded products attach nothing.
          offeredModifiers: [],
        },
        {
          id: cervezaProduct.id,
          name: "Cerveza",
          customerName: null,
          pricingUnit: "each",
          unit: eachUnit,
          unitPrice: "2.50",
          vatClass: "general",
          category: "Bebidas",
          allergens: null,
          // No override, no recipe → the cautious "unknown" profile (see Agua mineral above).
          diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
          dietDerivation: null,
          dietOverride: null,
          dietaryDeclarations: [],
          courseId: null,
          catalogueId: cervezaProduct.catalogueId,
          catalogueName: "Happy Hour",
          offeredModifiers: [],
        },
      ],
    });
  });
});

describe("POST /api/sales (session-guarded sale)", () => {
  it("REJECTS (401 session.required) when no cookie is present — the sale never runs unauthenticated", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The guard runs BEFORE the body is even read. The chained fiscal write and the idempotent replay
    // are covered in `till-api.fiscal-sale-paths.test.ts`.
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: [], tender: { method: "cash", amount: "0" } }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("POST with a malformed workingOrderId is 400 shared.invalid_id, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);

    // Only a malformed `workingOrderId` is an error (absent or well-formed-unknown are walk-ups); the
    // screen refuses it 400 at the HTTP boundary, before any query runs.
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
        tender: { method: "cash", amount: "10.00" },
        workingOrderId: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });
});

describe("POST /api/pay (session-guarded integrated card pay)", () => {
  it("REJECTS (401 session.required) when no cookie is present — a pay never runs unauthenticated", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The guard runs BEFORE the body is even read. The capture/decline paths are covered in
    // `till-api.fiscal-sale-paths.test.ts`.
    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), lines: [] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });

  it("401s device.unauthorized on /api/pay from a cookieless caller (an env-only till is not a sellable box)", async () => {
    // The reader is resolved from the paying DEVICE, so a cookieless caller is refused
    // `device.unauthorized` at `requireSaleTillId`, before any reader read.
    const token = await openSession(suite.db);
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ id: randomUUID(), lines: [] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("refuses a browser-selected simulation outcome for a real provider", async () => {
    const token = await openSession(suite.db);
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cardProvider: { provider: "stripe" } as PaymentProvider },
      collect([]),
    );

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        id: randomUUID(),
        lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
        simulationOutcome: "captured",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "simulationOutcome" } },
    });
  });

  it("POST with a malformed id is 400 shared.invalid_id, not an opaque 500 (the 7b /api/pay sibling)", async () => {
    const token = await openSession(suite.db);
    const app = new Hono();
    // The route screen refuses the malformed id 400 before the empty stub provider is invoked.
    mountTillApi(app, { ...deps(suite.db), cardProvider: {} as PaymentProvider }, collect([]));

    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        id: "not-a-uuid",
        lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });
});

describe("POST /api/session refusals that never reach the PIN check", () => {
  it("refuses a personId that is no UUID in any spelling, or not a string, as person.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    for (const [personId, named] of [
      ["ana", "ana"],
      [42, "42"],
    ] as const) {
      const res = await app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify({ personId, pin: "5555" }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { code: "person.not_found", params: { personId: named } },
      });
    }
  });

  it("does not count an unknown person's attempts toward the wrong-PIN back-off", async () => {
    const now = 7_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const nobody = randomUUID();
    // Past the three free failures a wrong PIN would open the wait window; an unknown person must not.
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify({ personId: nobody, pin: "0000" }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "person.not_found" } });
    }
  });
});

describe("malformed zone ids and simulation outcomes on the sale routes", () => {
  it("POST /api/sales with a malformed zoneId is 400 shared.invalid_id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const res = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
        tender: { method: "cash", amount: "10.00" },
        zoneId: "not-a-zone",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "ServiceZoneId", value: "not-a-zone" } },
    });
  });

  it("POST /api/pay with a malformed zoneId is 400 shared.invalid_id", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const token = await openSession(suite.db);
    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        id: randomUUID(),
        lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
        zoneId: "not-a-zone",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "ServiceZoneId", value: "not-a-zone" } },
    });
  });

  it("the practice simulator takes a captured or declined outcome and refuses any other", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), cardProvider: { provider: "simulator" } as PaymentProvider },
      collect([]),
    );
    const token = await openSession(suite.db);
    const pay = (simulationOutcome: string) =>
      app.request("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify({
          id: randomUUID(),
          lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
          simulationOutcome,
          // A malformed zone makes an ACCEPTED outcome stop at the next screen, before any sale.
          zoneId: "not-a-zone",
        }),
      });

    for (const accepted of ["captured", "declined"]) {
      expect(await (await pay(accepted)).json()).toMatchObject({
        error: { code: "shared.invalid_id", params: { kind: "ServiceZoneId" } },
      });
    }
    const refused = await pay("exploded");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "simulationOutcome" } },
    });
  });
});

// Park a fresh order for the logged-in operator over the real HTTP surface (never the working-order
// module directly), so every assertion using it rides the route's own requireSession + run wrapper.
// Module-scoped because the place/prep/cancel suites below all need a parked order to place first.
async function park(
  app: Hono,
  cookie: string,
  body: { id: string; lines: { menuItemId: string; quantity: string }[]; label?: string },
): Promise<Response> {
  return app.request("/api/working-orders", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("/api/working-orders (session-guarded park & retrieve)", () => {
  it("REJECTS every route with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    const json = { "content-type": "application/json" };
    // The guard runs FIRST on each route (before any body is read or catalogue touched), so an
    // unauthenticated park/list/retrieve/update/abandon/place/prep/collect/cancel all 401 with the one
    // code. (The station-operate routes have their own 401 guard test below.)
    const cases = [
      app.request("/api/working-orders", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ id, lines: [] }),
      }),
      app.request("/api/working-orders"),
      app.request(`/api/working-orders/${id}`),
      app.request(`/api/working-orders/${id}`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ lines: [] }),
      }),
      app.request(`/api/working-orders/${id}`, { method: "DELETE" }),
      // The prep surface.
      app.request(`/api/working-orders/${id}/place`, { method: "POST" }),
      app.request(`/api/working-orders/${id}/prep`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({}),
      }),
      app.request(`/api/working-orders/${id}/collect`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ tender: { method: "cash", amount: "1.50" } }),
      }),
      app.request(`/api/working-orders/${id}/cancel`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ reason: "changed mind" }),
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("POST parks an order attributed to the session's till and returns { id, orderNumber }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();

    const res = await park(app, cookie, {
      id,
      lines: [{ menuItemId: aguaOfferId, quantity: "2" }],
      label: "Mesa 4",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; orderNumber: number };
    expect(body.id).toBe(id);
    // Per-NODE counter shared across this suite's tests, so assert the shape, not the value.
    expect(Number.isInteger(body.orderNumber)).toBe(true);
    expect(body.orderNumber).toBeGreaterThanOrEqual(1);

    // The order really persisted OPEN on the seeded till.
    const rows = await suite.db.execute<{ status: string; till_id: string }>(
      sql`select status, till_id from working_orders where id = ${id}`,
    );
    expect(rows.rows[0]).toMatchObject({ status: "open", till_id: cfg.tillId });
  });

  it("POST prices an allowed menu offer and rejects an offer outside the selected zone", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const allowedId = randomUUID();
    const allowed = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: allowedId,
        zoneId: counterZoneId,
        lines: [{ menuItemId: aguaOfferId, quantity: "2" }],
      }),
    });
    expect(allowed.status).toBe(200);
    // Read straight from the column, which counts whole cents: 175 is the stored 1.75. The cast
    // refuses no width on this engine; the values here are three digits, so nothing turns on that.
    const priced = await suite.db.execute<{ unit_price_gross: number }>(sql`
      select cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines where working_order_id = ${allowedId}`);
    expect(priced.rows).toEqual([{ unit_price_gross: 175 }]);

    const rejected = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: randomUUID(),
        zoneId: counterZoneId,
        lines: [{ menuItemId: hiddenAguaOfferId, quantity: "1" }],
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: {
        code: "service_zone.offer_not_allowed",
        params: { zoneId: counterZoneId, menuItemId: hiddenAguaOfferId },
      },
    });
  });

  it("POST rejects a product id that bypasses the zone's menu offers", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: randomUUID(),
        lines: [{ productId: aguaProduct.id, quantity: "1" }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "lines" } },
    });
  });

  it("POST with a malformed id is 400 shared.invalid_id, not an opaque 500 (the 7b park sibling)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // Park is the one route where the client MINTS the working-order id that becomes the PK; the
    // route screen refuses a malformed one 400. The non-empty basket clears parkOrder's empty-basket
    // early-out.
    const res = await park(app, cookie, {
      id: "not-a-uuid",
      lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "WorkingOrderId", value: "not-a-uuid" } },
    });
  });

  it("GET lists it, GET/:id retrieves its lines, PUT edits it, DELETE abandons it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();

    const parked = await park(app, cookie, {
      id,
      lines: [{ menuItemId: aguaOfferId, quantity: "2" }],
      label: "Mesa 7",
    });
    const { orderNumber } = (await parked.json()) as { orderNumber: number };

    // GET list carries this order's summary. `total` is the GROSS (VAT-inclusive) draft total the
    // operator saw: 2 × 1.75 = 3.50 gross. Assert
    // containment — the suite shares one node, so other tests' open orders also list.
    const list = await app.request("/api/working-orders", { headers: { cookie } });
    expect(list.status).toBe(200);
    const summaries = (await list.json()) as {
      id: string;
      orderNumber: number;
      label: string | null;
      itemCount: number;
      total: string;
    }[];
    expect(summaries).toContainEqual(
      expect.objectContaining({ id, orderNumber, label: "Mesa 7", itemCount: 1, total: "3.50" }),
    );

    // GET /:id rebuilds the basket from the frozen menu offer and returns its product details.
    // `quantity` reads back at the three places `thousandthsToDecimal` always renders ("2.000",
    // not the sent "2").
    const got = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      id,
      orderNumber,
      label: "Mesa 7",
      lines: [
        {
          menuItemId: aguaOfferId,
          productId: aguaProduct.id,
          quantity: "2.000",
          product: {
            menuItemId: aguaOfferId,
            productId: aguaProduct.id,
            unitPrice: "1.75",
          },
        },
      ],
    });

    // PUT replaces the whole basket + label — a 200 with no body — and a re-retrieve reflects it.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [{ menuItemId: aguaOfferId, quantity: "5" }],
        label: "Mesa 7 bis",
      }),
    });
    expect(put.status).toBe(200);
    expect(await put.text()).toBe("");
    const afterPut = await (
      await app.request(`/api/working-orders/${id}`, { headers: { cookie } })
    ).json();
    expect(afterPut).toMatchObject({
      id,
      orderNumber,
      label: "Mesa 7 bis",
      lines: [
        {
          menuItemId: aguaOfferId,
          productId: aguaProduct.id,
          quantity: "5.000",
          product: {
            menuItemId: aguaOfferId,
            productId: aguaProduct.id,
            unitPrice: "1.75",
          },
        },
      ],
    });

    // DELETE abandons it — a 200 with no body — after which retrieve is 404 and it leaves the list.
    const del = await app.request(`/api/working-orders/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.text()).toBe("");
    const goneGet = await app.request(`/api/working-orders/${id}`, { headers: { cookie } });
    expect(goneGet.status).toBe(404);
    expect(await goneGet.json()).toMatchObject({ error: { code: "working_order.not_found" } });
    const afterList = (await (
      await app.request("/api/working-orders", { headers: { cookie } })
    ).json()) as { id: string }[];
    expect(afterList.find((o) => o.id === id)).toBeUndefined();
  });

  it("GET /:id of an unknown id is 404 working_order.not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request(`/api/working-orders/${randomUUID()}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "working_order.not_found" } });
  });

  it("PUT of an abandoned (terminal) order is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: aguaOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}`, { method: "DELETE", headers: { cookie } });

    // The order now sits in the terminal `abandoned` state, so an edit is refused 409 — the mutation
    // counterpart to the retrieve side's 404.
    const put = await app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ menuItemId: aguaOfferId, quantity: "2" }] }),
    });
    expect(put.status).toBe(409);
    expect(await put.json()).toMatchObject({ error: { code: "working_order.not_open" } });
  });

  // The retrieve/edit/abandon routes: the `requireUuidId` screen refuses a malformed `:id` before any
  // query runs, with the same domain code an absent/non-open id gets on that route.
  it("GET /:id with a malformed id is 404 working_order.not_found, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_found", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("PUT /:id with a malformed id is 409 working_order.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A well-formed body, so the refusal comes from the id screen, not the body parse.
    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ menuItemId: aguaOfferId, quantity: "1" }] }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });

  it("DELETE /:id with a malformed id is 409 working_order.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// The prep surface's till routes. This suite's cfg is `prepay`, so `placeOrder`/`cancelPlacedOrder`
// never dispatch into the fiscal backend and these routes are testable hermetically. `collectOrder`'s
// fiscal happy path needs a real backend and lives in `till-api.fiscal-sale-paths.test.ts`.
describe("/api/working-orders/:id/place (send-to-prep placing)", () => {
  beforeEach(enrolSaleTillDevice);
  it("POST places an open order (open → placed), fires a ticket item at queued, and returns { id, status }", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
      label: "Mesa 2",
    });

    const placed = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });
    expect(placed.status).toBe(200);
    // `prepay` files nothing at placing — just the bare transition result.
    expect(await placed.json()).toEqual({ id, status: "placed" });

    // The order really transitioned AND a ticket item was fired at `queued` — placing fires the
    // lines to the kitchen (`placeOrder` → `fireLines`); the single line routes to the seeded default
    // station "Cocina".
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
    const ticket = await suite.db.execute<{ state: string }>(
      sql`select state from ticket_items where working_order_id = ${id}`,
    );
    expect(ticket.rows[0]).toEqual({ state: "queued" });
  });

  it("POST on a non-open order (a re-place of an already-placed one) is 409 working_order.not_open", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: aguaOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });

    // The re-place carries the device cookie too, so it reaches `placeOrder`'s open-only guard
    // (`working_order.not_open`) rather than being short-circuited by the sale-time device gate.
    const rePlace = await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });
    expect(rePlace.status).toBe(409);
    expect(await rePlace.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: id } },
    });
  });

  it("POST with a malformed id is 409 working_order.not_open, not an opaque 500 (the 7b isUuid follow-up)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // The route's `isUuid` screen refuses "not-a-uuid" before any query.
    const res = await app.request("/api/working-orders/not-a-uuid/place", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_open", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("/api/working-orders/:id/prep (Mode-P send-to-prep, KDS-1 ticket model)", () => {
  // `sendToPrep` needs a SETTLED order, and settling one means a real fiscal write the stub backend
  // cannot make — so the success path and the double-send collision live in
  // `till-api.fiscal-sale-paths.test.ts`. This suite covers the refusal and the malformed-id screen.
  it("POST on a still-OPEN (parked, unpaid) order is refused 409 working_order.not_settled, nothing fired", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [{ menuItemId: aguaOfferId, quantity: "1" }],
      label: "Mesa 5",
    });

    const sent = await app.request(`/api/working-orders/${id}/prep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe(409);
    expect(await sent.json()).toMatchObject({
      error: { code: "working_order.not_settled", params: { workingOrderId: id } },
    });

    // Refused BEFORE any write — no ticket item was fired for the order.
    const fired = await suite.db.execute(
      sql`select 1 from ticket_items where working_order_id = ${id}`,
    );
    expect(fired.rows).toHaveLength(0);
  });

  it("POST with a malformed id is 409 working_order.not_settled, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid/prep", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_settled", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// Station-display operate routes: GET /api/stations, GET /api/stations/:id/queue, POST
// /api/ticket-items/:id/advance, POST /api/orders/:id/stations/:sid/advance. Under this suite's
// `prepay` cfg, `placeOrder`'s fire seeds ticket items with no fiscal write.
describe("KDS-1 station-display operate routes", () => {
  beforeEach(enrolSaleTillDevice);
  /** The seeded default station "Cocina", read back through `GET /api/stations` (the picker's own read). */
  async function defaultStation(
    app: Hono,
    cookie: string,
  ): Promise<{ id: string; name: string; isDefault: boolean }> {
    const res = await app.request("/api/stations", { headers: { cookie } });
    expect(res.status).toBe(200);
    const stations = (await res.json()) as { id: string; name: string; isDefault: boolean }[];
    return stations.find((s) => s.isDefault)!;
  }

  /** Park + place a one-line order (fires one ticket item to the default station at `queued`), returning
   *  the order id — the seed the queue/bump tests read from. */
  async function placeFired(app: Hono, cookie: string, label?: string): Promise<string> {
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: aguaOfferId, quantity: "1" }], label });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });
    return id;
  }

  it("a session lists stations, reads a station's queue, bumps a ticket item, and the queue reflects it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = await placeFired(app, cookie, "Mesa 8");

    // 1. List stations → the seeded default "Cocina".
    const cocina = await defaultStation(app, cookie);
    expect(cocina.name).toBe("Cocina");

    // 2. Read its queue → the order's group carries one queued line.
    const q1 = await app.request(`/api/stations/${cocina.id}/queue`, { headers: { cookie } });
    expect(q1.status).toBe(200);
    const groups1 = (await q1.json()) as {
      orderId: string;
      label: string | null;
      items: { id: string; state: string }[];
    }[];
    const group = groups1.find((g) => g.orderId === id)!;
    expect(group).toMatchObject({ label: "Mesa 8" });
    expect(group.items).toHaveLength(1);
    expect(group.items[0]!.state).toBe("queued");
    const itemId = group.items[0]!.id;

    // 3. Bump that item queued → preparing.
    const bump = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(bump.status).toBe(200);
    expect(await bump.text()).toBe("");

    // 4. The queue reflects it.
    const q2 = await app.request(`/api/stations/${cocina.id}/queue`, { headers: { cookie } });
    const groups2 = (await q2.json()) as {
      orderId: string;
      items: { state: string }[];
    }[];
    expect(groups2.find((g) => g.orderId === id)!.items[0]!.state).toBe("preparing");
  });

  it("a queued item bumped straight to ready (skipping preparing) is refused 409 ticket.invalid_transition", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = await placeFired(app, cookie);
    const cocina = await defaultStation(app, cookie);
    const q = await app.request(`/api/stations/${cocina.id}/queue`, { headers: { cookie } });
    const groups = (await q.json()) as { orderId: string; items: { id: string }[] }[];
    const itemId = groups.find((g) => g.orderId === id)!.items[0]!.id;

    // The legal next step from `queued` is `preparing`; jumping to `ready` matches no row → refused.
    const skip = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "ready" }),
    });
    expect(skip.status).toBe(409);
    expect(await skip.json()).toMatchObject({
      error: { code: "ticket.invalid_transition", params: { ticketItemId: itemId } },
    });
  });

  it("POST /api/ticket-items/:id/advance with a malformed id is 409 ticket.invalid_transition, not a 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request("/api/ticket-items/not-a-uuid/advance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "preparing" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "ticket.invalid_transition", params: { ticketItemId: "not-a-uuid" } },
    });
  });

  it("POST /api/ticket-items/:id/advance with a garbage or missing `to` is 409 ticket.invalid_transition, not a 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = await placeFired(app, cookie);
    const cocina = await defaultStation(app, cookie);
    const q = await app.request(`/api/stations/${cocina.id}/queue`, { headers: { cookie } });
    const groups = (await q.json()) as { orderId: string; items: { id: string }[] }[];
    const itemId = groups.find((g) => g.orderId === id)!.items[0]!.id;

    // A `to` outside {preparing, ready, queued} — no route-level screen, so it reaches the verb as-is.
    const garbage = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ to: "garbage" }),
    });
    expect(garbage.status).toBe(409);
    expect(await garbage.json()).toMatchObject({
      error: { code: "ticket.invalid_transition", params: { ticketItemId: itemId } },
    });

    // A missing `to` — the body has no `to` field at all.
    const missing = await app.request(`/api/ticket-items/${itemId}/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: { code: "ticket.invalid_transition", params: { ticketItemId: itemId } },
    });
  });

  it("GET /api/stations/:id/queue with a malformed id is 404 station.not_found, not a 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const res = await app.request("/api/stations/not-a-uuid/queue", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "station.not_found", params: { stationId: "not-a-uuid" } },
    });
  });

  it("POST /api/orders/:id/stations/:sid/advance bumps the WHOLE ticket; a bad `to` is 400; a malformed id a 200 no-op", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    // Two lines → two ticket items at the default station, so the whole-ticket bump moves both together.
    const id = randomUUID();
    await park(app, cookie, {
      id,
      lines: [
        { menuItemId: aguaOfferId, quantity: "1" },
        { menuItemId: aguaOfferId, quantity: "1" },
      ],
      label: "Mesa 9",
    });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });
    const cocina = await defaultStation(app, cookie);

    const advance = (order: string, station: string, to: string) =>
      app.request(`/api/orders/${order}/stations/${station}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ to }),
      });

    // A non-{preparing,ready} target is a request-shape fault (advanceTicket has no target guard).
    const bad = await advance(id, cocina.id, "collected");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "to" } },
    });

    // A malformed ORDER id, and a malformed STATION id, each name nothing — the SAME no-op advanceTicket
    // makes for an unknown one, a clean 200.
    expect((await advance("not-a-uuid", cocina.id, "preparing")).status).toBe(200);
    expect((await advance(id, "not-a-uuid", "preparing")).status).toBe(200);

    // The real whole-ticket bump: both lines move queued → preparing → ready together.
    expect((await advance(id, cocina.id, "preparing")).status).toBe(200);
    expect((await advance(id, cocina.id, "ready")).status).toBe(200);
    const q = await app.request(`/api/stations/${cocina.id}/queue`, { headers: { cookie } });
    const groups = (await q.json()) as { orderId: string; items: { state: string }[] }[];
    const items = groups.find((g) => g.orderId === id)!.items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.state === "ready")).toBe(true);
  });

  it("REJECTS every station-operate route with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const someId = randomUUID();
    const j = { "content-type": "application/json" };
    const advanceBody = JSON.stringify({ to: "preparing" });
    // The guard runs FIRST on each route.
    const cases = [
      app.request("/api/stations"),
      app.request(`/api/stations/${someId}/queue`),
      app.request(`/api/ticket-items/${someId}/advance`, {
        method: "POST",
        headers: j,
        body: advanceBody,
      }),
      app.request(`/api/orders/${someId}/stations/${someId}/advance`, {
        method: "POST",
        headers: j,
        body: advanceBody,
      }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });
});

describe("/api/working-orders/:id/collect (malformed id — the fiscal happy path is till-api.fiscal-sale-paths.test.ts)", () => {
  it("POST with a malformed id is 409 working_order.not_placed BEFORE any fiscal dispatch, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // The stub `backend: {} as FiscalBackend` would throw (a non-AppError → opaque 500) the moment
    // `collectOrder` tried to use it — this 409, not a 500, is the witness that the `isUuid` screen
    // refuses BEFORE `collectOrder` is even called.
    const res = await app.request("/api/working-orders/not-a-uuid/collect", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tender: { method: "cash", amount: "1.50" } }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_placed", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

describe("/api/working-orders/:id/cancel", () => {
  beforeEach(enrolSaleTillDevice);
  it("POST cancels a PLACED order (placed → abandoned) given a reason", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: aguaOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "customer left" }),
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.text()).toBe("");

    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "abandoned" });
  });

  it("POST with an empty reason is 400 working_order.reason_required, changing nothing", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const id = randomUUID();
    await park(app, cookie, { id, lines: [{ menuItemId: aguaOfferId, quantity: "1" }] });
    await app.request(`/api/working-orders/${id}/place`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${tillDeviceCookie}` },
    });

    const cancel = await app.request(`/api/working-orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "" }),
    });
    expect(cancel.status).toBe(400);
    expect(await cancel.json()).toMatchObject({ error: { code: "working_order.reason_required" } });

    // Refused BEFORE any transition — still `placed`, the guard `cancelPlacedOrder` itself enforces.
    const order = await suite.db.execute<{ status: string }>(
      sql`select status from working_orders where id = ${id}`,
    );
    expect(order.rows[0]).toEqual({ status: "placed" });
  });

  it("POST with a malformed id is 409 working_order.not_placed, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const res = await app.request("/api/working-orders/not-a-uuid/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reason: "changed mind" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "working_order.not_placed", params: { workingOrderId: "not-a-uuid" } },
    });
  });
});

// The live-floor till surface: GET /api/zones (list-only), the mark/unmark-served route, and the
// zoneId + pendingToServe fields of the /api/tables/state read. served_at is a PRE-FISCAL
// operational field: nothing here touches a fiscal path. Zone CRUD is the management API's, so a
// zone is seeded directly.
describe("/api/zones + served route + /api/tables/state occupancy fields (FP-1, Task 6)", () => {
  /** A table_tab zone offering the agua, for a served-route case that needs a real open tab. No route
   *  is written: the agua already has its venue-wide one from setup. */
  async function tabZone(): Promise<{ zoneId: string; aguaOffer: string }> {
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, cfg, { zone: "tables", productIds: [aguaProduct.id], routes: "none" }),
    );
    return { zoneId: offers.zoneId, aguaOffer: offers.offerFor(aguaProduct.id) };
  }

  it("lists zones, marks a line served (2→1) and unmarks it (1→2), surfacing zoneId + pendingToServe in the state read", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // Seed one active floor zone in the till's own venue. `GET /api/zones` must read it back, and
    // the table-create must accept it, so those two paths — not this insert — are under test. This
    // is the only zone-seeding test in the suite, so "Comedor" cannot collide.
    const [zoneRow] = await suite.db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Comedor" })
      .returning({ id: floorZones.id });
    const zoneId = zoneRow!.id;
    const [department] = await suite.db
      .insert(departments)
      .values({
        locationId: cfg.locationId,
        name: "Dining room",
        tradingName: "Restaurant",
        defaultServiceMode: "table_tab",
      })
      .returning({ id: departments.id });
    await suite.db.execute(sql`
      insert into zone_service_policies
        (location_id, zone_id, department_id)
      values (${cfg.locationId}, ${zoneId}, ${department!.id})`);
    await suite.db.execute(sql`
      insert into zone_menus (zone_id, menu_id)
      values (${zoneId}, ${aguaProduct.catalogueId})`);
    await suite.db.execute(sql`
      update zone_service_policies set default_menu_id = ${aguaProduct.catalogueId}
      where zone_id = ${zoneId}`);

    // Create a table IN that zone through the till route, so `createTable`'s zoneId assignment (and its
    // zone FK) is exercised — not a raw insert.
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "4", zoneId }),
    });
    expect(tableRes.status).toBe(200);
    const { id: tableId } = (await tableRes.json()) as { id: string };

    // Open a tab with TWO lines. `priceBasket` maps items 1:1 (it does NOT merge by product), so two
    // lines of the one seeded product become line_no 1 and 2 — pendingToServe starts at 2.
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [
          { menuItemId: aguaOfferId, quantity: "1" },
          { menuItemId: aguaOfferId, quantity: "1" },
        ],
      }),
    });
    expect(tabRes.status).toBe(200);
    const { tabId } = (await tabRes.json()) as { tabId: string };

    // GET /api/zones lists the active zone (session-gated, by display_order).
    const zonesRes = await app.request("/api/zones", { headers: { cookie } });
    expect(zonesRes.status).toBe(200);
    const zones = (await zonesRes.json()) as {
      id: string;
      name: string;
      displayOrder: number;
      active: boolean;
    }[];
    expect(zones.map((z) => z.name)).toContain("Comedor");
    expect(zones).toContainEqual({ id: zoneId, name: "Comedor", displayOrder: 0, active: true });

    // Read this table's occupancy row out of the state read.
    const stateOf = async () => {
      const res = await app.request("/api/tables/state", { headers: { cookie } });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as {
        id: string;
        zoneId: string | null;
        pendingToServe: number;
      }[];
      return rows.find((t) => t.id === tableId)!;
    };

    // The state read carries the table's zoneId and its pending-to-serve count (2 unserved).
    let state = await stateOf();
    expect(state.zoneId).toBe(zoneId);
    expect(state.pendingToServe).toBe(2);

    // POST marks line 1 delivered — pendingToServe drops to 1. A 200 with an empty body.
    const served = await app.request(`/api/working-orders/${tabId}/lines/1/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("");
    state = await stateOf();
    expect(state.pendingToServe).toBe(1);

    // DELETE clears the marker again (the mis-tap inverse) — pendingToServe returns to 2.
    const unserved = await app.request(`/api/working-orders/${tabId}/lines/1/served`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(unserved.status).toBe(200);
    expect(await unserved.text()).toBe("");
    state = await stateOf();
    expect(state.pendingToServe).toBe(2);
  });

  it("REJECTS GET /api/zones + the served POST/DELETE with 401 session.required when no cookie is present", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const id = randomUUID();
    // The guard runs FIRST on each route (before any DB work), so an unauthenticated list/mark/unmark
    // all 401 with the one code.
    const cases = [
      app.request("/api/zones"),
      app.request(`/api/working-orders/${id}/lines/1/served`, { method: "POST" }),
      app.request(`/api/working-orders/${id}/lines/1/served`, { method: "DELETE" }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
    }
  });

  it("served POST with a malformed :id is 409 tab.not_open, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // The tab screen refuses a non-UUID :id with the SAME code a non-open/absent tab gets from
    // `markLineServed` (the fail-closed shape the sibling void-line route uses).
    const res = await app.request("/api/working-orders/not-a-uuid/lines/1/served", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.not_open", params: { tabId: "not-a-uuid" } },
    });
  });

  it("served POST with a :lineNo that is not an in-range int4 line number is 404 tab.line_not_found, not an opaque 500", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A REAL open tab, so `markLineServed`'s `assertAnchoredTabOpen` passes and the route's :lineNo
    // screen is what refuses: "9999999999" clears `Number.isInteger` but is out of range, and "0" is
    // below the 1-based floor. All four get the 404 an absent line gets, as the sibling void-line
    // route screens them.
    const tab = await tabZone();
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "served-bad-lineno", zoneId: tab.zoneId }),
    });
    const { id: tableId } = (await tableRes.json()) as { id: string };
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ menuItemId: tab.aguaOffer, quantity: "1" }] }),
    });
    const { tabId } = (await tabRes.json()) as { tabId: string };

    for (const lineNo of ["abc", "1.5", "0", "9999999999"]) {
      const res = await app.request(`/api/working-orders/${tabId}/lines/${lineNo}/served`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "tab.line_not_found" } });
    }
  });

  it("served POST naming a line that does not exist on a real open tab is 404 tab.line_not_found", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A real open tab (one line), then a mark of line 99 — an in-range int4 that clears the route
    // screen and reaches `markLineServed`, whose 0-row UPDATE throws `tab.line_not_found`. This is the
    // verb's own guard, distinct from the route's range screen above.
    const tab = await tabZone();
    const tableRes = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "served-99", zoneId: tab.zoneId }),
    });
    const { id: tableId } = (await tableRes.json()) as { id: string };
    const tabRes = await app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lines: [{ menuItemId: tab.aguaOffer, quantity: "1" }] }),
    });
    const { tabId } = (await tabRes.json()) as { tabId: string };

    const res = await app.request(`/api/working-orders/${tabId}/lines/99/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "tab.line_not_found", params: { tabId, lineNo: 99 } },
    });
  });

  it("served POST on a well-formed id that names no OPEN tab is 409 tab.not_open (markLineServed's own guard)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    // A valid uuid naming no open tab a table points at (never opened, or settled/abandoned/foreign):
    // clears the route's isUuid screen, reaches `markLineServed`, whose `assertAnchoredTabOpen` matches no row →
    // tab.not_open (409).
    const res = await app.request(`/api/working-orders/${randomUUID()}/lines/1/served`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "tab.not_open" } });
  });
});

describe("PUT + DELETE /api/tables/:id/placement — the on-till authorize(venue.configure) gate (FP-2, Task 4)", () => {
  // The on-till `authorize(venue.configure)` gate: the route resolves the SESSION operator's OWN role
  // and refuses a write the role cannot make (no supervisor override — manager-on-till only). The
  // write itself is covered by the management-api placement sibling, which wraps the SAME verb.

  // A live zone every placement body points at, and the two operators the gate distinguishes: a MANAGER
  // (role `manager`, which holds `venue.configure`) and a STAFF operator (Ana, role `staff`, which does
  // NOT — reused from setup rather than re-seeded). Both are GENUINE `persons.role` values logged in
  // through the real `loginWithPin` path; the role is never faked.
  let managerCookie: string;
  let managerPersonId: string;
  let staffCookie: string;
  let zoneId: string;

  beforeAll(async () => {
    const [managerRow] = await suite.db
      .insert(persons)
      .values({ displayName: "Manolo (manager)", pinHash: hashPin("9999"), role: "manager" })
      .returning({ id: persons.id });
    managerPersonId = managerRow!.id;
    const managerSession = await withTransaction(suite.db, async (tx) => {
      return loginWithPin(tx, {
        tillId: cfg.tillId,
        personId: managerPersonId,
        pin: "9999",
      });
    });
    managerCookie = `${SESSION_COOKIE}=${managerSession.token}`;
    // Ana (role `staff`) is the STAFF operator — no `venue.configure`. Reusing the setup fixture keeps
    // the roster's `[abel, ana]` invariant untouched (no extra staff person seeded).
    staffCookie = `${SESSION_COOKIE}=${await openSession(suite.db)}`;

    const [zoneRow] = await suite.db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Sala" })
      .returning({ id: floorZones.id });
    zoneId = zoneRow!.id;
  });

  // Remove the seeded manager (and its session) so `GET /api/staff`'s EXACT `[abel, ana]` roster
  // assertion stays order-independent whatever order the suites run in (CLAUDE.md §4).
  afterAll(async () => {
    await suite.db.execute(sql`delete from sessions where person_id = ${managerPersonId}`);
    await suite.db.execute(sql`delete from persons where id = ${managerPersonId}`);
  });

  /** A valid full placement against the live `zoneId`: a real `floor_table_shape` member and in-range
   *  coordinates/rotation, so nothing in the body is itself the fault under test. */
  function place() {
    return { zoneId, posX: 120, posY: 340, shape: "rect", rotation: 90 };
  }

  /** Create a fresh table (unique label) through the till route, returning its id — a distinct row per
   *  test so the PUT/DELETE cases never contend on one table's placement. */
  async function makeTable(app: Hono): Promise<string> {
    const res = await app.request("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ label: `placement-${randomUUID().slice(0, 8)}` }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  }

  /**
   * Read a table's four placement columns (plus zone_id) back (a pure assertion read, not a path
   * under test).
   */
  async function placementOf(tableId: string) {
    const rows = await suite.db.execute<{
      pos_x: number | null;
      pos_y: number | null;
      shape: string | null;
      rotation: number | null;
      zone_id: string | null;
    }>(sql`select pos_x, pos_y, shape, rotation, zone_id from dining_tables where id = ${tableId}`);
    return rows.rows[0]!;
  }

  it("a MANAGER operator places a table (204, placement landed); a STAFF operator is 403", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // Manager holds `venue.configure`: `authorize` passes, the placement is written, the route answers 204.
    const ok = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    // The four placement columns (plus zone_id) actually landed on the row.
    expect(await placementOf(tableId)).toEqual({
      pos_x: 120,
      pos_y: 340,
      shape: "rect",
      rotation: 90,
      zone_id: zoneId,
    });

    // Staff holds no `venue.configure` and sends no override: `authorize` throws
    // `authorization.not_permitted`, which the till STATUS map answers 403.
    const forbidden = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: staffCookie },
      body: JSON.stringify(place()),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
    });
  });

  it("a MANAGER operator clears a placement (204, columns NULLed); a STAFF operator is 403", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // Place it first (as the manager) so there is something to clear.
    const placed = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(placed.status).toBe(204);

    // Staff cannot clear either — the same gate, 403 before any write.
    const forbidden = await app.request(`/api/tables/${tableId}/placement`, {
      method: "DELETE",
      headers: { cookie: staffCookie },
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    // The staff 403 wrote nothing: the placement the manager set is still present.
    expect(await placementOf(tableId)).toMatchObject({ pos_x: 120, pos_y: 340 });

    // Manager clears it: the four placement columns go NULL (zone_id is left as-is).
    const cleared = await app.request(`/api/tables/${tableId}/placement`, {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(cleared.status).toBe(204);
    expect(await cleared.text()).toBe("");
    expect(await placementOf(tableId)).toMatchObject({
      pos_x: null,
      pos_y: null,
      shape: null,
      rotation: null,
      zone_id: zoneId,
    });
  });

  it("a malformed :id is 404 table.not_found on PUT and DELETE (the screen, never an opaque 22P02 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The isUuid screen refuses a non-UUID :id with the domain `table.not_found` (404), the shape the
    // sibling PATCH/DELETE /api/tables routes use. The MANAGER cookie shows it is the SCREEN, not the
    // gate, that rejects it.
    const put = await app.request("/api/tables/not-a-uuid/placement", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify(place()),
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });

    const del = await app.request("/api/tables/not-a-uuid/placement", {
      method: "DELETE",
      headers: { cookie: managerCookie },
    });
    expect(del.status).toBe(404);
    expect(await del.json()).toMatchObject({
      error: { code: "table.not_found", params: { tableId: "not-a-uuid" } },
    });
  });

  it("a malformed zoneId in the PUT body is 404 zone.not_found (the screen, never an opaque 22P02 500)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // A string-typed but non-UUID zoneId is screened to the SAME `zone.not_found` a
    // well-formed-but-missing zone gets, matching the sibling table POST/PATCH routes.
    const res = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ ...place(), zoneId: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "zone.not_found", params: { zoneId: "not-a-uuid" } },
    });
  });

  it("PUT body screens: non-string zoneId; non-number posX/posY/rotation; non-string shape (mirrors management-api)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    // A well-formed but non-existent table id: every case here is refused by the body-shape ladder
    // BEFORE `setTablePlacement` runs, so no live table row is needed (mirrors management-api.test.ts's
    // "PUT body screens" case, which uses the same trick for the same reason).
    const id = randomUUID();

    // A `null` body coerces to `{}` (`readJsonBody`), then the first field screen fires (field "body"
    // is only for a non-object TRUTHY body such as an array) — the same null-body discipline the
    // management-api sibling follows, and the only case that exercises that coercion itself.
    const nullBody = await app.request(`/api/tables/${id}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: "null",
    });
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "zoneId" } },
    });

    // An array body fails the `typeof body !== "object" || body === null || Array.isArray(body)` guard
    // itself (an array IS typeof "object" in JS), naming "body" rather than a field — the one case the
    // per-field table below cannot reach.
    const arrayBody = await app.request(`/api/tables/${id}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: "[]",
    });
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "body" } },
    });

    const cases: readonly [string, Record<string, unknown>][] = [
      ["zoneId", { ...place(), zoneId: 123 }],
      ["posX", { ...place(), posX: "500" }],
      ["posY", { ...place(), posY: "250" }],
      ["shape", { ...place(), shape: 1 }],
      ["rotation", { ...place(), rotation: "0" }],
    ];
    for (const [field, body] of cases) {
      const res = await app.request(`/api/tables/${id}/placement`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: managerCookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });

  it("a placement VALUE fault surfaces the verb's placement.invalid as 400 through the till route", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const tableId = await makeTable(app);

    // posX above the 0..1000 canvas bound is `setTablePlacement`'s `placement.invalid` naming the field
    // (reached only AFTER `authorize` passes for the manager). Weaker than it looks: the `?? 400`
    // default yields the same 400, so this pins the surfaced status, not the STATUS map entry.
    const res = await app.request(`/api/tables/${tableId}/placement`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ ...place(), posX: 5000 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "placement.invalid", params: { field: "posX" } },
    });
  });
});

// HTTP serialization and deterministic pricing need no concurrency or privilege assertion here.
// Each fixture owns a fresh product and offer so other catalogue expectations remain independent.
async function modifierOfferFixture() {
  const data = await withTransaction(suite.db, async (tx) => {
    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    const product = await createProduct(tx, {
      catalogueId: aguaProduct.catalogueId,
      categoryId: null,
      name: "Prueba de modificadores",
      pricingUnit: "each",
      unitPrice: "8.00",
      vatClass: "general",
    });
    await tx.execute(
      // `preparation_routes.id` is a `$defaultFn` generator a raw insert never runs, and an
      // INSERT … SELECT cannot go through the table definition, so the id is bound into the select.
      sql`insert into preparation_routes (id,location_id,product_id,station_id) select ${randomUUID()},location_id,${product.id},station_id from preparation_routes where product_id=${aguaProduct.id}`,
    );
    const section = await createMenuSection(tx, {
      menuId: aguaProduct.catalogueId,
      name: { es: "Pruebas" },
    });
    const offer = await createMenuItem(tx, {
      menuId: aguaProduct.catalogueId,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "1.75",
    });

    // What the ORDER path answers: an extras list the offer republishes at its own price, and an
    // options list the product carries. The cheese's three names carry DIFFERENT text, so a line
    // freezing the wrong one of them fails (CLAUDE.md §3), and its own 9.00 unit price is the price
    // a child line would show if the offer's 0.35 were never read.
    const cheese = await createProduct(tx, {
      catalogueId: aguaProduct.catalogueId,
      categoryId: null,
      name: "Queso staff",
      customerName: { [defaultLanguage]: "Queso customer" },
      kitchenName: "Queso kitchen",
      pricingUnit: "each",
      unitPrice: "9.00",
      vatClass: "general",
    });
    const extrasList = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: cheese.id, maxQuantity: 2, preselected: false, price: "9.00" }],
      },
      cfg.locale,
    );
    // Carried by the product and NEVER published on the offer, so an offer line answering it is
    // answering something that dish does not offer here.
    const unpublishedList = await createExtraList(
      tx,
      {
        name: "Extras sin publicar",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: cheese.id, maxQuantity: 1, preselected: false, price: "1.00" }],
      },
      cfg.locale,
    );
    const prepList = await createOptionList(
      tx,
      {
        name: "Preparación staff",
        customerName: { [defaultLanguage]: "Preparación customer" },
        kitchenName: "Preparación kitchen",
        defaultLabelId: null,
        active: true,
        labels: [
          {
            name: "Frío staff",
            customerName: { [defaultLanguage]: "Frío customer" },
            kitchenName: "Frío kitchen",
            available: true,
          },
          {
            name: "Caliente staff",
            customerName: { [defaultLanguage]: "Caliente customer" },
            kitchenName: "Caliente kitchen",
            available: true,
          },
        ],
      },
      cfg.locale,
    );
    await writeProductModifiers(tx, product.id, [
      { kind: "extras", id: extrasList.id },
      { kind: "extras", id: unpublishedList.id },
      { kind: "options", id: prepList.id },
    ]);
    await setMenuItemExtraLists(tx, offer.id, [
      { listId: extrasList.id, items: [{ productId: cheese.id, price: "0.35", available: true }] },
    ]);
    return {
      product,
      offer,
      cheese,
      extrasList,
      unpublishedList,
      prepList,
      defaultLanguage,
    };
  });
  const frio = data.prepList.labels.find((label) => label.name === "Frío staff")!;
  const caliente = data.prepList.labels.find((label) => label.name === "Caliente staff")!;
  const language = data.defaultLanguage;
  /** The diner's answers, in the wire shape every order route takes. */
  const answers = {
    extras: [{ listId: data.extrasList.id, picks: [{ productId: data.cheese.id, quantity: 2 }] }],
    options: [{ listId: data.prepList.id, labelId: frio.id }],
  };
  /** The six names the dish line freezes — the list's three and the chosen label's three. */
  const optionSnapshots = [
    {
      listName: { [language]: "Preparación staff" },
      listCustomerName: { [language]: "Preparación customer" },
      listKitchenName: "Preparación kitchen",
      labelName: { [language]: "Frío staff" },
      labelCustomerName: { [language]: "Frío customer" },
      labelKitchenName: "Frío kitchen",
    },
  ];
  /** The child line as the held-order read hands it back: the OFFER's price, and per-dish picks. */
  const parkedExtras = [
    {
      productId: data.cheese.id,
      name: "Queso staff",
      descriptions: { "es-ES": "Queso customer" },
      kitchenName: "Queso kitchen",
      price: "0.35",
      quantity: 2,
    },
  ];
  const app = new Hono();
  mountTillApi(app, deps(suite.db), collect([]));
  const cookie = `${SESSION_COOKIE}=${await openSession(suite.db)}; ${tillDeviceCookie}`;
  const headers = { "content-type": "application/json", cookie };
  return {
    ...data,
    frio,
    caliente,
    answers,
    optionSnapshots,
    parkedExtras,
    app,
    headers,
  };
}

/** The held-order read's shape, as far as these tests assert on it. */
type HeldLine = {
  workingOrderLineId: string;
  quantity: string;
  optionSnapshots?: unknown;
  extras?: unknown;
};

describe("canonical modifier HTTP serialization", () => {
  it("publishes every mode, parks explicit answers and prices published extras exactly", async () => {
    const f = await modifierOfferFixture();
    // What the offer PUBLISHES: the extras list at the offer's own 0.35, the options list the
    // product carries, and not the list the product carries unpublished.
    const offers = await f.app.request("/api/default-service-zone/offers", { headers: f.headers });
    expect(offers.status).toBe(200);
    const offerBody = (await offers.json()) as {
      offers: { id: string; offeredModifiers: { kind: string; id: string }[] }[];
    };
    const published = offerBody.offers.find((offer) => offer.id === f.offer.id)!;
    expect(published.offeredModifiers.map((entry) => [entry.kind, entry.id])).toEqual([
      ["extras", f.extrasList.id],
      ["options", f.prepList.id],
    ]);
    expect(published.offeredModifiers[0]).toMatchObject({
      items: [expect.objectContaining({ productId: f.cheese.id, price: "0.35" })],
    });
    const id = randomUUID();
    const parked = await f.app.request("/api/working-orders", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        id,
        lines: [{ menuItemId: f.offer.id, quantity: "2", ...f.answers }],
      }),
    });
    expect(parked.status, await parked.clone().text()).toBe(200);
    const got = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { lines: HeldLine[] };
    expect(body.lines[0]!.optionSnapshots).toEqual(f.optionSnapshots);
    expect(body.lines[0]!.extras).toEqual(f.parkedExtras);
    // 1.75 × 2 dishes = 3.50, plus the published 0.35 × (2 dishes × 2 picks) = 1.40.
    const listed = await f.app.request("/api/working-orders", { headers: f.headers });
    expect(await listed.json()).toContainEqual(expect.objectContaining({ id, total: "4.90" }));

    // A quantity-only edit keeps the frozen answers and re-prices from the stored lock alone.
    const edited = await f.app.request(`/api/working-orders/${id}`, {
      method: "PUT",
      headers: f.headers,
      body: JSON.stringify({
        lines: [
          {
            workingOrderLineId: body.lines[0]!.workingOrderLineId,
            menuItemId: f.offer.id,
            quantity: "4",
            ...f.answers,
          },
        ],
      }),
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const afterEdit = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    const afterEditBody = (await afterEdit.json()) as { lines: HeldLine[] };
    expect(afterEditBody.lines[0]!.optionSnapshots).toEqual(f.optionSnapshots);
    expect(afterEditBody.lines[0]!.extras).toEqual(f.parkedExtras);
    const editedList = await f.app.request("/api/working-orders", { headers: f.headers });
    expect(await editedList.json()).toContainEqual(expect.objectContaining({ id, total: "9.80" }));

    // The parked line holds the six names BY VALUE, so renaming the list and its labels afterwards
    // leaves the order reading exactly what the diner was shown.
    await withTransaction(suite.db, async (tx) => {
      await updateOptionList(
        tx,
        f.prepList.id,
        {
          name: "Nombre nuevo",
          customerName: null,
          kitchenName: null,
          defaultLabelId: null,
          active: true,
          labels: f.prepList.labels.map((label) => ({
            id: label.id,
            name: `${label.name} nuevo`,
            customerName: null,
            kitchenName: null,
            available: label.available,
          })),
        },
        cfg.locale,
      );
    });
    const resumed = await f.app.request(`/api/working-orders/${id}`, { headers: f.headers });
    expect(((await resumed.json()) as { lines: HeldLine[] }).lines[0]!.optionSnapshots).toEqual(
      f.optionSnapshots,
    );
  });

  it("refuses an unpublished list, an unknown list and a withdrawn label through the working-order request", async () => {
    const f = await modifierOfferFixture();
    const park = (line: Record<string, unknown>) =>
      f.app.request("/api/working-orders", {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          id: randomUUID(),
          lines: [{ menuItemId: f.offer.id, quantity: "1", ...f.answers, ...line }],
        }),
      });

    // A list the PRODUCT carries but this offer does not publish is not on offer here.
    const unpublished = await park({
      extras: [
        ...f.answers.extras,
        { listId: f.unpublishedList.id, picks: [{ productId: f.cheese.id, quantity: 1 }] },
      ],
    });
    expect(unpublished.status, await unpublished.clone().text()).toBe(400);
    expect(await unpublished.json()).toMatchObject({
      error: { code: "extras.invalid", params: { field: "listId" } },
    });

    // A list id nothing attaches to this dish at all.
    const unknown = await park({
      options: [{ listId: randomUUID(), labelId: f.frio.id }],
    });
    expect(unknown.status, await unknown.clone().text()).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: "options.invalid", params: { field: "listId" } },
    });

    // A label the list still carries and no longer offers: a till holding a stale menu is refused
    // rather than selling the dish with a withdrawn answer.
    await withTransaction(suite.db, async (tx) => {
      await updateOptionList(
        tx,
        f.prepList.id,
        {
          name: f.prepList.name,
          customerName: f.prepList.customerName,
          kitchenName: f.prepList.kitchenName,
          defaultLabelId: null,
          active: true,
          labels: f.prepList.labels.map((label) => ({
            id: label.id,
            name: label.name,
            customerName: label.customerName,
            kitchenName: label.kitchenName,
            available: label.id !== f.frio.id,
          })),
        },
        cfg.locale,
      );
    });
    const withdrawn = await park({});
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(400);
    expect(await withdrawn.json()).toMatchObject({
      error: { code: "options.label_required", params: { optionListId: f.prepList.id } },
    });
  });

  it("carries extras and options through table opening and a later round", async () => {
    const f = await modifierOfferFixture();
    const [zone] = await suite.db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Modifier tables" })
      .returning({ id: floorZones.id });
    const zoneId = zone!.id;
    const [modifierDepartment] = await suite.db
      .insert(departments)
      .values({
        locationId: cfg.locationId,
        name: "Modifier tables",
        tradingName: "Restaurant",
        defaultServiceMode: "table_tab",
      })
      .returning({ id: departments.id });
    await suite.db.execute(
      sql`insert into zone_service_policies (location_id,zone_id,department_id) values (${cfg.locationId},${zoneId},${modifierDepartment!.id})`,
    );
    await suite.db.execute(
      sql`insert into zone_menus (zone_id,menu_id) values (${zoneId},${aguaProduct.catalogueId})`,
    );
    await suite.db.execute(
      sql`update zone_service_policies set default_menu_id=${aguaProduct.catalogueId} where zone_id=${zoneId}`,
    );
    const table = await f.app.request("/api/tables", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ label: "Modifiers", zoneId }),
    });
    expect(table.status).toBe(200);
    const { id: tableId } = (await table.json()) as { id: string };
    const line = { menuItemId: f.offer.id, quantity: "1", ...f.answers };
    const opened = await f.app.request(`/api/tables/${tableId}/tab`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ lines: [line] }),
    });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { tabId } = (await opened.json()) as { tabId: string };
    const round = await f.app.request(`/api/working-orders/${tabId}/round`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ lines: [line] }),
    });
    expect(round.status, await round.clone().text()).toBe(200);
    const got = await f.app.request(`/api/working-orders/${tabId}`, { headers: f.headers });
    expect(got.status).toBe(200);
    const body = (await got.json()) as { lines: HeldLine[] };
    expect(body.lines.map((line) => line.optionSnapshots)).toEqual([
      f.optionSnapshots,
      f.optionSnapshots,
    ]);
    // Each dish is ONE here, so a pick of two is a child quantity of two on both rounds.
    expect(body.lines.map((line) => line.extras)).toEqual([f.parkedExtras, f.parkedExtras]);
  });
});

describe("canonical modifier checkout refusal", () => {
  it.each(["/api/working-orders", "/api/sales"])(
    "rejects a repeated negative extra pick at %s before any write",
    async (path) => {
      const f = await modifierOfferFixture();
      const id = randomUUID();
      const response = await f.app.request(path, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          id,
          workingOrderId: id,
          lines: [
            {
              menuItemId: f.offer.id,
              quantity: "1",
              options: f.answers.options,
              extras: [
                {
                  listId: f.extrasList.id,
                  picks: [
                    { productId: f.cheese.id, quantity: 2 },
                    { productId: f.cheese.id, quantity: -1 },
                  ],
                },
              ],
            },
          ],
          tender: { method: "cash", amount: "20.00" },
        }),
      });
      expect(response.status, await response.clone().text()).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "extras.invalid", params: { field: "productId" } },
      });
      const stored = await suite.db.execute(sql`select id from working_orders where id=${id}`);
      expect(stored.rows).toEqual([]);
    },
  );
});
