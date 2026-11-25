import { fixturePinHash } from "./known-secret-hashes.js";
import type { TradingContext } from "../trading-context.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedDeviceProfiles, seedZone } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./trading-admission.js";
import { observedGroupSubmitBody } from "./group-submit-fixture.js";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { departments, setRoutingCell } from "@waitron/venue-service";
import { endSession, loginWithPin } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import {
  assignMenuToVenue,
  createMenu,
  createCategory,
  addProductToMenu,
  createProduct,
} from "@waitron/menu";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Logger, LogLevel } from "../logger.js";
import type { TillApiDeps } from "../till-api-deps.js";
import { enrolDeviceForTest } from "./enrol.js";
import { seedLegacySellingUnits } from "./seed-units.js";
import { publishWorkingMenu } from "./publish-menu.js";
import { DEVICE_COOKIE } from "../device-session.js";
import "../errors.js";

/** Sends `lines` to a seated party's tab as one group released now, at the party's current revision. */
export async function sendRound(
  app: Hono,
  headers: Record<string, string>,
  partyId: string,
  lines: unknown[],
): Promise<Response> {
  const read = await app.request(`/api/parties/${partyId}/groups`, { headers });
  const { revision } = (await read.json()) as { revision: number };
  return app.request(`/api/parties/${partyId}/groups`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(
      await observedGroupSubmitBody(suite.db, `/api/parties/${partyId}/groups`, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        groups: [{ lines, release: "fire" }],
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      }),
    ),
  });
}

export let cfg: TradingContext;

export let anna: { id: string };

// The pre-login roster fixtures: `abel` is a second ACTIVE person whose name sorts BEFORE "Anna" but
// is inserted AFTER it, so `[abel, anna]` proves `listActiveStaff` sorts by name rather than by
// insertion order; `zoe` is SUSPENDED, so its absence proves the `status = 'active'` filter. The
// taxpayer's tax_id is generated (a fresh NIF each run), so `GET /api/till`'s `nif` is asserted against
// the value read back here, not a hardcoded one.
export let abel: { id: string };

export let venueTaxId: string;

// The one product seeded into the venue's DEFAULT menu.
export let waterProduct: { id: string; menuId: string };

export let eachUnit: {
  id: string;
  name: Record<string, string>;
  precision: number;
  hardwareUnit: string | null;
};

export let beerProduct: { id: string; menuId: string };

export let counterZoneId: string;

export let waterOfferId: string;

export let hiddenWaterOfferId: string;

export let hiddenMenuId: string;

// An enrolled `till` device's cookie, which a happy-path place/sale call carries to reach the
// route body.
export let sessionDeviceCookie: string;

// The device `openSession` opens Anna's shift on: at the venue, allowed every capability.
export let sessionDeviceId: string;

export const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTaxpayer(db);
    await seedLegacySellingUnits(db);
    // `seedTaxpayer` sets legal_name = 'Test SL' and a generated tax_id; read the tax_id back so the
    // `GET /api/till` assertion can pin the exact NIF the route must echo.
    const taxpayer = await db.execute<{ tax_id: string }>(
      sql`select tax_id from taxpayer where id = 1`,
    );
    venueTaxId = taxpayer.rows[0]!.tax_id;
    // The products are authored under the BARE `es` key; `priceOrderLines` re-keys their
    // descriptions to the venue's `es-ES` before the working-order-line insert fires
    // `check_locales`, which demands the keys match EXACTLY.
    await seedVenue(db, {
      name: "Counter",
      invoiceLocales: ["es-ES"],
    });
    // A default kitchen station so the place route's fire (placeOrder → fireLines) has a fallback.
    const defaultStationId = await seedKitchenStation(db, {});
    // Working orders reference the node that writes them.
    // (its FK `(node_id) → nodes(id)` requires a real row).
    const nodeId = await seedNode(db);
    const [person] = await seedPersons(db, {
      displayName: "Anna",
      pinHash: fixturePinHash("5555"),
      role: "staff",
    });
    anna = { id: person!.id };
    // Abel: ACTIVE, inserted after Anna but sorts before her. Zoe: SUSPENDED, must be excluded.
    const [abelRow] = await seedPersons(db, {
      displayName: "Abel",
      pinHash: fixturePinHash("1111"),
      role: "staff",
    });
    abel = { id: abelRow!.id };
    await seedPersons(db, {
      displayName: "Zoe",
      pinHash: fixturePinHash("2222"),
      role: "staff",
      status: "suspended",
    });
    const { water, beer, zoneId, offerId, hiddenOfferId, staffMenuId } = await withTransaction(
      db,
      async (tx) => {
        const cat = await createMenu(tx, { name: "Daily menu" });
        const drinksCategory = await createCategory(tx, { name: "Drinks" });
        const p = await createProduct(tx, {
          categoryId: drinksCategory.id,
          name: "Agua mineral",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
          allergens: { sulphites: {} },
        });
        await assignMenuToVenue(tx, cat.id);

        const cat2 = await createMenu(tx, { name: "Happy Hour" });
        const p2 = await createProduct(tx, {
          categoryId: drinksCategory.id,
          name: "Cerveza",
          pricingUnit: "each",
          unitPrice: "2.50",
          vatClass: "general",
        });

        const [department] = await tx
          .insert(departments)
          .values({
            name: "Restaurant",
            tradingName: "Restaurant",
          })
          .returning({ id: departments.id });
        const zone = await seedZone(tx, { name: "Counter" });
        await tx.execute(
          sql`update floor_zones set department_id = ${department!.id}, is_counter_default = true where id = ${zone!.id}`,
        );
        await tx.execute(sql`
        update departments set order_start = 'counter' where id = ${department!.id}`);
        await tx.execute(
          sql`update floor_zones set order_start = 'counter' where id = ${zone!.id}`,
        );
        await offerMenuThroughZone(tx, zone!.id, cat.id, { makeDefault: true });
        const offer = await addProductToMenu(tx, {
          menuId: cat.id,
          productId: p.id,
          grossPrice: "1.75",
        });
        await setRoutingCell(
          tx,
          { row: { kind: "product", productId: p.id }, zoneId: null },
          { kind: "station", stationId: defaultStationId },
        );

        const hiddenMenu = await createMenu(tx, { name: "Staff" });
        const hiddenOffer = await addProductToMenu(tx, {
          menuId: hiddenMenu.id,
          productId: p.id,
          grossPrice: "0.50",
        });
        await publishWorkingMenu(tx, cat.id);
        await publishWorkingMenu(tx, hiddenMenu.id);

        return {
          water: { ...p, menuId: cat.id },
          beer: { ...p2, menuId: cat2.id },
          zoneId: zone!.id,
          offerId: offer.id,
          hiddenOfferId: hiddenOffer.id,
          staffMenuId: hiddenMenu.id,
        };
      },
    );
    waterProduct = { id: water.id, menuId: water.menuId };
    beerProduct = { id: beer.id, menuId: beer.menuId };
    eachUnit = { ...water.unit, hardwareUnit: null };
    counterZoneId = zoneId;
    waterOfferId = offerId;
    hiddenWaterOfferId = hiddenOfferId;
    hiddenMenuId = staffMenuId;
    cfg = makeCfg(nodeId);
    const sessionProfile = await seedDeviceProfile(db, "Session device profile", [
      ...CAPABILITY_FLAGS,
    ]);
    const sessionDevice = await enrolTillDevice(db, sessionProfile);
    sessionDeviceId = sessionDevice.deviceId;
    sessionDeviceCookie = sessionDevice.cookie;
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
export function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

function makeCfg(nodeId: string): TradingContext {
  return {
    nodeId: brandNodeId(nodeId),
    locale: "es-ES",
    simplifiedInvoiceLimit: null,
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

export function deps(db: Database): TillApiDeps {
  return {
    admission: testTradingAdmission(),
    db,
    // Only the clock check: every sale this suite makes is refused before it reaches filing.
    backend: {
      refuseUntilRecordable: async () => {},
      refuseNewIssuance: async () => {},
    } as Partial<FiscalBackend> as FiscalBackend,
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

/** Opens a real shift session for Anna — the same `withTransaction` + `loginWithPin` path the login
 * route runs — and returns its cookie token, so a test can hand `requireSession` or the logout
 * route a cookie that names a genuine row. */
export async function openSession(
  db: Database,
  deviceId: string = sessionDeviceId,
): Promise<string> {
  const session = await withTransaction(db, async (tx) => {
    return loginWithPin(tx, {
      deviceId,
      personId: anna.id,
      pin: "5555",
    });
  });
  return session.token;
}

/** Ends a session out of band, so a cookie can be made to name a CLOSED row. */
export async function closeSession(db: Database, token: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await endSession(tx, token);
  });
}

/** Enrol a `till` device via join-and-accept, optionally bound to a `deviceProfileId`, and return
 * the `${DEVICE_COOKIE}=…` header value it carries. `GET /api/till` resolves the canvas and
 * capabilities through that profile. */
let tillDeviceCounter = 0;

export async function enrolTillDeviceCookie(
  db: Database,
  deviceProfileId: string | null = null,
): Promise<string> {
  return (await enrolTillDevice(db, deviceProfileId)).cookie;
}

export async function enrolTillDevice(
  db: Database,
  deviceProfileId: string | null = null,
): Promise<{ deviceId: string; cookie: string }> {
  tillDeviceCounter += 1;
  const profileId =
    deviceProfileId ?? (await seedDeviceProfile(db, `Till profile ${tillDeviceCounter}`, []));
  const dev = await enrolDeviceForTest(db, cfg, {
    name: `Counter till ${tillDeviceCounter}`,
    profileId,
  });
  return { deviceId: dev.deviceId, cookie: `${DEVICE_COOKIE}=${dev.deviceId}.${dev.token}` };
}

export async function seedDeviceProfile(
  db: Database,
  name: string,
  capabilities: string[],
  inactivityTimeoutSeconds: number | null = null,
): Promise<string> {
  const rows = await withTransaction(db, async (tx) => {
    // Through the table definition, not raw SQL: `device_profiles.id` is a `$defaultFn` generator,
    // which a raw insert never runs.
    return seedDeviceProfiles(tx, {
      name,
      formFactor: "till",
      capabilities,
      inactivityTimeoutSeconds,
    });
  });
  return rows[0]!.id;
}
