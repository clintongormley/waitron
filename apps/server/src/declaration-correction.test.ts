import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  kitchenCourses,
  kitchenStations,
  persons,
  printJobs,
  products,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import {
  addMember,
  addSetMenuDishes,
  createExtraList,
  createMenu,
  createProduct,
  menuItems,
  requireMenuRoot,
  setMenuVariants,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
  type PatchDraftAnswer,
} from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { AllergyPatch, KitchenAllergyBlock } from "@waitron/module";
import { mountMenuApi } from "./menu-api.js";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups } from "./order-group-submission.js";
import { attachPrinterToStation } from "./station-printers.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { VENUE_SERVICE } from "./modules.js";
import { readDrafts, submitDraft } from "./order-drafts.js";
import { publishWorkingMenu, republishMenus } from "./testing/publish-menu.js";
import { expectedDraftEditForTest, saveDraftForTest } from "./testing/draft-command-fixture.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { printedLines } from "./testing/decode-ticket.js";
import { KITCHEN_ALLERGY_WORDS, ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";
import type { TradingContext } from "./trading-context.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;
let cookie: string;

const guest = { who: "Window guest", allergens: { milk: {} }, note: "Separate pan" };
const corrected: KitchenAllergyBlock = {
  ...guest,
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Milk"], clashes: ["Milk"] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [ALLERGEN_NAMES.milk.es] },
  },
};

beforeEach(async () => {
  await seedPersons(suite.db, { id: OPERATOR, displayName: "Test operator", role: "staff" });
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(and(eq(kitchenStations.isDefault, true)));
  stationId = station!.id;
  cookie = await inTx(v, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Allergy printer",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, { stationId, printerId: printer.id });
    const [admin] = await tx.select().from(persons).where(eq(persons.email, "owner@example.test"));
    const session = await startManagementSession(tx, { method: "password", personId: admin!.id });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mountApp(cfg: "with" | "without" = "with"): Hono {
  const app = new Hono();
  const venueCfg: TradingContext | undefined = cfg === "with" ? v.cfg : undefined;
  mountMenuApi(app, { db: v.db, venueLocale: "es", venueCfg }, () => {});
  return app;
}

type SentLine = Parameters<typeof submitGroups>[3]["groups"][number]["lines"][number];

/** `line` (Burger ×3 unless named) sent to the kitchen at a fresh table: `ticked` for a guest who
 * declared milk, `unticked` with that guest at the table, or `none` with no allergy declared. */
async function sent(
  kind: "ticked" | "unticked" | "none" = "ticked",
  line: SentLine = { menuItemId: v.item("Burger"), quantity: "3" },
) {
  const p = await seat(v, await v.table(`Correction ${randomUUID().slice(0, 8)}`));
  const allergy: AllergyPatch =
    kind === "none"
      ? { party: { answer: "none", guests: [] }, ticks: [] }
      : {
          party: { answer: "allergies", guests: [guest] },
          ticks: [
            {
              line: { kind: "submitted", groupIndex: 0, lineIndex: 0 },
              guestIndex: kind === "ticked" ? 0 : null,
            },
          ],
        };
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, p.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: p.revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, p.tabId),
      groups: [{ release: "fire", lines: [line] }],
      allergy,
    }),
  );
  return p;
}

async function declareMilk(productId = v.productId("Burger")) {
  await inTx(v, (tx) => updateProduct(tx, productId, { allergens: { milk: {} } }));
}

function request(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function liveVersion() {
  const response = await mountApp().request(`/management-api/menus/${v.tables.menuId}/live`, {
    headers: { cookie },
  });
  return (await response.json()) as PatchDraftAnswer;
}

async function patchBurgerDeclarations(app: Hono) {
  const live = await liveVersion();
  return request(app, `/management-api/menus/${v.tables.menuId}/patch`, {
    baseVersionId: live.versionId,
    changes: [
      {
        target: { kind: "offer", menuItemId: v.item("Burger") },
        field: "declarations",
        value: "product",
      },
    ],
    reviewed: live.revision,
  });
}

async function correct(productId = v.productId("Burger")) {
  const response = await request(
    mountApp(),
    `/management-api/products/${productId}/live-declarations`,
    { queued: [] },
  );
  const answer = (await response.json()) as { menus: { menuId: string; name: string }[] };
  expect(response.status, JSON.stringify(answer)).toBe(200);
  return answer;
}

// The station's printer polls the cloud, so a queued slip waits in print_jobs: the table is
// the queue's end point.
const jobs = () => v.db.select().from(printJobs);
const notices = () => inTx(v, (tx) => VENUE_SERVICE.listStationNotices(tx, stationId));
const noticeFacts = async () =>
  (await notices()).map(({ kind, quantity, allergyBlock }) => ({ kind, quantity, allergyBlock }));

async function expectOneSlip(before: readonly unknown[], quantity = "3.000") {
  const after = await jobs();
  expect(after).toHaveLength(before.length + 1);
  const text = printedLines(after.at(-1)!.payload).join("\n");
  expect(text).toContain(KITCHEN_ALLERGY_WORDS.es.changed);
  expect(text).toContain(ALLERGEN_NAMES.milk.es);
  expect(await noticeFacts()).toEqual([
    { kind: "allergy_changed", quantity, allergyBlock: corrected },
  ]);
}

async function expectNoSlip(before: readonly unknown[]) {
  expect(await jobs()).toHaveLength(before.length);
  expect(await notices()).toEqual([]);
}

describe("Update the live menus now", () => {
  it("a dish ticked for a guest who declared milk, sent and not served, gets one correction slip and a kitchen notice when corrected to contain milk", async () => {
    await sent();
    await declareMilk();
    const before = await jobs();
    expect((await correct()).menus).toHaveLength(1);
    await expectOneSlip(before);
  });

  it("the same on a bill already paid whose dish is not served yet", async () => {
    const p = await sent();
    await v.db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, p.tabId));
    await declareMilk();
    const before = await jobs();
    await correct();
    await expectOneSlip(before);
  });

  it("the same correction through Patch live menu prints the slip too", async () => {
    await sent();
    await declareMilk();
    const before = await jobs();
    const response = await patchBurgerDeclarations(mountApp());
    expect(response.status, await response.clone().text()).toBe(200);
    await expectOneSlip(before);
  });

  it("Patch live menu refuses an allergen correction when venueCfg is absent", async () => {
    await sent();
    await declareMilk();
    const before = await jobs();
    const live = await liveVersion();
    expect((await patchBurgerDeclarations(mountApp("without"))).status).toBe(500);
    await expectNoSlip(before);
    expect((await liveVersion()).versionId).toBe(live.versionId);
  });

  it("a guest at the table who is not ticked on the dish gets none", async () => {
    await sent("unticked");
    await declareMilk();
    const before = await jobs();
    await correct();
    await expectNoSlip(before);
  });

  it("a served dish gets none", async () => {
    const p = await sent();
    await v.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000 })
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    await declareMilk();
    const before = await jobs();
    await correct();
    await expectNoSlip(before);
  });

  it("a ticked dish of another product gets none", async () => {
    await sent();
    await declareMilk(v.productId("Flan"));
    const before = await jobs();
    expect((await correct(v.productId("Flan"))).menus).toHaveLength(1);
    await expectNoSlip(before);
  });

  it("a table with no declared allergy gets none", async () => {
    await sent("none");
    await declareMilk();
    const before = await jobs();
    await correct();
    await expectNoSlip(before);
  });

  it("pressing it twice queues one slip", async () => {
    await sent();
    await declareMilk();
    const before = await jobs();
    expect((await correct()).menus).toHaveLength(1);
    expect((await correct()).menus).toEqual([]);
    await expectOneSlip(before);
  });

  it("a correction that takes the allergen back out prints a slip too", async () => {
    await sent();
    await declareMilk();
    await correct();
    const before = await jobs();
    await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: {} }));
    expect((await correct()).menus).toHaveLength(1);
    expect(await jobs()).toHaveLength(before.length + 1);
    expect((await noticeFacts()).at(-1)).toEqual({
      kind: "allergy_changed",
      quantity: "3.000",
      allergyBlock: {
        ...corrected,
        clashes: {},
        labels: {
          en: { ...corrected.labels.en, clashes: [] },
          es: { ...corrected.labels.es, clashes: [] },
        },
      },
    });
  });

  it("the route's failure leaves no slip, no notice and the product saved", async () => {
    await sent();
    await sent();
    await declareMilk();
    const before = await jobs();
    const record = VENUE_SERVICE.recordKitchenNotices.bind(VENUE_SERVICE);
    let queuedBeforeFailure = 0;
    vi.spyOn(VENUE_SERVICE, "recordKitchenNotices")
      .mockImplementationOnce(record)
      .mockImplementationOnce(async (tx) => {
        queuedBeforeFailure = (await tx.select().from(printJobs)).length;
        throw new Error("late failure");
      });
    const response = await request(
      mountApp(),
      `/management-api/products/${v.productId("Burger")}/live-declarations`,
      { queued: [] },
    );
    expect(response.status).toBe(500);
    // The first table's slip was queued in the transaction before the second table's notice failed.
    expect(queuedBeforeFailure).toBe(before.length + 1);
    await expectNoSlip(before);
    const [product] = await v.db
      .select({ allergens: products.allergens })
      .from(products)
      .where(eq(products.id, v.productId("Burger")));
    expect(product!.allergens).toEqual({ milk: {} });
    // The menus were rolled back with the notice: a second press still finds them to correct.
    expect((await correct()).menus).toHaveLength(1);
    expect(await jobs()).toHaveLength(before.length + 2);
  });

  it("the kitchen screen reads the corrected allergen", async () => {
    await sent();
    await declareMilk();
    const asServed = async () =>
      (await inTx(v, (tx) => listStationQueue(tx, stationId)))[0]!.items[0]!.asServed.allergens;
    expect(await asServed()).toEqual({});
    await correct();
    expect(await asServed()).toEqual({ milk: {} });
  });

  it("the route refuses when venueCfg is absent", async () => {
    await sent();
    await declareMilk();
    const before = await jobs();
    const response = await request(
      mountApp("without"),
      `/management-api/products/${v.productId("Burger")}/live-declarations`,
      { queued: [] },
    );
    expect(response.status).toBe(500);
    await expectNoSlip(before);
    expect((await correct()).menus).toHaveLength(1);
  });
});

describe("which product the correction names", () => {
  it("a product held only as an extra on the dish's list corrects the dish it was picked for", async () => {
    const side = await inTx(v, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Side",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "reduced",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Sides",
          minPicks: 0,
          maxPicks: 1,
          items: [{ productId: product.id, maxQuantity: 1, price: "1.00" }],
        },
        v.cfg.locale,
      );
      await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
      await republishMenus(tx);
      return { productId: product.id, listId: list.id };
    });
    await sent("ticked", {
      menuItemId: v.item("Burger"),
      quantity: "3",
      extras: [{ listId: side.listId, picks: [{ productId: side.productId, quantity: 1 }] }],
    });
    await declareMilk(side.productId);
    const before = await jobs();
    expect((await correct(side.productId)).menus).toHaveLength(1);
    await expectOneSlip(before);
  });

  it("a variant of the corrected product gets the slip", async () => {
    const variantId = await inTx(v, async (tx) => {
      const [double] = await setProductVariants(
        tx,
        v.productId("Burger"),
        [
          {
            name: "Double",
            customerName: null,
            kitchenName: "DBL",
            image: null,
            unitPrice: "14.00",
            available: true,
          },
        ],
        v.cfg.locale,
      );
      await setMenuVariants(tx, v.item("Burger"), [{ variantId: double!.id, price: "14.00" }]);
      await publishWorkingMenu(tx, v.tables.menuId);
      return double!.id;
    });
    await sent("ticked", { menuItemId: v.item("Burger"), variantId, quantity: "3" });
    await declareMilk();
    const before = await jobs();
    expect((await correct()).menus).toHaveLength(1);
    await expectOneSlip(before);
  });

  it("a set-menu dish gets the slip", async () => {
    const lunch = await inTx(v, async (tx) => {
      const [course] = await tx
        .insert(kitchenCourses)
        .values({ name: "Main", displayOrder: 10 })
        .returning({ id: kitchenCourses.id });
      await tx
        .update(products)
        .set({ courseId: course!.id })
        .where(eq(products.id, v.productId("Burger")));
      const { id: menuId } = await createMenu(tx, {
        kind: "set_menu",
        name: "Lunch",
        setPrice: "14.00",
      });
      await addSetMenuDishes(tx, menuId, [
        { productId: v.productId("Burger"), excludedVariantIds: [] },
      ]);
      await addMember(tx, await requireMenuRoot(tx, v.tables.menuId), {
        kind: "set_menu",
        menuId,
      });
      const [item] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, v.productId("Burger"))));
      return { menuId, itemId: item!.id, versionId: await publishWorkingMenu(tx, v.tables.menuId) };
    });
    const p = await seat(v, await v.table("Set menu table"));
    const saved = await inTx(v, (tx) =>
      saveDraftForTest(tx, p.partyId, OPERATOR, {
        billId: p.tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: lunch.itemId,
            menuVersionId: lunch.versionId,
            setMenuId: lunch.menuId,
            quantity: "1",
          },
        ],
      }),
    );
    const command = await commandFor(v, p.partyId);
    await inTx(v, async (tx) => {
      const draft = (await readDrafts(tx, p.partyId)).find(({ id }) => id === saved.id)!;
      return submitDraft(tx, v.cfg, p.partyId, draft.id, {
        ...command,
        submissionId: randomUUID(),
        expectedEdit: await expectedDraftEditForTest(tx, draft),
        draftRevision: draft.revision,
        groups: [{ lineIds: draft.lines.map(({ id }) => id), release: "fire" }],
        allergy: {
          party: { answer: "allergies", guests: [guest] },
          ticks: [{ line: { kind: "draft", id: draft.lines[0]!.id }, guestIndex: 0 }],
        },
      });
    });
    await declareMilk();
    const before = await jobs();
    expect((await correct()).menus).toHaveLength(1);
    await expectOneSlip(before, "1.000");
  });
});
