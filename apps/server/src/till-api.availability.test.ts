import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { eq } from "drizzle-orm";
import { requireSession } from "./till-session.js";
import * as tillSession from "./till-session.js";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createExtraList,
  createOptionList,
  createProduct,
  getOptionList,
  setProductVariants,
  updateOptionList,
  writeProductModifiers,
} from "@waitron/menu";
import { hashPin, loginWithPin } from "@waitron/identity";
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
      catalogueId: v.counter.menuId,
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
      pinHash: hashPin("5555"),
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
it("stops and restores a published extra that is not itself a dish", async () => {
  for (const available of [false, true]) {
    expect(
      await send(app, cookie, "PUT", path().replace(productId, extraId), { available }),
    ).toEqual({ status: 200, json: { available } });
    for (const zoneId of [v.counter.zoneId, v.tables.zoneId]) {
      const { offers } = await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listZoneOffers(tx, zoneId),
      );
      expect(offers.some((offer) => offer.productId === extraId)).toBe(false);
      const extras = offers
        .find((offer) => offer.productId === productId)!
        .offeredModifiers.find((modifier) => modifier.kind === "extras")!;
      expect(extras.items.find((item) => item.productId === extraId)!.available).toBe(available);
    }
  }
});
it("stops and restores a published choice from either zone without replacing its stored default", async () => {
  for (const [zoneId, available] of [
    [v.counter.zoneId, false],
    [v.tables.zoneId, true],
  ] as const) {
    expect(await send(app, cookie, "PUT", optionPath(zoneId), { available })).toEqual({
      status: 200,
      json: { available },
    });
    for (const readZone of [v.counter.zoneId, v.tables.zoneId]) {
      const { offers } = await withTransaction(suite.db, (tx) =>
        VENUE_SERVICE.listZoneOffers(tx, readZone),
      );
      const options = offers
        .find((offer) => offer.productId === productId)!
        .offeredModifiers.find((modifier) => modifier.kind === "options")!;
      expect(options.labels.find((label) => label.id === labelId)!.available).toBe(available);
    }
    expect(
      (await withTransaction(suite.db, (tx) => getOptionList(tx, listId))).defaultLabelId,
    ).toBe(labelId);
  }
});
it("refuses an option availability body without an explicit boolean", async () => {
  expect(await send(app, cookie, "PUT", optionPath(), { available: null })).toMatchObject({
    status: 400,
    json: { code: "options.invalid", params: { field: "available" } },
  });
});
it("refuses a stored option list not published in the requested zone", async () => {
  const outside = await withTransaction(suite.db, (tx) =>
    createOptionList(tx, { name: "Unused", labels: [{ name: "Plain" }] }, "es"),
  );
  const answer = await send(
    app,
    cookie,
    "PUT",
    optionPath().replace(listId, outside.id).replace(labelId, outside.labels[0]!.id),
    { available: false },
  );
  expect(answer).toMatchObject({ status: 404, json: { code: "options.not_found" } });
  expect(await withTransaction(suite.db, (tx) => getOptionList(tx, outside.id))).toEqual(outside);
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

it("refuses a choice added to the stored list after the menu was published", async () => {
  const stored = await withTransaction(suite.db, async (tx) => {
    const { id, ...current } = await getOptionList(tx, listId);
    return updateOptionList(
      tx,
      id,
      { ...current, labels: [...current.labels, { name: "New choice" }] },
      "es",
    );
  });
  const unpublished = stored.labels.at(-1)!;
  const answer = await send(app, cookie, "PUT", optionPath().replace(labelId, unpublished.id), {
    available: false,
  });
  expect(answer).toMatchObject({ status: 404, json: { code: "options.not_found" } });
  expect(await withTransaction(suite.db, (tx) => getOptionList(tx, listId))).toEqual(stored);
});

it("refuses the last published choice after its stored list is disabled", async () => {
  const stored = await withTransaction(suite.db, async (tx) => {
    const { id, ...current } = await getOptionList(tx, listId);
    return updateOptionList(tx, id, { ...current, active: false }, "es");
  });
  expect((await send(app, cookie, "PUT", optionPath(), { available: false })).status).toBe(200);
  const answer = await send(
    app,
    cookie,
    "PUT",
    optionPath().replace(labelId, stored.labels[1]!.id),
    { available: false },
  );
  expect(answer).toMatchObject({
    status: 400,
    json: { code: "options.invalid", params: { field: "labels" } },
  });
});
