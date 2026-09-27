import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  locations,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  serviceCommands,
  ticketItems,
  tills,
  visits,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  setMenuVariants,
  setProductVariants,
  writeProductModifiers,
} from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse } from "./kitchen.js";
import { createTable } from "./tables.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { seatTable } from "./visits.js";
import { listTablesWithState } from "./working-order.js";
import { readDrafts, saveDraft, takeOverDraft } from "./order-drafts.js";
import type { Draft, DraftLine } from "./order-drafts.js";
import "./errors.js";

const LOCALE = "es-ES";
const ALEX = "cccccccc-0000-4000-8000-00000000000a";
const SAM = "cccccccc-0000-4000-8000-00000000000b";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);

/** Each dish's three names differ, so a read showing the wrong one would show the wrong text. */
const DISHES = {
  beer: { staff: "Beer tap", customer: "Draught beer", kitchen: "K-BEER", price: "3.00" },
  burger: { staff: "Burger", customer: "House burger", kitchen: "K-BURG", price: "12.00" },
  fish: { staff: "Fish", customer: "Catch of the day", kitchen: "K-FISH", price: "18.00" },
  wine: { staff: "Wine", customer: "House red", kitchen: "K-WINE", price: "4.00" },
  sauce: { staff: "Pepper sc", customer: "Pepper sauce", kitchen: "K-PEPPER", price: "1.50" },
} as const;
type Dish = keyof typeof DISHES;

interface Venue {
  cfg: TillConfig;
  productId: Record<Dish, string>;
  courseId: string;
  sauceListId: string;
  /** The Wine's variants: the menu offers the glass and not the bottle. */
  glass: string;
  bottle: string;
  offer(dish: Dish): string;
  zoneId: string;
}

async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const [location] = await db
    .insert(locations)
    .values({ name: "Sala", invoiceLocales: [LOCALE], operationDescription: "Restaurante" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  await db.insert(persons).values([
    { id: ALEX, displayName: "Alex" },
    { id: SAM, displayName: "Sam" },
  ]);
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: { en: "Platos" } });
    const { id: courseId } = await createCourse(tx, cfg, { name: "Mains", displayOrder: 1 });
    const productId = {} as Record<Dish, string>;
    for (const [dish, names] of Object.entries(DISHES) as [Dish, (typeof DISHES)[Dish]][]) {
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: names.staff,
        customerName: { en: names.customer },
        kitchenName: names.kitchen,
        pricingUnit: "each",
        unitPrice: names.price,
        vatClass: "general",
      });
      productId[dish] = product.id;
    }
    const sauces = await createExtraList(
      tx,
      {
        name: "Sauces",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: productId.sauce, maxQuantity: 1, preselected: false, price: "1.50" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, productId.burger, [{ kind: "extras", id: sauces.id }]);
    const [glass, bottle] = await setProductVariants(
      tx,
      productId.wine,
      [
        {
          name: "Glass",
          customerName: { es: "Copa de tinto" },
          kitchenName: "K-GLASS",
          image: null,
          unitPrice: "4.00",
          available: true,
        },
        {
          name: "Bottle",
          customerName: { es: "Botella de tinto" },
          kitchenName: "K-BOTTLE",
          image: null,
          unitPrice: "18.00",
          available: true,
        },
      ],
      LOCALE,
    );
    await assignCatalogueToLocation(tx, locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    await setMenuVariants(tx, offers.offerFor(productId.wine), [
      { variantId: glass!.id, price: "4.00", offered: true },
      { variantId: bottle!.id, price: "18.00", offered: false },
    ]);
    await publishWorkingMenu(tx, offers.menuId);
    return {
      cfg,
      productId,
      courseId,
      sauceListId: sauces.id,
      glass: glass!.id,
      bottle: bottle!.id,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
    };
  });
}

interface Seated {
  visitId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue, label = "Mesa 4"): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, { label, zoneId: v.zoneId });
    const { visitId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 4,
      operatorId: ALEX,
    });
    return { visitId, tabId, tableId };
  });
}

type LineInput = Omit<DraftLine, "id" | "unavailable">;

function item(v: Venue, dish: Dish, overrides: Partial<LineInput> = {}): LineInput {
  return {
    menuItemId: v.offer(dish),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
    ...overrides,
  };
}

async function save(
  v: Venue,
  visitId: string,
  operatorId: string,
  draftId: string | null,
  revision: number,
  lines: unknown[],
): Promise<Draft> {
  return inTx((tx) =>
    saveDraft(tx, v.cfg, visitId, operatorId, { draftId, revision, lines: lines as LineInput[] }),
  );
}

async function takeOver(v: Venue, draftId: string, operatorId: string, revision: number) {
  return inTx((tx) => takeOverDraft(tx, v.cfg, draftId, operatorId, revision));
}

async function draftsOf(v: Venue, visitId: string): Promise<Draft[]> {
  return inTx((tx) => readDrafts(tx, v.cfg, visitId));
}

/** What each line orders, without the ids a save mints. */
const orders = (draft: Draft) =>
  draft.lines.map(({ menuItemId, quantity, unavailable }) => ({
    menuItemId,
    quantity,
    unavailable,
  }));

async function storedLines(draftId: string) {
  return db
    .select()
    .from(orderDraftLines)
    .where(eq(orderDraftLines.draftId, draftId))
    .orderBy(asc(orderDraftLines.position));
}

async function draftRow(draftId: string) {
  const [row] = await db.select().from(orderDrafts).where(eq(orderDrafts.id, draftId));
  return row!;
}

async function eventsOf(draftId: string) {
  const rows = await db
    .select({
      kind: orderDraftEvents.kind,
      fromPerson: orderDraftEvents.fromPerson,
      toPerson: orderDraftEvents.toPerson,
      actorId: orderDraftEvents.actorId,
      detail: orderDraftEvents.detail,
      createdAt: orderDraftEvents.createdAt,
    })
    .from(orderDraftEvents)
    .where(eq(orderDraftEvents.draftId, draftId));
  // `created_at` can tie within a millisecond; the kinds' own order breaks the tie.
  const order = ["created", "taken_over", "submitted", "discarded"];
  return rows
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || order.indexOf(a.kind) - order.indexOf(b.kind),
    )
    .map(({ kind, fromPerson, toPerson, actorId, detail }) => ({
      kind,
      fromPerson,
      toPerson,
      actorId,
      detail,
    }));
}

async function visitRevision(visitId: string): Promise<number> {
  const [row] = await db
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return row!.revision;
}

async function unsentDraftsAt(v: Venue, tableId: string) {
  const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));
  const unsent = rows.find((row) => row.id === tableId)!.visit!.unsentDrafts;
  return [...unsent].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
}

const byOwner = (drafts: Draft[]) =>
  [...drafts].sort((a, b) => a.ownerName.localeCompare(b.ownerName));

describe("separate drafts (spec §12 item 1)", () => {
  it("keeps Alex's and Sam's drafts apart, refuses Sam's save onto Alex's, and shows each unsent order on the table", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.visitId, ALEX, null, 0, [
      item(v, "beer", { quantity: "2" }),
      item(v, "burger"),
    ]);
    const sam = await save(v, mesa4.visitId, SAM, null, 0, [item(v, "fish")]);

    expect(alex).toMatchObject({ visitId: mesa4.visitId, ownerId: ALEX, ownerName: "Alex" });
    expect(sam).toMatchObject({ visitId: mesa4.visitId, ownerId: SAM, ownerName: "Sam" });
    const drafts = byOwner(await draftsOf(v, mesa4.visitId));
    expect(drafts).toEqual([alex, sam]);
    expect(drafts.map(orders)).toEqual([
      [
        { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
        { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: false },
      ],
      [{ menuItemId: v.offer("fish"), quantity: "1.000", unavailable: false }],
    ]);

    await expect(
      save(v, mesa4.visitId, SAM, alex.id, alex.revision, [item(v, "beer")]),
    ).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { draftId: alex.id, ownerId: ALEX, ownerName: "Alex" },
    });
    expect(byOwner(await draftsOf(v, mesa4.visitId))).toEqual([alex, sam]);

    // Two rows on Alex's draft hold three units: the count is of rows.
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([
      { ownerName: "Alex", lineCount: 2 },
      { ownerName: "Sam", lineCount: 1 },
    ]);
  });

  it("does not show a draft with no lines as an unsent order, nor another party's drafts", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const alex = await save(v, mesa4.visitId, ALEX, null, 0, [item(v, "beer")]);
    await save(v, mesa5.visitId, SAM, null, 0, [item(v, "fish")]);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "Alex", lineCount: 1 }]);

    await save(v, mesa4.visitId, ALEX, alex.id, alex.revision, []);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([]);
    expect(await unsentDraftsAt(v, mesa5.tableId)).toEqual([{ ownerName: "Sam", lineCount: 1 }]);
  });

  it("does not show a draft that is no longer open, even one still holding lines", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.visitId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, alex.id));
    expect(await storedLines(alex.id)).toHaveLength(1);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([]);
    expect(await draftsOf(v, mesa4.visitId)).toEqual([]);
  });
});

describe("saving a draft", () => {
  it("names an owner with no person record as empty text, wherever the name is shown", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const nobody = randomUUID();
    const draft = await save(v, mesa4.visitId, nobody, null, 0, [item(v, "beer")]);
    expect(draft).toMatchObject({ ownerId: nobody, ownerName: "" });
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "", lineCount: 1 }]);
    await expect(save(v, mesa4.visitId, SAM, draft.id, 0, [])).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { draftId: draft.id, ownerId: nobody, ownerName: "" },
    });
  });

  it("creates the operator's draft at revision 0 with a created event", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    expect(draft).toMatchObject({ revision: 0, ownerId: ALEX });
    expect(await eventsOf(draft.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
    ]);
  });

  it("replaces the lines, adds matching ones together (D10), numbers positions in order and bumps the revision", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const first = await save(v, visitId, ALEX, null, 0, [item(v, "fish")]);
    const second = await save(v, visitId, ALEX, first.id, 0, [
      item(v, "beer"),
      item(v, "burger"),
      item(v, "beer"),
    ]);
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(1);
    expect(orders(second)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
      { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: false },
    ]);
    const rows = await storedLines(first.id);
    expect(rows.map(({ id, position, quantity }) => ({ id, position, quantity }))).toEqual([
      { id: second.lines[0]!.id, position: 1, quantity: 2000 },
      { id: second.lines[1]!.id, position: 2, quantity: 1000 },
    ]);
    expect(await eventsOf(first.id)).toHaveLength(1);
  });

  it("stores every field of a line as sent, with the quantity at three places", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const versionId = randomUUID();
    const sent = item(v, "burger", {
      quantity: "1.5",
      note: "  no salt  ",
      courseId: v.courseId,
      menuVersionId: versionId,
      options: [{ listId: randomUUID(), labelId: "rare" }],
      extras: [{ listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
      noMerge: true,
    });
    const draft = await save(v, visitId, ALEX, null, 0, [sent]);
    expect(draft.lines).toEqual([
      {
        ...sent,
        id: draft.lines[0]!.id,
        quantity: "1.500",
        note: "no salt",
        unavailable: false,
      },
    ]);
    expect(await draftsOf(v, visitId)).toEqual([draft]);
  });

  it("stores an empty or blank note as no note, so the line adds into one without a note", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [
      item(v, "beer", { note: null }),
      item(v, "beer", { note: "" }),
      item(v, "beer", { note: "   " }),
    ]);
    expect(draft.lines).toMatchObject([{ note: null, quantity: "3.000" }]);
  });

  it("takes the defaults for fields a line leaves out", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [
      { menuItemId: v.offer("beer"), quantity: "1" },
    ]);
    expect(draft.lines).toEqual([
      {
        id: draft.lines[0]!.id,
        menuItemId: v.offer("beer"),
        variantId: null,
        menuVersionId: null,
        options: [],
        extras: [],
        note: null,
        quantity: "1.000",
        courseId: null,
        noMerge: false,
        unavailable: false,
      },
    ]);
  });

  it("answers draft.out_of_date, writing nothing, to a new draft from an operator who already has one", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    await expect(save(v, visitId, ALEX, null, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: draft.id, revision: 0 },
    });
    expect(await draftsOf(v, visitId)).toEqual([draft]);
  });

  it("answers draft.out_of_date, writing nothing, to a save from a stale revision", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const first = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    const second = await save(v, visitId, ALEX, first.id, 0, [item(v, "fish")]);
    await expect(save(v, visitId, ALEX, first.id, 0, [item(v, "burger")])).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: first.id, revision: 1 },
    });
    expect(await draftsOf(v, visitId)).toEqual([second]);
  });

  it("answers draft.not_found for an unknown draft, a draft of another party and a discarded draft", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const other = await save(v, mesa5.visitId, ALEX, null, 0, [item(v, "beer")]);
    const unknown = randomUUID();
    await expect(save(v, mesa4.visitId, ALEX, unknown, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: unknown },
    });
    await expect(save(v, mesa4.visitId, ALEX, other.id, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: other.id },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, other.id));
    await expect(save(v, mesa5.visitId, ALEX, other.id, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
    });
    expect(await storedLines(other.id)).toHaveLength(1);
  });

  it("answers draft.already_submitted to a save onto a submitted draft", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "submitted" }).where(eq(orderDrafts.id, draft.id));
    await expect(save(v, visitId, ALEX, draft.id, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "draft.already_submitted",
      params: { draftId: draft.id },
    });
    expect((await storedLines(draft.id)).map((row) => row.menuItemId)).toEqual([v.offer("beer")]);
  });

  it("answers visit.not_open to a save on a visit that is not open, or on no visit", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    await db
      .update(visits)
      .set({ state: "needs_clearing", closedAt: new Date().toISOString() })
      .where(eq(visits.id, visitId));
    await expect(save(v, visitId, ALEX, draft.id, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId },
    });
    await expect(save(v, visitId, SAM, null, 0, [])).rejects.toMatchObject({
      code: "visit.not_open",
    });
    const missing = randomUUID();
    await expect(save(v, missing, ALEX, null, 0, [])).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId: missing },
    });
    expect(await draftRow(draft.id)).toMatchObject({ revision: 0, state: "open" });
    expect(await storedLines(draft.id)).toHaveLength(1);
  });
});

describe("a refused save writes nothing", () => {
  const cases: [string, (v: Venue) => unknown, string, string][] = [
    ["lines that are not a list", () => "beer", "management.request_invalid", "lines"],
    ["a line that is not an object", () => ["beer"], "management.request_invalid", "lines.0"],
    ["a line that is null", () => [null], "management.request_invalid", "lines.0"],
    [
      "a line naming no menu item",
      (v) => [{ ...item(v, "beer"), menuItemId: undefined }],
      "management.request_invalid",
      "lines.0.menuItemId",
    ],
    [
      "a menu item that is not an id",
      (v) => [item(v, "beer", { menuItemId: "beer" })],
      "management.request_invalid",
      "lines.0.menuItemId",
    ],
    [
      "a zero quantity",
      (v) => [item(v, "beer", { quantity: "0" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a zero quantity written with places",
      (v) => [item(v, "beer", { quantity: "0.000" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a negative quantity",
      (v) => [item(v, "beer", { quantity: "-1" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a quantity with four places",
      (v) => [item(v, "beer", { quantity: "1.0005" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a quantity with four places, the last a zero",
      (v) => [item(v, "beer", { quantity: "1.5000" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a quantity sent as a number",
      (v) => [{ ...item(v, "beer"), quantity: 1 }],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a quantity in exponent form",
      (v) => [item(v, "beer", { quantity: "1e3" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a quantity of ten integer digits",
      (v) => [item(v, "beer", { quantity: "1000000000" })],
      "management.request_invalid",
      "lines.0.quantity",
    ],
    [
      "a note that is not text",
      (v) => [{ ...item(v, "beer"), note: 5 }],
      "management.request_invalid",
      "lines.0.note",
    ],
    [
      "a variant that is not an id",
      (v) => [item(v, "wine", { variantId: "glass" })],
      "management.request_invalid",
      "lines.0.variantId",
    ],
    [
      "a menu version that is not an id",
      (v) => [item(v, "beer", { menuVersionId: "7" })],
      "management.request_invalid",
      "lines.0.menuVersionId",
    ],
    [
      "a course that is not an id",
      (v) => [item(v, "beer", { courseId: "mains" })],
      "management.request_invalid",
      "lines.0.courseId",
    ],
    [
      "a no-merge flag that is not true or false",
      (v) => [{ ...item(v, "beer"), noMerge: "yes" }],
      "management.request_invalid",
      "lines.0.noMerge",
    ],
    [
      "an explicit null where the options default only on absence",
      (v) => [{ ...item(v, "beer"), options: null }],
      "management.request_invalid",
      "lines.0.options",
    ],
    [
      "an option without a label",
      (v) => [{ ...item(v, "beer"), options: [{ listId: randomUUID() }] }],
      "management.request_invalid",
      "lines.0.options",
    ],
    [
      "an option that is not an object",
      (v) => [{ ...item(v, "beer"), options: ["rare"] }],
      "management.request_invalid",
      "lines.0.options",
    ],
    [
      "an explicit null where the extras default only on absence",
      (v) => [{ ...item(v, "beer"), extras: null }],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras list whose picks are not a list",
      (v) => [{ ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: "sauce" }] }],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras answer that is not an object",
      (v) => [{ ...item(v, "burger"), extras: [v.sauceListId] }],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras pick with no product",
      (v) => [
        { ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: [{ quantity: 1 }] }] },
      ],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras pick that is not an object",
      (v) => [
        { ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: [v.productId.sauce] }] },
      ],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras pick of none",
      (v) => [
        item(v, "burger", {
          extras: [
            { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 0 }] },
          ],
        }),
      ],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "an extras pick of one and a half",
      (v) => [
        item(v, "burger", {
          extras: [
            { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1.5 }] },
          ],
        }),
      ],
      "management.request_invalid",
      "lines.0.extras",
    ],
    [
      "a bad second line after a good first",
      (v) => [item(v, "beer"), item(v, "beer", { quantity: "0" })],
      "management.request_invalid",
      "lines.1.quantity",
    ],
  ];

  it.each(cases)("refuses %s", async (_name, lines, code, field) => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    const refused = lines(v);
    await expect(
      inTx((tx) =>
        saveDraft(tx, v.cfg, visitId, ALEX, {
          draftId: draft.id,
          revision: 0,
          lines: refused as LineInput[],
        }),
      ),
    ).rejects.toMatchObject({ code, params: { field } });
    expect(await storedLines(draft.id)).toEqual(before);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 0 });
  });

  it("refuses a note over the length limit with the basket's own code", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    await expect(
      save(v, visitId, ALEX, draft.id, 0, [item(v, "beer", { note: "x".repeat(201) })]),
    ).rejects.toMatchObject({ code: "working_order.note_too_long" });
    expect(await storedLines(draft.id)).toEqual(before);
  });

  it("refuses a course that does not exist with course.not_found", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    const courseId = randomUUID();
    await expect(
      save(v, visitId, ALEX, draft.id, 0, [item(v, "beer", { courseId })]),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId } });
    expect(await storedLines(draft.id)).toEqual(before);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 0 });
  });

  it("creates no draft when the first save is refused", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    await expect(
      save(v, visitId, ALEX, null, 0, [item(v, "beer", { quantity: "0" })]),
    ).rejects.toMatchObject({ code: "management.request_invalid" });
    expect(await db.select().from(orderDrafts).where(eq(orderDrafts.visitId, visitId))).toEqual([]);
  });
});

describe("taking over a draft (D5, spec §2)", () => {
  it("gives Sam Alex's Beer, adds Sam's Beer into it, and refuses Alex's next save", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.visitId, ALEX, null, 0, [item(v, "beer")]);

    const taken = await takeOver(v, alex.id, SAM, 0);
    expect(taken).toMatchObject({ id: alex.id, ownerId: SAM, ownerName: "Sam", revision: 1 });
    expect(taken.lines).toEqual(alex.lines);

    const sams = await save(v, mesa4.visitId, SAM, alex.id, 1, [...taken.lines, item(v, "beer")]);
    expect(sams).toMatchObject({ id: alex.id, ownerId: SAM, revision: 2 });
    expect(orders(sams)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
    ]);

    await expect(save(v, mesa4.visitId, ALEX, alex.id, 2, [])).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { draftId: alex.id, ownerId: SAM, ownerName: "Sam" },
    });
    expect(await eventsOf(alex.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
      { kind: "taken_over", fromPerson: ALEX, toPerson: SAM, actorId: SAM, detail: {} },
    ]);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "Sam", lineCount: 1 }]);
  });

  it("answers draft.out_of_date, writing nothing, to a takeover from a stale revision", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const first = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    const second = await save(v, visitId, ALEX, first.id, 0, [item(v, "fish")]);
    await expect(takeOver(v, first.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: first.id, revision: 1 },
    });
    expect(await draftsOf(v, visitId)).toEqual([second]);
    expect(await eventsOf(first.id)).toHaveLength(1);
  });

  it("answers draft.not_found for an unknown or discarded draft, and draft.already_submitted for a submitted one", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const unknown = randomUUID();
    await expect(takeOver(v, unknown, SAM, 0)).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: unknown },
    });
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "submitted" }).where(eq(orderDrafts.id, draft.id));
    await expect(takeOver(v, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.already_submitted",
      params: { draftId: draft.id },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draft.id));
    await expect(takeOver(v, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.not_found",
    });
    expect(await draftRow(draft.id)).toMatchObject({ ownerId: ALEX, revision: 0 });
    expect(await eventsOf(draft.id)).toHaveLength(1);
  });

  it("answers visit.not_open to a takeover on a visit that is not open", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    await db
      .update(visits)
      .set({ state: "needs_clearing", closedAt: new Date().toISOString() })
      .where(eq(visits.id, visitId));
    await expect(takeOver(v, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId },
    });
    expect(await draftRow(draft.id)).toMatchObject({ ownerId: ALEX, revision: 0 });
  });

  it("answers a takeover of your own draft with the draft as it is, writing nothing", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const first = await save(v, visitId, ALEX, null, 0, [item(v, "beer")]);
    const draft = await save(v, visitId, ALEX, first.id, 0, [item(v, "fish")]);
    expect(await takeOver(v, draft.id, ALEX, 0)).toEqual(draft);
    expect(await takeOver(v, draft.id, ALEX, 1)).toEqual(draft);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 1, ownerId: ALEX });
    expect(await eventsOf(draft.id)).toHaveLength(1);
  });

  it("adds a taken draft into the taker's own open draft and discards it, so no one holds two", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.visitId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    const sam = await save(v, mesa4.visitId, SAM, null, 0, [
      item(v, "fish"),
      item(v, "beer", { quantity: "2" }),
    ]);

    const merged = await takeOver(v, alex.id, SAM, 0);
    expect(merged).toMatchObject({ id: sam.id, ownerId: SAM, ownerName: "Sam", revision: 1 });
    expect(orders(merged)).toEqual([
      { menuItemId: v.offer("fish"), quantity: "1.000", unavailable: false },
      { menuItemId: v.offer("beer"), quantity: "3.000", unavailable: false },
      { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: false },
    ]);
    expect(merged.lines.map((line) => line.id)).toEqual([
      sam.lines[0]!.id,
      sam.lines[1]!.id,
      alex.lines[1]!.id,
    ]);
    expect((await storedLines(sam.id)).map((row) => row.position)).toEqual([1, 2, 3]);
    expect(await storedLines(alex.id)).toEqual([]);

    expect(await draftsOf(v, mesa4.visitId)).toEqual([merged]);
    expect(await draftRow(alex.id)).toMatchObject({
      state: "discarded",
      ownerId: SAM,
      revision: 1,
    });
    expect(await eventsOf(alex.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
      { kind: "taken_over", fromPerson: ALEX, toPerson: SAM, actorId: SAM, detail: {} },
      {
        kind: "discarded",
        fromPerson: SAM,
        toPerson: SAM,
        actorId: SAM,
        detail: { intoDraftId: sam.id },
      },
    ]);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "Sam", lineCount: 3 }]);
    await expect(save(v, mesa4.visitId, ALEX, alex.id, 1, [])).rejects.toMatchObject({
      code: "draft.not_found",
    });
  });
});

describe("unavailable lines (spec §10)", () => {
  it("marks a line whose dish sells out, clears the mark when it returns, and never rewrites the line", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const draft = await save(v, visitId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    const stored = await storedLines(draft.id);

    await db.run(sql`update products set available = 0 where id = ${v.productId.burger}`);
    const [soldOut] = await draftsOf(v, visitId);
    expect(orders(soldOut!)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "1.000", unavailable: false },
      { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: true },
    ]);
    expect(soldOut!.revision).toBe(0);
    expect(await storedLines(draft.id)).toEqual(stored);

    await db.run(sql`update products set available = 1 where id = ${v.productId.burger}`);
    expect(await draftsOf(v, visitId)).toEqual([draft]);
    expect(await storedLines(draft.id)).toEqual(stored);
  });

  it("marks a line whose extras pick sells out", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const sauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    await save(v, visitId, ALEX, null, 0, [item(v, "burger", { extras: sauce })]);
    expect((await draftsOf(v, visitId))[0]!.lines[0]!.unavailable).toBe(false);

    await db.run(sql`update products set available = 0 where id = ${v.productId.sauce}`);
    expect((await draftsOf(v, visitId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("does not mark a pick sent in upper case, which pricing accepts", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const sauce = [
      {
        listId: v.sauceListId.toUpperCase(),
        picks: [{ productId: v.productId.sauce.toUpperCase(), quantity: 1 }],
      },
    ];
    await save(v, visitId, ALEX, null, 0, [item(v, "burger", { extras: sauce })]);
    expect((await draftsOf(v, visitId))[0]!.lines[0]!.unavailable).toBe(false);
  });

  it("marks a line whose pick names a product the list does not offer", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    const beerAsSauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.beer, quantity: 1 }] },
    ];
    await save(v, visitId, ALEX, null, 0, [item(v, "burger", { extras: beerAsSauce })]);
    expect((await draftsOf(v, visitId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("marks a line naming a variant the menu does not offer, and not one it does", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    await save(v, visitId, ALEX, null, 0, [
      item(v, "wine", { variantId: v.glass }),
      item(v, "wine", { variantId: v.bottle }),
      item(v, "wine", { variantId: randomUUID() }),
    ]);
    expect((await draftsOf(v, visitId))[0]!.lines.map((line) => line.unavailable)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("marks a line naming a menu item the zone does not offer", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    await save(v, visitId, ALEX, null, 0, [item(v, "beer", { menuItemId: randomUUID() })]);
    expect((await draftsOf(v, visitId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("reads no drafts on a visit that has none, open or not", async () => {
    const v = await setupVenue();
    const { visitId } = await seated(v);
    expect(await draftsOf(v, visitId)).toEqual([]);
    expect(await draftsOf(v, randomUUID())).toEqual([]);
  });
});

describe("navigation sends nothing", () => {
  it("creates no group, ticket, order line or replay record, and leaves the visit revision alone", async () => {
    const v = await setupVenue();
    const { visitId, tabId } = await seated(v);
    const revision = await visitRevision(visitId);
    const alex = await save(v, visitId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    await save(v, visitId, ALEX, alex.id, 0, [item(v, "beer", { quantity: "3" })]);
    await save(v, visitId, SAM, null, 0, [item(v, "fish")]);
    await takeOver(v, alex.id, SAM, 1);

    expect(await visitRevision(visitId)).toBe(revision);
    expect(await db.select().from(orderGroups).where(eq(orderGroups.visitId, visitId))).toEqual([]);
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    ).toEqual([]);
    expect(await db.select().from(ticketItems)).toEqual([]);
    expect(await db.select().from(serviceCommands)).toEqual([]);
  });
});
