import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createExtraList,
  createOptionList,
  createProduct,
  setProductVariants,
  writeProductModifiers,
} from "@waitron/menu";
import { loginWithPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { mountMenuApi } from "./menu-api.js";
import { mountTillApi } from "./till-api.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { send } from "./testing/bill-venue.js";
import { VENUE_SERVICE } from "./modules.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue, app: Hono, cookie: string, productId: string, variantId: string;
let extraId: string, listId: string, labelId: string;
const path = () => `/api/service-zones/${v.counter.zoneId}/products/${productId}/availability`;
const optionPath = (zoneId = v.counter.zoneId) =>
  `/api/service-zones/${zoneId}/options/${listId}/labels/${labelId}/availability`;
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
    const extra = await createProduct(tx, {
      name: "Bacon",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "reduced",
    });
    extraId = extra.id;
    const extras = await createExtraList(
      tx,
      { name: "Toppings", items: [{ productId: extraId }] },
      "es",
    );
    const options = await createOptionList(
      tx,
      { name: "Cooking", labels: [{ name: "Medium" }, { name: "Well done" }] },
      "es",
    );
    listId = options.id;
    labelId = options.labels[0]!.id;
    await writeProductModifiers(tx, productId, [
      { kind: "extras", id: extras.id },
      { kind: "options", id: listId },
    ]);
    await publishWorkingMenu(tx, v.counter.menuId);
    const [staff] = await seedPersons(tx, {
      displayName: "Waiter",
      role: "staff",
      pinHash: fixturePinHash("5555"),
    });
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
it.each([
  ["dishes", path],
  ["option choices", optionPath],
] as const)("offers no till route to change availability for %s", async (_kind, route) => {
  const answer = await send(app, cookie, "PUT", route(), { available: false });
  expect(answer.status).toBe(404);
});

it("applies dashboard product availability immediately to both published till zones", async () => {
  const manager = await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: "Menu Manager", role: "manager" });
    return startManagementSession(tx, { personId: person!.id, method: "password" });
  });
  mountMenuApi(app, { db: suite.db, venueLocale: "es-ES" }, () => {});

  async function expectOffers(
    productAvailable: boolean,
    variantAvailable: boolean,
    extraAvailable: boolean,
  ) {
    for (const zoneId of [v.counter.zoneId, v.tables.zoneId]) {
      const { offers } = await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listZoneOffers(tx, zoneId),
      );
      const offer = offers.find((entry) => entry.productId === productId);
      expect(offer).toMatchObject({ unitPrice: "12.00", available: productAvailable });
      expect(offer?.variants.find((variant) => variant.id === variantId)).toMatchObject({
        unitPrice: "8.00",
        available: variantAvailable,
      });
      expect(offers.some((entry) => entry.productId === extraId)).toBe(false);
      const extras = offer?.offeredModifiers.find((modifier) => modifier.kind === "extras");
      expect(extras?.items.find((item) => item.productId === extraId)?.available).toBe(
        extraAvailable,
      );
    }
  }

  await expectOffers(true, false, true);
  const changes = [
    { productIds: [variantId], available: true, expected: [true, true, true] },
    { productIds: [productId, extraId], available: false, expected: [false, true, false] },
    { productIds: [productId], available: true, expected: [true, true, false] },
    { productIds: [productId, variantId], available: false, expected: [false, false, false] },
    { productIds: [variantId, extraId], available: true, expected: [false, true, true] },
  ] as const;
  for (const [index, { productIds, available, expected }] of changes.entries()) {
    const response = await app.request("/management-api/products/availability", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `${MANAGEMENT_COOKIE}=${manager.token}`,
      },
      body: JSON.stringify({ productIds, available }),
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(JSON.parse(response.headers.get("x-waitron-menu-revision")!)).toEqual({
      epoch: expect.any(String),
      sequence: index + 1,
    });
    await expectOffers(...expected);
  }
});
