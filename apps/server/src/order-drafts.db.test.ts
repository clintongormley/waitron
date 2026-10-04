import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  locations,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  serviceCommands,
  ticketItems,
  parties,
  withTransaction,
  workingOrderLines,
  workingOrders,
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
  createOptionList,
  createProduct,
  setMenuVariants,
  setProductVariants,
  updateMenuItem,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  jobOrigin,
} from "@waitron/shared";
import type { OptionSelection } from "@waitron/shared";
import type { OriginConfig } from "./till-config.js";
import { createCourse } from "./kitchen.js";
import { createTable } from "./tables.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { finishTable, seatTable } from "./parties.js";
import { listTablesWithState } from "./working-order.js";
import { submitGroups } from "./order-groups.js";
import type { GroupRelease } from "./order-groups.js";
import { readDrafts, saveDraft, submitDraft, takeOverDraft } from "./order-drafts.js";
import type { Draft, DraftLine } from "./order-drafts.js";
import "./errors.js";
import { splitBill } from "./bill-actions.js";
import { joinTables } from "./table-actions.js";

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
  cfg: OriginConfig;
  productId: Record<Dish, string>;
  courseId: string;
  sauceListId: string;
  /** The Burger's doneness answers. */
  rare: OptionSelection;
  well: OptionSelection;
  /** The Wine's variants: the menu offers the glass and not the bottle. */
  glass: string;
  bottle: string;
  offer(dish: Dish): string;
  zoneId: string;
  menuId: string;
  /** The menu version the fixture published last. */
  versionId: string;
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
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow: "prepay",
  };
  await db.insert(persons).values([
    { id: ALEX, displayName: "Alex" },
    { id: SAM, displayName: "Sam" },
  ]);
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Platos" });
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
    const doneness = await createOptionList(
      tx,
      {
        name: "Doneness",
        customerName: { es: "Punto" },
        kitchenName: "K-DONE",
        defaultLabelId: null,
        active: true,
        labels: ["Rare", "Well"].map((way) => ({
          name: `${way} staff`,
          customerName: { es: `${way} customer` },
          kitchenName: `K-${way.toUpperCase()}`,
          available: true,
        })),
      },
      LOCALE,
    );
    await writeProductModifiers(tx, productId.burger, [
      { kind: "extras", id: sauces.id },
      { kind: "options", id: doneness.id },
    ]);
    const [rare, well] = doneness.labels.map((label) => ({
      listId: doneness.id,
      labelId: label.id,
    }));
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
    const versionId = await publishWorkingMenu(tx, offers.menuId);
    return {
      cfg,
      productId,
      courseId,
      sauceListId: sauces.id,
      rare: rare!,
      well: well!,
      glass: glass!.id,
      bottle: bottle!.id,
      zoneId: offers.zoneId,
      menuId: offers.menuId,
      versionId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
    };
  });
}

interface Seated {
  partyId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue, label = "Mesa 4"): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, { label, zoneId: v.zoneId });
    const { partyId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 4,
      operatorId: ALEX,
    });
    return { partyId, tabId, tableId };
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
  partyId: string,
  operatorId: string,
  draftId: string | null,
  revision: number,
  lines: unknown[],
): Promise<Draft> {
  return inTx((tx) =>
    saveDraft(tx, v.cfg, partyId, operatorId, { draftId, revision, lines: lines as LineInput[] }),
  );
}

async function takeOver(
  v: Venue,
  partyId: string,
  draftId: string,
  operatorId: string,
  revision: number,
) {
  return inTx((tx) => takeOverDraft(tx, v.cfg, partyId, draftId, operatorId, revision));
}

async function draftsOf(v: Venue, partyId: string): Promise<Draft[]> {
  return inTx((tx) => readDrafts(tx, v.cfg, partyId));
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

async function partyRevision(partyId: string): Promise<number> {
  const [row] = await db
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

async function unsentDraftsAt(v: Venue, tableId: string) {
  const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));
  const unsent = rows.find((row) => row.id === tableId)!.party!.unsentDrafts;
  return [...unsent].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
}

const byOwner = (drafts: Draft[]) =>
  [...drafts].sort((a, b) => a.ownerName.localeCompare(b.ownerName));

/** Pepper sauce, offered on its own and as an extra on the Burger, made not sold separately and the
 * menu published again. */
async function sauceNotSoldSeparately(v: Venue): Promise<void> {
  await inTx(async (tx) => {
    await updateProduct(tx, v.productId.sauce, { ordering: "not_sold_separately" });
    await publishWorkingMenu(tx, v.menuId);
  });
}

const withSauce = (v: Venue) => [
  { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
];

describe("separate drafts (spec §12 item 1)", () => {
  it("keeps Alex's and Sam's drafts apart, refuses Sam's save onto Alex's, and shows each unsent order on the table", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [
      item(v, "beer", { quantity: "2" }),
      item(v, "burger"),
    ]);
    const sam = await save(v, mesa4.partyId, SAM, null, 0, [item(v, "fish")]);

    expect(alex).toMatchObject({ partyId: mesa4.partyId, ownerId: ALEX, ownerName: "Alex" });
    expect(sam).toMatchObject({ partyId: mesa4.partyId, ownerId: SAM, ownerName: "Sam" });
    const drafts = byOwner(await draftsOf(v, mesa4.partyId));
    expect(drafts).toEqual([alex, sam]);
    expect(drafts.map(orders)).toEqual([
      [
        { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
        { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: false },
      ],
      [{ menuItemId: v.offer("fish"), quantity: "1.000", unavailable: false }],
    ]);

    await expect(
      save(v, mesa4.partyId, SAM, alex.id, alex.revision, [item(v, "beer")]),
    ).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { draftId: alex.id, ownerId: ALEX, ownerName: "Alex" },
    });
    expect(byOwner(await draftsOf(v, mesa4.partyId))).toEqual([alex, sam]);

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
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer")]);
    await save(v, mesa5.partyId, SAM, null, 0, [item(v, "fish")]);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "Alex", lineCount: 1 }]);

    await save(v, mesa4.partyId, ALEX, alex.id, alex.revision, []);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([]);
    expect(await unsentDraftsAt(v, mesa5.tableId)).toEqual([{ ownerName: "Sam", lineCount: 1 }]);
  });

  it("does not show a draft that is no longer open, even one still holding lines", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, alex.id));
    expect(await storedLines(alex.id)).toHaveLength(1);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([]);
    expect(await draftsOf(v, mesa4.partyId)).toEqual([]);
  });
});

describe("saving a draft", () => {
  it("names an owner with no person record as empty text, wherever the name is shown", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const nobody = randomUUID();
    const draft = await save(v, mesa4.partyId, nobody, null, 0, [item(v, "beer")]);
    expect(draft).toMatchObject({ ownerId: nobody, ownerName: "" });
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "", lineCount: 1 }]);
    await expect(save(v, mesa4.partyId, SAM, draft.id, 0, [])).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { draftId: draft.id, ownerId: nobody, ownerName: "" },
    });
  });

  it("creates the operator's draft at revision 0 with a created event", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    expect(draft).toMatchObject({ revision: 0, ownerId: ALEX });
    expect(await eventsOf(draft.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
    ]);
  });

  it("replaces the lines, adds matching ones together (D10), numbers positions in order and bumps the revision", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    const second = await save(v, partyId, ALEX, first.id, 0, [
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
    const { partyId } = await seated(v);
    const versionId = randomUUID();
    const sent = item(v, "burger", {
      quantity: "1.5",
      note: "  no salt  ",
      courseId: v.courseId,
      menuVersionId: versionId,
      options: [v.rare],
      extras: [{ listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
      noMerge: true,
    });
    const draft = await save(v, partyId, ALEX, null, 0, [sent]);
    expect(draft.lines).toEqual([
      {
        ...sent,
        id: draft.lines[0]!.id,
        quantity: "1.500",
        note: "no salt",
        makeAt: null,
        unavailable: false,
      },
    ]);
    expect(await draftsOf(v, partyId)).toEqual([draft]);
  });

  it("folds every id it parses to lower case, so an upper-case line adds into its lower-case twin", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const up = (id: string) => id.toUpperCase();
    const versionId = randomUUID();
    const sauce = { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] };
    const lower = {
      menuVersionId: versionId,
      courseId: v.courseId,
      options: [v.rare],
      extras: [sauce],
    };
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", lower),
      item(v, "burger", {
        menuItemId: up(v.offer("burger")),
        menuVersionId: up(versionId),
        courseId: up(v.courseId),
        options: [{ listId: up(v.rare.listId), labelId: up(v.rare.labelId) }],
        extras: [
          { listId: up(sauce.listId), picks: [{ productId: up(v.productId.sauce), quantity: 1 }] },
        ],
      }),
      item(v, "wine", { variantId: up(v.glass) }),
    ]);
    expect(draft.lines).toEqual([
      {
        ...item(v, "burger", lower),
        id: draft.lines[0]!.id,
        quantity: "2.000",
        makeAt: null,
        unavailable: false,
      },
      {
        ...item(v, "wine", { variantId: v.glass }),
        id: draft.lines[1]!.id,
        quantity: "1.000",
        makeAt: null,
        unavailable: false,
      },
    ]);

    const saved = await save(v, partyId, ALEX, up(draft.id), 0, [item(v, "beer")]);
    expect(saved).toMatchObject({ id: draft.id, revision: 1 });
    expect(await takeOver(v, partyId, up(draft.id), SAM, 1)).toMatchObject({
      id: draft.id,
      ownerId: SAM,
    });
  });

  it("stores an empty or blank note as no note, so the line adds into one without a note", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { note: null }),
      item(v, "beer", { note: "" }),
      item(v, "beer", { note: "   " }),
    ]);
    expect(draft.lines).toMatchObject([{ note: null, quantity: "3.000" }]);
  });

  it("takes the defaults for fields a line leaves out", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
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
        makeAt: null,
        noMerge: false,
        unavailable: false,
      },
    ]);
  });

  it("answers draft.out_of_date, writing nothing, to a new draft from an operator who already has one", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await expect(save(v, partyId, ALEX, null, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: draft.id, revision: 0 },
    });
    expect(await draftsOf(v, partyId)).toEqual([draft]);
  });

  it("answers draft.out_of_date, writing nothing, to a save from a stale revision", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const second = await save(v, partyId, ALEX, first.id, 0, [item(v, "fish")]);
    await expect(save(v, partyId, ALEX, first.id, 0, [item(v, "burger")])).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: first.id, revision: 1 },
    });
    expect(await draftsOf(v, partyId)).toEqual([second]);
  });

  it("answers draft.not_found for an unknown draft, a draft of another party and a discarded draft", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const other = await save(v, mesa5.partyId, ALEX, null, 0, [item(v, "beer")]);
    const unknown = randomUUID();
    await expect(save(v, mesa4.partyId, ALEX, unknown, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: unknown },
    });
    await expect(save(v, mesa4.partyId, ALEX, other.id, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: other.id },
    });
    await expect(save(v, mesa4.partyId, ALEX, "draft-1", 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: "draft-1" },
    });
    await expect(takeOver(v, mesa4.partyId, "draft-1", SAM, 0)).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: "draft-1" },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, other.id));
    await expect(save(v, mesa5.partyId, ALEX, other.id, 0, [])).rejects.toMatchObject({
      code: "draft.not_found",
    });
    expect(await storedLines(other.id)).toHaveLength(1);
  });

  it("answers draft.already_submitted to a save onto a submitted draft", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "submitted" }).where(eq(orderDrafts.id, draft.id));
    await expect(save(v, partyId, ALEX, draft.id, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "draft.already_submitted",
      params: { draftId: draft.id },
    });
    expect((await storedLines(draft.id)).map((row) => row.menuItemId)).toEqual([v.offer("beer")]);
  });

  it("answers party.not_open to a save on a party that is not open, or on no party", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await db
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString() })
      .where(eq(parties.id, partyId));
    await expect(save(v, partyId, ALEX, draft.id, 0, [item(v, "fish")])).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId },
    });
    await expect(save(v, partyId, SAM, null, 0, [])).rejects.toMatchObject({
      code: "party.not_open",
    });
    const missing = randomUUID();
    await expect(save(v, missing, ALEX, null, 0, [])).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId: missing },
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
      "options.invalid",
      "optionSelections",
    ],
    [
      "an option without a label",
      (v) => [{ ...item(v, "beer"), options: [{ listId: randomUUID() }] }],
      "options.invalid",
      "labelId",
    ],
    [
      "an option whose label is not an id",
      (v) => [{ ...item(v, "burger"), options: [{ listId: v.rare.listId, labelId: "rare" }] }],
      "options.invalid",
      "labelId",
    ],
    [
      "an extras pick whose product is not an id",
      (v) => [
        {
          ...item(v, "burger"),
          extras: [{ listId: v.sauceListId, picks: [{ productId: "sauce", quantity: 1 }] }],
        },
      ],
      "extras.invalid",
      "productId",
    ],
    [
      "an option that is not an object",
      (v) => [{ ...item(v, "beer"), options: ["rare"] }],
      "options.invalid",
      "optionSelections",
    ],
    [
      "an explicit null where the extras default only on absence",
      (v) => [{ ...item(v, "beer"), extras: null }],
      "extras.invalid",
      "extraSelections",
    ],
    [
      "an extras list whose picks are not a list",
      (v) => [{ ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: "sauce" }] }],
      "extras.invalid",
      "picks",
    ],
    [
      "an extras answer that is not an object",
      (v) => [{ ...item(v, "burger"), extras: [v.sauceListId] }],
      "extras.invalid",
      "extraSelections",
    ],
    [
      "an extras pick with no product",
      (v) => [
        { ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: [{ quantity: 1 }] }] },
      ],
      "extras.invalid",
      "productId",
    ],
    [
      "an extras pick that is not an object",
      (v) => [
        { ...item(v, "burger"), extras: [{ listId: v.sauceListId, picks: [v.productId.sauce] }] },
      ],
      "extras.invalid",
      "picks",
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
      "extras.invalid",
      "quantity",
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
      "extras.invalid",
      "quantity",
    ],
    [
      "an option whose list is not an id",
      (v) => [{ ...item(v, "burger"), options: [{ listId: "doneness", labelId: v.rare.labelId }] }],
      "options.invalid",
      "listId",
    ],
    [
      "an option carrying a field an answer does not have",
      (v) => [{ ...item(v, "burger"), options: [{ ...v.rare, colour: "red" }] }],
      "options.invalid",
      "optionSelections.colour",
    ],
    [
      "an extras list that is not an id",
      (v) => [
        {
          ...item(v, "burger"),
          extras: [{ listId: "sauces", picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
        },
      ],
      "extras.invalid",
      "listId",
    ],
    [
      "an extras pick carrying a field a pick does not have",
      (v) => [
        {
          ...item(v, "burger"),
          extras: [
            {
              listId: v.sauceListId,
              picks: [{ productId: v.productId.sauce, quantity: 1, price: "0.00" }],
            },
          ],
        },
      ],
      "extras.invalid",
      "picks.price",
    ],
    [
      "an extras pick above the largest count a list can allow",
      (v) => [
        item(v, "burger", {
          extras: [
            {
              listId: v.sauceListId,
              picks: [{ productId: v.productId.sauce, quantity: 2147483648 }],
            },
          ],
        }),
      ],
      "extras.invalid",
      "quantity",
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
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    const refused = lines(v);
    await expect(
      inTx((tx) =>
        saveDraft(tx, v.cfg, partyId, ALEX, {
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
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    await expect(
      save(v, partyId, ALEX, draft.id, 0, [item(v, "beer", { note: "x".repeat(201) })]),
    ).rejects.toMatchObject({ code: "working_order.note_too_long" });
    expect(await storedLines(draft.id)).toEqual(before);
  });

  it("refuses a course that does not exist with course.not_found", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    const before = await storedLines(draft.id);
    const courseId = randomUUID();
    await expect(
      save(v, partyId, ALEX, draft.id, 0, [item(v, "beer", { courseId })]),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId } });
    expect(await storedLines(draft.id)).toEqual(before);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 0 });
  });

  it("refuses a course of another location with course.not_found", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    const [elsewhere] = await db
      .insert(locations)
      .values({ name: "Terraza", invoiceLocales: [LOCALE], operationDescription: "Restaurante" })
      .returning({ id: locations.id });
    const { id: courseId } = await inTx((tx) =>
      createCourse(tx, { ...v.cfg, locationId: brandLocationId(elsewhere!.id) }, { name: "Mains" }),
    );

    await refusedWritingNothing(
      () => save(v, partyId, ALEX, draft.id, 0, [item(v, "beer", { courseId })]),
      { code: "course.not_found", params: { courseId } },
    );
  });

  it("keeps a line of an inactive course, which is refused only when it is sent", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await db.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, v.courseId));

    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { courseId: v.courseId }),
    ]);

    expect(draft.lines.map((line) => line.courseId)).toEqual([v.courseId]);
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "hold" }]),
      { code: "course.not_found", params: { courseId: v.courseId } },
    );
  });

  it("refuses a line ordering a product not sold separately on its own", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
    await sauceNotSoldSeparately(v);
    await refusedWritingNothing(
      () => save(v, partyId, ALEX, draft.id, 0, [item(v, "fish"), item(v, "sauce")]),
      { code: "product.not_sold_separately", params: { productId: v.productId.sauce } },
    );
  });

  it("saves a product not sold separately as an extra on another dish", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await sauceNotSoldSeparately(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", { extras: withSauce(v), options: [v.rare] }),
    ]);
    expect(draft.lines.map((line) => line.unavailable)).toEqual([false]);
  });

  it("creates no draft when the first save is refused", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await expect(
      save(v, partyId, ALEX, null, 0, [item(v, "beer", { quantity: "0" })]),
    ).rejects.toMatchObject({ code: "management.request_invalid" });
    expect(await db.select().from(orderDrafts).where(eq(orderDrafts.partyId, partyId))).toEqual([]);
  });
});

describe("taking over a draft (D5, spec §2)", () => {
  it("gives Sam Alex's Beer, adds Sam's Beer into it, and refuses Alex's next save", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer")]);

    const taken = await takeOver(v, mesa4.partyId, alex.id, SAM, 0);
    expect(taken).toMatchObject({ id: alex.id, ownerId: SAM, ownerName: "Sam", revision: 1 });
    expect(taken.lines).toEqual(alex.lines);

    const sams = await save(v, mesa4.partyId, SAM, alex.id, 1, [...taken.lines, item(v, "beer")]);
    expect(sams).toMatchObject({ id: alex.id, ownerId: SAM, revision: 2 });
    expect(orders(sams)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
    ]);

    await expect(save(v, mesa4.partyId, ALEX, alex.id, 2, [])).rejects.toMatchObject({
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
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const second = await save(v, partyId, ALEX, first.id, 0, [item(v, "fish")]);
    await expect(takeOver(v, partyId, first.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: first.id, revision: 1 },
    });
    expect(await draftsOf(v, partyId)).toEqual([second]);
    expect(await eventsOf(first.id)).toHaveLength(1);
  });

  it("answers draft.not_found for an unknown or discarded draft, and draft.already_submitted for a submitted one", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const unknown = randomUUID();
    await expect(takeOver(v, partyId, unknown, SAM, 0)).rejects.toMatchObject({
      code: "draft.not_found",
      params: { draftId: unknown },
    });
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await db.update(orderDrafts).set({ state: "submitted" }).where(eq(orderDrafts.id, draft.id));
    await expect(takeOver(v, partyId, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.already_submitted",
      params: { draftId: draft.id },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draft.id));
    await expect(takeOver(v, partyId, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.not_found",
    });
    expect(await draftRow(draft.id)).toMatchObject({ ownerId: ALEX, revision: 0 });
    expect(await eventsOf(draft.id)).toHaveLength(1);
  });

  it("answers party.not_open to a takeover on a party that is not open", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await db
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString() })
      .where(eq(parties.id, partyId));
    await expect(takeOver(v, partyId, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId },
    });
    expect(await draftRow(draft.id)).toMatchObject({ ownerId: ALEX, revision: 0 });
  });

  it("answers a takeover of your own draft with the draft as it is, writing nothing", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const draft = await save(v, partyId, ALEX, first.id, 0, [item(v, "fish")]);
    expect(await takeOver(v, partyId, draft.id, ALEX, 0)).toEqual(draft);
    expect(await takeOver(v, partyId, draft.id, ALEX, 1)).toEqual(draft);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 1, ownerId: ALEX });
    expect(await eventsOf(draft.id)).toHaveLength(1);
  });

  it("adds a taken draft into the taker's own open draft and discards it, so no one holds two", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    const sam = await save(v, mesa4.partyId, SAM, null, 0, [
      item(v, "fish"),
      item(v, "beer", { quantity: "2" }),
    ]);

    const merged = await takeOver(v, mesa4.partyId, alex.id, SAM, 0);
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

    expect(await draftsOf(v, mesa4.partyId)).toEqual([merged]);
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
    await expect(save(v, mesa4.partyId, ALEX, alex.id, 1, [])).rejects.toMatchObject({
      code: "draft.not_found",
    });
  });
});

describe("who a draft was taken over from", () => {
  it("names no one on a draft never taken over, on a read, a save and a submission's rest", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    expect(draft.takenOverFrom).toBeNull();
    expect((await draftsOf(v, partyId)).map((read) => read.takenOverFrom)).toEqual([null]);
    const { draft: rest } = await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[0]!.id], release: "fire" },
    ]);
    expect(rest!.takenOverFrom).toBeNull();
  });

  it("names Alex once Sam takes Alex's draft, on the takeover, a read, Sam's save and a submission's rest", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const fromAlex = { personId: ALEX, name: "Alex" };

    const taken = await takeOver(v, partyId, alex.id, SAM, 0);
    expect(taken.takenOverFrom).toEqual(fromAlex);
    expect((await draftsOf(v, partyId)).map((read) => read.takenOverFrom)).toEqual([fromAlex]);
    const sams = await save(v, partyId, SAM, alex.id, 1, taken.lines);
    expect(sams.takenOverFrom).toEqual(fromAlex);
    const { draft: rest } = await submit(v, partyId, sams, SAM, [
      { lineIds: [sams.lines[0]!.id], release: "fire" },
    ]);
    expect(rest!.takenOverFrom).toEqual(fromAlex);
  });

  it("names Sam once Alex takes it back, even when the clock stepped back between the two", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-28T12:00:00.500Z"));
      await takeOver(v, partyId, alex.id, SAM, 0);
      vi.setSystemTime(new Date("2026-09-28T12:00:00.100Z"));
      const back = await takeOver(v, partyId, alex.id, ALEX, 1);
      expect(back).toMatchObject({ ownerId: ALEX, takenOverFrom: { personId: SAM, name: "Sam" } });
    } finally {
      vi.useRealTimers();
    }
    expect((await draftsOf(v, partyId)).map((read) => read.takenOverFrom)).toEqual([
      { personId: SAM, name: "Sam" },
    ]);
  });

  it("names each draft's own taker in one read of several drafts", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const nobody = randomUUID();
    const nobodys = await save(v, partyId, nobody, null, 0, [item(v, "fish")]);
    const mia = randomUUID();
    await db.insert(persons).values({ id: mia, displayName: "Mia" });
    await save(v, partyId, mia, null, 0, [item(v, "wine", { variantId: v.glass })]);
    await takeOver(v, partyId, alex.id, SAM, 0);
    await takeOver(v, partyId, nobodys.id, ALEX, 0);

    const read = byOwner(await draftsOf(v, partyId));
    expect(read.map(({ ownerId, takenOverFrom }) => ({ ownerId, takenOverFrom }))).toEqual([
      { ownerId: ALEX, takenOverFrom: { personId: nobody, name: "" } },
      { ownerId: mia, takenOverFrom: null },
      { ownerId: SAM, takenOverFrom: { personId: ALEX, name: "Alex" } },
    ]);
  });

  it("answers the taker's own draft, naming no one, when the taken draft is added into it", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const sam = await save(v, partyId, SAM, null, 0, [item(v, "fish")]);

    const merged = await takeOver(v, partyId, alex.id, SAM, 0);
    expect(merged).toMatchObject({ id: sam.id, takenOverFrom: null });
    expect((await draftsOf(v, partyId)).map((read) => read.takenOverFrom)).toEqual([null]);
  });
});

describe("unavailable lines (spec §10)", () => {
  it("marks a line whose dish sells out, clears the mark when it returns, and never rewrites the line", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    const stored = await storedLines(draft.id);

    await db.run(sql`update products set available = 0 where id = ${v.productId.burger}`);
    const [soldOut] = await draftsOf(v, partyId);
    expect(orders(soldOut!)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "1.000", unavailable: false },
      { menuItemId: v.offer("burger"), quantity: "1.000", unavailable: true },
    ]);
    expect(soldOut!.revision).toBe(0);
    expect(await storedLines(draft.id)).toEqual(stored);

    await db.run(sql`update products set available = 1 where id = ${v.productId.burger}`);
    expect(await draftsOf(v, partyId)).toEqual([draft]);
    expect(await storedLines(draft.id)).toEqual(stored);
  });

  // A draft saved while the product sold on its own keeps the line; a republish that stops that marks
  // it, and sending it is refused.
  it("marks a line whose product the menu republishes as not sold separately, and refuses sending it", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "sauce")]);
    await sauceNotSoldSeparately(v);
    const [marked] = await draftsOf(v, partyId);
    expect(orders(marked!)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "1.000", unavailable: false },
      { menuItemId: v.offer("sauce"), quantity: "1.000", unavailable: true },
    ]);
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      { code: "product.not_sold_separately", params: { productId: v.productId.sauce } },
    );
  });

  it("marks a line whose extras pick sells out", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    await save(v, partyId, ALEX, null, 0, [item(v, "burger", { extras: sauce })]);
    expect((await draftsOf(v, partyId))[0]!.lines[0]!.unavailable).toBe(false);

    await db.run(sql`update products set available = 0 where id = ${v.productId.sauce}`);
    expect((await draftsOf(v, partyId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("marks a line whose chosen option label is withdrawn, clears the mark when it returns, and never rewrites the line", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", { options: [v.rare], extras: sauce }),
      item(v, "burger", { options: [v.well] }),
    ]);
    expect(draft.lines.map((line) => line.unavailable)).toEqual([false, false]);
    const stored = await storedLines(draft.id);

    await db.run(sql`update option_labels set available = 0 where id = ${v.rare.labelId}`);
    expect((await draftsOf(v, partyId))[0]!.lines.map((line) => line.unavailable)).toEqual([
      true,
      false,
    ]);
    expect(await storedLines(draft.id)).toEqual(stored);

    await db.run(sql`update option_labels set available = 1 where id = ${v.rare.labelId}`);
    expect(await draftsOf(v, partyId)).toEqual([draft]);
    expect(await storedLines(draft.id)).toEqual(stored);
  });

  const refusedAtPricing: [string, (v: Venue) => Promise<LineInput>, string][] = [
    [
      "a sold-out dish",
      async (v) => {
        await db.run(sql`update products set available = 0 where id = ${v.productId.burger}`);
        return item(v, "burger");
      },
      "product.unavailable",
    ],
    [
      "a variant the menu does not offer",
      async (v) => item(v, "wine", { variantId: v.bottle }),
      "product.variant_unavailable",
    ],
    [
      "a sold-out extras pick",
      async (v) => {
        await db.run(sql`update products set available = 0 where id = ${v.productId.sauce}`);
        return item(v, "burger", {
          options: [v.rare],
          extras: [
            { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
          ],
        });
      },
      "extras.invalid",
    ],
    [
      "a withdrawn option label",
      async (v) => {
        await db.run(sql`update option_labels set available = 0 where id = ${v.rare.labelId}`);
        return item(v, "burger", { options: [v.rare] });
      },
      "options.label_required",
    ],
    [
      "a menu item the zone does not offer",
      async (v) => item(v, "beer", { menuItemId: randomUUID() }),
      "service_zone.offer_not_allowed",
    ],
  ];

  it("sends the same kinds of line when nothing is withdrawn (the control for the cases below)", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", { options: [v.rare], extras: sauce }),
      item(v, "wine", { variantId: v.glass }),
    ]);
    expect(draft.lines.map((line) => line.unavailable)).toEqual([false, false]);
    const submitted = await inTx(async (tx) =>
      submitGroups(tx, v.cfg, partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: ALEX,
        groups: [
          {
            lines: [
              { menuItemId: v.offer("burger"), quantity: "1", options: [v.rare], extras: sauce },
              { menuItemId: v.offer("wine"), quantity: "1", variantId: v.glass },
            ],
            release: "hold",
          },
        ],
      }),
    );
    expect(submitted.groups).toHaveLength(1);
  });

  it.each(refusedAtPricing)(
    "marks %s, which pricing refuses when the line is sent",
    async (_name, prepare, code) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const line = await prepare(v);
      await save(v, partyId, ALEX, null, 0, [line]);
      expect((await draftsOf(v, partyId))[0]!.lines[0]!.unavailable).toBe(true);
      await expect(
        inTx(async (tx) =>
          submitGroups(tx, v.cfg, partyId, {
            submissionId: randomUUID(),
            expectedPartyRevision: await partyRevision(partyId),
            operatorId: ALEX,
            groups: [
              {
                lines: [
                  {
                    menuItemId: line.menuItemId,
                    quantity: line.quantity,
                    options: line.options,
                    extras: line.extras,
                    ...(line.variantId === null ? {} : { variantId: line.variantId }),
                  },
                ],
                release: "hold",
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it("marks a line answering an options list its dish does not carry, or with a label the list does not hold", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { options: [v.rare] }),
      item(v, "burger", { options: [{ listId: v.rare.listId, labelId: randomUUID() }] }),
    ]);
    expect((await draftsOf(v, partyId))[0]!.lines.map((line) => line.unavailable)).toEqual([
      true,
      true,
    ]);
  });

  it("marks a line whose pick names a product the list does not offer", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const beerAsSauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.beer, quantity: 1 }] },
    ];
    await save(v, partyId, ALEX, null, 0, [item(v, "burger", { extras: beerAsSauce })]);
    expect((await draftsOf(v, partyId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("marks a line naming a variant the menu does not offer, and not one it does", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await save(v, partyId, ALEX, null, 0, [
      item(v, "wine", { variantId: v.glass }),
      item(v, "wine", { variantId: v.bottle }),
      item(v, "wine", { variantId: randomUUID() }),
    ]);
    expect((await draftsOf(v, partyId))[0]!.lines.map((line) => line.unavailable)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("marks a line naming a menu item the zone does not offer", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await save(v, partyId, ALEX, null, 0, [item(v, "beer", { menuItemId: randomUUID() })]);
    expect((await draftsOf(v, partyId))[0]!.lines[0]!.unavailable).toBe(true);
  });

  it("reads no drafts on a party that has none, open or not", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    expect(await draftsOf(v, partyId)).toEqual([]);
    expect(await draftsOf(v, randomUUID())).toEqual([]);
  });
});

describe("navigation sends nothing", () => {
  it("creates no group, ticket, order line or replay record, and leaves the party revision alone", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const revision = await partyRevision(partyId);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    await save(v, partyId, ALEX, alex.id, 0, [item(v, "beer", { quantity: "3" })]);
    await save(v, partyId, SAM, null, 0, [item(v, "fish")]);
    await takeOver(v, partyId, alex.id, SAM, 1);

    expect(await partyRevision(partyId)).toBe(revision);
    expect(await db.select().from(orderGroups).where(eq(orderGroups.partyId, partyId))).toEqual([]);
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    ).toEqual([]);
    expect(await db.select().from(ticketItems)).toEqual([]);
    expect(await db.select().from(serviceCommands)).toEqual([]);
  });
});

interface SubmitOptions {
  submissionId?: string;
  draftRevision?: number;
  partyRevision?: number;
  joinGroupId?: string;
}

async function submit(
  v: Venue,
  partyId: string,
  draft: { id: string; revision: number },
  operatorId: string,
  groups: { lineIds: string[]; release: GroupRelease }[],
  opts: SubmitOptions = {},
) {
  const expectedPartyRevision = opts.partyRevision ?? (await partyRevision(partyId));
  return inTx((tx) =>
    submitDraft(tx, v.cfg, partyId, draft.id, {
      operatorId,
      submissionId: opts.submissionId ?? randomUUID(),
      draftRevision: opts.draftRevision ?? draft.revision,
      expectedPartyRevision,
      groups,
      ...(opts.joinGroupId === undefined ? {} : { joinGroupId: opts.joinGroupId }),
    }),
  );
}

const lineIds = (draft: Draft) => draft.lines.map((line) => line.id);

/** A Burger as the till sends it: its doneness list must be answered for pricing to accept it. */
const burger = (v: Venue) => item(v, "burger", { options: [v.rare] });

/** The party's order lines, dishes and extras, by bill then line number. */
async function tabLines(partyId: string) {
  return db
    .select({
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      groupId: workingOrderLines.groupId,
      creditedTo: workingOrderLines.creditedTo,
      note: workingOrderLines.note,
      courseId: workingOrderLines.courseId,
      extraListId: workingOrderLines.extraListId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrders.partyId, partyId))
    .orderBy(asc(workingOrders.openedAt), asc(workingOrderLines.lineNo));
}

/** Every row of every table in the venue database, so a refusal can be shown to write none. */
async function everything() {
  const tables = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  const rows: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    rows[name] = await db.all(sql`select * from ${sql.identifier(name)} order by rowid`);
  }
  return rows;
}

async function refusedWritingNothing(
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await everything();
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await everything()).toEqual(before);
}

describe("submitting a draft: takeover and credit (D5, spec §2)", () => {
  it("credits the lines of the draft Sam took over and submitted to Sam, who is also the groups' submitter", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);
    const sams = await save(v, partyId, SAM, taken.id, taken.revision, [
      item(v, "beer"),
      item(v, "beer"),
    ]);
    expect(sams.ownerId).toBe(SAM);
    expect(orders(sams)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "2.000", unavailable: false },
    ]);

    const result = await submit(v, partyId, sams, SAM, [
      { lineIds: lineIds(sams), release: "fire" },
    ]);

    const groupId = result.groups[0]!.id;
    expect(result).toMatchObject({ tabId, revision: await partyRevision(partyId), draft: null });
    expect(
      (await tabLines(partyId)).map((row) => [row.productId, row.quantity, row.creditedTo]),
    ).toEqual([[v.productId.beer, 2000, SAM]]);
    expect(
      await db
        .select({ id: orderGroups.id, submittedBy: orderGroups.submittedBy })
        .from(orderGroups)
        .where(eq(orderGroups.partyId, partyId)),
    ).toEqual([{ id: groupId, submittedBy: SAM }]);
    expect(await draftRow(sams.id)).toMatchObject({ state: "submitted", ownerId: SAM });
    expect(await storedLines(sams.id)).toEqual([]);
    expect(await eventsOf(sams.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
      { kind: "taken_over", fromPerson: ALEX, toPerson: SAM, actorId: SAM, detail: {} },
      {
        kind: "submitted",
        fromPerson: SAM,
        toPerson: SAM,
        actorId: SAM,
        detail: { groupIds: [groupId] },
      },
    ]);
  });

  it("keeps Sam's credit on a line of his submitted draft split onto a check", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const sams = await save(v, partyId, SAM, null, 0, [item(v, "beer", { quantity: "2" })]);
    const { groups } = await submit(v, partyId, sams, SAM, [
      { lineIds: lineIds(sams), release: "fire" },
    ]);
    const [beer] = await tabLines(partyId);
    const command = { expectedPartyRevision: await partyRevision(partyId), operatorId: ALEX };

    const { billId: checkId } = await inTx((tx) =>
      splitBill(tx, v.cfg, tabId, [{ lineNo: beer!.lineNo, quantity: "1" }], command),
    );

    expect(
      (await tabLines(partyId))
        .filter((row) => row.workingOrderId === checkId)
        .map((row) => [row.quantity, row.groupId, row.creditedTo]),
    ).toEqual([[1000, groups[0]!.id, SAM]]);
  });
});

describe("one submission, in both orders (Review Focus 1)", () => {
  it("answers draft.taken_over, writing nothing, when Sam takes over and THEN Alex submits", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await takeOver(v, partyId, alex.id, SAM, alex.revision);

    await refusedWritingNothing(
      () => submit(v, partyId, alex, ALEX, [{ lineIds: lineIds(alex), release: "fire" }]),
      { code: "draft.taken_over", params: { draftId: alex.id, ownerId: SAM, ownerName: "Sam" } },
    );
  });

  it("answers draft.already_submitted when Alex submits and THEN Sam takes over, leaving Alex's submitted draft", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await submit(v, partyId, alex, ALEX, [{ lineIds: lineIds(alex), release: "fire" }]);
    const submitted = await draftRow(alex.id);
    expect(submitted).toMatchObject({ state: "submitted", ownerId: ALEX, revision: 1 });

    await refusedWritingNothing(() => takeOver(v, partyId, alex.id, SAM, submitted.revision), {
      code: "draft.already_submitted",
      params: { draftId: alex.id },
    });
    expect(await draftRow(alex.id)).toEqual(submitted);
  });

  it("gives one success and one draft.already_submitted to two submits of a draft under different ids", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const first = await submit(v, partyId, alex, ALEX, [
      { lineIds: lineIds(alex), release: "fire" },
    ]);

    await refusedWritingNothing(
      () =>
        submit(v, partyId, alex, ALEX, [{ lineIds: lineIds(alex), release: "fire" }], {
          partyRevision: first.revision,
        }),
      { code: "draft.already_submitted", params: { draftId: alex.id } },
    );
    expect(
      await db.select().from(orderGroups).where(eq(orderGroups.partyId, partyId)),
    ).toHaveLength(1);
  });

  it("answers the same submission id twice with the first result, writing no second group or ticket", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const submissionId = randomUUID();
    const seen = await partyRevision(partyId);
    const drinks = [{ lineIds: [alex.lines[0]!.id], release: "fire" as const }];
    const first = await submit(v, partyId, alex, ALEX, drinks, {
      submissionId,
      partyRevision: seen,
    });
    expect(first.draft).toMatchObject({ id: alex.id, revision: 1 });
    const after = await everything();
    expect(after.ticket_items).toHaveLength(1);

    // Both revisions the retry carries are now stale; the replay answers before either is compared.
    const again = await submit(v, partyId, alex, ALEX, drinks, {
      submissionId,
      partyRevision: seen,
      draftRevision: alex.revision,
    });

    expect(again).toEqual(first);
    expect(await everything()).toEqual(after);
  });

  it("answers a retried WHOLE submission with its result rather than draft.already_submitted", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const submissionId = randomUUID();
    const groups = [{ lineIds: lineIds(alex), release: "fire" as const }];
    const first = await submit(v, partyId, alex, ALEX, groups, { submissionId });
    const after = await everything();

    expect(await submit(v, partyId, alex, ALEX, groups, { submissionId })).toEqual(first);
    expect(await everything()).toEqual(after);
  });

  it("answers the same submission id with another selection of lines with submission.id_reused, leaving the draft", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const submissionId = randomUUID();
    await submit(v, partyId, alex, ALEX, [{ lineIds: [alex.lines[0]!.id], release: "fire" }], {
      submissionId,
    });
    const [rest] = await draftsOf(v, partyId);

    await refusedWritingNothing(
      () =>
        submit(v, partyId, rest!, ALEX, [{ lineIds: lineIds(rest!), release: "fire" }], {
          submissionId,
        }),
      { code: "submission.id_reused", params: { submissionId } },
    );
    expect(await draftsOf(v, partyId)).toEqual([rest]);
  });
});

describe("two revisions (D19)", () => {
  it("answers party.out_of_date, writing nothing, when another device fired a group since", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const seen = await partyRevision(partyId);
    await inTx((tx) =>
      submitGroups(tx, v.cfg, partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: seen,
        operatorId: SAM,
        groups: [{ lines: [{ menuItemId: v.offer("fish"), quantity: "1" }], release: "fire" }],
      }),
    );

    await refusedWritingNothing(
      () =>
        submit(v, partyId, alex, ALEX, [{ lineIds: lineIds(alex), release: "fire" }], {
          partyRevision: seen,
        }),
      { code: "party.out_of_date", params: { partyId, revision: seen + 1 } },
    );
  });

  it("answers draft.out_of_date, writing nothing, when the owner saved again on another device", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const phone = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const tablet = await save(v, partyId, ALEX, phone.id, 0, [item(v, "beer"), item(v, "fish")]);

    await refusedWritingNothing(
      () => submit(v, partyId, phone, ALEX, [{ lineIds: lineIds(phone), release: "fire" }]),
      { code: "draft.out_of_date", params: { draftId: phone.id, revision: tablet.revision } },
    );
    // With both revisions stale, the draft's is the one answered.
    const staleParty = (await partyRevision(partyId)) - 1;
    await refusedWritingNothing(
      () =>
        submit(v, partyId, phone, ALEX, [{ lineIds: lineIds(phone), release: "fire" }], {
          partyRevision: staleParty,
        }),
      { code: "draft.out_of_date" },
    );
  });
});

describe("partial submission", () => {
  it("leaves the lines not submitted in the open draft, in their positions, and sends the rest later", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer"),
      burger(v),
      item(v, "wine", { variantId: v.glass }),
      item(v, "fish"),
    ]);
    const [beer, burgerLine, wine, fish] = draft.lines;

    const drinks = await submit(v, partyId, draft, ALEX, [
      { lineIds: [wine!.id, beer!.id], release: "fire" },
    ]);

    const left = { ...draft, revision: 1, lines: [burgerLine, fish] };
    expect(drinks.draft).toEqual(left);
    expect(await draftsOf(v, partyId)).toEqual([left]);
    expect((await storedLines(draft.id)).map((row) => [row.id, row.position])).toEqual([
      [burgerLine!.id, 2],
      [fish!.id, 4],
    ]);
    expect(await draftRow(draft.id)).toMatchObject({ state: "open", revision: 1 });
    // Within a group the lines go in the draft's order, whatever order the ids were named in. A
    // variant's line names the variant.
    expect((await tabLines(partyId)).map((row) => [row.productId, row.groupId])).toEqual([
      [v.productId.beer, drinks.groups[0]!.id],
      [v.glass, drinks.groups[0]!.id],
    ]);
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: [fish!.id], release: "fire" }]),
      { code: "draft.out_of_date", params: { draftId: draft.id, revision: 1 } },
    );

    const food = await submit(v, partyId, left, ALEX, [
      { lineIds: [burgerLine!.id], release: "hold" },
      { lineIds: [fish!.id], release: "hold" },
    ]);

    expect(food.draft).toBeNull();
    expect(food.groups.map((group) => group.state)).toEqual(["held", "held"]);
    expect(await draftRow(draft.id)).toMatchObject({ state: "submitted", revision: 2 });
    expect(await storedLines(draft.id)).toEqual([]);
    expect(await draftsOf(v, partyId)).toEqual([]);
    expect((await eventsOf(draft.id)).map(({ kind, detail }) => [kind, detail])).toEqual([
      ["created", {}],
      ["submitted", { groupIds: [drinks.groups[0]!.id] }],
      ["submitted", { groupIds: food.groups.map((group) => group.id) }],
    ]);
  });

  it("adds a submission to a held group named by joinGroupId", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const held = await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[0]!.id], release: "hold" },
    ]);
    const groupId = held.groups[0]!.id;

    const joined = await submit(
      v,
      partyId,
      held.draft!,
      ALEX,
      [{ lineIds: lineIds(held.draft!), release: "hold" }],
      { joinGroupId: groupId },
    );

    expect(joined.groups.map((group) => group.id)).toEqual([groupId]);
    expect((await tabLines(partyId)).map((row) => row.groupId)).toEqual([groupId, groupId]);
  });

  it("takes joinGroupId in upper case", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const held = await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[0]!.id], release: "hold" },
    ]);
    const groupId = held.groups[0]!.id;

    const joined = await submit(
      v,
      partyId,
      held.draft!,
      ALEX,
      [{ lineIds: lineIds(held.draft!), release: "hold" }],
      { joinGroupId: groupId.toUpperCase() },
    );

    expect(joined.groups.map((group) => group.id)).toEqual([groupId]);
    expect((await tabLines(partyId)).map((row) => row.groupId)).toEqual([groupId, groupId]);
  });

  it("answers a retried join whose group id differs only in case with the first result", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const held = await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[0]!.id], release: "hold" },
    ]);
    const groupId = held.groups[0]!.id;
    const retry = {
      submissionId: randomUUID(),
      partyRevision: await partyRevision(partyId),
    };
    const rest = [{ lineIds: lineIds(held.draft!), release: "hold" as const }];
    const first = await submit(v, partyId, held.draft!, ALEX, rest, {
      ...retry,
      joinGroupId: groupId,
    });
    const before = await everything();

    const again = await submit(v, partyId, held.draft!, ALEX, rest, {
      ...retry,
      joinGroupId: groupId.toUpperCase(),
    });

    expect(again).toEqual(first);
    expect(await everything()).toEqual(before);
  });
});

describe("what a submitted line carries", () => {
  it("puts each line's note, course, option and extras picks on the order", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sauce = [
      { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
    ];
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", {
        options: [v.rare],
        extras: sauce,
        note: "no salt",
        courseId: v.courseId,
      }),
    ]);

    await submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "hold" }]);

    expect(
      (await tabLines(partyId)).map(({ productId, note, courseId, extraListId }) => ({
        productId,
        note,
        courseId,
        extraListId,
      })),
    ).toEqual([
      { productId: v.productId.burger, note: "no salt", courseId: v.courseId, extraListId: null },
      {
        productId: v.productId.sauce,
        note: null,
        courseId: null,
        extraListId: v.sauceListId,
      },
    ]);
  });
});

describe("answers pricing would refuse as duplicates (a valid line never adds into one)", () => {
  const sauce = (v: Venue) => ({ productId: v.productId.sauce, quantity: 1 });
  const priced = ({ menuItemId, quantity, options, extras }: LineInput) => ({
    menuItemId,
    quantity,
    options,
    extras,
  });
  const cases: [
    string,
    (v: Venue) => LineInput,
    { code: string; params: Record<string, unknown> },
  ][] = [
    [
      "the same answer twice to one options list",
      (v) => item(v, "burger", { options: [v.rare, v.rare] }),
      { code: "options.invalid", params: { field: "listId" } },
    ],
    [
      "two answers to one options list",
      (v) => item(v, "burger", { options: [v.rare, v.well] }),
      { code: "options.invalid", params: { field: "listId" } },
    ],
    [
      "one extras list answered twice",
      (v) =>
        item(v, "burger", {
          options: [v.rare],
          extras: [
            { listId: v.sauceListId, picks: [sauce(v)] },
            { listId: v.sauceListId, picks: [sauce(v)] },
          ],
        }),
      { code: "extras.invalid", params: { field: "listId" } },
    ],
    [
      "one product picked twice from a list",
      (v) =>
        item(v, "burger", {
          options: [v.rare],
          extras: [{ listId: v.sauceListId, picks: [sauce(v), sauce(v)] }],
        }),
      { code: "extras.invalid", params: { field: "productId" } },
    ],
  ];

  it.each(cases)(
    "refuses %s at the save, whichever line comes first, with pricing's own code",
    async (_name, duplicated, expected) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
      const line = duplicated(v);
      const valid = { ...line, options: [v.rare], extras: [] };

      await refusedWritingNothing(
        () => save(v, partyId, ALEX, draft.id, 0, [valid, line]),
        expected,
      );
      await refusedWritingNothing(
        () => save(v, partyId, ALEX, draft.id, 0, [line, valid]),
        expected,
      );
      await refusedWritingNothing(
        () =>
          inTx(async (tx) =>
            submitGroups(tx, v.cfg, partyId, {
              submissionId: randomUUID(),
              expectedPartyRevision: await partyRevision(partyId),
              operatorId: ALEX,
              groups: [{ release: "fire", lines: [priced(line)] }],
            }),
          ),
        expected,
      );
    },
  );
});

describe("which lines a submission names", () => {
  const cases: [
    string,
    (draft: Draft, others: Draft) => { lineIds: string[]; release: GroupRelease }[],
    { code: string; params: Record<string, unknown> },
    SubmitOptions?,
  ][] = [
    ["no group", () => [], { code: "management.request_invalid", params: { field: "groups" } }],
    [
      "an id that is no line of any draft",
      () => [{ lineIds: [randomUUID()], release: "fire" }],
      { code: "management.request_invalid", params: { field: "groups" } },
    ],
    [
      "a line of another person's draft",
      (_draft, others) => [{ lineIds: lineIds(others), release: "fire" }],
      { code: "management.request_invalid", params: { field: "groups" } },
    ],
    [
      "a line twice in one group",
      (draft) => [{ lineIds: [draft.lines[0]!.id, draft.lines[0]!.id], release: "fire" }],
      { code: "management.request_invalid", params: { field: "groups" } },
    ],
    [
      "a line in two groups",
      (draft) => [
        { lineIds: [draft.lines[0]!.id], release: "fire" },
        { lineIds: [draft.lines[0]!.id], release: "hold" },
      ],
      { code: "management.request_invalid", params: { field: "groups" } },
    ],
    [
      "an id that is not text",
      () => [{ lineIds: [42 as unknown as string], release: "fire" }],
      { code: "management.request_invalid", params: { field: "groups" } },
    ],
    [
      "a group with no lines",
      (draft) => [
        { lineIds: lineIds(draft), release: "fire" },
        { lineIds: [], release: "hold" },
      ],
      { code: "sale.empty_basket", params: {} },
    ],
    [
      "a group to join beside a second group",
      (draft) => [
        { lineIds: [draft.lines[0]!.id], release: "hold" },
        { lineIds: [draft.lines[1]!.id], release: "hold" },
      ],
      { code: "management.request_invalid", params: { field: "joinGroupId" } },
      { joinGroupId: randomUUID() },
    ],
    [
      "a group to join released now",
      (draft) => [{ lineIds: lineIds(draft), release: "fire" }],
      { code: "management.request_invalid", params: { field: "joinGroupId" } },
      { joinGroupId: randomUUID() },
    ],
  ];

  it.each(cases)("refuses %s, writing nothing", async (_name, groups, expected, opts) => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const others = await save(v, partyId, SAM, null, 0, [item(v, "wine", { variantId: v.glass })]);

    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, groups(draft, others), opts),
      expected,
    );
  });

  it("refuses a line already submitted, writing nothing", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const { draft: rest } = await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[0]!.id], release: "fire" },
    ]);

    await refusedWritingNothing(
      () => submit(v, partyId, rest!, ALEX, [{ lineIds: [draft.lines[0]!.id], release: "fire" }]),
      { code: "management.request_invalid", params: { field: "groups" } },
    );
  });

  it("takes line and draft ids in upper case, and replays a retry however its ids are spelled", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const submissionId = randomUUID();
    const upper = { id: draft.id.toUpperCase(), revision: draft.revision };
    const first = await submit(
      v,
      partyId,
      upper,
      ALEX,
      [{ lineIds: [draft.lines[0]!.id.toUpperCase()], release: "fire" }],
      { submissionId },
    );
    expect(first.draft!.lines.map((line) => line.id)).toEqual([draft.lines[1]!.id]);

    expect(
      await submit(v, partyId, draft, ALEX, [{ lineIds: [draft.lines[0]!.id], release: "fire" }], {
        submissionId,
      }),
    ).toEqual(first);
  });

  it("answers draft.not_found for an unknown or discarded draft, and party.not_open once the party has gone", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const unknown = randomUUID();
    await refusedWritingNothing(() => submit(v, partyId, { id: unknown, revision: 0 }, ALEX, []), {
      code: "draft.not_found",
      params: { draftId: unknown },
    });
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const sams = await save(v, partyId, SAM, null, 0, [item(v, "fish")]);
    await takeOver(v, partyId, alex.id, SAM, alex.revision);
    await refusedWritingNothing(
      () => submit(v, partyId, alex, SAM, [{ lineIds: lineIds(alex), release: "fire" }]),
      { code: "draft.not_found", params: { draftId: alex.id } },
    );

    await db
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString() })
      .where(eq(parties.id, partyId));
    await refusedWritingNothing(
      () =>
        submit(v, partyId, { id: sams.id, revision: 1 }, SAM, [{ lineIds: [], release: "fire" }]),
      { code: "party.not_open", params: { partyId } },
    );
  });
});

describe("unavailable lines at submission (spec §10)", () => {
  it("refuses a sold-out dish with nothing written, sends the other lines alone, and keeps the sold-out line", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), burger(v)]);
    const [beer, burgerLine] = draft.lines;
    await db.run(sql`update products set available = 0 where id = ${v.productId.burger}`);

    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      { code: "product.unavailable", params: { productId: v.productId.burger } },
    );

    const { draft: rest } = await submit(v, partyId, draft, ALEX, [
      { lineIds: [beer!.id], release: "fire" },
    ]);
    expect(rest!.lines).toEqual([{ ...burgerLine, unavailable: true }]);
    expect((await tabLines(partyId)).map((row) => row.productId)).toEqual([v.productId.beer]);

    await db.run(sql`update products set available = 1 where id = ${v.productId.burger}`);
    expect((await draftsOf(v, partyId))[0]!.lines).toEqual([burgerLine]);
  });

  it("refuses at submission a menu item the zone does not offer (service_zone.offer_not_allowed)", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { menuItemId: randomUUID() }),
    ]);

    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      { code: "service_zone.offer_not_allowed" },
    );
  });

  it("refuses at submission a fractional quantity of a dish sold whole (quantity.invalid)", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer", { quantity: "1.5" })]);

    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      { code: "quantity.invalid" },
    );
  });
});

describe("pricing (D9)", () => {
  it("refuses a draft line priced against a menu version since replaced, as M7 refuses a stale basket", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { menuVersionId: v.versionId }),
    ]);
    const live = await inTx(async (tx) => {
      await updateMenuItem(tx, v.menuId, v.offer("beer"), { grossPrice: "3.50" });
      return publishWorkingMenu(tx, v.menuId);
    });

    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      {
        code: "menu.version_changed",
        params: { menus: [{ menuId: v.menuId, liveVersionId: live }] },
      },
    );

    const current = await save(v, partyId, ALEX, draft.id, draft.revision, [
      item(v, "beer", { menuVersionId: live }),
    ]);
    const { groups } = await submit(v, partyId, current, ALEX, [
      { lineIds: lineIds(current), release: "fire" },
    ]);
    expect(groups).toHaveLength(1);
  });
});

/** `into` joins `from`'s table, combining the parties and merging their bills, as the till does. */
async function merge(v: Venue, into: Seated, from: Seated, operatorId: string): Promise<void> {
  const command = {
    bills: "merge" as const,
    expectedPartyRevision: await partyRevision(into.partyId),
    otherPartyId: from.partyId,
    expectedOtherPartyRevision: await partyRevision(from.partyId),
    operatorId,
  };
  await inTx((tx) => joinTables(tx, v.cfg, into.partyId, from.tableId, command));
}

async function openOwnersOn(partyId: string): Promise<string[]> {
  const rows = await db
    .select({ ownerId: orderDrafts.ownerId })
    .from(orderDrafts)
    .where(and(eq(orderDrafts.partyId, partyId), eq(orderDrafts.state, "open")));
  return rows.map((row) => row.ownerId).sort();
}

describe("merging parties (D2)", () => {
  it("moves the source's open drafts onto the target, and adds a person's source draft into their draft there, as a save adds lines, discarding it with an event", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const mia = randomUUID();
    const miasSent = await save(v, mesa5.partyId, mia, null, 0, [item(v, "fish")]);
    await submit(v, mesa5.partyId, miasSent, mia, [
      { lineIds: lineIds(miasSent), release: "fire" },
    ]);
    const sentRow = await draftRow(miasSent.id);
    const alexOn4 = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
    const alexOn5 = await save(v, mesa5.partyId, ALEX, null, 0, [
      item(v, "beer", { quantity: "2" }),
      burger(v),
    ]);
    const samOn5 = await save(v, mesa5.partyId, SAM, null, 0, [
      item(v, "wine", { variantId: v.glass }),
    ]);

    await merge(v, mesa4, mesa5, SAM);

    const [alex, sam] = byOwner(await draftsOf(v, mesa4.partyId));
    // Alex's source Beer adds into his Beer on the target, as a save would add it; the Burger goes
    // after his last line, keeping its id.
    expect(alex).toEqual({
      ...alexOn4,
      revision: alexOn4.revision + 1,
      lines: [{ ...alexOn4.lines[0]!, quantity: "3.000" }, alexOn4.lines[1], alexOn5.lines[1]],
    });
    expect((await storedLines(alexOn4.id)).map((row) => row.position)).toEqual([1, 2, 3]);
    expect(sam).toEqual({ ...samOn5, partyId: mesa4.partyId, revision: samOn5.revision + 1 });
    expect(await openOwnersOn(mesa4.partyId)).toEqual([ALEX, SAM].sort());
    expect(await draftsOf(v, mesa5.partyId)).toEqual([]);

    expect(await draftRow(alexOn5.id)).toMatchObject({
      partyId: mesa5.partyId,
      state: "discarded",
      ownerId: ALEX,
      revision: alexOn5.revision + 1,
    });
    expect(await storedLines(alexOn5.id)).toEqual([]);
    expect(await eventsOf(alexOn5.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
      {
        kind: "discarded",
        fromPerson: ALEX,
        toPerson: ALEX,
        actorId: SAM,
        detail: { intoDraftId: alexOn4.id },
      },
    ]);
    expect((await eventsOf(alexOn4.id)).map((event) => event.kind)).toEqual(["created"]);
    expect((await eventsOf(samOn5.id)).map((event) => event.kind)).toEqual(["created"]);
    // A draft that was no longer open stays with the party it was sent from.
    expect(await draftRow(miasSent.id)).toEqual(sentRow);

    // The source's table now seats the target's party, and shows its unsent orders.
    expect(await unsentDraftsAt(v, mesa5.tableId)).toEqual([
      { ownerName: "Alex", lineCount: 3 },
      { ownerName: "Sam", lineCount: 1 },
    ]);
  });

  it("refuses a save prepared before the merge, on the closed party or the one the draft moved to", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const alexOn4 = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer")]);
    const alexOn5 = await save(v, mesa5.partyId, ALEX, null, 0, [item(v, "fish")]);
    const samOn5 = await save(v, mesa5.partyId, SAM, null, 0, [item(v, "fish")]);

    await merge(v, mesa4, mesa5, SAM);

    for (const [partyId, draft, operatorId, code] of [
      [mesa5.partyId, samOn5, SAM, "party.not_open"],
      [mesa4.partyId, samOn5, SAM, "draft.out_of_date"],
      [mesa5.partyId, alexOn5, ALEX, "party.not_open"],
      [mesa4.partyId, alexOn5, ALEX, "draft.not_found"],
      [mesa4.partyId, alexOn4, ALEX, "draft.out_of_date"],
    ] as const) {
      await refusedWritingNothing(
        () => save(v, partyId, operatorId, draft.id, draft.revision, [item(v, "wine")]),
        { code },
      );
    }
    const sam = await save(v, mesa4.partyId, SAM, samOn5.id, samOn5.revision + 1, [
      item(v, "fish", { quantity: "2" }),
    ]);
    expect(orders(sam)).toEqual([
      { menuItemId: v.offer("fish"), quantity: "2.000", unavailable: false },
    ]);
  });
});

describe("a retried submission of a draft a merge moved or discarded", () => {
  it("answers the first result when the draft was added into its owner's draft on the target and discarded", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "fish")]);
    const alexOn5 = await save(v, mesa5.partyId, ALEX, null, 0, [item(v, "beer"), burger(v)]);
    const submissionId = randomUUID();
    const partyRevisionSeen = await partyRevision(mesa5.partyId);
    const sent = [{ lineIds: [alexOn5.lines[0]!.id], release: "fire" as const }];
    const first = await submit(v, mesa5.partyId, alexOn5, ALEX, sent, { submissionId });
    await merge(v, mesa4, mesa5, SAM);
    const before = await everything();

    const again = await submit(v, mesa5.partyId, alexOn5, ALEX, sent, {
      submissionId,
      partyRevision: partyRevisionSeen,
    });

    expect(again).toEqual(first);
    expect(await everything()).toEqual(before);
  });

  it("answers the first result when asked on the party the draft was sent from, and refuses it as out of date on the party it moved to", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const samOn5 = await save(v, mesa5.partyId, SAM, null, 0, [item(v, "beer"), item(v, "fish")]);
    const submissionId = randomUUID();
    const input = {
      operatorId: SAM,
      submissionId,
      draftRevision: samOn5.revision,
      expectedPartyRevision: await partyRevision(mesa5.partyId),
      groups: [{ lineIds: [samOn5.lines[0]!.id], release: "fire" as const }],
    };
    const first = await inTx((tx) => submitDraft(tx, v.cfg, mesa5.partyId, samOn5.id, input));
    await merge(v, mesa4, mesa5, SAM);
    const before = await everything();

    const again = await inTx((tx) => submitDraft(tx, v.cfg, mesa5.partyId, samOn5.id, input));

    expect(again).toEqual(first);
    expect(await everything()).toEqual(before);
    await refusedWritingNothing(
      () => inTx((tx) => submitDraft(tx, v.cfg, mesa4.partyId, samOn5.id, input)),
      {
        code: "draft.out_of_date",
        params: { draftId: samOn5.id, revision: samOn5.revision + 2 },
      },
    );
  });
});

describe("a draft named on another party", () => {
  it("is not found for a takeover or a submission scoped to that party", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const mesa5 = await seated(v, "Mesa 5");
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer")]);

    await refusedWritingNothing(
      () => inTx((tx) => takeOverDraft(tx, v.cfg, mesa5.partyId, alex.id, SAM, alex.revision)),
      { code: "draft.not_found", params: { draftId: alex.id } },
    );
    await refusedWritingNothing(
      () =>
        inTx(async (tx) =>
          submitDraft(tx, v.cfg, mesa5.partyId, alex.id, {
            operatorId: ALEX,
            submissionId: randomUUID(),
            draftRevision: alex.revision,
            expectedPartyRevision: await partyRevision(mesa5.partyId),
            groups: [{ lineIds: lineIds(alex), release: "fire" }],
          }),
        ),
      { code: "draft.not_found", params: { draftId: alex.id } },
    );
    const taken = await inTx((tx) =>
      takeOverDraft(tx, v.cfg, mesa4.partyId, alex.id, SAM, alex.revision),
    );
    expect(taken.ownerId).toBe(SAM);
  });
});

describe("finishing the table", () => {
  it("discards every open draft on the party, keeping its lines, with an event naming who finished", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const sam = await save(v, partyId, SAM, null, 0, [item(v, "fish"), burger(v)]);
    const kept = { alex: await storedLines(alex.id), sam: await storedLines(sam.id) };

    const { state } = await inTx(async (tx) =>
      finishTable(tx, {
        partyId,
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: SAM,
      }),
    );

    expect(state).toBe("closed");
    for (const [draft, owner] of [
      [alex, ALEX],
      [sam, SAM],
    ] as const) {
      expect(await draftRow(draft.id)).toMatchObject({
        state: "discarded",
        revision: draft.revision + 1,
      });
      expect((await eventsOf(draft.id)).at(-1)).toEqual({
        kind: "discarded",
        fromPerson: owner,
        toPerson: owner,
        actorId: SAM,
        detail: {},
      });
    }
    expect(await storedLines(alex.id)).toEqual(kept.alex);
    expect(await storedLines(sam.id)).toEqual(kept.sam);
    expect(await draftsOf(v, partyId)).toEqual([]);
    await expect(
      save(v, partyId, ALEX, alex.id, alex.revision + 1, [item(v, "beer")]),
    ).rejects.toMatchObject({ code: "party.not_open" });
  });

  it("leaves the drafts open when finishing is refused", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const sam = await save(v, partyId, SAM, null, 0, [item(v, "fish")]);
    await submit(v, partyId, sam, SAM, [{ lineIds: lineIds(sam), release: "fire" }]);

    await refusedWritingNothing(
      () =>
        inTx(async (tx) =>
          finishTable(tx, {
            partyId,
            expectedPartyRevision: await partyRevision(partyId),
            operatorId: SAM,
          }),
        ),
      { code: "party.bill_outstanding" },
    );
  });
});
