import { readBillEditState } from "./bill-editing.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  saveDraftForTest as saveDraft,
  takeOverDraftForTest as takeOverDraft,
} from "./testing/draft-command-fixture.js";
import * as orderWrites from "./working-order.js";
import * as groupWrites from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
import { AppError, decimal } from "@waitron/shared";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "@waitron/venue-service";
import { deleteCourse } from "./course-delete.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  kitchenTimingDefaults,
  locations,
  orderDraftEvents,
  orderDraftLines,
  orderDraftRecalledLines,
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
  units,
  writeProductModifiers,
} from "@waitron/catalogue";
import { persons } from "@waitron/identity";
import { locationId as brandLocationId, nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import type { OptionSelection } from "@waitron/shared";
import type { OriginConfig } from "./till-config.js";
import { createCourse } from "./kitchen.js";
import { createTable } from "./testing/live-table.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { finishTable, seatTable } from "./parties.js";
import { listTablesWithState } from "./working-order.js";
import { submitGroups } from "./order-groups.js";
import type { GroupRelease } from "./order-groups.js";
import { discardPartyDrafts, readDrafts, submitDraft } from "./order-drafts.js";
import type { Draft, FreshDraftLine } from "./order-drafts.js";
import "./errors.js";
import { mergeBills, splitBill } from "./testing/bill-action-fixture.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { saveRecalledLine } from "./draft-recall.js";

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
  /** The Wine's variants: the glass is Available and the bottle sold out. */
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
  await db.insert(kitchenTimingDefaults).values({ locationId: location!.id });
  const locationId = location!.id;
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
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
          available: false,
        },
      ],
      LOCALE,
    );
    await assignCatalogueToLocation(tx, locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    await setMenuVariants(tx, offers.offerFor(productId.wine), [
      { variantId: glass!.id, price: "4.00" },
      { variantId: bottle!.id, price: "18.00" },
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

type LineInput = Omit<FreshDraftLine, "id" | "unavailable">;

function item(v: Venue, dish: Dish, overrides: Partial<LineInput> = {}): LineInput {
  return {
    sourceLineId: null,
    source: null,
    menuItemId: v.offer(dish),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
    slot: 0,
    joinGroupId: null,
    afterGroupId: null,
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
  return inTx(async (tx) => {
    const [bill] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId))
      .limit(1);
    const [draft] =
      draftId === null
        ? []
        : await tx
            .select({ billId: orderDrafts.billId })
            .from(orderDrafts)
            .where(eq(orderDrafts.id, draftId));
    return saveDraft(tx, v.cfg, partyId, operatorId, {
      billId: draft?.billId ?? bill?.id ?? randomUUID(),
      draftId,
      revision,
      lines: lines as LineInput[],
    });
  });
}

async function saveOnSeparateBill(
  v: Venue,
  partyId: string,
  operatorId: string,
  _draftId: string | null,
  _revision: number,
  lines: unknown[],
): Promise<Draft> {
  return inTx(async (tx) => {
    const [source] = await tx
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId));
    const billId = randomUUID();
    await orderWrites.createOpenOrder(tx, v.cfg, billId, [], "Separate bill", {
      partyId,
      existingService: true,
      copyServiceContextFrom: source!.id,
    });
    return saveDraft(tx, v.cfg, partyId, operatorId, { billId, draftId: null, revision: 0, lines });
  });
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
    const sam = await saveOnSeparateBill(v, mesa4.partyId, SAM, null, 0, [item(v, "fish")]);

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
      params: { draftId: draft.id, ownerId: nobody, ownerName: null },
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
        course: { id: v.courseId, name: "Mains", displayOrder: 1, heldUntilFired: true },
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
        course: { id: v.courseId, name: "Mains", displayOrder: 1, heldUntilFired: true },
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
        sourceLineId: null,
        source: null,
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
        slot: 0,
        joinGroupId: null,
        afterGroupId: null,
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
      code: "management.request_invalid",
      params: { field: "expectedEdit.draftId" },
    });
    await expect(takeOver(v, mesa4.partyId, "draft-1", SAM, 0)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "draftId" },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, other.id));
    await expect(save(v, mesa5.partyId, ALEX, other.id, 0, [])).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { billId: other.billId, draftId: null, revision: null },
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

describe("draft bill ownership", () => {
  async function otherBill(v: Venue, partyId: string, tabId: string): Promise<string> {
    const id = randomUUID();
    await inTx((tx) =>
      orderWrites.createOpenOrder(tx, v.cfg, id, [], "Bill 2", {
        partyId,
        existingService: true,
        copyServiceContextFrom: tabId,
      }),
    );
    return id;
  }

  function onBill(v: Venue, partyId: string, billId: string, ownerId = ALEX, draft?: Draft) {
    return inTx((tx) =>
      saveDraft(tx, v.cfg, partyId, ownerId, {
        billId,
        draftId: draft?.id ?? null,
        revision: draft?.revision ?? 0,
        lines: [item(v, "fish")],
      }),
    );
  }

  it("keeps one owner's drafts on two bills separate and refuses a second draft on the same bill", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const secondId = await otherBill(v, partyId, tabId);
    const first = await onBill(v, partyId, tabId.toUpperCase());
    const second = await onBill(v, partyId, secondId);

    expect(first).toMatchObject({ billId: tabId });
    expect(second).toMatchObject({ billId: secondId });
    expect(first.id).not.toBe(second.id);
    expect(await draftsOf(v, partyId)).toEqual([first, second]);
    expect(await draftRow(first.id)).toMatchObject({ billId: tabId });
    expect(await draftRow(second.id)).toMatchObject({ billId: secondId });
    await refusedWritingNothing(() => onBill(v, partyId, tabId), {
      code: "draft.out_of_date",
      params: { draftId: first.id, revision: 0 },
    });
  });

  it.each([undefined, null, "", "not-a-uuid", [], {}])(
    "refuses an invalid required bill %j",
    async (billId) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      await refusedWritingNothing(() => onBill(v, partyId, billId as string), {
        code: "management.request_invalid",
        params: { field: "billId" },
      });
    },
  );

  it("refuses changing an existing draft to another bill", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const second = await otherBill(v, partyId, tabId);
    const draft = await onBill(v, partyId, tabId);
    await refusedWritingNothing(() => onBill(v, partyId, second, ALEX, draft), {
      code: "management.request_invalid",
      params: { field: "billId" },
    });
  });

  it("refuses a bill from another party and a missing bill", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const other = await seated(v, "Mesa 7");
    await refusedWritingNothing(() => onBill(v, partyId, other.tabId), {
      code: "bill.other_party",
      params: { workingOrderId: other.tabId },
    });
    const missing = randomUUID();
    await refusedWritingNothing(() => onBill(v, partyId, missing), {
      code: "tab.not_open",
      params: { tabId: missing },
    });
  });

  it.each([
    ["settled", "bill.paid"],
    ["placed", "bill.presented"],
    ["abandoned", "tab.not_open"],
  ] as const)("refuses new saves, edits and takeovers on a %s bill", async (status, code) => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const draft = await onBill(v, partyId, tabId);
    await db
      .update(workingOrders)
      .set({ status, settledAt: status === "settled" ? "2026-10-17T00:00:00.000Z" : null })
      .where(eq(workingOrders.id, tabId));
    const error = { code, params: status === "abandoned" ? { tabId } : { workingOrderId: tabId } };
    await refusedWritingNothing(() => onBill(v, partyId, tabId, SAM), error);
    await refusedWritingNothing(() => onBill(v, partyId, tabId, ALEX, draft), error);
    await refusedWritingNothing(() => takeOver(v, partyId, draft.id, SAM, draft.revision), error);
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      error,
    );
  });

  it("refuses saves and takeovers while the draft's bill is payment-locked", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const draft = await onBill(v, partyId, tabId);
    await db
      .update(workingOrders)
      .set({ paymentAttemptAt: "2026-10-17T00:00:00.000Z" })
      .where(eq(workingOrders.id, tabId));
    const error = { code: "order.payment_in_flight", params: { workingOrderId: tabId } };
    await refusedWritingNothing(() => onBill(v, partyId, tabId, SAM), error);
    await refusedWritingNothing(() => onBill(v, partyId, tabId, ALEX, draft), error);
    await refusedWritingNothing(() => takeOver(v, partyId, draft.id, SAM, draft.revision), error);
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      error,
    );
  });

  it("sends to the draft's recorded bill even while another bill is main", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const billId = await otherBill(v, partyId, tabId);
    const draft = await onBill(v, partyId, billId);
    const sent = await submit(v, partyId, draft, ALEX, [
      { lineIds: lineIds(draft), release: "fire" },
    ]);
    expect(sent.tabId).toBe(billId);
    expect((await tabLines(partyId)).map(({ workingOrderId }) => workingOrderId)).toEqual([billId]);
    const [party] = await db.select().from(parties).where(eq(parties.id, partyId));
    expect(party!.mainBillId).toBe(tabId);
  });

  it("refuses a legacy draft without a bill instead of interpreting it as the main bill", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const draft = await onBill(v, partyId, tabId);
    await db.update(orderDrafts).set({ billId: null }).where(eq(orderDrafts.id, draft.id));
    const error = { code: "management.request_invalid", params: { field: "billId" } };
    await refusedWritingNothing(
      () => submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
      error,
    );
    await refusedWritingNothing(() => takeOver(v, partyId, draft.id, SAM, draft.revision), error);
    await refusedWritingNothing(() => onBill(v, partyId, tabId, ALEX, draft), error);
    await expect(draftsOf(v, partyId)).rejects.toMatchObject(error);
  });

  it("takes over on the source bill without absorbing the taker's draft on another bill", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const secondId = await otherBill(v, partyId, tabId);
    const sam = await onBill(v, partyId, tabId, SAM);
    const alex = await onBill(v, partyId, secondId);

    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);

    expect(taken).toMatchObject({ id: alex.id, billId: secondId, ownerId: SAM, revision: 1 });
    expect(taken.lines).toEqual(alex.lines);
    expect(await draftRow(sam.id)).toMatchObject({ billId: tabId, revision: 0, state: "open" });
    expect(await storedLines(sam.id)).toHaveLength(1);
    expect((await draftsOf(v, partyId)).map(({ id }) => id)).toEqual([sam.id, alex.id]);
  });

  it("a colleague cannot create a second outbox and takeover retains the single existing one", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const secondId = await otherBill(v, partyId, tabId);
    const samFirst = await onBill(v, partyId, tabId, SAM);
    const alex = await onBill(v, partyId, secondId);
    await refusedWritingNothing(() => onBill(v, partyId, secondId, SAM), {
      code: "draft.taken_over",
      params: { billId: secondId, draftId: alex.id, ownerId: ALEX },
    });
    const firstRows = await storedLines(samFirst.id);
    const alexRows = await storedLines(alex.id);
    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);
    expect(taken).toMatchObject({ id: alex.id, billId: secondId, ownerId: SAM, revision: 1 });
    expect(taken.lines).toEqual(alex.lines);
    expect(await draftRow(samFirst.id)).toMatchObject({
      billId: tabId,
      revision: 0,
      state: "open",
    });
    expect(await storedLines(samFirst.id)).toEqual(firstRows);
    expect(await storedLines(alex.id)).toEqual(alexRows);
    expect(await draftsOf(v, partyId)).toEqual([samFirst, taken]);
  });

  it("shows one floor summary per owner across bills while keeping people with the same name separate", async () => {
    const v = await setupVenue();
    const { partyId, tabId, tableId } = await seated(v);
    const secondId = await otherBill(v, partyId, tabId);
    await db
      .update(persons)
      .set({ displayName: "Alex", status: "suspended" })
      .where(eq(persons.id, SAM));
    await onBill(v, partyId, tabId);
    await onBill(v, partyId, secondId);
    const thirdId = await otherBill(v, partyId, tabId);
    await onBill(v, partyId, thirdId, SAM);
    expect(await unsentDraftsAt(v, tableId)).toEqual([
      { ownerName: "Alex", lineCount: 2 },
      { ownerName: "Alex", lineCount: 1 },
    ]);
    expect(
      (await draftsOf(v, partyId)).map(({ billId, ownerId }) => ({ billId, ownerId })),
    ).toEqual([
      { billId: tabId, ownerId: ALEX },
      { billId: secondId, ownerId: ALEX },
      { billId: thirdId, ownerId: SAM },
    ]);
  });
});

describe("stable fresh draft line identities", () => {
  it("keeps retained IDs, updates every choice and placement, and assigns only new rows a new ID", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "burger"), item(v, "fish")]);
    const [burgerLine, fishLine] = first.lines;
    const changed = {
      ...item(v, "burger"),
      id: burgerLine!.id.toUpperCase(),
      quantity: "3",
      note: "No salt",
      courseId: v.courseId,
      options: [v.rare],
      extras: withSauce(v),
      slot: 2,
      noMerge: true,
    };
    const second = await save(v, partyId, ALEX, first.id, first.revision, [
      { ...item(v, "fish"), id: fishLine!.id },
      changed,
      item(v, "beer"),
    ]);
    expect(second.lines).toMatchObject([
      { id: fishLine!.id, quantity: "1.000" },
      { ...changed, id: burgerLine!.id, quantity: "3.000" },
      { menuItemId: v.offer("beer"), quantity: "1.000" },
    ]);
    expect(second.lines[2]!.id).not.toBe(burgerLine!.id);
    expect(second.lines[2]!.id).not.toBe(fishLine!.id);
    expect((await storedLines(first.id)).map(({ id, position }) => ({ id, position }))).toEqual([
      { id: fishLine!.id, position: 1 },
      { id: burgerLine!.id, position: 2 },
      { id: second.lines[2]!.id, position: 3 },
    ]);
    expect((await draftsOf(v, partyId))[0]!.lines).toEqual(second.lines);
    const taken = await takeOver(v, partyId, second.id, SAM, second.revision);
    expect(taken.lines).toEqual(second.lines);
    const savedAgain = await save(v, partyId, SAM, taken.id, taken.revision, taken.lines);
    expect(savedAgain.lines).toEqual(second.lines);
  });

  it.each([null, "", "not-an-id", 4, [], {}])(
    "refuses malformed explicit row ID %j",
    async (id) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
      await refusedWritingNothing(
        () => save(v, partyId, ALEX, draft.id, draft.revision, [{ ...item(v, "fish"), id }]),
        { code: "management.request_invalid", params: { field: "lines.0.id" } },
      );
    },
  );

  it.each(["unknown", "other owner", "other bill", "new draft"])(
    "refuses a row ID from %s without changing either draft",
    async (origin) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const own = await save(v, partyId, ALEX, null, 0, [item(v, "burger")]);
      const other = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish")]);
      const anotherTable = await seated(v, "Other table");
      const anotherBill = await save(v, anotherTable.partyId, ALEX, null, 0, [item(v, "wine")]);
      const id =
        origin === "unknown"
          ? randomUUID()
          : origin === "other bill"
            ? anotherBill.lines[0]!.id
            : other.lines[0]!.id;
      await refusedWritingNothing(
        () =>
          (origin === "new draft" ? saveOnSeparateBill : save)(
            v,
            partyId,
            origin === "new draft" ? SAM : ALEX,
            origin === "new draft" ? null : own.id,
            0,
            [{ ...item(v, "beer"), id }],
          ),
        { code: "management.request_invalid", params: { field: "lines.0.id" } },
      );
    },
  );

  it("refuses duplicate retained IDs before writing even when their dishes differ", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const id = draft.lines[0]!.id;
    await refusedWritingNothing(
      () =>
        save(v, partyId, ALEX, draft.id, draft.revision, [
          { ...item(v, "beer"), id },
          { ...item(v, "fish"), id: id.toUpperCase() },
        ]),
      { code: "management.request_invalid", params: { field: "lines.1.id" } },
    );
  });

  it("retains each guest's tick when identical assigned dishes are saved and taken over", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { noMerge: true }),
      item(v, "beer", { noMerge: true }),
    ]);
    const allergy = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        {
          answer: "allergies",
          guests: [
            { who: "Window", allergens: { milk: {} } },
            { who: "Door", allergens: { eggs: {} } },
          ],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(
        tx,
        partyId,
        draft.lines.map((line, index) => ({
          guestId: allergy.guests[index]!.id,
          draftLineId: line.id,
        })),
      ),
    );
    const ticks = (await inTx((tx) => readPartyAllergy(tx, partyId))).ticks;
    const saved = await save(
      v,
      partyId,
      ALEX,
      draft.id,
      draft.revision,
      draft.lines.map((line) => ({ ...line, quantity: "2", noMerge: false })),
    );
    expect(saved.lines.map(({ id, quantity }) => ({ id, quantity }))).toEqual([
      { id: draft.lines[0]!.id, quantity: "2.000" },
      { id: draft.lines[1]!.id, quantity: "2.000" },
    ]);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(ticks);
    const taken = await takeOver(v, partyId, saved.id, SAM, saved.revision);
    expect(taken.lines).toEqual(saved.lines);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(ticks);
    const reduced = await save(v, partyId, SAM, taken.id, taken.revision, [taken.lines[1]!]);
    expect(reduced.lines[0]!.id).toBe(draft.lines[1]!.id);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual([
      { guestId: allergy.guests[1]!.id, draftLineId: draft.lines[1]!.id, workingLineId: null },
    ]);
  });
});

describe("draft placement persistence", () => {
  it.each(["fire", "new", "join", "after"] as const)(
    "keeps the %s destination through save, replacement, read and takeover",
    async (kind) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const groupId = randomUUID();
      await db.insert(orderGroups).values({
        id: groupId,
        partyId,
        position: 1,
        state: "held",
        submittedBy: ALEX,
      });
      const place = {
        slot: kind === "new" || kind === "after" ? 2 : 0,
        joinGroupId: kind === "join" ? groupId : null,
        afterGroupId: kind === "after" ? groupId : null,
      };
      const sent = {
        ...item(v, "beer"),
        ...place,
        joinGroupId: place.joinGroupId?.toUpperCase() ?? null,
        afterGroupId: place.afterGroupId?.toUpperCase() ?? null,
      };
      const first = await save(v, partyId, ALEX, null, 0, [sent]);
      expect(first.lines).toMatchObject([{ ...place, quantity: "1.000" }]);
      expect(await storedLines(first.id)).toMatchObject([place]);
      const second = await save(v, partyId, ALEX, first.id, first.revision, [
        { ...sent, quantity: "2" },
      ]);
      expect(second.lines).toMatchObject([{ ...place, quantity: "2.000" }]);
      expect((await draftsOf(v, partyId))[0]!.lines).toEqual(second.lines);
      expect((await takeOver(v, partyId, second.id, SAM, second.revision)).lines).toEqual(
        second.lines,
      );
    },
  );

  it("keeps identical dishes apart by destination while adding quantities within each destination", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const g1 = randomUUID(),
      g2 = randomUUID();
    await db.insert(orderGroups).values([
      { id: g1, partyId, position: 1, state: "held", submittedBy: ALEX },
      { id: g2, partyId, position: 2, state: "held", submittedBy: ALEX },
    ]);
    const places = [
      { slot: 0, joinGroupId: null, afterGroupId: null },
      { slot: 1, joinGroupId: null, afterGroupId: null },
      { slot: 2, joinGroupId: null, afterGroupId: null },
      { slot: 0, joinGroupId: g1, afterGroupId: null },
      { slot: 0, joinGroupId: g2, afterGroupId: null },
      { slot: 3, joinGroupId: null, afterGroupId: g1 },
      { slot: 4, joinGroupId: null, afterGroupId: g2 },
    ];
    const draft = await save(
      v,
      partyId,
      ALEX,
      null,
      0,
      places.flatMap((place) => [
        { ...item(v, "beer"), ...place },
        { ...item(v, "beer", { quantity: "2" }), ...place },
      ]),
    );
    expect(
      draft.lines.map(({ slot, joinGroupId, afterGroupId, quantity }) => ({
        slot,
        joinGroupId,
        afterGroupId,
        quantity,
      })),
    ).toEqual(places.map((place) => ({ ...place, quantity: "3.000" })));
    expect(await draftsOf(v, partyId)).toEqual([draft]);
    expect(await storedLines(draft.id)).toMatchObject(places);
  });

  it("returns explicit Fire-now defaults when a caller leaves the placement fields out", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      { menuItemId: v.offer("beer"), quantity: "1" },
    ]);
    expect(draft.lines).toMatchObject([{ slot: 0, joinGroupId: null, afterGroupId: null }]);
    expect((await draftsOf(v, partyId))[0]!.lines).toEqual(draft.lines);
  });
});

describe("draft placement membership", () => {
  describe.each(["joinGroupId", "afterGroupId"] as const)("%s", (field) => {
    it.each(["foreign", "missing", "fired", "removed"] as const)(
      "refuses a %s target without changing the saved draft or its allergy ticks",
      async (state) => {
        const v = await setupVenue();
        const { partyId } = await seated(v);
        const other = await seated(v, "Mesa 7");
        const groupId = randomUUID();
        if (state !== "missing") {
          await db.insert(orderGroups).values({
            id: groupId,
            partyId: state === "foreign" ? other.partyId : partyId,
            position: 1,
            state: state === "foreign" ? "held" : state,
            firedAt: state === "fired" ? "2026-10-17T00:00:00.000Z" : null,
            submittedBy: ALEX,
          });
        }
        const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
        const allergy = await inTx((tx) =>
          savePartyAllergy(
            tx,
            partyId,
            0,
            {
              answer: "allergies",
              guests: [{ who: "Red coat", allergens: { fish: {} } }],
            },
            ALEX,
          ),
        );
        await inTx((tx) =>
          setAllergyLineTicks(tx, partyId, [
            {
              guestId: allergy.guests[0]!.id,
              draftLineId: draft.lines[0]!.id,
            },
          ]),
        );
        await refusedWritingNothing(
          () =>
            save(v, partyId, ALEX, draft.id, draft.revision, [
              { ...item(v, "beer"), slot: field === "afterGroupId" ? 1 : 0, [field]: groupId },
            ]),
          {
            code: state === "foreign" || state === "missing" ? "group.not_found" : "group.not_held",
            params: { groupId },
          },
        );
      },
    );

    it("keeps a saved target when it fires before the next save and read", async () => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const groupId = randomUUID();
      await db
        .insert(orderGroups)
        .values({ id: groupId, partyId, position: 1, state: "held", submittedBy: ALEX });
      const input = {
        ...item(v, "fish"),
        slot: field === "afterGroupId" ? 2 : 0,
        [field]: groupId,
      };
      const draft = await save(v, partyId, ALEX, null, 0, [input]);
      await db
        .update(orderGroups)
        .set({ state: "fired", firedAt: "2026-10-17T00:00:00.000Z" })
        .where(eq(orderGroups.id, groupId));
      await refusedWritingNothing(() => save(v, partyId, ALEX, draft.id, draft.revision, [input]), {
        code: "group.not_held",
        params: { groupId },
      });
      expect(await draftsOf(v, partyId)).toEqual([draft]);
    });
  });

  it.each([null, "another held group"])("refuses two anchors for one slot (%s)", async (anchor) => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = randomUUID(),
      second = randomUUID();
    await db.insert(orderGroups).values(
      [first, second].map((id, index) => ({
        id,
        partyId,
        position: index + 1,
        state: "held" as const,
        submittedBy: ALEX,
      })),
    );
    await refusedWritingNothing(
      () =>
        save(v, partyId, ALEX, null, 0, [
          item(v, "beer", { slot: 1, afterGroupId: first }),
          item(v, "fish", { slot: 1, afterGroupId: anchor === null ? null : second }),
        ]),
      { code: "management.request_invalid", params: { field: "lines.1.slot" } },
    );
  });
});

describe("draft placement input", () => {
  it.each([null, -1, 0.5, "1", true, [], {}, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses slot %j before replacing a draft",
    async (slot) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
      await refusedWritingNothing(
        () => save(v, partyId, ALEX, draft.id, draft.revision, [{ ...item(v, "beer"), slot }]),
        { code: "management.request_invalid", params: { field: "lines.0.slot" } },
      );
    },
  );

  describe.each(["joinGroupId", "afterGroupId"] as const)("%s", (field) => {
    it.each(["not-a-uuid", "", 1, true, [], {}])(
      "refuses %j before replacing a draft",
      async (value) => {
        const v = await setupVenue();
        const { partyId } = await seated(v);
        const draft = await save(v, partyId, ALEX, null, 0, [item(v, "fish")]);
        await refusedWritingNothing(
          () =>
            save(v, partyId, ALEX, draft.id, draft.revision, [
              { ...item(v, "beer"), slot: field === "afterGroupId" ? 1 : 0, [field]: value },
            ]),
          { code: "management.request_invalid", params: { field: `lines.0.${field}` } },
        );
      },
    );
  });

  it("refuses a join in a new-group slot", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await refusedWritingNothing(
      () =>
        save(v, partyId, ALEX, null, 0, [
          { ...item(v, "beer"), slot: 1, joinGroupId: randomUUID() },
        ]),
      { code: "management.request_invalid", params: { field: "lines.0.slot" } },
    );
  });

  it.each([undefined, 0])(
    "refuses an after-group id without a new-group slot (%j)",
    async (slot) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      await refusedWritingNothing(
        () =>
          save(v, partyId, ALEX, null, 0, [
            { ...item(v, "beer"), slot, afterGroupId: randomUUID() },
          ]),
        { code: "management.request_invalid", params: { field: "lines.0.afterGroupId" } },
      );
    },
  );

  it.each(["join", "after"] as const)("accepts a held group's UUID for %s", async (kind) => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const groupId = randomUUID();
    await db
      .insert(orderGroups)
      .values({ id: groupId, partyId, position: 1, state: "held", submittedBy: ALEX });
    const place =
      kind === "join"
        ? { slot: 0, joinGroupId: groupId.toUpperCase() }
        : { slot: 2, afterGroupId: groupId.toUpperCase() };
    const draft = await save(v, partyId, ALEX, null, 0, [{ ...item(v, "beer"), ...place }]);
    expect(orders(draft)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "1.000", unavailable: false },
    ]);
    expect(await draftsOf(v, partyId)).toEqual([draft]);
  });

  it("names the second line's bad placement and keeps the first unsaved", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await refusedWritingNothing(
      () => save(v, partyId, ALEX, null, 0, [item(v, "beer"), { ...item(v, "fish"), slot: -1 }]),
      { code: "management.request_invalid", params: { field: "lines.1.slot" } },
    );
  });

  it.each([
    {},
    { slot: 0 },
    { slot: 0, joinGroupId: null, afterGroupId: null },
    { slot: 1, joinGroupId: null, afterGroupId: null },
  ])("still saves ordinary lines with placement %j", async (place) => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [{ ...item(v, "beer"), ...place }]);
    expect(orders(draft)).toEqual([
      { menuItemId: v.offer("beer"), quantity: "1.000", unavailable: false },
    ]);
    expect(await draftsOf(v, partyId)).toEqual([draft]);
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
          billId: draft.billId,
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
    await db.insert(kitchenTimingDefaults).values({ locationId: elsewhere!.id });
    const { id: courseId } = await inTx((tx) =>
      createCourse(tx, { ...v.cfg, locationId: brandLocationId(elsewhere!.id) }, { name: "Mains" }),
    );

    await refusedWritingNothing(
      () => save(v, partyId, ALEX, draft.id, 0, [item(v, "beer", { courseId })]),
      { code: "course.not_found", params: { courseId } },
    );
  });

  it.each([true, false])(
    "retains a deleted draft course's held setting (%s) for placement after reload",
    async (heldUntilFired) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      await db
        .update(kitchenCourses)
        .set({ heldUntilFired })
        .where(eq(kitchenCourses.id, v.courseId));
      await save(v, partyId, ALEX, null, 0, [item(v, "beer", { courseId: v.courseId })]);
      await inTx((tx) => deleteCourse(tx, v.cfg, v.courseId));

      const [draft] = await draftsOf(v, partyId);
      expect(draft!.lines[0]!.course).toMatchObject({ id: v.courseId, heldUntilFired });
    },
  );

  it("reads authoritative retained course metadata and ignores spoofed read metadata on new selections", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { courseId: v.courseId }),
    ]);
    const [course] = await db
      .select({
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
        heldUntilFired: kitchenCourses.heldUntilFired,
      })
      .from(kitchenCourses)
      .where(eq(kitchenCourses.id, v.courseId));
    await inTx((tx) => deleteCourse(tx, v.cfg, v.courseId));
    const [retained] = await draftsOf(v, partyId);
    expect(retained!.lines[0]).toEqual({ ...draft.lines[0], course });
    await refusedWritingNothing(
      () =>
        saveOnSeparateBill(v, partyId, SAM, null, 0, [
          { ...item(v, "beer", { courseId: v.courseId }), course },
        ]),
      { code: "course.not_found", params: { courseId: v.courseId } },
    );
  });

  it("refuses a fresh selection of an inactive course without writing anything", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    await db.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, v.courseId));

    await refusedWritingNothing(
      () => save(v, partyId, ALEX, null, 0, [item(v, "beer", { courseId: v.courseId })]),
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

  it("answers draft.not_found for an unknown draft and draft.out_of_date for a closed one", async () => {
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
      code: "draft.out_of_date",
      params: {
        billId: draft.billId,
        draftId: null,
        revision: null,
        edit: await inTx((tx) => readBillEditState(tx, draft.billId)),
      },
    });
    await db.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draft.id));
    await expect(takeOver(v, partyId, draft.id, SAM, 0)).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: {
        billId: draft.billId,
        draftId: null,
        revision: null,
        edit: await inTx((tx) => readBillEditState(tx, draft.billId)),
      },
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

  it("compares a same-person takeover before its no-op and retains the current draft", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const draft = await save(v, partyId, ALEX, first.id, 0, [item(v, "fish")]);
    await refusedWritingNothing(() => takeOver(v, partyId, draft.id, ALEX, 0), {
      code: "draft.out_of_date",
      params: { draftId: draft.id, revision: 1 },
    });
    expect(await takeOver(v, partyId, draft.id, ALEX, 1)).toEqual(draft);
    expect(await draftRow(draft.id)).toMatchObject({ revision: 1, ownerId: ALEX });
    expect(await eventsOf(draft.id)).toHaveLength(1);
  });

  it("takes a bill in place while preserving the taker's own bill and its quantities", async () => {
    const v = await setupVenue();
    const mesa4 = await seated(v);
    const alex = await save(v, mesa4.partyId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    const sam = await saveOnSeparateBill(v, mesa4.partyId, SAM, null, 0, [
      item(v, "fish"),
      item(v, "beer", { quantity: "2" }),
    ]);
    const alexRows = await storedLines(alex.id);
    const samRows = await storedLines(sam.id);
    const taken = await takeOver(v, mesa4.partyId, alex.id, SAM, 0);
    expect(taken).toMatchObject({ id: alex.id, ownerId: SAM, ownerName: "Sam", revision: 1 });
    expect(orders(taken)).toEqual(orders(alex));
    expect(taken.lines.map((line) => line.id)).toEqual(alex.lines.map((line) => line.id));
    expect(await storedLines(alex.id)).toEqual(alexRows);
    expect(await storedLines(sam.id)).toEqual(samRows);
    expect(await draftsOf(v, mesa4.partyId)).toEqual([taken, sam]);
    expect(await draftRow(alex.id)).toMatchObject({ state: "open", ownerId: SAM, revision: 1 });
    expect(await eventsOf(alex.id)).toEqual([
      { kind: "created", fromPerson: null, toPerson: ALEX, actorId: ALEX, detail: {} },
      { kind: "taken_over", fromPerson: ALEX, toPerson: SAM, actorId: SAM, detail: {} },
    ]);
    expect(await unsentDraftsAt(v, mesa4.tableId)).toEqual([{ ownerName: "Sam", lineCount: 4 }]);
    await refusedWritingNothing(() => save(v, mesa4.partyId, ALEX, alex.id, 1, []), {
      code: "draft.taken_over",
      params: { draftId: alex.id, ownerId: SAM },
    });
  });
});

describe("taking over arranged draft lines", () => {
  it("keeps both bills' identical dishes, separate groups and quantities unchanged", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [
      item(v, "beer", { slot: 1 }),
      item(v, "fish", { slot: 3 }),
    ]);
    const alex = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { slot: 1 }),
      item(v, "fish", { slot: 3 }),
    ]);

    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);

    expect(taken.lines).toEqual(alex.lines);
    expect(
      (await storedLines(alex.id)).map(({ id, position, slot }) => ({ id, position, slot })),
    ).toEqual([
      { id: alex.lines[0]!.id, position: 1, slot: 1 },
      { id: alex.lines[1]!.id, position: 2, slot: 3 },
    ]);
    expect(
      (await storedLines(sam.id)).map(({ id, position, slot }) => ({ id, position, slot })),
    ).toEqual([
      { id: sam.lines[0]!.id, position: 1, slot: 1 },
      { id: sam.lines[1]!.id, position: 2, slot: 3 },
    ]);
    expect(await draftsOf(v, partyId)).toEqual([sam, taken]);
  });

  it("retains each bill's held anchors and slot numbers in place", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const first = randomUUID(),
      second = randomUUID();
    await db.insert(orderGroups).values(
      [first, second].map((id, index) => ({
        id,
        partyId,
        position: index + 1,
        state: "held" as const,
        submittedBy: ALEX,
      })),
    );
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [
      item(v, "beer", { slot: 2, afterGroupId: first }),
    ]);
    const alex = await save(v, partyId, ALEX, null, 0, [
      item(v, "fish", { slot: 2, afterGroupId: second }),
      item(v, "burger", { slot: 2, afterGroupId: second }),
    ]);

    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);

    expect(taken.lines).toEqual(alex.lines);
    expect(await draftsOf(v, partyId)).toEqual([sam, taken]);
  });

  it("keeps Fire-now, held joins and new-group slots unchanged on both bills", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const groupId = randomUUID();
    await db
      .insert(orderGroups)
      .values({ id: groupId, partyId, position: 1, state: "held", submittedBy: ALEX });
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [
      item(v, "beer", { slot: 2 }),
      item(v, "wine", { variantId: v.glass }),
      item(v, "fish", { joinGroupId: groupId }),
    ]);
    const alex = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { slot: 1 }),
      item(v, "wine", { variantId: v.glass, quantity: "2" }),
      item(v, "fish", { joinGroupId: groupId, quantity: "3" }),
    ]);

    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);

    expect(taken.lines).toEqual(alex.lines);
    expect(await draftsOf(v, partyId)).toEqual([sam, taken]);
    expect((await storedLines(alex.id)).map((row) => [row.id, row.slot, row.joinGroupId])).toEqual(
      alex.lines.map((line) => [line.id, line.slot, line.joinGroupId]),
    );
  });

  it("keeps the allergy tick and slot on an in-place transferred line", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish", { slot: 1 })]);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "fish", { slot: 1 })]);
    const allergy = await inTx((tx) =>
      savePartyAllergy(
        tx,
        partyId,
        0,
        {
          answer: "allergies",
          guests: [{ who: "Red coat", allergens: { fish: {} } }],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        {
          guestId: allergy.guests[0]!.id,
          draftLineId: alex.lines[0]!.id,
        },
      ]),
    );
    const before = await inTx((tx) => readPartyAllergy(tx, partyId));

    const taken = await takeOver(v, partyId, alex.id, SAM, alex.revision);

    expect(taken.lines).toEqual(alex.lines);
    expect(await draftsOf(v, partyId)).toEqual([sam, taken]);
    expect(await inTx((tx) => readPartyAllergy(tx, partyId))).toEqual(before);
    expect(await storedLines(alex.id)).toMatchObject([{ id: alex.lines[0]!.id, slot: 1 }]);
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
    const nobodys = await saveOnSeparateBill(v, partyId, nobody, null, 0, [item(v, "fish")]);
    const mia = randomUUID();
    await db.insert(persons).values({ id: mia, displayName: "Mia" });
    await saveOnSeparateBill(v, partyId, mia, null, 0, [item(v, "wine", { variantId: v.glass })]);
    await takeOver(v, partyId, alex.id, SAM, 0);
    await takeOver(v, partyId, nobodys.id, ALEX, 0);

    const read = byOwner(await draftsOf(v, partyId));
    expect(read.map(({ ownerId, takenOverFrom }) => ({ ownerId, takenOverFrom }))).toEqual([
      { ownerId: ALEX, takenOverFrom: { personId: nobody, name: "" } },
      { ownerId: mia, takenOverFrom: null },
      { ownerId: SAM, takenOverFrom: { personId: ALEX, name: "Alex" } },
    ]);
  });

  it("names the previous editor on the transferred bill and leaves the other bill unnamed", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish")]);

    const merged = await takeOver(v, partyId, alex.id, SAM, 0);
    expect(merged).toMatchObject({ id: alex.id, takenOverFrom: { personId: ALEX, name: "Alex" } });
    expect(await draftsOf(v, partyId)).toEqual([merged, sam]);
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
      "a sold-out variant",
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

  it("marks a line naming a sold-out or unknown variant, and not an Available one", async () => {
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
  it("creates no group, ticket or charge, records only the takeover replay and leaves the party revision alone", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const revision = await partyRevision(partyId);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "burger")]);
    await save(v, partyId, ALEX, alex.id, 0, [item(v, "beer", { quantity: "3" })]);
    await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish")]);
    await takeOver(v, partyId, alex.id, SAM, 1);

    expect(await partyRevision(partyId)).toBe(revision);
    expect(await db.select().from(orderGroups).where(eq(orderGroups.partyId, partyId))).toEqual([]);
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    ).toEqual([]);
    expect(await db.select().from(ticketItems)).toEqual([]);
    expect(await db.select().from(serviceCommands)).toMatchObject([{ kind: "draft.take-over" }]);
  });
});

interface SubmitOptions {
  submissionId?: string;
  draftRevision?: number;
  partyRevision?: number;
  joinGroupId?: string;
  expectedEdit?: Awaited<ReturnType<typeof expectedDraftEditForTest>>;
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
  return inTx(async (tx) =>
    submitDraft(tx, v.cfg, partyId, draft.id, {
      operatorId,
      submissionId: opts.submissionId ?? randomUUID(),
      expectedEdit:
        opts.expectedEdit ??
        (await expectedDraftEditForTest(tx, {
          id: draft.id,
          revision: opts.draftRevision ?? draft.revision,
        })),
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

  it("answers draft.out_of_date when Alex submits and THEN Sam takes over, leaving Alex's submitted draft", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const alex = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
    await submit(v, partyId, alex, ALEX, [{ lineIds: lineIds(alex), release: "fire" }]);
    const submitted = await draftRow(alex.id);
    expect(submitted).toMatchObject({ state: "submitted", ownerId: ALEX, revision: 1 });

    await refusedWritingNothing(() => takeOver(v, partyId, alex.id, SAM, submitted.revision), {
      code: "draft.out_of_date",
      params: {
        billId: alex.billId,
        draftId: null,
        revision: null,
        edit: await inTx((tx) => readBillEditState(tx, alex.billId)),
      },
    });
    expect(await draftRow(alex.id)).toEqual(submitted);
  });

  it("gives one success and one draft.out_of_date to two submits of a draft under different ids", async () => {
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
      {
        code: "draft.out_of_date",
        params: {
          billId: alex.billId,
          draftId: null,
          revision: null,
          edit: await inTx((tx) => readBillEditState(tx, alex.billId)),
        },
      },
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
      expectedEdit: await expectedDraftEditForTest(db, alex),
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
    const expectedEdit = await expectedDraftEditForTest(db, alex);
    const groups = [{ lineIds: lineIds(alex), release: "fire" as const }];
    const first = await submit(v, partyId, alex, ALEX, groups, { submissionId, expectedEdit });
    const after = await everything();

    expect(await submit(v, partyId, alex, ALEX, groups, { submissionId, expectedEdit })).toEqual(
      first,
    );
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
      expectedEdit: await expectedDraftEditForTest(db, held.draft!),
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
    const others = await saveOnSeparateBill(v, partyId, SAM, null, 0, [
      item(v, "wine", { variantId: v.glass }),
    ]);

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
    const expectedEdit = await expectedDraftEditForTest(db, draft);
    const upper = { id: draft.id.toUpperCase(), revision: draft.revision };
    const first = await submit(
      v,
      partyId,
      upper,
      ALEX,
      [{ lineIds: [draft.lines[0]!.id.toUpperCase()], release: "fire" }],
      { submissionId, expectedEdit },
    );
    expect(first.draft!.lines.map((line) => line.id)).toEqual([draft.lines[1]!.id]);

    expect(
      await submit(v, partyId, draft, ALEX, [{ lineIds: [draft.lines[0]!.id], release: "fire" }], {
        submissionId,
        expectedEdit,
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
    const sams = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish")]);
    await takeOver(v, partyId, alex.id, SAM, alex.revision);
    await refusedWritingNothing(
      () => submit(v, partyId, alex, SAM, [{ lineIds: lineIds(alex), release: "fire" }]),
      { code: "draft.out_of_date", params: { draftId: alex.id, revision: 1 } },
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
  it("keeps the same owner's drafts separate when the joined tables keep separate bills", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const from = await seated(v, "Mesa 7");
    const own = await save(v, into.partyId, ALEX, null, 0, [item(v, "beer", { slot: 1 })]);
    const incoming = await save(v, from.partyId, ALEX, null, 0, [item(v, "fish", { slot: 1 })]);
    await inTx((tx) =>
      joinTables(tx, v.cfg, into.partyId, from.tableId, {
        bills: "separate",
        expectedPartyRevision: 0,
        otherPartyId: from.partyId,
        expectedOtherPartyRevision: 0,
        operatorId: SAM,
      }),
    );
    const drafts = await draftsOf(v, into.partyId);
    expect(drafts).toEqual([own, { ...incoming, partyId: into.partyId, revision: 1 }]);
    expect(await draftRow(incoming.id)).toMatchObject({ billId: from.tabId, state: "open" });
    expect(await storedLines(incoming.id)).toHaveLength(1);
  });

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
    expect(sam).toEqual({
      ...samOn5,
      partyId: mesa4.partyId,
      billId: mesa4.tabId,
      revision: samOn5.revision + 1,
    });
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
    const expectedEdit = await expectedDraftEditForTest(db, alexOn5);
    const partyRevisionSeen = await partyRevision(mesa5.partyId);
    const sent = [{ lineIds: [alexOn5.lines[0]!.id], release: "fire" as const }];
    const first = await submit(v, mesa5.partyId, alexOn5, ALEX, sent, {
      submissionId,
      expectedEdit,
    });
    await merge(v, mesa4, mesa5, ALEX);
    const before = await everything();

    const again = await submit(v, mesa5.partyId, alexOn5, ALEX, sent, {
      submissionId,
      expectedEdit,
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
      expectedEdit: await expectedDraftEditForTest(db, samOn5),
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
            expectedEdit: await expectedDraftEditForTest(db, alex),
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
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish"), burger(v)]);
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
    const sam = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "fish")]);
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

describe("A669 allergy ticks on real draft submission", () => {
  it("maps reordered groups to their own guests, skips extras children and retains an unsent tick", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "burger", {
        options: [v.rare],
        extras: [{ listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] }],
      }),
      item(v, "fish"),
      item(v, "beer"),
    ]);
    const state = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        {
          answer: "allergies",
          guests: [
            { who: "Window seat", allergens: { milk: {} }, note: "Severe" },
            { who: "Red coat", allergens: { fish: {} } },
          ],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        { guestId: state.guests[0]!.id, draftLineId: draft.lines[0]!.id },
        { guestId: state.guests[1]!.id, draftLineId: draft.lines[1]!.id },
        { guestId: state.guests[1]!.id, draftLineId: draft.lines[2]!.id },
      ]),
    );
    await submit(v, partyId, draft, ALEX, [
      { lineIds: [draft.lines[1]!.id], release: "hold" },
      { lineIds: [draft.lines[0]!.id], release: "fire" },
    ]);
    const ticks = (await inTx((tx) => readPartyAllergy(tx, partyId))).ticks;
    const working = await db.select().from(workingOrderLines);
    expect(ticks).toHaveLength(3);
    expect(ticks).toEqual(
      expect.arrayContaining([
        {
          guestId: state.guests[0]!.id,
          draftLineId: null,
          workingLineId: working.find((line) => line.productId === v.productId.burger)!.id,
        },
        {
          guestId: state.guests[1]!.id,
          draftLineId: null,
          workingLineId: working.find((line) => line.productId === v.productId.fish)!.id,
        },
        { guestId: state.guests[1]!.id, draftLineId: draft.lines[2]!.id, workingLineId: null },
      ]),
    );
    const extra = working.find((line) => line.parentLineId !== null)!;
    expect(extra.productId).toBe(v.productId.sauce);
    expect(ticks.some((tick) => tick.workingLineId === extra.id)).toBe(false);
  });
});

it("A669 keeps separately assigned identical dishes when joining two drafts of the same owner", async () => {
  const v = await setupVenue();
  const a = await seated(v, "Allergy join A"),
    b = await seated(v, "Allergy join B");
  const da = await save(v, a.partyId, ALEX, null, 0, [item(v, "beer")]);
  const dbb = await save(v, b.partyId, ALEX, null, 0, [item(v, "beer")]);
  const ga = await inTx(async (tx) =>
    savePartyAllergy(
      tx,
      a.partyId,
      await partyRevision(a.partyId),
      { answer: "allergies", guests: [{ who: "Left seat", allergens: { milk: {} } }] },
      ALEX,
    ),
  );
  const gb = await inTx(async (tx) =>
    savePartyAllergy(
      tx,
      b.partyId,
      await partyRevision(b.partyId),
      { answer: "allergies", guests: [{ who: "Right seat", allergens: { eggs: {} } }] },
      ALEX,
    ),
  );
  await inTx((tx) =>
    setAllergyLineTicks(tx, a.partyId, [
      { guestId: ga.guests[0]!.id, draftLineId: da.lines[0]!.id },
    ]),
  );
  await inTx((tx) =>
    setAllergyLineTicks(tx, b.partyId, [
      { guestId: gb.guests[0]!.id, draftLineId: dbb.lines[0]!.id },
    ]),
  );
  await inTx(async (tx) =>
    joinTables(tx, v.cfg, a.partyId, b.tableId, {
      expectedPartyRevision: await partyRevision(a.partyId),
      operatorId: ALEX,
      bills: "separate",
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: await partyRevision(b.partyId),
    }),
  );
  const joined = await draftsOf(v, a.partyId);
  expect(joined).toHaveLength(2);
  expect(joined.map(({ billId }) => billId)).toEqual([a.tabId, b.tabId]);
  expect(joined.flatMap(({ lines }) => lines.map((line) => [line.id, line.quantity]))).toEqual([
    [da.lines[0]!.id, "1.000"],
    [dbb.lines[0]!.id, "1.000"],
  ]);
  const result = await inTx((tx) => readPartyAllergy(tx, a.partyId));
  expect(result.ticks).toHaveLength(2);
  expect(result.ticks).toEqual(
    expect.arrayContaining([
      { guestId: ga.guests[0]!.id, draftLineId: da.lines[0]!.id, workingLineId: null },
      { guestId: gb.guests[0]!.id, draftLineId: dbb.lines[0]!.id, workingLineId: null },
    ]),
  );
});

it("A669 uses preassigned dish ids when inserted rows return in reverse order", async () => {
  const v = await setupVenue();
  const { partyId } = await seated(v);
  const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer"), item(v, "fish")]);
  const state = await inTx(async (tx) =>
    savePartyAllergy(
      tx,
      partyId,
      await partyRevision(partyId),
      {
        answer: "allergies",
        guests: [
          { who: "Beer guest", allergens: { milk: {} } },
          { who: "Fish guest", allergens: { fish: {} } },
        ],
      },
      ALEX,
    ),
  );
  await inTx((tx) =>
    setAllergyLineTicks(tx, partyId, [
      { guestId: state.guests[0]!.id, draftLineId: draft.lines[0]!.id },
      { guestId: state.guests[1]!.id, draftLineId: draft.lines[1]!.id },
    ]),
  );
  const insert = orderWrites.insertTabRound;
  const spy = vi
    .spyOn(orderWrites, "insertTabRound")
    .mockImplementation(async (...args) => (await insert(...args)).reverse());
  try {
    await submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "hold" }]);
  } finally {
    spy.mockRestore();
  }
  const ticks = (await inTx((tx) => readPartyAllergy(tx, partyId))).ticks;
  const rows = await db.select().from(workingOrderLines);
  expect(ticks).toEqual(
    expect.arrayContaining([
      {
        guestId: state.guests[0]!.id,
        draftLineId: null,
        workingLineId: rows.find((row) => row.productId === v.productId.beer)!.id,
      },
      {
        guestId: state.guests[1]!.id,
        draftLineId: null,
        workingLineId: rows.find((row) => row.productId === v.productId.fish)!.id,
      },
    ]),
  );
  expect(ticks).toHaveLength(2);
});

it("A669 rolls back the draft, created lines and moved ticks when submission fails after the move", async () => {
  const v = await setupVenue();
  const { partyId } = await seated(v);
  const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
  const state = await inTx(async (tx) =>
    savePartyAllergy(
      tx,
      partyId,
      await partyRevision(partyId),
      { answer: "allergies", guests: [{ who: "Window", allergens: { milk: {} } }] },
      ALEX,
    ),
  );
  await inTx((tx) =>
    setAllergyLineTicks(tx, partyId, [
      { guestId: state.guests[0]!.id, draftLineId: draft.lines[0]!.id },
    ]),
  );
  const before = await inTx((tx) => readPartyAllergy(tx, partyId));
  const beforeDraft = await draftRow(draft.id);
  const move = VENUE_SERVICE.moveAllergyDraftTicks;
  const spy = vi
    .spyOn(VENUE_SERVICE, "moveAllergyDraftTicks")
    .mockImplementation(async (...args) => {
      await move(...args);
      throw new AppError("allergy.invalid", { field: "probe_after_move" });
    });
  try {
    await expect(
      submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]),
    ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "probe_after_move" } });
  } finally {
    spy.mockRestore();
  }
  expect(await inTx((tx) => readPartyAllergy(tx, partyId))).toEqual(before);
  expect(await draftRow(draft.id)).toEqual(beforeDraft);
  expect(await storedLines(draft.id)).toHaveLength(1);
  expect(await db.select().from(workingOrderLines)).toEqual([]);
  expect(await db.select().from(orderGroups)).toEqual([]);
  expect(await db.select().from(ticketItems)).toEqual([]);
});

it("A669 writes draft line batches in one insert while preserving their contents", async () => {
  const v = await setupVenue();
  const { partyId, tabId } = await seated(v);
  let lineWrites = 0;
  const result = await inTx(async (tx) => {
    const spy = vi.spyOn(tx, "insert");
    try {
      const saved = await saveDraft(tx, v.cfg, partyId, ALEX, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [item(v, "beer"), item(v, "fish"), item(v, "wine", { variantId: v.glass })],
      });
      lineWrites = spy.mock.calls.filter(([table]) => table === orderDraftLines).length;
      return saved;
    } finally {
      spy.mockRestore();
    }
  });
  expect(result.lines.map((line) => line.menuItemId)).toEqual([
    v.offer("beer"),
    v.offer("fish"),
    v.offer("wine"),
  ]);
  expect(lineWrites).toBe(1);
});

it("A669 replays a submitted draft without duplicating its groups or moving its ticks again", async () => {
  const v = await setupVenue();
  const { partyId } = await seated(v);
  const draft = await save(v, partyId, ALEX, null, 0, [item(v, "beer")]);
  const state = await inTx(async (tx) =>
    savePartyAllergy(
      tx,
      partyId,
      await partyRevision(partyId),
      { answer: "allergies", guests: [{ who: "Window", allergens: { milk: {} } }] },
      ALEX,
    ),
  );
  await inTx((tx) =>
    setAllergyLineTicks(tx, partyId, [
      { guestId: state.guests[0]!.id, draftLineId: draft.lines[0]!.id },
    ]),
  );
  const input = {
    submissionId: randomUUID(),
    expectedPartyRevision: await partyRevision(partyId),
    operatorId: ALEX,
    expectedEdit: await expectedDraftEditForTest(db, draft),
    draftRevision: draft.revision,
    groups: [{ lineIds: lineIds(draft), release: "hold" as const }],
  };
  const first = await inTx((tx) => submitDraft(tx, v.cfg, partyId, draft.id, input));
  const afterFirst = await inTx((tx) => readPartyAllergy(tx, partyId));
  expect(afterFirst.ticks).toEqual([
    { guestId: state.guests[0]!.id, draftLineId: null, workingLineId: first.groups[0]!.lineIds[0] },
  ]);
  const replay = await inTx((tx) => submitDraft(tx, v.cfg, partyId, draft.id, input));
  expect(replay).toEqual(first);
  expect(await inTx((tx) => readPartyAllergy(tx, partyId))).toEqual(afterFirst);
  expect(await db.select().from(workingOrderLines)).toHaveLength(1);
  expect(await db.select().from(orderGroups)).toHaveLength(1);
});

describe("source-backed draft foundations", () => {
  async function family(v: Venue, billId: string, lineNo = 1) {
    const parentId = randomUUID();
    const extraId = randomUUID();
    await inTx(async (tx) => {
      await tx.insert(workingOrderLines).values({
        id: parentId,
        workingOrderId: billId,
        lineNo,
        name: "Frozen burger",
        descriptions: { [LOCALE]: "Hamburguesa congelada" },
        quantity: 2500,
        priceQuantity: 500,
        unitPriceGross: 200,
        listUnitPriceGross: 400,
        lineTotal: 1000,
        vatClass: "reduced",
        note: "No salt",
        courseId: v.courseId,
        creditedTo: ALEX,
      });
      await tx.insert(workingOrderLines).values({
        id: extraId,
        workingOrderId: billId,
        lineNo: lineNo + 1,
        name: "Frozen sauce",
        descriptions: { [LOCALE]: "Salsa congelada" },
        quantity: 5000,
        unitPriceGross: 50,
        lineTotal: 250,
        vatClass: "general",
        parentLineId: parentId,
        extraListId: v.sauceListId,
        productId: v.productId.sauce,
      });
    });
    return { parentId, extraId };
  }
  async function reserved(v: Venue, partyId: string, billId: string, owner = ALEX) {
    const draft = await save(v, partyId, owner, null, 0, [item(v, "beer"), item(v, "fish")]);
    const source = await family(v, billId);
    const id = randomUUID();
    await inTx(async (tx) => {
      await tx
        .update(orderDraftLines)
        .set({ position: 3 })
        .where(eq(orderDraftLines.id, draft.lines[1]!.id));
      await tx
        .insert(orderDraftRecalledLines)
        .values({ id, draftId: draft.id, sourceLineId: source.parentId, position: 2, slot: 2 });
    });
    return { draft, id, ...source };
  }
  const sourceInput = (id: string, sourceLineId: string) => ({
    id,
    sourceLineId,
    quantity: "2.500",
    note: "No salt",
    courseId: null,
    makeAt: null,
    slot: 2,
    joinGroupId: null,
    afterGroupId: null,
  });

  it("raises a recalled weighed dish and its extras at their frozen discounted prices and preserves its allergy tick", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    const state = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        {
          answer: "allergies",
          guests: [{ who: "Window", allergens: { milk: {} } }],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [{ guestId: state.guests[0]!.id, workingLineId: parentId }]),
    );
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.id);
    const saved = await save(v, partyId, ALEX, draft.id, draft.revision, [
      { ...sourceInput(id, parentId), courseId: v.courseId, quantity: "3.500" },
      ...draft.lines,
    ]);
    expect(saved.lines[0]).toMatchObject({
      id,
      sourceLineId: parentId,
      quantity: "3.500",
      source: {
        netAmount: "17.50",
        line: { id: parentId, quantity: "3.500", unitPriceGross: "2.00", priceQuantity: "0.500" },
        extras: [{ id: extraId, quantity: "7.000", unitPriceGross: "0.50" }],
      },
    });
    expect(
      await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.id),
    ).toEqual(
      before.map((line) =>
        line.id === parentId
          ? { ...line, quantity: 3500, lineTotal: 1400 }
          : line.id === extraId
            ? { ...line, quantity: 7000, lineTotal: 350 }
            : line,
      ),
    );
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual([
      { guestId: state.guests[0]!.id, draftLineId: null, workingLineId: parentId },
    ]);
    const taken = await takeOver(v, partyId, draft.id, SAM, saved.revision);
    expect(taken.lines).toEqual(saved.lines);
    const resent = await submit(v, partyId, taken, SAM, [{ lineIds: [id], release: "hold" }]);
    expect(resent.groups[0]!.lineIds).toContain(parentId);
    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.id);
    expect(after).toEqual(
      before.map((line) =>
        line.id === parentId
          ? { ...line, quantity: 3500, lineTotal: 1400, groupId: resent.groups[0]!.id }
          : line.id === extraId
            ? { ...line, quantity: 7000, lineTotal: 350, groupId: resent.groups[0]!.id }
            : line,
      ),
    );
  });

  it("refuses an increased recalled total past the simplified-invoice limit without changing any table", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    await refusedWritingNothing(
      () =>
        save(
          { ...v, cfg: { ...v.cfg, simplifiedInvoiceLimit: decimal("15.00") } },
          partyId,
          ALEX,
          draft.id,
          draft.revision,
          [
            { ...sourceInput(id, parentId), courseId: v.courseId, quantity: "3.500" },
            ...draft.lines,
          ],
        ),
      { code: "sale.total_exceeds_simplified_limit", params: { total: "17.50", limit: "15.00" } },
    );
  });

  it("keeps a recalled portioned extra's own pricing quantity when the dish quantity rises", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    await db
      .update(workingOrderLines)
      .set({ quantity: 2500, priceQuantity: 500 })
      .where(eq(workingOrderLines.id, extraId));
    const saved = await save(v, partyId, ALEX, draft.id, draft.revision, [
      { ...sourceInput(id, parentId), courseId: v.courseId, quantity: "3.500" },
      ...draft.lines,
    ]);
    expect(saved.lines[0]).toMatchObject({
      source: {
        netAmount: "17.50",
        extras: [
          { id: extraId, quantity: "3.500", priceQuantity: "0.500", unitPriceGross: "0.50" },
        ],
      },
    });
    const [extra] = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, extraId));
    expect(extra).toMatchObject({ quantity: 3500, priceQuantity: 500, lineTotal: 350 });
  });

  it.each([
    "other owner",
    "other party",
    "other reference",
    "extra source",
    "terminal draft",
  ] as const)(
    "refuses a recalled edit through the helper with an %s without writing anything",
    async (kind) => {
      const v = await setupVenue();
      const { partyId, tabId } = await seated(v);
      const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
      if (kind === "terminal draft")
        await db
          .update(orderDrafts)
          .set({ state: "discarded" })
          .where(eq(orderDrafts.id, draft.id));
      if (kind === "extra source")
        await db
          .update(orderDraftRecalledLines)
          .set({ sourceLineId: extraId })
          .where(eq(orderDraftRecalledLines.id, id));
      await refusedWritingNothing(
        () =>
          inTx((tx) =>
            saveRecalledLine(
              tx,
              v.cfg,
              kind === "other party" ? randomUUID() : partyId,
              kind === "extra source" ? extraId : parentId,
              {
                ...sourceInput(
                  kind === "other reference" ? randomUUID() : id,
                  kind === "extra source" ? extraId : parentId,
                ),
                quantity: kind === "extra source" ? "5.000" : "2.500",
                courseId: v.courseId,
                note: "Forged edit",
              },
              kind === "other owner" ? SAM : ALEX,
            ),
          ),
        { code: "management.request_invalid", params: { field: "sourceLineId" } },
      );
    },
  );

  async function billDraft(v: Venue, partyId: string, billId: string, owner = ALEX) {
    return inTx((tx) =>
      saveDraft(tx, v.cfg, partyId, owner, {
        billId,
        draftId: null,
        revision: 0,
        lines: [item(v, "beer", { slot: 1 }), item(v, "fish", { slot: 1 })],
      }),
    );
  }

  it("a direct bill merge absorbs same-owner source drafts, preserving slots, charges and both tick kinds", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const intoId = randomUUID();
    await inTx((tx) =>
      orderWrites.createOpenOrder(tx, v.cfg, intoId, [], "Bill 2", {
        partyId,
        existingService: true,
        copyServiceContextFrom: tabId,
      }),
    );
    const own = await billDraft(v, partyId, intoId);
    const source = await billDraft(v, partyId, tabId);
    const frozen = await family(v, tabId);
    const referenceId = randomUUID();
    await db.insert(orderDraftRecalledLines).values({
      id: referenceId,
      draftId: source.id,
      sourceLineId: frozen.parentId,
      position: 3,
      slot: 1,
    });
    const allergy = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        {
          answer: "allergies",
          guests: [
            { who: "Window", allergens: { milk: {} } },
            { who: "Door", allergens: { eggs: {} } },
          ],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        { guestId: allergy.guests[0]!.id, draftLineId: source.lines[0]!.id },
        { guestId: allergy.guests[1]!.id, workingLineId: frozen.parentId },
      ]),
    );
    const beforeTicks = (await inTx((tx) => readPartyAllergy(tx, partyId))).ticks;
    const beforeMoney = await db
      .select({
        id: workingOrderLines.id,
        amount: workingOrderLines.lineTotal,
        price: workingOrderLines.unitPriceGross,
        quantity: workingOrderLines.quantity,
        credit: workingOrderLines.creditedTo,
        parent: workingOrderLines.parentLineId,
      })
      .from(workingOrderLines);

    await inTx(async (tx) =>
      mergeBills(tx, v.cfg, intoId, tabId, {
        partyId,
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: ALEX,
      }),
    );

    const [read] = await draftsOf(v, partyId);
    expect(await draftsOf(v, partyId)).toHaveLength(1);
    expect(read).toMatchObject({ id: own.id, billId: intoId, revision: 1 });
    expect(read!.lines.map((line) => [line.id, line.slot])).toEqual([
      [own.lines[0]!.id, 1],
      [own.lines[1]!.id, 1],
      [source.lines[0]!.id, 2],
      [source.lines[1]!.id, 2],
      [referenceId, 2],
    ]);
    expect(read!.lines[4]).toMatchObject({
      sourceLineId: frozen.parentId,
      source: {
        netAmount: "12.50",
        line: { id: frozen.parentId },
        extras: [{ id: frozen.extraId }],
      },
    });
    expect(await draftRow(source.id)).toMatchObject({
      state: "discarded",
      revision: 1,
      billId: intoId,
    });
    expect(await eventsOf(source.id)).toContainEqual({
      kind: "discarded",
      fromPerson: ALEX,
      toPerson: ALEX,
      actorId: ALEX,
      detail: { intoDraftId: own.id },
    });
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(beforeTicks);
    expect(
      await db
        .select({
          id: workingOrderLines.id,
          amount: workingOrderLines.lineTotal,
          price: workingOrderLines.unitPriceGross,
          quantity: workingOrderLines.quantity,
          credit: workingOrderLines.creditedTo,
          parent: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines),
    ).toEqual(beforeMoney);
    expect((await db.select().from(workingOrderLines)).map((line) => line.workingOrderId)).toEqual([
      intoId,
      intoId,
    ]);
    expect(await db.select().from(orderDraftRecalledLines)).toMatchObject([
      { id: referenceId, draftId: own.id, sourceLineId: frozen.parentId, position: 5, slot: 2 },
    ]);
  });

  it("a direct bill merge refuses another editor before explicit takeover and retains all source rows", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const intoId = randomUUID();
    await inTx((tx) =>
      orderWrites.createOpenOrder(tx, v.cfg, intoId, [], "Bill 2", {
        partyId,
        existingService: true,
        copyServiceContextFrom: tabId,
      }),
    );
    const own = await billDraft(v, partyId, intoId, SAM);
    const source = await billDraft(v, partyId, tabId);
    const frozen = await family(v, tabId);
    const referenceId = randomUUID();
    await db.insert(orderDraftRecalledLines).values({
      id: referenceId,
      draftId: source.id,
      sourceLineId: frozen.parentId,
      position: 3,
      slot: 1,
    });
    await refusedWritingNothing(
      () =>
        inTx(async (tx) =>
          mergeBills(tx, v.cfg, intoId, tabId, {
            partyId,
            expectedPartyRevision: await partyRevision(partyId),
            operatorId: SAM,
          }),
        ),
      { code: "draft.taken_over", params: { billId: tabId, draftId: source.id, ownerId: ALEX } },
    );
    await takeOver(v, partyId, source.id, SAM, source.revision);
    await inTx(async (tx) =>
      mergeBills(tx, v.cfg, intoId, tabId, {
        partyId,
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: SAM,
      }),
    );
    expect(await draftRow(source.id)).toMatchObject({
      state: "discarded",
      billId: intoId,
      revision: 2,
    });
    expect(await draftRow(own.id)).toMatchObject({ state: "open", billId: intoId, revision: 1 });
    const read = (await draftsOf(v, partyId)).find((draft) => draft.id === own.id)!;
    expect(read.lines.map((line) => line.id)).toEqual([
      ...lineIds(own),
      ...lineIds(source),
      referenceId,
    ]);
    expect(read.lines[4]).toMatchObject({
      sourceLineId: frozen.parentId,
      source: { netAmount: "12.50" },
    });
  });

  it("a refused bill merge leaves source reservations, drafts, ticks and all other rows unchanged", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const into = await seated(v, "Other table");
    await reserved(v, partyId, tabId);
    await refusedWritingNothing(
      () =>
        inTx(async (tx) =>
          mergeBills(tx, v.cfg, tabId, into.tabId, {
            partyId,
            expectedPartyRevision: await partyRevision(partyId),
            operatorId: SAM,
          }),
        ),
      { code: "bill.other_party" },
    );
  });

  it("joining parties with merged bills absorbs source reservations after rebinding their bill", async () => {
    const v = await setupVenue();
    const into = await seated(v);
    const from = await seated(v, "Other table");
    const own = await billDraft(v, into.partyId, into.tabId);
    const source = await reserved(v, from.partyId, from.tabId);
    await merge(v, into, from, ALEX);
    const read = await draftsOf(v, into.partyId);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({
      id: own.id,
      billId: into.tabId,
      partyId: into.partyId,
      revision: 1,
    });
    expect(read[0]!.lines.find((line) => line.id === source.id)).toMatchObject({
      sourceLineId: source.parentId,
      source: { netAmount: "12.50" },
      slot: 3,
    });
    expect(await draftRow(source.draft.id)).toMatchObject({
      state: "discarded",
      billId: into.tabId,
    });
    expect(await draftsOf(v, from.partyId)).toEqual([]);
  });

  async function movingFamily(v: Venue, state: "held" | "fired") {
    const from = await seated(v);
    const billId = randomUUID();
    await inTx((tx) =>
      orderWrites.createOpenOrder(tx, v.cfg, billId, [], "Moving bill", {
        partyId: from.partyId,
        existingService: true,
        copyServiceContextFrom: from.tabId,
      }),
    );
    const groupId = randomUUID();
    await db.insert(orderGroups).values({
      id: groupId,
      partyId: from.partyId,
      position: 1,
      state,
      submittedBy: ALEX,
      ...(state === "fired" ? { firedAt: "2026-10-16T20:00:00.000Z", firedBy: ALEX } : {}),
    });
    const draft = await billDraft(v, from.partyId, billId);
    // A stale target must travel unchanged; the next save/send recovers it explicitly.
    await db
      .update(orderDraftLines)
      .set({ slot: 0, joinGroupId: groupId })
      .where(eq(orderDraftLines.id, draft.lines[0]!.id));
    await db
      .update(orderDraftLines)
      .set({ slot: 2, afterGroupId: groupId })
      .where(eq(orderDraftLines.id, draft.lines[1]!.id));
    const frozen = await family(v, billId);
    await db
      .update(workingOrderLines)
      .set({ groupId, sentAt: "2026-10-16T20:00:00.000Z" })
      .where(eq(workingOrderLines.workingOrderId, billId));
    const id = randomUUID();
    await db.insert(orderDraftRecalledLines).values({
      id,
      draftId: draft.id,
      sourceLineId: frozen.parentId,
      position: 3,
      slot: 2,
      afterGroupId: groupId,
    });
    const allergy = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        from.partyId,
        await partyRevision(from.partyId),
        {
          answer: "allergies",
          guests: [
            { who: "Window", allergens: { milk: {} } },
            { who: "Door", allergens: { eggs: {} } },
          ],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, from.partyId, [
        { guestId: allergy.guests[0]!.id, draftLineId: draft.lines[0]!.id },
        { guestId: allergy.guests[1]!.id, workingLineId: frozen.parentId },
      ]),
    );
    return { from, billId, draft, groupId, id, allergy, ...frozen };
  }

  for (const destination of ["free table", "occupied table", "split table"] as const) {
    it.each(["held", "fired"] as const)(
      `a bill moving to a ${destination} carries fresh and recalled drafts from a %s group`,
      async (state) => {
        const v = await setupVenue();
        const moving = await movingFamily(v, state);
        const { from, billId, draft, groupId, id, parentId } = moving;
        const target = destination === "occupied table" ? await seated(v, "Occupied") : null;
        const tableId =
          target?.tableId ??
          (await inTx(
            async (tx) =>
              (await createTable(tx, v.cfg, { label: "Destination", zoneId: v.zoneId })).id,
          ));
        const own = target === null ? null : await billDraft(v, target.partyId, target.tabId);
        if (destination === "split table")
          await inTx(async (tx) =>
            joinTables(tx, v.cfg, from.partyId, tableId, {
              bills: "separate",
              operatorId: SAM,
              expectedPartyRevision: await partyRevision(from.partyId),
              otherPartyId: null,
            }),
          );
        const freshBefore = await storedLines(draft.id);
        const refsBefore = await db.select().from(orderDraftRecalledLines);
        const familyBefore = await db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, billId));
        const originalGuests = (await inTx((tx) => readPartyAllergy(tx, from.partyId))).guests;
        const result = await inTx(async (tx) =>
          destination === "split table"
            ? splitTable(tx, v.cfg, from.partyId, tableId, billId, {
                expectedPartyRevision: await partyRevision(from.partyId),
                operatorId: SAM,
              })
            : moveBill(
                tx,
                v.cfg,
                billId,
                { tableId },
                {
                  bills: "separate",
                  operatorId: SAM,
                  partyId: from.partyId,
                  expectedPartyRevision: await partyRevision(from.partyId),
                  otherPartyId: target?.partyId ?? null,
                  ...(target === null
                    ? {}
                    : { expectedOtherPartyRevision: await partyRevision(target.partyId) }),
                },
              ),
        );
        const partyId = result.partyId!;
        expect(await draftRow(draft.id)).toMatchObject({
          partyId,
          billId,
          ownerId: ALEX,
          state: "open",
          revision: draft.revision + 1,
        });
        expect(await storedLines(draft.id)).toEqual(freshBefore);
        expect(await db.select().from(orderDraftRecalledLines)).toEqual(refsBefore);
        expect(
          await db
            .select()
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, billId)),
        ).toEqual(familyBefore.map((line) => ({ ...line, groupId: null })));
        expect(await db.select().from(orderGroups).where(eq(orderGroups.partyId, partyId))).toEqual(
          [],
        );
        expect(await db.select().from(ticketItems)).toEqual([]);
        const reads = await draftsOf(v, partyId);
        expect(reads).toHaveLength(own === null ? 1 : 2);
        expect(reads.find((row) => row.id === draft.id)!.lines).toMatchObject([
          { id: draft.lines[0]!.id, slot: 0, joinGroupId: groupId },
          { id: draft.lines[1]!.id, slot: 2, afterGroupId: groupId },
          {
            id,
            sourceLineId: parentId,
            slot: 2,
            afterGroupId: groupId,
            source: { netAmount: "12.50" },
          },
        ]);
        expect(await draftsOf(v, from.partyId)).toEqual([]);
        if (own !== null) expect(reads.find((row) => row.id === own.id)!.lines).toEqual(own.lines);
        const staying = await inTx((tx) => readPartyAllergy(tx, from.partyId));
        const arriving = await inTx((tx) => readPartyAllergy(tx, partyId));
        expect(staying.guests).toEqual(originalGuests);
        expect(staying.ticks).toEqual([]);
        expect(arriving.answer).toBe("allergies");
        expect(arriving.guests.map((guest) => guest.who)).toEqual(["Window", "Door"]);
        expect(
          [...arriving.ticks].sort(
            (a, b) => Number(a.draftLineId === null) - Number(b.draftLineId === null),
          ),
        ).toEqual([
          { guestId: arriving.guests[0]!.id, draftLineId: draft.lines[0]!.id, workingLineId: null },
          { guestId: arriving.guests[1]!.id, draftLineId: null, workingLineId: parentId },
        ]);
        expect(
          arriving.guests.every((guest) => !originalGuests.some((old) => old.id === guest.id)),
        ).toBe(true);
        await refusedWritingNothing(
          () =>
            save(v, partyId, ALEX, draft.id, draft.revision + 1, [
              { ...item(v, "beer"), id: draft.lines[0]!.id, joinGroupId: groupId },
              { ...item(v, "fish"), id: draft.lines[1]!.id, slot: 2, afterGroupId: groupId },
              { ...sourceInput(id, parentId), courseId: v.courseId, afterGroupId: groupId },
            ]),
          { code: "group.not_found" },
        );
        await refusedWritingNothing(
          () =>
            submit(
              v,
              partyId,
              { id: draft.id, revision: draft.revision + 1 },
              ALEX,
              [{ lineIds: [draft.lines[0]!.id], release: "hold" }],
              { joinGroupId: groupId },
            ),
          { code: "group.not_found" },
        );
      },
    );
  }

  it("a party join with separate bills retains recalled sources, groups, ticks and same-owner drafts", async () => {
    const v = await setupVenue();
    const moving = await movingFamily(v, "held");
    const target = await seated(v, "Receiving table");
    const own = await billDraft(v, target.partyId, target.tabId);
    const freshBefore = await storedLines(moving.draft.id);
    const refsBefore = await db.select().from(orderDraftRecalledLines);
    const familyBefore = await db.select().from(workingOrderLines);
    const ticksBefore = (await inTx((tx) => readPartyAllergy(tx, moving.from.partyId))).ticks;
    await inTx(async (tx) =>
      joinTables(tx, v.cfg, target.partyId, moving.from.tableId, {
        bills: "separate",
        operatorId: SAM,
        expectedPartyRevision: await partyRevision(target.partyId),
        otherPartyId: moving.from.partyId,
        expectedOtherPartyRevision: await partyRevision(moving.from.partyId),
      }),
    );
    expect(await draftRow(moving.draft.id)).toMatchObject({
      partyId: target.partyId,
      billId: moving.billId,
      revision: 1,
    });
    expect(await storedLines(moving.draft.id)).toEqual(freshBefore);
    expect(await db.select().from(orderDraftRecalledLines)).toEqual(refsBefore);
    expect(await db.select().from(workingOrderLines)).toEqual(familyBefore);
    expect(
      (await db.select().from(orderGroups).where(eq(orderGroups.id, moving.groupId)))[0],
    ).toMatchObject({ partyId: target.partyId, state: "held" });
    const reads = await draftsOf(v, target.partyId);
    expect(reads).toHaveLength(2);
    expect(reads.find((row) => row.id === own.id)!.lines).toEqual(own.lines);
    expect(reads.find((row) => row.id === moving.draft.id)!.lines[2]).toMatchObject({
      id: moving.id,
      sourceLineId: moving.parentId,
      source: { netAmount: "12.50" },
    });
    expect((await inTx((tx) => readPartyAllergy(tx, target.partyId))).ticks).toEqual(ticksBefore);
  });

  it.each(["free table", "occupied table", "split table"] as const)(
    "a recalled companion does not let active held work leave for a %s, and refusal changes nothing",
    async (destination) => {
      const v = await setupVenue();
      const moving = await movingFamily(v, "held");
      const active = await family(v, moving.billId, 3);
      await db
        .update(workingOrderLines)
        .set({ groupId: moving.groupId })
        .where(eq(workingOrderLines.id, active.parentId));
      const target = destination === "occupied table" ? await seated(v, "Occupied") : null;
      const tableId =
        target?.tableId ??
        (await inTx(
          async (tx) =>
            (await createTable(tx, v.cfg, { label: "Destination", zoneId: v.zoneId })).id,
        ));
      if (destination === "split table")
        await inTx(async (tx) =>
          joinTables(tx, v.cfg, moving.from.partyId, tableId, {
            bills: "separate",
            operatorId: SAM,
            expectedPartyRevision: await partyRevision(moving.from.partyId),
            otherPartyId: null,
          }),
        );
      await refusedWritingNothing(
        () =>
          inTx(async (tx) =>
            destination === "split table"
              ? splitTable(tx, v.cfg, moving.from.partyId, tableId, moving.billId, {
                  expectedPartyRevision: await partyRevision(moving.from.partyId),
                  operatorId: SAM,
                })
              : moveBill(
                  tx,
                  v.cfg,
                  moving.billId,
                  { tableId },
                  {
                    bills: "separate",
                    operatorId: SAM,
                    partyId: moving.from.partyId,
                    expectedPartyRevision: await partyRevision(moving.from.partyId),
                    otherPartyId: target?.partyId ?? null,
                    ...(target === null
                      ? {}
                      : { expectedOtherPartyRevision: await partyRevision(target.partyId) }),
                  },
                ),
          ),
        { code: "group.held_leaves_party", params: { tabId: moving.billId, lineNo: 3 } },
      );
    },
  );

  it.each(["free table", "occupied table", "split table"] as const)(
    "a failure after arrival at a %s rolls back the party, draft, source family and both tick kinds",
    async (destination) => {
      const v = await setupVenue();
      const moving = await movingFamily(v, "held");
      const target = destination === "occupied table" ? await seated(v, "Occupied") : null;
      const tableId =
        target?.tableId ??
        (await inTx(
          async (tx) =>
            (await createTable(tx, v.cfg, { label: "Destination", zoneId: v.zoneId })).id,
        ));
      if (destination === "split table")
        await inTx(async (tx) =>
          joinTables(tx, v.cfg, moving.from.partyId, tableId, {
            bills: "separate",
            operatorId: SAM,
            expectedPartyRevision: await partyRevision(moving.from.partyId),
            otherPartyId: null,
          }),
        );
      const arrive = groupWrites.groupArrivingDishes;
      const probe = vi
        .spyOn(groupWrites, "groupArrivingDishes")
        .mockImplementation(async (...args) => {
          await arrive(...args);
          throw new AppError("management.request_invalid", { field: "arrival_probe" });
        });
      try {
        await refusedWritingNothing(
          () =>
            inTx(async (tx) =>
              destination === "split table"
                ? splitTable(tx, v.cfg, moving.from.partyId, tableId, moving.billId, {
                    expectedPartyRevision: await partyRevision(moving.from.partyId),
                    operatorId: SAM,
                  })
                : moveBill(
                    tx,
                    v.cfg,
                    moving.billId,
                    { tableId },
                    {
                      bills: "separate",
                      operatorId: SAM,
                      partyId: moving.from.partyId,
                      expectedPartyRevision: await partyRevision(moving.from.partyId),
                      otherPartyId: target?.partyId ?? null,
                      ...(target === null
                        ? {}
                        : { expectedOtherPartyRevision: await partyRevision(target.partyId) }),
                    },
                  ),
            ),
          { code: "management.request_invalid", params: { field: "arrival_probe" } },
        );
      } finally {
        probe.mockRestore();
      }
    },
  );

  it("moving a bill into a merged bill absorbs its draft once and retains its original party history", async () => {
    const v = await setupVenue();
    const moving = await movingFamily(v, "held");
    const target = await seated(v, "Receiving table");
    const own = await billDraft(v, target.partyId, target.tabId);
    const result = await inTx(async (tx) =>
      moveBill(
        tx,
        v.cfg,
        moving.billId,
        { tableId: target.tableId },
        {
          bills: "merge",
          operatorId: ALEX,
          partyId: moving.from.partyId,
          expectedPartyRevision: await partyRevision(moving.from.partyId),
          otherPartyId: target.partyId,
          expectedOtherPartyRevision: await partyRevision(target.partyId),
        },
      ),
    );
    expect(result).toEqual({ partyId: target.partyId, billId: target.tabId, merged: true });
    expect(await draftRow(moving.draft.id)).toMatchObject({
      state: "discarded",
      revision: 1,
      partyId: moving.from.partyId,
      billId: target.tabId,
    });
    expect(await draftRow(own.id)).toMatchObject({
      state: "open",
      revision: 1,
      partyId: target.partyId,
      billId: target.tabId,
    });
    const reads = await draftsOf(v, target.partyId);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.lines.map((line) => line.id)).toEqual([
      ...lineIds(own),
      ...lineIds(moving.draft),
      moving.id,
    ]);
    expect(reads[0]!.lines[4]).toMatchObject({
      sourceLineId: moving.parentId,
      source: { netAmount: "12.50" },
      slot: 3,
      afterGroupId: moving.groupId,
    });
    expect(await draftsOf(v, moving.from.partyId)).toEqual([]);
    expect((await inTx((tx) => readPartyAllergy(tx, target.partyId))).ticks).toHaveLength(2);
    expect(await db.select().from(ticketItems)).toEqual([]);
  });

  it("reads fresh and discounted source families in one position order without a live offer", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    const [read] = await draftsOf(v, partyId);
    expect(read!.lines.map((line) => line.id)).toEqual([
      draft.lines[0]!.id,
      id,
      draft.lines[1]!.id,
    ]);
    expect(read!.lines[0]).toMatchObject({ sourceLineId: null, source: null });
    expect(read!.lines[1]).toMatchObject({
      id,
      sourceLineId: parentId,
      quantity: "2.500",
      note: "No salt",
      courseId: v.courseId,
      course: { id: v.courseId, name: "Mains", displayOrder: 1, heldUntilFired: true },
      makeAt: null,
      noMerge: true,
      unavailable: false,
      slot: 2,
      joinGroupId: null,
      afterGroupId: null,
      source: {
        line: {
          id: parentId,
          name: "Frozen burger",
          unitPriceGross: "2.00",
          listUnitPriceGross: "4.00",
          priceQuantity: "0.500",
          menuItemId: null,
        },
        extras: [
          {
            id: extraId,
            name: "Frozen sauce",
            parentLineNo: 1,
            quantity: "5.000",
            unitPriceGross: "0.50",
          },
        ],
        netAmount: "12.50",
      },
    });
    expect(read!.lines[1]).not.toHaveProperty("menuItemId");
  });

  it("retains source identities and common positions through an ordinary save and takeover", async () => {
    const v = await setupVenue();
    const { partyId, tabId, tableId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const input = {
      ...sourceInput(id, parentId),
      courseId: v.courseId,
      source: { netAmount: "0.00" },
      unitPriceGross: "0.00",
    };
    const saved = await save(v, partyId, ALEX, draft.id, draft.revision, [
      input,
      draft.lines[1]!,
      draft.lines[0]!,
    ]);
    expect(saved.lines.map((line) => line.id)).toEqual([
      id,
      draft.lines[1]!.id,
      draft.lines[0]!.id,
    ]);
    expect(saved.lines[0]).toMatchObject({
      sourceLineId: parentId,
      source: { netAmount: "12.50" },
    });
    expect(await db.select().from(orderDraftRecalledLines)).toMatchObject([
      { id, draftId: draft.id, sourceLineId: parentId, position: 1, slot: 2 },
    ]);
    expect((await storedLines(draft.id)).map(({ id, position }) => ({ id, position }))).toEqual([
      { id: draft.lines[1]!.id, position: 2 },
      { id: draft.lines[0]!.id, position: 3 },
    ]);
    expect(await unsentDraftsAt(v, tableId)).toEqual([{ ownerName: "Alex", lineCount: 3 }]);
    const taken = await takeOver(v, partyId, draft.id, SAM, saved.revision);
    expect(taken.lines).toEqual(saved.lines);
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    ).toEqual(before);
  });

  it.each(["unclaimed", "extra", "other owner", "new draft"])(
    "refuses an arbitrary source claim: %s",
    async (kind) => {
      const v = await setupVenue();
      const { partyId, tabId } = await seated(v);
      const { draft, id, parentId, extraId } = await reserved(
        v,
        partyId,
        tabId,
        kind === "other owner" ? SAM : ALEX,
      );
      const sourceLineId =
        kind === "extra" ? extraId : kind === "unclaimed" ? randomUUID() : parentId;
      const own =
        kind === "other owner"
          ? await saveOnSeparateBill(v, partyId, ALEX, null, 0, [item(v, "wine")])
          : draft;
      await refusedWritingNothing(
        () =>
          save(v, partyId, ALEX, kind === "new draft" ? null : own.id, own.revision, [
            { ...item(v, "beer"), sourceLineId },
          ]),
        { code: "management.request_invalid", params: { field: "lines.0.id" } },
      );
      expect((await db.select().from(orderDraftRecalledLines))[0]).toMatchObject({
        id,
        sourceLineId: parentId,
      });
    },
  );
  it.each([
    "different source",
    "fresh ID",
    "fresh disguise",
    "duplicate",
    "omitted",
    "quantity",
    "options",
    "extras",
  ])("refuses unresolved source changes: %s", async (kind) => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    const source = { ...sourceInput(id, parentId), courseId: v.courseId };
    let lines: unknown[] = [source, ...draft.lines];
    const edits: Record<string, unknown> = {
      quantity: "2",
      options: [],
      extras: [],
    };
    if (kind === "different source") lines[0] = { ...source, sourceLineId: extraId };
    else if (kind === "fresh ID") lines = [{ ...source, id: draft.lines[0]!.id }, draft.lines[1]!];
    else if (kind === "fresh disguise") lines[0] = { ...item(v, "beer"), id };
    else if (kind === "duplicate") lines.push(source);
    else if (kind === "omitted") lines = draft.lines;
    else lines[0] = { ...source, [kind]: edits[kind] };
    const field =
      kind === "omitted"
        ? "lines"
        : kind === "duplicate"
          ? "lines.3.id"
          : ["fresh disguise", "different source", "fresh ID", "options", "extras"].includes(kind)
            ? "lines.0.sourceLineId"
            : `lines.0.${kind}`;
    await refusedWritingNothing(() => save(v, partyId, ALEX, draft.id, draft.revision, lines), {
      code: "management.request_invalid",
      params: { field },
    });
  });

  it.each(["hold", "fire"] as const)(
    "resends a source-only %s group without repricing or duplicating its frozen bill family",
    async (release) => {
      const v = await setupVenue();
      const { partyId, tabId } = await seated(v);
      const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId, SAM);
      const before = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
      const pricing = vi.spyOn(orderWrites, "priceTabRound");
      try {
        const sent = submit(v, partyId, draft, SAM, [{ lineIds: [id], release }]);
        await expect(sent).resolves.toMatchObject({
          tabId,
          groups: [{ state: release === "hold" ? "held" : "fired", lineIds: [parentId] }],
          draft: { id: draft.id, revision: 1 },
        });
        const answer = await sent;
        expect(pricing).not.toHaveBeenCalled();
        expect(answer.draft!.lines.map((line) => line.id)).toEqual(lineIds(draft));
        expect(await db.select().from(orderDraftRecalledLines)).toEqual([]);
        const after = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
        expect(after.map((line) => ({ ...line, groupId: null, sentAt: null }))).toEqual(
          before.map((line) => ({ ...line, groupId: null, sentAt: null })),
        );
        expect(after.map((line) => line.groupId)).toEqual([
          answer.groups[0]!.id,
          answer.groups[0]!.id,
        ]);
        expect(after.map((line) => line.id)).toEqual([parentId, extraId]);
        const tickets = await db.select().from(ticketItems);
        expect(tickets.map((line) => line.workingOrderLineId)).toContain(parentId);
        expect(tickets.every((line) => (line.firedAt === null) === (release === "hold"))).toBe(
          true,
        );
      } finally {
        pricing.mockRestore();
      }
    },
  );

  it("resends a mixed fresh/source destination once, keeps original allergy identity and replays without writes", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    const allergy = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        { answer: "allergies", guests: [{ who: "Window", allergens: { milk: {} } }] },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        { guestId: allergy.guests[0]!.id, workingLineId: parentId },
        { guestId: allergy.guests[0]!.id, draftLineId: draft.lines[0]!.id },
      ]),
    );
    const input = {
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevision(partyId),
      operatorId: ALEX,
      expectedEdit: await expectedDraftEditForTest(db, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: [id, ...lineIds(draft)], release: "fire" as const }],
    };
    const sending = inTx((tx) => submitDraft(tx, v.cfg, partyId, draft.id, input));
    await expect(sending).resolves.toMatchObject({
      tabId,
      draft: null,
      groups: [{ state: "fired" }],
    });
    const sent = await sending;
    const rows = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    expect(rows).toHaveLength(4);
    expect(rows.map((line) => line.id).slice(0, 2)).toEqual([parentId, extraId]);
    expect(rows.every((line) => line.groupId === sent.groups[0]!.id)).toBe(true);
    expect(sent.groups[0]!.lineIds).toHaveLength(3);
    expect(await db.select().from(orderDraftRecalledLines)).toEqual([]);
    expect(await storedLines(draft.id)).toEqual([]);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(
      expect.arrayContaining([
        { guestId: allergy.guests[0]!.id, draftLineId: null, workingLineId: parentId },
        {
          guestId: allergy.guests[0]!.id,
          draftLineId: null,
          workingLineId: rows.find((line) => line.productId === v.productId.beer)!.id,
        },
      ]),
    );
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toHaveLength(2);
    const beforeReplay = await everything();
    expect(await inTx((tx) => submitDraft(tx, v.cfg, partyId, draft.id, input))).toEqual(sent);
    expect(await everything()).toEqual(beforeReplay);
  });

  it("source resend can join a held group on another bill, retaining the old bill and held origin", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const otherBill = randomUUID();
    await inTx((tx) =>
      orderWrites.createOpenOrder(tx, v.cfg, otherBill, [], "Bill 2", {
        partyId,
        existingService: true,
        copyServiceContextFrom: tabId,
      }),
    );
    const existing = await inTx(async (tx) =>
      submitGroups(tx, v.cfg, partyId, {
        billId: otherBill,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: SAM,
        groups: [{ lines: [{ menuItemId: v.offer("beer"), quantity: "1" }], release: "hold" }],
      }),
    );
    const sending = inTx(async (tx) =>
      submitDraft(tx, v.cfg, partyId, draft.id, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(partyId),
        operatorId: ALEX,
        expectedEdit: await expectedDraftEditForTest(db, draft),
        draftRevision: draft.revision,
        groups: [{ lineIds: [id], release: "hold", joinGroupId: existing.groups[0]!.id }],
      }),
    );
    await expect(sending).resolves.toMatchObject({
      tabId,
      groups: [{ id: existing.groups[0]!.id, state: "held", displayNumber: 1 }],
    });
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.id, parentId)),
    ).toMatchObject([
      {
        workingOrderId: tabId,
        groupId: existing.groups[0]!.id,
        unitPriceGross: 200,
        lineTotal: 1000,
      },
    ]);
    expect(await db.select().from(orderGroups)).toHaveLength(1);
  });

  it("a later routing refusal rolls back source release, fresh inserts and both draft tables", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id } = await reserved(v, partyId, tabId);
    const fire = orderWrites.fireLines;
    let calls = 0;
    const probe = vi.spyOn(orderWrites, "fireLines").mockImplementation(async (...args) => {
      const result = await fire(...args);
      if (++calls === 2) throw new AppError("station.no_default", { locationId: v.cfg.locationId });
      return result;
    });
    try {
      await refusedWritingNothing(
        () =>
          submit(v, partyId, draft, ALEX, [
            { lineIds: [id], release: "hold" },
            { lineIds: lineIds(draft), release: "fire" },
          ]),
        { code: "station.no_default", params: { locationId: v.cfg.locationId } },
      );
      expect(calls).toBe(2);
    } finally {
      probe.mockRestore();
    }
  });

  it("resends two identical frozen families without combining their bill identities", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const first = await reserved(v, partyId, tabId);
    const second = await family(v, tabId, 3);
    const secondId = randomUUID();
    await inTx((tx) =>
      tx
        .insert(orderDraftRecalledLines)
        .values({
          id: secondId,
          draftId: first.draft.id,
          sourceLineId: second.parentId,
          position: 4,
        })
        .then(() => undefined),
    );
    const sent = await submit(v, partyId, first.draft, ALEX, [
      { lineIds: [first.id, secondId], release: "hold" },
    ]);
    expect(sent.groups[0]!.lineIds).toEqual([first.parentId, second.parentId]);
    const rows = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    expect(rows.map((line) => [line.id, line.lineTotal])).toEqual([
      [first.parentId, 1000],
      [first.extraId, 250],
      [second.parentId, 1000],
      [second.extraId, 250],
    ]);
    expect(await db.select().from(orderDraftRecalledLines)).toEqual([]);
  });

  it("a missing source resend destination retains every reservation and original bill row", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id } = await reserved(v, partyId, tabId);
    await refusedWritingNothing(
      () =>
        inTx(async (tx) =>
          submitDraft(tx, v.cfg, partyId, draft.id, {
            submissionId: randomUUID(),
            expectedPartyRevision: await partyRevision(partyId),
            operatorId: ALEX,
            expectedEdit: await expectedDraftEditForTest(db, draft),
            draftRevision: draft.revision,
            groups: [
              { lineIds: [id, ...lineIds(draft)], release: "hold", joinGroupId: randomUUID() },
            ],
          }),
        ),
      { code: "group.not_found" },
    );
  });

  it("partial source send leaves the other source, fresh row and frozen family unsent", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const first = await reserved(v, partyId, tabId);
    const second = await family(v, tabId, 3);
    const secondId = randomUUID();
    await inTx(async (tx) => {
      await tx.insert(orderDraftRecalledLines).values({
        id: secondId,
        draftId: first.draft.id,
        sourceLineId: second.parentId,
        position: 4,
      });
    });
    const sent = await submit(v, partyId, first.draft, ALEX, [
      { lineIds: [first.id, first.draft.lines[0]!.id], release: "hold" },
    ]);
    expect(sent.draft!.lines.map((line) => line.id)).toEqual([first.draft.lines[1]!.id, secondId]);
    expect(sent.draft!.lines[1]).toMatchObject({
      sourceLineId: second.parentId,
      source: { netAmount: "12.50" },
    });
    expect(await db.select().from(orderDraftRecalledLines)).toMatchObject([
      { id: secondId, sourceLineId: second.parentId },
    ]);
    const rows = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    expect(
      rows.filter((line) => line.id === second.parentId || line.parentLineId === second.parentId),
    ).toMatchObject([
      { id: second.parentId, groupId: null, lineTotal: 1000 },
      { id: second.extraId, groupId: null, lineTotal: 250 },
    ]);
    expect(
      (await db.select().from(ticketItems)).some(
        (line) => line.workingOrderLineId === second.parentId,
      ),
    ).toBe(false);
  });

  it("releases a sent reservation so the same bill identity can be recalled and sent again", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId, extraId } = await reserved(v, partyId, tabId);
    const first = await submit(v, partyId, draft, ALEX, [{ lineIds: [id], release: "hold" }]);
    const nextId = randomUUID();
    await inTx(async (tx) => {
      await tx.delete(ticketItems).where(eq(ticketItems.workingOrderId, tabId));
      await tx
        .insert(orderDraftRecalledLines)
        .values({ id: nextId, draftId: draft.id, sourceLineId: parentId, position: 4 });
    });
    const second = await submit(v, partyId, first.draft!, ALEX, [
      { lineIds: [nextId], release: "fire" },
    ]);
    expect(second.groups[0]!.lineIds).toEqual([parentId]);
    expect(second.groups[0]!.displayNumber).toBe(2);
    const rows = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    expect(rows.map((line) => [line.id, line.lineTotal])).toEqual([
      [parentId, 1000],
      [extraId, 250],
    ]);
    expect(await db.select().from(orderDraftRecalledLines)).toEqual([]);
  });

  it("keeps a source-only draft in the floor count and allows placement saves without fresh offers", async () => {
    const v = await setupVenue();
    const { partyId, tabId, tableId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const saved = await save(v, partyId, ALEX, draft.id, draft.revision, [
      { ...sourceInput(id, parentId), courseId: v.courseId, slot: 0 },
    ]);
    expect(saved.lines).toHaveLength(1);
    expect(saved.lines[0]).toMatchObject({ id, sourceLineId: parentId, slot: 0 });
    expect(await storedLines(draft.id)).toEqual([]);
    expect(await unsentDraftsAt(v, tableId)).toEqual([{ ownerName: "Alex", lineCount: 1 }]);
  });

  it("transfers a colleague's source references in place and leaves the taker's other bill alone", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const own = await saveOnSeparateBill(v, partyId, SAM, null, 0, [item(v, "beer", { slot: 1 })]);
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const taken = await takeOver(v, partyId, draft.id, SAM, draft.revision);
    expect(taken.id).toBe(draft.id);
    expect(taken.lines.map((line) => line.id)).toEqual([
      draft.lines[0]!.id,
      id,
      draft.lines[1]!.id,
    ]);
    expect(await draftsOf(v, partyId)).toEqual([taken, own]);
    expect(taken.lines[1]).toMatchObject({
      id,
      sourceLineId: parentId,
      slot: 2,
      source: { netAmount: "12.50" },
    });
    expect(await db.select().from(orderDraftRecalledLines)).toMatchObject([
      { id, draftId: draft.id, position: 2, slot: 2 },
    ]);
    expect(await draftRow(draft.id)).toMatchObject({ state: "open", ownerId: SAM });
    expect(
      await db.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, tabId)),
    ).toEqual(before);
  });

  it("sends only fresh rows while retaining a recalled companion and its original bill family", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const sent = await submit(v, partyId, draft, ALEX, [
      { lineIds: lineIds(draft), release: "fire" },
    ]);
    expect(sent.draft!.lines).toHaveLength(1);
    expect(sent.draft!.lines[0]).toMatchObject({
      id,
      sourceLineId: parentId,
      source: { netAmount: "12.50" },
    });
    expect(await draftRow(draft.id)).toMatchObject({ state: "open", revision: 1 });
    expect(await db.select().from(orderDraftRecalledLines)).toMatchObject([
      { id, draftId: draft.id },
    ]);
    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(after.filter((line) => line.id === parentId || line.parentLineId === parentId)).toEqual(
      before,
    );
  });

  it.each(["extra", "other bill"])(
    "refuses a stored source reference naming an %s",
    async (kind) => {
      const v = await setupVenue();
      const { partyId, tabId } = await seated(v);
      const { draft, id, extraId } = await reserved(v, partyId, tabId);
      const target =
        kind === "extra" ? extraId : (await family(v, (await seated(v, "Foreign")).tabId)).parentId;
      await db
        .update(orderDraftRecalledLines)
        .set({ sourceLineId: target })
        .where(eq(orderDraftRecalledLines.id, id));
      await expect(draftsOf(v, partyId)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "sourceLineId" },
      });
      expect(await draftRow(draft.id)).toMatchObject({ state: "open", revision: 0 });
    },
  );

  it("does not discard an unresolved source reservation or abandon its history", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    await reserved(v, partyId, tabId);
    await refusedWritingNothing(() => inTx((tx) => discardPartyDrafts(tx, partyId, ALEX)), {
      code: "management.request_invalid",
      params: { field: "drafts" },
    });
  });
  it("counts each fresh and recalled row once when both sets contain several dishes", async () => {
    const v = await setupVenue();
    const { partyId, tabId, tableId } = await seated(v);
    const { draft } = await reserved(v, partyId, tabId);
    const second = await family(v, tabId, 3);
    await db
      .insert(orderDraftRecalledLines)
      .values({ draftId: draft.id, sourceLineId: second.parentId, position: 4 });
    expect(await unsentDraftsAt(v, tableId)).toEqual([{ ownerName: "Alex", lineCount: 4 }]);
  });

  it("retains the original working-line allergy tick through source placement save and takeover", async () => {
    const v = await setupVenue();
    const { partyId, tabId } = await seated(v);
    const { draft, id, parentId } = await reserved(v, partyId, tabId);
    const allergy = await inTx((tx) =>
      savePartyAllergy(
        tx,
        partyId,
        0,
        { answer: "allergies", guests: [{ who: "Window", allergens: { milk: {} } }] },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        { guestId: allergy.guests[0]!.id, workingLineId: parentId },
      ]),
    );
    const ticks = (await inTx((tx) => readPartyAllergy(tx, partyId))).ticks;
    expect(ticks).toEqual([
      { guestId: allergy.guests[0]!.id, workingLineId: parentId, draftLineId: null },
    ]);
    const saved = await save(v, partyId, ALEX, draft.id, draft.revision, [
      { ...sourceInput(id, parentId), courseId: v.courseId, slot: 0 },
      ...draft.lines,
    ]);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(ticks);
    const taken = await takeOver(v, partyId, draft.id, SAM, saved.revision);
    expect(taken.lines[0]).toMatchObject({ id, sourceLineId: parentId, slot: 0 });
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(ticks);
  });
});

describe("send-time fresh combining", () => {
  it("combines whole split lines per chosen destination, ignoring old slots and noMerge", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(v, partyId, ALEX, null, 0, [
      item(v, "beer", { noMerge: true, slot: 1 }),
      item(v, "beer", { noMerge: true, slot: 2, quantity: "2" }),
      item(v, "beer", { noMerge: true, slot: 2 }),
      item(v, "beer", { noMerge: true, slot: 3 }),
    ]);
    const sent = await submit(v, partyId, draft, ALEX, [
      { lineIds: lineIds(draft).slice(0, 2), release: "fire" },
      { lineIds: lineIds(draft).slice(2), release: "hold" },
    ]);
    expect(
      (await tabLines(partyId)).map(({ quantity, groupId }) => ({ quantity, groupId })),
    ).toEqual([
      { quantity: 3000, groupId: sent.groups[0]!.id },
      { quantity: 2000, groupId: sent.groups[1]!.id },
    ]);
    expect(await db.select().from(ticketItems)).toHaveLength(2);
    expect(sent.draft).toBeNull();
  });

  it("combines only unassigned rows and moves each guest's tick to its separate dish", async () => {
    const v = await setupVenue();
    const { partyId } = await seated(v);
    const draft = await save(
      v,
      partyId,
      ALEX,
      null,
      0,
      [0, 1, 2, 3].map(() => item(v, "beer", { noMerge: true })),
    );
    const allergy = await inTx(async (tx) =>
      savePartyAllergy(
        tx,
        partyId,
        await partyRevision(partyId),
        {
          answer: "allergies",
          guests: [
            { who: "Window", allergens: { milk: {} } },
            { who: "Door", allergens: { eggs: {} } },
          ],
        },
        ALEX,
      ),
    );
    await inTx((tx) =>
      setAllergyLineTicks(tx, partyId, [
        { guestId: allergy.guests[0]!.id, draftLineId: draft.lines[0]!.id },
        { guestId: allergy.guests[1]!.id, draftLineId: draft.lines[1]!.id },
      ]),
    );
    await submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "fire" }]);
    const rows = await db.select().from(workingOrderLines).orderBy(workingOrderLines.lineNo);
    expect(rows.map((line) => line.quantity)).toEqual([1000, 1000, 2000]);
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toEqual(
      expect.arrayContaining([
        { guestId: allergy.guests[0]!.id, draftLineId: null, workingLineId: rows[0]!.id },
        { guestId: allergy.guests[1]!.id, draftLineId: null, workingLineId: rows[1]!.id },
      ]),
    );
    expect((await inTx((tx) => readPartyAllergy(tx, partyId))).ticks).toHaveLength(2);
    expect(await storedLines(draft.id)).toEqual([]);
  });

  it.each(["note", "options", "extras", "course", "fraction"] as const)(
    "keeps split dishes separate when their %s differs",
    async (difference) => {
      const v = await setupVenue();
      const { partyId } = await seated(v);
      if (difference === "fraction") {
        await inTx(async (tx) => {
          const [kg] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "kg"));
          await updateProduct(tx, v.productId.burger, { unitId: kg!.id });
          await publishWorkingMenu(tx, v.menuId);
        });
      }
      const first = item(v, "burger", { options: [v.rare], noMerge: true });
      const changed = {
        note: { note: "No salt" },
        options: { options: [v.well] },
        extras: {
          extras: [
            { listId: v.sauceListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
          ],
        },
        course: { courseId: v.courseId },
        fraction: { quantity: "0.500" },
      }[difference];
      const draft = await save(v, partyId, ALEX, null, 0, [first, { ...first, ...changed }]);
      await submit(v, partyId, draft, ALEX, [{ lineIds: lineIds(draft), release: "hold" }]);
      const parents = (await db.select().from(workingOrderLines)).filter(
        (line) => line.parentLineId === null,
      );
      expect(parents).toHaveLength(2);
      expect(parents.map((line) => line.quantity)).toEqual([
        1000,
        difference === "fraction" ? 500 : 1000,
      ]);
    },
  );
});
