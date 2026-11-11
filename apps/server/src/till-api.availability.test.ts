import { Hono } from "hono";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { eq } from "drizzle-orm";
import { requireSession } from "./till-session.js";
import * as tillSession from "./till-session.js";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createProduct, setProductVariants } from "@waitron/catalogue";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { mountTillApi } from "./till-api.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { send } from "./testing/bill-venue.js";
import { VENUE_SERVICE } from "./modules.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue, app: Hono, cookie: string, productId: string, variantId: string;
const path = () => `/api/service-zones/${v.counter.zoneId}/products/${productId}/availability`;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  productId = v.productId("Burger");
  const token = await withTransaction(suite.db, async (tx) => {
    const variants = await setProductVariants(
      tx,
      productId,
      [
        {
          name: "Small",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "8.00",
          available: false,
        },
      ],
      "es",
    );
    variantId = variants[0]!.id;
    await publishWorkingMenu(tx, v.counter.menuId);
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Waiter", role: "staff", pinHash: hashPin("5555") })
      .returning();
    const session = await loginWithPin(tx, {
      deviceId: v.cfg.origin.deviceId,
      personId: staff!.id,
      pin: "5555",
    });
    return session.token;
  });
  cookie = await sessionCookieForTest(suite.db, token);
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      venueLocale: "es-ES",
      secureCookies: false,
      admission: testTradingAdmission(),
    },
    () => {},
  );
});
it("lets staff stop and restore a dish across menus without restoring its sold-out variant", async () => {
  for (const available of [false, true]) {
    expect(await send(app, cookie, "PUT", path(), { available })).toEqual({
      status: 200,
      json: { available },
    });
    for (const zoneId of [v.counter.zoneId, v.tables.zoneId]) {
      const { offers } = await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listZoneOffers(tx, zoneId),
      );
      const offer = offers.find((o) => o.productId === productId)!;
      expect(offer.available).toBe(available);
      expect(offer.variants.find((v) => v.id === variantId)!.available).toBe(false);
    }
  }
  expect(
    await send(app, cookie, "PUT", path().replace(productId, variantId), { available: true }),
  ).toEqual({ status: 200, json: { available: true } });
});
it.each([{}, { available: null }, { available: "true" }])(
  "refuses a body without an explicit boolean: %j",
  async (body) => {
    const answer = await send(app, cookie, "PUT", path(), body);
    expect(answer.status).toBe(400);
    expect(answer.json.code).toBe("product.invalid");
  },
);
it("requires a signed-in person", async () => {
  const answer = await send(app, "", "PUT", path(), { available: false });
  expect(answer.json.code).toBe("session.required");
});
it("refuses an existing product outside the zone's published offer", async () => {
  const outsider = await withTransaction(suite.db, (tx) =>
    createProduct(tx, {
      catalogueId: v.counter.menuId,
      name: "Unpublished soup",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "reduced",
    }),
  );
  const answer = await send(app, cookie, "PUT", path().replace(productId, outsider.id), {
    available: false,
  });
  expect(answer.status).toBe(404);
  expect(answer.json.code).toBe("product.not_found");
});

it("rechecks take-orders after the signed-in device's profile changes", async () => {
  const original = requireSession;
  const spy = vi.spyOn(tillSession, "requireSession").mockImplementation(async (...args) => {
    const session = await original(...args);
    await withTransaction(suite.db, (tx) =>
      tx
        .update(deviceProfiles)
        .set({ capabilities: [] })
        .where(eq(deviceProfiles.id, session.device.deviceProfileId)),
    );
    return session;
  });
  onTestFinished(() => spy.mockRestore());
  const answer = await send(app, cookie, "PUT", path(), { available: false });
  expect(answer.status).toBe(403);
  expect(answer.json.code).toBe("device.forbidden_action");
});
